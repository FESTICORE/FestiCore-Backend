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
  };
  const service = new LiveActivityService(db as never, apns as never);

  beforeEach(() => {
    jest.clearAllMocks();
    query.mockResolvedValue([]);
    apns.sendLiveActivityUpdate.mockResolvedValue({
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
  });

  it('enqueues only active festival devices belonging to crew members', async () => {
    await service.enqueueCrewMembers('crew-1', 'fst_one');
    expect(query.mock.calls[0][0]).toContain(
      'JOIN "devices" d ON d."userId" = m."userId"',
    );
    expect(query.mock.calls[0][0]).toContain('d."liveActivityFestivalId" = $2');
    expect(query.mock.calls[0][0]).not.toContain('"lastAttemptAt" =');
    expect(query.mock.calls[0][0]).toContain('ORDER BY d."id"');
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
      .mockResolvedValueOnce([
        { id: '1', deviceId, activityId: 'one', festivalId: 'fst_one' },
      ])
      .mockResolvedValueOnce([
        {
          liveActivityId: 'one',
          liveActivityFestivalId: 'fst_one',
          liveActivityPushToken: 'token',
        },
      ]);
    expect(await service.materializeRefreshIntent()).toBe(true);
    expect(query.mock.calls[1][0]).toContain('FOR NO KEY UPDATE');
    expect(query.mock.calls[2][0]).toContain(
      '"revision" = "live_activity_deliveries"."revision" + 1',
    );
    expect(query.mock.calls[2][0]).not.toContain('"lastAttemptAt" =');
    expect(query.mock.calls[3][0]).toContain(
      'DELETE FROM "live_activity_refresh_intents"',
    );
  });

  it('discards an intent for a stopped or replaced activity', async () => {
    query
      .mockResolvedValueOnce([
        { id: '1', deviceId, activityId: 'old', festivalId: 'fst_one' },
      ])
      .mockResolvedValueOnce([
        {
          liveActivityId: 'new',
          liveActivityFestivalId: 'fst_one',
          liveActivityPushToken: 'token',
        },
      ]);
    expect(await service.materializeRefreshIntent()).toBe(true);
    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls[2][0]).toContain(
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
      .mockResolvedValueOnce([{ published: { flagsEnabled: false, sets: [] } }])
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
        nextMine: null,
        pinnedFlag: null,
        crewSummary: null,
      }),
    );
    const finish = query.mock.calls.at(-1);
    expect(finish?.[1]?.[3]).toBe('pending');
    expect(finish?.[1]?.[5]).toEqual(new Date('2099-01-01T10:00:00Z'));
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
      .mockResolvedValueOnce([{ published: { flagsEnabled: false, sets: [] } }])
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
