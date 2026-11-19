import { QueryRunner } from 'typeorm';
import { PrugioOfficialPortraits1792500106000 } from './1792500106000-prugio-official-portraits';
import { PRUGIO_LINEUP_URL } from '../../modules/admin/crawl/service/prugio-lineup';
import {
  PRUGIO_PORTRAIT_PAGE_URL,
  PRUGIO_PORTRAIT_SEED,
} from '../../modules/admin/crawl/service/prugio-portraits';

describe('Prugio official portrait gallery migration', () => {
  it('registers only the vetted Melon product and official roster pair', async () => {
    const query = jest.fn().mockResolvedValue([]);
    await new PrugioOfficialPortraits1792500106000().up({
      query,
    } as unknown as QueryRunner);
    expect(query).toHaveBeenCalledTimes(2);
    const calls = query.mock.calls as [string, string[]][];
    expect(calls[1][1]).toEqual([
      PRUGIO_PORTRAIT_PAGE_URL,
      PRUGIO_PORTRAIT_SEED,
      PRUGIO_LINEUP_URL,
    ]);
    expect(calls[1][0]).toContain('NOT EXISTS');
    expect(calls[1][0]).toContain("false, 'disabled'");
  });

  it('refuses a gallery already assigned to another festival', async () => {
    const query = jest.fn().mockResolvedValueOnce([{ id: 'conflict' }]);
    await expect(
      new PrugioOfficialPortraits1792500106000().up({
        query,
      } as unknown as QueryRunner),
    ).rejects.toThrow('충돌');
    expect(query).toHaveBeenCalledTimes(1);
  });
});
