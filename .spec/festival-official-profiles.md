# 서울뮤직·원웨이 공식 출연진 사진 (#139)

서울뮤직 1명과 원웨이 2명의 누락 사진을 하루 간격의 `artist-image` 소스로 수집한다. 소스 설정에는 검증된 공식 페이지 URL, 축제 원본 URL, 저장된 출연진 이름과 `festival-official-profile` seed만 둔다.

| 축제 원본 URL | 저장 이름 | 검증된 공식 페이지 | 사진 선택 조건 |
| --- | --- | --- | --- |
| `https://festival.seoul.go.kr/festival/main/festivalView.do?festacode=848` | `추다해차지스` | [포크라노스 추다혜차지스](https://poclanos.com/artist/추다혜차지스/) | 포크라노스 제목과 H1이 `추다혜차지스`인 단일 `artist-img-wrap img[src]`. 저장된 행사 표기와 공식 페이지 표기를 별도로 고정한다. |
| `https://ticket.melon.com/performance/index.htm?prodId=213769` | `레비스탕스` | [LEVISTANCE About](https://www.levistance.com/about) | About 제목, `WE ARE LEVISTANCE.`와 `안녕하세요 레비스탕스입니다.`가 함께 있는 단일 페이지 섹션의 그룹 사진. 반응형 중복 이미지는 같은 URL일 때만 하나로 취급한다. |
| `https://ticket.melon.com/performance/index.htm?prodId=213769` | `히스플랜` | [HISPLAN](https://www.inhisplan.com/) | 제목과 팀 소개 문구를 확인한 뒤 `promo-photo-banner img[alt="히스플랜 팀"]` 하나만 선택한다. |

이미지 URL과 파일명은 코드나 소스 설정에 고정하지 않고 매 실행 시 HTML에서 읽는다. HTTPS, 페이지별 허용 이미지 호스트와 경로, 쿼리 없는 URL, robots 정책, 이미지 MIME·크기·디코딩을 확인한다. 공개 조회·다운로드는 등록된 페이지·축제·출연진·이미지 원본 조합만 허용한다. 신원 또는 사진 선택이 모호하면 저장·게시하지 않는다.

검증은 세 실제 페이지 HTML 선택, 소스 생성·실행·마이그레이션·공개 정책 회귀 테스트, 전체 CI, 배포 후 실제 저장 및 공개 API 조회로 나눈다. 코드와 CI 통과만으로 운영 DB에 사진이 저장되었다고 판단하지 않는다.
