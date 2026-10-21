import { ConflictException, ForbiddenException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { AdminAuditService } from '../audit/admin-audit.service';
import { AdminAccountsService } from './admin-accounts.service';
import { AdminAccount } from './admin.entity';

describe('AdminAccountsService', () => {
  const row: AdminAccount = {
    id: 'admin-id',
    email: 'owner@example.com',
    userId: null,
    role: 'owner',
    active: true,
    createdAt: new Date(),
  };
  const accountRepo = {
    findOneBy: jest.fn(),
    countBy: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    find: jest.fn(),
  };
  const query = jest.fn().mockResolvedValue([]);
  const manager = {
    query,
    getRepository: jest.fn(() => accountRepo),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new AdminAccountsService(
    accountRepo as unknown as Repository<AdminAccount>,
    {
      transaction: (fn: (value: typeof manager) => Promise<unknown>) =>
        fn(manager),
    } as unknown as DataSource,
    audit as unknown as AdminAuditService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    accountRepo.findOneBy.mockResolvedValue(null);
    accountRepo.create.mockImplementation((input: Partial<AdminAccount>) => ({
      ...row,
      ...input,
    }));
    accountRepo.save.mockImplementation((input: AdminAccount) =>
      Promise.resolve(input),
    );
    accountRepo.countBy.mockResolvedValue(1);
  });

  it('stores an email grant without resolving a stale User.email or sending mail', async () => {
    const result = await service.invite(
      'actor-id',
      'OWNER@EXAMPLE.COM',
      'viewer',
    );
    expect(accountRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'owner@example.com',
        userId: null,
        role: 'viewer',
      }),
    );
    expect(result).toMatchObject({
      email: 'owner@example.com',
      userId: null,
      role: 'viewer',
    });
    expect(result).not.toHaveProperty('loginLinkRequested');
  });

  it('rejects duplicate active email grants', async () => {
    accountRepo.findOneBy.mockResolvedValueOnce({
      ...row,
    });
    await expect(
      service.invite('actor-id', 'OWNER@EXAMPLE.COM', 'editor'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('requires a new verified Google login when reactivating a disabled grant', async () => {
    accountRepo.findOneBy.mockResolvedValueOnce({
      ...row,
      active: false,
      userId: 'previous-user',
    });
    await service.invite('actor-id', 'owner@example.com', 'editor');
    expect(accountRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ userId: null, active: true, role: 'editor' }),
    );
  });

  it('preserves self and last-owner disable safety', async () => {
    await expect(
      service.disable('admin-id', 'admin-id'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    accountRepo.findOneBy.mockResolvedValue(row);
    await expect(
      service.disable('actor-id', 'admin-id'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(accountRepo.update).not.toHaveBeenCalled();
  });

  it('clears the user binding when disabling a grant', async () => {
    accountRepo.findOneBy.mockResolvedValue({
      ...row,
      role: 'editor',
      userId: 'previous-user',
    });
    await service.disable('actor-id', 'admin-id');
    expect(accountRepo.update).toHaveBeenCalledWith(
      { id: 'admin-id', active: true },
      { active: false, userId: null },
    );
  });
});
