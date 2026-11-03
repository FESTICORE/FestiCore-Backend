import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AdminRoles } from '../admin/auth/admin-roles.decorator';
import type { AdminRequest } from '../admin/auth/admin-session.guard';
import { CreateNoticeDto, UpdateNoticeDto } from './notice.dto';
import { NoticesService } from './notices.service';

const example = {
  code: 'SUCCESS',
  data: {
    id: '2c75c8de-517d-4611-9c51-b4ff804dd597',
    title: '서비스 안내',
    content: '공지 본문',
    published: true,
    publishedAt: '2026-11-04T00:00:00.000Z',
    createdAt: '2026-11-04T00:00:00.000Z',
    updatedAt: '2026-11-04T00:00:00.000Z',
  },
  message: '성공적으로 처리되었습니다.',
};

@ApiTags('Admin Notices')
@ApiBearerAuth()
@Controller('admin/notices')
export class AdminNoticesController {
  constructor(private readonly notices: NoticesService) {}

  @Get()
  @AdminRoles('viewer')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: '관리자 공지 목록',
    description:
      '초안을 포함하며 생성 최신순으로 조회합니다. 기본 100건, offset으로 다음 목록을 조회합니다.',
  })
  @ApiQuery({ name: 'limit', required: false, description: '1~100, 기본 100' })
  @ApiQuery({ name: 'offset', required: false, description: '0~10000, 기본 0' })
  @ApiResponse({
    status: 200,
    schema: { example: { ...example, data: { items: [example.data] } } },
  })
  @ApiResponse({ status: 401, description: '로그인 필요' })
  @ApiResponse({ status: 403, description: '관리자 권한 없음' })
  @ApiResponse({ status: 400, description: 'limit·offset 형식 오류' })
  list(@Query('limit') limit?: string, @Query('offset') offset?: string) {
    return this.notices.adminList(limit, offset);
  }

  @Get(':id')
  @AdminRoles('viewer')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: '관리자 공지 상세' })
  @ApiResponse({ status: 200, schema: { example } })
  @ApiResponse({ status: 400, description: '잘못된 UUID' })
  @ApiResponse({ status: 401, description: '로그인 필요' })
  @ApiResponse({ status: 403, description: '관리자 권한 없음' })
  @ApiResponse({ status: 404, description: '없는 공지' })
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.notices.adminDetail(id);
  }

  @Post()
  @AdminRoles('editor')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: '공지 작성',
    description: 'editor 이상. 감사 기록을 남깁니다.',
  })
  @ApiResponse({ status: 201, schema: { example } })
  @ApiResponse({ status: 400, description: '제목·본문·게시 상태 오류' })
  @ApiResponse({ status: 401, description: '로그인 필요' })
  @ApiResponse({ status: 403, description: '권한 또는 Origin 오류' })
  create(@Body() body: CreateNoticeDto, @Req() request: AdminRequest) {
    return this.notices.create(request.admin!.id, body);
  }

  @Patch(':id')
  @AdminRoles('editor')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: '공지 수정·게시 전환',
    description: 'editor 이상. 마지막 저장이 우선합니다.',
  })
  @ApiResponse({ status: 200, schema: { example } })
  @ApiResponse({ status: 400, description: '잘못된 UUID·본문 또는 빈 PATCH' })
  @ApiResponse({ status: 401, description: '로그인 필요' })
  @ApiResponse({ status: 403, description: '권한 또는 Origin 오류' })
  @ApiResponse({ status: 404, description: '없는 공지' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateNoticeDto,
    @Req() request: AdminRequest,
  ) {
    if (
      body.title === undefined &&
      body.content === undefined &&
      body.published === undefined
    ) {
      throw new BadRequestException('수정할 필드가 없습니다.');
    }
    return this.notices.update(request.admin!.id, id, body);
  }
}
