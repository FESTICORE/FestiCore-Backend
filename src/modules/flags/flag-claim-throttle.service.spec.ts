import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { FlagClaimThrottleService } from './flag-claim-throttle.service';
import { FlagClaimBudget } from './flag.entity';

describe('FlagClaimThrottleService', () => {
  const budgets = new Map<string, FlagClaimBudget>();
  const repository = {
    findByIds: (keys: string[]) =>
      Promise.resolve(
        keys
          .map((key) => budgets.get(key))
          .filter((row): row is FlagClaimBudget => !!row),
      ),
    findOne: ({ where }: { where: { keyHash: string } }) =>
      Promise.resolve(budgets.get(where.keyHash) ?? null),
    create: (row: FlagClaimBudget) => row,
    save: (row: FlagClaimBudget) => {
      budgets.set(row.keyHash, row);
      return Promise.resolve(row);
    },
  };
  const manager = {
    getRepository: () => repository,
    query: () => Promise.resolve([]),
  };
  const db = {
    getRepository: () => repository,
    transaction: async <T>(action: (value: typeof manager) => Promise<T>) =>
      action(manager),
  } as unknown as DataSource;
  const config = { get: () => 'test-only-secret' } as unknown as ConfigService;
  const throttle = new FlagClaimThrottleService(db, config);
  const now = new Date('2026-11-20T09:00:00.000Z');
  const code = 'a'.repeat(64);

  beforeEach(() => budgets.clear());

  it('shares the failure budget across accounts and devices on the same festival IP', async () => {
    const contextA = {
      deviceId: 'f001bc1f-90a4-4428-a8c7-4be9527467c1',
      ip: '203.0.113.1',
    };
    const contextB = {
      deviceId: 'f001bc1f-90a4-4428-a8c7-4be9527467c2',
      ip: '203.0.113.1',
    };
    expect(
      (await throttle.failed('fest_1', 'user-a', code, contextA, now))
        .remainingAttempts,
    ).toBe(2);
    expect(
      (await throttle.failed('fest_1', 'user-b', 'b'.repeat(64), contextB, now))
        .remainingAttempts,
    ).toBe(1);
    expect(
      (await throttle.failed('fest_1', 'user-c', 'c'.repeat(64), contextB, now))
        .retryAfter,
    ).toBe(600);
    expect(
      await throttle.locked('fest_1', 'user-d', 'd'.repeat(64), contextA, now),
    ).toBe(600);
    expect(
      await throttle.locked('fest_2', 'user-d', 'd'.repeat(64), contextA, now),
    ).toBe(0);
  });

  it('shares the candidate-code budget across IP and device changes', async () => {
    for (let i = 1; i <= 3; i++) {
      await throttle.failed(
        'fest_1',
        `user-${i}`,
        code,
        {
          deviceId: `f001bc1f-90a4-4428-a8c7-4be9527467c${i}`,
          ip: `203.0.113.${i}`,
        },
        now,
      );
    }
    expect(
      await throttle.locked(
        'fest_1',
        'user-4',
        code,
        {
          deviceId: 'f001bc1f-90a4-4428-a8c7-4be9527467c4',
          ip: '203.0.113.4',
        },
        now,
      ),
    ).toBe(600);
  });

  it('uses the caller transaction for lookup and failure recording', async () => {
    const context = {
      deviceId: 'f001bc1f-90a4-4428-a8c7-4be9527467c1',
      ip: '203.0.113.1',
    };
    const transaction = jest.spyOn(db, 'transaction');
    const sameManager = manager as unknown as EntityManager;
    expect(
      await throttle.locked(
        'fest_1',
        'user-a',
        code,
        context,
        now,
        sameManager,
      ),
    ).toBe(0);
    await throttle.failed('fest_1', 'user-a', code, context, now, sameManager);
    expect(transaction).not.toHaveBeenCalled();
    expect(
      await throttle.locked(
        'fest_1',
        'user-a',
        code,
        context,
        now,
        sameManager,
      ),
    ).toBe(0);
    transaction.mockRestore();
  });
});
