import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { AuthService } from '../service/auth.service';
import { AppleService } from '../service/apple.service';
import { GoogleService } from '../service/google.service';
import { WebOauthService } from './web-oauth.service';
import { WebOauthState, WebOauthTicket } from './web-oauth-state.entity';

jest.mock('jose', () => ({
  createRemoteJWKSet: jest.fn(),
  decodeJwt: jest.fn(),
  importPKCS8: jest.fn(),
  jwtVerify: jest.fn(),
  SignJWT: jest.fn(),
}));

function harness() {
  const stateRows = new Map<string, WebOauthState>();
  const ticketRows = new Map<string, WebOauthTicket>();
  const repo = <T extends { consumedAt: Date | null }>(
    rows: Map<string, T>,
    key: keyof T,
  ) => ({
    create: (value: T) => value,
    save: jest.fn((value: T) => {
      rows.set(String(value[key]), value);
      return Promise.resolve(value);
    }),
    findOne: jest.fn(({ where }: { where: Record<string, unknown> }) => {
      const value = rows.get(String(where[key as string]));
      if (
        !value ||
        value.consumedAt ||
        value['expiresAt' as keyof T] <= new Date()
      )
        return Promise.resolve(null);
      if (
        where['browserHash'] &&
        value['browserHash' as keyof T] !== where['browserHash']
      )
        return Promise.resolve(null);
      if (
        where['provider'] &&
        value['provider' as keyof T] !== where['provider']
      )
        return Promise.resolve(null);
      return Promise.resolve(value);
    }),
    update: jest.fn((where: Record<string, unknown>, patch: Partial<T>) => {
      const value = rows.get(String(where[key as string]));
      if (!value || value.consumedAt) return Promise.resolve({ affected: 0 });
      if (
        where['browserHash'] &&
        value['browserHash' as keyof T] !== where['browserHash']
      )
        return Promise.resolve({ affected: 0 });
      Object.assign(value, patch);
      return Promise.resolve({ affected: 1 });
    }),
    delete: jest.fn().mockResolvedValue({ affected: 0 }),
  });
  const states = repo(stateRows, 'stateHash');
  const tickets = repo(ticketRows, 'ticketHash');
  const config = {
    get: (key: string) =>
      ({
        GOOGLE_WEB_REDIRECT_URI:
          'https://festicore-dev.up.railway.app/api/v1/auth/google/callback',
        APPLE_WEB_REDIRECT_URI:
          'https://festicore-dev.up.railway.app/api/v1/auth/apple/callback',
        APPLE_WEB_CLIENT_ID: 'co.festiCore.io',
        'auth.google.clientId': 'google-client',
      })[key],
  } as ConfigService;
  const auth = {
    completeWebLogin: jest
      .fn()
      .mockResolvedValue({ userId: 'user-id', newUser: true }),
    issueWebLogin: jest
      .fn()
      .mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh' }),
  } as unknown as AuthService;
  const googleExchange = jest.fn().mockResolvedValue({
    profile: { provider: 'google', providerId: 'subject' },
  });
  const google = {
    exchangeWebCode: googleExchange,
  } as unknown as GoogleService;
  const appleExchange = jest.fn().mockResolvedValue({
    profile: { provider: 'apple', providerId: 'subject' },
  });
  const apple = { exchangeWebCode: appleExchange } as unknown as AppleService;
  const service = new WebOauthService(
    config,
    auth,
    google,
    apple,
    states as unknown as Repository<WebOauthState>,
    tickets as unknown as Repository<WebOauthTicket>,
  );
  return { service, googleExchange, appleExchange, states, tickets };
}

describe('WebOauthService', () => {
  it('invalidates a cancelled state without exchanging provider code', async () => {
    const { service, googleExchange } = harness();
    const started = await service.begin('google');
    const state = new URL(started.url).searchParams.get('state')!;
    await expect(
      service.cancel('google', state, 'other-browser'),
    ).rejects.toThrow();
    await service.cancel('google', state, started.browserToken);
    await expect(
      service.finish('google', 'code', state, started.browserToken),
    ).rejects.toThrow();
    expect(googleExchange).not.toHaveBeenCalled();
  });

  it('removes expired states and tickets before starting a new login', async () => {
    const { service, states, tickets } = harness();
    await service.begin('google');
    expect(states.delete).toHaveBeenCalledTimes(1);
    expect(tickets.delete).toHaveBeenCalledTimes(1);
  });
  it('binds state to the initiating browser and rejects replay', async () => {
    const { service, googleExchange } = harness();
    const started = await service.begin('google');
    const state = new URL(started.url).searchParams.get('state')!;
    await expect(
      service.finish('google', 'code', state, 'other-browser'),
    ).rejects.toThrow();
    const ticket = await service.finish(
      'google',
      'code',
      state,
      started.browserToken,
    );
    expect(ticket).toBeTruthy();
    expect(googleExchange).toHaveBeenCalledTimes(1);
    await expect(
      service.finish('google', 'code', state, started.browserToken),
    ).rejects.toThrow();
  });

  it('consumes the short-lived ticket once', async () => {
    const { service, appleExchange } = harness();
    const started = await service.begin('apple');
    const state = new URL(started.url).searchParams.get('state')!;
    const ticket = await service.finish(
      'apple',
      'code',
      state,
      started.browserToken,
      '길동 홍',
    );
    expect(appleExchange).toHaveBeenCalledWith(
      'code',
      'https://festicore-dev.up.railway.app/api/v1/auth/apple/callback',
      expect.any(String),
      '길동 홍',
    );
    await expect(service.consumeTicket(ticket)).resolves.toMatchObject({
      accessToken: 'access',
    });
    await expect(service.consumeTicket(ticket)).rejects.toThrow();
  });
});
