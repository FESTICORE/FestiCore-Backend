import { Module } from '@nestjs/common';
import { AdminAnalyticsController } from './admin-analytics.controller';
import { AdminAnalyticsService } from './admin-analytics.service';
import { AdminDashboardController } from './admin-dashboard.controller';
import { AdminDashboardService } from './admin-dashboard.service';

@Module({
  controllers: [AdminAnalyticsController, AdminDashboardController],
  providers: [AdminAnalyticsService, AdminDashboardService],
})
export class AdminAnalyticsModule {}
