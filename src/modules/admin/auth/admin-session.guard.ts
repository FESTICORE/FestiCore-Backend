import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AdminAuthService, AuthenticatedAdmin } from './admin-auth.service';
import { ADMIN_ROLES_KEY, AdminRole } from './admin-roles.decorator';

export const ADMIN_SESSION_COOKIE = 'festicore_admin_session';

export type AdminRequest = Request & {
  admin?: AuthenticatedAdmin;
  adminSessionToken?: string;
};

const rank: Record<AdminRole, number> = { viewer: 1, editor: 2, owner: 3 };

@Injectable()
export class AdminSessionGuard implements CanActivate {
  constructor(
    private readonly auth: AdminAuthService,
    private readonly config: ConfigService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const request = context.switchToHttp().getRequest<AdminRequest>();
    const path = request.path;
    if (!/^\/api\/v1\/admin(?:\/|$)/.test(path)) return true;
    if (
      (request.method === 'POST' && path === '/api/v1/admin/auth/magic-link') ||
      (request.method === 'GET' && path === '/api/v1/admin/auth/callback')
    ) {
      return true;
    }
    if (request.method === 'POST' && path === '/api/v1/admin/auth/callback') {
      // 콜백 컨트롤러가 확인 쿠키와 서명된 nonce를 검증한다.
      // no-referrer 정책에서는 브라우저가 Origin: null을 보낼 수 있다.
      return true;
    }

    const token = this.extractCookie(request.headers.cookie);
    if (!token) throw new UnauthorizedException('관리자 세션이 없습니다.');
    const admin = await this.auth.validateSession(token);
    const roles = this.reflector.getAllAndOverride<AdminRole[]>(
      ADMIN_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    const required = roles?.length
      ? Math.min(...roles.map((role) => rank[role]))
      : rank.viewer;
    if (rank[admin.role] < required)
      throw new ForbiddenException('관리자 권한이 부족합니다.');

    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      const allowed = this.config.get<string>('ADMIN_WEB_URL');
      const origin = request.headers.origin;
      if (!allowed || origin !== new URL(allowed).origin) {
        throw new ForbiddenException('허용되지 않은 관리자 요청 출처입니다.');
      }
    }
    request.admin = admin;
    request.adminSessionToken = token;
    return true;
  }

  private extractCookie(cookieHeader?: string): string | undefined {
    return cookieHeader
      ?.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${ADMIN_SESSION_COOKIE}=`))
      ?.slice(ADMIN_SESSION_COOKIE.length + 1);
  }
}
