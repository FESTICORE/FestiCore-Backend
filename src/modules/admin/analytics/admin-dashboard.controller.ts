import {
  BadRequestException,
  Controller,
  Get,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AdminRoles } from '../auth/admin-roles.decorator';
import { parseAnalyticsRange } from './admin-analytics.range';
import { AdminDashboardService } from './admin-dashboard.service';

@ApiTags('Admin Analytics')
@ApiBearerAuth()
@Controller('admin/dashboard')
export class AdminDashboardController {
  constructor(private readonly dashboard: AdminDashboardService) {}

  @Get('summary')
  @AdminRoles('viewer')
  @ApiOperation({
    summary: '오늘(KST) 요약과 참여율',
    description:
      '오늘 신규 가입·로그인(세션 발급)·활성 기기(지표 이벤트 기준)·누적 가입자와 현재 참여율(0~1, 분모가 0이면 null)을 반환합니다.',
  })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        date: '2026-11-20',
        newUsers: 3,
        logins: 12,
        activeDevices: 40,
        totalUsers: 120,
        engagement: {
          pushOptInRate: 0.62,
          flagFollowerRate: 0.31,
          crewMemberRate: 0.12,
          notificationReadRate: 0.4,
          notifications30d: 300,
        },
      },
    },
  })
  summary(@Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'no-store');
    return this.dashboard.summary();
  }

  @Get('trends')
  @AdminRoles('viewer')
  @ApiOperation({
    summary: '가입·로그인·활성 기기·깃발 팔로우 추이',
    description:
      'KST 날짜 기준, 최대 92일. granularity=week는 월요일 시작 주 단위. 빈 구간은 0으로 채웁니다.',
  })
  @ApiQuery({ name: 'from', description: 'KST 시작 날짜 YYYY-MM-DD' })
  @ApiQuery({ name: 'to', description: 'KST 종료 날짜 YYYY-MM-DD (포함)' })
  @ApiQuery({ name: 'granularity', enum: ['day', 'week'], required: false })
  @ApiResponse({ status: 400, description: '날짜 또는 단위 오류' })
  trends(
    @Res({ passthrough: true }) response: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('granularity') granularity = 'day',
  ) {
    response.setHeader('Cache-Control', 'no-store');
    if (granularity !== 'day' && granularity !== 'week')
      throw new BadRequestException('granularity는 day 또는 week여야 합니다.');
    return this.dashboard.trends(
      parseAnalyticsRange(from, to, 92),
      granularity,
    );
  }
}
