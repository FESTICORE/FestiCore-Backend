import { QueryRunner } from 'typeorm';
import { SeoulProfileCatalogLink1792500079000 } from './1792500079000-seoul-profile-catalog-link';

describe('Seoul official profile catalog link migration', () => {
  it('moves only the reviewed Poclanos artist source to the catalog URL', async () => {
    const query = jest.fn().mockResolvedValue([]);
    await new SeoulProfileCatalogLink1792500079000().up({
      query,
    } as unknown as QueryRunner);
    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(
        /WHERE kind = 'artist-image' AND url = \$1[\s\S]*'festival-official-profile'[\s\S]*'추다해차지스'[\s\S]*'festivalSourceUrl' = \$2/,
      ),
      [
        'https://poclanos.com/artist/%EC%B6%94%EB%8B%A4%ED%98%9C%EC%B0%A8%EC%A7%80%EC%8A%A4/',
        'https://festival.seoul.go.kr/festival/main/festivalView.do?festacode=848',
        'https://ticket.yes24.com/Perf/60368',
      ],
    );
  });

  it('reverses only the same reviewed source', async () => {
    const query = jest.fn().mockResolvedValue([]);
    await new SeoulProfileCatalogLink1792500079000().down({
      query,
    } as unknown as QueryRunner);
    expect(query).toHaveBeenCalledWith(expect.any(String), [
      'https://poclanos.com/artist/%EC%B6%94%EB%8B%A4%ED%98%9C%EC%B0%A8%EC%A7%80%EC%8A%A4/',
      'https://ticket.yes24.com/Perf/60368',
      'https://festival.seoul.go.kr/festival/main/festivalView.do?festacode=848',
    ]);
  });
});
