import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import type { Request, Response } from 'express';
import {
  ApiBody,
  ApiConsumes,
  ApiHeader,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../decorator/public.decorator';
import { WebOauthService } from '../web/web-oauth.service';

type Provider = 'apple';
const TICKET_COOKIE = 'festicore_web_login_ticket';

@ApiTags('Auth')
@Controller('auth')
export class WebOauthController {
  constructor(private readonly oauth: WebOauthService) {}

  private cookie(request: Request, name: string): string {
    const raw = request.headers.cookie ?? '';
    const value = raw
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${name}=`));
    return value ? decodeURIComponent(value.slice(name.length + 1)) : '';
  }

  private async start(provider: Provider, response: Response): Promise<void> {
    response.setHeader('Cross-Origin-Opener-Policy', 'unsafe-none');
    const { url, browserToken } = await this.oauth.begin(provider);
    response.cookie(`festicore_${provider}_oauth`, browserToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: `/api/v1/auth/${provider}/callback`,
      maxAge: 5 * 60_000,
    });
    response.setHeader('Cache-Control', 'no-store');
    response.redirect(302, url);
  }

  private async finish(
    provider: Provider,
    code: string,
    state: string,
    request: Request,
    response: Response,
    name?: string,
  ): Promise<void> {
    response.setHeader('Cross-Origin-Opener-Policy', 'unsafe-none');
    const cookieName = `festicore_${provider}_oauth`;
    const browserToken = this.cookie(request, cookieName);
    response.clearCookie(cookieName, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: `/api/v1/auth/${provider}/callback`,
    });
    const ticket = await this.oauth.finish(
      provider,
      code,
      state,
      browserToken,
      name,
    );
    response.cookie(TICKET_COOKIE, ticket, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/api/v1/auth/web/token',
      maxAge: 60_000,
    });
    response.setHeader('Cache-Control', 'no-store');
    response.redirect(303, '/api/v1/auth/web/result');
  }

  @Public()
  @Get('apple/start')
  @ApiOperation({
    summary: 'Apple 웹 로그인 시작',
    description:
      '브라우저 팝업에서 이 URL을 엽니다. 서버가 5분 유효한 상태를 만들고 HttpOnly·Secure 쿠키를 설정한 뒤 Apple 인증 화면으로 302 리디렉션합니다. 요청 본문은 없습니다.',
  })
  @ApiResponse({
    status: 302,
    description: 'Location: Apple 인증 URL, Set-Cookie: 일회용 OAuth 상태 쿠키',
  })
  @ApiResponse({
    status: 503,
    description: 'Apple 웹 OAuth 설정 누락 또는 오류',
  })
  appleStart(@Res() response: Response) {
    return this.start('apple', response);
  }

  @Public()
  @Post('apple/callback')
  @ApiOperation({
    summary: 'Apple 웹 form_post 콜백',
    description:
      'Apple 서버가 브라우저를 통해 호출하는 등록된 Return URL입니다. 앱에서 직접 호출하지 않습니다. application/x-www-form-urlencoded 본문의 code·state와 시작 단계의 HttpOnly 쿠키를 검증합니다. 성공 시 60초 유효한 일회용 로그인 티켓을 HttpOnly 쿠키에 담고 /api/v1/auth/web/result로 303 리디렉션합니다. Apple 취소(error)는 같은 결과 페이지의 cancelled 경로로 이동합니다.',
  })
  @ApiConsumes('application/x-www-form-urlencoded')
  @ApiBody({
    description:
      'Apple response_mode=form_post 본문. 성공은 code와 state, 취소는 error와 state를 보냅니다. user JSON은 최초 승인 시에만 올 수 있습니다.',
    schema: {
      type: 'object',
      required: ['state'],
      properties: {
        code: {
          type: 'string',
          description: 'Apple이 발급한 일회용 authorization code(성공 시 필수)',
          example: '<Apple authorization code>',
        },
        state: {
          type: 'string',
          description: '시작 단계에서 서버가 생성한 CSRF 방지 상태값',
          example: '<OAuth state>',
        },
        id_token: {
          type: 'string',
          description: 'Apple form_post에 포함될 수 있는 identity token',
          example: '<Apple identity token>',
        },
        user: {
          type: 'string',
          description:
            '최초 승인 시에만 포함될 수 있는 JSON 문자열. 예: {"name":{"firstName":"축제","lastName":"관객"}}',
          example: '{"name":{"firstName":"축제","lastName":"관객"}}',
        },
        error: {
          type: 'string',
          description: '사용자가 취소하거나 Apple 인증이 실패한 경우의 오류',
          example: 'user_cancelled_authorize',
        },
      },
    },
  })
  @ApiResponse({
    status: 303,
    description: '성공 또는 취소 결과 페이지로 이동. 성공 시 티켓 쿠키 설정',
  })
  @ApiResponse({
    status: 401,
    description: '상태·쿠키 불일치, 만료 또는 재사용',
  })
  appleCallback(@Req() request: Request, @Res() response: Response) {
    response.setHeader('Cross-Origin-Opener-Policy', 'unsafe-none');
    const body = request.body as Record<string, unknown> | undefined;
    const state = typeof body?.state === 'string' ? body.state : '';
    if (typeof body?.error === 'string') {
      return this.cancel('apple', state, request, response);
    }
    const name = this.appleName(body?.user);
    return this.finish(
      'apple',
      typeof body?.code === 'string' ? body.code : '',
      state,
      request,
      response,
      name,
    );
  }

  private async cancel(
    provider: Provider,
    state: string,
    request: Request,
    response: Response,
  ): Promise<void> {
    const cookieName = `festicore_${provider}_oauth`;
    const browserToken = this.cookie(request, cookieName);
    response.clearCookie(cookieName, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: `/api/v1/auth/${provider}/callback`,
    });
    await this.oauth.cancel(provider, state, browserToken);
    response.setHeader('Cache-Control', 'no-store');
    response.redirect(303, '/api/v1/auth/web/result?error=cancelled');
  }

  private appleName(raw: unknown): string | undefined {
    if (raw === undefined) return undefined;
    if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > 2048) {
      throw new BadRequestException('Apple 사용자 정보가 올바르지 않습니다.');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new BadRequestException('Apple 사용자 정보가 올바르지 않습니다.');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new BadRequestException('Apple 사용자 정보가 올바르지 않습니다.');
    }
    const name = (parsed as { name?: unknown }).name;
    if (!name || typeof name !== 'object' || Array.isArray(name))
      return undefined;
    const { firstName, lastName } = name as Record<string, unknown>;
    if (
      [firstName, lastName].some(
        (part) =>
          part !== undefined && (typeof part !== 'string' || part.length > 100),
      )
    ) {
      throw new BadRequestException('Apple 사용자 정보가 올바르지 않습니다.');
    }
    return (
      [firstName, lastName]
        .filter(
          (part): part is string =>
            typeof part === 'string' && part.trim().length > 0,
        )
        .join(' ')
        .trim()
        .slice(0, 200) || undefined
    );
  }

  @Public()
  @Get('web/result')
  @ApiOperation({
    summary: 'Apple 웹 로그인 결과 전달 페이지',
    description:
      '콜백의 303 리디렉션으로 열리는 HTML 페이지입니다. 같은 출처의 POST /auth/web/token으로 티켓을 교환하고 WEB_OAUTH_CLIENT_ORIGIN으로 설정된 창에 postMessage({type:"festicore:web-login", result})를 전송합니다. 취소 시에는 error:"cancelled"를 전송합니다. 요청 본문은 없습니다.',
  })
  @ApiResponse({ status: 200, description: '로그인 결과 전달용 HTML' })
  @ApiResponse({
    status: 503,
    description: '웹 클라이언트 출처 설정 누락 또는 오류',
  })
  result(@Req() request: Request, @Res() response: Response): void {
    const targetOrigin = this.oauth.clientOrigin();
    const cancelled = request.query.error === 'cancelled';
    const script = cancelled
      ? `if (!window.opener) { document.body.textContent = '로그인 창을 앱에서 다시 열어 주세요.'; } else { window.opener.postMessage({type:'festicore:web-login', error:'cancelled'}, ${JSON.stringify(targetOrigin)}); window.close(); }`
      : `if (!window.opener) { document.body.textContent = '로그인 창을 앱에서 다시 열어 주세요.'; } else { fetch('/api/v1/auth/web/token', {method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'}}).then(async r => { if (!r.ok) throw new Error('로그인 결과를 받을 수 없습니다.'); return r.json(); }).then(result => { window.opener.postMessage({type:'festicore:web-login', result}, ${JSON.stringify(targetOrigin)}); window.close(); }).catch(() => { document.body.textContent = '로그인이 완료되지 않았습니다. 다시 시도해 주세요.'; }); }`;
    const hash = createHash('sha256').update(script).digest('base64');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Cross-Origin-Opener-Policy', 'unsafe-none');
    response.setHeader(
      'Content-Security-Policy',
      `default-src 'none'; script-src 'sha256-${hash}'; connect-src 'self'; base-uri 'none'; form-action 'none'`,
    );
    response
      .type('html')
      .send(
        `<!doctype html><html lang="ko"><meta charset="utf-8"><title>로그인 완료</title><body>로그인 결과를 전달하는 중입니다.<script>${script}</script></body></html>`,
      );
  }

  @Public()
  @Post('web/token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Apple 웹 로그인 일회용 티켓 교환',
    description:
      '결과 페이지가 같은 출처에서 빈 본문으로 호출합니다. 브라우저가 HttpOnly·Secure 티켓 쿠키를 자동 전송하며 Origin 헤더는 등록된 Apple 콜백 URI의 출처와 일치해야 합니다. 티켓은 60초 유효하고 한 번만 사용할 수 있습니다. 성공 응답의 accessToken·refreshToken·newUser·user가 웹 클라이언트에 전달됩니다.',
  })
  @ApiHeader({
    name: 'Origin',
    description: 'Apple 콜백 URI와 동일한 HTTPS 출처',
    required: true,
    example: 'https://festicore.up.railway.app',
  })
  @ApiResponse({ status: 200, description: 'FestiCore 토큰과 사용자 정보' })
  @ApiResponse({
    status: 401,
    description: 'Origin 불일치 또는 티켓 누락·만료·재사용',
  })
  @ApiResponse({
    status: 503,
    description: 'Apple 웹 콜백 URI 설정 누락 또는 오류',
  })
  async token(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const origin = request.headers.origin;
    const allowed = new URL(this.oauth.redirectUri('apple')).origin;
    if (!origin || origin !== allowed) {
      throw new UnauthorizedException(
        '웹 로그인 교환 요청의 출처가 일치하지 않습니다.',
      );
    }
    const ticket = this.cookie(request, TICKET_COOKIE);
    response.clearCookie(TICKET_COOKIE, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/api/v1/auth/web/token',
    });
    const result = await this.oauth.consumeTicket(ticket);
    response.setHeader('Cache-Control', 'no-store');
    return result;
  }
}
