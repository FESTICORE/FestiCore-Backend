import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { AdminRequest } from '../../auth/admin-session.guard';
import { AdminRoles } from '../../auth/admin-roles.decorator';
import { CrawlAlertService } from '../service/crawl-alert.service';

@ApiTags('Admin Crawl')
@ApiBearerAuth()
@ApiResponse({ status: 401, description: '유효한 access JWT가 없습니다.' })
@ApiResponse({
  status: 403,
  description: '관리자 권한 또는 요청 출처가 허용되지 않았습니다.',
})
@Controller('admin/crawl/alerts')
export class CrawlAlertController {
  constructor(private readonly alerts: CrawlAlertService) {}

  @Get()
  @AdminRoles('viewer')
  @ApiOperation({
    summary: '크롤 장애 알림 목록',
    description:
      'viewer 이상. 수집이 연속 3회 실패한 소스의 장애 알림을 최신순으로 조회합니다.',
  })
  @ApiQuery({ name: 'status', required: false, enum: ['open', 'acknowledged'] })
  @ApiQuery({
    name: 'limit',
    required: false,
    example: 50,
    description: '1~100, 기본 50',
  })
  @ApiResponse({
    status: 200,
    description:
      'items 배열에 sourceId, runId, reason, createdAt, acknowledgedAt, acknowledgedBy를 반환합니다.',
  })
  list(@Query('status') status?: string, @Query('limit') limit?: string) {
    return this.alerts.list(status, limit);
  }

  @Patch(':id/acknowledge')
  @AdminRoles('editor')
  @ApiOperation({
    summary: '크롤 장애 알림 확인',
    description:
      'editor 이상. JWT 사용자에 연결된 관리자 계정 ID와 확인 시각을 저장합니다. 중복 확인은 기존 결과를 반환합니다.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: '알림 ID' })
  @ApiResponse({ status: 200, description: '확인된 알림' })
  @ApiResponse({ status: 404, description: '알림이 없습니다.' })
  acknowledge(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: AdminRequest,
  ) {
    return this.alerts.acknowledge(id, request.admin!.id);
  }
}
