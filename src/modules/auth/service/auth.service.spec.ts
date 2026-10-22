import { DataSource, EntityManager, Repository } from 'typeorm';

jest.mock('jose', () => ({
  createRemoteJWKSet: jest.fn(),
  decodeJwt: jest.fn(),
  importPKCS8: jest.fn(),
  jwtVerify: jest.fn(),
  SignJWT: jest.fn(),
}));
import { User } from '../entity/user.entity';
import { AppleService } from './apple.service';
import { AppleRevokeRetryService } from './apple-revoke-retry.service';
import { AuthService } from './auth.service';
import { FlagPackSyncService } from '../../flags/flag-pack-sync.service';
import { GoogleService } from './google.service';
import { TokenService } from './token.service';

describe('AuthService logout account devices', () => {
  const userId = '00000000-0000-4000-8000-000000000001';

  function setup() {
    const query = jest.fn().mockResolvedValue([]);
    const transaction = jest
      .fn()
      .mockImplementation(
        (work: (manager: EntityManager) => Promise<unknown>) =>
          work({ query } as unknown as EntityManager),
      );
    const service = new AuthService(
      {} as GoogleService,
      {} as AppleService,
      {} as TokenService,
      {} as Repository<User>,
      { transaction } as unknown as DataSource,
      {} as AppleRevokeRetryService,
      {} as FlagPackSyncService,
    );
    return { service, query, transaction };
  }

  it('계정 소유 기기 전체의 푸시 수신과 refresh 토큰을 같은 트랜잭션에서 해제한다', async () => {
    const { service, query, transaction } = setup();
    await service.logout(userId);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('WHERE "userId" = $1'),
      [userId],
    );
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('SELECT "id" FROM "devices" WHERE "userId" = $1'),
      [userId],
    );
    expect(query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('UPDATE "refresh_tokens"'),
      [userId],
    );
  });

  it('기기 정리가 실패하면 refresh 토큰 폐기를 실행하지 않는다', async () => {
    const { service, query } = setup();
    query.mockRejectedValueOnce(new Error('device update failed'));
    await expect(service.logout(userId)).rejects.toThrow(
      'device update failed',
    );
    expect(query).toHaveBeenCalledTimes(1);
  });
});

