import {
  commonsFileUrl,
  commonsSearchUrl,
  dailyCommonsTargets,
  parseCommonsFile,
  parseCommonsSearch,
} from './commons-image-discovery';

describe('Commons 비공개 이미지 후보 탐색', () => {
  const file = {
    id: 66424595,
    key: 'File:180212_소향.png',
    title: 'File:180212 소향.png',
    mimeType: 'image/png',
  };

  it('고정 공식 API에서 원래 출연진 이름으로만 검색한다', () => {
    const url = commonsSearchUrl('소향');
    expect(url.hostname).toBe('api.wikimedia.org');
    expect(url.searchParams.get('q')).toBe('소향 filetype:bitmap');
    expect(url.searchParams.get('limit')).toBe('20');
    expect(commonsFileUrl(file.key).pathname).toContain(
      '/core/v1/commons/file/',
    );
    expect(() => commonsFileUrl('https://evil.example/a')).toThrow();
  });

  it('이미지 외 결과는 건너뛰고 후보 수를 제한한다', () => {
    const pages = [
      {
        id: 1,
        key: 'File:Song.ogg',
        title: 'File:Song.ogg',
        thumbnail: { mimetype: 'audio/ogg' },
      },
      ...Array.from({ length: 6 }, (_, index) => ({
        id: index + 2,
        key: `File:소향${index}.png`,
        title: `File:소향${index}.png`,
        thumbnail: { mimetype: 'image/png' },
      })),
    ];
    expect(parseCommonsSearch(JSON.stringify({ pages }))).toHaveLength(2);
    expect(parseCommonsSearch('{"pages":[]}')).toEqual([]);
    expect(() =>
      parseCommonsSearch('{"error":{"code":"rate-limit"}}'),
    ).toThrow();
    expect(() => parseCommonsSearch('{')).toThrow();
    expect(() =>
      parseCommonsSearch(JSON.stringify({ pages: Array(21).fill(pages[1]) })),
    ).toThrow();
  });

  it('원본과 파일 페이지의 호스트를 고정하고 권리를 미확인으로 기록한다', () => {
    const body = JSON.stringify({
      title: '180212 소향.png',
      file_description_url:
        '//commons.wikimedia.org/wiki/File:180212_%EC%86%8C%ED%96%A5.png',
      original: {
        mediatype: 'BITMAP',
        size: 1234,
        url: 'https://upload.wikimedia.org/wikipedia/commons/a/a0/a.png',
      },
    });
    expect(parseCommonsFile(body, file)).toMatchObject({
      status: 'pending',
      author: null,
      license: null,
      rightsStatus: 'unverified',
      mimeType: 'image/png',
    });
    expect(() =>
      parseCommonsFile(
        body.replace('upload.wikimedia.org', 'evil.example'),
        file,
      ),
    ).toThrow();
    expect(() =>
      parseCommonsFile(body.replace('180212 소향.png', '다른 사람.png'), file),
    ).toThrow();
    expect(() =>
      parseCommonsFile(body.replace('BITMAP', 'AUDIO'), file),
    ).toThrow();
    expect(() =>
      parseCommonsFile(body.replace('/a.png', '/a.tiff'), file),
    ).toThrow();
  });

  it('40명 초과 시 매일 다른 대상을 선택하고 유예 수를 보존한다', () => {
    const targets = Array.from({ length: 50 }, (_, index) => index);
    const first = dailyCommonsTargets(targets, '2026-10-28');
    const next = dailyCommonsTargets(targets, '2026-10-29');
    expect(first.selected).toHaveLength(40);
    expect(first.deferredCount).toBe(10);
    expect(first.selected).not.toEqual(next.selected);
  });
});
