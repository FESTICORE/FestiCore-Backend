import {
  Body,
  Controller,
  Get,
  HttpCode,
  BadRequestException,
  ForbiddenException,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IsEmail, Matches } from 'class-validator';
import type { Request, Response } from 'express';
import { Public } from '../../auth/decorator/public.decorator';
import { AdminAuthService } from './admin-auth.service';
import {
  ADMIN_CALLBACK_COOKIE,
  createCallbackCsrf,
  verifyCallbackCsrf,
} from './admin-callback-csrf';
import { ADMIN_SESSION_COOKIE } from './admin-session.guard';
import type { AdminRequest } from './admin-session.guard';

class MagicLinkDto {
  @IsEmail()
  email!: string;
}

class CallbackDto {
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  token!: string;

  @Matches(/^[A-Za-z0-9_-]{43}$/)
  csrf!: string;
}

@Controller('admin/auth')
export class AdminAuthController {
  constructor(
    private readonly auth: AdminAuthService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post('magic-link')
  @HttpCode(HttpStatus.ACCEPTED)
  async requestLink(
    @Body() body: MagicLinkDto,
    @Req() request: Request,
  ): Promise<{ message: string }> {
    await this.auth.requestMagicLink(body.email, request.ip ?? null);
    return { message: '등록된 관리자 계정이라면 로그인 링크를 발송했습니다.' };
  }

  @Public()
  @Get('callback')
  confirmation(@Query('token') token: string, @Res() response: Response): void {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
      throw new BadRequestException('유효하지 않은 로그인 링크입니다.');
    }
    const secret = this.config.get<string>('auth.jwt.accessSecret');
    if (!secret)
      throw new ServiceUnavailableException('관리자 로그인 설정이 없습니다.');
    const { nonce, cookie } = createCallbackCsrf(secret, token);
    response.cookie(ADMIN_CALLBACK_COOKIE, cookie, {
      httpOnly: true,
      secure: this.config.get<string>('NODE_ENV') === 'production',
      sameSite: 'strict',
      maxAge: 5 * 60 * 1000,
      path: '/api/v1/admin/auth/callback',
    });
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    );
    response.type('html').send(`<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>FestiCore 관리자 로그인</title></head>
<body><main><h1>관리자 로그인</h1><p>로그인을 계속하려면 아래 버튼을 누르세요.</p>
<form method="post" action="/api/v1/admin/auth/callback">
<input type="hidden" name="token" value="${token}">
<input type="hidden" name="csrf" value="${nonce}">
<button type="submit">로그인 계속</button></form></main></body></html>`);
  }

  @Public()
  @Post('callback')
  async callback(
    @Body() body: CallbackDto,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const secret = this.config.get<string>('auth.jwt.accessSecret');
    const apiUrl =
      this.config.get<string>('ADMIN_API_PUBLIC_URL') ??
      this.config.get<string>('PUBLIC_URL');
    if (!secret || !apiUrl)
      throw new ServiceUnavailableException('관리자 로그인 설정이 없습니다.');
    const origin = request.headers.origin;
    if (origin && origin !== 'null' && origin !== new URL(apiUrl).origin) {
      throw new ForbiddenException('허용되지 않은 로그인 요청 출처입니다.');
    }
    const csrfCookie = request.headers.cookie
      ?.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${ADMIN_CALLBACK_COOKIE}=`))
      ?.slice(ADMIN_CALLBACK_COOKIE.length + 1);
    if (!verifyCallbackCsrf(secret, body.token, body.csrf, csrfCookie)) {
      throw new ForbiddenException('로그인 확인 정보가 유효하지 않습니다.');
    }
    const frontend = this.config.get<string>('ADMIN_WEB_URL');
    if (!frontend)
      throw new ServiceUnavailableException(
        '관리자 웹 주소가 설정되지 않았습니다.',
      );
    const { sessionToken } = await this.auth.consumeMagicLink(
      body.token,
      request.ip ?? null,
    );
    const isProd = this.config.get<string>('NODE_ENV') === 'production';
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.clearCookie(ADMIN_CALLBACK_COOKIE, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'strict',
      path: '/api/v1/admin/auth/callback',
    });
    response.cookie(ADMIN_SESSION_COOKIE, sessionToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/api/v1/admin',
    });
    response.redirect(HttpStatus.SEE_OTHER, new URL(frontend).toString());
  }

  @Get('me')
  me(@Req() request: AdminRequest) {
    return request.admin;
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() request: AdminRequest,
    @Res() response: Response,
  ): Promise<void> {
    await this.auth.logout(
      request.adminSessionToken!,
      request.admin!.id,
      request.ip ?? null,
    );
    const isProd = this.config.get<string>('NODE_ENV') === 'production';
    response.clearCookie(ADMIN_SESSION_COOKIE, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
      path: '/api/v1/admin',
    });
    response.status(HttpStatus.NO_CONTENT).send();
  }
}
