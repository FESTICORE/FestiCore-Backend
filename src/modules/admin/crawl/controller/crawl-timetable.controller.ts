import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiPropertyOptional,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { IsArray, IsOptional } from 'class-validator';
import type { Request } from 'express';
import { AdminRoles } from '../../auth/admin-roles.decorator';
import type { CrawlTimetableSet } from '../entity/crawl-timetable-revision.entity';
import { CrawlTimetableRevisionService } from '../service/crawl-timetable-revision.service';

type AdminRequest = Request & { admin?: { id: string } };

class VerifyTimetableRevisionDto {
  @ApiPropertyOptional({
    description:
      '원본을 확인하며 교정한 공연 목록. 생략하면 OCR 후보 그대로 승인합니다. 종료 시간이 미공개인 경우 endsAt은 null입니다.',
    type: 'array',
    items: {
      type: 'object',
      required: ['artist', 'date', 'stageName', 'startsAt', 'endsAt'],
      properties: {
        artist: { type: 'string' },
        date: { type: 'string', format: 'date' },
        stageName: { type: 'string' },
        startsAt: { type: 'string', format: 'date-time' },
        endsAt: { type: 'string', format: 'date-time', nullable: true },
      },
    },
  })
  @IsOptional()
  @IsArray()
  sets?: CrawlTimetableSet[];
}

@ApiTags('Admin Crawl Timetable')
@ApiBearerAuth()
@ApiResponse({ status: 401, description: '관리자 인증이 필요합니다.' })
@ApiResponse({ status: 403, description: '관리자 권한이 부족합니다.' })
@Controller('admin/crawl/timetable-revisions')
export class CrawlTimetableController {
  constructor(private readonly revisions: CrawlTimetableRevisionService) {}

  @Get()
  @AdminRoles('viewer')
  @ApiOperation({
    summary: '공식 시간표 이미지 OCR 검토본 목록',
    description:
      '최신 100개. 검증 전 자료는 공개 축제 상세 API에 표시되지 않습니다.',
  })
  list(@Query('sourceId') sourceId?: string, @Query('status') status?: string) {
    return this.revisions.list(sourceId, status);
  }

  @Post(':id/verify')
  @HttpCode(200)
  @AdminRoles('editor')
  @ApiOperation({
    summary: '공식 시간표 검토본 승인',
    description:
      '공식 원본 이미지와 날짜·무대·아티스트·시각을 대조한 뒤 승인합니다. 필요하면 교정한 sets 전체를 보냅니다. 승인본만 공개됩니다.',
  })
  verify(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VerifyTimetableRevisionDto,
    @Req() req: AdminRequest,
  ) {
    return this.revisions.verify(id, req.admin!.id, dto?.sets);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @AdminRoles('editor')
  @ApiOperation({ summary: '공식 시간표 검토본 거절' })
  reject(@Param('id', ParseUUIDPipe) id: string, @Req() req: AdminRequest) {
    return this.revisions.reject(id, req.admin!.id);
  }
}
