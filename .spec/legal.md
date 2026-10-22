# 공개 법적 문서

`GET /api/v1/legal/home`, `GET /api/v1/legal/privacy`, `GET /api/v1/legal/terms`는 인증 없이 `200 text/html`을 반환한다. Google OAuth 동의 화면에서 사용자에게 보이는 홈페이지·개인정보 처리 안내·이용약관 URL이다. JSON API의 `code/data/message` 응답 형식은 HTML 문서에는 적용하지 않는다.

홈페이지는 패스티코어 기능을 설명하고 같은 origin의 개인정보 처리 안내·이용약관으로 연결한다. 세 응답에는 `Cache-Control: public, max-age=3600` 및 제한적인 Content Security Policy를 설정한다.

Google 브랜딩 등록 전에 실제 배포 URL이 HTTPS로 접근되는지 확인한다. 공개 문서의 운영 주체, 문의처, 보유기간, 처리 위탁 현황, 효력일은 운영 사실 확인 뒤 확정한다.
