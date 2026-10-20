import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';

describe('AdminAuthController callback confirmation', () => {
  it('renders an explicit POST form without consuming the link on GET', () => {
    const auth = { consumeMagicLink: jest.fn() };
    const controller = new AdminAuthController(
      auth as unknown as AdminAuthService,
      {
        get: (key: string) =>
          key === 'auth.jwt.accessSecret'
            ? 'test-secret'
            : key === 'ADMIN_WEB_URL'
              ? 'https://admin.example.com'
              : key === 'ADMIN_API_PUBLIC_URL'
                ? 'https://api.example.com'
                : 'test',
      } as ConfigService,
    );
    const response = {
      setHeader: jest.fn(),
      cookie: jest.fn(),
      type: jest.fn().mockReturnThis(),
      send: jest.fn(),
    };
    const token = 'a'.repeat(43);

    controller.confirmation(token, response as unknown as Response);

    expect(auth.consumeMagicLink).not.toHaveBeenCalled();
    expect(response.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'no-store',
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      'Referrer-Policy',
      'no-referrer',
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Security-Policy',
      expect.stringContaining("form-action 'self' https://admin.example.com"),
    );
    expect(response.send).toHaveBeenCalledWith(
      expect.stringContaining('method="post"'),
    );
    expect(response.send).toHaveBeenCalledWith(
      expect.stringContaining(`value="${token}"`),
    );
    expect(response.cookie).toHaveBeenCalledWith(
      'festicore_admin_callback',
      expect.any(String),
      expect.objectContaining({ httpOnly: true, sameSite: 'strict' }),
    );
  });

  it('rejects malformed input before rendering HTML', () => {
    const controller = new AdminAuthController(
      {} as AdminAuthService,
      {} as ConfigService,
    );
    const response = { setHeader: jest.fn(), send: jest.fn() };

    expect(() =>
      controller.confirmation('<script>', response as unknown as Response),
    ).toThrow();
    expect(response.send).not.toHaveBeenCalled();
  });
});
