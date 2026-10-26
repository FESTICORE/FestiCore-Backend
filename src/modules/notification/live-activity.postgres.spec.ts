import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { LiveActivityDeliveries1792500064000 } from '../../database/migrations/1792500064000-live-activity-deliveries';
import { LiveActivityRefreshIntents1792500068000 } from '../../database/migrations/1792500068000-live-activity-refresh-intents';
import { LiveActivityService } from './live-activity.service';

const url = process.env.LIVE_ACTIVITY_PG_URL;
const describePostgres = url ? describe : describe.skip;

describePostgres('Live Activity refresh intents (PostgreSQL)', () => {
  const schema = `live_activity_test_${randomUUID().replaceAll('-', '_')}`;
  const deviceId = randomUUID();
  let admin: DataSource;
  let db: DataSource;
  let service: LiveActivityService;

  const row = async () => {
    const rows = await db.query<
      Array<{
        revision: string;
        active: boolean;
        status: string;
        lastAttemptAt: Date | null;
      }>
    >('SELECT * FROM "live_activity_deliveries" WHERE "deviceId" = $1', [
      deviceId,
    ]);
    return rows[0];
  };
  const intentCount = async () => {
    const rows = await db.query<Array<{ count: string }>>(
      'SELECT count(*) AS count FROM "live_activity_refresh_intents"',
    );
    return Number(rows[0].count);
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
    await db.query(`CREATE TABLE "devices" (
      "id" uuid PRIMARY KEY,
      "userId" uuid,
      "liveActivityFestivalId" varchar(32),
      "liveActivityId" varchar(128),
      "liveActivityPushToken" varchar(256)
    )`);
    await new LiveActivityDeliveries1792500064000().up(db.createQueryRunner());
    await new LiveActivityRefreshIntents1792500068000().up(
      db.createQueryRunner(),
    );
    service = new LiveActivityService(db, {
      isConfigured: () => false,
    } as never);
  });

  beforeEach(async () => {
    await db.query('TRUNCATE "devices" CASCADE');
    await db.query(
      `INSERT INTO "devices" ("id", "liveActivityFestivalId", "liveActivityId", "liveActivityPushToken")
       VALUES ($1, 'fst_one', 'activity-one', 'token-one')`,
      [deviceId],
    );
    await service.enqueueDevice(deviceId);
  });

  afterAll(async () => {
    if (db?.isInitialized) await db.destroy();
    if (admin?.isInitialized) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.destroy();
    }
  });

  it('commits a business refresh while APNs holds device and delivery locks', async () => {
    let unlock!: () => void;
    let locked!: () => void;
    const release = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const sending = db.transaction(async (manager) => {
      await manager.query(
        'SELECT "id" FROM "devices" WHERE "id" = $1 FOR NO KEY UPDATE',
        [deviceId],
      );
      await manager.query(
        'SELECT "deviceId" FROM "live_activity_deliveries" WHERE "deviceId" = $1 FOR UPDATE',
        [deviceId],
      );
      locked();
      await release;
    });
    await ready;
    const business = db.transaction((manager) =>
      service.enqueueFestival('fst_one', manager),
    );
    let timeout!: NodeJS.Timeout;
    try {
      await Promise.race([
        business,
        new Promise<never>(
          (_, reject) =>
            (timeout = setTimeout(
              () => reject(new Error('business mutation waited on APNs lock')),
              1500,
            )),
        ),
      ]);
      expect(await intentCount()).toBe(1);
      expect((await row())?.revision).toBe('1');
    } finally {
      clearTimeout(timeout);
      unlock();
      await sending;
      await business;
    }
    expect(await service.materializeRefreshIntent()).toBe(true);
    expect((await row())?.revision).toBe('2');
    expect(await intentCount()).toBe(0);
  });

  it('rolls back an intent with its business transaction', async () => {
    await expect(
      db.transaction(async (manager) => {
        await service.enqueueFestival('fst_one', manager);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await intentCount()).toBe(0);
    expect((await row())?.revision).toBe('1');
  });

  it('discards intents for stopped and replaced activities', async () => {
    await service.enqueueFestival('fst_one');
    await db.transaction(async (manager) => {
      await manager.query(
        'UPDATE "devices" SET "liveActivityFestivalId" = NULL, "liveActivityId" = NULL, "liveActivityPushToken" = NULL WHERE "id" = $1',
        [deviceId],
      );
      await service.stopDevice(deviceId, manager);
    });
    await service.materializeRefreshIntent();
    expect(await row()).toMatchObject({
      revision: '2',
      active: false,
      status: 'idle',
    });

    await db.query(
      `UPDATE "devices" SET "liveActivityFestivalId" = 'fst_one', "liveActivityId" = 'activity-two', "liveActivityPushToken" = 'token-two' WHERE "id" = $1`,
      [deviceId],
    );
    await service.enqueueDevice(deviceId);
    await service.enqueueFestival('fst_one');
    await db.query(
      `UPDATE "devices" SET "liveActivityId" = 'activity-three' WHERE "id" = $1`,
      [deviceId],
    );
    await service.materializeRefreshIntent();
    expect((await row())?.revision).toBe('3');
    expect(await intentCount()).toBe(0);
  });

  it('materializes concurrent intents exactly once and preserves lastAttemptAt', async () => {
    await db.query(
      `UPDATE "live_activity_deliveries" SET "lastAttemptAt" = '2026-10-25T00:00:00Z' WHERE "deviceId" = $1`,
      [deviceId],
    );
    await service.enqueueFestival('fst_one');
    await service.enqueueFestival('fst_one');
    expect(await intentCount()).toBe(2);
    await Promise.all([
      service.materializeRefreshIntent(),
      service.materializeRefreshIntent(),
    ]);
    expect((await row())?.revision).toBe('3');
    expect((await row())?.lastAttemptAt?.toISOString()).toBe(
      '2026-10-25T00:00:00.000Z',
    );
    expect(await intentCount()).toBe(0);
  });
});
