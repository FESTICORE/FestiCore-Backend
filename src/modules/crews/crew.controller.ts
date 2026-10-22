import {
  Body,
  BadRequestException,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorator/current-user.decorator';
import { RequireCurrentTerms } from '../auth/decorator/require-current-terms.decorator';
import { Public } from '../auth/decorator/public.decorator';
import type { AuthUser } from '../auth/types/social-profile';
import {
  CreateCrewDto,
  CrewGatherDto,
  CrewStatusDto,
  JoinCrewDto,
  RenameCrewDto,
  RenameCrewMemberDto,
  TransferCrewDto,
} from './crew.dto';
import { CrewService } from './crew.service';

@ApiTags('Crews')
@Controller('crews')
export class CrewController {
  constructor(private readonly service: CrewService) {}

  @RequireCurrentTerms()
  @Post()
  @ApiBearerAuth()
  @ApiOperation({
    summary: '크루 만들기',
    description:
      '발행된 축제에 비공개 크루를 만들고 요청자를 크루장으로 등록합니다. 사용자당 축제별 크루는 하나입니다.',
  })
  @ApiResponse({
    status: 201,
    description: '크루와 크루장에게만 표시되는 48시간 유효 초대 코드',
    schema: {
      example: {
        id: 'flg_1234567890abcdef',
        visibility: 'private',
        name: '함께 즐겨요',
        festivalId: 'fst_2026',
        ownerId: '00000000-0000-4000-8000-000000000001',
        members: [
          {
            userId: '00000000-0000-4000-8000-000000000001',
            nickname: '로이',
            joinedAt: '2026-10-21T01:00:00.000Z',
          },
        ],
        inviteCode: 'K7P2QX',
        inviteExpiresAt: '2026-10-23T01:00:00.000Z',
        archivedAt: null,
      },
    },
  })
  @ApiResponse({
    status: 409,
    description: '이미 이 축제의 크루에 소속됨. crewId 포함',
  })
  @ApiResponse({ status: 410, description: '축제 종료 후 24시간 경과' })
  async create(
    @CurrentUser() user: AuthUser,
    @Body() body: CreateCrewDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const crew = await this.service.create(user.userId, body);
    response.location(`/api/v1/crews/${crew.id}`);
    return crew;
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Get('invite/:code')
  @ApiOperation({
    summary: '초대 코드 미리보기',
    description:
      '로그인 없이 초대 코드의 크루명과 인원만 조회합니다. 없거나 만료된 코드는 같은 404로 응답합니다. IP당 분당 10회로 제한합니다.',
  })
  @ApiParam({
    name: 'code',
    example: 'K7P2QX',
    description: '대소문자 구분 없는 초대 코드',
  })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        crewName: '함께 즐겨요',
        festivalId: 'fst_2026',
        festivalName: '테스트 축제',
        memberCount: 3,
        expiresAt: '2026-10-23T01:00:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 404, description: '없거나 만료된 코드' })
  @ApiResponse({ status: 429, description: '분당 조회 제한 초과' })
  invite(@Param('code') code: string) {
    return this.service.invite(code);
  }

  @RequireCurrentTerms()
  @Post('join')
  @ApiBearerAuth()
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @ApiOperation({
    summary: '초대 코드로 크루 가입',
    description:
      '이미 같은 크루의 멤버라면 기존 크루를 반환합니다. 최대 12명이며 다른 크루에 속한 경우 crewId를 포함한 409를 반환합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '크루와 현재 라이브 상태',
    schema: {
      example: {
        id: 'flg_1234567890abcdef',
        visibility: 'private',
        name: '함께 즐겨요',
        festivalId: 'fst_2026',
        ownerId: '00000000-0000-4000-8000-000000000001',
        members: [],
        inviteCode: null,
        inviteExpiresAt: null,
        archivedAt: null,
        live: {
          id: 'flg_1234567890abcdef',
          name: '함께 즐겨요',
          ownerId: '00000000-0000-4000-8000-000000000001',
          members: [],
          gatherRequest: null,
          gatherAvailableAt: null,
        },
      },
    },
  })
  @ApiResponse({ status: 409, description: '정원 초과 또는 다른 크루 소속' })
  @ApiResponse({ status: 410, description: '초대 만료 또는 크루 보관됨' })
  join(@CurrentUser() user: AuthUser, @Body() body: JoinCrewDto) {
    return this.service.join(user.userId, body);
  }

  @Get(':crewId')
  @ApiBearerAuth()
  @ApiOperation({
    summary: '크루 상세와 라이브 상태',
    description:
      '멤버만 조회할 수 있습니다. 초대 코드는 크루장에게만 표시되며 Cache-Control: no-store로 응답합니다. 보관된 크루도 조회할 수 있습니다.',
  })
  @ApiParam({ name: 'crewId', example: 'flg_1234567890abcdef' })
  @ApiResponse({
    status: 200,
    description: '크루와 멤버 상태',
    schema: {
      example: {
        id: 'flg_1234567890abcdef',
        visibility: 'private',
        name: '함께 즐겨요',
        festivalId: 'fst_2026',
        ownerId: '00000000-0000-4000-8000-000000000001',
        members: [],
        inviteCode: null,
        inviteExpiresAt: null,
        archivedAt: null,
        live: {
          id: 'flg_1234567890abcdef',
          name: '함께 즐겨요',
          ownerId: '00000000-0000-4000-8000-000000000001',
          members: [],
          gatherRequest: null,
          gatherAvailableAt: null,
        },
      },
    },
  })
  @ApiResponse({ status: 403, description: 'CREW_NOT_MEMBER' })
  detail(
    @Param('crewId') id: string,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.service.detail(id, user.userId);
  }

  @RequireCurrentTerms()
  @Post(':crewId/invite/rotate')
  @ApiBearerAuth()
  @HttpCode(200)
  @ApiOperation({
    summary: '초대 코드 교체',
    description:
      '크루장만 호출할 수 있습니다. 이전 코드는 즉시 무효화되고 새 코드는 48시간 동안 유효합니다.',
  })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        inviteCode: 'K7P2QX',
        inviteExpiresAt: '2026-10-23T01:00:00.000Z',
      },
    },
  })
  @ApiResponse({
    status: 403,
    description: 'CREW_NOT_OWNER 또는 CREW_NOT_MEMBER',
  })
  rotate(@Param('crewId') id: string, @CurrentUser() user: AuthUser) {
    return this.service.rotate(id, user.userId);
  }

  @RequireCurrentTerms()
  @Post(':crewId/status')
  @ApiBearerAuth()
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 12 } })
  @ApiOperation({
    summary: '내 크루 상태 갱신',
    description:
      'zoneId 또는 state 중 하나 이상과 clientAt을 보냅니다. Idempotency-Key로 24시간 같은 요청을 재전송할 수 있습니다. 오래된 clientAt은 STATUS_STALE이며 leaving은 zoneId를 null로 만듭니다. 분당 12회 제한입니다.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    description: '요청별 고유 키, 최대 128자. 24시간 보관',
    required: true,
    example: 'crew-status-001',
  })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        userId: '00000000-0000-4000-8000-000000000001',
        zoneId: 'zon_main',
        state: 'here',
        updatedAt: '2026-10-21T01:00:00.000Z',
      },
    },
  })
  @ApiResponse({
    status: 409,
    description: 'STATUS_STALE(current 포함) 또는 IDEMPOTENCY_CONFLICT',
  })
  @ApiResponse({ status: 410, description: 'CREW_ARCHIVED' })
  status(
    @Param('crewId') id: string,
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: CrewStatusDto,
  ) {
    if (!key?.trim() || key.length > 128)
      throw new BadRequestException({
        code: 'VALIDATION',
        message: 'Idempotency-Key가 필요합니다.',
      });
    return this.service.status(id, user.userId, body, key);
  }

  @RequireCurrentTerms()
  @Post(':crewId/gather')
  @ApiBearerAuth()
  @HttpCode(200)
  @ApiOperation({
    summary: '크루 집결 요청',
    description:
      '멤버가 등록된 존을 지정합니다. 크루당 10분에 한 번 요청할 수 있습니다.',
  })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        zoneId: 'zon_main',
        byUserId: '00000000-0000-4000-8000-000000000001',
        at: '2026-10-21T01:00:00.000Z',
      },
    },
  })
  @ApiResponse({
    status: 429,
    description: 'GATHER_COOLDOWN, retryAfter 초 포함',
  })
  gather(
    @Param('crewId') id: string,
    @CurrentUser() user: AuthUser,
    @Body() body: CrewGatherDto,
  ) {
    return this.service.gather(id, user.userId, body.zoneId);
  }

  @RequireCurrentTerms()
  @Patch(':crewId')
  @ApiBearerAuth()
  @ApiOperation({
    summary: '크루 이름 변경',
    description: '크루장만 변경할 수 있습니다. 1~20자입니다.',
  })
  @ApiResponse({ status: 200, description: '변경된 크루' })
  rename(
    @Param('crewId') id: string,
    @CurrentUser() user: AuthUser,
    @Body() body: RenameCrewDto,
  ) {
    return this.service.rename(id, user.userId, body?.name);
  }

  @RequireCurrentTerms()
  @Patch(':crewId/members/me')
  @ApiBearerAuth()
  @ApiOperation({
    summary: '내 크루 표시 이름 변경',
    description: '이 크루에서만 사용할 1~12자 닉네임을 설정합니다.',
  })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        userId: '00000000-0000-4000-8000-000000000001',
        nickname: '로이',
      },
    },
  })
  renameMember(
    @Param('crewId') id: string,
    @CurrentUser() user: AuthUser,
    @Body() body: RenameCrewMemberDto,
  ) {
    return this.service.renameMember(id, user.userId, body?.nickname);
  }

  @RequireCurrentTerms()
  @Delete(':crewId/members/:userId')
  @ApiBearerAuth()
  @HttpCode(204)
  @ApiOperation({
    summary: '크루 멤버 제거 또는 탈퇴',
    description:
      '본인은 탈퇴할 수 있고, 타인은 크루장만 제거할 수 있습니다. 크루장은 양도하거나 크루를 삭제해야 합니다.',
  })
  @ApiResponse({ status: 204, description: '제거 완료, 본문 없음' })
  @ApiResponse({ status: 409, description: 'OWNER_CANNOT_LEAVE' })
  removeMember(
    @Param('crewId') id: string,
    @Param('userId') userId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.removeMember(id, user.userId, userId);
  }

  @RequireCurrentTerms()
  @Post(':crewId/transfer')
  @ApiBearerAuth()
  @HttpCode(200)
  @ApiOperation({
    summary: '크루장 양도',
    description: '현 크루장만 같은 크루의 다른 멤버에게 양도합니다.',
  })
  @ApiResponse({ status: 200, description: '새 크루장이 반영된 크루' })
  transfer(
    @Param('crewId') id: string,
    @CurrentUser() user: AuthUser,
    @Body() body: TransferCrewDto,
  ) {
    return this.service.transfer(id, user.userId, body.toUserId);
  }

  @RequireCurrentTerms()
  @Delete(':crewId')
  @ApiBearerAuth()
  @HttpCode(204)
  @ApiOperation({
    summary: '크루 해산',
    description:
      '크루장만 해산할 수 있습니다. 멤버십과 집결 기록이 삭제됩니다.',
  })
  @ApiResponse({ status: 204, description: '해산 완료, 본문 없음' })
  dissolve(@Param('crewId') id: string, @CurrentUser() user: AuthUser) {
    return this.service.dissolve(id, user.userId);
  }
}
