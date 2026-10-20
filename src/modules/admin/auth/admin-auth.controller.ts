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
import {
  ApiBody,
  ApiConsumes,
  ApiCookieAuth,
  ApiHeader,
  ApiOperation,
  ApiProperty,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
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
  @ApiProperty({
    description:
      '로그인 링크를 받을 관리자 이메일. 등록 여부와 관계없이 같은 응답을 반환합니다.',
    example: 'admin@festicore.com',
    format: 'email',
  })
  @IsEmail()
  email!: string;
}

class CallbackDto {
  @ApiProperty({
    description:
      '이메일 링크의 token 쿼리에서 전달된 일회용 토큰. GET 확인 페이지의 숨은 폼 필드가 자동으로 전달합니다.',
    example: 'A'.repeat(43),
    minLength: 43,
    maxLength: 43,
  })
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  token!: string;

  @ApiProperty({
    description:
      'GET 확인 페이지에서 발급한 CSRF nonce. 확인 쿠키와 함께 검증되므로 임의로 만들지 않습니다.',
    example: 'B'.repeat(43),
    minLength: 43,
    maxLength: 43,
  })
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  csrf!: string;
}

@ApiTags('관리자 인증')
@Controller('admin/auth')
export class AdminAuthController {
  constructor(
    private readonly auth: AdminAuthService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post('magic-link')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: '관리자 로그인 링크 요청',
    description:
      '등록된 관리자 이메일로 15분 동안 유효한 일회용 로그인 링크를 발송합니다. 계정 존재 여부를 노출하지 않도록 등록 여부와 관계없이 같은 202 응답을 반환합니다. 세션 쿠키는 필요하지 않습니다.',
  })
  @ApiResponse({
    status: 202,
    description: '요청 접수. 이메일 발송 여부를 응답으로 알리지 않습니다.',
    schema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          example: '등록된 관리자 계정이라면 로그인 링크를 발송했습니다.',
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: '이메일 형식이 올바르지 않음' })
  @ApiResponse({
    status: 429,
    description: '동일 IP에서 15분 동안 5회를 초과하여 요청함',
  })
  @ApiResponse({ status: 503, description: '관리자 이메일 로그인 설정이 없음' })
  async requestLink(
    @Body() body: MagicLinkDto,
    @Req() request: Request,
  ): Promise<{ message: string }> {
    await this.auth.requestMagicLink(body.email, request.ip ?? null);
    return { message: '등록된 관리자 계정이라면 로그인 링크를 발송했습니다.' };
  }

  @Public()
  @Get('callback')
  @ApiOperation({
    summary: '이메일 링크 확인 페이지',
    description:
      '이메일의 링크를 브라우저에서 엽니다. 서버가 5분 동안 유효한 HttpOnly 확인 쿠키를 설정하고 token·csrf 숨은 필드가 포함된 HTML 폼을 반환합니다. 사용자가 버튼을 누르면 POST callback으로 제출됩니다. 이 GET 요청만으로 로그인되지 않습니다.',
  })
  @ApiQuery({
    name: 'token',
    description: '이메일 링크에 포함된 URL-safe 43자 일회용 토큰',
    example: 'A'.repeat(43),
  })
  @ApiResponse({
    status: 200,
    description: '확인 폼 HTML과 festicore_admin_callback 확인 쿠키',
    content: { 'text/html': { schema: { type: 'string' } } },
  })
  @ApiResponse({ status: 400, description: 'token 형식이 올바르지 않음' })
  @ApiResponse({
    status: 503,
    description: '로그인 서명 키 또는 관리자 웹 주소 설정이 없음',
  })
  confirmation(@Query('token') token: string, @Res() response: Response): void {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
      throw new BadRequestException('유효하지 않은 로그인 링크입니다.');
    }
    const secret = this.config.get<string>('auth.jwt.accessSecret');
    if (!secret)
      throw new ServiceUnavailableException('관리자 로그인 설정이 없습니다.');
    const frontend = this.config.get<string>('ADMIN_WEB_URL');
    if (!frontend)
      throw new ServiceUnavailableException(
        '관리자 웹 주소가 설정되지 않았습니다.',
      );
    const { nonce, cookie } = createCallbackCsrf(secret, token);
    response.cookie(ADMIN_CALLBACK_COOKIE, cookie, {
      httpOnly: true,
      secure: this.secureCookie(),
      sameSite: 'strict',
      maxAge: 5 * 60 * 1000,
      path: '/api/v1/admin/auth/callback',
    });
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader(
      'Content-Security-Policy',
      `default-src 'none'; form-action 'self' ${new URL(frontend).origin}; base-uri 'none'; frame-ancestors 'none'`,
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
  @ApiOperation({
    summary: '관리자 로그인 확인 및 세션 시작',
    description:
      'GET 확인 페이지의 폼이 application/x-www-form-urlencoded로 token과 csrf를 제출합니다. 브라우저가 받은 festicore_admin_callback 확인 쿠키가 함께 있어야 합니다. Origin 헤더가 있으면 API 공개 origin 또는 null만 허용합니다. 성공 시 확인 쿠키를 지우고 7일 관리자 세션 쿠키를 설정한 뒤 ADMIN_WEB_URL로 303 이동합니다. 이 토큰은 한 번만 사용할 수 있습니다.',
  })
  @ApiConsumes('application/x-www-form-urlencoded')
  @ApiBody({
    type: CallbackDto,
    description: 'GET 확인 페이지가 생성한 폼 필드를 그대로 제출합니다.',
  })
  @ApiHeader({
    name: 'Cookie',
    description: 'GET callback에서 받은 festicore_admin_callback 확인 쿠키',
    required: true,
  })
  @ApiResponse({
    status: 303,
    description: '세션 쿠키를 설정하고 관리자 웹으로 이동',
    headers: {
      Location: {
        description: 'ADMIN_WEB_URL',
        schema: { type: 'string', format: 'uri' },
      },
      'Set-Cookie': {
        description:
          'festicore_admin_session 세션 쿠키. HttpOnly, 7일, /api/v1/admin 경로',
        schema: { type: 'string' },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'token 또는 csrf 형식이 올바르지 않음',
  })
  @ApiResponse({ status: 401, description: '링크가 만료되었거나 이미 사용됨' })
  @ApiResponse({
    status: 403,
    description: '확인 쿠키·CSRF 값 또는 요청 출처가 유효하지 않음',
  })
  @ApiResponse({
    status: 503,
    description: '로그인 서명 키, API 주소 또는 관리자 웹 주소 설정이 없음',
  })
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
    const secure = this.secureCookie();
    const sameSite = this.sessionSameSite(secure);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.clearCookie(ADMIN_CALLBACK_COOKIE, {
      httpOnly: true,
      secure,
      sameSite: 'strict',
      path: '/api/v1/admin/auth/callback',
    });
    response.cookie(ADMIN_SESSION_COOKIE, sessionToken, {
      httpOnly: true,
      secure,
      sameSite,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/api/v1/admin',
    });
    response.redirect(HttpStatus.SEE_OTHER, new URL(frontend).toString());
  }

  @Get('me')
  @ApiCookieAuth('admin-session')
  @ApiOperation({
    summary: '현재 관리자 세션 조회',
    description:
      'festicore_admin_session 쿠키로 인증한 관리자의 ID, 이메일, 역할을 반환합니다. Origin 헤더를 보내는 경우 ADMIN_WEB_URL의 origin과 일치해야 합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '현재 관리자 정보',
    schema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          format: 'uuid',
          example: '4d5dbceb-f7e0-4d89-b257-0d493a47f22f',
        },
        email: {
          type: 'string',
          format: 'email',
          example: 'admin@festicore.com',
        },
        role: {
          type: 'string',
          enum: ['viewer', 'editor', 'owner'],
          example: 'owner',
        },
      },
      required: ['id', 'email', 'role'],
    },
  })
  @ApiResponse({ status: 401, description: '관리자 세션이 없거나 만료됨' })
  @ApiResponse({
    status: 403,
    description: '관리자 웹 이외의 Origin 또는 접근 권한 없음',
  })
  me(@Req() request: AdminRequest) {
    return request.admin;
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiCookieAuth('admin-session')
  @ApiOperation({
    summary: '관리자 로그아웃',
    description:
      '현재 세션을 폐기하고 festicore_admin_session 쿠키를 삭제합니다. 쿠키 외에 ADMIN_WEB_URL과 일치하는 Origin 헤더가 필수입니다. 응답 본문은 없습니다.',
  })
  @ApiHeader({
    name: 'Origin',
    description: 'ADMIN_WEB_URL의 origin. 예: https://admin.festicore.com',
    required: true,
  })
  @ApiResponse({ status: 204, description: '로그아웃 완료. 응답 본문 없음' })
  @ApiResponse({ status: 401, description: '관리자 세션이 없거나 만료됨' })
  @ApiResponse({
    status: 403,
    description: 'Origin이 없거나 허용된 관리자 웹과 다름',
  })
  async logout(
    @Req() request: AdminRequest,
    @Res() response: Response,
  ): Promise<void> {
    await this.auth.logout(
      request.adminSessionToken!,
      request.admin!.id,
      request.ip ?? null,
    );
    const secure = this.secureCookie();
    response.clearCookie(ADMIN_SESSION_COOKIE, {
      httpOnly: true,
      secure,
      sameSite: this.sessionSameSite(secure),
      path: '/api/v1/admin',
    });
    response.status(HttpStatus.NO_CONTENT).send();
  }

  private secureCookie(): boolean {
    const apiUrl =
      this.config.get<string>('ADMIN_API_PUBLIC_URL') ??
      this.config.get<string>('PUBLIC_URL');
    return apiUrl ? new URL(apiUrl).protocol === 'https:' : false;
  }

  private sessionSameSite(secure: boolean): 'lax' | 'strict' | 'none' {
    const configured = this.config.get<string>('ADMIN_SESSION_SAME_SITE');
    if (configured === 'lax' || configured === 'strict') return configured;
    if (configured === 'none' && secure) return 'none';
    if (!configured) return secure ? 'none' : 'lax';
    throw new ServiceUnavailableException(
      '관리자 세션 쿠키 설정이 유효하지 않습니다.',
    );
  }
}
