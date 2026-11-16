import { NotFoundException } from '@nestjs/common';
import { publicFestivalTestDataSource } from '../../../test/public-festival-test-data-source';
import { PublicFestivalService } from './public-festival.service';

describe('PublicFestivalService hidden and aliased catalog entries', () => {
  const today = new Date('2026-11-16T00:00:00Z');
  const dance = 'fst_f864aa29fdde4c6e';
  const magic = 'fst_1411d33669e8acd5';
  const somethingNewYes24 = 'fst_1f4d52004988a8b4';
  const somethingNewNol = 'fst_3224612795ec9b7d';

  function discovered(id: string) {
    return {
      id,
      name: id,
      venue: '공연장',
      firstDate: '2026-12-01',
      lastDate: '2026-12-01',
      sortAt: '2026-12-01T00:00:00+09:00',
      packVersion: 0,
      flagsEnabled: false,
      thumbUrl: null,
      ticketLinks: [],
      status: 'discovered',
      sourceUrl: `https://example.com/${id}`,
      sourceUrls: [`https://example.com/${id}`],
    };
  }

  function makeService(rows: object[] = [], catalog?: string[]) {
    const builder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(rows),
    };
    const findOne = jest.fn().mockResolvedValue(null);
    const service = new PublicFestivalService(
      { createQueryBuilder: () => builder, findOne } as never,
      {} as never,
      publicFestivalTestDataSource(jest.fn().mockResolvedValue([])) as never,
      {} as never,
    );
    const internals = service as unknown as {
      discoveryCatalog: () => Promise<object[]>;
      attachStoredImages: () => Promise<unknown>;
      discoveryDetail: (id: string) => Promise<unknown>;
    };
    jest
      .spyOn(internals, 'discoveryCatalog')
      .mockResolvedValue(
        (
          catalog ?? [
            dance,
            magic,
            somethingNewYes24,
            somethingNewNol,
            'fst_music',
          ]
        ).map(discovered),
      );
    jest.spyOn(internals, 'attachStoredImages').mockResolvedValue(new Map());
    const discoveryDetail = jest
      .spyOn(internals, 'discoveryDetail')
      .mockResolvedValue({ id: 'detail' });
    return { service, findOne, discoveryDetail, builder };
  }

  it('목록에서 축제가 아닌 항목과 중복 별칭을 뺀다', async () => {
    const { service } = makeService();
    const page = await service.list(undefined, '10', today);
    expect(page.items.map((item) => item.id)).toEqual([
      somethingNewNol,
      'fst_music',
    ]);
  });

  it('숨긴 항목의 상세와 발견 요약은 찾을 수 없다', async () => {
    const { service, findOne, discoveryDetail } = makeService();
    for (const id of [dance, magic]) {
      await expect(service.detail(id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.discovered(id)).resolves.toBeNull();
    }
    expect(findOne).not.toHaveBeenCalled();
    expect(discoveryDetail).not.toHaveBeenCalled();
  });

  it('중복 별칭의 상세는 대표 축제로 연결한다', async () => {
    const { service, discoveryDetail } = makeService();
    await service.detail(somethingNewYes24);
    expect(discoveryDetail).toHaveBeenCalledWith(somethingNewNol);
    await expect(service.discovered(somethingNewYes24)).resolves.toBeNull();
  });

  function publishedRow(id: string, date: string | null) {
    return {
      id,
      publishedVersion: 1,
      published: {
        name: id,
        venue: '공연장',
        flagsEnabled: false,
        days: date ? [{ date }] : [],
      },
    };
  }

  it('별칭·숨김 축제는 목록 SQL에서 뺀다', async () => {
    const { service, builder } = makeService([], []);
    await service.list(undefined, '10', today);
    const calls = builder.andWhere.mock.calls as [
      string,
      { excludedIds?: string[] }?,
    ][];
    const excluded = calls.find(
      ([sql]) => sql === 'festival.id NOT IN (:...excludedIds)',
    );
    expect(excluded?.[1]?.excludedIds).toEqual(
      expect.arrayContaining([somethingNewYes24, dance, magic]),
    );
  });

  it('읽은 행이 limit보다 많으면 걸러져 줄어도 다음 커서를 준다', async () => {
    const { service } = makeService(
      [
        publishedRow('fst_a', '2026-11-10'),
        publishedRow('fst_broken', null),
        publishedRow('fst_b', '2026-11-09'),
      ],
      [],
    );
    const page = await service.list(undefined, '2', today);
    expect(page.items.map((item) => item.id)).toEqual(['fst_a', 'fst_b']);
    expect(page.nextCursor).not.toBeNull();
  });
});
