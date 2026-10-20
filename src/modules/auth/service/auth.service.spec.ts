import { Repository } from 'typeorm';

jest.mock('jose', () => ({
  createRemoteJWKSet: jest.fn(),
  decodeJwt: jest.fn(),
  importPKCS8: jest.fn(),
  jwtVerify: jest.fn(),
  SignJWT: jest.fn(),
}));
import { User } from '../entity/user.entity';
import { AppleService } from './apple.service';
import { AuthService } from './auth.service';
import { GoogleService } from './google.service';
import { TokenService } from './token.service';

describe('AuthService web grant replacement', () => {
  it('uses one account for Google app and web login with the same subject', async () => {
    const users: User[] = [];
    const repo = {
      findOne: jest
        .fn()
        .mockImplementation(({ where }: { where: Partial<User> }) =>
          Promise.resolve(
            users.find(
              (user) =>
                user.provider === where.provider &&
                user.providerId === where.providerId,
            ) ?? null,
          ),
        ),
      create: jest.fn().mockImplementation((input: User) => input),
      save: jest.fn().mockImplementation((input: User) => {
        const user = { ...input, id: 'shared-user' };
        users.push(user);
        return Promise.resolve(user);
      }),
    } as unknown as Repository<User>;
    const google = {
      verify: jest.fn().mockResolvedValue({
        provider: 'google',
        providerId: 'same-google-sub',
      }),
    } as unknown as GoogleService;
    const token = {
      issue: jest.fn().mockResolvedValue({
        accessToken: 'access',
        refreshToken: 'refresh',
      }),
    } as unknown as TokenService;
    const service = new AuthService(google, {} as AppleService, token, repo);

    const app = await service.login({
      provider: 'google',
      token: 'app-id-token',
    });
    const web = await service.completeWebLogin({
      provider: 'google',
      providerId: 'same-google-sub',
    });

    expect(app.user.id).toBe('shared-user');
    expect(app.newUser).toBe(true);
    expect(web).toEqual({ userId: 'shared-user', newUser: false });
    expect(users).toHaveLength(1);
  });

  it('keeps provider authorization active when replacing a web refresh token', async () => {
    const user = {
      id: 'user-id',
      provider: 'apple',
      providerId: 'subject',
    } as User;
    const update = jest.fn().mockResolvedValue({ affected: 1 });
    const repo = {
      findOne: jest.fn().mockResolvedValueOnce(user).mockResolvedValueOnce({
        id: user.id,
        oauthWebRefreshToken: 'old-grant',
        oauthWebClientId: 'old-client',
      }),
      update,
    } as unknown as Repository<User>;
    const revokeConnection = jest.fn().mockResolvedValue(undefined);
    const apple = { revokeConnection } as unknown as AppleService;
    const service = new AuthService(
      {} as GoogleService,
      apple,
      {} as TokenService,
      repo,
    );

    await expect(
      service.completeWebLogin(
        { provider: 'apple', providerId: 'subject' },
        {
          refreshToken: 'new-grant',
          subject: 'subject',
          clientId: 'new-client',
        },
      ),
    ).resolves.toEqual({ userId: user.id, newUser: false });
    expect(update).toHaveBeenCalledWith(
      { id: user.id },
      {
        oauthWebRefreshToken: 'new-grant',
        oauthWebClientId: 'new-client',
      },
    );
    expect(revokeConnection).not.toHaveBeenCalled();
  });
});
