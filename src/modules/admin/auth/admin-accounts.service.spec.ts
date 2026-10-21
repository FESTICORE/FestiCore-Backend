import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { AdminAuditService } from '../audit/admin-audit.service';
import { AdminAccountsService } from './admin-accounts.service';
import { AdminAuthService } from './admin-auth.service';
import { AdminAccount } from './admin.entity';

describe('AdminAccountsService', () => {
  const actor = '073714c5-4a7e-4cd6-9335-e28ab5ac144f';
  const target = 'f4e43e16-c8e3-4afd-a09d-123011d23b91';
  const row: AdminAccount = {
    id: target,
    email: 'editor@example.com',
    role: 'editor',
    active: true,
    createdAt: new Date('2026-10-21T00:00:00Z'),
  };
  let repository: {
    find: jest.Mock;
    findOneBy: jest.Mock;
    countBy: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
  };
  let manager: { query: jest.Mock; getRepository: jest.Mock };
  let audit: { record: jest.Mock };
  let auth: { requestInviteLink: jest.Mock };
  let service: AdminAccountsService;

  beforeEach(() => {
    repository = {
      find: jest.fn().mockResolvedValue([row]),
      findOneBy: jest.fn().mockResolvedValue(null),
      countBy: jest.fn().mockResolvedValue(2),
      create: jest.fn((input: Partial<AdminAccount>) => ({ ...row, ...input })),
      save: jest.fn((input: AdminAccount) => Promise.resolve(input)),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    manager = {
      query: jest.fn().mockResolvedValue([]),
      getRepository: jest.fn().mockReturnValue(repository),
    };
    const dataSource = {
      transaction: jest.fn(
        (callback: (value: typeof manager) => Promise<unknown>) =>
          callback(manager),
      ),
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    auth = { requestInviteLink: jest.fn().mockResolvedValue(true) };
    service = new AdminAccountsService(
      repository as unknown as Repository<AdminAccount>,
      dataSource as unknown as DataSource,
      audit as unknown as AdminAuditService,
      auth as unknown as AdminAuthService,
    );
  });

  it('lists only safe account fields', async () => {
    repository.find.mockResolvedValue([{ ...row, tokenHash: 'secret' }]);
    await expect(service.list()).resolves.toEqual({ items: [row] });
  });

  it('normalizes an invite and writes audit before requesting the link', async () => {
    await expect(
      service.invite(actor, 'EDITOR@EXAMPLE.COM', 'editor', '127.0.0.1'),
    ).resolves.toEqual({ ...row, loginLinkRequested: true });
    expect(repository.findOneBy).toHaveBeenCalledWith({ email: row.email });
    expect(audit.record).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        actor,
        action: 'admin.invite',
        target: `admin:${target}`,
        after: { email: row.email, role: 'editor', active: true },
      }),
    );
    expect(auth.requestInviteLink).toHaveBeenCalledWith(row.email, '127.0.0.1');
    expect(audit.record.mock.invocationCallOrder[0]).toBeLessThan(
      auth.requestInviteLink.mock.invocationCallOrder[0],
    );
  });

  it('rejects duplicate active accounts without sending a link', async () => {
    repository.findOneBy.mockResolvedValue(row);
    await expect(
      service.invite(actor, row.email, 'viewer', null),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(auth.requestInviteLink).not.toHaveBeenCalled();
  });

  it('reactivates disabled accounts with the requested role', async () => {
    repository.findOneBy.mockResolvedValue({ ...row, active: false });
    await service.invite(actor, row.email, 'editor', null);
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({ active: true }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        before: { role: 'editor', active: false },
      }),
    );
  });

  it('reports a mail request limit without hiding the committed account', async () => {
    auth.requestInviteLink.mockRejectedValue(
      new HttpException('요청 제한', HttpStatus.TOO_MANY_REQUESTS),
    );
    await expect(
      service.invite(actor, row.email, 'editor', null),
    ).resolves.toEqual({
      ...row,
      loginLinkRequested: false,
    });
  });

  it('reports a hidden link preparation failure as not requested', async () => {
    auth.requestInviteLink.mockResolvedValue(false);
    await expect(
      service.invite(actor, row.email, 'editor', null),
    ).resolves.toEqual({
      ...row,
      loginLinkRequested: false,
    });
  });

  it('forbids self deletion and the last active owner', async () => {
    await expect(service.disable(actor, actor)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    repository.findOneBy.mockResolvedValue({ ...row, role: 'owner' });
    repository.countBy.mockResolvedValue(1);
    await expect(service.disable(actor, target)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('disables the account, revokes sessions and pending links, and audits atomically', async () => {
    repository.findOneBy.mockResolvedValue(row);
    await service.disable(actor, target);
    expect(repository.update).toHaveBeenCalledWith(
      { id: target, active: true },
      { active: false },
    );
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE "admin_sessions"'),
      [target],
    );
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE "admin_magic_links"'),
      [target],
    );
    expect(audit.record).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        actor,
        action: 'admin.disable',
        target: `admin:${target}`,
        after: { email: row.email, role: 'editor', active: false },
      }),
    );
  });

  it('returns 404 for an absent or already disabled account', async () => {
    await expect(service.disable(actor, target)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    repository.findOneBy.mockResolvedValue({ ...row, active: false });
    await expect(service.disable(actor, target)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
