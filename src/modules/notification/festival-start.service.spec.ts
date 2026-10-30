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
    const sendPackUpdated = jest.fn();
    const sendReminderNotification = jest.fn();
    const sendLiveActivityStart = jest.fn();
    const isConfigured = jest.fn().mockReturnValue(true);
    const service = new FestivalStartService(
      { query } as never,
      {
        sendStartNotification,
        sendPackUpdated,
        sendReminderNotification,
        sendLiveActivityStart,
        isConfigured,
      } as never,
    );
    return {
      service,
      query,
      sendStartNotification,
      sendPackUpdated,
      sendReminderNotification,
      sendLiveActivityStart,
      isConfigured,
    };
  }

  it('schedules one D-1 18:00 KST reminder for the first published day and deduplicates by festival', async () => {
    const { service, query } = setup();
    query.mockResolvedValueOnce([
      {
        id: festivalId,
        days: [
          { date: '2026-11-21', startsAt: '2026-11-21T12:00:00+09:00' },
          { date: '2026-11-20', startsAt: '2026-11-20T12:00:00+09:00' },
        ],
      },
    ]);
    query.mockResolvedValue([]);

    await service.schedulePublished(new Date('2026-11-19T00:00:00Z'));

    expect(query).toHaveBeenCalledTimes(4);
    expect(query.mock.calls[1][0]).toContain(
      's."pinned" = true AND s."reminders" = true',
    );
    expect(query.mock.calls[1][0]).toContain(
      'ON CONFLICT ("deviceId", "eventKey")',
    );
    expect(query.mock.calls[1][0]).toContain(
      '"notification_deliveries"."status" = \'pending\'',
    );
    expect(query.mock.calls[1][0]).not.toContain(
      '"notification_deliveries"."status" = \'sent\'',
    );
    expect(query.mock.calls[1][1]).toEqual([
      festivalId,
      `festival-reminder:${festivalId}`,
      new Date('2026-11-19T09:00:00Z'),
    ]);
  });

  it('keeps D-1 18:00 KST across a year boundary', async () => {
    const { service, query } = setup();
    query
      .mockResolvedValueOnce([
        {
          id: festivalId,
          days: [{ date: '2027-01-01', startsAt: '2027-01-01T00:30:00+09:00' }],
        },
      ])
      .mockResolvedValue([]);
    await service.schedulePublished(new Date('2026-12-30T00:00:00Z'));
    expect(query.mock.calls[1][1]?.[2]).toEqual(
      new Date('2026-12-31T09:00:00Z'),
    );
  });

  it('rechecks pin and reminder opt-in before sending, then cancels an unsubscribed job', async () => {
    const { service, query, sendReminderNotification } = setup();
    query.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await service.deliver(
      { ...job, eventKey: `festival-reminder:${festivalId}` },
      scheduledAt,
    );
    expect(query.mock.calls[0][0]).toContain('s."reminders" = true');
    expect(query.mock.calls[0][0]).toContain('s."pinned" = true');
    expect(sendReminderNotification).not.toHaveBeenCalled();
    expect(query.mock.calls[1][1]).toEqual([
      job.id,
      leaseUntil,
      'cancelled',
      'TARGET_UNAVAILABLE',
    ]);
  });

  it.each([null, 2, 3])(
    'sends checklist reminder with pack version %s',
    async (packDownloadedVersion) => {
      const { service, query, sendReminderNotification } = setup();
      const reminderJob = {
        ...job,
        eventKey: `festival-reminder:${festivalId}`,
        scheduledAt: new Date('2026-11-19T09:00:00Z'),
      };
      query
        .mockResolvedValueOnce([
          {
            apnsToken: 'token',
            apnsEnvironment: 'production',
            name: '축제',
            days: [
              { date: '2026-11-20', startsAt: '2026-11-20T12:00:00+09:00' },
            ],
            checklist: [{ label: '티켓' }, { label: '보조배터리' }],
            publishedVersion: 3,
            packDownloadedVersion,
          },
        ])
        .mockResolvedValueOnce([]);
      sendReminderNotification.mockResolvedValueOnce({ accepted: true });

      await service.deliver(reminderJob, new Date('2026-11-19T09:01:00Z'));

      expect(sendReminderNotification).toHaveBeenCalledWith(
        'token',
        'production',
        expect.objectContaining({
          body: `준비물 확인했어요? 티켓, 보조배터리 챙기세요.${packDownloadedVersion === 3 ? '' : ' 지금 팩을 받아 두세요.'}`,
          hasPack: packDownloadedVersion === 3,
        }),
      );
    },
  );

  it('reschedules an unsent reminder when the first day changes', async () => {
    const { service, query, sendReminderNotification } = setup();
    query.mockResolvedValueOnce([
      {
        apnsToken: 'token',
        apnsEnvironment: 'sandbox',
        name: '축제',
        days: [{ date: '2026-11-21', startsAt: '2026-11-21T12:00:00+09:00' }],
        checklist: [],
        publishedVersion: 1,
        packDownloadedVersion: null,
      },
    ]);
    await service.deliver(
      {
        ...job,
        eventKey: `festival-reminder:${festivalId}`,
        scheduledAt: new Date('2026-11-19T09:00:00Z'),
      },
      new Date('2026-11-19T09:00:00Z'),
    );
    expect(sendReminderNotification).not.toHaveBeenCalled();
    expect(query.mock.calls[1][1]?.[2]).toEqual(
      new Date('2026-11-20T09:00:00Z'),
    );
  });

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
    expect(query.mock.calls[1][0]).toContain('s."pinned" = true');
    expect(query.mock.calls[1][0]).toContain('s."festivalStarts" = true');
    expect(query.mock.calls[1][0]).toContain('ON CONFLICT');
    expect(query.mock.calls[1][1]).toEqual([
      festivalId,
      job.eventKey,
      scheduledAt,
    ]);
  });

  it('schedules one remote start for the first eligible festival day only', async () => {
    const { service, query } = setup();
    query.mockResolvedValueOnce([
      {
        id: festivalId,
        name: '축제',
        days: [{ date: '2026-11-20', startsAt: '2026-11-20T12:00:00+09:00' }],
      },
    ]);
    query.mockResolvedValue([]);

    await service.schedulePublished(new Date('2026-11-20T02:59:00Z'));

    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls[2][0]).toContain(
      'd."liveActivityPushToStartToken" IS NOT NULL',
    );
    expect(query.mock.calls[2][0]).toContain('s."festivalStarts" = true');
    expect(query.mock.calls[2][0]).toContain('s."pinned" = true');
    expect(query.mock.calls[2][0]).not.toContain('"status" = \'sent\'');
    expect(query.mock.calls[2][1]).toEqual([
      festivalId,
      `live-activity-start:${festivalId}`,
      scheduledAt,
    ]);
  });

  it('claims due jobs with SKIP LOCKED and a lease', async () => {
    const { service, query } = setup();
    query.mockResolvedValueOnce([job]);

    await expect(service.claim()).resolves.toEqual(job);
    expect(query.mock.calls[0][0]).toContain('FOR UPDATE SKIP LOCKED');
    expect(query.mock.calls[0][0]).toContain('"leaseUntil" <= now()');
    expect(query.mock.calls[0][0]).toContain('"status" = \'pending\'');
    expect(query.mock.calls[0][0]).toContain('"status" = \'leased\'');
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
    expect(query.mock.calls[0][0]).toContain('s."pinned" = true');
    expect(query.mock.calls[0][0]).toContain('s."festivalStarts" = true');
    expect(query.mock.calls[1][1]).toEqual([
      job.id,
      leaseUntil,
      'cancelled',
      'TARGET_UNAVAILABLE',
    ]);
  });

  it('sends a silent pack update only for the current published version', async () => {
    const { service, query, sendPackUpdated } = setup();
    const update = { ...job, eventKey: `pack-updated:${festivalId}:3` };
    query.mockResolvedValueOnce([
      {
        apnsToken: 'token',
        apnsEnvironment: 'production',
        publishedVersion: 3,
      },
    ]);
    sendPackUpdated.mockResolvedValueOnce({ accepted: true });
    query.mockResolvedValueOnce([]);

    await service.deliver(update, scheduledAt);

    expect(query.mock.calls[0][0]).toContain('s."packUpdates" = true');
    expect(sendPackUpdated).toHaveBeenCalledWith(
      'token',
      'production',
      festivalId,
      3,
    );
    expect(query.mock.calls[1][1]).toEqual([job.id, leaseUntil, 'sent', null]);
  });

  it('cancels an outdated pack update before APNs delivery', async () => {
    const { service, query, sendPackUpdated } = setup();
    query.mockResolvedValueOnce([
      {
        apnsToken: 'token',
        apnsEnvironment: 'production',
        publishedVersion: 4,
      },
    ]);
    query.mockResolvedValueOnce([]);
    await service.deliver(
      { ...job, eventKey: `pack-updated:${festivalId}:3` },
      scheduledAt,
    );
    expect(sendPackUpdated).not.toHaveBeenCalled();
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

  const liveStartJob = {
    ...job,
    eventKey: `live-activity-start:${festivalId}`,
  };
  const liveStartTarget = {
    apnsToken: null,
    liveActivityPushToStartToken: 'ab'.repeat(32),
    liveActivityId: null,
    apnsEnvironment: 'sandbox',
    name: '공개 축제',
    days: [{ date: '2026-11-20', startsAt: '2026-11-20T12:00:00+09:00' }],
    published: {
      days: [{ date: '2026-11-20', startsAt: '2026-11-20T12:00:00+09:00' }],
      sets: [],
    },
  };

  it('uses only the push-to-start token after durable reservation', async () => {
    const { service, query, sendLiveActivityStart, sendStartNotification } =
      setup();
    query.mockResolvedValueOnce([liveStartTarget]);
    query.mockResolvedValueOnce([{ id: job.id }]);
    query.mockResolvedValueOnce([]);
    sendLiveActivityStart.mockResolvedValueOnce({
      accepted: true,
      permanent: false,
    });

    await service.deliver(liveStartJob, scheduledAt);

    expect(query.mock.calls[0][0]).toContain('s."festivalStarts" = true');
    expect(query.mock.calls[0][0]).toContain('s."pinned" = true');
    expect(query.mock.calls[0][0]).toContain('f."publishedVersion" > 0');
    expect(query.mock.calls[1][0]).toContain("'OUTCOME_UNKNOWN'");
    expect(sendLiveActivityStart).toHaveBeenCalledWith(
      liveStartTarget.liveActivityPushToStartToken,
      'sandbox',
      expect.objectContaining({ festivalId, festivalName: '공개 축제' }),
    );
    expect(sendStartNotification).not.toHaveBeenCalled();
    expect(query.mock.calls[2][1]).toEqual([job.id, 'sent', null]);
  });

  it('does not start an activity when the festival is unavailable or already active', async () => {
    const { service, query, sendLiveActivityStart } = setup();
    query.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await service.deliver(liveStartJob, scheduledAt);
    expect(sendLiveActivityStart).not.toHaveBeenCalled();
    expect(query.mock.calls[1][1]).toEqual([
      job.id,
      leaseUntil,
      'cancelled',
      'TARGET_UNAVAILABLE',
    ]);

    query.mockClear();
    query
      .mockResolvedValueOnce([
        {
          ...liveStartTarget,
          liveActivityId: 'already-running',
        },
      ])
      .mockResolvedValueOnce([]);
    await service.deliver(liveStartJob, scheduledAt);
    expect(sendLiveActivityStart).not.toHaveBeenCalled();
  });

  it('leaves ambiguous APNs outcomes terminal so a restart cannot create a duplicate activity', async () => {
    const { service, query, sendLiveActivityStart } = setup();
    query.mockResolvedValueOnce([liveStartTarget]);
    query.mockResolvedValueOnce([{ id: job.id }]);
    sendLiveActivityStart.mockResolvedValueOnce({
      accepted: false,
      permanent: false,
      reason: 'APNS_NETWORK_ERROR',
    });

    await service.deliver(liveStartJob, scheduledAt);

    expect(sendLiveActivityStart).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1][0]).toContain('"status" = \'failed\'');
    expect(query.mock.calls[1][0]).toContain("'OUTCOME_UNKNOWN'");
  });

  it('does not send when the durable reservation is lost', async () => {
    const { service, query, sendLiveActivityStart } = setup();
    query.mockResolvedValueOnce([liveStartTarget]);
    query.mockResolvedValueOnce([]);

    await service.deliver(liveStartJob, scheduledAt);

    expect(sendLiveActivityStart).not.toHaveBeenCalled();
  });

  it('does not replay an activity start after an ambiguous thrown APNs error', async () => {
    const { service, query, sendLiveActivityStart } = setup();
    query.mockResolvedValueOnce([liveStartTarget]);
    query.mockResolvedValueOnce([{ id: job.id }]);
    sendLiveActivityStart.mockRejectedValueOnce(new Error('timeout'));

    await service.deliver(liveStartJob, scheduledAt);

    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1][0]).toContain("'OUTCOME_UNKNOWN'");
  });

  it('retries a definite APNs rejection but clears only an invalid start token', async () => {
    const { service, query, sendLiveActivityStart } = setup();
    query.mockResolvedValueOnce([liveStartTarget]);
    query.mockResolvedValueOnce([{ id: job.id }]);
    query.mockResolvedValueOnce([]);
    sendLiveActivityStart.mockResolvedValueOnce({
      accepted: false,
      permanent: false,
      reason: 'APNS_HTTP_503',
    });
    await service.deliver(liveStartJob, scheduledAt);
    expect(query.mock.calls[2][0]).toContain('"status" = \'pending\'');
    expect(query.mock.calls[2][1]).toEqual([job.id, 15, 'APNS_HTTP_503']);

    query.mockClear();
    query.mockResolvedValueOnce([liveStartTarget]);
    query.mockResolvedValueOnce([{ id: job.id }]);
    query.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    sendLiveActivityStart.mockResolvedValueOnce({
      accepted: false,
      permanent: true,
      reason: 'BadDeviceToken',
    });
    await service.deliver(liveStartJob, scheduledAt);
    expect(query.mock.calls[2][0]).toContain(
      '"liveActivityPushToStartToken" = NULL',
    );
    expect(query.mock.calls[2][0]).not.toContain(
      '"liveActivityPushToken" = NULL',
    );
    expect(query.mock.calls[2][1]).toEqual([
      deviceId,
      liveStartTarget.liveActivityPushToStartToken,
    ]);
  });
});
