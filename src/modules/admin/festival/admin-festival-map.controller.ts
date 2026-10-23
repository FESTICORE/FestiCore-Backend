import {
  BadRequestException,
  Controller,
  Logger,
  Param,
  Post,
  Req,
  ServiceUnavailableException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { DataSource } from 'typeorm';
import {
  ApiBody,
  ApiConsumes,
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  ImageStorageService,
  prepareFestivalMap,
} from '../../storage/image-storage.service';
import { AdminRoles } from '../auth/admin-roles.decorator';
import { AdminAuditService } from '../audit/admin-audit.service';
import { AdminFestivalService } from './admin-festival.service';

type AdminRequest = Request & { admin?: { id: string } };

@ApiTags('Admin Festivals')
@ApiBearerAuth()
@Controller('admin/festivals')
export class AdminFestivalMapController {
  private readonly logger = new Logger(AdminFestivalMapController.name);

  constructor(
    private readonly festivals: AdminFestivalService,
    private readonly storage: ImageStorageService,
    private readonly config: ConfigService,
    private readonly db: DataSource,
    private readonly audit: AdminAuditService,
  ) {}

  @AdminRoles('editor')
  @Post(':id/draft/map')
  @ApiOperation({
    summary: '축제 초안 지도 이미지 업로드',
    description:
      'JPEG, PNG, WebP 또는 HEIC/HEIF 이미지를 WebP(최대 300KB)로 변환합니다. 초안은 변경되지 않으며, 반환된 URL과 종횡비를 PATCH /admin/festivals/{id}/draft에 입력해야 합니다.',
  })
  @ApiParam({ name: 'id', description: '축제 ID', example: 'fst_01234567' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['map'],
      properties: {
        map: {
          type: 'string',
          format: 'binary',
          description: '최대 5MB의 JPEG, PNG, WebP 또는 HEIC/HEIF 이미지',
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: '변환된 지도 이미지의 HTTPS URL과 너비/높이 종횡비',
    schema: {
      example: {
        mapImageUrl:
          'https://festicore-dev.up.railway.app/api/v1/festivals/fst_01234567/maps/123e4567-e89b-42d3-a456-426614174000.webp',
        mapAspect: 1.5,
      },
    },
  })
  @ApiResponse({ status: 400, description: '축제 ID 또는 이미지 오류' })
  @ApiResponse({ status: 401, description: '유효한 access JWT가 없습니다.' })
  @ApiResponse({ status: 403, description: 'editor 권한이 없습니다.' })
  @ApiResponse({ status: 404, description: '축제를 찾을 수 없습니다.' })
  @ApiResponse({
    status: 413,
    description: '원본 5MB 또는 변환 이미지 300KB 초과',
  })
  @ApiResponse({ status: 415, description: '지원하지 않는 이미지 형식' })
  @UseInterceptors(
    FileInterceptor('map', {
      limits: {
        fileSize: 5 * 1024 * 1024,
        files: 1,
        fields: 0,
        parts: 1,
      },
    }),
  )
  async upload(
    @Param('id') id: string,
    @UploadedFile() file: { buffer: Buffer; mimetype: string } | undefined,
    @Req() request: AdminRequest,
  ) {
    if (!file) throw new BadRequestException('지도 이미지 파일이 필요합니다.');
    await this.festivals.getDraft(id);
    const prepared = await prepareFestivalMap(file.buffer, file.mimetype);
    const publicUrl = this.config.get<string>('PUBLIC_URL');
    const domain = this.config.get<string>('RAILWAY_PUBLIC_DOMAIN');
    let origin: string;
    if (publicUrl) {
      try {
        const url = new URL(publicUrl);
        if (
          url.protocol !== 'https:' ||
          url.username ||
          url.password ||
          url.pathname !== '/' ||
          url.search ||
          url.hash
        )
          throw new Error('invalid public URL');
        origin = url.origin;
      } catch {
        throw new ServiceUnavailableException(
          '공개 API URL 설정이 올바르지 않습니다.',
        );
      }
    } else if (domain && /^[a-z0-9.-]+\.up\.railway\.app$/.test(domain)) {
      origin = `https://${domain}`;
    } else {
      throw new ServiceUnavailableException('공개 API URL 설정이 없습니다.');
    }
    const key = await this.storage.saveFestivalMap(id, prepared.image);
    try {
      await this.db.transaction((manager) =>
        this.audit.record(manager, {
          actor: request.admin!.id,
          action: 'festival.map.uploaded',
          target: `festival:${id}`,
          before: null,
          after: { key, aspect: prepared.aspect },
        }),
      );
    } catch (error) {
      try {
        await this.storage.delete(key);
      } catch {
        this.logger.error(`감사 기록 실패 후 지도 객체 삭제 실패: ${key}`);
      }
      throw error;
    }
    return {
      mapImageUrl: `${origin}/api/v1/${key}`,
      mapAspect: prepared.aspect,
    };
  }
}
