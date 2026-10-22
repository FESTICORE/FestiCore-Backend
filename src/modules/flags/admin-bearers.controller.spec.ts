import { PATH_METADATA } from '@nestjs/common/constants';
import type { Response } from 'express';
import { ADMIN_ROLES_KEY } from '../admin/auth/admin-roles.decorator';
import { AdminFlagsController } from './flags.controller';
import { FlagsService } from './flags.service';

describe('AdminFlagsController bearers', () => {
  it('exposes the festival bearer route to viewer or higher roles', async () => {
    const adminBearers = jest.fn().mockResolvedValue({ items: [] });
    const controller = new AdminFlagsController({
      adminBearers,
    } as unknown as FlagsService);
    const setHeader = jest.fn();
    const response = { setHeader } as unknown as Response;
    const route = Object.getOwnPropertyDescriptor(
      AdminFlagsController.prototype,
      'bearers',
    )?.value as object;

    expect(Reflect.getMetadata(PATH_METADATA, AdminFlagsController)).toBe(
      'admin',
    );
    expect(Reflect.getMetadata(PATH_METADATA, route)).toBe(
      'festivals/:festivalId/bearers',
    );
    expect(Reflect.getMetadata(ADMIN_ROLES_KEY, route)).toEqual([
      'viewer',
      'editor',
      'owner',
    ]);
    await expect(controller.bearers('fst_1', response)).resolves.toEqual({
      items: [],
    });
    expect(adminBearers).toHaveBeenCalledWith('fst_1');
    expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });
});
