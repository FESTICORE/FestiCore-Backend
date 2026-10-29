import { QueryRunner } from 'typeorm';
import { WonderlivetPublicBundleLineup1792500090000 } from './1792500090000-wonderlivet-public-bundle-lineup';

describe('Wonderlivet public bundle gallery migration', () => {
  it('registers the public gallery idempotently while retaining the disabled API source', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const runner = { query } as unknown as QueryRunner;

    await new WonderlivetPublicBundleLineup1792500090000().up(runner);

    expect(query).toHaveBeenCalledTimes(1);
    const [[sql, parameters]] = query.mock.calls as [string, string[]][];
    expect(sql).toContain('WHERE NOT EXISTS');
    expect(sql).toContain("true, 'ok'");
    expect(parameters).toEqual(['https://www.wonderli.vet/lineup']);
    expect(sql).not.toContain('api/trpc');
  });
});
