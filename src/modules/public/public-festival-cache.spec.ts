import { NotFoundException } from '@nestjs/common';
import { PublicFestivalService } from './public-festival.service';

describe('PublicFestivalService published cache', () => {
  const id = 'fst_12345678';
  const oldPack = { id, name: 'Old', packVersion: 1 };
  const newPack = { id, name: 'New', packVersion: 2 };

  function setup() {
    const values = new Map<string, object>();
    let generation = 0;
    const findOne = jest.fn().mockResolvedValue({
      published: oldPack,
      publishedVersion: 1,
    });
    const cache = {
      packGeneration: jest.fn(() => Promise.resolve(generation)),
      getPack: jest.fn((_id: string, gen: number) =>
        Promise.resolve(values.get(`${_id}:g${gen}`) ?? null),
      ),
      setPack: jest.fn((_id: string, gen: number, document: object) => {
        values.set(`${_id}:g${gen}`, document);
        return Promise.resolve();
      }),
      invalidatePack: jest.fn(() => {
        generation += 1;
        return Promise.resolve();
      }),
    };
    const service = new PublicFestivalService(
      { findOne } as never,
      {} as never,
      {} as never,
      cache as never,
    );
    return { service, cache, findOne };
  }

  it('serves a hit without querying the database', async () => {
    const { service, cache, findOne } = setup();
    await service.published(id);
    findOne.mockClear();
    await expect(service.published(id)).resolves.toMatchObject(oldPack);
    expect(findOne).not.toHaveBeenCalled();
    expect(cache.setPack).toHaveBeenCalledTimes(1);
  });

  it('does not cache unpublished festivals', async () => {
    const { service, cache, findOne } = setup();
    findOne.mockResolvedValue(null);
    await expect(service.published(id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(cache.setPack).not.toHaveBeenCalled();
  });

  it('an older reader cannot revive a pack after invalidation', async () => {
    const { service, cache, findOne } = setup();
    let finishRead!: (value: object) => void;
    findOne.mockImplementationOnce(
      () => new Promise((resolve) => (finishRead = resolve)),
    );
    const oldRead = service.published(id);
    await new Promise<void>((resolve) => setImmediate(resolve));
    await cache.invalidatePack();
    finishRead({ published: oldPack, publishedVersion: 1 });
    await oldRead;
    findOne.mockResolvedValue({ published: newPack, publishedVersion: 2 });
    await expect(service.published(id)).resolves.toMatchObject(newPack);
    expect(cache.getPack).toHaveBeenLastCalledWith(id, 1);
    expect(findOne).toHaveBeenCalledTimes(2);
  });
});
