import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import {
  ApiBody,
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { AdminRoles } from '../auth/admin-roles.decorator';
import { AdminFestivalService } from './admin-festival.service';

type AdminRequest = Request & { admin?: { id: string } };

const festivalDay = {
  date: '2026-10-24',
  startsAt: '2026-10-24T12:00:00+09:00',
  endsAt: '2026-10-24T23:00:00+09:00',
};

const draftExample = {
  id: 'fst_01234567',
  name: '가을 음악 축제',
  venue: '서울 올림픽공원',
  timezone: 'Asia/Seoul',
  days: [festivalDay],
  thumbUrl: null,
  ticketLinks: [],
  flagsEnabled: false,
  stages: [],
  sets: [],
  zones: [],
  flags: [],
  checklist: [],
  rules: [],
  directions: {
    shuttle: null,
    transit: null,
    parking: null,
    memo: null,
    lastShuttleAt: null,
    lastTrainAt: null,
    mapLinks: { naver: null, kakao: null },
    source: {
      name: '관리자 입력',
      url: null,
      verifiedAt: '2026-10-20T09:00:00Z',
    },
  },
  mapImageUrl: null,
  mapAspect: null,
  source: {
    name: '관리자 입력',
    url: null,
    verifiedAt: '2026-10-20T09:00:00Z',
  },
  draftVersion: 1,
  draftUpdatedAt: '2026-10-20T09:00:00Z',
  draftUpdatedBy: 'adm_01234567',
};

const versionResult = {
  packVersion: 1,
  etag: '"v1"',
  pushedDevices: 0,
};

const draftResponse = {
  type: 'object' as const,
  description: '현재 축제 문서와 초안 버전, 마지막 수정 정보',
  example: draftExample,
};

const versionResponse = {
  type: 'object' as const,
  example: versionResult,
};

const draftHeader = {
  name: 'If-Match',
  required: true,
  description:
    'GET /admin/festivals/{id}/draft에서 받은 draftVersion을 `"d1"` 형식으로 전달합니다. 버전이 바뀌면 412와 최신 초안을 반환합니다.',
  schema: { type: 'string', example: '"d1"' },
};

const festivalId = {
  name: 'id',
  description: '축제 ID (`fst_` 접두사)',
  example: 'fst_01234567',
};

@ApiTags('Admin Festivals')
@ApiBearerAuth()
@ApiResponse({
  status: 401,
  description: '유효한 access JWT가 없습니다.',
})
@ApiResponse({ status: 403, description: '필요한 관리자 역할이 없습니다.' })
@Controller('admin/festivals')
export class AdminFestivalController {
  constructor(private readonly service: AdminFestivalService) {}

  @Get()
  @ApiOperation({
    summary: '관리자 축제 목록',
    description:
      '최근 생성 순서로 초안·발행 버전과 열린 크롤 제안 수를 조회합니다. 관리자 권한이 필요합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '축제 목록',
    schema: {
      type: 'object',
      example: {
        items: [
          {
            id: 'fst_01234567',
            name: '가을 음악 축제',
            venue: '서울 올림픽공원',
            days: [festivalDay],
            draftVersion: 1,
            publishedVersion: 0,
            openProposals: 0,
          },
        ],
      },
    },
  })
  list() {
    return this.service.list();
  }

  @AdminRoles('editor')
  @Post()
  @ApiOperation({
    summary: '축제 초안 생성',
    description:
      'editor 이상이 이름·장소·1~7일의 일정을 입력합니다. `Asia/Seoul` 시간대와 빈 무대·공연·존을 가진 초안 버전 1을 생성합니다.',
  })
  @ApiBody({
    description:
      '날짜는 오름차순, 시작·종료는 초 단위 ISO 8601 시각(UTC 오프셋 포함)입니다. 하루 최대 18시간입니다.',
    schema: {
      type: 'object',
      required: ['name', 'venue', 'days'],
      properties: {
        name: {
          type: 'string',
          minLength: 1,
          maxLength: 60,
          description: '축제명',
        },
        venue: {
          type: 'string',
          minLength: 1,
          maxLength: 80,
          description: '장소',
        },
        days: {
          type: 'array',
          minItems: 1,
          maxItems: 7,
          items: {
            type: 'object',
            required: ['date', 'startsAt', 'endsAt'],
            properties: {
              date: { type: 'string', format: 'date' },
              startsAt: { type: 'string', format: 'date-time' },
              endsAt: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
      example: {
        name: '가을 음악 축제',
        venue: '서울 올림픽공원',
        days: [festivalDay],
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: '생성된 초안',
    schema: draftResponse,
  })
  @ApiResponse({
    status: 400,
    description:
      '이름·장소·일정 검증 실패. `VALIDATION`과 errors 배열을 반환합니다.',
  })
  create(
    @Body() body: { name: string; venue: string; days: unknown[] },
    @Req() request: AdminRequest,
  ) {
    return this.service.create(body, request.admin?.id ?? null);
  }

  @Get(':id/draft')
  @ApiOperation({
    summary: '축제 초안 조회',
    description:
      '수정에 필요한 현재 초안과 draftVersion을 조회합니다. 수정 요청의 If-Match에는 `"d{draftVersion}"`을 넣습니다.',
  })
  @ApiParam(festivalId)
  @ApiResponse({ status: 200, description: '현재 초안', schema: draftResponse })
  @ApiResponse({ status: 404, description: '축제를 찾을 수 없습니다.' })
  draft(@Param('id') id: string) {
    return this.service.getDraft(id);
  }

  @AdminRoles('editor')
  @Patch(':id/draft')
  @ApiOperation({
    summary: '축제 초안 부분 수정',
    description:
      'editor 이상이 JSON Merge Patch 객체로 초안을 수정합니다. 허용 필드만 입력할 수 있으며 null은 중첩 속성을 삭제합니다. 유효한 수정마다 draftVersion이 1 증가합니다.',
  })
  @ApiParam(festivalId)
  @ApiHeader(draftHeader)
  @ApiBody({
    description:
      '수정할 필드만 보냅니다. 허용 필드: name, venue, timezone, days, thumbUrl, ticketLinks, flagsEnabled, source, stages, sets, zones, flags, directions, checklist, rules, mapImageUrl, mapAspect. 발행하려면 무대가 1개 이상 필요합니다.',
    schema: {
      type: 'object',
      minProperties: 1,
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 60 },
        venue: { type: 'string', minLength: 1, maxLength: 80 },
        timezone: { type: 'string', enum: ['Asia/Seoul'] },
        days: {
          type: 'array',
          minItems: 1,
          maxItems: 7,
          items: { type: 'object' },
        },
        thumbUrl: { type: 'string', nullable: true, format: 'uri' },
        ticketLinks: {
          type: 'array',
          maxItems: 5,
          items: {
            type: 'object',
            required: ['label', 'url'],
            properties: {
              label: { type: 'string', maxLength: 20 },
              url: { type: 'string', format: 'uri' },
            },
          },
        },
        flagsEnabled: { type: 'boolean' },
        source: { type: 'object' },
        stages: { type: 'array', maxItems: 8, items: { type: 'object' } },
        sets: { type: 'array', maxItems: 400, items: { type: 'object' } },
        zones: { type: 'array', maxItems: 40, items: { type: 'object' } },
        flags: { type: 'array', maxItems: 200, items: { type: 'object' } },
        directions: { type: 'object' },
        checklist: { type: 'array', maxItems: 40, items: {} },
        rules: { type: 'array', maxItems: 20, items: {} },
        mapImageUrl: { type: 'string', nullable: true, format: 'uri' },
        mapAspect: { type: 'number', nullable: true },
      },
      example: {
        stages: [{ id: 'stg_main', name: '메인 스테이지', order: 1 }],
        flagsEnabled: false,
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: '수정된 초안과 빈 warnings 배열',
    schema: {
      type: 'object',
      example: {
        ...draftExample,
        stages: [{ id: 'stg_main', name: '메인 스테이지', order: 1 }],
        draftVersion: 2,
        warnings: [],
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: '허용되지 않는 필드 또는 초안 검증 실패',
  })
  @ApiResponse({ status: 404, description: '축제를 찾을 수 없습니다.' })
  @ApiResponse({
    status: 412,
    description:
      '초안 버전 충돌. 응답의 draft와 draftVersion을 확인해 다시 수정하세요.',
    schema: {
      type: 'object',
      example: {
        code: 'DRAFT_CONFLICT',
        message: '초안 버전이 변경되었습니다.',
        draft: draftExample,
        draftVersion: 2,
      },
    },
  })
  @ApiResponse({
    status: 428,
    description: 'If-Match 헤더가 없거나 `"d{draftVersion}"` 형식이 아닙니다.',
  })
  patch(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('if-match') ifMatch: string | undefined,
    @Req() request: AdminRequest,
  ) {
    return this.service.patch(id, body, ifMatch, request.admin?.id ?? null);
  }

  @AdminRoles('editor')
  @Put(':id/draft/sets')
  @ApiOperation({
    summary: '공연 목록 전체 교체',
    description:
      'editor 이상이 공연 배열을 통째로 교체합니다. 각 공연의 stageId는 초안의 무대를 참조해야 하며, 시간은 축제 일정 안에 있어야 하고 같은 무대에서 겹치면 안 됩니다.',
  })
  @ApiParam(festivalId)
  @ApiHeader(draftHeader)
  @ApiBody({
    description: '객체가 아닌 JSON 배열 자체를 보냅니다. 최대 400개.',
    schema: {
      type: 'array',
      maxItems: 400,
      items: {
        type: 'object',
        required: ['stageId', 'artist', 'startsAt', 'endsAt'],
        properties: {
          stageId: { type: 'string', example: 'stg_main' },
          artist: { type: 'string', minLength: 1, maxLength: 60 },
          startsAt: { type: 'string', format: 'date-time' },
          endsAt: { type: 'string', format: 'date-time' },
        },
      },
      example: [
        {
          stageId: 'stg_main',
          artist: '봄빛 밴드',
          startsAt: '2026-10-24T13:00:00+09:00',
          endsAt: '2026-10-24T14:00:00+09:00',
        },
      ],
    },
  })
  @ApiResponse({
    status: 200,
    description: '교체된 초안과 빈 warnings 배열',
    schema: {
      type: 'object',
      example: {
        ...draftExample,
        draftVersion: 2,
        sets: [
          {
            stageId: 'stg_main',
            artist: '봄빛 밴드',
            startsAt: '2026-10-24T13:00:00+09:00',
            endsAt: '2026-10-24T14:00:00+09:00',
          },
        ],
        warnings: [],
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: '배열·무대 참조·공연 시간 검증 실패',
  })
  @ApiResponse({ status: 404, description: '축제를 찾을 수 없습니다.' })
  @ApiResponse({
    status: 412,
    description: '초안 버전 충돌. 최신 draft와 draftVersion을 반환합니다.',
  })
  @ApiResponse({
    status: 428,
    description: 'If-Match 헤더 누락 또는 형식 오류',
  })
  sets(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('if-match') ifMatch: string | undefined,
    @Req() request: AdminRequest,
  ) {
    return this.service.replaceArray(
      id,
      'sets',
      body,
      ifMatch,
      request.admin?.id ?? null,
    );
  }

  @AdminRoles('editor')
  @Put(':id/draft/zones')
  @ApiOperation({
    summary: '존 목록 전체 교체',
    description:
      'editor 이상이 지도 존 배열을 통째로 교체합니다. 존 ID는 `zon_`으로 시작하고 x·y 좌표는 0~1 범위입니다.',
  })
  @ApiParam(festivalId)
  @ApiHeader(draftHeader)
  @ApiBody({
    description: '객체가 아닌 JSON 배열 자체를 보냅니다. 최대 40개.',
    schema: {
      type: 'array',
      maxItems: 40,
      items: {
        type: 'object',
        required: ['id', 'name', 'x', 'y'],
        properties: {
          id: { type: 'string', example: 'zon_food' },
          name: { type: 'string', minLength: 1, maxLength: 20 },
          x: { type: 'number', minimum: 0, maximum: 1 },
          y: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
      example: [{ id: 'zon_food', name: '푸드존', x: 0.35, y: 0.68 }],
    },
  })
  @ApiResponse({
    status: 200,
    description: '교체된 초안과 빈 warnings 배열',
    schema: {
      type: 'object',
      example: {
        ...draftExample,
        draftVersion: 2,
        zones: [{ id: 'zon_food', name: '푸드존', x: 0.35, y: 0.68 }],
        warnings: [],
      },
    },
  })
  @ApiResponse({ status: 400, description: '배열·존 ID·좌표 검증 실패' })
  @ApiResponse({ status: 404, description: '축제를 찾을 수 없습니다.' })
  @ApiResponse({
    status: 412,
    description: '초안 버전 충돌. 최신 draft와 draftVersion을 반환합니다.',
  })
  @ApiResponse({
    status: 428,
    description: 'If-Match 헤더 누락 또는 형식 오류',
  })
  zones(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('if-match') ifMatch: string | undefined,
    @Req() request: AdminRequest,
  ) {
    return this.service.replaceArray(
      id,
      'zones',
      body,
      ifMatch,
      request.admin?.id ?? null,
    );
  }

  @Get(':id/draft/diff')
  @ApiOperation({
    summary: '발행본과 초안 비교',
    description:
      '마지막 발행 팩과 현재 초안을 최상위 필드 단위로 비교합니다. 발행 전에는 빈 객체와 비교합니다.',
  })
  @ApiParam(festivalId)
  @ApiResponse({
    status: 200,
    description: '변경 필드의 JSON Pointer 경로와 이전·현재 값',
    schema: {
      type: 'object',
      example: {
        items: [
          { path: '/name', before: '가을 축제', after: '가을 음악 축제' },
        ],
      },
    },
  })
  @ApiResponse({ status: 404, description: '축제를 찾을 수 없습니다.' })
  diff(@Param('id') id: string) {
    return this.service.diff(id);
  }

  @AdminRoles('editor')
  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '축제 팩 발행',
    description:
      'editor 이상이 검토한 초안을 새 팩 버전으로 발행합니다. GET /admin/festivals/{id}/draft의 draftVersion을 `If-Match: "d{draftVersion}"`으로 보내야 하며, 초안이 바뀌면 최신 초안과 함께 412를 반환합니다. 무대가 최소 1개 필요하고 Brotli 압축 팩은 200KB 이하여야 합니다. pushedDevices는 배경 푸시 작업을 큐에 등록한 기기 수이며 실제 수신 수가 아닙니다.',
  })
  @ApiParam(festivalId)
  @ApiHeader(draftHeader)
  @ApiBody({
    required: false,
    description:
      '발행 기록 메모. 생략하거나 빈 객체를 보내면 빈 문자열로 기록합니다.',
    schema: {
      type: 'object',
      properties: { note: { type: 'string', maxLength: 500 } },
      example: { note: '최종 공연 시간표 반영' },
    },
  })
  @ApiResponse({
    status: 200,
    description: '새 팩 버전과 ETag, 배경 푸시 작업이 등록된 기기 수',
    schema: versionResponse,
  })
  @ApiResponse({
    status: 400,
    description: '메모·발행 초안 검증 실패 또는 압축 팩 200KB 초과',
  })
  @ApiResponse({ status: 404, description: '축제를 찾을 수 없습니다.' })
  @ApiResponse({
    status: 412,
    description: '검토한 초안 버전이 변경되었습니다.',
  })
  @ApiResponse({ status: 428, description: 'If-Match 초안 버전이 필요합니다.' })
  publish(
    @Param('id') id: string,
    @Body() body: { note?: string },
    @Headers('if-match') ifMatch: string | undefined,
    @Req() request: AdminRequest,
  ) {
    return this.service.publish(
      id,
      body?.note ?? '',
      ifMatch,
      request.admin?.id ?? null,
    );
  }

  @Get(':id/versions')
  @ApiOperation({
    summary: '발행 버전 이력 조회',
    description:
      '최신 발행 버전부터 이력을 반환합니다. 원본 팩 본문은 포함하지 않습니다.',
  })
  @ApiParam(festivalId)
  @ApiResponse({
    status: 200,
    description: '발행 이력',
    schema: {
      type: 'object',
      example: {
        items: [
          {
            packVersion: 1,
            publishedAt: '2026-10-20T09:00:00Z',
            publishedBy: 'adm_01234567',
            note: '최종 공연 시간표 반영',
            sizeBytes: 4096,
          },
        ],
      },
    },
  })
  @ApiResponse({ status: 404, description: '축제를 찾을 수 없습니다.' })
  versions(@Param('id') id: string) {
    return this.service.versionsList(id);
  }

  @AdminRoles('owner')
  @Post(':id/rollback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '이전 팩을 새 버전으로 재발행',
    description:
      'owner만 사용할 수 있습니다. 지정한 이전 팩의 내용을 복원해 현재 발행 버전 다음 번호로 새 팩을 발행합니다. 초안은 변경하지 않습니다.',
  })
  @ApiParam(festivalId)
  @ApiBody({
    description: '복원할 기존 발행 버전',
    schema: {
      type: 'object',
      required: ['toVersion'],
      properties: { toVersion: { type: 'integer', minimum: 1 } },
      example: { toVersion: 1 },
    },
  })
  @ApiResponse({
    status: 200,
    description: '재발행된 새 팩 버전과 ETag',
    schema: versionResponse,
  })
  @ApiResponse({
    status: 400,
    description: 'toVersion이 양의 정수가 아니거나 압축 팩 200KB 초과',
  })
  @ApiResponse({
    status: 404,
    description: '축제 또는 대상 발행 버전을 찾을 수 없습니다.',
  })
  rollback(
    @Param('id') id: string,
    @Body() body: { toVersion: number },
    @Req() request: AdminRequest,
  ) {
    return this.service.rollback(
      id,
      body?.toVersion,
      request.admin?.id ?? null,
    );
  }
}
