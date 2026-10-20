import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../auth/decorator/public.decorator';
import { HealthService } from '../service/health.service';

@ApiTags('Health')
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({ summary: '서버/DB 상태 확인 (DB 실패 시 503)' })
  check() {
    return this.healthService.check();
  }
}
