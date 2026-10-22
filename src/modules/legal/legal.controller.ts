import { Controller, Get, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../auth/decorator/public.decorator';

const basePath = '/api/v1/legal';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character];
  });
}

function page(title: string, content: string): string {
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="index,follow"><title>${escapeHtml(title)} | 패스티코어</title>
<style>body{margin:0;background:#f8fafc;color:#192334;font:16px/1.75 system-ui,-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",sans-serif}main{max-width:760px;margin:0 auto;padding:48px 24px 80px}nav{display:flex;flex-wrap:wrap;gap:18px;border-bottom:1px solid #dbe1e8;padding-bottom:20px}a{color:#18509b}h1{font-size:2rem;line-height:1.3;margin:40px 0 24px}h2{font-size:1.25rem;margin:36px 0 12px}p,li{margin:0 0 12px}ul{padding-left:24px}.lead{font-size:1.125rem;color:#45556c}.notice{padding:16px;background:#fff6e7;border:1px solid #f2d6a2;border-radius:8px}footer{margin-top:56px;padding-top:16px;border-top:1px solid #dbe1e8;color:#667588;font-size:.875rem}</style></head>
<body><main><nav aria-label="패스티코어 문서"><a href="${basePath}/home">홈</a><a href="${basePath}/privacy">개인정보처리방침</a><a href="${basePath}/terms">서비스 이용약관</a></nav>
<h1>${escapeHtml(title)}</h1>${content}<footer>패스티코어 · FestiCore</footer></main></body></html>`;
}

const home = page(
  '축제의 하루를 한눈에, 패스티코어',
  `<p class="lead">패스티코어는 축제 일정과 공연 정보를 확인하고, 관심 공연을 저장하고, 현장에서 함께할 사람과 소통할 수 있도록 돕는 서비스입니다.</p>
<h2>서비스 소개</h2><ul><li>축제 목록, 상세 정보와 타임테이블 조회</li><li>관심 공연 일정 저장 및 오프라인에서 볼 수 있는 축제 정보</li><li>축제 알림, 깃발과 크루 기능</li></ul>
<p>서비스 이용에 관한 문서는 <a href="${basePath}/terms">이용약관</a>과 <a href="${basePath}/privacy">개인정보처리방침</a>에서 확인할 수 있습니다.</p>`,
);

const privacy = page(
  '개인정보처리방침',
  `<p class="lead">패스티코어 운영팀은 서비스에서 처리하는 개인정보와 사용 목적을 다음과 같이 안내합니다.</p>
<h2>처리하는 정보</h2><p>Google 또는 Apple 로그인 시 제공되는 계정 식별자와, 제공 범위에 따른 이메일·프로필 정보가 저장될 수 있습니다. 회원이 설정한 닉네임, 약관 동의 시각·버전과 선택 알림 설정을 처리합니다. 로그인 제공자 연결 해제를 위해 제공자의 재발급 토큰과 클라이언트 식별자를 저장할 수 있으며, 앱 인증에 사용되는 재발급 토큰도 처리합니다.</p>
<p>알림을 등록한 기기의 식별자, 앱·운영체제 버전, 언어·시간대, APNs 및 Live Activity 푸시 토큰을 처리합니다. 회원이 저장한 공연 일정과 축제 구독, 깃발·크루 활동과 신고 내용, 클라이언트 관측 이벤트도 기능 제공을 위해 처리합니다.</p>
<h2>이용 목적</h2><p>계정 인증과 회원 관리, 축제 일정 제공, 관심 정보 동기화, 요청한 알림 발송, 현장 소통 기능 제공, 서비스 오류 확인과 운영에 사용합니다.</p>
<h2>Google 사용자 정보</h2><p>Google 로그인에서 접근하는 정보는 계정 식별자와 사용자가 허용한 이메일 및 기본 프로필입니다. 이 정보는 로그인 확인, 계정 연결과 프로필 표시에 사용하고 서비스 데이터베이스에 저장합니다. Google 계정 식별자와 이메일을 다른 이용자에게 공개하지 않습니다.</p>
<h2>보유 기간</h2><p>회원 계정과 로그인 정보는 회원 탈퇴 시까지, 기기 등록과 축제 구독 정보는 기기 삭제 또는 회원 탈퇴 시까지 보유합니다. 법령에 따라 별도 보존이 필요한 정보는 해당 법령이 정한 기간 동안만 보존합니다. 서비스 관측 이벤트는 기기 식별자와 연결되어 저장되며 기기 삭제 또는 연결 계정 탈퇴 시 삭제합니다.</p>
<h2>외부 서비스 및 공유</h2><p>Google과 Apple은 소셜 로그인 인증에 사용합니다. Railway의 서버·데이터베이스·이미지 저장 인프라에서 서비스 정보를 처리하며, Apple Push Notification service를 이용해 요청한 기기에 알림을 전송합니다. 다른 이용자에게는 계정 식별자와 이메일을 공개하지 않습니다.</p>
<h2>정보 삭제와 권리 행사</h2><p>회원은 앱의 회원 탈퇴 기능으로 계정 삭제를 요청할 수 있습니다. 탈퇴 시 로그인 토큰을 폐기하고 계정 및 연결된 기기·구독 정보를 삭제하며, 일부 활동 이력은 계정 식별 정보를 제거합니다. 기기 등록과 구독도 기기 API에서 삭제할 수 있습니다. 개인정보 열람·정정·삭제·처리정지에 관한 요청은 아래 문의처로 접수할 수 있습니다.</p>
<h2>안전성 확보</h2><p>전송 구간 암호화, 접근 권한 제한, 인증 정보 보호와 운영 로그 점검을 적용합니다.</p>
<h2>문의 및 시행일</h2><p>운영: 패스티코어 운영팀<br>개인정보 문의: <a href="mailto:suhwj81@gmail.com">suhwj81@gmail.com</a><br>시행일: 2026년 10월 22일</p>`,
);

const terms = page(
  '서비스 이용약관',
  `<p class="lead">패스티코어의 축제 정보 및 현장 소통 기능을 이용할 때 적용되는 기본 규칙입니다.</p>
<h2>서비스</h2><p>패스티코어는 축제 목록과 상세 정보, 타임테이블, 일정 저장, 알림, 깃발과 크루 기능을 제공합니다. 축제 정보는 외부 공개 정보와 운영자 확인 결과를 바탕으로 갱신되며 현장의 실제 일정과 다를 수 있습니다. 방문 전 주최 측의 최신 공지를 확인해 주세요.</p>
<h2>이용자의 책임</h2><p>다른 이용자의 권리를 침해하거나 허위 정보를 등록하는 행위, 서비스의 정상적인 운영을 방해하는 행위는 허용되지 않습니다. 깃발·크루 기능에는 다른 이용자에게 공개되는 정보가 포함될 수 있으므로 공유할 내용을 확인해 주세요.</p>
<h2>계정과 알림</h2><p>Google 또는 Apple 계정으로 로그인할 수 있습니다. 기기 알림은 기기 등록과 축제별 구독 설정에 따라 제공되며 기기에서 변경할 수 있습니다. 계정 탈퇴 기능을 제공합니다.</p>
<h2>변경 안내</h2><p>서비스 기능이나 약관이 변경되면 새로운 버전을 서비스에서 안내합니다.</p>
<h2>문의 및 효력</h2><p>운영: 패스티코어 운영팀<br>서비스 문의: <a href="mailto:suhwj81@gmail.com">suhwj81@gmail.com</a><br>시행일: 2026년 10월 22일</p><p>이 약관은 대한민국 법률을 따르며, 분쟁은 먼저 협의로 해결합니다.</p>`,
);

@ApiExcludeController()
@Public()
@Controller('legal')
export class LegalController {
  private send(response: Response, html: string): void {
    response
      .status(200)
      .type('html')
      .set('Cache-Control', 'public, max-age=3600')
      .set(
        'Content-Security-Policy',
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
      )
      .send(html);
  }

  @Get('home')
  home(@Res() response: Response): void {
    this.send(response, home);
  }

  @Get('privacy')
  privacy(@Res() response: Response): void {
    this.send(response, privacy);
  }

  @Get('terms')
  terms(@Res() response: Response): void {
    this.send(response, terms);
  }
}
