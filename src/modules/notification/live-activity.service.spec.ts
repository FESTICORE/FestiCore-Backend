import { LiveActivityService } from './live-activity.service';

const deviceId = 'aa9ad155-9145-46e7-9dd4-eb172dc522d1';
const job = {
  deviceId,
  revision: '3',
  leaseId: 'bb9ad155-9145-46e7-9dd4-eb172dc522d1',
  leaseUntil: new Date('2026-10-24T10:02:00Z'),
};

describe('LiveActivityService durable queue', () => {
  const query = jest.fn<Promise<unknown[]>, [string, unknown[]?]>();
  const manager = { query };
  const db = {
    manager,
    query,
    transaction: jest.fn(
      async (work: (entityManager: typeof manager) => Promise<void>) =>
        work(manager),
    ),
  };
  const apns = {
    isConfigured: jest.fn().mockReturnValue(true),
    sendLiveActivityUpdate: jest.fn(),
    sendLiveActivityEnd: jest.fn(),
  };
  const service = new LiveActivityService(db as never, apns as never);

  beforeEach(() => {
    jest.clearAllMocks();
    query.mockResolvedValue([]);
    apns.sendLiveActivityUpdate.mockResolvedValue({
      accepted: true,
      permanent: false,
    });
    apns.sendLiveActivityEnd.mockResolvedValue({
      accepted: true,
      permanent: false,
    });
  });

  it('records business refreshes without touching delivery rows', async () => {
    await service.enqueueDevice(deviceId);
    await service.enqueueUser('user-one', 'fst_one');
    await service.enqueueFestival('fst_one');
    expect(query.mock.calls[0][0]).toContain('"live_activity_deliveries"');
    for (const [sql] of query.mock.calls.slice(1) as Array<[string]>) {
      expect(sql).toContain('"live_activity_refresh_intents"');
      expect(sql).not.toContain('"live_activity_deliveries"');
    }
    expect(query.mock.calls[1][1]).toEqual(['user-one', 'fst_one']);
    expect(query.mock.calls[1][0]).toContain('ORDER BY "id"');
    expect(query.mock.calls[2][0]).toContain('ORDER BY "id"');
    expect(query.mock.calls[1][0]).toContain('FOR KEY SHARE SKIP LOCKED');
    expect(query.mock.calls[2][0]).toContain('FOR KEY SHARE SKIP LOCKED');
  });

  it('enqueues only active festival devices belonging to crew members', async () => {
    await service.enqueueCrewMembers('crew-1', 'fst_one');
    expect(query.mock.calls[0][0]).toContain(
      'JOIN "devices" d ON d."userId" = m."userId"',
    );
    expect(query.mock.calls[0][0]).toContain('d."liveActivityFestivalId" = $2');
    expect(query.mock.calls[0][0]).not.toContain('"lastAttemptAt" =');
    expect(query.mock.calls[0][0]).toContain('ORDER BY d."id"');
    expect(query.mock.calls[0][0]).toContain('FOR KEY SHARE OF d SKIP LOCKED');
    expect(query.mock.calls[0][1]).toEqual(['crew-1', 'fst_one']);
  });

  it('coalesces withdrawal impact into one ordered enqueue', async () => {
    await service.enqueueWithdrawalImpact(
      ['crew-1'],
      ['fst_one'],
      manager as never,
    );
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain('ORDER BY d."id"');
    expect(query.mock.calls[0][0]).toContain('m."crewId" = ANY($1::varchar[])');
    expect(query.mock.calls[0][1]).toEqual([['crew-1'], ['fst_one']]);
  });

  it('coalesces crew removal targets into one ordered enqueue', async () => {
    await service.enqueueCrewRemoval(
      'crew-1',
      'removed-user',
      'fst_one',
      manager as never,
    );
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain('ORDER BY d."id"');
    expect(query.mock.calls[0][0]).toContain('d."userId" = $2');
    expect(query.mock.calls[0][0]).toContain('m."crewId" = $1');
    expect(query.mock.calls[0][1]).toEqual([
      'crew-1',
      'removed-user',
      'fst_one',
    ]);
  });

  it('keeps the attempt clock when an activity stops', async () => {
    await service.stopDevice(deviceId);
    expect(query.mock.calls[0][0]).toContain('"active" = false');
    expect(query.mock.calls[0][0]).not.toContain('DELETE');
    expect(query.mock.calls[0][0]).not.toContain('"lastAttemptAt" =');
  });

  it('materializes a matching intent without resetting the attempt clock', async () => {
    query
      .mockResolvedValueOnce([{ id: '1', deviceId }])
      .mockResolvedValueOnce([
        {
          liveActivityId: 'one',
          liveActivityFestivalId: 'fst_one',
          liveActivityPushToken: 'token',
        },
      ])
      .mockResolvedValueOnce([
        { id: '1', deviceId, activityId: 'one', festivalId: 'fst_one' },
      ]);
    expect(await service.materializeRefreshIntent()).toBe(true);
    expect(query.mock.calls[1][0]).toContain('FOR NO KEY UPDATE');
    expect(query.mock.calls[2][0]).toContain('FOR UPDATE SKIP LOCKED');
    expect(query.mock.calls[3][0]).toContain(
      '"revision" = "live_activity_deliveries"."revision" + 1',
    );
    expect(query.mock.calls[3][0]).not.toContain('"lastAttemptAt" =');
    expect(query.mock.calls[4][0]).toContain(
      'DELETE FROM "live_activity_refresh_intents"',
    );
  });

  it('discards an intent for a stopped or replaced activity', async () => {
    query
      .mockResolvedValueOnce([{ id: '1', deviceId }])
      .mockResolvedValueOnce([
        {
          liveActivityId: 'new',
          liveActivityFestivalId: 'fst_one',
          liveActivityPushToken: 'token',
        },
      ])
      .mockResolvedValueOnce([
        { id: '1', deviceId, activityId: 'old', festivalId: 'fst_one' },
      ]);
    expect(await service.materializeRefreshIntent()).toBe(true);
    expect(query).toHaveBeenCalledTimes(4);
    expect(query.mock.calls[3][0]).toContain(
      'DELETE FROM "live_activity_refresh_intents"',
    );
  });

  it('claims with a lease and preserves a 90-second reservation for a 60-second attempt gap', async () => {
    query.mockResolvedValueOnce([job]);
    expect(await service.claim()).toEqual(job);
    const sql = query.mock.calls[0][0];
    expect(sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(sql).toContain('"lastAttemptAt" <= now() - interval \'90 seconds\'');
    expect(sql).toContain('"status" = \'leased\' AND "leaseUntil" <= now()');
    expect(sql).toContain('"lastAttemptAt" = now()');
  });

  it('ignores a stale revision or lease before sending a token', async () => {
    await service.deliver(job);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1][1]).toEqual([
      deviceId,
      job.revision,
      job.leaseId,
    ]);
    expect(apns.sendLiveActivityUpdate).not.toHaveBeenCalled();
  });

  it('requeues without an APNs attempt when the database reservation window expired', async () => {
    query
      .mockResolvedValueOnce([
        {
          userId: null,
          liveActivityFestivalId: 'fst_one',
          liveActivityId: 'activity-one',
          liveActivityPushToken: 'a'.repeat(64),
          apnsEnvironment: 'sandbox',
        },
      ])
      .mockResolvedValueOnce([{ revision: job.revision }])
      .mockResolvedValueOnce([
        {
          published: {
            flagsEnabled: false,
            days: [{ date: '2026-10-24' }],
            sets: [],
          },
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ canSend: false }]);
    await service.deliver(job);
    expect(apns.sendLiveActivityUpdate).not.toHaveBeenCalled();
    expect(query.mock.calls[4][0]).toContain('clock_timestamp()');
    expect(query.mock.calls.at(-1)?.[0]).toContain('"status" = \'pending\'');
  });

  it('recovers a failed delivery and continues with the next claimed device', async () => {
    const materialize = jest
      .spyOn(service, 'materializeRefreshIntent')
      .mockResolvedValue(false);
    const second = { ...job, deviceId: 'cc9ad155-9145-46e7-9dd4-eb172dc522d1' };
    const claim = jest
      .spyOn(service, 'claim')
      .mockResolvedValueOnce(job)
      .mockResolvedValueOnce(second)
      .mockResolvedValueOnce(null);
    const deliver = jest
      .spyOn(service, 'deliver')
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValueOnce(undefined);
    await service.tick();
    expect(deliver).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][0]).toContain(
      '"lastErrorCode" = \'DELIVERY_ERROR\'',
    );
    expect(query.mock.calls[0][1]).toEqual([
      deviceId,
      job.revision,
      job.leaseId,
      6,
    ]);
    claim.mockRestore();
    deliver.mockRestore();
    materialize.mockRestore();
  });

  it('sends anonymous devices only public content and schedules the next set boundary', async () => {
    query
      .mockResolvedValueOnce([
        {
          userId: null,
          liveActivityFestivalId: 'fst_one',
          liveActivityId: 'activity-one',
          liveActivityPushToken: 'a'.repeat(64),
          apnsEnvironment: 'sandbox',
        },
      ])
      .mockResolvedValueOnce([{ revision: job.revision }])
      .mockResolvedValueOnce([
        {
          published: {
            flagsEnabled: true,
            days: [{ date: '2099-01-01' }],
            sets: [
              {
                id: 'set_one',
                stageId: 'stage_one',
                artist: 'Artist',
                startsAt: '2099-01-01T10:00:00Z',
                endsAt: '2099-01-01T11:00:00Z',
              },
            ],
          },
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ canSend: true }]);
    await service.deliver(job);
    expect(apns.sendLiveActivityUpdate).toHaveBeenCalledWith(
      'a'.repeat(64),
      'sandbox',
      expect.objectContaining({
        phase: 'upcoming',
        startDate: Date.parse('2098-12-31T15:00:00Z') / 1000 - 978307200,
        endDate: Date.parse('2099-01-01T15:00:00Z') / 1000 - 978307200,
        nextMine: null,
        pinnedFlag: null,
        crewSummary: null,
      }),
    );
    const finish = query.mock.calls.at(-1);
    expect(finish?.[1]?.[3]).toBe('pending');
    expect(finish?.[1]?.[5]).toEqual(new Date('2098-12-31T15:00:00Z'));
  });

  it('uses published calendar days even when no sets exist and schedules the phase boundary', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-19T14:59:59Z'));
    try {
      const prepare = () => {
        query.mockReset();
        query
          .mockResolvedValueOnce([
            {
              userId: null,
              liveActivityFestivalId: 'fst_one',
              liveActivityId: 'activity-one',
              liveActivityPushToken: 'a'.repeat(64),
              apnsEnvironment: 'sandbox',
            },
          ])
          .mockResolvedValueOnce([{ revision: job.revision }])
          .mockResolvedValueOnce([
            {
              published: {
                flagsEnabled: false,
                days: [{ date: '2026-11-20' }, { date: '2026-11-21' }],
                sets: [],
              },
            },
          ])
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([{ canSend: true }]);
      };
      prepare();
      await service.deliver(job);
      const firstState = apns.sendLiveActivityUpdate.mock.calls[0] as [
        string,
        string,
        Record<string, unknown>,
      ];
      expect(firstState[2]).toMatchObject({
        phase: 'upcoming',
        startDate: Date.parse('2026-11-19T15:00:00Z') / 1000 - 978307200,
        endDate: Date.parse('2026-11-21T15:00:00Z') / 1000 - 978307200,
        nowStages: [],
        nextMine: null,
      });
      expect(query.mock.calls.at(-1)?.[1]?.[5]).toEqual(
        new Date('2026-11-19T15:00:00Z'),
      );
      jest.setSystemTime(new Date('2026-11-19T15:00:00Z'));
      prepare();
      await service.deliver(job);
      const secondState = apns.sendLiveActivityUpdate.mock.calls[1] as [
        string,
        string,
        Record<string, unknown>,
      ];
      expect(secondState[2]).toMatchObject({
        phase: 'ongoing',
      });
      expect(query.mock.calls.at(-1)?.[1]?.[5]).toEqual(
        new Date('2026-11-21T15:00:00Z'),
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps an overnight final-day performance ongoing until the published day ends', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-21T15:30:00Z'));
    try {
      const published = {
        flagsEnabled: false,
        days: [
          {
            date: '2026-11-21',
            startsAt: '2026-11-21T09:00:00+09:00',
            endsAt: '2026-11-22T02:00:00+09:00',
          },
        ],
        sets: [
          {
            id: 'set-overnight',
            stage: 'Main',
            startsAt: '2026-11-22T00:00:00+09:00',
            endsAt: '2026-11-22T01:00:00+09:00',
          },
        ],
      };
      const prepare = () => {
        query.mockReset();
        query
          .mockResolvedValueOnce([
            {
              userId: null,
              liveActivityFestivalId: 'fst_one',
              liveActivityId: 'activity-one',
              liveActivityPushToken: 'a'.repeat(64),
              apnsEnvironment: 'sandbox',
            },
          ])
          .mockResolvedValueOnce([{ revision: job.revision }])
          .mockResolvedValueOnce([{ published }])
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([{ canSend: true }]);
      };

      prepare();

      await service.deliver(job);

      const state = apns.sendLiveActivityUpdate.mock.calls[0] as [
        string,
        string,
        Record<string, unknown>,
      ];
      expect(state[2]).toMatchObject({
        phase: 'ongoing',
        endDate: Date.parse('2026-11-21T17:00:00Z') / 1000 - 978307200,
      });
      expect(query.mock.calls.at(-1)?.[1]?.[5]).toEqual(
        new Date('2026-11-21T16:00:00Z'),
      );

      jest.setSystemTime(new Date('2026-11-21T17:00:00Z'));
      prepare();
      await service.deliver(job);
      const finished = apns.sendLiveActivityEnd.mock.calls[0] as [
        string,
        string,
        Record<string, unknown>,
      ];
      expect(finished[2]).toMatchObject({ phase: 'finished', nowStages: [] });
      expect(apns.sendLiveActivityUpdate).toHaveBeenCalledTimes(1);
      const cleared = query.mock.calls.find(([sql]) =>
        sql.includes('SET "liveActivityPushToken" = NULL'),
      );
      expect(cleared?.[1]).toEqual([deviceId, 'a'.repeat(64), 'activity-one']);
      expect(query.mock.calls.at(-1)?.[1]?.[3]).toBe('idle');
    } finally {
      jest.useRealTimers();
    }
  });

  it('stops delivery for published content without valid calendar days', async () => {
    query
      .mockResolvedValueOnce([
        {
          userId: null,
          liveActivityFestivalId: 'fst_one',
          liveActivityId: 'activity-one',
          liveActivityPushToken: 'a'.repeat(64),
          apnsEnvironment: 'sandbox',
        },
      ])
      .mockResolvedValueOnce([{ revision: job.revision }])
      .mockResolvedValueOnce([
        { published: { flagsEnabled: false, sets: [] } },
      ]);
    await service.deliver(job);
    expect(apns.sendLiveActivityUpdate).not.toHaveBeenCalled();
    expect(query.mock.calls.at(-1)?.[1]?.slice(3, 5)).toEqual([
      'idle',
      'FESTIVAL_SCHEDULE_UNAVAILABLE',
    ]);
  });

  it('refreshes one hour before a published day ends without repeating a delayed boundary', async () => {
    const prepare = () => {
      query.mockReset();
      query
        .mockResolvedValueOnce([
          {
            userId: 'user-one',
            liveActivityFestivalId: 'fst_one',
            liveActivityId: 'activity-one',
            liveActivityPushToken: 'a'.repeat(64),
            apnsEnvironment: 'sandbox',
          },
        ])
        .mockResolvedValueOnce([{ revision: job.revision }])
        .mockResolvedValueOnce([
          {
            published: {
              flagsEnabled: true,
              days: [
                {
                  date: '2026-11-20',
                  startsAt: '2026-11-20T09:00:00+09:00',
                  endsAt: '2026-11-20T11:00:00+09:00',
                },
              ],
              sets: [
                {
                  id: 'set_current',
                  stageId: 'stage_one',
                  artist: 'Current',
                  startsAt: '2026-11-20T09:30:00+09:00',
                  endsAt: '2026-11-20T10:45:00+09:00',
                },
                {
                  id: 'set_future',
                  stageId: 'stage_two',
                  artist: 'Mine',
                  startsAt: '2026-11-20T10:30:00+09:00',
                  endsAt: '2026-11-20T11:00:00+09:00',
                },
              ],
            },
          },
        ])
        .mockResolvedValueOnce([
          {
            id: 'flag-one',
            festivalId: 'fst_one',
            status: 'active',
            visibility: 'public',
            hidden: false,
            zoneId: 'zone-one',
            activity: null,
          },
        ])
        .mockResolvedValueOnce([{ id: 'user-one' }])
        .mockResolvedValueOnce([{ setIds: ['set_future'] }])
        .mockResolvedValueOnce([{ flagId: 'flag-one' }])
        .mockResolvedValueOnce([{ flagId: 'flag-one' }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ canSend: true }]);
    };

    jest.useFakeTimers().setSystemTime(new Date('2026-11-20T00:45:00Z'));
    try {
      prepare();
      await service.deliver(job);
      expect(query.mock.calls.at(-1)?.[1]?.[5]).toEqual(
        new Date('2026-11-20T01:00:00Z'),
      );
      const [token, environment, sentState] = apns.sendLiveActivityUpdate.mock
        .calls[0] as [
        string,
        string,
        {
          nextMine: { setId: string } | null;
          pinnedFlag: { flagId: string } | null;
          leaveAt: null;
        },
      ];
      expect(token).toBe('a'.repeat(64));
      expect(environment).toBe('sandbox');
      expect(sentState.nextMine?.setId).toBe('set_future');
      expect(sentState.pinnedFlag?.flagId).toBe('flag-one');
      expect(sentState.leaveAt).toBeNull();

      // A worker delayed past the boundary still sends current personal state;
      // the next due time advances instead of replaying the one-hour trigger.
      jest.setSystemTime(new Date('2026-11-20T01:05:00Z'));
      prepare();
      await service.deliver(job);
      expect(query.mock.calls.at(-1)?.[1]?.[5]).toEqual(
        new Date('2026-11-20T01:30:00Z'),
      );
      expect(apns.sendLiveActivityUpdate).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps the end-minus-hour boundary for a published day shorter than one hour', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-19T23:55:00Z'));
    try {
      query
        .mockResolvedValueOnce([
          {
            userId: null,
            liveActivityFestivalId: 'fst_one',
            liveActivityId: 'activity-one',
            liveActivityPushToken: 'a'.repeat(64),
            apnsEnvironment: 'sandbox',
          },
        ])
        .mockResolvedValueOnce([{ revision: job.revision }])
        .mockResolvedValueOnce([
          {
            published: {
              flagsEnabled: false,
              days: [
                {
                  date: '2026-11-20',
                  startsAt: '2026-11-20T09:30:00+09:00',
                  endsAt: '2026-11-20T10:00:00+09:00',
                },
              ],
              sets: [],
            },
          },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ canSend: true }]);
      await service.deliver(job);
      expect(query.mock.calls.at(-1)?.[1]?.[5]).toEqual(
        new Date('2026-11-20T00:00:00Z'),
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('clears only the exact failed activity token on a permanent APNs rejection', async () => {
    query
      .mockResolvedValueOnce([
        {
          userId: null,
          liveActivityFestivalId: 'fst_one',
          liveActivityId: 'activity-one',
          liveActivityPushToken: 'a'.repeat(64),
          apnsEnvironment: 'sandbox',
        },
      ])
      .mockResolvedValueOnce([{ revision: job.revision }])
      .mockResolvedValueOnce([
        {
          published: {
            flagsEnabled: false,
            days: [{ date: '2026-11-24' }],
            sets: [],
          },
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ canSend: true }]);
    apns.sendLiveActivityUpdate.mockResolvedValueOnce({
      accepted: false,
      permanent: true,
      reason: 'Unregistered',
    });
    await service.deliver(job);
    const clear = query.mock.calls.find(([sql]) =>
      sql.includes('SET "liveActivityPushToken" = NULL'),
    );
    expect(clear?.[1]).toEqual([deviceId, 'a'.repeat(64), 'activity-one']);
    expect(query.mock.calls.at(-1)?.[1]?.[3]).toBe('failed');
  });
});
