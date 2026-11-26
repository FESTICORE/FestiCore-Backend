import { Body, Controller, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBody,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { AdminRequest } from '../auth/admin-session.guard';
import { AdminRoles } from '../auth/admin-roles.decorator';
import { TestPushDto } from './admin-push.dto';
import { AdminPushService } from './admin-push.service';

@ApiTags('Admin Push')
@ApiBearerAuth()
@Controller('admin/push')
export class AdminPushController {
  constructor(private readonly service: AdminPushService) {}

  @Post('test')
  @AdminRoles('editor')
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @ApiOperation({
    summary: '등록 기기 테스트 푸시',
    description:
      'Bearer JWT, editor 이상 관리자 권한과 허용된 Origin이 필요합니다. 등록 기기의 platform에 맞춰 iOS는 APNs 토큰과 환경, Android는 FCM 토큰으로 선택한 PushType을 한 기기에 한 번 보냅니다. 자유 입력 메시지와 토큰은 받지 않으며 전송 요청을 감사 기록에 남깁니다.',
  })
  @ApiBody({ type: TestPushDto })
  @ApiResponse({
    status: 201,
    description:
      '푸시 전송 결과. accepted는 APNs · FCM 수락 여부이며 실제 기기 표시를 보장하지 않습니다.',
    schema: {
      example: {
        code: 'SUCCESS',
        data: {
          deviceId: '1f0d7050-9b11-4099-84b5-7d71e31f8850',
          type: 'pack.updated',
          accepted: true,
          reason: null,
        },
        message: '성공적으로 처리되었습니다.',
      },
    },
  })
  @ApiResponse({ status: 400, description: '기기 ID 또는 푸시 유형 검증 오류' })
  @ApiResponse({ status: 401, description: '유효한 access JWT가 없습니다.' })
  @ApiResponse({
    status: 403,
    description: 'editor 권한 또는 요청 출처 불일치',
  })
  @ApiResponse({ status: 404, description: '등록 기기 없음' })
  @ApiResponse({
    status: 409,
    description: '기기 푸시 토큰 없음(iOS APNs 토큰 · 환경, Android FCM 토큰)',
  })
  @ApiResponse({ status: 429, description: '분당 전송 제한 초과' })
  @ApiResponse({
    status: 503,
    description: '기기 platform의 발송 설정 없음(APNs 또는 FCM)',
  })
  sendTest(@Body() body: TestPushDto, @Req() request: AdminRequest) {
    return this.service.sendTest(body, request.admin?.id ?? null);
  }
}