describe('AuthService web grant replacement', () => {
  it('binds a pending admin grant only after Google verifies the email', async () => {
    const user = {
      id: 'user-id',
      provider: 'google',
      providerId: 'subject',
    } as User;
    const query = jest
      .fn()
      .mockImplementation((sql: string) =>
        sql.includes('FROM "users"')
          ? [{ id: 'user-id' }]
          : sql.includes('UPDATE "admin_accounts"')
            ? [{ id: 'admin-id', role: 'owner' }]
            : [],
      );
    const transaction = jest
      .fn()
      .mockImplementation(
        (work: (manager: EntityManager) => Promise<unknown>) =>
          work({ query } as unknown as EntityManager),
      );
    const verify = jest.fn();
    const google = { verify } as unknown as GoogleService;
    const service = new AuthService(
      google,
      {} as AppleService,
      {
        issue: jest.fn().mockResolvedValue({
          accessToken: 'access',
          refreshToken: 'refresh',
        }),
      } as unknown as TokenService,
      {
        findOne: jest.fn().mockResolvedValue(user),
      } as unknown as Repository<User>,
      { transaction } as unknown as DataSource,
      {} as AppleRevokeRetryService,
      {} as FlagPackSyncService,
    );
    verify.mockResolvedValueOnce({
      provider: 'google',
      providerId: 'subject',
      email: 'OWNER@EXAMPLE.COM',
      emailVerified: false,
    });
    await service.login({ provider: 'google', token: 'unverified' });
    expect(transaction).not.toHaveBeenCalled();
    verify.mockResolvedValueOnce({
      provider: 'google',
      providerId: 'subject',
      email: 'OWNER@EXAMPLE.COM',
      emailVerified: true,
    });
    await service.login({ provider: 'google', token: 'verified' });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('"userId" IS NULL'),
      ['user-id', 'owner@example.com'],
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO "admin_audit"'),
      [
        'admin-id',
        'admin:admin-id',
        JSON.stringify({
          email: 'owner@example.com',
          role: 'owner',
          userId: null,
        }),
        JSON.stringify({
          email: 'owner@example.com',
          role: 'owner',
          userId: 'user-id',
        }),
      ],
    );
  });

  it('exposes live admin role in me without trusting the user email', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ id: 'admin-id', role: 'editor' }]);
    const service = new AuthService(
      {} as GoogleService,
      {} as AppleService,
      {} as TokenService,
      {
        findOne: jest.fn().mockResolvedValue({
          id: 'user-id',
          provider: 'google',
          email: 'stale@example.com',
        }),
      } as unknown as Repository<User>,
      { query } as unknown as DataSource,
      {} as AppleRevokeRetryService,
      {} as FlagPackSyncService,
    );
    await expect(service.me('user-id')).resolves.toMatchObject({
      admin: { id: 'admin-id', role: 'editor' },
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('"userId" = $1'),
      ['user-id'],
    );
  });

  it('uses one account for Google app and web login with the same subject', async () => {
    const users: User[] = [];
    const repo = {
      findOne: jest
        .fn()
        .mockImplementation(({ where }: { where: Partial<User> }) =>
          Promise.resolve(
            users.find(
              (user) =>
                user.provider === where.provider &&
                user.providerId === where.providerId,
            ) ?? null,
          ),
        ),
      create: jest.fn().mockImplementation((input: User) => input),
      save: jest.fn().mockImplementation((input: User) => {
        const user = { ...input, id: 'shared-user' };
        users.push(user);
        return Promise.resolve(user);
      }),
    } as unknown as Repository<User>;
    const google = {
      verify: jest.fn().mockResolvedValue({
        provider: 'google',
        providerId: 'same-google-sub',
      }),
    } as unknown as GoogleService;
    const token = {
      issue: jest.fn().mockResolvedValue({
        accessToken: 'access',
        refreshToken: 'refresh',
      }),
    } as unknown as TokenService;
    const service = new AuthService(
      google,
      {} as AppleService,
      token,
      repo,
      {} as DataSource,
      {} as AppleRevokeRetryService,
      {} as FlagPackSyncService,
    );

    const app = await service.login({
      provider: 'google',
      token: 'app-id-token',
    });
    const web = await service.completeWebLogin({
      provider: 'google',
      providerId: 'same-google-sub',
    });

    expect(app.user.id).toBe('shared-user');
    expect(app.newUser).toBe(true);
    expect(web).toEqual({ userId: 'shared-user', newUser: false });
    expect(users).toHaveLength(1);
    expect(users[0].nickname).toMatch(/^관객-[0-9A-F]{4}$/);
  });

  it.each([
    [
      '  열두글자를넘어가는긴닉네임입니다  ',
      '열두글자를넘어가는긴닉네임입니다'.slice(0, 12),
    ],
    ['12345678901😀', '12345678901😀'],
  ])(
    'trims a social profile name without splitting Unicode characters',
    async (name, expected) => {
      const save = jest
        .fn()
        .mockImplementation((user: User) =>
          Promise.resolve({ ...user, id: 'new-user' }),
        );
      const service = new AuthService(
        {
          verify: jest.fn().mockResolvedValue({
            provider: 'google',
            providerId: 'new-subject',
            name,
          }),
        } as unknown as GoogleService,
        {} as AppleService,
        {
          issue: jest.fn().mockResolvedValue({
            accessToken: 'access',
            refreshToken: 'refresh',
          }),
        } as unknown as TokenService,
        {
          findOne: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockImplementation((user: User) => user),
          save,
        } as unknown as Repository<User>,
        {} as DataSource,
        {} as AppleRevokeRetryService,
        {} as FlagPackSyncService,
      );

      const result = await service.login({
        provider: 'google',
        token: 'id-token',
      });
      expect(result.user.nickname).toBe(expected);
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({ nickname: result.user.nickname }),
      );
    },
  );

  it('keeps provider authorization active when replacing a web refresh token', async () => {
    const user = {
      id: 'user-id',
      provider: 'apple',
      providerId: 'subject',
    } as User;
    const update = jest.fn().mockResolvedValue({ affected: 1 });
    const repo = {
      findOne: jest.fn().mockResolvedValueOnce(user).mockResolvedValueOnce({
        id: user.id,
        oauthWebRefreshToken: 'old-grant',
        oauthWebClientId: 'old-client',
      }),
      update,
    } as unknown as Repository<User>;
    const revokeConnection = jest.fn().mockResolvedValue(undefined);
    const apple = { revokeConnection } as unknown as AppleService;
    const service = new AuthService(
      {} as GoogleService,
      apple,
      {} as TokenService,
      repo,
      {} as DataSource,
      {} as AppleRevokeRetryService,
      {} as FlagPackSyncService,
    );

    await expect(
      service.completeWebLogin(
        { provider: 'apple', providerId: 'subject' },
        {
          refreshToken: 'new-grant',
          subject: 'subject',
          clientId: 'new-client',
        },
      ),
    ).resolves.toEqual({ userId: user.id, newUser: false });
    expect(update).toHaveBeenCalledWith(
      { id: user.id },
      {
        oauthWebRefreshToken: 'new-grant',
        oauthWebClientId: 'new-client',
      },
    );
    expect(revokeConnection).not.toHaveBeenCalled();
  });

  it('retries Apple grant revocation when account is deleted during web callback', async () => {
    const user = {
      id: 'gone',
      provider: 'apple',
      providerId: 'subject',
    } as User;
    const repo = {
      findOne: jest.fn().mockResolvedValue(user),
      update: jest.fn().mockResolvedValue({ affected: 0 }),
    } as unknown as Repository<User>;
    const apple = {
      revokeConnection: jest.fn().mockResolvedValue(false),
    } as unknown as AppleService;
    const enqueue = jest.fn().mockResolvedValue(undefined);
    const service = new AuthService(
      {} as GoogleService,
      apple,
      {} as TokenService,
      repo,
      {} as DataSource,
      { enqueue } as unknown as AppleRevokeRetryService,
      {} as FlagPackSyncService,
    );
    await expect(
      service.completeWebLogin(
        { provider: 'apple', providerId: 'subject' },
        { refreshToken: 'new-grant', subject: 'subject', clientId: 'client' },
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(enqueue).toHaveBeenCalledWith('new-grant', 'client');
  });

  it('does not issue tokens when an app grant update loses a race with withdrawal', async () => {
    const user = {
      id: 'gone',
      provider: 'apple',
      providerId: 'subject',
    } as User;
    const repo = {
      findOne: jest.fn().mockResolvedValue(user),
      update: jest.fn().mockResolvedValue({ affected: 0 }),
    } as unknown as Repository<User>;
    const apple = {
      verify: jest
        .fn()
        .mockResolvedValue({ provider: 'apple', providerId: 'subject' }),
      exchangeAuthCode: jest.fn().mockResolvedValue({
        refreshToken: 'new-app-grant',
        subject: 'subject',
        clientId: 'client',
      }),
      revokeConnection: jest.fn().mockResolvedValue(false),
    } as unknown as AppleService;
    const issue = jest.fn();
    const token = { issue } as unknown as TokenService;
    const enqueue = jest.fn().mockResolvedValue(undefined);
    const service = new AuthService(
      {} as GoogleService,
      apple,
      token,
      repo,
      {} as DataSource,
      { enqueue } as unknown as AppleRevokeRetryService,
      {} as FlagPackSyncService,
    );
    await expect(
      service.login({
        provider: 'apple',
        token: 'id-token',
        authorizationCode: 'fresh-code',
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(enqueue).toHaveBeenCalledWith('new-app-grant', 'client');
    expect(issue).not.toHaveBeenCalled();
  });
});

describe('AuthService 회원 탈퇴의 크루 소유권', () => {
  const userId = 'departing-user';

  function setup(successor?: string, admin?: { id: string; role: string }) {
    const query = jest.fn().mockImplementation((sql: string) => {
      if (sql.includes('FROM "users"') && sql.includes('FOR UPDATE'))
        return [{ id: userId, provider: 'google' }];
      if (sql.includes('FROM "admin_accounts"') && sql.includes('"userId"'))
        return admin ? [admin] : [];
      if (sql.includes('FROM "crews"')) return [{ id: 'crew-1' }];
      if (sql.includes('FROM "crew_members"'))
        return successor ? [{ userId: successor }] : [];
      return [];
    });
    const remove = jest.fn().mockResolvedValue({ affected: 1 });
    const transaction = jest
      .fn()
      .mockImplementation(
        (work: (manager: EntityManager) => Promise<unknown>) =>
          work({ query, delete: remove } as unknown as EntityManager),
      );
    const userRepo = {
      findOne: jest.fn().mockResolvedValue({ id: userId, provider: 'google' }),
    } as unknown as Repository<User>;
    const service = new AuthService(
      {} as GoogleService,
      {} as AppleService,
      {} as TokenService,
      userRepo,
      { transaction } as unknown as DataSource,
      {} as AppleRevokeRetryService,
      {} as FlagPackSyncService,
    );
    return { service, query, remove, transaction };
  }

  it('가장 먼저 가입한 다른 멤버에게 소유권을 넘기고 계정을 삭제한다', async () => {
    const { service, query, remove, transaction } = setup('successor');
    await service.withdraw(userId);

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('ORDER BY "id" FOR UPDATE'),
      [userId],
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('ORDER BY "joinedAt", "userId" LIMIT 1'),
      ['crew-1', userId],
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE "crews"'),
      ['successor', 'crew-1'],
    );
    expect(remove).toHaveBeenCalledWith(User, { id: userId });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM "device_subscriptions"'),
      [userId],
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM "devices" WHERE "userId" = $1'),
      [userId],
    );
  });

  it('다른 멤버가 없으면 크루를 지우고 계정을 삭제한다', async () => {
    const { service, query, remove } = setup();
    await service.withdraw(userId);

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM "crews"'),
      ['crew-1'],
    );
    expect(remove).toHaveBeenCalledWith(User, { id: userId });
  });

  it('연결된 관리자 권한을 비활성화하고 같은 트랜잭션에 감사 기록을 남긴다', async () => {
    const { service, query, remove } = setup(undefined, {
      id: 'admin-1',
      role: 'viewer',
    });
    await service.withdraw(userId);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE "admin_accounts" SET "active" = false'),
      ['admin-1'],
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO "admin_audit"'),
      [
        'admin-1',
        'admin:admin-1',
        JSON.stringify({ role: 'viewer', active: true }),
        JSON.stringify({ role: 'viewer', active: false }),
      ],
    );
    expect(remove).toHaveBeenCalledWith(User, { id: userId });
  });

  it('탈퇴 트랜잭션은 관리자 잠금을 잡은 뒤 사용자 행을 잠근다', async () => {
    const { service, query } = setup();
    await service.withdraw(userId);
    expect(query.mock.calls[0]).toEqual([
      expect.stringContaining('pg_advisory_xact_lock'),
    ]);
    expect(query.mock.calls[1]).toEqual([
      expect.stringContaining('FROM "users" WHERE "id" = $1 FOR UPDATE'),
      [userId],
    ]);
  });

  it('마지막 활성 owner는 회원 탈퇴 전에 거부한다', async () => {
    const { service, query, remove } = setup();
    query
      .mockImplementationOnce(() => [])
      .mockImplementationOnce(() => [{ id: userId, provider: 'google' }])
      .mockImplementationOnce(() => [{ id: 'admin-id', role: 'owner' }])
      .mockImplementationOnce(() => [{ count: 1 }]);
    await expect(service.withdraw(userId)).rejects.toMatchObject({
      status: 409,
    });
    expect(remove).not.toHaveBeenCalled();
  });
});

