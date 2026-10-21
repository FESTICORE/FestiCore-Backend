import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AdminRoles } from '../auth/admin-roles.decorator';
import { AdminFestivalService } from './admin-festival.service';
import { TimetableImageService } from './timetable-image.service';
import type { FestivalDocument } from './festival.entity';

@ApiTags('Admin Festivals')
@ApiBearerAuth()
@Controller('admin/festivals')
export class AdminFestivalImageController {
  constructor(
    private readonly festivals: AdminFestivalService,
    private readonly images: TimetableImageService,
  ) {}

  @AdminRoles('editor')
  @Post(':id/pack/import-image')
  @HttpCode(200)
  @ApiOperation({
    summary: '타임테이블 이미지 OCR 미리보기',
    description:
      '등록된 축제 날짜와 무대에 맞는 아티스트·시작/종료 시각만 Set 초안으로 반환합니다. 불확실한 행은 unparsed로 반환하며 축제 초안과 발행 팩은 변경하지 않습니다. 검토 후 PUT /admin/festivals/{id}/draft/sets로 저장합니다.',
  })
  @ApiParam({ name: 'id', description: '축제 ID', example: 'fst_01234567' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['image', 'date'],
      properties: {
        image: {
          type: 'string',
          format: 'binary',
          description: '최대 10MB JPEG, PNG, WebP',
        },
        date: {
          type: 'string',
          example: '2026-10-24',
          description: '축제에 등록된 YYYY-MM-DD 날짜',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: '저장되지 않은 OCR Set 초안과 0..1 신뢰도, 해석되지 않은 행',
    schema: {
      example: {
        draft: [
          {
            id: 'set_a1b2c3d4',
            stageId: 'stg_main',
            artist: '아티스트',
            startsAt: '2026-10-24T13:00:00+09:00',
            endsAt: '2026-10-24T14:00:00+09:00',
            note: null,
          },
        ],
        confidence: 0.92,
        unparsed: ['시간을 확인할 수 없는 행'],
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: '날짜 또는 이미지가 유효하지 않습니다.',
  })
  @ApiResponse({ status: 401, description: '유효한 access JWT가 없습니다.' })
  @ApiResponse({ status: 403, description: 'editor 권한이 없습니다.' })
  @ApiResponse({ status: 404, description: '축제를 찾을 수 없습니다.' })
  @ApiResponse({ status: 413, description: '이미지 크기 10MB 초과' })
  @ApiResponse({ status: 415, description: '지원하지 않는 이미지 형식' })
  @ApiResponse({ status: 503, description: 'OCR 엔진을 실행할 수 없습니다.' })
  @UseInterceptors(
    FileInterceptor('image', {
      limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 1, parts: 3 },
    }),
  )
  async preview(
    @Param('id') id: string,
    @Body('date') date?: string,
    @UploadedFile() file?: { buffer: Buffer; mimetype: string },
  ) {
    if (!file) throw new BadRequestException('image 파일이 필요합니다.');
    const festival = (await this.festivals.getDraft(id)) as FestivalDocument;
    return this.images.preview(
      file.buffer,
      file.mimetype,
      date ?? '',
      festival,
    );
  }
}
