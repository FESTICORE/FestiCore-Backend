import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import { jwtVerify } from 'jose';
import { validate } from 'class-validator';
import { SocialLoginDto } from '../dto/social-login.dto';
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
  it('limits names in the unified social login DTO', async () => {
    const social = Object.assign(new SocialLoginDto(), {
      provider: 'google',
      token: 'token',
      name: 'x'.repeat(31),
    });
    expect(
      (await validate(social)).some((error) => error.property === 'name'),
    ).toBe(true);
  });

  it('maps Apple web token network and verification failures', async () => {
    const config = {
      get: (key: string) =>
        ({
          'auth.apple.enabled': true,
          APPLE_WEB_CLIENT_ID: 'web-client',
        })[key],
    } as ConfigService;
    const service = new AppleService(config);
    Reflect.set(
      service,
      'buildClientSecret',
      jest.fn().mockResolvedValue('secret'),
    );
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockRejectedValueOnce(new Error('network'));
    const verify = jest
      .mocked(jwtVerify)
      .mockRejectedValue(new Error('invalid'));
    try {
      await expect(
        service.exchangeWebCode('code', 'https://callback', 'nonce'),
      ).rejects.toMatchObject({ status: 503 });
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ id_token: 'invalid' }),
      } as Response);
      await expect(
        service.exchangeWebCode('code', 'https://callback', 'nonce'),
      ).rejects.toMatchObject({ status: 401 });
    } finally {
      fetchMock.mockRestore();
      verify.mockReset();
    }
  });
  it('accepts configured web and mobile Google audiences on the same endpoint', async () => {
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
