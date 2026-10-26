# 원더리벳 공식 출연진 프로필 사진

원더리벳 상세·시간표에 사진이 없는 6명의 공식 프로필을 하루 간격의 `artist-image` 소스로 수집한다. 축제 키는 `https://www.wonderli.vet/lineup`이며, 출연진 이름은 저장된 시간표 표기와 일치해야 한다.

SUKIMASWITCH는 [Sony Music 공식 프로필](https://www.sonymusic.co.jp/artist/sukimaswitch/profile/)을 별도 소스로 추가한다. 페이지의 아티스트 이름과 프로필 이미지 속성을 확인한 뒤 현재 HTML에서 사진 주소를 추출한다. Sony Music의 `robots.txt`는 200으로 제공되며 FestiCore 크롤러 차단 규칙이 없다. [Office Augusta의 원더리벳 출연 공지](https://www.office-augusta.com/sukimaswitch/news/inffast?id=856)는 공연·시간 증거로만 사용한다. Office Augusta의 `robots.txt`는 홈페이지로 302 이동해 현재 크롤러의 robots 검사를 통과하지 못하므로 그 사이트의 사진을 수집하지 않는다. 사진 URL은 코드나 DB 소스 설정에 고정하지 않는다.

| 출연진 | 공식 페이지 | 사진 선택 근거 |
| --- | --- | --- |
| Hoshimachi Suisei | `https://hololive.hololivepro.com/talents/hoshimachi-suisei/` | 페이지 제목, `og:url`, 단일 `og:image` |
| Ai Otsuka | `https://www.avex.jp/ai/profile/` | 제목, 아티스트 이름, `profGroup__mainImg img[data-src]` |
| Tomatomat | `https://poclanos.com/artist/토마토맛/` | 제목, 아티스트 이름, `artist-img-wrap img[src]` |
| SONG SOHEE | `https://poclanos.com/artist/송소희/` | 동일 |
| HANRORO | `https://poclanos.com/artist/한로로/` | 동일 |
| A I W E O | `https://poclanos.com/artist/아이우에오/` | 동일 |

수집할 때마다 HTML에서 현재 사진 URL을 읽는다. 사진 주소·파일명은 DB 소스 설정이나 코드에 넣지 않는다. 허용된 공식 이미지 호스트와 경로, HTTPS, 검색 문자열이 없는 URL, robots 정책, 이미지 응답 MIME·크기·디코딩을 확인한 뒤 서버의 이미지 저장소에 보관한다. 공개 조회와 이미지 다운로드에는 같은 소스·축제·출연진·원본 이미지 조건을 적용한다. 페이지 정체성이나 선택 결과가 모호하면 사진을 게시하지 않는다.

검증은 파서·소스 생성·실행·마이그레이션·공개 정책 단위 테스트, 빌드와 린트, 배포 후 실제 수집 및 공개 API 조회로 한다. 공식 프로필의 이미지 재배포 허락은 별도로 확인되지 않았다.
