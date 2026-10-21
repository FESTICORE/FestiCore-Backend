import { validate } from 'class-validator';
import { RegisterDeviceDto } from './device.dto';

describe('RegisterDeviceDto APNs 토큰', () => {
  const make = (apnsToken: string | null) =>
    Object.assign(new RegisterDeviceDto(), {
      apnsToken,
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
});
