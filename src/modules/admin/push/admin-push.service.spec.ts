import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AdminPushService } from './admin-push.service';

jest.mock('../../notification/apns.service', () => ({ ApnsService: class {} }));
jest.mock('../../notification/fcm.service', () => ({ FcmService: class {} }));

const DEVICE_ID = '1f0d7050-9b11-4099-84b5-7d71e31f8850';

describe('AdminPushService', () => {
  const findOne = jest.fn();
  const isConfiguredFor = jest.fn();
  const sendTestNotification = jest.fn();
  const record = jest.fn();
  const transaction = jest.fn(
    async (callback: (manager: object) => Promise<void>) => callback({}),
  );
  const service = new AdminPushService(
    { findOne } as never,
    { isConfiguredFor, sendTestNotification } as never,
    { record } as never,
    { transaction } as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    isConfiguredFor.mockReturnValue(true);
    findOne.mockResolvedValue({
      id: DEVICE_ID,
      platform: 'ios',
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
      select: {
        id: true,
        platform: true,
        apnsToken: true,
        apnsEnvironment: true,
        fcmToken: true,
      },
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
      expect.objectContaining({
        platform: 'ios',
        apnsToken: 'ab'.repeat(32),
        apnsEnvironment: 'sandbox',
      }),
      'pack.updated',
    );
    expect(JSON.stringify(record.mock.calls)).not.toContain('abababab');
  });

  it('refuses an unknown device, missing token, or APNs configuration', async () => {
    isConfiguredFor.mockReturnValue(false);
    await expect(
      service.sendTest({ deviceId: DEVICE_ID, type: 'crew.status' }, 'admin-1'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(isConfiguredFor).toHaveBeenCalledWith('ios');
    isConfiguredFor.mockReturnValue(true);
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
  it('sends an Android device test push through its FCM token', async () => {
    findOne.mockResolvedValueOnce({
      id: DEVICE_ID,
      platform: 'android',
      apnsToken: null,
      apnsEnvironment: null,
      fcmToken: 'fcm-registration-token',
    });
    sendTestNotification.mockResolvedValueOnce({
      accepted: false,
      permanent: true,
      reason: 'FCM_UNREGISTERED',
    });
    await expect(
      service.sendTest({ deviceId: DEVICE_ID, type: 'crew.gather' }, 'admin-1'),
    ).resolves.toEqual({
      deviceId: DEVICE_ID,
      type: 'crew.gather',
      accepted: false,
      reason: 'FCM_UNREGISTERED',
    });
    expect(isConfiguredFor).toHaveBeenCalledWith('android');
    expect(sendTestNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: 'android',
        fcmToken: 'fcm-registration-token',
      }),
      'crew.gather',
    );
    expect(JSON.stringify(record.mock.calls)).not.toContain('fcm-registration');
  });

  it('refuses an Android device without FCM configuration or token', async () => {
    const android = {
      id: DEVICE_ID,
      platform: 'android',
      apnsToken: null,
      apnsEnvironment: null,
      fcmToken: null,
    };
    findOne.mockResolvedValue(android);
    isConfiguredFor.mockImplementation((platform) => platform === 'ios');
    await expect(
      service.sendTest({ deviceId: DEVICE_ID, type: 'flag.status' }, 'admin-1'),
    ).rejects.toThrow('FCM 설정이 없어');
    isConfiguredFor.mockReturnValue(true);
    await expect(
      service.sendTest({ deviceId: DEVICE_ID, type: 'flag.status' }, 'admin-1'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(sendTestNotification).not.toHaveBeenCalled();
  });
});