describe('AuthService 회원 탈퇴의 깃발과 Apple 재시도', () => {
  const userId = '00000000-0000-4000-8000-000000000001';
  const flagId = 'flg_1234567890abcdef';

  function setup(options: { successor?: string; apple?: boolean } = {}) {
    const query = jest.fn().mockImplementation((sql: string) => {
      if (sql.includes('FROM "users"') && sql.includes('FOR UPDATE'))
        return [
          {
            id: userId,
            provider: options.apple ? 'apple' : 'google',
            oauthRefreshToken: options.apple ? 'private-refresh-token' : null,
            oauthClientId: options.apple ? 'apple-client' : null,
          },
        ];
      if (sql.includes('FROM "flags"') && sql.includes('FOR UPDATE'))
        return [{ id: flagId, ownerId: userId }];
      if (sql.includes('FROM "flag_bearers"'))
        return options.successor ? [{ userId: options.successor }] : [];
      return [];
    });
    const remove = jest.fn().mockResolvedValue({ affected: 1 });
    const manager = { query, delete: remove } as unknown as EntityManager;
    const transaction = jest
      .fn()
      .mockImplementation((work: (value: EntityManager) => Promise<unknown>) =>
        work(manager),
      );
    const apple = {
      revokeConnection: jest.fn().mockResolvedValue(false),
    } as unknown as AppleService;
    const enqueue = jest.fn().mockResolvedValue(undefined);
    const syncMany = jest.fn().mockResolvedValue(['fst_12345678']);
    const invalidatePacks = jest.fn().mockResolvedValue(undefined);
    const userRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: userId,
        provider: options.apple ? 'apple' : 'google',
        oauthRefreshToken: options.apple ? 'private-refresh-token' : null,
        oauthClientId: options.apple ? 'apple-client' : null,
      }),
    } as unknown as Repository<User>;
    const service = new AuthService(
      {} as GoogleService,
      apple,
      {} as TokenService,
      userRepo,
      { transaction } as unknown as DataSource,
      { enqueue } as unknown as AppleRevokeRetryService,
      { syncMany, invalidatePacks } as unknown as FlagPackSyncService,
    );
    return {
      service,
      query,
      remove,
      manager,
      enqueue,
      syncMany,
      invalidatePacks,
    };
  }

  it('첫 공동 기수에게 깃발을 이전하고 팩을 갱신한다', async () => {
    const successor = '00000000-0000-4000-8000-000000000002';
    const { service, query, syncMany, invalidatePacks } = setup({ successor });
    await service.withdraw(userId);

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE "flags" SET "ownerId"'),
      [successor, flagId],
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('"isOwner" = true'),
      [flagId, successor],
    );
    expect(syncMany).toHaveBeenCalledWith([flagId], expect.anything());
    expect(invalidatePacks).toHaveBeenCalledWith(['fst_12345678']);
  });

  it('후임이 없는 깃발을 숨기고 관리자 알림을 남긴다', async () => {
    const { service, query } = setup();
    await service.withdraw(userId);

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('"hidden" = true'),
      [flagId],
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO "admin_notifications"'),
      [flagId],
    );
  });

  it('탈퇴한 사용자의 신고와 팔로우 집계를 함께 다시 계산한다', async () => {
    const { service, query } = setup();
    await service.withdraw(userId);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT "flagId" FROM "flag_reports"'),
      [userId],
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('"reportCount" = ('),
      [flagId],
    );
  });

  it('Apple 철회 실패는 같은 트랜잭션에 암호화 재시도 건을 저장한다', async () => {
    const { service, enqueue, manager, remove } = setup({ apple: true });
    await service.withdraw(userId);

    expect(enqueue).toHaveBeenCalledWith(
      'private-refresh-token',
      'apple-client',
      manager,
    );
    expect(remove).toHaveBeenCalledWith(User, { id: userId });
  });

  it('재시도 건 저장이 실패하면 계정을 삭제하지 않는다', async () => {
    const { service, enqueue, remove } = setup({ apple: true });
    enqueue.mockRejectedValueOnce(new Error('queue unavailable'));

    await expect(service.withdraw(userId)).rejects.toThrow('queue unavailable');
    expect(remove).not.toHaveBeenCalled();
  });
});
