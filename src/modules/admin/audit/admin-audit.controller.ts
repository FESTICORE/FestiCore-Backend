import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiCookieAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AdminRoles } from '../auth/admin-roles.decorator';
import { AdminAuditService } from './admin-audit.service';

@ApiTags('Admin Audit')
@ApiCookieAuth('admin-session')
@Controller('admin/audit')
export class AdminAuditController {
  constructor(private readonly audit: AdminAuditService) {}

  @Get()
  @AdminRoles('owner')
  @ApiOperation({
    summary: '관리자 변경 이력 조회',
    description:
      'owner 전용. 관리자 변경 이력을 최신순으로 조회합니다. actor는 관리자 ID와 정확히 일치합니다.',
  })
  @ApiQuery({ name: 'actor', required: false, description: '관리자 ID' })
  @ApiQuery({
    name: 'from',
    required: false,
    description: '시간대 포함 ISO8601 시작 시각',
  })
  @ApiQuery({
    name: 'to',
    required: false,
    description: '시간대 포함 ISO8601 종료 시각',
  })
  @ApiQuery({ name: 'limit', required: false, description: '1~100, 기본 50' })
  @ApiQuery({ name: 'offset', required: false, description: '0~10000, 기본 0' })
  @ApiResponse({
    status: 200,
    description: 'items에 at, actor, action, target, before, after 반환',
  })
  @ApiResponse({ status: 400, description: '조회 필터 형식 오류' })
  @ApiResponse({ status: 401, description: '관리자 세션 없음' })
  @ApiResponse({ status: 403, description: 'owner 권한 또는 요청 출처 불일치' })
  list(
    @Res({ passthrough: true }) response: Response,
    @Query('actor') actor?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.audit.list(actor, from, to, limit, offset);
  }
}
