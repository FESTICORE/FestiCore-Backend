import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request } from 'express';
import { Repository } from 'typeorm';
import { IS_PUBLIC_KEY } from '../decorator/public.decorator';
import { User } from '../entity/user.entity';
import type { AuthUser, SocialProvider } from '../types/social-profile';

interface AccessPayload {
  sub: string;
  provider: SocialProvider;
  typ?: string;
}

/**
 * access 토큰(Authorization: Bearer)을 검증하고 request.user에 AuthUser를 심는다.
 * passport 없이 JwtService로 직접 검증하는 가벼운 가드.
 * 전역(APP_GUARD)으로 등록되어 기본 인증을 강제하며,
 * @Public 라우트와 HTTP가 아닌 컨텍스트(WebSocket 등)는 건너뛴다.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly reflector: Reflector,
    @InjectRepository(User)
    private readonly users: Repository<User>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // WebSocket 게이트웨이는 자체 WsAuthService로 인증하므로 HTTP만 다룬다.
    if (context.getType() !== 'http') {
      return true;
    }

    // @Public 이 붙은 라우트는 토큰 없이 통과시킨다.
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    // 관리자 경로는 전역 AdminSessionGuard가 HttpOnly 쿠키를 검증한다.
    // 앱 사용자 Bearer JWT로 관리자 API에 접근할 수 없게 인증 경계를 분리한다.
    if (/^\/api\/v1\/admin(?:\/|$)/i.test(request.path)) {
      return true;
    }
    const token = this.extractToken(request);
    if (!token) {
      throw new UnauthorizedException('인증 토큰이 없습니다.');
    }

    let payload: AccessPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessPayload>(token, {
        secret: this.config.get<string>('auth.jwt.accessSecret'),
      });
      // refresh 토큰 등 access 가 아닌 토큰은 거부한다.
      if (
        payload.typ !== 'access' ||
        typeof payload.sub !== 'string' ||
        !payload.sub ||
        (payload.provider !== 'google' && payload.provider !== 'apple')
      ) {
        throw new Error('access 토큰이 아닙니다.');
      }
    } catch {
      throw new UnauthorizedException('유효하지 않은 인증 토큰입니다.');
    }

    // 이미 탈퇴한 계정의 서명 유효한 JWT도 남은 만료 시간과 무관하게 거부한다.
    const account = await this.users.findOne({
      where: { id: payload.sub },
      select: { id: true, provider: true },
    });
    if (!account || account.provider !== payload.provider) {
      throw new UnauthorizedException('유효하지 않은 인증 토큰입니다.');
    }
    const user: AuthUser = {
      userId: account.id,
      provider: account.provider,
    };
    (request as Request & { user: AuthUser }).user = user;
    return true;
  }

  private extractToken(request: Request): string | undefined {
    const header = request.headers.authorization;
    if (!header) return undefined;
    const [type, value] = header.split(' ');
    return type === 'Bearer' ? value : undefined;
  }
}
