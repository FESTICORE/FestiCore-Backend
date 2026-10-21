import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AdminAuthService, AuthenticatedAdmin } from './admin-auth.service';
import type { AuthUser } from '../../auth/types/social-profile';
import { ADMIN_ROLES_KEY, AdminRole } from './admin-roles.decorator';

export type AdminRequest = Request & {
  user?: AuthUser;
  admin?: AuthenticatedAdmin;
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
    const path = request.path.toLowerCase();
    if (!/^\/api\/v1\/admin(?:\/|$)/.test(path)) return true;
    if (!request.user || request.user.provider !== 'google') {
      throw new ForbiddenException('관리자 권한이 없습니다.');
    }
    const admin = await this.auth.findActiveByUserId(request.user.userId);
    const roles = this.reflector.getAllAndOverride<AdminRole[]>(
      ADMIN_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    const required = roles?.length
      ? Math.min(...roles.map((role) => rank[role]))
      : rank.viewer;
    if (rank[admin.role] < required)
      throw new ForbiddenException('관리자 권한이 부족합니다.');

    const allowed = this.config.get<string>('ADMIN_WEB_URL');
    const origin = request.headers.origin;
    if (
      !allowed ||
      (origin && origin !== new URL(allowed).origin) ||
      (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !origin)
    ) {
      throw new ForbiddenException('허용되지 않은 관리자 요청 출처입니다.');
    }
    request.admin = admin;
    return true;
  }
}
