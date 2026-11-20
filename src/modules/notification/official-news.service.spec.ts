import {
  classifyGraphError,
  InstagramFetchError,
  InstagramMedia,
} from './instagram-graph.client';
import {
  instagramUsername,
  officialNewsBody,
  OfficialNewsService,
  postImageUrl,
  toOfficialPost,
} from './official-news.service';

describe('official news helpers', () => {
  it('extracts a username only from https instagram profile URLs', () => {
    expect(
      instagramUsername('https://www.instagram.com/grandmintfestival/'),
    ).toBe('grandmintfestival');
    expect(instagramUsername('https://instagram.com/wonder.live_t')).toBe(
      'wonder.live_t',
    );
    expect(instagramUsername('http://www.instagram.com/abc/')).toBeNull();
    expect(instagramUsername('https://evil.com/abc/')).toBeNull();
    expect(instagramUsername('https://www.instagram.com/p/abc/')).toBeNull();
    expect(
      instagramUsername(`https://www.instagram.com/${'a'.repeat(31)}/`),
    ).toBeNull();
    expect(instagramUsername(null)).toBeNull();
  });

  it('picks an image per media type and never uses a video file URL', () => {
    expect(
      postImageUrl({
        id: '1',
        media_type: 'IMAGE',
        media_url: 'https://cdn.example/a.jpg',
      }),
    ).toBe('https://cdn.example/a.jpg');
    expect(
      postImageUrl({
        id: '1',
        media_type: 'VIDEO',
        media_url: 'https://cdn.example/a.mp4',
        thumbnail_url: 'https://cdn.example/a-thumb.jpg',
      }),
    ).toBe('https://cdn.example/a-thumb.jpg');
    expect(
      postImageUrl({
        id: '1',
        media_type: 'VIDEO',
        media_url: 'https://cdn.example/a.mp4',
      }),
    ).toBeNull();
    expect(
      postImageUrl({
        id: '1',
        media_type: 'CAROUSEL_ALBUM',
        children: {
          data: [
            { media_type: 'VIDEO', thumbnail_url: 'https://cdn.example/v.jpg' },
            { media_type: 'IMAGE', media_url: 'https://cdn.example/b.jpg' },
          ],
        },
      }),
    ).toBe('https://cdn.example/b.jpg');
    expect(
      postImageUrl({
        id: '1',
        media_type: 'CAROUSEL_ALBUM',
        children: {
          data: [
            { media_type: 'VIDEO', thumbnail_url: 'https://cdn.example/v.jpg' },
          ],
        },
      }),
    ).toBe('https://cdn.example/v.jpg');
    // 다운로드를 막은 릴처럼 media_url이 빠진 이미지
    expect(postImageUrl({ id: '1', media_type: 'IMAGE' })).toBeNull();
    expect(
      postImageUrl({
        id: '1',
        media_type: 'IMAGE',
        media_url: 'http://cdn.example/a.jpg',
      }),
    ).toBeNull();
  });

  it('keeps only posts with a numeric id, instagram permalink and valid time', () => {
    const base: InstagramMedia = {
      id: '17900000000000001',
      caption: 'x'.repeat(3000),
      media_type: 'IMAGE',
      media_url: 'https://cdn.example/a.jpg',
      permalink: 'https://www.instagram.com/p/AAA/',
      timestamp: '2026-11-20T08:00:00+0000',
    };
    const post = toOfficialPost(base);
    expect(post).toMatchObject({
      mediaId: '17900000000000001',
      mediaType: 'IMAGE',
      imageUrl: 'https://cdn.example/a.jpg',
      permalink: 'https://www.instagram.com/p/AAA/',
    });
    expect(post?.caption).toHaveLength(2200);
    expect(post?.postedAt.toISOString()).toBe('2026-11-20T08:00:00.000Z');
    expect(toOfficialPost({ ...base, id: 'abc' })).toBeNull();
    expect(
      toOfficialPost({ ...base, permalink: 'https://evil.com/p/AAA/' }),
    ).toBeNull();
    expect(toOfficialPost({ ...base, timestamp: 'nope' })).toBeNull();
    expect(toOfficialPost({ ...base, caption: '   ' })?.caption).toBeNull();
  });

  it('uses the first caption line as the notification body', () => {
    expect(officialNewsBody('\n  타임테이블 변경 안내  \n둘째 줄')).toBe(
      '타임테이블 변경 안내',
    );
    expect(officialNewsBody('가'.repeat(150))).toHaveLength(100);
    expect(officialNewsBody(null)).toBe(
      '공식 인스타그램에 새 게시물이 올라왔어요.',
    );
  });

  it('classifies Graph errors into pause decisions', () => {
    expect(classifyGraphError({ error: { code: 190 } }, 400).kind).toBe(
      'token_invalid',
    );
    expect(classifyGraphError({ error: { code: 10 } }, 400).kind).toBe(
      'token_invalid',
    );
    expect(classifyGraphError({ error: { code: 4 } }, 400).kind).toBe(
      'rate_limited',
    );
    expect(classifyGraphError({ error: { code: 80002 } }, 400).kind).toBe(
      'rate_limited',
    );
    expect(classifyGraphError({ error: { code: 110 } }, 400).kind).toBe(
      'account_unavailable',
    );
    expect(classifyGraphError({}, 401).kind).toBe('token_invalid');
    expect(classifyGraphError({}, 500).kind).toBe('error');
  });
});

