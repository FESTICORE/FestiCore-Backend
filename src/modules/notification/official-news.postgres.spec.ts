import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { FestivalNotifications1792500018000 } from '../../database/migrations/1792500018000-festival-notifications';
import { UserNotifications1792500095000 } from '../../database/migrations/1792500095000-user-notifications';
import { OfficialInstagramNews1792500110000 } from '../../database/migrations/1792500110000-official-instagram-news';
import { FestivalStartService } from './festival-start.service';
import { InstagramMedia } from './instagram-graph.client';
import { OfficialNewsService } from './official-news.service';

jest.mock('./apns.service', () => ({ ApnsService: class {} }));

const url = process.env.LIVE_ACTIVITY_PG_URL;
const describePostgres = url ? describe : describe.skip;

describePostgres('축제 공식 인스타그램 소식 (PostgreSQL)', () => {
  const schema = `official_news_test_${randomUUID().replaceAll('-', '_')}`;
  const festivalId = 'fst_0123456789abcdef';
  const member = randomUUID();
  const pinnedDevice = randomUUID();
  const mutedDevice = randomUUID();
  const unpinnedDevice = randomUUID();
  const recentMedia = jest.fn<Promise<InstagramMedia[]>, [string]>();
  const sendStartNotification = jest.fn();
  let admin: DataSource;
  let db: DataSource;
  let news: OfficialNewsService;
  let deliveries: FestivalStartService;

  const now = () => new Date();
  const today = () =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(
      new Date(),
    );
  const media = (id: string, postedAt: Date): InstagramMedia => ({
    id,
    caption: `공지 ${id}\n둘째 줄`,
    media_type: 'IMAGE',
    media_url: `https://cdn.example/${id}.jpg`,
    permalink: `https://www.instagram.com/p/${id}/`,
    timestamp: postedAt.toISOString(),
  });
  const publish = (account: string) =>
    db.query(
      `UPDATE "admin_festivals" SET "published" = $2::jsonb WHERE "id" = $1`,
      [
        festivalId,
        JSON.stringify({
          name: '원더리벳',
          days: [{ date: today() }],
          officialInstagramUrl: `https://www.instagram.com/${account}/`,
        }),
      ],
    );
  const refresh = async () => {
    const [target] = await news.targets(now());
    expect(target?.festivalId).toBe(festivalId);
    return news.refresh(target, now());
  };
  const jobs = () =>
    db.query<Array<{ deviceId: string; eventKey: string }>>(
      `SELECT "deviceId", "eventKey" FROM "notification_deliveries" ORDER BY "deviceId"`,
    );

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
      "apnsToken" varchar(256)
    )`);
    await db.query(`CREATE TABLE "device_subscriptions" (
      "deviceId" uuid NOT NULL,
      "festivalId" varchar(32) NOT NULL,
      "pinned" boolean NOT NULL DEFAULT false
    )`);
    const runner = db.createQueryRunner();
    try {
      await new FestivalNotifications1792500018000().up(runner);
      await new UserNotifications1792500095000().up(runner);
      await new OfficialInstagramNews1792500110000().up(runner);
    } finally {
      await runner.release();
    }
    await db.query('INSERT INTO "users" ("id") VALUES ($1)', [member]);
    await db.query(
      `INSERT INTO "admin_festivals" ("id", "publishedVersion") VALUES ($1, 1)`,
      [festivalId],
    );
    await db.query(
      `INSERT INTO "devices" ("id", "userId", "apnsToken", "apnsEnvironment", "notifyOfficialNews")
       VALUES ($1, $4, 'aa', 'production', true),
              ($2, NULL, 'bb', 'production', false),
              ($3, NULL, 'cc', 'production', true)`,
      [pinnedDevice, mutedDevice, unpinnedDevice, member],
    );
    await db.query(
      `INSERT INTO "device_subscriptions" ("deviceId", "festivalId", "pinned")
       VALUES ($1, $4, true), ($2, $4, true), ($3, $4, false)`,
      [pinnedDevice, mutedDevice, unpinnedDevice, festivalId],
    );
    news = new OfficialNewsService(db, {
      isConfigured: () => true,
      recentMedia,
    } as never);
    deliveries = new FestivalStartService(db, {
      isConfigured: () => true,
      sendStartNotification,
    } as never);
    await publish('wonderliivet');
  });

  afterAll(async () => {
    if (db?.isInitialized) await db.destroy();
    if (admin?.isInitialized) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.destroy();
    }
  });

  it('첫 수집은 기준선만 잡고, 이후 새 게시물은 고정·설정을 켠 기기에만 알린다', async () => {
    const oldPost = media('1001', new Date(Date.now() - 2 * 86_400_000));
    recentMedia.mockResolvedValueOnce([oldPost]);
    await expect(refresh()).resolves.toBe('next');
    expect(await jobs()).toEqual([]);

    const fresh = media('1002', new Date(Date.now() - 60_000));
    recentMedia.mockResolvedValueOnce([fresh, oldPost]);
    await refresh();
    expect(await jobs()).toEqual([
      {
        deviceId: pinnedDevice,
        eventKey: `official-news:${festivalId}:1002`,
      },
    ]);

    // 같은 게시물을 다시 받아도 작업을 늘리지 않는다.
    recentMedia.mockResolvedValueOnce([fresh, oldPost]);
    await refresh();
    expect(await jobs()).toHaveLength(1);

    sendStartNotification.mockResolvedValueOnce({ accepted: true });
    const job = await deliveries.claim();
    expect(job).not.toBeNull();
    await deliveries.deliver(job!, now());
    expect(sendStartNotification).toHaveBeenCalledWith(
      'aa',
      'production',
      expect.objectContaining({
        title: '원더리벳 공식 소식',
        body: '공지 1002',
        type: 'festival.official_news',
        imageUrl: 'https://cdn.example/1002.jpg',
      }),
    );
    const inbox = await db.query<Array<{ type: string; route: string }>>(
      `SELECT "type", "route" FROM "user_notifications" WHERE "userId" = $1`,
      [member],
    );
    expect(inbox).toEqual([
      {
        type: 'festival.official_news',
        route: `/festivals/${festivalId}/live`,
      },
    ]);
    const [status] = await db.query<Array<{ status: string }>>(
      `SELECT "status" FROM "notification_deliveries"`,
    );
    expect(status.status).toBe('sent');
  });

  it('최근 12개만 남기고 계정이 바뀌면 옛 게시물을 지운 뒤 기준선을 다시 잡는다', async () => {
    await db.query('TRUNCATE "notification_deliveries"');
    recentMedia.mockResolvedValueOnce(
      Array.from({ length: 14 }, (_, index) =>
        media(
          String(2000 + index),
          new Date(Date.now() - (index + 10) * 86_400_000),
        ),
      ),
    );
    await refresh();
    const [{ count }] = await db.query<Array<{ count: string }>>(
      `SELECT count(*) FROM "official_instagram_posts" WHERE "festivalId" = $1`,
      [festivalId],
    );
    expect(Number(count)).toBe(12);

    await publish('newaccount');
    recentMedia.mockResolvedValueOnce([
      media('3001', new Date(Date.now() - 60_000)),
    ]);
    await refresh();
    expect(recentMedia).toHaveBeenLastCalledWith('newaccount');
    const posts = await db.query<Array<{ mediaId: string }>>(
      `SELECT "mediaId" FROM "official_instagram_posts" WHERE "festivalId" = $1`,
      [festivalId],
    );
    expect(posts).toEqual([{ mediaId: '3001' }]);
    expect(await jobs()).toEqual([]);
  });
});
