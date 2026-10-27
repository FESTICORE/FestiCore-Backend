import {
  SOHYANG_COMMONS_ARTIST,
  SOHYANG_COMMONS_PAGE,
  SOHYANG_COMMONS_SEED,
  SOHYANG_FESTIVAL_URL,
  sohyangCommonsImageUrl,
  sohyangCommonsSourceFor,
} from './sohyang-commons-profile';

const config = {
  seed: SOHYANG_COMMONS_SEED,
  festivalSourceUrl: SOHYANG_FESTIVAL_URL,
  artistName: SOHYANG_COMMONS_ARTIST,
};
const image =
  'https://upload.wikimedia.org/wikipedia/commons/4/49/180212_%EC%86%8C%ED%96%A5.png';
const html = `<h1 id="firstHeading">File:180212 소향.png</h1>
  <div class="fullImageLink" id="file"><a href="${image}?utm_source=commons.wikimedia.org&amp;utm_content=original"><img alt="File:180212 소향.png"></a></div>
  <td id="fileinfotpl&#95;aut" class="fileinfo-paramfield" lang="en">Author</td><td>뉴스인스타</td>
  <span class="licensetpl&#95;link" style="display:none;">https://creativecommons.org/licenses/by/3.0</span>
  <span class="licensetpl&#95;short" style="display:none;">CC BY 3.0 </span>
  who confirmed that it was available there under the stated license
  <a href="/wiki/Category:Sohyang" title="Category:Sohyang">Sohyang</a>`;

describe('소향 Commons 사진', () => {
  it('파일 페이지에서 검증된 CC BY 사진 원본 주소만 선택한다', () => {
    expect(sohyangCommonsSourceFor(SOHYANG_COMMONS_PAGE, config)).toBe(true);
    expect(
      sohyangCommonsImageUrl(html, SOHYANG_COMMONS_PAGE, config)?.href,
    ).toBe(image);
  });

  it.each([
    html.replace('뉴스인스타', '다른 저작자'),
    html.replace('CC BY 3.0', 'All rights reserved'),
    html.replace('licenses/by/3.0', 'licenses/by-nc/3.0'),
    html.replace(
      'who confirmed that it was available there under the stated license',
      '',
    ),
    html.replaceAll('Category:Sohyang', 'Category:Other'),
    html.replace('upload.wikimedia.org', 'evil.example'),
    html.replace('180212_%EC%86%8C%ED%96%A5.png?utm', 'other.png?utm'),
  ])('저작권·인물·원본 주소가 바뀌면 사진을 게시하지 않는다', (body) => {
    expect(
      sohyangCommonsImageUrl(body, SOHYANG_COMMONS_PAGE, config),
    ).toBeNull();
  });

  it('다른 축제나 이름에 사진을 연결하지 않는다', () => {
    expect(
      sohyangCommonsImageUrl(html, SOHYANG_COMMONS_PAGE, {
        ...config,
        artistName: '다른 소향',
      }),
    ).toBeNull();
    expect(
      sohyangCommonsImageUrl(html, SOHYANG_COMMONS_PAGE, {
        ...config,
        festivalSourceUrl:
          'https://ticket.melon.com/performance/index.htm?prodId=1',
      }),
    ).toBeNull();
  });
});
