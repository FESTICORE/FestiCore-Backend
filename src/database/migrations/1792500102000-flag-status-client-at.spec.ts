import { QueryRunner } from 'typeorm';
import { FlagStatusClientAt1792500102000 } from './1792500102000-flag-status-client-at';

describe('Flag status clientAt schema', () => {
  it('adds and drops the nullable applied clientAt column', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const runner = { query } as unknown as QueryRunner;
    const migration = new FlagStatusClientAt1792500102000();
    await migration.up(runner);
    await migration.down(runner);
    expect(query.mock.calls.map(([sql]: [string]) => sql)).toEqual([
      'ALTER TABLE flags ADD COLUMN "statusClientAt" timestamptz',
      'ALTER TABLE flags DROP COLUMN "statusClientAt"',
    ]);
  });
});
