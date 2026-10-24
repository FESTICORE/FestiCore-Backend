import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AdminRoles } from '../../auth/admin-roles.decorator';
import type { Request, Response } from 'express';
import {
  CreateCrawlSourceDto,
  UpdateCrawlSourceDto,
} from '../dto/crawl-source.dto';
import { CrawlService } from '../service/crawl.service';

type AdminRequest = Request & { admin?: { id: string } };

@ApiTags('Admin Crawl')
@ApiBearerAuth()
@ApiResponse({ status: 401, description: '유효한 access JWT가 없습니다.' })
@ApiResponse({
  status: 403,
  description: '권한이 부족하거나 관리자 요청 출처가 허용되지 않았습니다.',
})
@Controller('admin/crawl')
export class CrawlController {
  constructor(private readonly crawl: CrawlService) {}

  @Get('sources')
  @AdminRoles('viewer')
  @ApiOperation({
    summary: '크롤 소스 목록',
    description: 'viewer 이상. 축제 ID 또는 상태로 필터링합니다.',
  })
  @ApiQuery({ name: 'festivalId', required: false, example: 'fst_demo2026' })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['ok', 'broken', 'disabled'],
  })
  @ApiResponse({
    status: 200,
    description: '소스 목록을 items 배열로 반환합니다.',
  })
  sources(
    @Query('festivalId') festivalId?: string,
    @Query('status') status?: string,
  ) {
    return this.crawl.sources(festivalId, status);
  }

  @Post('sources')
  @AdminRoles('owner')
  @ApiOperation({
    summary: '크롤 소스 등록',
    description:
      'owner 전용. discovery·artist-gallery·artist-image·이미지 시간표를 제외한 종류는 festivalId가 필요합니다. artist-gallery는 XMF 공식 라인업 또는 Wonderlivet 공식 JSON URL과 해당 parserConfig.festivalSourceUrl을 지정하며 출연진 사진 소스를 동적으로 생성합니다. 이미지 시간표는 parser=image-ocr, 공식 이미지 URL, parserConfig의 festivalSourceUrl·sourcePageUrl·date·expectedRows·columns(JSON 문자열)가 필요합니다. robots.txt와 HTTPS 주소를 확인하고 매일 KST 00:00 이후 예약 실행합니다.',
  })
  @ApiResponse({
    status: 201,
    description:
      '등록된 소스. enabled=true, status=ok, intervalMinutes=1440입니다.',
  })
  @ApiResponse({
    status: 422,
    description: 'robots.txt 금지·접근 실패 또는 축제 ID 누락입니다.',
  })
  create(@Body() dto: CreateCrawlSourceDto, @Req() req: AdminRequest) {
    return this.crawl.createSource(dto, req.admin?.id ?? null);
  }

  @Patch('sources/:id')
  @AdminRoles('owner')
  @ApiOperation({
    summary: '크롤 소스 설정 변경',
    description:
      'owner 전용. 비활성화하면 예약 실행에서 제외됩니다. URL 변경 시 robots.txt를 다시 확인합니다.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: '크롤 소스 ID' })
  @ApiResponse({ status: 200, description: '변경된 소스' })
  @ApiResponse({ status: 404, description: '크롤 소스를 찾을 수 없습니다.' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCrawlSourceDto,
    @Req() req: AdminRequest,
  ) {
    return this.crawl.updateSource(id, dto, req.admin?.id ?? null);
  }

  @Post('sources/:id/run')
  @AdminRoles('editor')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: '크롤 수동 실행',
    description:
      'editor 이상. 즉시 실행을 요청하고 결과는 실행 이력에서 확인합니다. 제안이 생겨도 자동 발행하지 않습니다.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: '크롤 소스 ID' })
  @ApiResponse({
    status: 202,
    description: '실행 요청 접수',
    schema: { example: { runId: '931aaccc-4a2a-4d20-8c97-a7741d1fe818' } },
  })
  run(@Param('id', ParseUUIDPipe) id: string, @Req() req: AdminRequest) {
    return this.crawl.runNow(id, req.admin?.id ?? null);
  }

  @Post('sources/:id/test')
  @AdminRoles('editor')
  @ApiOperation({
    summary: '크롤 소스 파싱 시험',
    description:
      'editor 이상. 원본을 가져와 파싱 결과와 500자 발췌를 반환합니다. 제안이나 발행본은 만들지 않습니다.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: '크롤 소스 ID' })
  @ApiResponse({ status: 201, description: 'parsed 결과와 excerpt 문자열' })
  @ApiResponse({
    status: 422,
    description: 'robots.txt 금지·원본 응답 오류입니다.',
  })
  test(@Param('id', ParseUUIDPipe) id: string) {
    return this.crawl.testSource(id);
  }

  @Get('runs')
  @AdminRoles('viewer')
  @ApiOperation({
    summary: '크롤 실행 이력',
    description: 'viewer 이상. 최신순이며 기본 50개, 최대 100개입니다.',
  })
  @ApiQuery({ name: 'sourceId', required: false, format: 'uuid' })
  @ApiQuery({
    name: 'result',
    required: false,
    enum: ['proposed', 'unchanged', 'nochange-parsed', 'failed'],
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    example: 50,
    description: '1~100. 유효하지 않으면 50',
  })
  @ApiResponse({
    status: 200,
    description: '실행 이력을 items 배열로 반환합니다.',
  })
  runs(
    @Query('sourceId') sourceId?: string,
    @Query('result') result?: string,
    @Query('limit') limit?: string,
  ) {
    return this.crawl.runs(sourceId, result, limit);
  }

  @Get('snapshots/:id')
  @AdminRoles('viewer')
  @ApiOperation({
    summary: '크롤 원본 스냅샷',
    description: 'viewer 이상. 원본 HTML 본문을 반환하며 30일 후 만료됩니다.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: '스냅샷 ID' })
  @ApiResponse({ status: 200, description: 'id, runId, body, createdAt' })
  @ApiResponse({ status: 404, description: '스냅샷이 없거나 만료되었습니다.' })
  snapshot(@Param('id', ParseUUIDPipe) id: string) {
    return this.crawl.snapshot(id);
  }

  @Get('images')
  @AdminRoles('viewer')
  @ApiOperation({
    summary: '크롤 이미지 목록',
    description:
      'viewer 이상. 최근 확인한 이미지 최대 100개와 관리자 전용 imageUrl을 반환합니다.',
  })
  @ApiQuery({ name: 'runId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'sourceId', required: false, format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: '저장 이미지 메타데이터의 items 배열',
  })
  images(@Query('runId') runId?: string, @Query('sourceId') sourceId?: string) {
    return this.crawl.images(runId, sourceId);
  }

  @Get('images/:id')
  @AdminRoles('viewer')
  @ApiOperation({
    summary: '저장된 크롤 이미지',
    description: 'viewer 이상. 서버 저장소에 보관된 WebP 이미지를 읽습니다.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: '이미지 ID' })
  @ApiResponse({
    status: 200,
    description: 'image/webp 바이너리',
    content: { 'image/webp': { schema: { type: 'string', format: 'binary' } } },
  })
  @ApiResponse({ status: 404, description: '이미지를 찾을 수 없습니다.' })
  async image(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() response: Response,
  ) {
    const bytes = await this.crawl.image(id);
    response
      .set({
        'Content-Type': 'image/webp',
        'Cache-Control': 'private, max-age=300',
        'X-Content-Type-Options': 'nosniff',
      })
      .send(bytes);
  }
}
