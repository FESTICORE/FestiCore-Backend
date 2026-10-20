import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthUser } from '../types/social-profile';

/**
 * JwtAuthGuard가 request.user에 심어둔 인증 사용자 정보를 꺼낸다.
 * 사용: `me(@CurrentUser() user: AuthUser)`
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const request = ctx.switchToHttp().getRequest<{ user: AuthUser }>();
    return request.user;
  },
);
