import { Controller, Get, Header } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../auth/decorator/public.decorator';

const style = `
  :root{color-scheme:light;font-family:system-ui,-apple-system,"Apple SD Gothic Neo",sans-serif}
  *{box-sizing:border-box}body{margin:0;background:#f7f8fa;color:#17212f;line-height:1.7}
  main{max-width:760px;margin:0 auto;padding:48px 24px 80px}
  nav{display:flex;gap:18px;flex-wrap:wrap;margin-bottom:56px}
  a{color:#1455b1}nav a{text-decoration:none;font-weight:600}
  h1{font-size:clamp(30px,5vw,48px);line-height:1.2;margin:0 0 20px}
  h2{font-size:21px;margin:40px 0 12px}p,li{font-size:16px}
  ul{padding-left:22px}.eyebrow{font-size:13px;font-weight:700;letter-spacing:.08em;color:#466287}
  footer{border-top:1px solid #d8dfe8;margin-top:64px;padding-top:20px;color:#546277;font-size:14px}
`;

function page(title: string, content: string): string {
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="index,follow"><title>${title} | 패스티코어</title><style>${style}</style></head>
<body><main><nav aria-label="주요 메뉴"><a href="/api/v1/about">패스티코어</a><a href="/api/v1/legal/privacy">개인정보처리방침</a><a href="/api/v1/legal/terms">이용약관</a></nav>
${content}<footer>© FESTICORE · <a href="https://github.com/FESTICORE/FestiCore-Backend/issues/new">서비스 문의</a></footer></main></body></html>`;
}

const about = page(
  '서비스 소개',
  `<p class="eyebrow">FESTICORE</p><h1>축제의 하루를 한곳에서</h1>
  <p>패스티코어는 국내 축제의 일정, 장소, 출연진, 공연 시간표를 확인하고 관심 있는 축제를 저장할 수 있는 서비스입니다. 공개된 축제 정보는 네트워크가 불안정할 때에도 앱에서 다시 볼 수 있도록 제공됩니다.</p>
  <p>Google 또는 Apple 계정으로 로그인하면 축제 즐겨찾기와 알림 설정을 계정에 연결할 수 있습니다. Google 로그인에서는 계정 식별 정보와 제공된 이메일·프로필 정보를 로그인과 계정 관리에 사용합니다.</p>
  <p><a href="/api/v1/legal/privacy">개인정보처리방침</a>과 <a href="/api/v1/legal/terms">이용약관</a>에서 자세한 내용을 확인하세요.</p>`,
);

const privacy = page(
  '개인정보처리방침',
  `<p class="eyebrow">FESTICORE · 2026-10</p><h1>개인정보처리방침</h1>
  <p>패스티코어는 축제 정보 제공, 로그인, 관심 축제 저장, 알림 제공을 위해 아래 정보를 처리합니다.</p>
  <h2>처리하는 정보와 목적</h2>
  <ul><li>Google·Apple 로그인: 제공자가 발급한 계정 식별자, 제공된 이메일·이름 또는 닉네임·프로필 사진 주소를 계정 생성과 로그인에 사용합니다. Google 비밀번호는 받지 않습니다.</li>
  <li>앱 기기 등록: 기기 식별자, 푸시 토큰, 앱·운영체제 버전, 언어, 시간대를 알림 전달과 기기 설정에 사용합니다.</li>
  <li>축제 이용: 관심 축제, 알림 구독, 앱에서 작성한 축제 관련 활동을 해당 기능 제공에 사용합니다.</li>
  <li>선택적 관측 이벤트: 앱 시작·화면 열람·오프라인 이용 등 이벤트와 기기 식별자를 서비스 품질 개선에 사용합니다. 이벤트 수집 API는 IP 주소와 인증 토큰을 이벤트 데이터로 저장하지 않습니다.</li></ul>
  <h2>Google 계정 정보</h2><p>Google 로그인에서 받은 정보는 로그인과 계정 표시를 위해서만 사용합니다. Google 연락처, Drive, Gmail 데이터에 접근하지 않습니다. 계정 정보를 광고 목적으로 판매하지 않습니다.</p>
  <h2>보관과 삭제</h2><p>계정 정보는 서비스 이용 중 보관하며, 회원 탈퇴 시 계정과 연결된 정보의 삭제를 요청할 수 있습니다. 기기 등록 및 알림 구독은 앱의 기기 삭제 기능으로 별도 삭제할 수 있습니다.</p>
  <h2>외부 서비스</h2><p>로그인에는 Google 또는 Apple을, 앱 운영 인프라에는 Railway를, iOS 알림 전달에는 Apple Push Notification service를 사용합니다. 각 서비스로 전달되는 정보는 로그인 확인 또는 요청한 기능 제공에 필요한 범위로 제한합니다.</p>
  <h2>이용자의 권리와 문의</h2><p>앱에서 계정 정보 확인·수정, 알림 설정 변경, 기기 등록 삭제, 회원 탈퇴를 할 수 있습니다. 개인정보 처리 문의는 <a href="https://github.com/FESTICORE/FestiCore-Backend/issues/new">패스티코어 문의 창구</a>로 보내주세요.</p>`,
);

const terms = page(
  '이용약관',
  `<p class="eyebrow">FESTICORE · 2026-10</p><h1>서비스 이용약관</h1>
  <h2>서비스</h2><p>패스티코어는 축제 일정·장소·출연진·시간표와 관심 축제 저장, 알림 등 기능을 제공합니다. 축제 정보는 주최 측이나 예매처의 변경 사항이 반영되기 전까지 실제 현장 정보와 다를 수 있으므로 중요한 일정은 공식 안내를 함께 확인해 주세요.</p>
  <h2>계정과 이용</h2><p>Google 또는 Apple 계정으로 로그인할 수 있습니다. 이용자는 계정과 기기 접근 수단을 안전하게 관리하고, 다른 이용자에게 피해를 주거나 서비스를 방해하는 행위를 해서는 안 됩니다.</p>
  <h2>알림과 변경</h2><p>축제 시작 및 정보 변경 알림은 기기 설정과 구독 상태에 따라 제공됩니다. 통신 상태와 외부 알림 서비스의 사정으로 전달이 지연되거나 누락될 수 있습니다. 서비스 기능이나 약관이 변경되면 앱 또는 이 페이지에서 알립니다.</p>
  <h2>탈퇴와 문의</h2><p>회원은 앱의 회원 탈퇴 기능으로 계정 삭제를 요청할 수 있습니다. 서비스 관련 문의는 <a href="https://github.com/FESTICORE/FestiCore-Backend/issues/new">패스티코어 문의 창구</a>로 보내주세요.</p>`,
);

@ApiExcludeController()
@Public()
@Controller()
export class LegalController {
  @Get('about')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=300')
  @Header(
    'Content-Security-Policy',
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  )
  about(): string {
    return about;
  }

  @Get('legal/privacy')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=300')
  @Header(
    'Content-Security-Policy',
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  )
  privacy(): string {
    return privacy;
  }

  @Get('legal/terms')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=300')
  @Header(
    'Content-Security-Policy',
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  )
  terms(): string {
    return terms;
  }
}
