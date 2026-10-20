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
  it('revokes the previous provider grant after saving a replacement', async () => {
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
    expect(revokeConnection).toHaveBeenCalledWith('old-grant', 'old-client');
  });
});
