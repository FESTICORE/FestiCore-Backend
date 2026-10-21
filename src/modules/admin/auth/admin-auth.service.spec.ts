import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import { AdminAuthService } from './admin-auth.service';
import {
  AdminAccount,
  AdminAuthAudit,
  AdminMagicLink,
  AdminSession,
} from './admin.entity';

describe('AdminAuthService', () => {
  const account = {
    id: '44efac72-7798-46c2-84e1-1a66313cda62',
    email: 'owner@example.com',
    role: 'owner' as const,
    active: true,
  };
  const values: Record<string, string> = {
    ADMIN_RESEND_API_KEY: 'test-key',
    ADMIN_EMAIL_FROM: 'admin@example.com',
    ADMIN_API_PUBLIC_URL: 'https://api.example.com',
    ADMIN_WEB_URL: 'https://admin.example.com',
    CORS_ORIGINS: 'https://admin.example.com',
    ADMIN_OWNER_EMAIL: 'owner@example.com',
    NODE_ENV: 'test',
  };

  let service: AdminAuthService;
  let accounts: {
    findOneBy: jest.Mock;
    count: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
  };
  let links: {
    create: jest.Mock;
    save: jest.Mock;
    delete: jest.Mock;
    findOneBy: jest.Mock;
  };
  let audit: { create: jest.Mock; save: jest.Mock };
  let manager: { query: jest.Mock; getRepository: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let send: jest.Mock;

  beforeEach(() => {
    accounts = {
      findOneBy: jest.fn().mockResolvedValue(account),
      count: jest.fn().mockResolvedValue(1),
      save: jest.fn(),
      create: jest.fn((value: Partial<AdminAccount>) => value),
    };
    links = {
      create: jest.fn((value: Partial<AdminMagicLink>) => ({
        id: 'link-id',
        ...value,
      })),
      save: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
      findOneBy: jest.fn().mockResolvedValue(null),
    };
    audit = {
      create: jest.fn((value: Partial<AdminAuthAudit>) => value),
      save: jest.fn().mockResolvedValue(undefined),
    };
    manager = {
      query: jest.fn((sql: string) => {
        if (sql.includes('count(*)')) return Promise.resolve([{ count: 0 }]);
        if (sql.includes('UPDATE "admin_magic_links"')) {
          return Promise.resolve([{ adminId: account.id }]);
        }
        return Promise.resolve([]);
      }),
      getRepository: jest.fn((entity: unknown) =>
        entity === AdminAccount
          ? { findOneBy: accounts.findOneBy }
          : { save: jest.fn().mockResolvedValue(undefined) },
      ),
    };
    dataSource = {
      transaction: jest.fn(
        (callback: (value: typeof manager) => Promise<unknown>) =>
          callback(manager),
      ),
    };
    send = jest.fn().mockResolvedValue({ ok: true });
    global.fetch = send;
    service = new AdminAuthService(
      accounts as unknown as Repository<AdminAccount>,
      links as unknown as Repository<AdminMagicLink>,
      {} as Repository<AdminSession>,
      audit as unknown as Repository<AdminAuthAudit>,
      dataSource as unknown as DataSource,
      { get: (key: string) => values[key] } as ConfigService,
    );
  });

  it('returns without sending a link for an unknown admin email', async () => {
    accounts.findOneBy.mockResolvedValue(null);
    const startedAt = Date.now();

    await expect(
      service.requestMagicLink('unknown@example.com', '127.0.0.1'),
    ).resolves.toBeUndefined();

    expect(links.save).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(1400);
  });

  it('reports preparation failure to a trusted invite but masks it from public login', async () => {
    const logError = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    links.save.mockRejectedValue(new Error('database unavailable'));

    await expect(
      service.requestInviteLink(account.email, '127.0.0.1'),
    ).resolves.toBe(false);
    await expect(
      service.requestMagicLink(account.email, '127.0.0.1'),
    ).resolves.toBeUndefined();
    expect(send).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledWith(
      'Admin magic-link preparation failed.',
    );
    logError.mockRestore();
  });

  it('stores only a hash and consumes a magic link once', async () => {
    const startedAt = Date.now();
    await service.requestMagicLink('OWNER@example.com', '127.0.0.1');
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(1400);
    const sentCalls = send.mock.calls as [string, { body: string }][];
    const message = JSON.parse(sentCalls[0][1].body) as {
      html: string;
    };
    const token = /token=([A-Za-z0-9_-]+)/.exec(message.html)?.[1];
    expect(token).toBeDefined();
    const savedCalls = links.save.mock.calls as [AdminMagicLink][];
    const stored = savedCalls[0][0];
    expect(stored.tokenHash).toBe(
      createHash('sha256').update(token!).digest('hex'),
    );
    expect(stored.tokenHash).not.toBe(token);

    const result = await service.consumeMagicLink(token!, '127.0.0.1');
    expect(result.admin).toEqual({
      id: account.id,
      email: account.email,
      role: 'owner',
    });
    expect(result.sessionToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('"consumedAt" IS NULL'),
      [stored.tokenHash],
    );

    manager.query.mockResolvedValueOnce([]);
    await expect(
      service.consumeMagicLink(token!, '127.0.0.1'),
    ).rejects.toThrow();
  });

  it('removes an unusable link when email delivery fails', async () => {
    const logError = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    send.mockResolvedValue({ ok: false, status: 503 });

    await expect(
      service.requestMagicLink(account.email, '127.0.0.1'),
    ).resolves.toBeUndefined();

    expect(links.delete).toHaveBeenCalledWith('link-id');
    expect(JSON.stringify(logError.mock.calls)).not.toContain(
      values.ADMIN_RESEND_API_KEY,
    );
    logError.mockRestore();
  });

  it('rejects an expired link in the atomic consume query', async () => {
    manager.query.mockResolvedValueOnce([]);
    const token = 'a'.repeat(43);

    await expect(service.consumeMagicLink(token, null)).rejects.toThrow();

    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('"expiresAt" > now()'),
      [createHash('sha256').update(token).digest('hex')],
    );
  });

  it('checks the shared database limit before looking up an email', async () => {
    manager.query.mockImplementation((sql: string) => {
      if (sql.includes('count(*)')) return Promise.resolve([{ count: 5 }]);
      return Promise.resolve([]);
    });

    await expect(
      service.requestMagicLink(account.email, '127.0.0.1'),
    ).rejects.toMatchObject({
      status: 429,
    });

    expect(accounts.findOneBy).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('reuses an unconsumed link without sending duplicate email', async () => {
    links.findOneBy.mockResolvedValue({ id: 'existing-link' });

    await expect(
      service.requestMagicLink(account.email, '127.0.0.1'),
    ).resolves.toBeUndefined();

    expect(links.findOneBy).toHaveBeenCalledWith(
      expect.objectContaining({ adminId: account.id }),
    );
    expect(links.save).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('does not apply a global email limit across different requesters', async () => {
    await service.requestMagicLink(account.email, '127.0.0.1');

    const rateKeys = (manager.query.mock.calls as [string, string[]][])
      .filter(([sql]) => sql.includes('count(*)'))
      .map(([, params]) => params[0]);
    expect(rateKeys).toHaveLength(1);
    expect(rateKeys[0]).toMatch(/^ip:/);
    expect(send).toHaveBeenCalled();
  });

  it('returns before a slow email provider finishes', async () => {
    let finishSend: ((value: { ok: boolean }) => void) | undefined;
    send.mockImplementation(
      () =>
        new Promise((resolve: (value: { ok: boolean }) => void) => {
          finishSend = resolve;
        }),
    );

    await service.requestMagicLink(account.email, '127.0.0.1');

    expect(send).toHaveBeenCalled();
    expect(finishSend).toBeDefined();
    finishSend!({ ok: true });
  });

  it('seeds the first owner under a database lock without a replica race', async () => {
    await service.onModuleInit();

    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('pg_advisory_xact_lock'),
    );
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT ("email") DO NOTHING'),
      ['owner@example.com'],
    );
    expect(accounts.count).not.toHaveBeenCalled();
  });
});
