import { CdfSecondLineupSomethingNew1792500104000 } from './1792500104000-cdf-second-lineup-something-new';

describe('official festival source registration', () => {
  it('registers only source URLs and preserves existing registrations', async () => {
    const query = jest
      .fn<Promise<unknown[]>, [string, string[]]>()
      .mockResolvedValue([]);
    await new CdfSecondLineupSomethingNew1792500104000().up({ query } as never);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][0]).toContain('WHERE NOT EXISTS');
    expect(query.mock.calls[0][1][0]).toBe(
      'https://mintpaper.co.kr/festivals/178/notice/4870',
    );
    expect(JSON.parse(query.mock.calls[0][1][1])).toMatchObject({
      seed: 'official-lineup',
      festivalSourceUrl: 'https://mintpaper.co.kr/festivals/178',
      festivalSourceUrls: [
        'https://mintpaper.co.kr/festivals/178',
        'https://ticket.yes24.com/Perf/60590',
        'https://ticket.yes24.com/English/Perf/60590',
      ],
    });
    expect(query.mock.calls[1][1][0]).toBe(
      'https://nol.yanolja.com/ticket/products/26015181',
    );
    expect(JSON.stringify(query.mock.calls)).not.toContain('startsAt');
  });
  it('does not delete crawled source history on rollback', async () => {
    const query = jest
      .fn<Promise<unknown[]>, [string, string[]]>()
      .mockResolvedValue([]);
    await new CdfSecondLineupSomethingNew1792500104000().down({
      query,
    } as never);
    for (const [sql] of query.mock.calls) {
      expect(sql).toContain('NOT EXISTS (SELECT 1 FROM crawl_runs');
      expect(sql).toContain('NOT EXISTS (SELECT 1 FROM crawl_proposals');
    }
  });
});
