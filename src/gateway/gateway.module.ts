import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AllExceptionsFilter } from '../common/filters/all-exceptions.filter';
import { LoggingInterceptor } from '../common/interceptors/logging.interceptor';
import { ResponseInterceptor } from '../common/interceptors/response.interceptor';
import { JwtAuthGuard } from '../modules/auth/guard/jwt-auth.guard';
import { AdminAuthModule } from '../modules/admin/auth/admin-auth.module';
import { AdminSessionGuard } from '../modules/admin/auth/admin-session.guard';
import { User } from '../modules/auth/entity/user.entity';

/**
 * 외부 HTTP 요청이 기능 모듈로 들어가기 전에 반드시 통과하는 Gateway 경계.
 * 인증, rate limit, 로깅, 응답/예외 규격을 이 모듈에서 전역 적용한다.
 */
@Module({
  imports: [
    JwtModule.register({}),
    TypeOrmModule.forFeature([User]),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    AdminAuthModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useExisting: AdminSessionGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class GatewayModule {}
