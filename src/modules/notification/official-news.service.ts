import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import {
  INSTAGRAM_USERNAME,
  InstagramFetchError,
  InstagramGraphClient,
  InstagramMedia,
} from './instagram-graph.client';
import { festivalPeriod, records } from './live-activity.service';

const POLL_MS = 5 * 60_000;
/** 축제별로 남기는 최근 게시물 수 */
export const KEEP_POSTS = 12;
/** 시작 30일 전부터 끝난 뒤 하루까지 받는다. */
const ACTIVE_BEFORE_MS = 30 * 86_400_000;
const ACTIVE_AFTER_MS = 86_400_000;
/** 이보다 오래된 게시물은 새로 보여도 알리지 않는다. */
export const NOTIFY_WINDOW_MS = 6 * 60 * 60_000;
/** 같은 축제의 공식 소식 알림은 이 간격 안에 한 번만 보낸다. */
const NOTIFY_INTERVAL = '1 hour';
const TOKEN_PAUSE_MS = 30 * 60_000;
const RATE_LIMIT_PAUSE_MS = 15 * 60_000;
const MAX_CAPTION = 2_200;
const MAX_URL = 2_048;

export const OFFICIAL_NEWS_PREFIX = 'official-news:';
const MEDIA_ID = /^\d{1,40}$/;

interface FeedTargetRow {
  festivalId: string;
  instagramUrl: string | null;
  days: unknown;
  feedUsername: string | null;
  seededAt: Date | null;
}

export interface OfficialPost {
  mediaId: string;
  caption: string | null;
  mediaType: string;
  imageUrl: string | null;
  permalink: string;
  postedAt: Date;
}

/** 공식 인스타그램 주소에서 사용자 이름을 뽑는다. instagram.com https 주소만 받는다. */
export function instagramUsername(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  try {
    const url = new URL(raw);
    if (
      url.protocol !== 'https:' ||
      !['www.instagram.com', 'instagram.com'].includes(url.hostname) ||
      url.username ||
      url.password
    )
      return null;
    const name = /^\/([A-Za-z0-9._]+)\/?$/.exec(url.pathname)?.[1];
    return name && INSTAGRAM_USERNAME.test(name) ? name : null;
  } catch {
    return null;
  }
}

function httpsUrl(value: unknown): string | null {
  return typeof value === 'string' &&
    value.startsWith('https://') &&
    value.length <= MAX_URL
    ? value
    : null;
}

/**
 * 게시물 대표 이미지. 영상 파일 주소는 이미지로 쓰지 않는다.
 * 저작권 음원 영상·다운로드를 막은 릴은 media_url이 빠질 수 있다(2026-07-30 변경).
 */
export function postImageUrl(media: InstagramMedia): string | null {
  switch (media.media_type) {
    case 'IMAGE':
      return httpsUrl(media.media_url);
    case 'VIDEO':
      return httpsUrl(media.thumbnail_url);
    case 'CAROUSEL_ALBUM': {
      const children = Array.isArray(media.children?.data)
        ? media.children.data
        : [];
      const image = children.find(
        (child) => child.media_type === 'IMAGE' && httpsUrl(child.media_url),
      );
      if (image) return httpsUrl(image.media_url);
      const video = children.find(
        (child) =>
          child.media_type === 'VIDEO' && httpsUrl(child.thumbnail_url),
      );
      return video ? httpsUrl(video.thumbnail_url) : null;
    }
    default:
      return null;
  }
}

export function toOfficialPost(media: InstagramMedia): OfficialPost | null {
  if (!MEDIA_ID.test(media.id)) return null;
  const permalink = httpsUrl(media.permalink);
  if (!permalink || !permalink.startsWith('https://www.instagram.com/'))
    return null;
  const postedAt = new Date(media.timestamp ?? '');
  if (!Number.isFinite(postedAt.getTime())) return null;
  const caption =
    typeof media.caption === 'string' && media.caption.trim()
      ? media.caption.slice(0, MAX_CAPTION)
      : null;
  return {
    mediaId: media.id,
    caption,
    mediaType:
      typeof media.media_type === 'string'
        ? media.media_type.slice(0, 32)
        : 'UNKNOWN',
    imageUrl: postImageUrl(media),
    permalink,
    postedAt,
  };
}

/** 알림 본문: 캡션 첫 줄을 100자 안으로 줄인다. */
export function officialNewsBody(caption: string | null): string {
  const line = caption
    ?.split('\n')
    .map((item) => item.trim())
    .find(Boolean);
  if (!line) return '공식 인스타그램에 새 게시물이 올라왔어요.';
  return line.length > 100 ? `${line.slice(0, 99)}…` : line;
}

/**
 * 발행 축제의 공식 인스타그램을 5분마다 받아 최근 게시물을 저장하고,
 * 새 게시물은 축제를 고정한 기기에 보낼 알림 작업으로 넣는다. 발송은 FestivalStartService가 한다.
 * Meta 호출은 이 작업만 하고, 공개 조회는 저장된 게시물만 읽는다.
 */
