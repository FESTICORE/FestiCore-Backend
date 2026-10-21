import { ADMIN_ROLES_KEY } from '../auth/admin-roles.decorator';
import { AdminAuditController } from './admin-audit.controller';
import { AdminAuditService } from './admin-audit.service';
import type { Response } from 'express';

describe('AdminAuditController', () => {
  it('requires owner and forwards query filters', async () => {
    const audit = { list: jest.fn().mockResolvedValue({ items: [] }) };
    const controller = new AdminAuditController(
      audit as unknown as AdminAuditService,
    );
    // Nest stores method decorator metadata on the unbound handler.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(Reflect.getMetadata(ADMIN_ROLES_KEY, controller.list)).toEqual([
      'owner',
    ]);
    await expect(
      controller.list(
        { setHeader: jest.fn() } as unknown as Response,
        'admin-1',
        '2026-10-20T00:00:00Z',
        undefined,
        '10',
        '20',
      ),
    ).resolves.toEqual({ items: [] });
    expect(audit.list).toHaveBeenCalledWith(
      'admin-1',
      '2026-10-20T00:00:00Z',
      undefined,
      '10',
      '20',
    );
  });
});
