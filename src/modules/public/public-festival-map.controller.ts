import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { DataSource } from 'typeorm';
import { ImageStorageService } from '../storage/image-storage.service';
import { Public } from '../auth/decorator/public.decorator';
import { PUBLIC_CRAWL_IMAGE_SQL } from './crawl-image-policy';
import { SOHYANG_COMMONS_SEED } from '../admin/crawl/service/sohyang-commons-profile';
import { PublicFestivalService } from './public-festival.service';

@ApiTags('Public Festivals')
@Public()
@Controller('festivals')
export class PublicFestivalMapController {
  constructor(
    private readonly storage: ImageStorageService,
    private readonly dataSource: DataSource,
    private readonly festivals: PublicFestivalService,
  ) {}

  @Get('images/:imageId.webp')
  @ApiOperation({
    summary: '수집한 공식 축제 포스터',
    description: '서버에 검증·보관한 WebP 포스터를 반환합니다.',
  })
  @ApiParam({ name: 'imageId', description: '수집 이미지 UUID' })
  @ApiResponse({
    status: 200,
    description: 'WebP 포스터',
    content: { 'image/webp': { schema: { type: 'string', format: 'binary' } } },
  })
  @ApiResponse({ status: 404, description: '포스터를 찾을 수 없음' })
  async poster(
    @Param('imageId', new ParseUUIDPipe()) imageId: string,
    @Res() response: Response,
  ) {
    const rows = await this.dataSource.query<
      {
        objectKey: string;
        seed: string | null;
        festivalId: string | null;
        festivalSourceUrl: string | null;
        artistName: string | null;
      }[]
    >(
      `SELECT image."objectKey", source."parserConfig"->>'seed' AS seed,
         review."festivalId" AS "festivalId",
         review."festivalSourceUrl" AS "festivalSourceUrl",
         review."artistName" AS "artistName"
       FROM crawl_images image
       JOIN crawl_sources source ON source.id = image."sourceId"
       LEFT JOIN crawl_artist_image_reviews review ON
         review."sourceId" = source.id AND review."imageId" = image.id
         AND review.status = 'approved'
       WHERE image.id = $1
         AND ${PUBLIC_CRAWL_IMAGE_SQL}`,
      [imageId],
    );
    if (!rows[0]) throw new NotFoundException('포스터를 찾을 수 없습니다.');
    if (rows[0].seed === 'commons-approved-profile') {
      const { festivalId, festivalSourceUrl, artistName } = rows[0];
      if (
        !festivalId ||
        !festivalSourceUrl ||
        !artistName ||
        !(await this.festivals.hasCurrentArtist(
          festivalId,
          festivalSourceUrl,
          artistName,
        ))
      )
        throw new NotFoundException('포스터를 찾을 수 없습니다.');
    }
    const bytes = await this.storage.readCrawlImage(rows[0].objectKey);
    response
      .set({
        'Content-Type': 'image/webp',
        'Cache-Control':
          rows[0].seed === SOHYANG_COMMONS_SEED ||
          rows[0].seed === 'commons-approved-profile'
            ? 'no-store'
            : 'public, max-age=86400',
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'X-Content-Type-Options': 'nosniff',
      })
      .send(bytes);
  }

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
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'X-Content-Type-Options': 'nosniff',
      })
      .send(bytes);
  }
}
