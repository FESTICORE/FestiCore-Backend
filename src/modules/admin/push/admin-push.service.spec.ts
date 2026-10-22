import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AdminPushService } from './admin-push.service';

jest.mock('../../notification/apns.service', () => ({ ApnsService: class {} }));

const DEVICE_ID = '1f0d7050-9b11-4099-84b5-7d71e31f8850';

describe('AdminPushService', () => {
  const findOne = jest.fn();
  const isConfigured = jest.fn();
  const sendTestNotification = jest.fn();
  const record = jest.fn();
  const transaction = jest.fn(
    async (callback: (manager: object) => Promise<void>) => callback({}),
  );
  const service = new AdminPushService(
    { findOne } as never,
    { isConfigured, sendTestNotification } as never,
    { record } as never,
    { transaction } as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    isConfigured.mockReturnValue(true);
    findOne.mockResolvedValue({
      id: DEVICE_ID,
      apnsToken: 'ab'.repeat(32),
      apnsEnvironment: 'sandbox',
    });
    sendTestNotification.mockResolvedValue({
      accepted: true,
      permanent: false,
    });
    record.mockResolvedValue(undefined);
  });

  it('records and sends only to the stored token for the requested device', async () => {
    await expect(
      service.sendTest(
        { deviceId: DEVICE_ID, type: 'pack.updated' },
        'admin-1',
      ),
    ).resolves.toEqual({
      deviceId: DEVICE_ID,
      type: 'pack.updated',
      accepted: true,
      reason: null,
    });
    expect(findOne).toHaveBeenCalledWith({
      where: { id: DEVICE_ID },
      select: { id: true, apnsToken: true, apnsEnvironment: true },
    });
    expect(record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actor: 'admin-1',
        action: 'push.test.requested',
        target: `device:${DEVICE_ID}`,
        after: { type: 'pack.updated' },
      }),
    );
    expect(sendTestNotification).toHaveBeenCalledWith(
      'ab'.repeat(32),
      'sandbox',
      'pack.updated',
    );
    expect(JSON.stringify(record.mock.calls)).not.toContain('abababab');
  });

  it('refuses an unknown device, missing token, or APNs configuration', async () => {
    isConfigured.mockReturnValue(false);
    await expect(
      service.sendTest({ deviceId: DEVICE_ID, type: 'crew.status' }, 'admin-1'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    isConfigured.mockReturnValue(true);
    findOne.mockResolvedValueOnce(null);
    await expect(
      service.sendTest({ deviceId: DEVICE_ID, type: 'crew.status' }, 'admin-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    findOne.mockResolvedValueOnce({ id: DEVICE_ID, apnsToken: null });
    await expect(
      service.sendTest({ deviceId: DEVICE_ID, type: 'crew.status' }, 'admin-1'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(sendTestNotification).not.toHaveBeenCalled();
  });

  it('does not send when the audit transaction fails', async () => {
    record.mockRejectedValueOnce(new Error('audit unavailable'));
    await expect(
      service.sendTest({ deviceId: DEVICE_ID, type: 'flag.status' }, 'admin-1'),
    ).rejects.toThrow('audit unavailable');
    expect(sendTestNotification).not.toHaveBeenCalled();
  });
});
