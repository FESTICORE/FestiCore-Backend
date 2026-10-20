import { Module } from '@nestjs/common';
import { HealthController } from './controller/health.controller';
import { HealthService } from './service/health.service';

/**
 * 헬스체크 모듈
 * 애플리케이션(서버/DB)의 상태 모니터링을 담당한다.
 */
@Module({
  controllers: [HealthController],
  providers: [HealthService],
  exports: [HealthService],
})
export class HealthModule {}
