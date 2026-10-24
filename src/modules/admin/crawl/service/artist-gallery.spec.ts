import {
  crawlArtistGallery,
  isOfficialModalContentType,
} from './artist-gallery';

const pageUrl = 'https://xmfestival.com/lineup';

function card(menu: string, base: string, image: string): string {
  return `<a class="item_container _item_container" href="javascript:SITE.openModalMenu('${menu}', '${base}');"><div class="img_wrap _img_wrap" data-src="${image}"></div></a>`;
}

function modal(name: string): string {
  return JSON.stringify({
    msg: 'SUCCESS',
    html: `<h4 class="modal-title">artist_${name}</h4>`,
  });
}

describe('crawlArtistGallery', () => {
  it('accepts the official JSON envelope served as text/html while rejecting unrelated types', () => {
    expect(isOfficialModalContentType('text/html; charset=utf-8')).toBe(true);
    expect(isOfficialModalContentType('application/json; charset=utf-8')).toBe(
      true,
    );
    expect(isOfficialModalContentType('image/png')).toBe(false);
    expect(isOfficialModalContentType(undefined)).toBe(false);
  });

  it('pairs each official gallery image with its modal title without fixed artist data', async () => {
    const html = [
      card(
        'm20260724ae5f50323537e',
        'm20260515e48379ee176f3',
        'https://cdn.imweb.me/thumbnail/20260811/354f5ae07ab1d.jpg',
      ),
      card(
        'm20260724bbbbb',
        'm20260515ccccc',
        'https://cdn.imweb.me/thumbnail/20260811/other.webp',
      ),
    ].join('');
    const fetchModal = jest
      .fn()
      .mockResolvedValueOnce(modal('Ado'))
      .mockResolvedValueOnce(modal('B&amp;B &#xB7; Live'));

    const entries = await crawlArtistGallery(html, pageUrl, fetchModal);

    expect(fetchModal.mock.calls).toEqual([
      ['m20260724ae5f50323537e', 'm20260515e48379ee176f3'],
      ['m20260724bbbbb', 'm20260515ccccc'],
    ]);
    expect(
      entries.map(({ artistName, imageUrl }) => [artistName, imageUrl.href]),
    ).toEqual([
      ['Ado', 'https://cdn.imweb.me/thumbnail/20260811/354f5ae07ab1d.jpg'],
      ['B&B · Live', 'https://cdn.imweb.me/thumbnail/20260811/other.webp'],
    ]);
    expect(entries.map((entry) => entry.officialSiteKeys)).toEqual([[], []]);
  });

  it('rejects non-CDN and insecure URLs before requesting a modal', async () => {
    const fetchModal = jest.fn().mockResolvedValue(modal('Good'));
    const html = [
      card('m1', 'b1', 'http://cdn.imweb.me/photo.jpg'),
      card('m2', 'b2', 'https://cdn.imweb.me.evil.test/photo.jpg'),
      card('m3', 'b3', 'https://cdn.imweb.me:444/photo.jpg'),
      card('m4', 'b4', 'https://cdn.imweb.me/photo.jpg'),
    ].join('');

    await expect(crawlArtistGallery(html, pageUrl, fetchModal)).rejects.toThrow(
      '카드 이미지를 확인하지 못했습니다',
    );
    expect(fetchModal).not.toHaveBeenCalled();
    expect(
      await crawlArtistGallery(html, 'https://evil.test/lineup', fetchModal),
    ).toEqual([]);
  });

  it('fails a partial gallery when a modal cannot establish an artist name', async () => {
    const html = [1, 2, 3, 4]
      .map((index) =>
        card(`m${index}`, `b${index}`, `https://cdn.imweb.me/${index}.jpg`),
      )
      .join('');
    const fetchModal = jest
      .fn()
      .mockResolvedValueOnce(
        JSON.stringify({
          msg: 'FAIL',
          html: '<h4 class="modal-title">artist_Bad</h4>',
        }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({ msg: 'SUCCESS', html: '<h4>artist_Bad</h4>' }),
      )
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(modal('Valid'));

    await expect(crawlArtistGallery(html, pageUrl, fetchModal)).rejects.toThrow(
      '일부를 확인하지 못했습니다',
    );
  });

  it('retains only HTTPS site identity keys from the same official artist modal', async () => {
    const html = card('m1', 'b1', 'https://cdn.imweb.me/thumbnail/mika.jpg');
    const payload = JSON.stringify({
      msg: 'SUCCESS',
      html: `<h4 class="modal-title">artist_MIKA</h4>
        <a href="https://www.mikanakashima.com">Official Site</a>
        <a href="http://mikanakashima.com">Insecure</a>
        <a href="https://mikanakashima.evil.test">Unrelated</a>`,
    });
    await expect(
      crawlArtistGallery(html, pageUrl, () => Promise.resolve(payload)),
    ).resolves.toMatchObject([
      { artistName: 'MIKA', officialSiteKeys: ['mikanakashima'] },
    ]);
  });

  it('reads an official modal with its full page layout', async () => {
    const html = card('m1', 'b1', 'https://cdn.imweb.me/thumbnail/new.jpg');
    const fullModal = JSON.stringify({
      msg: 'SUCCESS',
      html: `${' '.repeat(500_000)}<h4 class="modal-title">artist_Ado</h4>`,
    });
    await expect(
      crawlArtistGallery(html, pageUrl, () => Promise.resolve(fullModal)),
    ).resolves.toMatchObject([{ artistName: 'Ado' }]);
  });

  it('rejects oversized galleries before any modal request', async () => {
    const html = Array.from({ length: 60 }, (_, index) =>
      card(`m${index}`, `b${index}`, `https://cdn.imweb.me/${index}.jpg`),
    ).join('');
    const fetchModal = jest.fn().mockResolvedValue(modal('Act'));

    await expect(crawlArtistGallery(html, pageUrl, fetchModal)).rejects.toThrow(
      '카드 수가 허용 범위를 초과했습니다',
    );
    expect(fetchModal).not.toHaveBeenCalled();
  });
});