@Injectable()
export class OfficialNewsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OfficialNewsService.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  private pausedUntil = 0;
  private warnedMissingConfig = false;
  private warnedToken = false;

  constructor(
    private readonly db: DataSource,
    private readonly graph: InstagramGraphClient,
  ) {}

  onModuleInit(): void {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), POLL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  isConfigured(): boolean {
    return this.graph.isConfigured();
  }

  async tick(now = new Date()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      if (!this.graph.isConfigured()) {
        if (!this.warnedMissingConfig) {
          this.logger.warn(
            '인스타그램 Graph 설정이 없어 공식 소식 수집을 보류합니다.',
          );
          this.warnedMissingConfig = true;
        }
        return;
      }
      this.warnedMissingConfig = false;
      if (now.getTime() < this.pausedUntil) return;
      for (const target of await this.targets(now)) {
        if ((await this.refresh(target, now)) === 'stop') break;
      }
    } catch {
      this.logger.error('공식 소식 수집을 실행하지 못했습니다.');
    } finally {
      this.running = false;
    }
  }

  /** 공식 인스타그램이 있고 기간 안에 있는 발행 축제 */
  async targets(now: Date): Promise<FeedTargetRow[]> {
    const rows = await this.db.query<FeedTargetRow[]>(`
      SELECT f."id" AS "festivalId",
        f."published"->>'officialInstagramUrl' AS "instagramUrl",
        f."published"->'days' AS "days",
        feed."username" AS "feedUsername", feed."seededAt" AS "seededAt"
      FROM "admin_festivals" f
      LEFT JOIN "official_instagram_feeds" feed ON feed."festivalId" = f."id"
      WHERE f."published" IS NOT NULL AND f."publishedVersion" > 0
        AND f."published"->>'officialInstagramUrl' IS NOT NULL
      ORDER BY f."id"`);
    return rows.filter((row) => {
      const period = festivalPeriod(records(row.days));
      return (
        period !== null &&
        now.getTime() >= period.start.getTime() - ACTIVE_BEFORE_MS &&
        now.getTime() <= period.end.getTime() + ACTIVE_AFTER_MS
      );
    });
  }

  /** 'stop'이면 이번 회차의 남은 축제를 건너뛴다(토큰 · 호출 한도 문제). */
  async refresh(target: FeedTargetRow, now: Date): Promise<'next' | 'stop'> {
    const username = instagramUsername(target.instagramUrl);
    if (!username) return 'next';
    const accountChanged =
      target.feedUsername !== null &&
      target.feedUsername.toLowerCase() !== username.toLowerCase();
    let media: InstagramMedia[];
    try {
      media = await this.graph.recentMedia(username);
    } catch (error) {
      const kind = error instanceof InstagramFetchError ? error.kind : 'error';
      await this.recordFailure(
        target.festivalId,
        username,
        kind,
        accountChanged,
      );
      if (kind === 'token_invalid' || kind === 'not_configured') {
        this.pausedUntil = now.getTime() + TOKEN_PAUSE_MS;
        if (!this.warnedToken) {
          this.logger.error(
            '인스타그램 Graph 토큰이 유효하지 않아 공식 소식 수집을 30분 멈춥니다.',
          );
          this.warnedToken = true;
        }
        return 'stop';
      }
      if (kind === 'rate_limited') {
        this.pausedUntil = now.getTime() + RATE_LIMIT_PAUSE_MS;
        this.logger.warn(
          '인스타그램 호출 한도로 공식 소식 수집을 15분 멈춥니다.',
        );
        return 'stop';
      }
      return 'next';
    }
    this.warnedToken = false;
    const posts = media
      .map(toOfficialPost)
      .filter((post): post is OfficialPost => post !== null);
    await this.db.transaction((manager) =>
      this.store(manager, target, username, accountChanged, posts, now),
    );
    return 'next';
  }

  private async store(
    manager: EntityManager,
    target: FeedTargetRow,
    username: string,
    accountChanged: boolean,
    posts: OfficialPost[],
    now: Date,
  ): Promise<void> {
    const festivalId = target.festivalId;
    // Meta 응답을 기다리는 사이 관리자가 공식 계정을 바꿨으면 옛 계정 게시물을 저장하지 않는다.
    const current = await manager.query<{ instagramUrl: string | null }[]>(
      `SELECT "published"->>'officialInstagramUrl' AS "instagramUrl"
       FROM "admin_festivals"
       WHERE "id" = $1 AND "published" IS NOT NULL AND "publishedVersion" > 0`,
      [festivalId],
    );
    if (
      instagramUsername(current[0]?.instagramUrl)?.toLowerCase() !==
      username.toLowerCase()
    )
      return;
    if (accountChanged) {
      await manager.query(
        `DELETE FROM "official_instagram_posts" WHERE "festivalId" = $1`,
        [festivalId],
      );
    }
    const seeded = target.seededAt !== null && !accountChanged;
    const known = new Set(
      (
        await manager.query<{ mediaId: string }[]>(
          `SELECT "mediaId" FROM "official_instagram_posts" WHERE "festivalId" = $1`,
          [festivalId],
        )
      ).map((row) => row.mediaId),
    );
    for (const post of posts) {
      await manager.query(
        `INSERT INTO "official_instagram_posts"
          ("festivalId", "mediaId", "caption", "mediaType", "imageUrl", "permalink", "postedAt", "fetchedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT ("festivalId", "mediaId") DO UPDATE
           SET "caption" = EXCLUDED."caption", "mediaType" = EXCLUDED."mediaType",
             "imageUrl" = EXCLUDED."imageUrl", "permalink" = EXCLUDED."permalink",
             "postedAt" = EXCLUDED."postedAt", "fetchedAt" = EXCLUDED."fetchedAt"`,
        [
          festivalId,
          post.mediaId,
          post.caption,
          post.mediaType,
          post.imageUrl,
          post.permalink,
          post.postedAt,
          now,
        ],
      );
    }
    await manager.query(
      `DELETE FROM "official_instagram_posts" p
       WHERE p."festivalId" = $1 AND p."mediaId" NOT IN (
         SELECT "mediaId" FROM "official_instagram_posts"
         WHERE "festivalId" = $1
         ORDER BY "postedAt" DESC, "mediaId" DESC
         LIMIT ${KEEP_POSTS}
       )`,
      [festivalId],
    );
    await manager.query(
      `INSERT INTO "official_instagram_feeds"
        ("festivalId", "username", "seededAt", "lastFetchedAt", "lastErrorCode")
       VALUES ($1, $2, $3, $3, NULL)
       ON CONFLICT ("festivalId") DO UPDATE
         SET "username" = EXCLUDED."username",
           "seededAt" = CASE WHEN $4::boolean THEN EXCLUDED."seededAt"
             ELSE COALESCE("official_instagram_feeds"."seededAt", EXCLUDED."seededAt") END,
           "lastFetchedAt" = EXCLUDED."lastFetchedAt", "lastErrorCode" = NULL`,
      [festivalId, username, now, accountChanged],
    );
    if (!seeded) return;
    const fresh = posts
      .filter(
        (post) =>
          !known.has(post.mediaId) &&
          post.postedAt.getTime() >= now.getTime() - NOTIFY_WINDOW_MS &&
          post.postedAt.getTime() <= now.getTime() + 5 * 60_000,
      )
      .sort((a, b) => b.postedAt.getTime() - a.postedAt.getTime())[0];
    if (fresh) await this.enqueue(manager, festivalId, fresh.mediaId);
  }

  /** 고정 구독 중이고 공식 소식 알림을 켠 기기에 작업을 넣는다. 같은 축제는 1시간에 한 번만 알린다. */
  private async enqueue(
    manager: EntityManager,
    festivalId: string,
    mediaId: string,
  ): Promise<void> {
    await manager.query(
      `INSERT INTO "notification_deliveries"
        ("id", "deviceId", "festivalId", "eventKey", "scheduledAt", "nextAttemptAt")
       SELECT gen_random_uuid(), s."deviceId", $1::varchar, $2::varchar, now(), now()
       FROM "device_subscriptions" s
       JOIN "devices" d ON d."id" = s."deviceId"
       WHERE s."festivalId" = $1 AND s."pinned" = true
         AND d."notifyOfficialNews" = true
         AND d."apnsToken" IS NOT NULL AND d."apnsEnvironment" IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM "notification_deliveries" recent
           WHERE recent."deviceId" = s."deviceId" AND recent."festivalId" = $1
             AND recent."eventKey" LIKE $3
             AND recent."scheduledAt" > now() - interval '${NOTIFY_INTERVAL}'
         )
       ON CONFLICT ("deviceId", "eventKey") DO NOTHING`,
      [
        festivalId,
        `${OFFICIAL_NEWS_PREFIX}${festivalId}:${mediaId}`,
        `${OFFICIAL_NEWS_PREFIX}${festivalId}:%`,
      ],
    );
  }

  private async recordFailure(
    festivalId: string,
    username: string,
    kind: string,
    accountChanged: boolean,
  ): Promise<void> {
    try {
      // 계정이 바뀐 기록과 옛 계정 게시물 삭제는 함께 성공하거나 함께 실패해야 한다.
      await this.db.transaction(async (manager) => {
        if (accountChanged)
          await manager.query(
            `DELETE FROM "official_instagram_posts" WHERE "festivalId" = $1`,
            [festivalId],
          );
        await manager.query(
          `INSERT INTO "official_instagram_feeds"
            ("festivalId", "username", "seededAt", "lastFetchedAt", "lastErrorCode")
           VALUES ($1, $2, NULL, NULL, $3)
           ON CONFLICT ("festivalId") DO UPDATE
             SET "username" = EXCLUDED."username", "lastErrorCode" = EXCLUDED."lastErrorCode",
               "seededAt" = CASE WHEN $4::boolean THEN NULL
                 ELSE "official_instagram_feeds"."seededAt" END`,
          [festivalId, username, kind, accountChanged],
        );
      });
    } catch {
      this.logger.error('공식 소식 수집 실패를 기록하지 못했습니다.');
    }
  }
}
