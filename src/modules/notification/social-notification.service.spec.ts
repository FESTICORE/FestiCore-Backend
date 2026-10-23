import { SocialNotificationService } from './social-notification.service';

jest.mock('./apns.service', () => ({ ApnsService: class {} }));

describe('SocialNotificationService', () => {
  const crewId = 'crew_123';
  const actorUserId = '11111111-1111-4111-8111-111111111111';
  const leaseUntil = new Date('2026-11-20T03:02:00Z');
  const job = {
    id: '22222222-2222-4222-8222-222222222222',
    deviceId: '33333333-3333-4333-8333-333333333333',
    recipientUserId: '44444444-4444-4444-8444-444444444444',
    type: 'crew.gather' as const,
    subjectId: crewId,
    actorUserId,
    eventKey: 'crew.gather:gather_123',
    payload: {
      crewId,
      gatherId: 'gather_123',
      actorUserId,
      zoneId: 'zone_123',
    },
    createdAt: new Date('2026-11-20T02:59:00Z'),
    leaseUntil,
    attempts: 0,
  };

  function setup() {
    const query = jest
      .fn<Promise<unknown>, [string, unknown[]?]>()
      .mockResolvedValue([]);
    const sendSocialNotification = jest
      .fn()
      .mockResolvedValue({ accepted: true, permanent: false });
    const service = new SocialNotificationService(
      { query } as never,
      { sendSocialNotification, isConfigured: () => true } as never,
    );
    return { service, query, sendSocialNotification };
  }

  it('enqueues status in the caller transaction with opt-in, per-device merge, and a fixed first-event delay', async () => {
    const { service } = setup();
    const query = jest
      .fn<Promise<unknown>, [string, unknown[]?]>()
      .mockResolvedValue([]);
    await service.enqueueFlagStatus(
      { query } as never,
      {
        id: 'flag_123',
        visibility: 'public',
        hidden: false,
        status: 'active',
        zoneId: 'zone_123',
        activity: 'sing',
      } as never,
      actorUserId,
    );
    expect(query).toHaveBeenCalledTimes(5);
    expect(query.mock.calls[0][0]).toContain('pg_advisory_xact_lock');
    expect(query.mock.calls[1][0]).toContain('ACTOR_CHANGED');
    expect(query.mock.calls[2][0]).toContain('SUPERSEDED');
    expect(query.mock.calls[3][0]).toContain('SET "payload" = $4::jsonb');
    expect(query.mock.calls[4][0]).toContain('u."pushOptIn" = true');
    expect(query.mock.calls[4][0]).toContain('now() + ($5 * interval');
    expect(query.mock.calls[4][1]?.[4]).toBe(5);
  });

  it('excludes resting flags and cancels pending status jobs', async () => {
    const { service } = setup();
    const query = jest
      .fn<Promise<unknown>, [string, unknown[]?]>()
      .mockResolvedValue([]);
    await service.enqueueFlagStatus(
      { query } as never,
      {
        id: 'flag_123',
        visibility: 'public',
        hidden: false,
        status: 'resting',
      } as never,
      actorUserId,
    );
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain('FLAG_RESTING');
  });

  it('uses a one-minute crew status window and excludes the actor', async () => {
    const { service } = setup();
    const query = jest
      .fn<Promise<unknown>, [string, unknown[]?]>()
      .mockResolvedValueOnce([
        { nickname: '요청자', zoneId: 'zone_123', state: 'here' },
      ])
      .mockResolvedValue([]);
    await service.enqueueCrewStatus(
      { query } as never,
      { id: crewId, archivedAt: null } as never,
      actorUserId,
    );
    expect(query.mock.calls[5][0]).toContain(
      'r."crewId" = $1 AND r."userId" <> $2',
    );
    expect(query.mock.calls[5][1]?.[4]).toBe(1);
    expect(JSON.parse(String(query.mock.calls[5][1]?.[3]))).toMatchObject({
      nickname: '요청자',
      state: 'here',
    });
  });

  it('enqueues gather immediately for other crew members without opt-in', async () => {
    const { service } = setup();
    const query = jest
      .fn<Promise<unknown>, [string, unknown[]?]>()
      .mockResolvedValueOnce([{ nickname: '요청자' }])
      .mockResolvedValue([]);
    await service.enqueueCrewGather(
      { query } as never,
      { id: crewId, archivedAt: null } as never,
      actorUserId,
      { id: 'gather_123', zoneId: 'zone_123' } as never,
    );
    expect(query.mock.calls[1][0]).toContain('now()');
    expect(query.mock.calls[1][0]).toContain('r."userId" <> $2');
    expect(query.mock.calls[1][0]).not.toContain('pushOptIn');
    expect(query.mock.calls[1][1]?.[2]).toBe('crew.gather:gather_123');
  });

  it('snapshots all current crew members for a dissolution notice', async () => {
    const { service } = setup();
    const query = jest
      .fn<Promise<unknown>, [string, unknown[]?]>()
      .mockResolvedValue([]);
    await service.enqueueCrewDissolved(
      { query } as never,
      { id: crewId } as never,
      actorUserId,
    );
    expect(query.mock.calls[0][0]).toContain('CREW_DISSOLVED');
    expect(query.mock.calls[1][0]).toContain('FROM "crew_members" r');
    expect(query.mock.calls[1][0]).toContain('r."crewId" = $1');
    expect(query.mock.calls[1][0]).not.toContain('r."userId" <> $2');
    expect(query.mock.calls[1][0]).toContain('u."pushOptIn" = true');
    expect(query.mock.calls[1][1]?.[2]).toBe(`crew.status:dissolved:${crewId}`);
  });

  it('delivers a queued dissolution notice after the crew is deleted', async () => {
    const { service, query, sendSocialNotification } = setup();
    query.mockResolvedValueOnce([
      { apnsToken: 'aabb', apnsEnvironment: 'sandbox' },
    ]);
    const dissolved = {
      ...job,
      type: 'crew.status' as const,
      eventKey: `crew.status:dissolved:${crewId}`,
      payload: { crewId, dissolved: true },
    };
    await service.deliver(dissolved, new Date('2026-11-20T03:00:00Z'));
    expect(query.mock.calls[0][0]).toContain(
      'n."eventKey" = \'crew.status:dissolved:\' || n."subjectId"',
    );
    expect(sendSocialNotification).toHaveBeenCalledWith('aabb', 'sandbox', {
      type: 'crew.status',
      payload: dissolved.payload,
      eventKey: dissolved.eventKey,
    });
  });

  it('rechecks device account, membership and token before sending', async () => {
    const { service, query, sendSocialNotification } = setup();
    await service.deliver(job, new Date('2026-11-20T03:00:00Z'));
    expect(query.mock.calls[0][0]).toContain(
      'd."userId" = n."recipientUserId"',
    );
    expect(query.mock.calls[0][0]).toContain('"crew_members"');
    expect(sendSocialNotification).not.toHaveBeenCalled();
    expect(query.mock.calls[1][1]).toEqual([
      job.id,
      leaseUntil,
      'cancelled',
      'TARGET_UNAVAILABLE',
    ]);
  });

  it('clears only the rejected token and fails a permanent APNs rejection', async () => {
    const { service, query, sendSocialNotification } = setup();
    query.mockResolvedValueOnce([
      { apnsToken: 'aabb', apnsEnvironment: 'sandbox' },
    ]);
    sendSocialNotification.mockResolvedValueOnce({
      accepted: false,
      permanent: true,
      reason: 'Unregistered',
    });
    await service.deliver(job, new Date('2026-11-20T03:00:00Z'));
    expect(query.mock.calls[1][0]).toContain(
      '"apnsToken" = $2 AND "apnsEnvironment" = $3',
    );
    expect(query.mock.calls[1][1]).toEqual([job.deviceId, 'aabb', 'sandbox']);
    expect(query.mock.calls[2][1]).toEqual([
      job.id,
      leaseUntil,
      'failed',
      'Unregistered',
    ]);
  });

  it('bounds transient APNs retries', async () => {
    const { service, query, sendSocialNotification } = setup();
    query.mockResolvedValueOnce([
      { apnsToken: 'aabb', apnsEnvironment: 'sandbox' },
    ]);
    sendSocialNotification.mockRejectedValueOnce(new Error('timeout'));
    await service.deliver(
      { ...job, attempts: 5 },
      new Date('2026-11-20T03:00:00Z'),
    );
    expect(query.mock.calls[1][1]).toEqual([
      job.id,
      leaseUntil,
      'failed',
      'APNS_ERROR',
    ]);
  });
});
