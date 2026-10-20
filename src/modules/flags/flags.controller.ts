import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { AdminRoles } from '../admin/auth/admin-roles.decorator';
import { CurrentUser } from '../auth/decorator/current-user.decorator';
import { Public } from '../auth/decorator/public.decorator';
import type { AuthUser } from '../auth/types/social-profile';
import { FlagsService } from './flags.service';

@ApiTags('Flags')
@ApiParam({ name: 'flagId', description: '깃발 ID', example: 'flg_1234567890' })
@Controller('flags')
export class FlagsController {
  constructor(
    private readonly service: FlagsService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  @Post(':flagId/photo')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '기수 사진 업로드',
    description:
      '기수 권한이 필요합니다. photo 파일을 WebP 원본과 썸네일로 변환하여 저장합니다. 최소 256×256인 JPEG, PNG 또는 HEIC/HEIF 파일을 최대 5MB까지 받습니다.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['photo'],
      properties: {
        photo: {
          type: 'string',
          format: 'binary',
          description:
            'JPEG, PNG 또는 HEIC/HEIF 이미지, 최소 256×256, 최대 5MB',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: '저장된 사진과 썸네일의 API 경로',
    schema: {
      example: {
        photoUrl: '/api/v1/flags/flg_123/photo',
        thumbUrl: '/api/v1/flags/flg_123/thumbnail',
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: '파일 누락, 형식/크기 또는 이미지 처리 오류',
  })
  @ApiResponse({ status: 403, description: '기수 권한 없음' })
  @ApiResponse({ status: 409, description: '사진이 동시에 변경됨' })
  @ApiResponse({ status: 413, description: '원본 또는 변환된 사진 크기 초과' })
  @ApiResponse({ status: 415, description: '지원하지 않는 이미지 형식' })
  @UseInterceptors(
    FileInterceptor('photo', {
      limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    }),
  )
  uploadPhoto(
    @Param('flagId') id: string,
    @CurrentUser() user: AuthUser,
    @UploadedFile() file?: { buffer: Buffer; mimetype: string },
  ) {
    return this.service.uploadPhoto(id, user.userId, file);
  }

  @Public()
  @Get(':flagId/photo')
  @ApiOperation({
    summary: '깃발 사진 조회',
    description:
      '발행된 축제의 숨김 처리되지 않은 깃발 사진을 image/webp로 반환합니다.',
  })
  @ApiResponse({
    status: 200,
    description: 'WebP 이미지',
    content: { 'image/webp': { schema: { type: 'string', format: 'binary' } } },
  })
  @ApiResponse({ status: 404, description: '사진이 없거나 공개되지 않은 깃발' })
  async photo(@Param('flagId') id: string, @Res() response: Response) {
    const bytes = await this.service.readPhoto(id, 'photo');
    response
      .set({
        'Content-Type': 'image/webp',
        'Cache-Control': 'public, max-age=60',
        'X-Content-Type-Options': 'nosniff',
      })
      .send(bytes);
  }

  @Public()
  @Get(':flagId/thumbnail')
  @ApiOperation({
    summary: '깃발 썸네일 조회',
    description:
      '발행된 축제의 숨김 처리되지 않은 깃발 썸네일을 image/webp로 반환합니다.',
  })
  @ApiResponse({
    status: 200,
    description: 'WebP 썸네일',
    content: { 'image/webp': { schema: { type: 'string', format: 'binary' } } },
  })
  @ApiResponse({
    status: 404,
    description: '썸네일이 없거나 공개되지 않은 깃발',
  })
  async thumbnail(@Param('flagId') id: string, @Res() response: Response) {
    const bytes = await this.service.readPhoto(id, 'thumbnail');
    response
      .set({
        'Content-Type': 'image/webp',
        'Cache-Control': 'public, max-age=60',
        'X-Content-Type-Options': 'nosniff',
      })
      .send(bytes);
  }

  @Public()
  @Get(':flagId')
  @ApiOperation({
    summary: '공개 깃발 상세',
    description:
      '익명 조회가 가능합니다. 유효한 앱 access 토큰을 보내면 isFollowing, isBearer가 채워집니다. 유효하지 않은 토큰은 익명 조회로 처리합니다.',
  })
  @ApiResponse({
    status: 200,
    description:
      '깃발 프로필, 현장 상태, 팔로우/기수 여부. 익명 조회의 두 여부는 null입니다.',
    schema: {
      example: {
        id: 'flg_123',
        name: '푸른 깃발',
        tags: ['sing'],
        bio: '함께 노래해요',
        followerCount: 3,
        planVisible: true,
        plan: [],
        homeZoneId: 'zone_a',
        status: {
          flagId: 'flg_123',
          status: 'scheduled',
          zoneId: null,
          activity: null,
          updatedAt: '2026-10-21T00:00:00.000Z',
        },
        isFollowing: null,
        isBearer: null,
        hidden: false,
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: '발행되지 않았거나 비공개/숨김 처리된 깃발',
  })
  async detail(
    @Param('flagId') id: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    let userId: string | undefined;
    const token = request.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
    if (token) {
      try {
        const payload = await this.jwt.verifyAsync<{
          sub: string;
          typ: string;
        }>(token, { secret: this.config.get<string>('auth.jwt.accessSecret') });
        if (payload.typ === 'access') userId = payload.sub;
      } catch {
        /* Optional authentication: invalid tokens receive the anonymous response. */
      }
    }
    response.setHeader('Cache-Control', 'private, max-age=30');
    return this.service.detail(id, userId);
  }

  @Put(':flagId/follow')
  @ApiBearerAuth()
  @ApiOperation({
    summary: '깃발 팔로우',
    description:
      '최대 100개까지 팔로우할 수 있습니다. 첫 팔로우는 대표 깃발도 지정합니다. 같은 멱등키의 동일 요청은 저장된 응답을 재생합니다.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    description: '요청별 고유 키, 최대 128자. 24시간 보관',
    required: true,
    example: 'follow-flg-123-001',
  })
  @ApiResponse({
    status: 200,
    description: '팔로우 상태와 현재 팔로워 수',
    schema: {
      example: { flagId: 'flg_123', following: true, followerCount: 3 },
    },
  })
  @ApiResponse({ status: 400, description: '멱등키 누락 또는 길이 초과' })
  @ApiResponse({ status: 401, description: '앱 access 토큰 없음 또는 만료' })
  @ApiResponse({ status: 404, description: '공개되지 않은 깃발' })
  @ApiResponse({
    status: 409,
    description: '팔로우 100개 초과 또는 같은 멱등키로 다른 요청',
  })
  follow(
    @Param('flagId') id: string,
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') key?: string,
  ) {
    if (!key || key.length > 128)
      throw new BadRequestException({
        code: 'VALIDATION',
        message: 'Idempotency-Key가 필요합니다.',
      });
    return this.service.follow(id, user.userId, key);
  }

  @Delete(':flagId/follow')
  @ApiBearerAuth()
  @ApiOperation({
    summary: '깃발 팔로우 해제',
    description:
      '팔로우를 해제합니다. 대표 깃발이었다면 최근 팔로우 깃발을 대표로 바꿉니다.',
  })
  @ApiResponse({
    status: 200,
    description: '해제 후 팔로우 상태와 팔로워 수',
    schema: {
      example: { flagId: 'flg_123', following: false, followerCount: 2 },
    },
  })
  @ApiResponse({ status: 401, description: '앱 access 토큰 없음 또는 만료' })
  @ApiResponse({ status: 404, description: '공개되지 않은 깃발' })
  unfollow(@Param('flagId') id: string, @CurrentUser() user: AuthUser) {
    return this.service.unfollow(id, user.userId);
  }

  @Post(':flagId/report')
  @HttpCode(202)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '깃발 신고',
    description:
      '사용자당 깃발별로 한 번 신고할 수 있습니다. 신고가 3건 이상이면 깃발이 자동으로 숨김 처리됩니다.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['reason'],
      properties: {
        reason: {
          type: 'string',
          enum: ['fake', 'inappropriate', 'other'],
          description: '허위, 부적절, 기타',
        },
        note: {
          type: 'string',
          maxLength: 200,
          description: '선택 메모, 최대 200자',
        },
      },
      example: { reason: 'inappropriate', note: '부적절한 사진입니다.' },
    },
  })
  @ApiResponse({
    status: 202,
    description: '신고 접수',
    schema: { example: { reportId: 'report_123' } },
  })
  @ApiResponse({
    status: 400,
    description: '신고 사유 또는 메모가 올바르지 않음',
  })
  @ApiResponse({ status: 401, description: '앱 access 토큰 없음 또는 만료' })
  @ApiResponse({ status: 404, description: '공개되지 않은 깃발' })
  @ApiResponse({ status: 409, description: '이미 신고한 깃발' })
  report(
    @Param('flagId') id: string,
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
  ) {
    return this.service.report(id, user.userId, body);
  }

  @Get(':flagId/bearer')
  @ApiBearerAuth()
  @ApiOperation({
    summary: '기수 전용 깃발 상세',
    description:
      '등록 코드로 권한을 얻은 기수에게 프로필, 공동 기수, 신고 수, 재시작 가능 상태를 반환합니다. 응답은 저장하지 않습니다.',
  })
  @ApiResponse({
    status: 200,
    description: '기수 전용 프로필과 운영 상태. Cache-Control: no-store',
  })
  @ApiResponse({ status: 401, description: '앱 access 토큰 없음 또는 만료' })
  @ApiResponse({ status: 403, description: '기수 권한 없음' })
  @ApiResponse({ status: 404, description: '공개되지 않은 깃발' })
  bearer(
    @Param('flagId') id: string,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.service.bearerView(id, user.userId);
  }

  @Patch(':flagId')
  @ApiBearerAuth()
  @ApiOperation({
    summary: '기수 프로필 수정',
    description:
      '기수가 보낸 필드만 수정합니다. 빈 객체와 미허용 필드는 거절합니다. plan의 셋 ID와 homeZoneId는 발행된 축제 데이터에 있어야 합니다.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 2, maxLength: 20 },
        bio: { type: 'string', nullable: true, maxLength: 60 },
        tags: {
          type: 'array',
          minItems: 1,
          maxItems: 3,
          uniqueItems: true,
          items: {
            type: 'string',
            enum: ['slam', 'sing', 'train', 'calm', 'newbie'],
          },
        },
        plan: {
          type: 'array',
          maxItems: 30,
          uniqueItems: true,
          items: { type: 'string' },
          description: '발행된 축제의 셋 ID',
        },
        planVisible: { type: 'boolean' },
        homeZoneId: {
          type: 'string',
          nullable: true,
          description: '발행된 축제의 존 ID',
        },
      },
      additionalProperties: false,
      example: {
        name: '푸른 깃발',
        tags: ['sing'],
        planVisible: true,
        homeZoneId: 'zone_a',
      },
    },
  })
  @ApiResponse({ status: 200, description: '수정된 공개 프로필' })
  @ApiResponse({
    status: 400,
    description:
      '빈 요청, 미허용 필드, 길이/값 제약 위반 또는 존재하지 않는 셋 ID',
  })
  @ApiResponse({ status: 401, description: '앱 access 토큰 없음 또는 만료' })
  @ApiResponse({ status: 403, description: '기수 권한 없음' })
  @ApiResponse({ status: 404, description: '깃발/축제/존을 찾을 수 없음' })
  @ApiResponse({ status: 409, description: '이미 사용 중인 깃발 이름' })
  patch(
    @Param('flagId') id: string,
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
  ) {
    return this.service.patch(id, user.userId, body);
  }

