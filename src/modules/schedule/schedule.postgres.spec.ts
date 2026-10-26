import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { AdminFestival1792500002000 } from '../../database/migrations/1792500002000-admin-festival';
import { UserSchedules1792500013000 } from '../../database/migrations/1792500013000-user-schedules';
import { LiveActivityRefreshIntents1792500081000 } from '../../database/migrations/1792500081000-live-activity-refresh-intents';
import { AdminFestival } from '../admin/festival/festival.entity';
import { LiveActivityService } from '../notification/live-activity.service';
import { UserSchedule } from './schedule.entity';
import { ScheduleService } from './schedule.service';

const url = process.env.LIVE_ACTIVITY_PG_URL;
const describePostgres = url ? describe : describe.skip;

describePostgres(
  'ScheduleService Live Activity transaction (PostgreSQL)',
  () => {
    const schema = `schedule_activity_test_${randomUUID().replaceAll('-', '_')}`;
    const userId = randomUUID();
    const deviceId = randomUUID();
    const festivalId = 'fst_festival';
    const input = {
      setIds: ['set_a1b2c3d4'],
      clientAt: '2026-10-20T02:00:00Z',
    };
    let admin: DataSource;
    let db: DataSource;
    let service: ScheduleService;

    const count = async (
      table: 'user_schedules' | 'live_activity_refresh_intents',
    ) => {
      const rows = await db.query<Array<{ count: string }>>(
        `SELECT count(*) AS count FROM "${table}"`,
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
        entities: [AdminFestival, UserSchedule],
        synchronize: false,
        extra: { options: `-c search_path=${schema}` },
      });
      await db.initialize();
      await db.query('CREATE TABLE "users" ("id" uuid PRIMARY KEY)');
      await db.query(`CREATE TABLE "devices" (
      "id" uuid PRIMARY KEY,
      "userId" uuid NOT NULL REFERENCES "users"("id"),
      "liveActivityFestivalId" varchar(32),
      "liveActivityId" varchar(128),
      "liveActivityPushToken" varchar(256)
    )`);
      const runner = db.createQueryRunner();
      try {
        await new AdminFestival1792500002000().up(runner);
        await new UserSchedules1792500013000().up(runner);
        await new LiveActivityRefreshIntents1792500081000().up(runner);
      } finally {
        await runner.release();
      }
      await db.query('INSERT INTO "users" ("id") VALUES ($1)', [userId]);
      await db.query(
        `INSERT INTO "admin_festivals" ("id", "draft", "published", "publishedVersion")
       VALUES ($1, '{}'::jsonb, $2::jsonb, 1)`,
        [festivalId, JSON.stringify({ sets: [{ id: input.setIds[0] }] })],
      );
      await db.query(
        `INSERT INTO "devices" ("id", "userId", "liveActivityFestivalId", "liveActivityId", "liveActivityPushToken")
       VALUES ($1, $2, $3, 'activity-one', 'token-one')`,
        [deviceId, userId, festivalId],
      );
      const liveActivity = new LiveActivityService(db, {
        isConfigured: () => false,
      } as never);
      service = new ScheduleService(
        db.getRepository(UserSchedule),
        db.getRepository(AdminFestival),
        db,
        liveActivity,
      );
    });

    beforeEach(async () => {
      await db.query(
        'TRUNCATE "user_schedules", "live_activity_refresh_intents"',
      );
    });

    afterAll(async () => {
      if (db?.isInitialized) await db.destroy();
      if (admin?.isInitialized) {
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await admin.destroy();
      }
    });

    it('commits a changed schedule and one intent, without repeating either on replay', async () => {
      const first = await service.replace(userId, festivalId, input);
      expect(first.setIds).toEqual(input.setIds);
      expect(await count('user_schedules')).toBe(1);
      expect(await count('live_activity_refresh_intents')).toBe(1);

      expect(await service.replace(userId, festivalId, input)).toEqual(first);
      expect(await count('user_schedules')).toBe(1);
      expect(await count('live_activity_refresh_intents')).toBe(1);
    });

    it('rolls back the schedule row when intent insertion fails', async () => {
      await db.query(`ALTER TABLE "live_activity_refresh_intents"
      ADD CONSTRAINT "test_reject_intent" CHECK (false)`);
      try {
        await expect(
          service.replace(userId, festivalId, input),
        ).rejects.toMatchObject({
          driverError: { constraint: 'test_reject_intent' },
        });
        expect(await count('user_schedules')).toBe(0);
        expect(await count('live_activity_refresh_intents')).toBe(0);
      } finally {
        await db.query(`ALTER TABLE "live_activity_refresh_intents"
        DROP CONSTRAINT "test_reject_intent"`);
      }
    });
  },
);
