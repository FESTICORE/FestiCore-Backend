import { parseApprovedCommonsProfile } from './commons-approved-profile';

const fileKey = 'File:Artist Name 2026.jpg';
const pageUrl = 'https://commons.wikimedia.org/wiki/File:Artist_Name_2026.jpg';
const original =
  'https://upload.wikimedia.org/wikipedia/commons/a/ab/Artist_Name_2026.jpg';
const expected = {
  fileKey,
  author: 'Jane Photographer',
  license: 'CC BY 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0',
};

const html = `<h1 id="firstHeading">File:Artist Name 2026.jpg</h1>
  <div class="fullImageLink" id="file"><a href="${original}?utm_source=commons.wikimedia.org&amp;utm_content=original"><img alt="original"></a></div>
  <td id="fileinfotpl&#95;aut" class="fileinfo-paramfield">Author</td><td><a href="/wiki/User:Jane">Jane Photographer</a></td>
  <span class="licensetpl&#95;link">https://creativecommons.org/licenses/by/4.0</span>
  <span class="licensetpl&#95;short">CC BY 4.0</span>`;

describe('Commons 승인 사진 파일 페이지 검증', () => {
  it('원본 파일과 저작자·단일 CC BY 라이선스를 확인하고 출처를 돌려준다', () => {
    expect(parseApprovedCommonsProfile(html, pageUrl, expected)).toEqual({
      imageUrl: new URL(original),
      credit: {
        author: 'Jane Photographer',
        license: 'CC BY 4.0',
        licenseUrl: 'https://creativecommons.org/licenses/by/4.0',
        sourceUrl: pageUrl,
      },
    });
  });

  it('관리자 입력의 끝 슬래시 유무와 Commons 표기를 같은 CC BY 주소로 검증한다', () => {
    expect(
      parseApprovedCommonsProfile(html, pageUrl, {
        ...expected,
        licenseUrl: `${expected.licenseUrl}/`,
      })?.credit.licenseUrl,
    ).toBe(expected.licenseUrl);
    expect(
      parseApprovedCommonsProfile(
        html.replace('by/4.0</span>', 'by/4.0/</span>'),
        pageUrl,
        expected,
      )?.credit.licenseUrl,
    ).toBe(expected.licenseUrl);
  });

  it('Commons 파일 URL의 인코딩된 공백과 CC BY 2.5 표기를 검증한다', () => {
    const ccBy25 = html
      .replaceAll('by/4.0', 'by/2.5')
      .replaceAll('CC BY 4.0', 'CC BY 2.5')
      .replace('class="licensetpl&#95;link"', 'class="licensetpl_link"');
    const encodedPage =
      'https://commons.wikimedia.org/wiki/File:Artist%20Name%202026.jpg';
    expect(
      parseApprovedCommonsProfile(ccBy25, encodedPage, {
        ...expected,
        license: 'CC BY 2.5',
        licenseUrl: 'https://creativecommons.org/licenses/by/2.5',
      }),
    ).toMatchObject({
      imageUrl: new URL(original),
      credit: { sourceUrl: encodedPage, license: 'CC BY 2.5' },
    });
  });

  it('실제 Commons 페이지의 제목·라이선스 검토·원본 링크 형태를 허용한다', () => {
    const sohyangPage =
      'https://commons.wikimedia.org/wiki/File:180212_%EC%86%8C%ED%96%A5.png';
    const sohyangOriginal =
      'https://upload.wikimedia.org/wikipedia/commons/4/49/180212_%EC%86%8C%ED%96%A5.png';
    const page = `<h1 id="firstHeading" class="firstHeading mw-first-heading"><span lang="en" dir="ltr"><span class="mw-page-title-namespace">File</span><span class="mw-page-title-separator">:</span><span class="mw-page-title-main">180212 소향.png</span></span></h1>
      <div class="fullImageLink" id="file"><a href="${sohyangOriginal}?utm_source=commons.wikimedia.org&amp;utm_campaign=index&amp;utm_content=original"><img alt="File:180212 소향.png"></a></div>
      <td id="fileinfotpl&#95;aut" class="fileinfo-paramfield" lang="en">Author</td><td>뉴스인스타</td>
      <span class="licensetpl&#95;link" style="display:none;">https://creativecommons.org/licenses/by/3.0</span><span class="licensetpl&#95;short" style="display:none;">CC BY 3.0 </span><span class="licensetpl&#95;link&#95;req" style="display:none;">true</span>
      <style>.mw-parser-output .license-review-failed{color:red}</style><table class="license-review-passed"><tr><td>Commons:License review</td></tr></table>`;
    const review = {
      fileKey: 'File:180212 소향.png',
      author: '뉴스인스타',
      license: 'CC BY 3.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/3.0',
    };
    expect(parseApprovedCommonsProfile(page, sohyangPage, review)).toEqual({
      imageUrl: new URL(sohyangOriginal),
      credit: {
        author: '뉴스인스타',
        license: 'CC BY 3.0',
        licenseUrl: 'https://creativecommons.org/licenses/by/3.0',
        sourceUrl: sohyangPage,
      },
    });
    expect(
      parseApprovedCommonsProfile(
        page.replace('license-review-passed', 'license-review-needed'),
        sohyangPage,
        review,
      ),
    ).toBeNull();
    expect(
      parseApprovedCommonsProfile(
        page.replace('utm_campaign=index', 'utm_campaign=other'),
        sohyangPage,
        review,
      ),
    ).toBeNull();
  });

  it.each([
    html.replace('Jane Photographer</a>', 'Someone Else</a>'),
    html.replace('CC BY 4.0</span>', 'CC BY-SA 4.0</span>'),
    html.replace('licenses/by/4.0</span>', 'licenses/by-nc/4.0</span>'),
    html.replace('Artist Name 2026.jpg</h1>', 'Another Person.jpg</h1>'),
    html.replace('Artist_Name_2026.jpg?utm', 'Other.jpg?utm'),
    html.replace('upload.wikimedia.org', 'example.com'),
    html.replace('utm_content=original', 'utm_content=evil'),
    html + '<span class="licensetpl_short">CC BY 4.0</span>',
    html +
      '<span class="licensetpl_link">https://creativecommons.org/licenses/by/3.0</span>',
    html + '<div>Personality rights warning</div>',
    html + '<div>Deletion request</div>',
    html + '<table class="license-review-failed"></table>',
  ])('권리·인물·파일 또는 출처가 달라지면 거부한다', (body) => {
    expect(parseApprovedCommonsProfile(body, pageUrl, expected)).toBeNull();
  });

  it.each([
    'https://evil.example/wiki/File:Artist_Name_2026.jpg',
    'https://commons.wikimedia.org/wiki/File:Other.jpg',
    'https://commons.wikimedia.org/wiki/File:Artist_Name_2026.jpg?oldid=1',
    'http://commons.wikimedia.org/wiki/File:Artist_Name_2026.jpg',
  ])('파일 페이지 주소가 다르면 거부한다: %s', (url) => {
    expect(parseApprovedCommonsProfile(html, url, expected)).toBeNull();
  });

  it.each([
    { ...expected, license: 'CC BY-SA 4.0' },
    {
      ...expected,
      licenseUrl: 'https://creativecommons.org/licenses/by-nc/4.0',
    },
    { ...expected, license: 'CC BY 3.0' },
    { ...expected, fileKey: 'File:Other.jpg' },
  ])('승인 기록의 저작권·파일이 다르면 거부한다', (review) => {
    expect(parseApprovedCommonsProfile(html, pageUrl, review)).toBeNull();
  });
});