  @Post(':flagId/status')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '기수 현장 상태 변경',
    description:
      'clientAt은 필수 ISO 날짜 시간입니다. scheduled 상태에서 zoneId+activity로 시작하거나 status=ended로 종료합니다. active/resting 상태는 허용된 상태 전이만 받습니다. ended 상태의 재시작은 restart=true와 zoneId+activity가 필요하며 KST 기준 하루 한 번입니다. 분당 12회로 제한됩니다.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    description: '요청별 고유 키, 최대 128자. 24시간 보관',
    required: true,
    example: 'status-flg-123-001',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['clientAt'],
      properties: {
        clientAt: {
          type: 'string',
          format: 'date-time',
          description: '클라이언트 발생 시각. 서버보다 5분 넘게 미래면 거절',
        },
        zoneId: { type: 'string', description: '발행된 축제의 존 ID' },
        activity: { type: 'string', enum: ['slam', 'sing', 'train', 'calm'] },
        status: { type: 'string', enum: ['resting', 'ended'] },
        restart: {
          type: 'boolean',
          description: '종료 상태에서 재시작할 때 true',
        },
      },
      additionalProperties: false,
      example: {
        clientAt: '2026-10-21T09:00:00+09:00',
        zoneId: 'zone_a',
        activity: 'sing',
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: '변경된 현장 상태',
    schema: {
      example: {
        flagId: 'flg_123',
        status: 'active',
        zoneId: 'zone_a',
        activity: 'sing',
        updatedAt: '2026-10-21T00:00:00.000Z',
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: '멱등키, clientAt, 필드 조합 또는 값이 올바르지 않음',
  })
  @ApiResponse({ status: 401, description: '앱 access 토큰 없음 또는 만료' })
  @ApiResponse({ status: 403, description: '기수 권한 없음' })
  @ApiResponse({ status: 404, description: '깃발 또는 존을 찾을 수 없음' })
  @ApiResponse({
    status: 409,
    description:
      '오래된 clientAt, 허용되지 않은 상태 전이/재시작 또는 멱등키 충돌',
  })
  @ApiResponse({ status: 429, description: '분당 상태 업데이트 12회 초과' })
  status(
    @Param('flagId') id: string,
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: unknown,
  ) {
    if (!key || key.length > 128)
      throw new BadRequestException({
        code: 'VALIDATION',
        message: 'Idempotency-Key가 필요합니다.',
      });
    return this.service.status(id, user.userId, key, body);
  }

  @Post(':flagId/co-bearers/invite')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '공동 기수 초대 코드 발급',
    description:
      '원래 기수만 24시간 유효한 코드를 만들 수 있습니다. 공동 기수는 최대 3명입니다. 코드는 등록 API로 제출합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '초대 코드와 만료 시각',
    schema: {
      example: { code: 'ABC234', expiresAt: '2026-10-22T00:00:00.000Z' },
    },
  })
  @ApiResponse({ status: 401, description: '앱 access 토큰 없음 또는 만료' })
  @ApiResponse({ status: 403, description: '원래 기수가 아님' })
  @ApiResponse({ status: 409, description: '공동 기수 정원 초과' })
  invite(@Param('flagId') id: string, @CurrentUser() user: AuthUser) {
    return this.service.invite(id, user.userId);
  }

  @Delete(':flagId/co-bearers/:userId')
  @HttpCode(204)
  @ApiBearerAuth()
  @ApiParam({
    name: 'userId',
    description: '제거할 공동 기수의 사용자 ID',
    example: 'usr_123',
  })
  @ApiOperation({
    summary: '공동 기수 해제',
    description:
      '원래 기수는 공동 기수를 해제할 수 있고, 공동 기수는 자신을 해제할 수 있습니다. 원래 기수는 제거할 수 없습니다.',
  })
  @ApiResponse({ status: 204, description: '해제 완료. 응답 본문 없음' })
  @ApiResponse({ status: 401, description: '앱 access 토큰 없음 또는 만료' })
  @ApiResponse({ status: 403, description: '해제 권한 없음' })
  @ApiResponse({ status: 409, description: '원래 기수 제거 시도' })
  removeBearer(
    @Param('flagId') id: string,
    @Param('userId') targetId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.removeBearer(id, user.userId, targetId);
  }
}

