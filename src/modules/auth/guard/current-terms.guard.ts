import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request } from 'express';
import { Repository } from 'typeorm';
import { User } from '../entity/user.entity';
import { CURRENT_TERMS_VERSION } from '../terms';
import type { AuthUser } from '../types/social-profile';

/** 인증된 계정의 현재 필수 약관 동의를 쓰기 요청 직전에 확인한다. */
@Injectable()
export class CurrentTermsGuard implements CanActivate {
  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthUser }>();
    if (!request.user) throw new UnauthorizedException('인증 토큰이 없습니다.');

    const user = await this.users.findOne({
      where: { id: request.user.userId },
      select: { termsAcceptedAt: true, termsVersion: true },
    });
    if (!user?.termsAcceptedAt || user.termsVersion !== CURRENT_TERMS_VERSION) {
      throw new ForbiddenException({
        code: 'TERMS_REQUIRED',
        message: '필수 약관 동의가 필요합니다.',
      });
    }
    return true;
  }
}
