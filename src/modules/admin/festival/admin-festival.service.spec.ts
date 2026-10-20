import { HttpException } from '@nestjs/common';
import { AdminFestivalService } from './admin-festival.service';

describe('AdminFestivalService optimistic edits', () => {
  const row = {
    id: 'fst_12345678',
    draft: { name: 'Current' },
    draftVersion: 2,
  };
  const save = jest.fn();
  const service = new AdminFestivalService(
    {} as never,
    {} as never,
    {
      transaction: async (callback: (manager: unknown) => Promise<unknown>) =>
        callback({
          getRepository: () => ({ findOne: () => Promise.resolve(row), save }),
        }),
    } as never,
  );

  beforeEach(() => save.mockClear());

  it('rejects stale If-Match with 412 and leaves the draft untouched', async () => {
    try {
      await service.patch(
        'fst_12345678',
        { name: 'Stale' },
        '"d1"',
        'adm_12345678',
      );
      throw new Error('expected conflict');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(412);
      expect((error as HttpException).getResponse()).toMatchObject({
        code: 'DRAFT_CONFLICT',
        draftVersion: 2,
      });
      expect(save).not.toHaveBeenCalled();
    }
  });

  it('requires the quoted draft ETag', async () => {
    await expect(
      service.patch('fst_12345678', { name: 'New' }, 'd2', null),
    ).rejects.toMatchObject({ status: 428 });
  });
});
