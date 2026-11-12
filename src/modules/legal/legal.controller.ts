import { Controller, Get, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../auth/decorator/public.decorator';
import { LegalService } from './legal.service';

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
<body><main><nav aria-label="패스티코어 문서"><a href="${basePath}/home">홈</a><a href="${basePath}/privacy">개인정보처리방침</a><a href="${basePath}/terms">서비스 이용약관</a><a href="${basePath}/sources">정보 출처</a></nav>
<h1>${escapeHtml(title)}</h1>${content}<footer>패스티코어 · FestiCore</footer></main></body></html>`;
}

const home = page(
  '축제의 하루를 한눈에, 패스티코어',
  `<p class="lead">패스티코어는 축제 일정과 공연 정보를 확인하고, 관심 공연을 저장하고, 현장에서 함께할 사람과 소통할 수 있도록 돕는 서비스입니다.</p>
<h2>서비스 소개</h2><ul><li>축제 목록, 상세 정보와 타임테이블 조회</li><li>관심 공연 일정 저장 및 오프라인에서 볼 수 있는 축제 정보</li><li>축제 알림, 깃발과 크루 기능</li></ul>
<p>서비스 이용에 관한 문서는 <a href="${basePath}/terms">이용약관</a>과 <a href="${basePath}/privacy">개인정보처리방침</a>에서 확인할 수 있습니다.</p>`,
);

export function renderPrivacyContent(content: string): string {
  return content
    .trim()
    .split(/\n\s*\n/)
    .map((block, index) => {
      if (block.startsWith('## ')) {
        const [heading, ...bodyLines] = block.split('\n');
        return `<h2>${escapeHtml(heading.slice(3).trim())}</h2>${bodyLines.length ? `<p>${bodyLines.map(escapeHtml).join('<br>')}</p>` : ''}`;
      }
      const body = block.split('\n').map(escapeHtml).join('<br>');
      return `<p${index === 0 ? ' class="lead"' : ''}>${body}</p>`;
    })
    .join('\n');
}

const terms = page(
  '서비스 이용약관',
  `<p class="lead">패스티코어의 축제 정보 및 현장 소통 기능을 이용할 때 적용되는 기본 규칙입니다.</p>
<h2>서비스</h2><p>패스티코어는 축제 목록과 상세 정보, 타임테이블, 일정 저장, 알림, 깃발과 크루 기능을 제공합니다. 축제 정보는 외부 공개 정보와 운영자 확인 결과를 바탕으로 갱신되며 현장의 실제 일정과 다를 수 있습니다. 방문 전 주최 측의 최신 공지를 확인해 주세요.</p>
<h2>이용자의 책임</h2><p>다른 이용자의 권리를 침해하거나 허위 정보를 등록하는 행위, 서비스의 정상적인 운영을 방해하는 행위는 허용되지 않습니다. 깃발·크루 기능에는 다른 이용자에게 공개되는 정보가 포함될 수 있으므로 공유할 내용을 확인해 주세요.</p>
<h2>계정과 알림</h2><p>Google 또는 Apple 계정으로 로그인할 수 있습니다. 기기 알림은 기기 등록과 축제별 구독 설정에 따라 제공되며 기기에서 변경할 수 있습니다. 계정 탈퇴 기능을 제공합니다.</p>
<h2>변경 안내</h2><p>서비스 기능이나 약관이 변경되면 새로운 버전을 서비스에서 안내합니다.</p>
<h2>문의 및 효력</h2><p>운영: 패스티코어 운영팀<br>서비스 문의: <a href="mailto:suhwj81@gmail.com">suhwj81@gmail.com</a><br>시행일: 2026년 10월 22일</p><p>이 약관은 대한민국 법률을 따르며, 분쟁은 먼저 협의로 해결합니다.</p>`,
);

const sources = page(
  '정보 출처',
  `<p class="lead">패스티코어의 축제 정보는 아래의 공개 출처에서 모으고, 운영자가 확인한 뒤 앱에 보여 줍니다.</p>
<h2>축제 기본 정보</h2><ul><li>한국관광공사 TourAPI(공공데이터)의 행사 정보</li><li>주최 측 공식 웹사이트와 공지</li></ul>
<h2>라인업·시간표</h2><ul><li>주최 측 공식 공지와 공식 SNS</li><li>예매처(멜론티켓, YES24 티켓, NOL 티켓)의 공개 상품 정보</li></ul>
<h2>이미지</h2><p>주최 측이 공개한 공식 이미지와 위키미디어 공용(Wikimedia Commons)의 자유 이용 이미지를 씁니다. 위키미디어 공용 이미지는 각 이미지의 라이선스를 따릅니다.</p>
<h2>확인 시각</h2><p>앱의 정보 옆에는 출처와 마지막으로 확인한 시각이 함께 표시됩니다. 현장 일정은 주최 측 사정으로 바뀔 수 있으니 방문 전 주최 측의 최신 공지를 확인해 주세요.</p>
<h2>정보 오류 신고</h2><p>틀린 정보를 발견하면 <a href="mailto:suhwj81@gmail.com">suhwj81@gmail.com</a>으로 알려 주세요. 확인 후 고칩니다.</p>`,
);

@ApiExcludeController()
@Public()
@Controller('legal')
export class LegalController {
  constructor(private readonly legal: LegalService) {}

  private send(
    response: Response,
    html: string,
    cacheControl = 'public, max-age=3600',
  ): void {
    response
      .status(200)
      .type('html')
      .set('Cache-Control', cacheControl)
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
  async privacy(@Res() response: Response): Promise<void> {
    const document = await this.legal.privacy();
    this.send(
      response,
      page('개인정보처리방침', renderPrivacyContent(document.content)),
      'no-store',
    );
  }

  @Get('terms')
  terms(@Res() response: Response): void {
    this.send(response, terms);
  }

  @Get('sources')
  sources(@Res() response: Response): void {
    this.send(response, sources);
  }
}
