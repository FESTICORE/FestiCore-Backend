import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ADMIN_ROLES_KEY } from '../admin/auth/admin-roles.decorator';
import { AdminLegalController } from './admin-legal.controller';
import { LegalService } from './legal.service';

describe('관리자 개인정보처리방침 API 계약', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AdminLegalController],
      providers: [{ provide: LegalService, useValue: {} }],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterAll(async () => app.close());

  it('읽기는 viewer부터, 수정은 owner에게만 허용하도록 표시한다', () => {
    const get = Object.getOwnPropertyDescriptor(
      AdminLegalController.prototype,
      'get',
    )?.value as object;
    const update = Object.getOwnPropertyDescriptor(
      AdminLegalController.prototype,
      'update',
    )?.value as object;
    expect(Reflect.getMetadata(ADMIN_ROLES_KEY, get)).toEqual(['viewer']);
    expect(Reflect.getMetadata(ADMIN_ROLES_KEY, update)).toEqual(['owner']);
  });

  it('관리자 Swagger에 편집 요청 본문과 충돌 응답을 설명한다', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('Admin').setVersion('1').build(),
    );
    const operations = document.paths['/api/v1/admin/legal/privacy'];
    expect(operations?.get?.responses['200']).toBeDefined();
    expect(operations?.put?.requestBody).toBeDefined();
    expect(operations?.put?.responses['409']).toBeDefined();
  });
});
