import { BadRequestException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AdminAuditService } from './admin-audit.service';

describe('AdminAuditService', () => {
  const dataSource = { query: jest.fn() };
  const service = new AdminAuditService(dataSource as unknown as DataSource);

  beforeEach(() => jest.clearAllMocks());

  it('uses the supplied transaction manager to save before and after', async () => {
    const manager = { query: jest.fn() };
    await service.record(manager as unknown as EntityManager, {
      actor: 'admin-1',
      action: 'flag.force-status',
      target: 'flag:flg_1',
      before: { status: 'active' },
      after: { status: 'hidden' },
    });
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO "admin_audit"'),
      [
        'admin-1',
        'flag.force-status',
        'flag:flg_1',
        '{"status":"active"}',
        '{"status":"hidden"}',
      ],
    );
    expect(dataSource.query).not.toHaveBeenCalled();
  });

  it('validates filters and applies a bounded parameterized query', async () => {
    dataSource.query.mockResolvedValue([{ actor: 'admin-1' }]);
    await expect(
      service.list(
        'admin-1',
        '2026-10-20T00:00:00+09:00',
        '2026-10-21T00:00:00+09:00',
        '100',
        '20',
      ),
    ).resolves.toEqual({ items: [{ actor: 'admin-1' }] });
    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('LIMIT $4 OFFSET $5'),
      [
        'admin-1',
        new Date('2026-10-20T00:00:00+09:00'),
        new Date('2026-10-21T00:00:00+09:00'),
        100,
        20,
      ],
    );
  });

  it.each([
    ['date without timezone', () => service.list(undefined, '2026-10-20')],
    ['invalid date', () => service.list(undefined, '2026-13-20T00:00:00Z')],
    [
      'invalid calendar day',
      () => service.list(undefined, '2026-02-30T00:00:00Z'),
    ],
    [
      'reversed dates',
      () =>
        service.list(undefined, '2026-10-21T00:00:00Z', '2026-10-20T00:00:00Z'),
    ],
    [
      'unbounded limit',
      () => service.list(undefined, undefined, undefined, '101'),
    ],
    [
      'unbounded offset',
      () => service.list(undefined, undefined, undefined, undefined, '10001'),
    ],
    [
      'SQL-like limit',
      () =>
        service.list(
          undefined,
          undefined,
          undefined,
          '1; DROP TABLE admin_audit',
        ),
    ],
  ])('rejects %s', async (_label, run) => {
    await expect(run()).rejects.toBeInstanceOf(BadRequestException);
    expect(dataSource.query).not.toHaveBeenCalled();
  });
});
