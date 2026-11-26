import { PublicFestivalService } from './public-festival.service';

describe('PublicFestivalService official instagram news', () => {
  const festivalId = 'fst_0123456789abcdef';

  /** instagramUrl은 발행 문서(DB) 값이다. 공개 팩 투영에는 이 필드가 없다. */
  function makeService(
    instagramUrl: string | null,
    feed: object | undefined,
    posts: object[] = [],
  ) {
    const query = jest.fn((sql: string) =>
      Promise.resolve(
        sql.includes('FROM "admin_festivals"')
          ? [{ instagramUrl }]
          : sql.includes('"official_instagram_feeds"')
            ? feed
              ? [feed]
              : []
            : posts,
      ),
    );
    const service = new PublicFestivalService(
      {} as never,
      {} as never,
      { query } as never,
      {} as never,
    );
    // 실제 공개 팩처럼 officialInstagramUrl이 빠진 문서를 돌려준다.
    jest.spyOn(service, 'published').mockResolvedValue({ name: '원더리벳' });
    return { service, query };
  }

  it('is unavailable without an official instagram profile', async () => {
    const { service, query } = makeService(null, undefined);
    await expect(service.officialNews(festivalId)).resolves.toEqual({
      festivalId,
      available: false,
      account: null,
      fetchedAt: null,
      posts: [],
    });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain('"publishedVersion" > 0');
  });

  it('is unavailable until the first fetch for the current account', async () => {
    const { service } = makeService('https://www.instagram.com/wonderliivet/', {
      username: 'oldaccount',
      seededAt: new Date(),
      lastFetchedAt: new Date(),
    });
    await expect(service.officialNews(festivalId)).resolves.toMatchObject({
      available: false,
      account: {
        username: 'wonderliivet',
        url: 'https://www.instagram.com/wonderliivet/',
      },
      fetchedAt: null,
      posts: [],
    });
  });

  it('returns the stored recent posts newest first', async () => {
    const { service, query } = makeService(
      'https://www.instagram.com/wonderliivet/',
      {
        username: 'WonderLiivet',
        seededAt: new Date('2026-11-19T00:00:00Z'),
        lastFetchedAt: new Date('2026-11-20T09:00:00Z'),
      },
      [
        {
          mediaId: '2',
          caption: '공지',
          mediaType: 'IMAGE',
          imageUrl: 'https://cdn.example/2.jpg',
          permalink: 'https://www.instagram.com/p/B/',
          postedAt: new Date('2026-11-20T08:00:00Z'),
        },
      ],
    );
    await expect(service.officialNews(festivalId)).resolves.toEqual({
      festivalId,
      available: true,
      account: {
        username: 'wonderliivet',
        url: 'https://www.instagram.com/wonderliivet/',
      },
      fetchedAt: '2026-11-20T09:00:00.000Z',
      posts: [
        {
          id: '2',
          caption: '공지',
          mediaType: 'IMAGE',
          imageUrl: 'https://cdn.example/2.jpg',
          permalink: 'https://www.instagram.com/p/B/',
          postedAt: '2026-11-20T08:00:00.000Z',
        },
      ],
    });
    expect(query.mock.calls[2][0]).toContain('ORDER BY "postedAt" DESC');
    expect(query.mock.calls[2][0]).toContain('LIMIT 6');
  });
});
