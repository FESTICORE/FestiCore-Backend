import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import { AppleService } from './apple.service';
import { GoogleService } from './google.service';

jest.mock('jose', () => ({
  createRemoteJWKSet: jest.fn(),
  decodeJwt: jest.fn(),
  importPKCS8: jest.fn(),
  jwtVerify: jest.fn(),
  SignJWT: jest.fn(),
}));

describe('OAuth client identity', () => {
  it('accepts configured mobile Google audience without changing web code client', async () => {
    const verify = jest
      .spyOn(OAuth2Client.prototype, 'verifyIdToken')
      .mockResolvedValue({ getPayload: () => ({ sub: 'subject' }) } as never);
    const config = {
      get: (key: string) =>
        (
          ({
            'auth.google.clientId': 'web-client',
            'auth.google.clientIds': [
              'web-client',
              'ios-client',
              'android-client',
            ],
            'auth.google.enabled': true,
          }) as Record<string, unknown>
        )[key],
    } as ConfigService;
    try {
      const service = new GoogleService(config);
      await expect(service.verify('mobile-token')).resolves.toMatchObject({
        providerId: 'subject',
      });
      expect(verify).toHaveBeenCalledWith({
        idToken: 'mobile-token',
        audience: ['web-client', 'ios-client', 'android-client'],
      });
    } finally {
      verify.mockRestore();
    }
  });

  it('builds Apple revocation secret for the same Services ID as the refresh token', async () => {
    const config = {
      get: (key: string) =>
        (
          ({
            'auth.apple.clientId': 'io.festiCore.co',
            'auth.apple.enabled': true,
          }) as Record<string, unknown>
        )[key],
    } as ConfigService;
    const service = new AppleService(config);
    const buildSecret = jest.fn().mockResolvedValue('signed-web-secret');
    Reflect.set(service, 'buildClientSecret', buildSecret);
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ ok: true } as Response);
    try {
      await service.revokeConnection('web-refresh', 'co.festiCore.io');
      expect(buildSecret).toHaveBeenCalledWith('co.festiCore.io');
      const body = fetchMock.mock.calls[0][1]?.body as URLSearchParams;
      expect(body.get('client_id')).toBe('co.festiCore.io');
      expect(body.get('client_secret')).toBe('signed-web-secret');
    } finally {
      fetchMock.mockRestore();
    }
  });
});
