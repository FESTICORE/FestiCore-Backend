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
import {
  CrawlArtistImageReviewService,
  PrepareArtistImageReviewInput,
} from '../service/crawl-artist-image-review.service';

type AdminRequest = Request & { admin?: { id: string } };

function bodyWithKeys(raw: unknown, keys: string[]): Record<string, unknown> {
  if (
    !raw ||
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    Object.keys(raw).some((key) => !keys.includes(key))
  )
    throw new BadRequestException('허용되지 않은 사진 검토 필드가 있습니다.');
  return raw as Record<string, unknown>;
}

@ApiTags('Admin Crawl Artist Images')
@ApiBearerAuth()
@ApiResponse({ status: 401, description: '관리자 인증이 필요합니다.' })
@ApiResponse({ status: 403, description: 'owner 권한이 필요합니다.' })
@Controller('admin/crawl/artist-image-reviews')
export class CrawlArtistImageReviewController {
  constructor(private readonly reviews: CrawlArtistImageReviewService) {}

  @Get()
  @AdminRoles('owner')
  @ApiOperation({
    summary: 'Commons 출연진 사진 검토본 목록',
    description:
      '최대 100건. 대기 후보와 철회 사진은 공개 API에서 보이지 않습니다.',
  })
  list(@Query('status') status?: string) {
    return this.reviews.list(status);
  }

  @Get(':id')
  @AdminRoles('owner')
  @ApiOperation({ summary: 'Commons 출연진 사진 검토본 상세' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.reviews.get(id);
  }

  @Post('from-discovery')
  @AdminRoles('owner')
  @ApiOperation({
    summary: 'Commons 사진 검토 준비',
    description:
      '최신 탐색 후보와 현재 축제 출연진을 확인하고 비공개 원본을 저장합니다. 저작자와 라이선스 입력은 서버의 Commons 권리 정보와 일치해야 합니다.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: [
        'discoveryRunId',
        'festivalId',
        'festivalSourceUrl',
        'artistName',
        'fileId',
        'filePageUrl',
        'officialEvidenceUrl',
        'author',
        'license',
        'licenseUrl',
      ],
      properties: {
        discoveryRunId: { type: 'string', format: 'uuid' },
        festivalId: { type: 'string', example: 'fst_example' },
        festivalSourceUrl: { type: 'string', format: 'uri' },
        artistName: { type: 'string', maxLength: 160 },
        fileId: { type: 'integer', minimum: 1 },
        filePageUrl: { type: 'string', format: 'uri' },
        officialEvidenceUrl: { type: 'string', format: 'uri' },
        author: { type: 'string', maxLength: 500 },
        license: {
          type: 'string',
          enum: ['CC BY 2.0', 'CC BY 2.5', 'CC BY 3.0', 'CC BY 4.0'],
        },
        licenseUrl: { type: 'string', format: 'uri' },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: '비공개 이미지 ID와 원본 SHA-256이 있는 검토 대기본',
  })
  @ApiResponse({
    status: 422,
    description: '탐색 후보·출연진·권리 증거가 일치하지 않습니다.',
  })
  stage(@Body() raw: unknown, @Req() req: AdminRequest) {
    const keys = [
      'discoveryRunId',
      'festivalId',
      'festivalSourceUrl',
      'artistName',
      'fileId',
      'filePageUrl',
      'officialEvidenceUrl',
      'author',
      'license',
      'licenseUrl',
    ];
    const body = bodyWithKeys(raw, keys);
    if (
      keys.some((key) => !Object.hasOwn(body, key)) ||
      keys.some((key) => key !== 'fileId' && typeof body[key] !== 'string') ||
      typeof body.fileId !== 'number'
    )
      throw new BadRequestException('탐색 후보와 검토 증거가 필요합니다.');
    return this.reviews.stage(
      body as unknown as PrepareArtistImageReviewInput,
      req.admin!.id,
    );
  }

  @Post(':id/prepare')
  @HttpCode(200)
  @AdminRoles('owner')
  @ApiOperation({ summary: '실패한 비공개 사진 준비 재시도' })
  prepare(@Param('id', ParseUUIDPipe) id: string, @Req() req: AdminRequest) {
    return this.reviews.prepare(id, req.admin!.id);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @AdminRoles('owner')
  @ApiOperation({
    summary: 'Commons 출연진 사진 검토 승인',
    description:
      '관리자 이미지 URL에서 확인한 원본 SHA-256을 보내세요. 현재 출연진과 파일 권리를 다시 확인하고 동일한 이미지일 때만 공개합니다.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['originalSha256'],
      properties: {
        originalSha256: { type: 'string', pattern: '^[0-9a-fA-F]{64}$' },
      },
    },
  })
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() raw: unknown,
    @Req() req: AdminRequest,
  ) {
    const body = bodyWithKeys(raw, ['originalSha256']);
    if (typeof body.originalSha256 !== 'string')
      throw new BadRequestException('원본 SHA-256이 필요합니다.');
    return this.reviews.approve(id, body.originalSha256, req.admin!.id);
  }

  @Post(':id/revoke')
  @HttpCode(200)
  @AdminRoles('owner')
  @ApiOperation({ summary: 'Commons 출연진 사진 승인 철회' })
  revoke(@Param('id', ParseUUIDPipe) id: string, @Req() req: AdminRequest) {
    return this.reviews.revoke(id, req.admin!.id);
  }
}
