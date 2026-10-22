import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AdminRoles } from '../admin/auth/admin-roles.decorator';
import { Public } from '../auth/decorator/public.decorator';
import { MetricsService } from './metrics.service';

@ApiTags('Metrics')
@Public()
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Post('events')
  @HttpCode(202)
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @ApiOperation({
    summary: '클라이언트 관측 이벤트 일괄 수집',
    description:
      '최대 100건. 인증 선택, X-Device-Id(UUID v4) 필수. 서버는 IP와 토큰을 저장하지 않습니다.',
  })
  @ApiHeader({
    name: 'X-Device-Id',
    required: true,
    description: 'UUID v4 기기 ID',
  })
  @ApiResponse({ status: 202, description: '수집됨. 응답 본문 없음.' })
  @ApiResponse({ status: 400, description: '이벤트 형식 또는 범위 오류' })
  @ApiResponse({ status: 429, description: '분당 요청 제한 초과' })
  async ingest(
    @Req() request: Request,
    @Res() response: Response,
    @Body() body: unknown,
  ): Promise<void> {
    await this.metrics.ingest(request.header('x-device-id') ?? '', body);
    response.status(202).end();
  }
}

@ApiTags('Admin Metrics')
@ApiBearerAuth()
@Controller('admin/metrics')
export class AdminMetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  @AdminRoles('viewer')
  @ApiOperation({
    summary: '축제 클라이언트 관측 집계',
    description:
      'Bearer JWT와 viewer 이상 관리자 권한이 필요합니다. 기본 기간은 발행된 축제의 첫 시작부터 마지막 종료까지입니다. 비율은 0~1입니다.',
  })
  @ApiQuery({ name: 'festivalId', required: true, example: 'fst_01234567' })
  @ApiQuery({
    name: 'from',
    required: false,
    description: '시간대 포함 ISO8601',
  })
  @ApiQuery({ name: 'to', required: false, description: '시간대 포함 ISO8601' })
  @ApiQuery({ name: 'bucket', required: false, enum: ['1h', '1d'] })
  @ApiResponse({ status: 200, description: '시간 버킷별 집계' })
  @ApiResponse({ status: 400, description: '조회 범위 또는 축제 ID 오류' })
  @ApiResponse({ status: 401, description: '유효한 access JWT가 없습니다.' })
  @ApiResponse({ status: 404, description: '발행된 축제 없음' })
  report(
    @Query('festivalId') festivalId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('bucket') bucket?: string,
  ) {
    return this.metrics.report(festivalId, from, to, bucket);
  }
}
