import { discoverySummaries } from './crawl-catalog';
import { PublicFestivalService } from './public-festival.service';

const url = 'https://world.nol.com/en/ticket/products/26014246';
const candidate = {
  name: 'MINT FESTA vol.88',
  url,
  venue: 'Rolling Hall',
  date: '2026.11.08',
  artists: [],
};
const id = discoverySummaries([{ candidate }])[0].id;

describe('reviewed NOL World lineup projection', () => {
  it('keeps private OCR evidence out of public discovered detail and adds approved names only', async () => {
    const query = jest.fn().mockImplementation((sql: string) => {
      if (sql.includes('WITH candidates')) return [{ candidate }];
      if (sql.includes('FROM crawl_lineup_revisions'))
        return [
          {
            artists: [
              { name: 'DASUT (다섯)' },
              { name: '다섯' },
              { name: 'O3ohn' },
            ],
          },
        ];
      return [];
    });
    const service = new PublicFestivalService(
      { findOne: jest.fn().mockResolvedValue(null) } as never,
      {} as never,
      { query } as never,
      {} as never,
    );
    const detail = await service.detail(id);
    expect(detail.artists).toEqual([
      { name: 'DASUT (다섯)', imageUrl: null },
      { name: 'O3ohn', imageUrl: null },
    ]);
    expect(detail.timetable).toEqual([]);
    expect(JSON.stringify(detail)).not.toContain('rawLines');
    expect(JSON.stringify(detail)).not.toContain('imageHash');
    const sql = (query.mock.calls as [string][]).find(([statement]) =>
      statement.includes('FROM crawl_lineup_revisions'),
    )?.[0];
    expect(sql).toContain("revision.status = 'approved'");
    expect(sql).toContain('lineup_source.enabled = TRUE');
    expect(sql).toContain('evidence->\'rawLines\' = revision."rawLines"');
    expect(sql).toContain('ORDER BY newest."startedAt" DESC LIMIT 1');
  });

  it('keeps published detail aligned with its versioned offline pack', async () => {
    const query = jest.fn().mockResolvedValue([
      {
        id: '11111111-1111-4111-8111-111111111111',
        seed: null,
        artistName: null,
        reviewFestivalId: null,
        author: null,
        license: null,
        licenseUrl: null,
        sourceUrl: null,
        rightsRunId: null,
      },
    ]);
    const service = new PublicFestivalService(
      {
        findOne: jest.fn().mockResolvedValue({
          publishedVersion: 1,
          published: {
            id,
            name: candidate.name,
            source: { url: 'https://official.example/festival' },
            ticketLinks: [{ label: 'NOL World', url }],
            stages: [{ id: 'main', name: 'Main' }],
            sets: [
              {
                id: 'set-1',
                stageId: 'main',
                artist: 'DASUT',
                startsAt: '2026-11-08T17:00:00+09:00',
                endsAt: null,
                imageUrl:
                  '/api/v1/festivals/images/11111111-1111-4111-8111-111111111111.webp',
              },
            ],
          },
        }),
      } as never,
      {} as never,
      { query } as never,
      { packGeneration: jest.fn().mockResolvedValue(null) } as never,
    );
    const detail = await service.detail(id);
    expect(detail.artists).toEqual([
      {
        name: 'DASUT',
        imageUrl:
          '/api/v1/festivals/images/11111111-1111-4111-8111-111111111111.webp',
      },
    ]);
    expect(detail.sets).toHaveLength(1);
    expect(detail.timetable).toHaveLength(1);
    expect(query).toHaveBeenCalledTimes(1);
  });
});
