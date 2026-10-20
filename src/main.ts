import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { setupSwagger } from './swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const isProd = config.get<string>('NODE_ENV') === 'production';
  const port = config.get<number>('PORT') ?? 3000;

  app.setGlobalPrefix('api/v1');

  // 보안 헤더. Swagger UI가 인라인 스크립트를 쓰므로 CSP는 끄고 나머지만 적용한다.
  app.use(helmet({ contentSecurityPolicy: false }));

  // 운영은 명시한 origin만 허용한다. 로컬 개발만 설정이 없을 때 전체 허용한다.
  const origins = config.get<string>('CORS_ORIGINS');
  if (origins) {
    app.enableCors({
      origin: origins
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    });
  } else if (!isProd) {
    app.enableCors();
  }
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // 전체 문서 + 도메인별 문서(/api-docs/auth 등)도 단일 Gateway origin을 사용한다.
  setupSwagger(app, {
    publicUrl: config.get<string>('PUBLIC_URL'),
    port,
    isProd,
  });

  await app.listen(port);
}
void bootstrap();
