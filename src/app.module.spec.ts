import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppModule } from './app.module';
import { AdminPushService } from './modules/admin/push/admin-push.service';
import { ApnsService } from './modules/notification/apns.service';
import { FcmService } from './modules/notification/fcm.service';
import { FestivalStartService } from './modules/notification/festival-start.service';
import { PushService } from './modules/notification/push.service';

const PUSH_ENV = [
  'APNS_BUNDLE_ID',
  'APNS_TEAM_ID',
  'APNS_KEY_ID',
  'APNS_PRIVATE_KEY',
  'FCM_SERVICE_ACCOUNT_JSON',
];

/**
 * 앱 전체 DI가 해석되는지만 본다. DB · APNs · FCM에 접속하지 않는다.
 * compile()은 모듈 초기화 훅(onModuleInit 등)을 부르지 않는다.
 */
describe('AppModule', () => {
  const saved = new Map<string, string | undefined>();

  beforeAll(() => {
    for (const key of PUSH_ENV) {
      saved.set(key, process.env[key]);
      delete process.env[key];
    }
  });

  afterAll(() => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('resolves every provider with APNs and FCM unconfigured', async () => {
    const dataSource = {
      options: { type: 'postgres' },
      entityMetadatas: [],
      isInitialized: false,
      getRepository: () => ({}),
      getTreeRepository: () => ({}),
      manager: {},
      destroy: jest.fn(),
    };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .compile();

    const push = moduleRef.get(PushService);
    expect(push.isConfigured()).toBe(false);
    expect(moduleRef.get(FcmService).isConfigured()).toBe(false);
    expect(moduleRef.get(ApnsService).isConfigured()).toBe(false);
    // NotificationModule과 AdminPushModule이 같은 발송기 인스턴스를 쓴다.
    expect(moduleRef.get(FestivalStartService)).toBeDefined();
    expect(moduleRef.get(AdminPushService)['push']).toBe(push);
    expect(moduleRef.get(ApnsService, { strict: false })).toBe(push['apns']);
  });
});
