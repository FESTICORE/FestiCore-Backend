import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { apiSuccess } from '../../common/interfaces/api-response.interface';
import { CurrentUser } from '../auth/decorator/current-user.decorator';
import type { AuthUser } from '../auth/types/social-profile';
import {
  DeleteNotificationsDto,
  MarkNotificationsReadDto,
} from './user-notification.dto';
import { UserNotificationService } from './user-notification.service';

const festivalQuery = {
  name: 'festivalId',
  required: false,
  example: 'fst_2026',
  description: '해당 축제의 알림만 조회합니다.',
};

function matchesEtag(header: string | undefined, etag: string): boolean {
  return (
    header
      ?.split(',')
      .map((value) => value.trim().replace(/^W\//, ''))
      .some((value) => value === '*' || value === etag) ?? false
  );
}

@ApiTags('Me Notifications')
@ApiBearerAuth()
@Controller('me/notifications')
export class UserNotificationController {
  constructor(private readonly service: UserNotificationService) {}

  @Get()
  @ApiOperation({
    summary: '내 알림함 목록',
    description:
      '최근 30일 알림을 최신순으로 조회합니다. nextCursor가 있으면 before로 다음 페이지를 요청합니다.',
  })
  @ApiQuery(festivalQuery)
  @ApiQuery({
    name: 'before',
    required: false,
    description: '이전 응답의 nextCursor',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    example: 20,
    description: '1~50, 기본 20',
  })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        code: 'SUCCESS',
        data: {
          items: [
            {
              id: 'ntf_0123456789abcdef0123456789abcdef',
              type: 'crew.status',
              festivalId: 'fst_2026',
              title: '크루원 상태 변경',
              body: '민지님의 상태가 moving(으)로 변경됐어요.',
              createdAt: '2026-10-17T06:40:00.000Z',
              readAt: null,
              route: '/crews/crw_123',
              subject: { crewId: 'crw_123', userId: 'uuid' },
            },
          ],
          nextCursor: null,
        },
        message: '성공적으로 처리되었습니다.',
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'festivalId·before·limit 형식 오류',
  })
  @ApiResponse({ status: 401, description: 'access 토큰 없음 또는 만료' })
  list(
    @CurrentUser() user: AuthUser,
    @Query('festivalId') festivalId?: string,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.list(user.userId, { festivalId, before, limit });
  }

  @Get('unread-count')
  @ApiOperation({
    summary: '읽지 않은 알림 수',
    description:
      '새 알림 배지용 개수입니다. If-None-Match가 현재 ETag와 같으면 본문 없이 304를 반환합니다.',
  })
  @ApiQuery(festivalQuery)
  @ApiHeader({
    name: 'If-None-Match',
    required: false,
    description: '이전 응답의 ETag',
  })
  @ApiResponse({
    status: 200,
    headers: { ETag: { description: '예: "unread-3"' } },
    schema: {
      example: {
        code: 'SUCCESS',
        data: { unreadCount: 3 },
        message: '성공적으로 처리되었습니다.',
      },
    },
  })
  @ApiResponse({ status: 304, description: '개수가 바뀌지 않았습니다.' })
  @ApiResponse({ status: 400, description: 'festivalId 형식 오류' })
  @ApiResponse({ status: 401, description: 'access 토큰 없음 또는 만료' })
  async unreadCount(
    @CurrentUser() user: AuthUser,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res() response: Response,
    @Query('festivalId') festivalId?: string,
  ) {
    const body = await this.service.unreadCount(user.userId, festivalId);
    const etag = `"unread-${body.unreadCount}"`;
    response.setHeader('Cache-Control', 'private, no-cache');
    response.setHeader('Vary', 'Authorization');
    response.setHeader('ETag', etag);
    if (matchesEtag(ifNoneMatch, etag)) {
      response.status(304).end();
      return;
    }
    response.json(apiSuccess(body));
  }

  @Post('read')
  @HttpCode(204)
  @ApiOperation({
    summary: '알림 읽음 처리',
    description:
      '{ ids } 또는 { all: true, festivalId? } 중 하나를 보냅니다. 내 알림이 아닌 ID는 무시합니다.',
  })
  @ApiResponse({ status: 204, description: '읽음 처리 완료' })
  @ApiResponse({ status: 400, description: '본문 형식 오류' })
  @ApiResponse({ status: 401, description: 'access 토큰 없음 또는 만료' })
  async read(
    @CurrentUser() user: AuthUser,
    @Body() body: MarkNotificationsReadDto,
  ): Promise<void> {
    await this.service.markRead(user.userId, body);
  }

  @Post('delete')
  @HttpCode(204)
  @ApiOperation({
    summary: '알림 선택 삭제',
    description:
      '본문이 있어 DELETE 대신 POST를 씁니다. 내 알림이 아닌 ID나 없는 ID는 무시합니다.',
  })
  @ApiResponse({ status: 204, description: '삭제 완료' })
  @ApiResponse({ status: 400, description: '본문 형식 오류' })
  @ApiResponse({ status: 401, description: 'access 토큰 없음 또는 만료' })
  async remove(
    @CurrentUser() user: AuthUser,
    @Body() body: DeleteNotificationsDto,
  ): Promise<void> {
    await this.service.remove(user.userId, body);
  }
}
