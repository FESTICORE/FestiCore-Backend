import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { AppleRevokeRetry } from '../entity/apple-revoke-retry.entity';
import { AppleService } from './apple.service';
import { AppleRevokeRetryService } from './apple-revoke-retry.service';

jest.mock('jose', () => ({
  createRemoteJWKSet: jest.fn(),
  decodeJwt: jest.fn(),
  importPKCS8: jest.fn(),
  jwtVerify: jest.fn(),
  SignJWT: jest.fn(),
}));

const key = Buffer.alloc(32, 7).toString('base64');

function makeService() {
  const query = jest.fn().mockResolvedValue([]);
  const managerQuery = jest.fn().mockResolvedValue([]);
  const managerDelete = jest.fn().mockResolvedValue({ affected: 1 });
  const manager = {
    query: managerQuery,
    delete: managerDelete,
  } as unknown as EntityManager;
  const db = {
    query,
    transaction: jest.fn((work: (manager: EntityManager) => unknown) =>
      Promise.resolve(work(manager)),
    ),
  } as unknown as DataSource;
  const config = {
    get: jest.fn((name: string) => {
      if (name === 'APPLE_REVOKE_ENCRYPTION_KEY') return key;
      if (name === 'auth.apple.clientId') return 'apple-app-id';
      return undefined;
    }),
  } as unknown as ConfigService;
  const appleRevoke = jest.fn().mockResolvedValue(true);
  const apple = {
    revokeConnection: appleRevoke,
  } as unknown as AppleService;
  return {
    service: new AppleRevokeRetryService(config, db, apple),
    db,
    manager,
    managerQuery,
    managerDelete,
    query,
    apple,
    appleRevoke,
  };
}

describe('AppleRevokeRetryService', () => {
  it('encrypts refresh tokens before inserting and uses the withdrawal manager', async () => {
    const { service, manager, managerQuery, query } = makeService();
    await service.enqueue('private-refresh-token', 'apple-web-id', manager);
    expect(managerQuery).toHaveBeenCalledTimes(1);
    expect(query).not.toHaveBeenCalled();
    const params = (managerQuery.mock.calls as Array<[string, string[]]>)[0][1];
    expect(params[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(params[1]).toBe('apple-web-id');
    expect(params[2]).not.toContain('private-refresh-token');
    expect(params[3]).toBeTruthy();
    expect(params[4]).toBeTruthy();
  });

  it('retries a due encrypted token and deletes the work only after Apple accepts it', async () => {
    const { service, manager, managerQuery, managerDelete, appleRevoke } =
      makeService();
    await service.enqueue('retry-me', 'apple-web-id', manager);
    const params = (managerQuery.mock.calls as Array<[string, string[]]>)[0][1];
    managerQuery.mockResolvedValueOnce([
      {
        id: 'job-id',
        tokenHash: params[0],
        clientId: params[1],
        ciphertext: params[2],
        iv: params[3],
        authTag: params[4],
        attempts: 0,
      } as AppleRevokeRetry,
    ]);
    managerQuery.mockResolvedValueOnce([]);
    await service.runDue();
    expect(appleRevoke).toHaveBeenCalledWith('retry-me', 'apple-web-id');
    expect(managerDelete).toHaveBeenCalledWith(AppleRevokeRetry, {
      id: 'job-id',
    });
  });

  it('keeps failed work and advances backoff instead of deleting it', async () => {
    const { service, manager, managerQuery, managerDelete, appleRevoke } =
      makeService();
    await service.enqueue('retry-me', 'apple-app-id', manager);
    const params = (managerQuery.mock.calls as Array<[string, string[]]>)[0][1];
    managerQuery.mockResolvedValueOnce([
      {
        id: 'job-id',
        clientId: params[1],
        ciphertext: params[2],
        iv: params[3],
        authTag: params[4],
        attempts: 0,
      } as AppleRevokeRetry,
    ]);
    managerQuery.mockResolvedValueOnce([]);
    appleRevoke.mockResolvedValue(false);
    await service.runDue();
    expect(managerDelete).not.toHaveBeenCalled();
    expect(managerQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE "apple_revoke_retries"'),
      ['job-id', 1, 2, false],
    );
  });

  it('backs off when Apple revocation throws instead of exhausting the job', async () => {
    const { service, manager, managerQuery, managerDelete, appleRevoke } =
      makeService();
    await service.enqueue('retry-after-network-error', 'apple-app-id', manager);
    const params = (managerQuery.mock.calls as Array<[string, string[]]>)[0][1];
    managerQuery.mockResolvedValueOnce([
      {
        id: 'network-job',
        clientId: params[1],
        ciphertext: params[2],
        iv: params[3],
        authTag: params[4],
        attempts: 0,
      } as AppleRevokeRetry,
    ]);
    managerQuery.mockResolvedValueOnce([]);
    appleRevoke.mockRejectedValueOnce(new Error('network unavailable'));

    await service.runDue();

    expect(managerDelete).not.toHaveBeenCalled();
    expect(managerQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE "apple_revoke_retries"'),
      ['network-job', 1, 2, false],
    );
  });

  it('rejects queue insertion when encryption is not configured', async () => {
    const { service } = makeService();
    Reflect.set(service, 'key', null);
    await expect(service.enqueue('token')).rejects.toThrow(
      '암호화 키가 없습니다',
    );
  });
});

describe('AppleService revocation timeout', () => {
  it('aborts a delayed Apple response and reports the revoke as failed', async () => {
    const config = {
      get: jest.fn((name: string) =>
        name === 'auth.apple.clientId' ? 'apple-app-id' : undefined,
      ),
    } as unknown as ConfigService;
    const service = new AppleService(config);
    Reflect.set(
      service,
      'buildClientSecret',
      jest.fn().mockResolvedValue('client-secret'),
    );
    const controller = new AbortController();
    const timeout = jest
      .spyOn(AbortSignal, 'timeout')
      .mockImplementation((milliseconds) => {
        expect(milliseconds).toBe(5000);
        return controller.signal;
      });
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(
      (_url, options) =>
        new Promise<Response>((_resolve, reject) => {
          expect(options?.signal).toBe(controller.signal);
          controller.signal.addEventListener('abort', () => {
            reject(new Error('aborted'));
          });
        }),
    );
    try {
      const pending = service.revokeConnection('refresh-token');
      await new Promise((resolve) => setImmediate(resolve));
      controller.abort();
      await expect(pending).resolves.toBe(false);
    } finally {
      timeout.mockRestore();
      fetchMock.mockRestore();
    }
  });
});
