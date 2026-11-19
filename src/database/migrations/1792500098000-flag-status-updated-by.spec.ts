import { QueryRunner } from 'typeorm';
import { FlagStatusUpdatedBy1792500098000 } from './1792500098000-flag-status-updated-by';

describe('Flag status updatedBy schema', () => {
  it('adds and drops the nullable status author column', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const runner = { query } as unknown as QueryRunner;
    const migration = new FlagStatusUpdatedBy1792500098000();
    await migration.up(runner);
    await migration.down(runner);
    expect(query.mock.calls.map(([sql]: [string]) => sql)).toEqual([
      'ALTER TABLE flags ADD COLUMN "statusUpdatedBy" uuid',
      'ALTER TABLE flags DROP COLUMN "statusUpdatedBy"',
    ]);
  });
});
