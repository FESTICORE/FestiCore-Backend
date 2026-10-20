import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { ExecutionContext } from '@nestjs/common';
import { AdminAuthService } from './admin-auth.service';
import { AdminSessionGuard } from './admin-session.guard';

describe('AdminSessionGuard', () => {
  const admin = {
    id: 'adm-1',
    email: 'admin@example.com',
    role: 'viewer' as const,
  };
  const auth = { validateSession: jest.fn().mockResolvedValue(admin) };
  const reflector = { getAllAndOverride: jest.fn() };
  const guard = new AdminSessionGuard(
    auth as unknown as AdminAuthService,
    {
      get: (key: string) =>
        key === 'ADMIN_API_PUBLIC_URL'
          ? 'https://api.example.com'
          : 'https://admin.example.com',
    } as unknown as ConfigService,
    reflector as unknown as Reflector,
  );

  function context(
    method: string,
    path: string,
    cookie?: string,
    origin?: string,
    authorization?: string,
  ): ExecutionContext {
    const request = {
      method,
      path,
      headers: { cookie, origin, authorization },
    };
    return {
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => undefined,
      getClass: () => undefined,
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    reflector.getAllAndOverride.mockReturnValue(undefined);
  });

  it('requires an admin session even when an app access token could exist', async () => {
    await expect(
      guard.canActivate(
        context(
          'GET',
          '/api/v1/admin/festivals',
          undefined,
          undefined,
          'Bearer app-jwt',
        ),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('enforces the role hierarchy', async () => {
    reflector.getAllAndOverride.mockReturnValue(['editor']);
    await expect(
      guard.canActivate(
        context(
          'PATCH',
          '/api/v1/admin/festivals/a/draft',
          'festicore_admin_session=token',
          'https://admin.example.com',
        ),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a write from an untrusted origin', async () => {
    await expect(
      guard.canActivate(
        context(
          'POST',
          '/api/v1/admin/auth/logout',
          'festicore_admin_session=token',
          'https://evil.example.com',
        ),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows public magic link requests without a session', async () => {
    await expect(
      guard.canActivate(context('POST', '/api/v1/admin/auth/magic-link')),
    ).resolves.toBe(true);
  });

  it('accepts callback confirmation GET without consuming or requiring a session', async () => {
    await expect(
      guard.canActivate(context('GET', '/api/v1/admin/auth/callback')),
    ).resolves.toBe(true);
    expect(auth.validateSession).not.toHaveBeenCalled();
  });

  it('lets callback POST reach the controller cookie check', async () => {
    await expect(
      guard.canActivate(
        context('POST', '/api/v1/admin/auth/callback', undefined, 'null'),
      ),
    ).resolves.toBe(true);
  });
});
