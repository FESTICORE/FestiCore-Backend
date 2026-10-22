import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import { User } from '../entity/user.entity';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  const account = { id: 'user-1', provider: 'google' };
  let verifyAsync: jest.Mock;
  let findOne: jest.Mock;
  let isPublic: jest.Mock;
  let guard: JwtAuthGuard;

  const context = (path = '/api/v1/me', bearer = 'signed-token') => {
    const request = {
      path,
      headers: { authorization: `Bearer ${bearer}` },
    };
    return {
      request,
      execution: {
        getType: () => 'http',
        getHandler: () => context,
        getClass: () => JwtAuthGuard,
        switchToHttp: () => ({ getRequest: () => request }),
      } as unknown as ExecutionContext,
    };
  };

  beforeEach(() => {
    verifyAsync = jest.fn().mockResolvedValue({
      sub: account.id,
      provider: account.provider,
      typ: 'access',
    });
    findOne = jest.fn().mockResolvedValue(account);
    isPublic = jest.fn().mockReturnValue(false);
    guard = new JwtAuthGuard(
      { verifyAsync } as unknown as JwtService,
      { get: () => 'test-secret' } as unknown as ConfigService,
      { getAllAndOverride: isPublic } as unknown as Reflector,
      { findOne } as unknown as Repository<User>,
    );
  });

  it('현재 계정이 있는 access 토큰을 허용하고 최소 필드만 조회한다', async () => {
    const { request, execution } = context();
    await expect(guard.canActivate(execution)).resolves.toBe(true);
    expect(findOne).toHaveBeenCalledWith({
      where: { id: account.id },
      select: { id: true, provider: true },
    });
    expect(request).toHaveProperty('user', {
      userId: account.id,
      provider: account.provider,
    });
  });

  it('탈퇴로 계정이 없어지면 남은 access 토큰을 거부한다', async () => {
    findOne.mockResolvedValue(null);
    await expect(guard.canActivate(context().execution)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('sub가 없는 토큰은 사용자 조회 없이 거부한다', async () => {
    verifyAsync.mockResolvedValue({ provider: 'google', typ: 'access' });
    await expect(guard.canActivate(context().execution)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(findOne).not.toHaveBeenCalled();
  });

  it('DB 조회 실패는 토큰 오류로 숨기지 않는다', async () => {
    const failure = new Error('database unavailable');
    findOne.mockRejectedValue(failure);
    await expect(guard.canActivate(context().execution)).rejects.toBe(failure);
  });

  it('공개 경로만 사용자 조회를 건너뛰고 관리자 경로도 JWT를 검증한다', async () => {
    isPublic.mockReturnValueOnce(true);
    await expect(guard.canActivate(context().execution)).resolves.toBe(true);
    await expect(
      guard.canActivate(context('/api/v1/admin/flags').execution),
    ).resolves.toBe(true);
    expect(findOne).toHaveBeenCalledTimes(1);
  });
});
