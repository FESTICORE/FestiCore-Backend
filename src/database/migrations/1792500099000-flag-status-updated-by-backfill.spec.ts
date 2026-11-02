import { QueryRunner } from 'typeorm';
import { FlagStatusUpdatedByBackfill1792500099000 } from './1792500099000-flag-status-updated-by-backfill';

describe('Flag status updatedBy backfill', () => {
  it('fills only empty authors from the latest non-null status event', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const migration = new FlagStatusUpdatedByBackfill1792500099000();
    await migration.up({ query } as unknown as QueryRunner);
    const sql = (query.mock.calls[0] as [string])[0];
    expect(sql).toContain('DISTINCT ON ("flagId")');
    expect(sql).toContain('ORDER BY "flagId", "createdAt" DESC, "id" DESC');
    expect(sql).toContain('latest."userId" IS NOT NULL');
    expect(sql).toContain('f."statusUpdatedBy" IS NULL');
    await migration.down();
    expect(query).toHaveBeenCalledTimes(1);
  });
});
