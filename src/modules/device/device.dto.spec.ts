import { validate } from 'class-validator';
import { NotificationSettingsDto, RegisterDeviceDto } from './device.dto';

describe('RegisterDeviceDto APNs 토큰', () => {
  const make = (apnsToken: string | null) =>
    Object.assign(new RegisterDeviceDto(), {
      apnsToken,
      apnsEnvironment: 'sandbox',
      appVersion: '1.0.0',
      osVersion: '18.0',
      locale: 'ko-KR',
      timezone: 'Asia/Seoul',
    });

  it('토큰 길이를 64자로 고정하지 않고 짝수 길이 hex만 허용한다', async () => {
    expect(await validate(make('ab'.repeat(40)))).toHaveLength(0);
    expect(await validate(make('ab'.repeat(129)))).not.toHaveLength(0);
    expect(await validate(make('abc'))).not.toHaveLength(0);
    expect(await validate(make('gg'))).not.toHaveLength(0);
    expect(await validate(make(null))).toHaveLength(0);
  });

  it('첫 기기 등록에는 apnsToken 키가 필요하고 DB 길이 제한을 지킨다', async () => {
    const missing = make(null);
    Reflect.deleteProperty(missing, 'apnsToken');
    expect(await validate(missing)).not.toHaveLength(0);
    expect(
      await validate(
        Object.assign(make(null), { appVersion: `1.0.0-${'a'.repeat(40)}` }),
      ),
    ).not.toHaveLength(0);
    expect(
      await validate(
        Object.assign(make(null), { locale: `ko-${'a'.repeat(40)}` }),
      ),
    ).not.toHaveLength(0);
  });

  it('APNs 환경을 앱 토큰에 맞춰 명시해야 한다', async () => {
    expect(
      await validate(
        Object.assign(make(null), { apnsEnvironment: 'production' }),
      ),
    ).toHaveLength(0);
    expect(
      await validate(
        Object.assign(make(null), { apnsEnvironment: 'development' }),
      ),
    ).not.toHaveLength(0);
    const missing = make(null);
    Reflect.deleteProperty(missing, 'apnsEnvironment');
    expect(await validate(missing)).not.toHaveLength(0);
  });
});

describe('RegisterDeviceDto 플랫폼', () => {
  const base = {
    appVersion: '1.0.0',
    osVersion: '15',
    locale: 'ko-KR',
    timezone: 'Asia/Seoul',
  };
  const ios = (values: Record<string, unknown> = {}) =>
    Object.assign(new RegisterDeviceDto(), {
      ...base,
      apnsToken: null,
      apnsEnvironment: 'sandbox',
      ...values,
    });
  const android = (values: Record<string, unknown> = {}) =>
    Object.assign(new RegisterDeviceDto(), {
      ...base,
      platform: 'android',
      fcmToken: 'fcm-token:APA91b_x-1',
      ...values,
    });
  const failed = async (dto: RegisterDeviceDto) =>
    (await validate(dto)).map(({ property }) => property);

  it('platform을 생략하거나 ios로 보내면 기존 iOS 규칙을 그대로 쓴다', async () => {
    expect(await failed(ios())).toEqual([]);
    expect(await failed(ios({ platform: 'ios' }))).toEqual([]);
    expect(
      await failed(ios({ platform: 'ios', apnsEnvironment: null })),
    ).toEqual(['apnsEnvironment']);
    expect(await failed(ios({ platform: 'web' }))).toEqual(['platform']);
    expect(await failed(ios({ platform: null }))).toEqual(['platform']);
  });

  it('iOS의 fcmToken은 생략 또는 null만 허용한다', async () => {
    expect(await failed(ios({ fcmToken: null }))).toEqual([]);
    expect(await failed(ios({ fcmToken: 'x' }))).toEqual(['fcmToken']);
    expect(await failed(ios({ fcmToken: '' }))).toEqual(['fcmToken']);
  });

  it('Android는 fcmToken 키가 필수이고 null을 허용하며 APNs 필드 없이 통과한다', async () => {
    expect(await failed(android())).toEqual([]);
    expect(await failed(android({ fcmToken: null }))).toEqual([]);
    const missing = android();
    Reflect.deleteProperty(missing, 'fcmToken');
    expect(await failed(missing)).toEqual(['fcmToken']);
  });

  it('Android fcmToken은 빈 문자열 · 공백 · 4096자 초과 · 문자열 외 값을 막는다', async () => {
    expect(await failed(android({ fcmToken: 'a'.repeat(4096) }))).toEqual([]);
    expect(await failed(android({ fcmToken: 'a'.repeat(4097) }))).toEqual([
      'fcmToken',
    ]);
    expect(await failed(android({ fcmToken: '' }))).toEqual(['fcmToken']);
    expect(await failed(android({ fcmToken: 'a b' }))).toEqual(['fcmToken']);
    expect(await failed(android({ fcmToken: 123 }))).toEqual(['fcmToken']);
  });

  it('Android에 null이 아닌 APNs · Live Activity 필드가 있으면 막는다', async () => {
    expect(
      await failed(
        android({
          apnsToken: null,
          apnsEnvironment: null,
          liveActivityPushToStartToken: null,
        }),
      ),
    ).toEqual([]);
    for (const values of [
      { apnsToken: 'ab'.repeat(32) },
      { apnsEnvironment: 'production' },
      { liveActivityPushToStartToken: 'cd'.repeat(32) },
    ]) {
      expect(await failed(android(values))).toEqual(['platform']);
    }
  });
});

describe('NotificationSettingsDto', () => {
  const make = (values: Record<string, unknown>) =>
    Object.assign(new NotificationSettingsDto(), values);

  it('알림 종류는 선택 boolean만 받는다', async () => {
    expect(await validate(make({}))).toHaveLength(0);
    expect(
      await validate(make({ flagStatus: false, packUpdates: true })),
    ).toHaveLength(0);
    expect(await validate(make({ crewGather: 'false' }))).not.toHaveLength(0);
    expect(await validate(make({ homecoming: 1 }))).not.toHaveLength(0);
  });
});