@ApiTags('Flag Bearer')
@ApiBearerAuth()
@Controller('bearer')
export class BearerController {
  constructor(private readonly service: FlagsService) {}
  @Post('claim')
  @HttpCode(200)
  @ApiOperation({
    summary: '기수 코드 등록',
    description:
      '관리자 또는 원래 기수가 발급한 6자리 코드를 등록합니다. 축제당 사용자 한 명이 맡을 수 있는 깃발은 하나입니다. 코드 추측은 사용자, 기기, IP별로 제한됩니다.',
  })
  @ApiHeader({
    name: 'X-Device-Id',
    description:
      '코드 입력 제한에 사용하는 안정적인 기기 식별자. 전송을 권장합니다.',
    required: false,
    example: 'device-123',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['festivalId', 'code'],
      properties: {
        festivalId: {
          type: 'string',
          description: '발행된 축제 ID',
          example: 'fst_123',
        },
        code: {
          type: 'string',
          pattern: '^[A-HJ-NP-Z2-9]{6}$',
          minLength: 6,
          maxLength: 6,
          description: '6자리 등록 코드. 대소문자는 구분하지 않음',
          example: 'ABC234',
        },
      },
      example: { festivalId: 'fst_123', code: 'ABC234' },
    },
  })
  @ApiResponse({
    status: 200,
    description: '등록된 깃발 프로필과 공동 기수 ID 목록',
    schema: {
      example: {
        flagId: 'flg_123',
        flag: { id: 'flg_123', name: '푸른 깃발' },
        isNew: true,
        coBearers: ['usr_123'],
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: '축제 ID 또는 코드 형식이 올바르지 않음',
  })
  @ApiResponse({ status: 401, description: '앱 access 토큰 없음 또는 만료' })
  @ApiResponse({ status: 404, description: '발행되지 않은 축제' })
  @ApiResponse({
    status: 409,
    description: '축제당 깃발 보유 제한 또는 공동 기수 정원 초과',
  })
  @ApiResponse({
    status: 422,
    description:
      '유효하지 않거나 만료/사용된 코드. 남은 시도 횟수를 반환할 수 있음',
  })
  @ApiResponse({
    status: 423,
    description: '코드 입력 잠금. retryAfter 초를 반환',
  })
  claim(
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
    @Headers('x-device-id') deviceId: string | undefined,
    @Req() request: Request,
  ) {
    return this.service.claim(user.userId, body, {
      deviceId: deviceId ?? '',
      ip: request.ip || request.socket.remoteAddress || '',
    });
  }
}

@ApiTags('My Flags')
@ApiBearerAuth()
@Controller('me')
export class MyFlagsController {
  constructor(private readonly service: FlagsService) {}
  @Get('follows')
  @ApiOperation({
    summary: '내 팔로우 목록',
    description:
      '최근 팔로우순으로 조회합니다. festivalId를 보내면 해당 축제만 반환합니다.',
  })
  @ApiQuery({
    name: 'festivalId',
    required: false,
    description: '선택 축제 ID',
    example: 'fst_123',
  })
  @ApiResponse({
    status: 200,
    description: '팔로우한 깃발과 축제 ID, 팔로우 시각 목록',
    schema: {
      example: {
        items: [
          {
            flagId: 'flg_123',
            festivalId: 'fst_123',
            followedAt: '2026-10-21T00:00:00.000Z',
          },
        ],
      },
    },
  })
  @ApiResponse({ status: 401, description: '앱 access 토큰 없음 또는 만료' })
  follows(
    @CurrentUser() user: AuthUser,
    @Query('festivalId') festivalId?: string,
  ) {
    return this.service.myFollows(user.userId, festivalId);
  }
  @Put('pinned-flag')
  @ApiOperation({
    summary: '내 대표 깃발 지정',
    description:
      '팔로우 중인 깃발 ID를 지정합니다. null을 보내면 대표 깃발을 해제합니다.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['flagId'],
      properties: {
        flagId: {
          type: 'string',
          nullable: true,
          description: '팔로우 중인 깃발 ID 또는 null',
          example: 'flg_123',
        },
      },
      example: { flagId: 'flg_123' },
    },
  })
  @ApiResponse({
    status: 200,
    description: '현재 대표 깃발 ID',
    schema: { example: { pinnedFlagId: 'flg_123' } },
  })
  @ApiResponse({
    status: 400,
    description: 'flagId가 없거나 문자열/null이 아님',
  })
  @ApiResponse({ status: 401, description: '앱 access 토큰 없음 또는 만료' })
  @ApiResponse({ status: 409, description: '팔로우하지 않은 깃발' })
  pin(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.service.pin(user.userId, body);
  }
}

