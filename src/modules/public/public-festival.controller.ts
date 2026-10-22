import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpException,
  NotFoundException,
  Param,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { brotliCompressSync, gzipSync } from 'zlib';
import type { Request, Response } from 'express';
import { apiSuccess } from '../../common/interfaces/api-response.interface';
import { Public } from '../auth/decorator/public.decorator';
import { DeviceAuthGuard } from '../device/device-auth.guard';
import { DeviceService } from '../device/device.service';
import { envelopeEtag, PublicFestivalService } from './public-festival.service';
import { PublicLiveService } from './public-live.service';

function matchesEtag(header: string | undefined, etag: string): boolean {
  return (
    header
      ?.split(',')
      .map((value) => value.trim())
      .some(
        (value) =>
          value === '*' ||
          value.replace(/^W\//, '') === etag.replace(/^W\//, ''),
      ) ?? false
  );
}

function acceptsEncoding(
  header: string | undefined,
  encoding: string,
): boolean {
  return (
    header?.split(',').some((part) => {
      const [name, ...parameters] = part.trim().split(';');
      if (name.toLowerCase() !== encoding) return false;
      const quality = parameters
        .map((parameter) => parameter.trim().match(/^q\s*=\s*([0-9.]+)$/i))
        .find(Boolean)?.[1];
      return (
        quality === undefined || (Number(quality) > 0 && Number(quality) <= 1)
      );
    }) ?? false
  );
}

const festivalId = {
  name: 'id',
  description: '발행된 축제 ID',
  example: 'fst_01234567',
};

function jsonErrorSchema(code: string) {
  return {
    type: 'object' as const,
    required: ['code', 'data', 'message'],
    properties: {
      code: { type: 'string' as const, example: code },
      data: { nullable: true, example: null },
      message: {
        type: 'string' as const,
        example: '요청을 처리할 수 없습니다.',
      },
    },
  };
}

@ApiTags('Public Festivals')
@Public()
@Controller('festivals')
export class PublicFestivalController {
  constructor(
    private readonly service: PublicFestivalService,
    private readonly liveService: PublicLiveService,
    private readonly deviceAuth: DeviceAuthGuard,
    private readonly devices: DeviceService,
  ) {}

  private send(
    response: Response,
    body: unknown,
    etag?: string,
    ifNoneMatch?: string,
  ) {
    response.setHeader('Date', new Date().toUTCString());
    if (etag) response.setHeader('ETag', etag);
    if (etag && matchesEtag(ifNoneMatch, etag)) {
      response.status(304).end();
      return;
    }
    response.json(apiSuccess(body));
  }

  @Get()
  @ApiOperation({
    summary: '축제 목록',
    description:
      '발행 축제와 판매처에서 발견한 축제를 함께 조회합니다. 각 항목의 ticketLinks(최대 5개)는 예매처·공식 링크이며 thumbUrl은 썸네일입니다. 발견 항목은 status=discovered, packVersion=0이며 팩은 아직 없습니다. 발견 항목의 날짜는 공연 날짜만 뜻하고 시작 시각은 확인되지 않았습니다. 요청 본문은 없습니다.',
  })
  @ApiQuery({
    name: 'after',
    required: false,
    description:
      '조회 하한 날짜 YYYY-MM-DD 또는 이전 응답의 nextCursor(조회 하한 날짜~정렬 ISO8601 시각~축제 ID, URL 인코딩 필요). 발견 항목의 정렬 시각은 공연 시작 시각이 아닙니다.',
    example: '2026-10-21',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: '페이지 크기 1~50, 기본 20',
    example: 20,
  })
  @ApiHeader({
    name: 'If-None-Match',
    required: false,
    description: '이전 목록 응답의 ETag. 일치하면 304.',
  })
  @ApiHeader({
    name: 'X-Device-Id',
    required: false,
    description: '기기 Bearer와 함께 전송하면 각 축제의 pinned를 포함합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '발행 축제 및 발견 항목 요약과 다음 페이지 커서',
    schema: {
      type: 'object',
      example: {
        code: 'SUCCESS',
        data: {
          items: [
            {
              id: 'fst_01234567',
              name: '가을 음악 축제',
              firstDate: '2026-10-24',
              lastDate: '2026-10-24',
              packVersion: 1,
              thumbUrl: 'https://example.com/festival.webp',
              ticketLinks: [
                { label: '예스24', url: 'https://ticket.yes24.com/Perf/12345' },
              ],
              status: 'upcoming',
            },
            {
              id: 'fst_1234567890abcdef',
              name: '겨울 페스티벌',
              venue: '공연장',
              firstDate: '2026-12-25',
              lastDate: '2026-12-26',
              packVersion: 0,
              flagsEnabled: false,
              thumbUrl: null,
              ticketLinks: [
                {
                  label: '멜론티켓',
                  url: 'https://ticket.melon.com/performance/index.htm?prodId=12345',
                },
              ],
              status: 'discovered',
              sourceUrl:
                'https://ticket.melon.com/performance/index.htm?prodId=12345',
              officialInstagramUrl:
                'https://www.instagram.com/grandmintfestival/',
            },
          ],
          nextCursor: null,
        },
        message: '성공적으로 처리되었습니다.',
      },
    },
  })
  @ApiResponse({ status: 304, description: '목록이 변경되지 않았습니다.' })
  @ApiResponse({
    status: 400,
    description: 'after 또는 limit 형식 오류',
    schema: jsonErrorSchema('VALIDATION'),
  })
  async list(
    @Query('after') after: string | undefined,
    @Query('limit') limit: string | undefined,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    const body = await this.service.list(after, limit);
    const deviceId = request.header('x-device-id');
    const principal = deviceId
      ? await this.deviceAuth.resolveOptionalPrincipal(request)
      : undefined;
    response.setHeader('Vary', 'Authorization, X-Device-Id');
    if (deviceId && principal) {
      try {
        const { items } = await this.devices.listSubscriptions(
          deviceId,
          principal,
        );
        const pins = new Map(
          items.map((item) => [item.festivalId, item.pinned]),
        );
        body.items = body.items.map((item) => ({
          ...item,
          pinned: pins.get(item.id) ?? false,
        }));
        response.setHeader('Cache-Control', 'private, max-age=60');
      } catch (error) {
        if (
          !(error instanceof BadRequestException) &&
          !(error instanceof ForbiddenException) &&
          !(error instanceof NotFoundException)
        )
          throw error;
      }
    }
    if (!response.hasHeader('Cache-Control'))
      response.setHeader('Cache-Control', 'public, max-age=3600');
    this.send(
      response,
      body,
      envelopeEtag(this.service.etag(body)),
      ifNoneMatch,
    );
  }

  @Get(':id')
  @ApiOperation({
    summary: '축제 상세 정보',
    description:
      '목록의 축제 ID로 상세를 조회합니다. 발견된 축제는 확인된 일정·장소·보관 포스터·출연진·ticketLinks를 반환하고 타임테이블은 발행 전 빈 목록입니다. 발행된 축제는 thumbUrl과 ticketLinks를 포함한 공개 팩을 반환합니다. 요청 본문은 없습니다.',
  })
  @ApiParam({
    name: 'id',
    description: '축제 목록에서 받은 ID',
    example: 'fst_0123456789abcdef',
  })
  @ApiResponse({
    status: 200,
    description: '축제 상세와 확인된 출연진, 이미지 경로',
    schema: {
      type: 'object',
      example: {
        code: 'SUCCESS',
        data: {
          id: 'fst_0123456789abcdef',
          name: 'WONDERLIVET 2026 (원더리벳 2026)',
          venue: 'KINTEX HALL 7/8/9/10',
          firstDate: '2026-11-20',
          lastDate: '2026-11-22',
          status: 'discovered',
          packVersion: 0,
          thumbUrl:
            '/api/v1/festivals/images/00000000-0000-4000-8000-000000000001.webp',
          ticketLinks: [
            {
              label: '멜론티켓',
              url: 'https://ticket.melon.com/performance/index.htm?prodId=213793',
            },
          ],
          sourceUrl:
            'https://ticket.melon.com/performance/index.htm?prodId=213793',
          officialInstagramUrl: null,
          artists: [{ name: 'THE ORAL CIGARETTES', imageUrl: null }],
          timetable: [],
        },
        message: '성공적으로 처리되었습니다.',
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: '축제를 찾을 수 없습니다.',
    schema: jsonErrorSchema('FESTIVAL_NOT_FOUND'),
  })
  async detail(@Param('id') id: string, @Res() response: Response) {
    const body = await this.service.detail(id);
    response.setHeader('Cache-Control', 'public, max-age=60');
    this.send(response, body);
  }

  @Get(':id/pack/version')
  @ApiOperation({
    summary: '발행 팩 버전 확인',
    description:
      '앱의 저장 팩과 비교할 버전·갱신 시각·ETag를 조회합니다. 요청 본문은 없습니다.',
  })
  @ApiParam(festivalId)
  @ApiHeader({
    name: 'If-None-Match',
    required: false,
    description: '이전 버전 ETag. 일치하면 304.',
  })
  @ApiResponse({
    status: 200,
    description: '발행 팩 버전',
    schema: {
      type: 'object',
      example: {
        code: 'SUCCESS',
        data: {
          packVersion: 1,
          packUpdatedAt: '2026-10-20T09:00:00Z',
          etag: '"cdm1-v1"',
        },
        message: '성공적으로 처리되었습니다.',
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: '발행된 축제가 없습니다.',
    schema: jsonErrorSchema('FESTIVAL_NOT_FOUND'),
  })
  @ApiResponse({ status: 304, description: '팩 버전이 변경되지 않았습니다.' })
  async version(
    @Param('id') id: string,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res() response: Response,
  ) {
    const body = await this.service.version(id);
    response.setHeader('Cache-Control', 'public, no-cache, must-revalidate');
    this.send(response, body, body.etag, ifNoneMatch);
  }

  @Get(':id/pack')
  @ApiOperation({
    summary: '발행 축제 팩',
    description:
      '발행된 축제 전체 JSON 팩을 받습니다. Brotli 또는 gzip 압축을 지원합니다. 요청 본문은 없습니다.',
  })
  @ApiParam(festivalId)
  @ApiHeader({
    name: 'If-None-Match',
    required: false,
    description: '이전 팩 ETag. 일치하면 304.',
  })
  @ApiHeader({
    name: 'Accept-Encoding',
    required: false,
    description: 'br, gzip 또는 identity. q=0인 압축은 사용하지 않습니다.',
  })
  @ApiResponse({
    status: 200,
    description: '발행 팩 JSON',
    schema: {
      type: 'object',
      additionalProperties: true,
      example: {
        code: 'SUCCESS',
        data: {
          id: 'fst_01234567',
          name: '가을 음악 축제',
          days: [{ date: '2026-10-24' }],
          packVersion: 1,
        },
        message: '성공적으로 처리되었습니다.',
      },
    },
  })
  @ApiResponse({ status: 304, description: '팩 버전이 변경되지 않았습니다.' })
  @ApiResponse({
    status: 404,
    description: '발행된 축제가 없습니다.',
    schema: jsonErrorSchema('FESTIVAL_NOT_FOUND'),
  })
  async pack(
    @Param('id') id: string,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Headers('accept-encoding') acceptEncoding: string | undefined,
    @Res() response: Response,
  ) {
    const body = await this.service.published(id);
    response.setHeader('Cache-Control', 'public, no-cache, must-revalidate');
    response.setHeader('Date', new Date().toUTCString());
    response.setHeader('Vary', 'Accept-Encoding');
    const etag = envelopeEtag(`"v${body.packVersion as number}"`);
    response.setHeader('ETag', etag);
    if (matchesEtag(ifNoneMatch, etag)) {
      response.status(304).end();
      return;
    }
    const raw = Buffer.from(JSON.stringify(apiSuccess(body)));
    response.type('application/json');
    if (acceptsEncoding(acceptEncoding, 'br')) {
      response.setHeader('Content-Encoding', 'br');
      response.send(brotliCompressSync(raw));
    } else if (acceptsEncoding(acceptEncoding, 'gzip')) {
      response.setHeader('Content-Encoding', 'gzip');
      response.send(gzipSync(raw));
    } else {
      response.send(raw);
    }
  }

  @Get(':id/flags')
  @ApiOperation({
    summary: '축제 공개 깃발 목록',
    description:
      '공개·비숨김 깃발만 반환합니다. tag를 여러 번 보내면 OR 필터입니다. 요청 본문은 없습니다.',
  })
  @ApiParam(festivalId)
  @ApiQuery({
    name: 'tag',
    required: false,
    isArray: true,
    enum: ['slam', 'sing', 'train', 'calm', 'newbie'],
    description: '반복 가능. 예: ?tag=slam&tag=calm',
  })
  @ApiResponse({
    status: 200,
    description: '공개 깃발 프로필과 팩 버전',
    schema: {
      type: 'object',
      example: {
        code: 'SUCCESS',
        data: {
          items: [{ id: 'flg_01234567', name: '응원 깃발', tags: ['slam'] }],
          packVersion: 1,
        },
        message: '성공적으로 처리되었습니다.',
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'tag 값 오류',
    schema: jsonErrorSchema('VALIDATION'),
  })
  @ApiResponse({
    status: 404,
    description: '발행된 축제가 없습니다.',
    schema: jsonErrorSchema('FESTIVAL_NOT_FOUND'),
  })
  async flags(
    @Param('id') id: string,
    @Query('tag') tag: string | string[] | undefined,
    @Res() response: Response,
  ) {
    if (tag !== undefined && typeof tag !== 'string' && !Array.isArray(tag))
      throw new BadRequestException({
        code: 'VALIDATION',
        message: 'tag 형식이 올바르지 않습니다.',
      });
    const body = await this.service.flags(
      id,
      tag === undefined ? undefined : Array.isArray(tag) ? tag : [tag],
    );
    response.setHeader('Cache-Control', 'public, max-age=600');
    this.send(response, body);
  }

  @Get(':id/live')
  @ApiOperation({
    summary: '축제 라이브 보드',
    description:
      '최근 공개 깃발 상태와 로그인 사용자의 팔로우·크루 정보를 반환합니다. 기기별 분당 최대 4회입니다. 요청 본문은 없습니다.',
  })
  @ApiParam(festivalId)
  @ApiHeader({
    name: 'X-Device-Id',
    required: true,
    description: '클라이언트 설치별 UUID',
  })
  @ApiHeader({
    name: 'If-None-Match',
    required: false,
    description: '이전 라이브 응답의 ETag. 상태가 같으면 304.',
  })
  @ApiHeader({
    name: 'Authorization',
    required: false,
    description:
      '선택 사항. 로그인 사용자는 Bearer 앱 access token을 보내면 me 필드를 받습니다.',
  })
  @ApiResponse({
    status: 200,
    description: '현재 라이브 보드',
    schema: {
      type: 'object',
      example: {
        code: 'SUCCESS',
        data: {
          festivalId: 'fst_01234567',
          setOverrides: [],
          activeFlags: [],
          me: null,
          serverAt: '2026-10-20T09:00:00Z',
        },
        message: '성공적으로 처리되었습니다.',
      },
    },
  })
  @ApiResponse({ status: 304, description: '라이브 상태 변경 없음' })
  @ApiResponse({
    status: 400,
    description: '기기 UUID 형식 오류',
    schema: jsonErrorSchema('VALIDATION'),
  })
  @ApiResponse({
    status: 401,
    description: '전달된 Bearer 토큰이 유효하지 않습니다.',
    schema: jsonErrorSchema('UNAUTHORIZED'),
  })
  @ApiResponse({
    status: 429,
    description: '기기별 요청 횟수 초과. Retry-After 헤더를 확인하세요.',
    schema: jsonErrorSchema('RATE_LIMITED'),
  })
  @ApiResponse({
    status: 503,
    description:
      '요청 제한 기록 정리를 확인할 수 없어 라이브 조회를 잠시 중단함',
    schema: jsonErrorSchema('SERVICE_UNAVAILABLE'),
  })
  async live(
    @Param('id') id: string,
    @Headers('x-device-id') deviceId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res() response: Response,
  ) {
    try {
      const { body, etag } = await this.liveService.board(
        id,
        deviceId,
        authorization,
      );
      response.setHeader('Cache-Control', 'private, max-age=30');
      response.setHeader('Vary', 'Authorization');
      response.setHeader('X-Poll-After', '30');
      this.send(response, body, envelopeEtag(etag), ifNoneMatch);
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === 429) {
        const detail = error.getResponse();
        const seconds =
          typeof detail === 'object' &&
          detail !== null &&
          'retryAfter' in detail
            ? Number(detail.retryAfter)
            : 60;
        response.setHeader(
          'Retry-After',
          String(Number.isFinite(seconds) ? seconds : 60),
        );
      }
      throw error;
    }
  }
}
