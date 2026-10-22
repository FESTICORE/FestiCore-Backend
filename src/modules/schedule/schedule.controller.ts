import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorator/current-user.decorator';
import type { AuthUser } from '../auth/types/social-profile';
import { ReplaceScheduleDto } from './schedule.dto';
import { ScheduleService } from './schedule.service';

@ApiTags('Schedule')
@ApiBearerAuth()
@Controller('me/schedule')
export class ScheduleController {
  constructor(private readonly service: ScheduleService) {}

  @Put(':festivalId')
  @ApiOperation({
    summary: '내 일정 전체 교체',
    description:
      '로그인한 사용자의 축제 일정을 공개된 공연 ID 목록으로 교체합니다. 빈 목록은 일정 삭제입니다. 더 오래된 clientAt 또는 같은 시각의 다른 내용은 409를 반환합니다.',
  })
  @ApiParam({ name: 'festivalId', example: 'fst_festival' })
  @ApiResponse({ status: 200, description: '저장된 setIds와 서버 updatedAt' })
  @ApiResponse({
    status: 400,
    description: '본문 형식 오류, 미공개 setId 또는 5분 초과 미래 시각',
  })
  @ApiResponse({ status: 401, description: 'access 토큰 없음 또는 만료' })
  @ApiResponse({ status: 404, description: '공개된 축제 없음' })
  @ApiResponse({ status: 409, description: 'STATUS_STALE: 더 최신 일정 존재' })
  replace(
    @CurrentUser() user: AuthUser,
    @Param('festivalId') festivalId: string,
    @Body() body: ReplaceScheduleDto,
  ) {
    return this.service.replace(user.userId, festivalId, body);
  }

  @Get(':festivalId')
  @ApiOperation({
    summary: '내 일정 조회',
    description:
      '로그인한 사용자의 저장된 일정입니다. 저장한 일정이 없으면 빈 목록과 null updatedAt을 반환합니다.',
  })
  @ApiParam({ name: 'festivalId', example: 'fst_festival' })
  @ApiResponse({ status: 200, description: '저장된 일정 또는 빈 일정' })
  @ApiResponse({ status: 401, description: 'access 토큰 없음 또는 만료' })
  @ApiResponse({ status: 404, description: '공개된 축제 없음' })
  get(@CurrentUser() user: AuthUser, @Param('festivalId') festivalId: string) {
    return this.service.get(user.userId, festivalId);
  }
}
