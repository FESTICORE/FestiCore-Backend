import {
  Controller,
  Get,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
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
  ): Promise<void> {
    const cookieName = `festicore_${provider}_oauth`;
    const browserToken = this.cookie(request, cookieName);
    response.clearCookie(cookieName, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: `/api/v1/auth/${provider}/callback`,
    });
    const ticket = await this.oauth.finish(provider, code, state, browserToken);
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
    return this.finish(
      'google',
      typeof request.query.code === 'string' ? request.query.code : '',
      typeof request.query.state === 'string' ? request.query.state : '',
      request,
      response,
    );
  }

  @Public()
  @Post('apple/callback')
  appleCallback(@Req() request: Request, @Res() response: Response) {
    const body = request.body as Record<string, unknown> | undefined;
    return this.finish(
      'apple',
      typeof body?.code === 'string' ? body.code : '',
      typeof body?.state === 'string' ? body.state : '',
      request,
      response,
    );
  }

  @Public()
  @Get('web/result')
  result(@Res() response: Response): void {
    response.setHeader('Cache-Control', 'no-store');
    response
      .type('html')
      .send(
        '<!doctype html><html lang="ko"><meta charset="utf-8"><title>로그인 완료</title><body>로그인이 완료되었습니다.</body></html>',
      );
  }

  @Public()
  @Post('web/token')
  async token(
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
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
    response.json(result);
  }
}
