import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
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
import type { Request } from 'express';
import { CurrentUser } from '../auth/decorator/current-user.decorator';
import type { AuthUser } from '../auth/types/social-profile';
import { DeviceSubscriptionDto } from './device.dto';
import { DeviceService } from './device.service';

@ApiTags('Notifications')
@Controller('notifications/subscriptions')
@ApiBearerAuth()
@ApiHeader({
  name: 'X-Device-Id',
  required: true,
  description: 'Keychain에 보관한 UUID v4 기기 ID',
})
export class NotificationSubscriptionController {
  constructor(private readonly devices: DeviceService) {}

  @Get()
  @ApiOperation({ summary: '현재 기기의 축제 알림 구독 목록' })
  @ApiResponse({
    status: 200,
    description: '축제 시작·팩 변경 알림 설정 목록',
    schema: {
      type: 'object',
      properties: {
        code: { type: 'string', example: 'SUCCESS' },
        data: {
          type: 'object',
          properties: {
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  festivalId: { type: 'string', example: 'fst_example' },
                  packUpdates: { type: 'boolean' },
                  festivalStarts: { type: 'boolean' },
                },
              },
            },
          },
        },
        message: { type: 'string', example: '성공적으로 처리되었습니다.' },
      },
    },
  })
  async list(@Req() request: Request, @CurrentUser() user: AuthUser) {
    return this.devices.listSubscriptions(this.deviceId(request), user.userId);
  }

  @Put(':festivalId')
  @ApiOperation({ summary: '축제 시작·팩 변경 알림 구독 설정' })
  @ApiParam({ name: 'festivalId', description: '발행된 축제 ID' })
  @ApiBody({ type: DeviceSubscriptionDto })
  @ApiResponse({ status: 200, description: '저장된 축제 알림 설정' })
  async subscribe(
    @Param('festivalId') festivalId: string,
    @Body() body: DeviceSubscriptionDto,
    @Req() request: Request,
    @CurrentUser() user: AuthUser,
  ) {
    return this.devices.subscribe(
      this.deviceId(request),
      festivalId,
      body,
      user.userId,
    );
  }

  @Delete(':festivalId')
  @HttpCode(204)
  @ApiOperation({ summary: '현재 기기의 축제 알림 구독 해제' })
  @ApiParam({ name: 'festivalId', description: '구독 해제할 축제 ID' })
  @ApiResponse({ status: 204, description: '삭제됨' })
  async unsubscribe(
    @Param('festivalId') festivalId: string,
    @Req() request: Request,
    @CurrentUser() user: AuthUser,
  ) {
    await this.devices.unsubscribe(
      this.deviceId(request),
      festivalId,
      user.userId,
    );
  }

  private deviceId(request: Request): string {
    return request.header('x-device-id') ?? '';
  }
}
