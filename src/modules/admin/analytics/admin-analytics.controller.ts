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
import {
  AdminAnalyticsService,
  parseFunnelSteps,
} from './admin-analytics.service';
import { parseAnalyticsRange } from './admin-analytics.range';

@ApiTags('Admin Analytics')
@ApiBearerAuth()
@Controller('admin/analytics')
export class AdminAnalyticsController {
  constructor(private readonly analytics: AdminAnalyticsService) {}

  @Get('sentry')
  @AdminRoles('viewer')
  @ApiOperation({ summary: 'Sentry 오류 이벤트 및 이슈 조회' })
  @ApiQuery({ name: 'from', description: 'KST 시작 날짜 YYYY-MM-DD' })
  @ApiQuery({ name: 'to', description: 'KST 종료 날짜 YYYY-MM-DD (포함)' })
  @ApiQuery({ name: 'project', enum: ['ios', 'backend'] })
  @ApiResponse({
    status: 200,
    description: 'Sentry 분석 결과. 실패 시 status와 null 집계 반환',
  })
  @ApiResponse({ status: 400, description: '날짜 또는 프로젝트 오류' })
  sentry(
    @Res({ passthrough: true }) response: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('project') project?: string,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    if (project !== 'ios' && project !== 'backend')
      throw new BadRequestException('project는 ios 또는 backend여야 합니다.');
    return this.analytics.sentry(parseAnalyticsRange(from, to), project);
  }

  @Get('mixpanel')
  @AdminRoles('viewer')
  @ApiOperation({ summary: 'Mixpanel 공유 프로젝트 이벤트 조회' })
  @ApiQuery({ name: 'from', description: 'KST 시작 날짜 YYYY-MM-DD' })
  @ApiQuery({ name: 'to', description: 'KST 종료 날짜 YYYY-MM-DD (포함)' })
  @ApiResponse({
    status: 200,
    description: 'Mixpanel 이벤트 집계. 조회량 상한 시 partial/truncated',
  })
  @ApiResponse({ status: 400, description: '날짜 오류' })
  mixpanel(
    @Res({ passthrough: true }) response: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.analytics.mixpanel(parseAnalyticsRange(from, to));
  }

  @Get('mixpanel/funnel')
  @AdminRoles('viewer')
  @ApiOperation({ summary: 'Mixpanel 이벤트 퍼널(단계별 도달 사용자 수) 조회' })
  @ApiQuery({ name: 'from', description: 'KST 시작 날짜 YYYY-MM-DD' })
  @ApiQuery({ name: 'to', description: 'KST 종료 날짜 YYYY-MM-DD (포함)' })
  @ApiQuery({
    name: 'steps',
    description: '쉼표로 구분한 이벤트 이름 2~5개 (예: app_open,screen_view)',
  })
  @ApiResponse({
    status: 200,
    description: '단계별 고유 사용자 수. 조회량 상한 시 partial/truncated',
  })
  @ApiResponse({ status: 400, description: '날짜 또는 단계 오류' })
  funnel(
    @Res({ passthrough: true }) response: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('steps') steps?: string,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.analytics.funnel(
      parseAnalyticsRange(from, to),
      parseFunnelSteps(steps),
    );
  }
}
