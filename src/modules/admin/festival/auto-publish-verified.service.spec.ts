import { AutoPublishVerifiedService } from './auto-publish-verified.service';

describe('AutoPublishVerifiedService', () => {
  const festival = {
    id: 'fst_0123456789abcdef',
    name: '검증된 축제',
    firstDate: '2026-11-20',
  };
  const detail = {
    ...festival,
    venue: '공연장',
    firstDate: '2026-11-20',
    lastDate: '2026-11-20',
    sourceUrl: 'https://mintpaper.co.kr/festivals/178',
    ticketLinks: [],
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
  const services: AutoPublishVerifiedService[] = [];
  function fixture(
    value: unknown = detail,
    url = 'https://festicore-dev.up.railway.app',
    flag?: string,
    inferEndTimesFlag?: string,
    candidate = festival,
  ) {
    const publicFestivals = {
      crawlCandidates: jest.fn().mockResolvedValue([candidate]),
      crawlDetail: jest.fn().mockResolvedValue(value),
    };
    const adminFestivals = {
      publishCrawled: jest
        .fn()
        .mockResolvedValue({ packVersion: 1, changed: true }),
    };
    const config = {
      get: jest.fn((key: string) => {
        if (key === 'PUBLIC_URL') return url;
        if (key === 'AUTO_PUBLISH_INFER_END_TIMES') return inferEndTimesFlag;
        return flag;
      }),
    };
    const service = new AutoPublishVerifiedService(
      publicFestivals as never,
      adminFestivals as never,
      config as never,
    );
    services.push(service);
    return { service, publicFestivals, adminFestivals };
  }
  afterEach(() => {
    services.splice(0).forEach((s) => s.onModuleDestroy());
    jest.useRealTimers();
  });

  it('publishes the complete verified timetable atomically', async () => {
    const { service, adminFestivals } = fixture();
    await service.tick();
    expect(adminFestivals.publishCrawled).toHaveBeenCalledWith(
      detail,
      expect.objectContaining({
        sets: [expect.objectContaining({ artist: '밴드' })],
      }),
    );
  });
  it('publishes date-only metadata when no approved timetable exists', async () => {
    const value = { ...detail, timetable: [] };
    const { service, adminFestivals } = fixture(value);
    await service.tick();
    expect(adminFestivals.publishCrawled).toHaveBeenCalledWith(value, null);
  });
  it.each([
    ['incomplete days', { ...detail, lastDate: '2026-11-21' }],
    [
      'unknown end',
      { ...detail, timetable: [{ ...detail.timetable[0], endsAt: null }] },
    ],
  ])(
    'holds %s for correction instead of publishing date-only',
    async (_label, value) => {
      const { service, adminFestivals } = fixture(value);
      await service.tick();
      expect(adminFestivals.publishCrawled).not.toHaveBeenCalled();
    },
  );
  it('infers missing ends only for the opted-in development festival IDs', async () => {
    const target = { ...festival, id: 'fst_00e0f4f1d8065a93' };
    const value = {
      ...detail,
      timetable: [
        { ...detail.timetable[0], endsAt: null },
        {
          artist: '다음 밴드',
          date: '2026-11-20',
          stageName: '메인',
          startsAt: '2026-11-20T14:00:00+09:00',
          endsAt: '2026-11-20T15:00:00+09:00',
        },
      ],
    };
    const { service, adminFestivals } = fixture(
      value,
      'https://festicore-dev.up.railway.app',
      undefined,
      'true',
      target,
    );

    await service.tick();

    const publishedCall = adminFestivals.publishCrawled.mock
      .calls[0] as unknown as [unknown, { sets: Array<{ endsAt: string }> }];
    const timetable = publishedCall[1];
    expect(timetable).toEqual(
      expect.objectContaining({
        sets: [
          expect.objectContaining({ endsAt: '2026-11-20T14:00:00+09:00' }),
          expect.objectContaining({ endsAt: '2026-11-20T15:00:00+09:00' }),
        ],
      }),
    );
  });
  it.each([
    ['missing opt-in', undefined, { ...festival, id: 'fst_00e0f4f1d8065a93' }],
    ['non-target festival', 'true', festival],
    ['non-exact opt-in', 'TRUE', { ...festival, id: 'fst_00e0f4f1d8065a93' }],
  ])(
    'continues to hold missing ends with %s',
    async (_label, inferFlag, candidate) => {
      const value = {
        ...detail,
        timetable: [{ ...detail.timetable[0], endsAt: null }],
      };
      const { service, adminFestivals } = fixture(
        value,
        'https://festicore-dev.up.railway.app',
        undefined,
        inferFlag,
        candidate,
      );

      await service.tick();

      expect(adminFestivals.publishCrawled).not.toHaveBeenCalled();
    },
  );
  it.each([
    [
      'no later set on the same stage',
      [{ ...detail.timetable[0], endsAt: null }],
    ],
    [
      'later set on another stage',
      [
        { ...detail.timetable[0], endsAt: null },
        {
          artist: '다음 밴드',
          date: '2026-11-20',
          stageName: '다른 무대',
          startsAt: '2026-11-20T14:00:00+09:00',
          endsAt: '2026-11-20T15:00:00+09:00',
        },
      ],
    ],
  ])('holds inference with %s', async (_label, timetable) => {
    const target = { ...festival, id: 'fst_00e0f4f1d8065a93' };
    const value = { ...detail, timetable };
    const { service, adminFestivals } = fixture(
      value,
      'https://festicore-dev.up.railway.app',
      undefined,
      'true',
      target,
    );

    await service.tick();

    expect(adminFestivals.publishCrawled).not.toHaveBeenCalled();
  });
  it('never infers missing ends in production even when both flags are true', async () => {
    const target = { ...festival, id: 'fst_00e0f4f1d8065a93' };
    const value = {
      ...detail,
      timetable: [{ ...detail.timetable[0], endsAt: null }],
    };
    const { service, adminFestivals } = fixture(
      value,
      'https://festicore.up.railway.app',
      'true',
      'true',
      target,
    );

    await service.tick();

    expect(adminFestivals.publishCrawled).not.toHaveBeenCalled();
  });
  it('does not reject every stable ID just because names match', async () => {
    const { service, publicFestivals, adminFestivals } = fixture();
    publicFestivals.crawlCandidates.mockResolvedValue([
      festival,
      { ...festival, id: 'fst_fedcba9876543210' },
    ]);
    await service.tick();
    expect(
      (publicFestivals.crawlDetail.mock.calls as unknown as [string][]).map(
        (c) => c[0],
      ),
    ).toEqual([festival.id, 'fst_fedcba9876543210']);
    expect(adminFestivals.publishCrawled).toHaveBeenCalledTimes(2);
  });
  it('reconciles existing published festivals through the source detail', async () => {
    const { service, adminFestivals } = fixture({ ...detail, packVersion: 4 });
    await service.tick();
    expect(adminFestivals.publishCrawled).toHaveBeenCalledTimes(1);
  });
  it('retries a failed publish next pass and continues other festivals', async () => {
    const { service, publicFestivals, adminFestivals } = fixture();
    publicFestivals.crawlCandidates.mockResolvedValue([
      festival,
      { ...festival, id: 'fst_other' },
    ]);
    adminFestivals.publishCrawled.mockRejectedValueOnce(
      new Error('temporary failure'),
    );
    await service.tick();
    await service.tick();
    expect(adminFestivals.publishCrawled).toHaveBeenCalledTimes(4);
  });
  it.each([
    'https://festicore.up.railway.app',
    '',
    'http://festicore-dev.up.railway.app',
  ])('blocks all entrypoints for %s', async (url) => {
    jest.useFakeTimers();
    const { service, publicFestivals } = fixture(detail, url);
    service.onModuleInit();
    service.requestAfterCrawl();
    await service.tick();
    await jest.advanceTimersByTimeAsync(300_000);
    expect(publicFestivals.crawlCandidates).not.toHaveBeenCalled();
  });
  it('honors the explicit stage emergency off switch', async () => {
    const { service, publicFestivals } = fixture(
      detail,
      'https://festicore-dev.up.railway.app',
      'false',
    );
    await service.tick();
    service.requestAfterCrawl();
    expect(publicFestivals.crawlCandidates).not.toHaveBeenCalled();
  });
  it('keeps production disabled until AUTO_PUBLISH_PACKS is true', async () => {
    const { service, publicFestivals } = fixture(
      detail,
      'https://festicore.up.railway.app',
    );
    await service.tick();
    expect(publicFestivals.crawlCandidates).not.toHaveBeenCalled();
  });
  it('publishes only unpublished production candidates when enabled', async () => {
    const { service, publicFestivals, adminFestivals } = fixture(
      detail,
      'https://festicore.up.railway.app',
      'true',
    );
    publicFestivals.crawlCandidates.mockResolvedValue([
      festival,
      { ...festival, id: 'fst_fedcba9876543210', packVersion: 2 },
    ]);
    await service.tick();
    expect(adminFestivals.publishCrawled).toHaveBeenCalledTimes(1);
  });
  it('starts production reconciliation after five minutes and ignores crawl debounce', async () => {
    jest.useFakeTimers();
    const { service, publicFestivals } = fixture(
      detail,
      'https://festicore.up.railway.app',
      'true',
    );
    service.onModuleInit();
    service.requestAfterCrawl();
    await jest.advanceTimersByTimeAsync(1_000);
    expect(publicFestivals.crawlCandidates).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(299_000);
    expect(publicFestivals.crawlCandidates).toHaveBeenCalledTimes(1);
  });
  it('debounces sequential crawl successes and stops pending work on shutdown', async () => {
    jest.useFakeTimers();
    const { service, publicFestivals } = fixture();
    service.requestAfterCrawl();
    service.requestAfterCrawl();
    await jest.advanceTimersByTimeAsync(1_000);
    expect(publicFestivals.crawlCandidates).toHaveBeenCalledTimes(1);
    service.requestAfterCrawl();
    service.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(1_000);
    expect(publicFestivals.crawlCandidates).toHaveBeenCalledTimes(1);
  });
  it('schedules a trailing pass when a crawl finishes during a running pass', async () => {
    jest.useFakeTimers();
    const { service, publicFestivals } = fixture();
    let release!: (value: typeof detail) => void;
    publicFestivals.crawlDetail.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const first = service.tick();
    await Promise.resolve();
    service.requestAfterCrawl();
    expect(publicFestivals.crawlCandidates).toHaveBeenCalledTimes(1);
    release(detail);
    await first;
    await jest.advanceTimersByTimeAsync(1_000);
    expect(publicFestivals.crawlCandidates).toHaveBeenCalledTimes(2);
  });
});