@ApiTags('Admin Flags')
@Controller('admin')
export class AdminFlagsController {
  constructor(private readonly service: FlagsService) {}
  @Post('festivals/:festivalId/bearer-codes')
  @AdminRoles('editor', 'owner')
  @ApiParam({ name: 'festivalId', description: '축제 ID', example: 'fst_123' })
  @ApiOperation({
    summary: '기수 등록 코드 생성',
    description:
      '관리자 세션 쿠키와 editor/owner 역할이 필요합니다. 생성된 코드는 30일간 유효합니다.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['count'],
      properties: {
        count: {
          type: 'integer',
          minimum: 1,
          maximum: 100,
          description: '생성할 코드 수',
        },
        label: {
          type: 'string',
          maxLength: 100,
          description: '선택 관리용 메모',
        },
      },
      example: { count: 2, label: '현장 운영팀' },
    },
  })
  @ApiResponse({
    status: 201,
    description: '생성된 코드와 만료 시각',
    schema: {
      example: {
        codes: [{ code: 'ABC234', expiresAt: '2026-11-20T00:00:00.000Z' }],
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'count가 1~100 정수가 아니거나 label이 100자를 초과함',
  })
  @ApiResponse({ status: 401, description: '관리자 세션 없음 또는 만료' })
  @ApiResponse({ status: 403, description: 'editor/owner 권한 없음' })
  @ApiResponse({ status: 404, description: '축제를 찾을 수 없음' })
  createCodes(@Param('festivalId') id: string, @Body() body: unknown) {
    return this.service.createCodes(id, body);
  }
  @Get('festivals/:festivalId/bearer-codes')
  @AdminRoles('viewer', 'editor', 'owner')
  @ApiParam({ name: 'festivalId', description: '축제 ID', example: 'fst_123' })
  @ApiOperation({
    summary: '기수 등록 코드 목록',
    description:
      '관리자 세션 쿠키와 viewer 이상 역할이 필요합니다. 원문 코드와 사용 상태를 반환하므로 응답을 저장하지 마세요.',
  })
  @ApiResponse({
    status: 200,
    description:
      '원문 코드, 라벨, 사용 상태, 사용 사용자 및 연결 깃발. Cache-Control: no-store',
    schema: {
      example: {
        items: [
          {
            code: 'ABC234',
            label: '현장 운영팀',
            status: 'unused',
            usedBy: null,
            flagId: null,
          },
        ],
      },
    },
  })
  @ApiResponse({ status: 401, description: '관리자 세션 없음 또는 만료' })
  @ApiResponse({ status: 403, description: 'viewer 이상 권한 없음' })
  codes(
    @Param('festivalId') id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.service.listCodes(id);
  }
  @Get('festivals/:festivalId/flags')
  @AdminRoles('viewer', 'editor', 'owner')
  @ApiParam({ name: 'festivalId', description: '축제 ID', example: 'fst_123' })
  @ApiOperation({
    summary: '축제 깃발 관리 목록',
    description:
      '관리자 세션 쿠키와 viewer 이상 역할이 필요합니다. 해당 축제의 모든 깃발과 신고 수, 숨김 여부를 조회합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '깃발 프로필, 숨김 여부, 신고 수와 현장 상태 목록',
  })
  @ApiResponse({ status: 401, description: '관리자 세션 없음 또는 만료' })
  @ApiResponse({ status: 403, description: 'viewer 이상 권한 없음' })
  flags(@Param('festivalId') id: string) {
    return this.service.adminFlags(id);
  }
  @Get('flags/reported')
  @AdminRoles('viewer', 'editor', 'owner')
  @ApiOperation({
    summary: '신고된 깃발 조회',
    description:
      '관리자 세션 쿠키와 viewer 이상 역할이 필요합니다. 기본적으로 신고가 3건 이상인 깃발을 조회합니다.',
  })
  @ApiQuery({
    name: 'festivalId',
    required: false,
    description: '선택 축제 ID',
    example: 'fst_123',
  })
  @ApiQuery({
    name: 'minReports',
    required: false,
    description: '최소 신고 수, 1 이상의 정수. 기본값 3',
    type: Number,
    example: 3,
  })
  @ApiResponse({
    status: 200,
    description: '신고된 깃발, 숨김 여부, 신고 사유/메모 목록',
  })
  @ApiResponse({
    status: 400,
    description: 'minReports가 1 이상의 정수가 아님',
  })
  @ApiResponse({ status: 401, description: '관리자 세션 없음 또는 만료' })
  @ApiResponse({ status: 403, description: 'viewer 이상 권한 없음' })
  reported(
    @Query('festivalId') festivalId?: string,
    @Query('minReports') min?: string,
  ) {
    return this.service.reported(
      festivalId,
      min === undefined ? 3 : Number(min),
    );
  }
  @Post('flags/:flagId/hide')
  @AdminRoles('editor', 'owner')
  @ApiParam({ name: 'flagId', description: '숨길 깃발 ID', example: 'flg_123' })
  @ApiOperation({
    summary: '깃발 공개 숨김',
    description:
      '관리자 세션 쿠키와 editor/owner 역할이 필요합니다. 숨긴 깃발은 공개 상세와 사진에서 조회되지 않습니다.',
  })
  @ApiResponse({
    status: 201,
    description: '숨김 적용 결과',
    schema: { example: { flagId: 'flg_123', hidden: true } },
  })
  @ApiResponse({ status: 401, description: '관리자 세션 없음 또는 만료' })
  @ApiResponse({ status: 403, description: 'editor/owner 권한 없음' })
  @ApiResponse({ status: 404, description: '깃발을 찾을 수 없음' })
  hide(@Param('flagId') id: string) {
    return this.service.setHidden(id, true);
  }
  @Post('flags/:flagId/unhide')
  @AdminRoles('editor', 'owner')
  @ApiParam({
    name: 'flagId',
    description: '숨김 해제할 깃발 ID',
    example: 'flg_123',
  })
  @ApiOperation({
    summary: '깃발 공개 숨김 해제',
    description: '관리자 세션 쿠키와 editor/owner 역할이 필요합니다.',
  })
  @ApiResponse({
    status: 201,
    description: '숨김 해제 결과',
    schema: { example: { flagId: 'flg_123', hidden: false } },
  })
  @ApiResponse({ status: 401, description: '관리자 세션 없음 또는 만료' })
  @ApiResponse({ status: 403, description: 'editor/owner 권한 없음' })
  @ApiResponse({ status: 404, description: '깃발을 찾을 수 없음' })
  unhide(@Param('flagId') id: string) {
    return this.service.setHidden(id, false);
  }
}
