import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { AdminAuthService } from './admin-auth.service';
import { AdminSessionGuard } from './admin-session.guard';

describe('admin JWT authorization', () => {
  const auth = { findActiveByUserId: jest.fn() };
  const reflector = { getAllAndOverride: jest.fn() };
  const guard = new AdminSessionGuard(
    auth as unknown as AdminAuthService,
    { get: () => 'https://admin.example.com' } as unknown as ConfigService,
    reflector as unknown as Reflector,
  );
  const context = (
    method: string,
    user?: { userId: string; provider: string },
    origin?: string,
  ) => {
    const request = {
      method,
      path: '/api/v1/admin/festivals',
      headers: { origin, cookie: 'festicore_admin_session=legacy' },
      user,
    };
    return {
      request,
      execution: {
        getType: () => 'http',
        switchToHttp: () => ({ getRequest: () => request }),
        getHandler: () => null,
        getClass: () => null,
      } as unknown as ExecutionContext,
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    reflector.getAllAndOverride.mockReturnValue(undefined);
    auth.findActiveByUserId.mockResolvedValue({
      id: 'admin-id',
      email: 'owner@example.com',
      role: 'owner',
    });
  });

  it('rejects a legacy cookie without a validated Google JWT user', async () => {
    await expect(
      guard.canActivate(context('GET').execution),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      guard.canActivate(
        context('GET', { userId: 'apple-id', provider: 'apple' }).execution,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(auth.findActiveByUserId).not.toHaveBeenCalled();
  });

  it('checks the current account on every request and attaches stable admin ID', async () => {
    const first = context('GET', { userId: 'google-id', provider: 'google' });
    await expect(guard.canActivate(first.execution)).resolves.toBe(true);
    expect(auth.findActiveByUserId).toHaveBeenCalledWith('google-id');
    expect(first.request).toHaveProperty('admin.id', 'admin-id');
    auth.findActiveByUserId.mockRejectedValueOnce(new ForbiddenException());
    await expect(
      guard.canActivate(
        context('GET', { userId: 'google-id', provider: 'google' }).execution,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('enforces role hierarchy and Origin on writes', async () => {
    auth.findActiveByUserId.mockResolvedValue({ id: 'viewer', role: 'viewer' });
    reflector.getAllAndOverride.mockReturnValue(['editor']);
    await expect(
      guard.canActivate(
        context(
          'POST',
          { userId: 'google-id', provider: 'google' },
          'https://admin.example.com',
        ).execution,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    auth.findActiveByUserId.mockResolvedValue({ id: 'owner', role: 'owner' });
    await expect(
      guard.canActivate(
        context('POST', { userId: 'google-id', provider: 'google' }).execution,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      guard.canActivate(
        context(
          'POST',
          { userId: 'google-id', provider: 'google' },
          'https://evil.example.com',
        ).execution,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
