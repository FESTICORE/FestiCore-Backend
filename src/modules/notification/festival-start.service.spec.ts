import { FestivalStartService } from './festival-start.service';

jest.mock('./apns.service', () => ({ ApnsService: class {} }));

describe('FestivalStartService', () => {
  const festivalId = 'fst_12345678';
  const deviceId = '11111111-1111-4111-8111-111111111111';
  const scheduledAt = new Date('2026-11-20T03:00:00.000Z');
  const leaseUntil = new Date('2026-11-20T03:02:00.000Z');
  const job = {
    id: '22222222-2222-4222-8222-222222222222',
    deviceId,
    festivalId,
    eventKey: `festival-start:${festivalId}:2026-11-20`,
    scheduledAt,
    leaseUntil,
    attempts: 0,
  };

  function setup() {
    const query = jest.fn<Promise<unknown>, [string, unknown[]?]>();
    const sendStartNotification = jest.fn();
    const isConfigured = jest.fn().mockReturnValue(true);
    const service = new FestivalStartService(
      { query } as never,
      { sendStartNotification, isConfigured } as never,
    );
    return { service, query, sendStartNotification, isConfigured };
  }

  it('enqueues only upcoming published days for subscribed devices', async () => {
    const { service, query } = setup();
    query.mockResolvedValueOnce([
      {
        id: festivalId,
        name: '축제',
        days: [
          { date: '2026-11-19', startsAt: '2026-11-19T12:00:00+09:00' },
          { date: '2026-11-20', startsAt: '2026-11-20T12:00:00+09:00' },
        ],
      },
    ]);
    query.mockResolvedValueOnce([]);

    await service.schedulePublished(new Date('2026-11-20T02:59:00Z'));

    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][0]).toContain('"publishedVersion" > 0');
    expect(query.mock.calls[1][0]).toContain('s."festivalStarts" = true');
    expect(query.mock.calls[1][0]).toContain('ON CONFLICT');
    expect(query.mock.calls[1][1]).toEqual([
      festivalId,
      job.eventKey,
      scheduledAt,
    ]);
  });

  it('claims due jobs with SKIP LOCKED and a lease', async () => {
    const { service, query } = setup();
    query.mockResolvedValueOnce([job]);

    await expect(service.claim()).resolves.toEqual(job);
    expect(query.mock.calls[0][0]).toContain('FOR UPDATE SKIP LOCKED');
    expect(query.mock.calls[0][0]).toContain('"leaseUntil" <= now()');
    expect(query.mock.calls[0][0]).toContain("interval '2 minutes'");
  });

  it('APNs 설정이 없으면 예약만 유지하고 발송 작업을 선점하지 않는다', async () => {
    const { service, query, isConfigured, sendStartNotification } = setup();
    query.mockResolvedValueOnce([]);
    isConfigured.mockReturnValue(false);

    await service.tick(scheduledAt);

    expect(query).toHaveBeenCalledTimes(1);
    expect(sendStartNotification).not.toHaveBeenCalled();
  });

  it('한 주기에 100개의 시작 알림 작업을 처리한다', async () => {
    const { service } = setup();
    jest.spyOn(service, 'schedulePublished').mockResolvedValue();
    jest.spyOn(service, 'claim').mockResolvedValueOnce(job);
    const claim = jest.spyOn(service, 'claim');
    for (let i = 1; i < 100; i += 1) {
      claim.mockResolvedValueOnce({ ...job, id: `job-${i}` });
    }
    claim.mockResolvedValue(null);
    const deliver = jest.spyOn(service, 'deliver').mockResolvedValue();

    await service.tick(scheduledAt);

    expect(deliver).toHaveBeenCalledTimes(100);
  });

  it('한 작업 선점이 실패해도 나머지 선점 작업을 처리한다', async () => {
    const { service } = setup();
    jest.spyOn(service, 'schedulePublished').mockResolvedValue();
    const claim = jest.spyOn(service, 'claim');
    claim
      .mockResolvedValueOnce(job)
      .mockRejectedValueOnce(new Error('DB error'));
    claim.mockResolvedValue(null);
    const deliver = jest.spyOn(service, 'deliver').mockResolvedValue();

    await service.tick(scheduledAt);

    expect(deliver).toHaveBeenCalledWith(job, expect.any(Date));
  });

  it('APNs 5xx 재시도 시점인 시작 15분 후에도 알림을 발송한다', async () => {
    const { service, query, sendStartNotification } = setup();
    query.mockResolvedValueOnce([
      {
        apnsToken: 'token',
        apnsEnvironment: 'production',
        name: '축제',
        days: [{ date: '2026-11-20', startsAt: '2026-11-20T12:00:00+09:00' }],
      },
    ]);
    sendStartNotification.mockResolvedValueOnce({ accepted: true });
    query.mockResolvedValueOnce([]);

    await service.deliver(job, new Date(scheduledAt.getTime() + 16 * 60_000));

    expect(sendStartNotification).toHaveBeenCalledTimes(1);
  });

  it('rechecks subscription and published schedule before sending', async () => {
    const { service, query, sendStartNotification } = setup();
    query.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await service.deliver(job, scheduledAt);

    expect(sendStartNotification).not.toHaveBeenCalled();
    expect(query.mock.calls[0][0]).toContain('s."festivalStarts" = true');
    expect(query.mock.calls[1][1]).toEqual([
      job.id,
      leaseUntil,
      'cancelled',
      'TARGET_UNAVAILABLE',
    ]);
  });

  it('sends once and records the APNs acceptance', async () => {
    const { service, query, sendStartNotification } = setup();
    query.mockResolvedValueOnce([
      {
        apnsToken: 'token',
        apnsEnvironment: 'sandbox',
        name: '축제',
        days: [{ date: '2026-11-20', startsAt: '2026-11-20T12:00:00+09:00' }],
      },
    ]);
    sendStartNotification.mockResolvedValueOnce({ accepted: true });
    query.mockResolvedValueOnce([]);

    await service.deliver(job, scheduledAt);

    expect(sendStartNotification).toHaveBeenCalledWith('token', 'sandbox', {
      title: '축제 시작',
      body: '페스티벌이 시작됐어요.',
      eventKey: job.eventKey,
    });
    expect(query.mock.calls[1][1]).toEqual([job.id, leaseUntil, 'sent', null]);
  });

  it('retries temporary APNs failure with backoff', async () => {
    const { service, query, sendStartNotification } = setup();
    query.mockResolvedValueOnce([
      {
        apnsToken: 'token',
        apnsEnvironment: 'production',
        name: '축제',
        days: [{ date: '2026-11-20', startsAt: '2026-11-20T12:00:00+09:00' }],
      },
    ]);
    sendStartNotification.mockResolvedValueOnce({
      accepted: false,
      permanent: false,
      reason: 'TooManyRequests',
    });
    query.mockResolvedValueOnce([]);

    await service.deliver(job, scheduledAt);

    expect(query.mock.calls[1][0]).toContain('"nextAttemptAt"');
    expect(query.mock.calls[1][1]).toEqual([
      job.id,
      leaseUntil,
      2,
      'TooManyRequests',
      1,
    ]);
  });

  it('APNs 서버 오류는 최소 15분 후 재시도한다', async () => {
    const { service, query, sendStartNotification } = setup();
    query.mockResolvedValueOnce([
      {
        apnsToken: 'token',
        apnsEnvironment: 'production',
        name: '축제',
        days: [{ date: '2026-11-20', startsAt: '2026-11-20T12:00:00+09:00' }],
      },
    ]);
    sendStartNotification.mockResolvedValueOnce({
      accepted: false,
      permanent: false,
      reason: 'APNS_HTTP_503',
    });
    query.mockResolvedValueOnce([]);

    await service.deliver(job, scheduledAt);

    expect(query.mock.calls[1][1]).toEqual([
      job.id,
      leaseUntil,
      15,
      'APNS_HTTP_503',
      1,
    ]);
  });

  it('APNs 설정 오류는 재시도 횟수를 소모하지 않는다', async () => {
    const { service, query, sendStartNotification } = setup();
    query.mockResolvedValueOnce([
      {
        apnsToken: 'token',
        apnsEnvironment: 'sandbox',
        name: '축제',
        days: [{ date: '2026-11-20', startsAt: '2026-11-20T12:00:00+09:00' }],
      },
    ]);
    sendStartNotification.mockResolvedValueOnce({
      accepted: false,
      permanent: false,
      reason: 'APNS_CONFIGURATION_ERROR',
    });
    query.mockResolvedValueOnce([]);

    await service.deliver({ ...job, attempts: 5 }, scheduledAt);

    expect(query.mock.calls[1][1]).toEqual([
      job.id,
      leaseUntil,
      60,
      'APNS_CONFIGURATION_ERROR',
      0,
    ]);
  });

  it('does not retry APNs after acceptance when recording the result fails', async () => {
    const { service, query, sendStartNotification } = setup();
    query.mockResolvedValueOnce([
      {
        apnsToken: 'token',
        apnsEnvironment: 'sandbox',
        name: '축제',
        days: [{ date: '2026-11-20', startsAt: '2026-11-20T12:00:00+09:00' }],
      },
    ]);
    sendStartNotification.mockResolvedValueOnce({ accepted: true });
    query.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(service.deliver(job, scheduledAt)).rejects.toThrow(
      'database unavailable',
    );
    expect(sendStartNotification).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(2);
  });
});
