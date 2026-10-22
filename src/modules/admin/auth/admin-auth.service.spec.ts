import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, Repository } from 'typeorm';
import { AdminAuthService } from './admin-auth.service';
import { AdminAccount } from './admin.entity';

describe('AdminAuthService', () => {
  const findOneBy = jest.fn();
  const query = jest.fn().mockResolvedValue([]);
  const service = new AdminAuthService(
    { findOneBy } as unknown as Repository<AdminAccount>,
    {
      transaction: (fn: (manager: { query: jest.Mock }) => Promise<void>) =>
        fn({ query }),
    } as unknown as DataSource,
    {
      get: (key: string) =>
        ({
          ADMIN_OWNER_EMAIL: 'OWNER@EXAMPLE.COM',
          ADMIN_WEB_URL: 'https://admin.example.com',
          CORS_ORIGINS: 'https://admin.example.com',
        })[key],
    } as ConfigService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('seeds a pending owner grant without changing its stable admin ID', async () => {
    await service.onModuleInit();
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT ("email") DO NOTHING'),
      ['owner@example.com'],
    );
  });

  it('accepts mixed-case configured host names after origin normalization', async () => {
    const normalized = new AdminAuthService(
      { findOneBy } as unknown as Repository<AdminAccount>,
      {
        transaction: (fn: (manager: { query: jest.Mock }) => Promise<void>) =>
          fn({ query }),
      } as unknown as DataSource,
      {
        get: (key: string) =>
          ({
            ADMIN_WEB_URL: 'https://festicoreAdmin-dev.up.railway.app',
            CORS_ORIGINS: 'https://festicoreAdmin-dev.up.railway.app',
          })[key],
      } as ConfigService,
    );
    await expect(normalized.onModuleInit()).resolves.toBeUndefined();
  });

  it('uses only the bound user ID and rejects inactive or absent accounts', async () => {
    findOneBy
      .mockResolvedValueOnce({
        id: 'admin-id',
        email: 'owner@example.com',
        role: 'owner',
      })
      .mockResolvedValueOnce(null);
    await expect(service.findActiveByUserId('google-id')).resolves.toEqual({
      id: 'admin-id',
      email: 'owner@example.com',
      role: 'owner',
    });
    expect(findOneBy).toHaveBeenCalledWith({
      userId: 'google-id',
      active: true,
    });
    await expect(
      service.findActiveByUserId('google-id'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
