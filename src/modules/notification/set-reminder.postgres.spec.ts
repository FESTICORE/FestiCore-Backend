import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { UserSchedules1792500013000 } from '../../database/migrations/1792500013000-user-schedules';
import { FestivalNotifications1792500018000 } from '../../database/migrations/1792500018000-festival-notifications';
import { UserNotifications1792500095000 } from '../../database/migrations/1792500095000-user-notifications';
import { FestivalStartService } from './festival-start.service';

jest.mock('./apns.service', () => ({ ApnsService: class {} }));

const url = process.env.LIVE_ACTIVITY_PG_URL;
const describePostgres = url ? describe : describe.skip;

describePostgres('저장한 공연 2시간 전 알림 (PostgreSQL)', () => {
  const schema = `set_reminder_test_${randomUUID().replaceAll('-', '_')}`;
  const festivalId = 'fst_0123456789abcdef';
  const setId = 'set_a1b2c3d4';
  const laterSetId = 'set_b1b2c3d4';
  const member = randomUUID();
  const loggedOut = randomUUID();
  const device = randomUUID();
  const mutedDevice = randomUUID();
  const tokenlessDevice = randomUUID();
  const loggedOutDevice = randomUUID();
  const sendSetReminderNotification = jest.fn();
  let admin: DataSource;
  let db: DataSource;
  let service: FestivalStartService;
  let startsAt: Date;

  const jobs = () =>
    db.query<
      Array<{
        deviceId: string;
        eventKey: string;
        status: string;
        scheduledAt: Date;
        lastErrorCode: string | null;
      }>
    >(
      `SELECT "deviceId", "eventKey", "status", "scheduledAt", "lastErrorCode"
       FROM "notification_deliveries" WHERE starts_with("eventKey", 'set-reminder:')
       ORDER BY "eventKey", "deviceId"`,
    );

  const publish = async (sets: Array<{ id: string; startsAt: Date }>) => {
    await db.query(
      `UPDATE "admin_festivals" SET "published" = $2::jsonb WHERE "id" = $1`,
      [
        festivalId,
        JSON.stringify({
          name: '공개 축제',
          days: [],
          stages: [{ id: 'main', name: '메인 무대' }],
          sets: sets.map((set) => ({
            id: set.id,
            stageId: 'main',
            artist: '밴드',
            startsAt: set.startsAt.toISOString(),
          })),
        }),
      ],
    );
  };

  beforeAll(async () => {
    admin = new DataSource({ type: 'postgres', url, synchronize: false });
    await admin.initialize();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    db = new DataSource({
      type: 'postgres',
      url,
      synchronize: false,
      extra: { options: `-c search_path=${schema}` },
    });
    await db.initialize();
    await db.query('CREATE TABLE "users" ("id" uuid PRIMARY KEY)');
    await db.query(`CREATE TABLE "admin_festivals" (
      "id" varchar(32) PRIMARY KEY,
      "published" jsonb,
      "publishedVersion" integer NOT NULL DEFAULT 0
    )`);
    await db.query(`CREATE TABLE "devices" (
      "id" uuid PRIMARY KEY,
      "userId" uuid,
      "apnsToken" varchar(256),
      "notifySetReminders" boolean NOT NULL DEFAULT true,
      "liveActivityPushToStartToken" varchar(256),
      "liveActivityId" varchar(128),
      "liveActivityPushToken" varchar(256),
      "liveActivityRegisteredAt" timestamptz
    )`);
    await db.query(`CREATE TABLE "device_subscriptions" (
      "deviceId" uuid NOT NULL,
      "festivalId" varchar(32) NOT NULL
    )`);
    await db.query(`CREATE TABLE "refresh_tokens" (
      "userId" uuid NOT NULL,
      "revokedAt" timestamptz,
      "expiresAt" timestamptz NOT NULL
    )`);
    const runner = db.createQueryRunner();
    try {
      await new UserSchedules1792500013000().up(runner);
      await new FestivalNotifications1792500018000().up(runner);
      await new UserNotifications1792500095000().up(runner);
    } finally {
      await runner.release();
    }
    await db.query('INSERT INTO "users" ("id") VALUES ($1), ($2)', [
      member,
      loggedOut,
    ]);
    await db.query(
      `INSERT INTO "admin_festivals" ("id", "publishedVersion") VALUES ($1, 1)`,
      [festivalId],
    );
    await db.query(
      `INSERT INTO "devices" ("id", "userId", "apnsToken", "apnsEnvironment", "notifySetReminders")
       VALUES ($1, $5, 'aa', 'production', true),
              ($2, $5, 'bb', 'production', false),
              ($3, $5, NULL, 'production', true),
              ($4, $6, 'cc', 'production', true)`,
      [
        device,
        mutedDevice,
        tokenlessDevice,
        loggedOutDevice,
        member,
        loggedOut,
      ],
    );
    await db.query(
      `INSERT INTO "refresh_tokens" ("userId", "revokedAt", "expiresAt")
       VALUES ($1, NULL, now() + interval '30 days'),
              ($2, now(), now() + interval '30 days')`,
      [member, loggedOut],
    );
    service = new FestivalStartService(db, {
      isConfigured: () => true,
      sendSetReminderNotification,
    } as never);
  });

  beforeEach(async () => {
    sendSetReminderNotification.mockReset();
    await db.query(
      'TRUNCATE "notification_deliveries", "user_schedules", "user_notifications"',
    );
    startsAt = new Date(Date.now() + 3 * 60 * 60_000);
    await publish([
      { id: setId, startsAt },
      { id: laterSetId, startsAt: new Date(startsAt.getTime() + 60 * 60_000) },
    ]);
    await db.query(
      `INSERT INTO "user_schedules" ("userId", "festivalId", "setIds", "clientAt")
       VALUES ($1, $3, $4::jsonb, now()), ($2, $3, $4::jsonb, now())`,
      [member, loggedOut, festivalId, JSON.stringify([setId])],
    );
  });

  afterAll(async () => {
    if (db?.isInitialized) await db.destroy();
    if (admin?.isInitialized) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.destroy();
    }
  });

  it('알림을 켠 로그인 기기에만 저장한 공연 2시간 전 작업을 둔다', async () => {
    await service.schedulePublished();

    expect(await jobs()).toEqual([
      {
        deviceId: device,
        eventKey: `set-reminder:${festivalId}:${setId}`,
        status: 'pending',
        scheduledAt: new Date(startsAt.getTime() - 2 * 60 * 60_000),
        lastErrorCode: null,
      },
    ]);
  });

  it('배너가 겹쳐 건너뛴 작업은 다시 살리지 않고 다른 이유로 취소된 작업은 다시 예약한다', async () => {
    await service.schedulePublished();
    await db.query(
      `UPDATE "notification_deliveries" SET "status" = 'cancelled',
         "lastErrorCode" = 'LIVE_ACTIVITY_ALERTED'`,
    );
    await service.schedulePublished();
    expect((await jobs())[0].status).toBe('cancelled');

    await db.query(
      `UPDATE "notification_deliveries" SET "lastErrorCode" = 'TARGET_UNAVAILABLE'`,
    );
    await service.schedulePublished();
    expect((await jobs())[0].status).toBe('pending');
  });

  it('일정 저장 때 빠진 공연 작업은 취소하고 새 공연 작업을 그 회원 기기에 둔다', async () => {
    await service.schedulePublished();
    await db.transaction(async (manager) => {
      await manager.query(
        `UPDATE "user_schedules" SET "setIds" = $3::jsonb
         WHERE "userId" = $1 AND "festivalId" = $2`,
        [member, festivalId, JSON.stringify([laterSetId])],
      );
      const [festival] = await manager.query<
        Array<{ published: Record<string, unknown> }>
      >('SELECT "published" FROM "admin_festivals" WHERE "id" = $1', [
        festivalId,
      ]);
      await service.syncUserSchedule(
        member,
        festivalId,
        [laterSetId],
        festival.published,
        manager,
      );
    });

    expect(
      (await jobs()).map(({ eventKey, status, lastErrorCode }) => ({
        eventKey,
        status,
        lastErrorCode,
      })),
    ).toEqual([
      {
        eventKey: `set-reminder:${festivalId}:${setId}`,
        status: 'cancelled',
        lastErrorCode: 'SCHEDULE_CHANGED',
      },
      {
        eventKey: `set-reminder:${festivalId}:${laterSetId}`,
        status: 'pending',
        lastErrorCode: null,
      },
    ]);
  });

  it('선점한 작업을 발송하고 알림함에 한 번 기록한다', async () => {
    // 이미 2시간 안쪽에 들어온 공연이라 작업이 바로 선점된다.
    startsAt = new Date(Date.now() + 60 * 60_000);
    await publish([{ id: setId, startsAt }]);
    await service.schedulePublished();
    sendSetReminderNotification.mockResolvedValueOnce({
      accepted: true,
      permanent: false,
    });

    const job = await service.claim();
    expect(job?.eventKey).toBe(`set-reminder:${festivalId}:${setId}`);
    await service.deliver(job!, new Date());

    expect(sendSetReminderNotification).toHaveBeenCalledWith(
      'aa',
      'production',
      expect.objectContaining({
        body: '밴드 공연이 2시간 후 메인 무대에서 시작돼요.',
        deeplink: `festicore://festival/${festivalId}/set/${setId}`,
      }),
    );
    expect((await jobs())[0].status).toBe('sent');
    const inbox = await db.query<Array<{ type: string; dedupeKey: string }>>(
      'SELECT "type", "dedupeKey" FROM "user_notifications"',
    );
    expect(inbox).toEqual([
      {
        type: 'festival.set_reminder',
        dedupeKey: `set-reminder:${festivalId}:${setId}`,
      },
    ]);
  });

  it('같은 기기 같은 공연 push-to-start가 발송됐으면 알림 푸시를 건너뛴다', async () => {
    startsAt = new Date(Date.now() + 60 * 60_000);
    await publish([{ id: setId, startsAt }]);
    await service.schedulePublished();
    await db.query(
      `INSERT INTO "notification_deliveries"
         ("id", "deviceId", "festivalId", "eventKey", "scheduledAt", "nextAttemptAt", "status", "sentAt")
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $4, 'sent', now())`,
      [
        device,
        festivalId,
        `live-activity-performance:${festivalId}`,
        new Date(startsAt.getTime() - 2 * 60 * 60_000),
      ],
    );

    const job = await service.claim();
    await service.deliver(job!, new Date());

    expect(sendSetReminderNotification).not.toHaveBeenCalled();
    expect((await jobs())[0]).toMatchObject({
      status: 'cancelled',
      lastErrorCode: 'LIVE_ACTIVITY_ALERTED',
    });
  });

  it('발송 직전에 알림 설정이 꺼졌으면 취소한다', async () => {
    startsAt = new Date(Date.now() + 60 * 60_000);
    await publish([{ id: setId, startsAt }]);
    await service.schedulePublished();
    await db.query(
      'UPDATE "devices" SET "notifySetReminders" = false WHERE "id" = $1',
      [device],
    );
    try {
      const job = await service.claim();
      await service.deliver(job!, new Date());
    } finally {
      await db.query(
        'UPDATE "devices" SET "notifySetReminders" = true WHERE "id" = $1',
        [device],
      );
    }

    expect(sendSetReminderNotification).not.toHaveBeenCalled();
    expect((await jobs())[0]).toMatchObject({
      status: 'cancelled',
      lastErrorCode: 'TARGET_UNAVAILABLE',
    });
  });
});
