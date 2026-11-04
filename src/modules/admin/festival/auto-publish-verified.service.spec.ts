import { AutoPublishVerifiedService } from './auto-publish-verified.service';

describe('AutoPublishVerifiedService', () => {
  const festival = {
    id: 'fst_0123456789abcdef',
    name: '검증된 축제',
    status: 'discovered',
  };
  const detail = {
    ...festival,
    firstDate: '2026-11-20',
    lastDate: '2026-11-20',
    timetable: [
      {
        artist: '밴드',
        date: '2026-11-20',
        stageName: '메인',
        startsAt: '2026-11-20T13:00:00+09:00',
        endsAt: '2026-11-20T14:00:00+09:00',
      },
    ],
  };

  function fixture(value: unknown = detail) {
    const publicFestivals = {
      list: jest
        .fn()
        .mockResolvedValue({ items: [festival], nextCursor: null }),
      detail: jest.fn().mockResolvedValue(value),
    };
    const adminFestivals = {
      importDiscovered: jest.fn().mockResolvedValue({ draftVersion: 1 }),
      patch: jest.fn().mockResolvedValue({ draftVersion: 2 }),
      publish: jest.fn().mockResolvedValue({ packVersion: 1 }),
    };
    const service = new AutoPublishVerifiedService(
      publicFestivals as never,
      adminFestivals as never,
    );
    return { service, publicFestivals, adminFestivals };
  }

  it('publishes only a complete approved public timetable through the existing admin flow', async () => {
    const { service, adminFestivals } = fixture();
    await service.tick();
    expect(adminFestivals.importDiscovered).toHaveBeenCalledWith(
      festival.id,
      {},
      null,
    );
    expect(adminFestivals.patch).toHaveBeenCalledWith(
      festival.id,
      expect.objectContaining({
        days: [expect.objectContaining({ date: '2026-11-20' })],
        sets: [expect.objectContaining({ artist: '밴드' })],
      }),
      '"d1"',
      null,
    );
    expect(adminFestivals.publish).toHaveBeenCalledWith(
      festival.id,
      expect.any(String),
      '"d2"',
      null,
    );
  });

  it.each([
    ['missing timetable', { ...detail, timetable: [] }],
    ['incomplete days', { ...detail, lastDate: '2026-11-21' }],
    [
      'unverified end time',
      { ...detail, timetable: [{ ...detail.timetable[0], endsAt: null }] },
    ],
  ])('keeps %s unpublished', async (_label, value) => {
    const { service, adminFestivals } = fixture(value);
    await service.tick();
    expect(adminFestivals.importDiscovered).not.toHaveBeenCalled();
    expect(adminFestivals.publish).not.toHaveBeenCalled();
  });

  it('preserves an existing admin draft when import conflicts', async () => {
    const { service, adminFestivals } = fixture();
    adminFestivals.importDiscovered.mockRejectedValueOnce(
      new Error('already managed'),
    );
    await service.tick();
    expect(adminFestivals.patch).not.toHaveBeenCalled();
    expect(adminFestivals.publish).not.toHaveBeenCalled();
  });

  it('holds all discovered IDs for the same event until the catalog is deduplicated', async () => {
    const { service, publicFestivals, adminFestivals } = fixture();
    publicFestivals.list.mockResolvedValueOnce({
      items: [
        { ...festival, firstDate: '2026-11-20' },
        {
          ...festival,
          id: 'fst_fedcba9876543210',
          firstDate: '2026-11-20',
          venue: '다른 장소 표기',
        },
      ],
      nextCursor: null,
    });
    await service.tick();
    expect(publicFestivals.detail).not.toHaveBeenCalled();
    expect(adminFestivals.importDiscovered).not.toHaveBeenCalled();
  });

  it('does not start the background timer outside the explicit stage environment', () => {
    const { service, publicFestivals } = fixture();
    const previousFlag = process.env.AUTO_PUBLISH_VERIFIED_TIMETABLE;
    const previousUrl = process.env.PUBLIC_URL;
    process.env.AUTO_PUBLISH_VERIFIED_TIMETABLE = 'true';
    process.env.PUBLIC_URL = 'https://festicore.up.railway.app';
    try {
      service.onModuleInit();
      expect(publicFestivals.list).not.toHaveBeenCalled();
    } finally {
      service.onModuleDestroy();
      if (previousFlag === undefined)
        delete process.env.AUTO_PUBLISH_VERIFIED_TIMETABLE;
      else process.env.AUTO_PUBLISH_VERIFIED_TIMETABLE = previousFlag;
      if (previousUrl === undefined) delete process.env.PUBLIC_URL;
      else process.env.PUBLIC_URL = previousUrl;
    }
  });
});