describe('OfficialNewsService', () => {
  const festivalId = 'fst_0123456789abcdef';
  const now = new Date('2026-11-20T09:00:00.000Z');
  const target = (overrides: Record<string, unknown> = {}) => ({
    festivalId,
    instagramUrl: 'https://www.instagram.com/wonderliivet/',
    days: [{ date: '2026-11-21' }],
    feedUsername: 'wonderliivet',
    seededAt: new Date('2026-11-19T00:00:00.000Z'),
    ...overrides,
  });
  const media = (id: string, postedAt: string): InstagramMedia => ({
    id,
    caption: `게시물 ${id}`,
    media_type: 'IMAGE',
    media_url: `https://cdn.example/${id}.jpg`,
    permalink: `https://www.instagram.com/p/${id}/`,
    timestamp: postedAt,
  });

  function setup(
    knownIds: string[] = [],
    currentUrl = 'https://www.instagram.com/wonderliivet/',
  ) {
    const query = jest.fn<Promise<unknown>, [string, unknown[]?]>();
    query.mockResolvedValue([]);
    const managerQuery = jest.fn<Promise<unknown>, [string, unknown[]?]>(
      (sql) =>
        Promise.resolve(
          sql.startsWith('SELECT "mediaId"')
            ? knownIds.map((mediaId) => ({ mediaId }))
            : sql.includes('FROM "admin_festivals"')
              ? [{ instagramUrl: currentUrl }]
              : [],
        ),
    );
    const transaction = jest.fn(
      (work: (manager: { query: typeof managerQuery }) => Promise<unknown>) =>
        work({ query: managerQuery }),
    );
    const recentMedia = jest.fn<Promise<InstagramMedia[]>, [string]>();
    const isConfigured = jest.fn().mockReturnValue(true);
    const service = new OfficialNewsService(
      { query, transaction } as never,
      { recentMedia, isConfigured } as never,
    );
    const enqueued = () =>
      managerQuery.mock.calls.filter(([sql]) =>
        sql.includes('INSERT INTO "notification_deliveries"'),
      );
    return {
      service,
      query,
      managerQuery,
      recentMedia,
      isConfigured,
      enqueued,
    };
  }

  it('does nothing without Graph configuration', async () => {
    const { service, query, recentMedia, isConfigured } = setup();
    isConfigured.mockReturnValue(false);
    await service.tick(now);
    expect(query).not.toHaveBeenCalled();
    expect(recentMedia).not.toHaveBeenCalled();
  });

  it('polls only published festivals from 30 days before to one day after', async () => {
    const { service, query } = setup();
    query.mockResolvedValueOnce([
      target({ festivalId: 'a', days: [{ date: '2026-11-21' }] }),
      target({ festivalId: 'b', days: [{ date: '2027-02-01' }] }),
      target({ festivalId: 'c', days: [{ date: '2026-11-10' }] }),
    ]);
    const rows = await service.targets(now);
    expect(rows.map((row) => row.festivalId)).toEqual(['a']);
  });

  it('seeds the first fetch without notifying', async () => {
    const { service, managerQuery, recentMedia, enqueued } = setup();
    recentMedia.mockResolvedValue([media('1', '2026-11-20T08:59:00+0000')]);
    await service.refresh(target({ feedUsername: null, seededAt: null }), now);
    expect(recentMedia).toHaveBeenCalledWith('wonderliivet');
    expect(
      managerQuery.mock.calls.some(([sql]) =>
        sql.includes('INSERT INTO "official_instagram_posts"'),
      ),
    ).toBe(true);
    expect(
      managerQuery.mock.calls.some(([sql]) =>
        sql.includes('INSERT INTO "official_instagram_feeds"'),
      ),
    ).toBe(true);
    expect(enqueued()).toHaveLength(0);
  });

  it('notifies once for the newest unseen recent post after seeding', async () => {
    const { service, recentMedia, enqueued } = setup(['1']);
    recentMedia.mockResolvedValue([
      media('3', '2026-11-20T08:50:00+0000'),
      media('2', '2026-11-20T08:40:00+0000'),
      media('1', '2026-11-19T08:00:00+0000'),
    ]);
    await service.refresh(target(), now);
    expect(enqueued()).toHaveLength(1);
    expect(enqueued()[0][1]).toEqual([
      festivalId,
      `official-news:${festivalId}:3`,
      `official-news:${festivalId}:%`,
    ]);
    expect(enqueued()[0][0]).toContain('"pinned" = true');
    expect(enqueued()[0][0]).toContain('"notifyOfficialNews" = true');
  });

  it('does not notify unseen posts older than six hours', async () => {
    const { service, recentMedia, enqueued } = setup(['1']);
    recentMedia.mockResolvedValue([media('2', '2026-11-20T02:00:00+0000')]);
    await service.refresh(target(), now);
    expect(enqueued()).toHaveLength(0);
  });

  it('reseeds without notifying when the official account changes', async () => {
    const { service, managerQuery, recentMedia, enqueued } = setup();
    recentMedia.mockResolvedValue([media('9', '2026-11-20T08:59:00+0000')]);
    await service.refresh(target({ feedUsername: 'oldaccount' }), now);
    const deleteIndex = managerQuery.mock.calls.findIndex(([sql]) =>
      sql.includes('DELETE FROM "official_instagram_posts" WHERE'),
    );
    expect(deleteIndex).toBeGreaterThanOrEqual(0);
    expect(enqueued()).toHaveLength(0);
  });

  it('drops a fetch when the official account changed while waiting for Meta', async () => {
    const { service, managerQuery, recentMedia, enqueued } = setup(
      [],
      'https://www.instagram.com/newaccount/',
    );
    recentMedia.mockResolvedValue([media('9', '2026-11-20T08:59:00+0000')]);
    await service.refresh(target(), now);
    expect(
      managerQuery.mock.calls.some(([sql]) =>
        sql.includes('INSERT INTO "official_instagram_posts"'),
      ),
    ).toBe(false);
    expect(enqueued()).toHaveLength(0);
  });

  it('records an account change and removes old posts together on failure', async () => {
    const { service, query, managerQuery, recentMedia } = setup();
    recentMedia.mockRejectedValue(
      new InstagramFetchError('account_unavailable', 110),
    );
    await service.refresh(target({ feedUsername: 'oldaccount' }), now);
    expect(query).not.toHaveBeenCalled();
    expect(managerQuery.mock.calls[0][0]).toContain(
      'DELETE FROM "official_instagram_posts"',
    );
    expect(managerQuery.mock.calls[1][1]).toEqual([
      festivalId,
      'wonderliivet',
      'account_unavailable',
      true,
    ]);
  });

  it('pauses the whole poll for 30 minutes on an invalid token', async () => {
    const { service, query, managerQuery, recentMedia } = setup();
    recentMedia.mockRejectedValue(
      new InstagramFetchError('token_invalid', 190),
    );
    await expect(service.refresh(target(), now)).resolves.toBe('stop');
    expect(
      managerQuery.mock.calls.some(
        ([sql, params]) =>
          sql.includes('"lastErrorCode"') && params?.[2] === 'token_invalid',
      ),
    ).toBe(true);
    query.mockClear();
    await service.tick(new Date(now.getTime() + 29 * 60_000));
    expect(query).not.toHaveBeenCalled();
  });

  it('stops this round on rate limits and keeps going on one bad account', async () => {
    const { service, recentMedia } = setup();
    recentMedia.mockRejectedValueOnce(
      new InstagramFetchError('rate_limited', 4),
    );
    await expect(service.refresh(target(), now)).resolves.toBe('stop');
    recentMedia.mockRejectedValueOnce(
      new InstagramFetchError('account_unavailable', 110),
    );
    await expect(service.refresh(target(), now)).resolves.toBe('next');
  });

  it('skips festivals whose official URL is not an instagram profile', async () => {
    const { service, recentMedia } = setup();
    await expect(
      service.refresh(target({ instagramUrl: 'https://evil.com/x/' }), now),
    ).resolves.toBe('next');
    expect(recentMedia).not.toHaveBeenCalled();
  });
});
