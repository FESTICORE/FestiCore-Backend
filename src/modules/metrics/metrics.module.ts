import { Module } from '@nestjs/common';
import {
  MetricsController,
  AdminMetricsController,
} from './metrics.controller';
import { MetricsService } from './metrics.service';

@Module({
  controllers: [MetricsController, AdminMetricsController],
  providers: [MetricsService],
})
export class MetricsModule {}
