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
import { Public } from '../decorator/public.decorator';
import { WebOauthService } from '../web/web-oauth.service';

type Provider = 'google' | 'apple';
const TICKET_COOKIE = 'festicore_web_login_ticket';

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
  @Get('google/start')
  googleStart(@Res() response: Response) {
    return this.start('google', response);
  }

  @Public()
  @Get('apple/start')
  appleStart(@Res() response: Response) {
    return this.start('apple', response);
  }

  @Public()
  @Get('google/callback')
  googleCallback(@Req() request: Request, @Res() response: Response) {
    response.setHeader('Cross-Origin-Opener-Policy', 'unsafe-none');
    const state =
      typeof request.query.state === 'string' ? request.query.state : '';
    if (typeof request.query.error === 'string') {
      return this.cancel('google', state, request, response);
    }
    return this.finish(
      'google',
      typeof request.query.code === 'string' ? request.query.code : '',
      state,
      request,
      response,
    );
  }

  @Public()
  @Post('apple/callback')
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
  async token(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const origin = request.headers.origin;
    const allowed = ['google', 'apple'].flatMap((provider) => {
      try {
        return [new URL(this.oauth.redirectUri(provider as Provider)).origin];
      } catch {
        return [];
      }
    });
    if (!origin || !allowed.includes(origin)) {
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
