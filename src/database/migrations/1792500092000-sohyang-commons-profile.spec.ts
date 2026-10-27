import { QueryRunner } from 'typeorm';
import { SohyangCommonsProfile1792500092000 } from './1792500092000-sohyang-commons-profile';
import {
  SOHYANG_COMMONS_ARTIST,
  SOHYANG_COMMONS_PAGE,
  SOHYANG_COMMONS_SEED,
  SOHYANG_FESTIVAL_URL,
} from '../../modules/admin/crawl/service/sohyang-commons-profile';

const values = [
  SOHYANG_COMMONS_PAGE,
  SOHYANG_FESTIVAL_URL,
  SOHYANG_COMMONS_ARTIST,
  SOHYANG_COMMONS_SEED,
];

describe('소향 Commons 사진 소스 migration', () => {
  it('사진 URL 없이 일일 수집 소스를 중복 방지 등록한다', async () => {
    const query = jest.fn().mockResolvedValue([]);
    await new SohyangCommonsProfile1792500092000().up({
      query,
    } as unknown as QueryRunner);
    expect(query).toHaveBeenCalledTimes(2);
    for (const [sql, params] of query.mock.calls as [string, unknown[]][]) {
      expect(params).toEqual(values);
      expect(
        [
          ...new Set(
            [...sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1])),
          ),
        ].sort(),
      ).toEqual([1, 2, 3, 4]);
    }
    const insert = (query.mock.calls as [string, unknown[]][])[1][0];
    expect(insert).toContain('WHERE NOT EXISTS');
    expect(insert).toContain('1440');
    expect(insert).not.toMatch(/originUrl|imageHint|upload[.]wikimedia/);
  });

  it('비활성 또는 경쟁 소스를 유지하고 migration을 중단한다', async () => {
    const query = jest.fn().mockResolvedValueOnce([{ id: 'existing' }]);
    await expect(
      new SohyangCommonsProfile1792500092000().up({
        query,
      } as unknown as QueryRunner),
    ).rejects.toThrow('충돌하거나 비활성화된');
    expect(query).toHaveBeenCalledTimes(1);
  });
});
