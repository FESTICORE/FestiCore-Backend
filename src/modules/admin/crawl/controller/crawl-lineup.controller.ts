import {
  BadRequestException,
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
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { AdminRoles } from '../../auth/admin-roles.decorator';
import { CrawlLineupRevisionService } from '../service/crawl-lineup-revision.service';

type AdminRequest = Request & { admin?: { id: string } };

function bodyWithKeys(body: unknown, keys: string[]): Record<string, unknown> {
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => !keys.includes(key))
  )
    throw new BadRequestException('허용되지 않은 검토 필드가 있습니다.');
  return body as Record<string, unknown>;
}

@ApiTags('Admin Crawl Lineup')
@ApiBearerAuth()
@ApiResponse({ status: 401, description: '관리자 인증이 필요합니다.' })
@ApiResponse({ status: 403, description: '관리자 권한이 부족합니다.' })
@Controller('admin/crawl/lineup-revisions')
export class CrawlLineupController {
  constructor(private readonly revisions: CrawlLineupRevisionService) {}

  @Get()
  @AdminRoles('viewer')
  @ApiOperation({
    summary: '공식 이미지 출연진 검토본 목록',
    description:
      'OCR 원문과 검토 상태를 최대 100건 반환합니다. 대기본은 공개 API에 표시되지 않습니다.',
  })
  list(@Query('sourceId') sourceId?: string, @Query('status') status?: string) {
    return this.revisions.list(sourceId, status);
  }

  @Post('from-run')
  @AdminRoles('editor')
  @ApiOperation({
    summary: '최신 NOL World 수집 증거로 출연진 검토본 생성',
    description:
      'crawl/runs의 최신 완료 실행에서 imageHash가 일치하는 OCR 원문만 등록합니다. 동일 증거는 기존 검토본을 반환합니다.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['runId', 'imageUrl', 'imageHash'],
      additionalProperties: false,
      properties: {
        runId: { type: 'string', format: 'uuid' },
        imageUrl: { type: 'string', format: 'uri' },
        imageHash: { type: 'string', pattern: '^[0-9a-fA-F]{64}$' },
      },
    },
  })
  stage(@Body() raw: unknown) {
    const body = bodyWithKeys(raw, ['runId', 'imageUrl', 'imageHash']);
    if (
      typeof body.runId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        body.runId,
      ) ||
      typeof body.imageUrl !== 'string' ||
      typeof body.imageHash !== 'string'
    )
      throw new BadRequestException('runId, imageUrl, imageHash가 필요합니다.');
    return this.revisions.stage(body.runId, body.imageUrl, body.imageHash);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @AdminRoles('editor')
  @ApiOperation({
    summary: '출연진 이름 검토 승인',
    description:
      '원본 SHA-256과 OCR 행 인덱스를 확인한 교정 이름만 공개합니다. 공연 시각, 무대, 이미지는 생성하지 않습니다.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['imageHash', 'artists'],
      additionalProperties: false,
      properties: {
        imageHash: { type: 'string', pattern: '^[0-9a-fA-F]{64}$' },
        artists: {
          type: 'array',
          minItems: 1,
          maxItems: 80,
          items: {
            type: 'object',
            required: ['name', 'lineIndex'],
            additionalProperties: false,
            properties: {
              name: { type: 'string', maxLength: 160 },
              lineIndex: { type: 'integer', minimum: 0 },
            },
          },
        },
      },
    },
  })
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() raw: unknown,
    @Req() req: AdminRequest,
  ) {
    const body = bodyWithKeys(raw, ['imageHash', 'artists']);
    if (typeof body.imageHash !== 'string')
      throw new BadRequestException('imageHash가 필요합니다.');
    return this.revisions.review(
      id,
      req.admin!.id,
      body.imageHash,
      'approved',
      body.artists,
    );
  }

  @Post(':id/reject')
  @HttpCode(200)
  @AdminRoles('editor')
  @ApiOperation({ summary: '출연진 검토본 거절' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['imageHash'],
      additionalProperties: false,
      properties: {
        imageHash: { type: 'string', pattern: '^[0-9a-fA-F]{64}$' },
      },
    },
  })
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() raw: unknown,
    @Req() req: AdminRequest,
  ) {
    const body = bodyWithKeys(raw, ['imageHash']);
    if (typeof body.imageHash !== 'string')
      throw new BadRequestException('imageHash가 필요합니다.');
    return this.revisions.review(id, req.admin!.id, body.imageHash, 'rejected');
  }
}
