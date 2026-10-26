# CDF ONEWE 공식 그룹 사진 (#139)

- 출처는 `https://oneweofficial.jp/profile`이다. 기존 RBW Japan 소스는 마이그레이션에서 새 URL로 전환한다.
- 프로필 페이지의 `members__list` 안에서 이름이 정확히 `ONEWE`인 `member` 카드가 하나일 때만 해당 카드의 `member__avatar` 이미지 하나를 선택한다. 구성원 개인 카드와 메타 이미지는 사용하지 않는다.
- 이미지 URL은 매 실행 시 HTML에서 읽는다. HTTPS, `storage.googleapis.com`, `/image.fanicon.net/cms/`의 JPG 경로를 검증하고 robots 규칙을 확인한 뒤 기존 이미지 저장 경로로 처리한다.
- 공개 API는 저장된 이미지 중 CDF 소스 URL, 아티스트와 공식 계정, 이미지 원본 URL이 모두 일치할 때만 제공한다.
- 카드 누락, 중복, 이름 변조, 다른 호스트 및 경로, 쿼리는 사진을 게시하지 않는 결과로 처리한다.
