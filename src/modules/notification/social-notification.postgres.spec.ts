import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { SocialNotifications1792500042000 } from '../../database/migrations/1792500042000-social-notifications';
import { SocialNotificationService } from './social-notification.service';

jest.mock('./apns.service', () => ({ ApnsService: class {} }));

const url = process.env.LIVE_ACTIVITY_PG_URL;
const describePostgres = url ? describe : describe.skip;

describePostgres('SocialNotificationService 큐 (PostgreSQL)', () => {
  const schema = `social_notification_test_${randomUUID().replaceAll('-', '_')}`;
  const recipient = randomUUID();
  const actor = randomUUID();
  const device = randomUUID();
  const crewId = 'crw_0123456789abcdef';
  const flagId = 'flg_0123456789abcdef';
  const sendSocialNotification = jest.fn();
  let admin: DataSource;
  let db: DataSource;
  let service: SocialNotificationService;

  const enqueue = (type: 'flag.status' | 'crew.gather', subjectId: string) =>
    db.query(
      `INSERT INTO "social_notification_deliveries"
         ("deviceId", "recipientUserId", "type", "subjectId", "actorUserId",
          "eventKey", "payload", "nextAttemptAt")
       VALUES ($1, $2, $3::varchar, $4, $5,
         $3::varchar || ':' || gen_random_uuid()::text,
         $6::jsonb, now() - interval '1 second')`,
      [
        device,
        recipient,
        type,
        subjectId,
        actor,
        JSON.stringify(
          type === 'crew.gather'
            ? { crewId: subjectId, gatherId: 'gth_1', nickname: '요청자' }
            : { flagId: subjectId, status: 'moving' },
        ),
      ],
    );

  const job = async () => {
    const rows = await db.query<
      Array<{
        status: string;
        attempts: number;
        sentAt: Date | null;
        leaseUntil: Date | null;
        lastErrorCode: string | null;
      }>
    >(
      `SELECT "status", "attempts", "sentAt", "leaseUntil", "lastErrorCode"
       FROM "social_notification_deliveries"`,
    );
    return rows[0];
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
    await db.query(`CREATE TABLE "users" (
      "id" uuid PRIMARY KEY,
      "pushOptIn" boolean NOT NULL DEFAULT true
    )`);
    await db.query(`CREATE TABLE "devices" (
      "id" uuid PRIMARY KEY,
      "userId" uuid,
      "apnsToken" varchar(256),
      "apnsEnvironment" varchar(10),
      "notifyFlagStatus" boolean NOT NULL DEFAULT true,
      "notifyCrewStatus" boolean NOT NULL DEFAULT true,
      "notifyCrewGather" boolean NOT NULL DEFAULT true
    )`);
    await db.query(`CREATE TABLE "flags" (
      "id" varchar(32) PRIMARY KEY,
      "visibility" varchar(16) NOT NULL,
      "hidden" boolean NOT NULL,
      "status" varchar(16) NOT NULL
    )`);
    await db.query(`CREATE TABLE "flag_follows" (
      "flagId" varchar(32) NOT NULL,
      "userId" uuid NOT NULL
    )`);
    await db.query(`CREATE TABLE "crews" (
      "id" varchar(32) PRIMARY KEY,
      "archivedAt" timestamptz
    )`);
    await db.query(`CREATE TABLE "crew_members" (
      "crewId" varchar(32) NOT NULL,
      "userId" uuid NOT NULL
    )`);
    const runner = db.createQueryRunner();
    try {
      await new SocialNotifications1792500042000().up(runner);
    } finally {
      await runner.release();
    }
    await db.query('INSERT INTO "users" ("id") VALUES ($1), ($2)', [
      recipient,
      actor,
    ]);
    await db.query(
      `INSERT INTO "devices" ("id", "userId", "apnsToken", "apnsEnvironment")
       VALUES ($1, $2, 'aa', 'production')`,
      [device, recipient],
    );
    await db.query(
      `INSERT INTO "flags" VALUES ($1, 'public', false, 'moving')`,
      [flagId],
    );
    await db.query('INSERT INTO "flag_follows" VALUES ($1, $2)', [
      flagId,
      recipient,
    ]);
    await db.query('INSERT INTO "crews" ("id") VALUES ($1)', [crewId]);
    service = new SocialNotificationService(db, {
      isConfigured: () => true,
      sendSocialNotification,
    } as never);
  });

  beforeEach(async () => {
    sendSocialNotification.mockReset();
    await db.query('TRUNCATE "social_notification_deliveries", "crew_members"');
    await db.query('INSERT INTO "crew_members" VALUES ($1, $2)', [
      crewId,
      recipient,
    ]);
  });

  afterAll(async () => {
    if (db?.isInitialized) await db.destroy();
    if (admin?.isInitialized) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.destroy();
    }
  });

  it('claim은 리스를 잡은 작업 한 건을 행으로 돌려준다', async () => {
    await enqueue('crew.gather', crewId);

    const claimed = await service.claim();

    expect(claimed).toMatchObject({
      deviceId: device,
      recipientUserId: recipient,
      type: 'crew.gather',
      subjectId: crewId,
      attempts: 0,
    });
    expect(claimed?.leaseUntil).toBeInstanceOf(Date);
    expect(await service.claim()).toBeNull();
  });

  it.each([
    ['crew.gather', crewId],
    ['flag.status', flagId],
  ] as const)(
    '%s 작업을 선점해 발송하고 sent로 끝낸다',
    async (type, subjectId) => {
      await enqueue(type, subjectId);
      sendSocialNotification.mockResolvedValueOnce({
        accepted: true,
        permanent: false,
      });

      const claimed = await service.claim();
      await service.deliver(claimed!);

      expect(sendSocialNotification).toHaveBeenCalledWith(
        'aa',
        'production',
        expect.objectContaining({ type, eventKey: claimed!.eventKey }),
      );
      expect(await job()).toMatchObject({
        status: 'sent',
        attempts: 1,
        leaseUntil: null,
        lastErrorCode: null,
      });
      expect((await job()).sentAt).toBeInstanceOf(Date);
    },
  );

  it('크루를 떠난 회원 작업은 보내지 않고 취소로 끝낸다', async () => {
    await enqueue('crew.gather', crewId);
    await db.query('TRUNCATE "crew_members"');

    const claimed = await service.claim();
    await service.deliver(claimed!);

    expect(sendSocialNotification).not.toHaveBeenCalled();
    expect(await job()).toMatchObject({
      status: 'cancelled',
      sentAt: null,
      lastErrorCode: 'TARGET_UNAVAILABLE',
    });
  });

  it('일시적인 APNs 거절은 리스를 풀고 다시 시도하게 둔다', async () => {
    await enqueue('crew.gather', crewId);
    sendSocialNotification.mockResolvedValueOnce({
      accepted: false,
      permanent: false,
      reason: 'TooManyRequests',
    });

    const claimed = await service.claim();
    await service.deliver(claimed!);

    expect(await job()).toMatchObject({
      status: 'pending',
      attempts: 1,
      leaseUntil: null,
      lastErrorCode: 'TooManyRequests',
    });
  });
});
