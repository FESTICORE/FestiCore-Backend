import { HttpException } from '@nestjs/common';
import { AdminFestivalService } from './admin-festival.service';

describe('AdminFestivalService optimistic edits', () => {
  it('lists festivals before the crawler proposal table exists', async () => {
    const query = jest.fn().mockResolvedValue([{ present: null }]);
    const service = new AdminFestivalService(
      {
        find: jest.fn().mockResolvedValue([
          {
            id: 'fst_12345678',
            draft: { name: 'Festival', venue: 'Seoul', days: [] },
            draftVersion: 1,
            publishedVersion: 0,
          },
        ]),
      } as never,
      {} as never,
      { query } as never,
    );

    await expect(service.list()).resolves.toMatchObject({
      items: [{ id: 'fst_12345678', openProposals: 0 }],
    });
    expect(query).toHaveBeenCalledTimes(1);
  });

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
