import { Controller, Get, Param, Res } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ImageStorageService } from '../storage/image-storage.service';
import { Public } from '../auth/decorator/public.decorator';

@ApiTags('Public Festivals')
@Public()
@Controller('festivals')
export class PublicFestivalMapController {
  constructor(private readonly storage: ImageStorageService) {}

  @Get(':id/maps/:imageId.webp')
  @ApiOperation({
    summary: '축제 지도 이미지',
    description: '업로드된 WebP 지도 이미지를 공개 URL로 조회합니다.',
  })
  @ApiParam({ name: 'id', example: 'fst_01234567' })
  @ApiParam({ name: 'imageId', description: '지도 이미지 UUID v4' })
  @ApiResponse({
    status: 200,
    description: 'WebP 지도 이미지',
    content: { 'image/webp': { schema: { type: 'string', format: 'binary' } } },
  })
  @ApiResponse({ status: 400, description: '잘못된 이미지 경로' })
  @ApiResponse({ status: 404, description: '이미지를 찾을 수 없음' })
  async read(
    @Param('id') id: string,
    @Param('imageId') imageId: string,
    @Res() response: Response,
  ) {
    const bytes = await this.storage.readFestivalMap(id, imageId);
    response
      .set({
        'Content-Type': 'image/webp',
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
      })
      .send(bytes);
  }
}
