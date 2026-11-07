import { QueryRunner } from 'typeorm';
import { TourApiSource1792500105000 } from './1792500105000-tourapi-source';
it('seeds the official API disabled without credentials', async () => {
  const query = jest.fn().mockResolvedValue([]);
  await new TourApiSource1792500105000().up({
    query,
  } as unknown as QueryRunner);
  const [sql, params] = query.mock.calls[0] as [string, string[]];
  expect(sql).toContain("false, 'disabled'");
  expect(params).toEqual([
    'https://apis.data.go.kr/B551011/KorService2/searchFestival2',
  ]);
});
