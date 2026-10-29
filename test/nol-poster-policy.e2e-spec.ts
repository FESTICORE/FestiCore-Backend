import { Client } from 'pg';
import { PUBLIC_CRAWL_IMAGE_SQL } from '../src/modules/public/crawl-image-policy';

describe('NOL public image SQL policy', () => {
  const sourceUrl = 'https://nol.yanolja.com/ticket/products/26013406';
  const imageHost = 'https://ticketimage.interpark.com';
  const nolBranch = PUBLIC_CRAWL_IMAGE_SQL.indexOf(
    "  OR (source.url = 'https://nol.yanolja.com/ticket'",
  );
  const nolPolicy = PUBLIC_CRAWL_IMAGE_SQL.slice(nolBranch, -2);
  const client = new Client({
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USERNAME ?? 'postgres',
    password: process.env.DB_PASSWORD ?? 'postgres',
    database: process.env.DB_NAME ?? 'festicore',
  });

  beforeAll(async () => {
    expect(nolBranch).toBeGreaterThanOrEqual(0);
    await client.connect();
  });
  afterAll(async () => client.end());

  it.each([
    [
      'matching large poster',
      `${imageHost}/Play/image/large/26/26013406_p.gif`,
      true,
    ],
    [
      'matching poster with a query',
      `${imageHost}/Play/image/large/26/26013406_p.gif?v=1`,
      true,
    ],
    [
      'other large poster with a query',
      `${imageHost}/Play/image/large/26/99999999_p.gif?v=1`,
      false,
    ],
    [
      'matching small poster',
      `${imageHost}/Play/image/small/26/26013406_p.gif`,
      true,
    ],
    [
      'other small poster',
      `${imageHost}/Play/image/small/26/99999999_p.gif`,
      false,
    ],
    [
      'other poster with an uppercase extension',
      `${imageHost}/Play/image/small/26/99999999_p.GIF`,
      false,
    ],
    [
      'matching poster with a fragment',
      `${imageHost}/Play/image/small/26/26013406_p.gif#preview`,
      true,
    ],
    [
      'query cannot spoof the poster ID',
      `${imageHost}/Play/image/small/26/99999999_p.gif?next=/26013406_p.gif`,
      false,
    ],
    [
      'performer image in the large directory',
      `${imageHost}/Play/image/large/26/artist.jpg`,
      true,
    ],
    ['performer image', `${imageHost}/artist/c.jpg`, true],
  ])('%s', async (_description, originUrl, allowed) => {
    const result = await client.query<{ allowed: boolean }>(
      `SELECT (false ${nolPolicy}) AS allowed
       FROM (SELECT $1::text AS url) source
       CROSS JOIN (SELECT $2::text AS "originUrl") image`,
      [sourceUrl, originUrl],
    );
    expect(result.rows[0].allowed).toBe(allowed);
  });

  it.each([
    [
      'https://ticketimage.interpark.com/Play/image/large/26/26015253_p.gif',
      true,
    ],
    [
      'https://ticketimage.interpark.com/Play/image/large/26/26015254_p.gif',
      false,
    ],
    ['https://evil.example/Play/image/large/26/26015253_p.gif', false],
    [
      'https://ticketimage.interpark.com/Play/image/small/26/26015253_p.gif',
      false,
    ],
  ])(
    'permits only the same World product poster: %s',
    async (originUrl, allowed) => {
      const result = await client.query<{ allowed: boolean }>(
        `SELECT (false ${nolPolicy}) AS allowed
       FROM (SELECT $1::text AS url) source
       CROSS JOIN (SELECT $2::text AS "originUrl") image`,
        ['https://world.nol.com/en/ticket/products/26015253', originUrl],
      );
      expect(result.rows[0].allowed).toBe(allowed);
    },
  );
});
