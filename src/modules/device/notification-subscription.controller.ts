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
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../auth/decorator/public.decorator';
import { DeviceSubscriptionDto } from './device.dto';
import { DeviceService } from './device.service';

@ApiTags('Notifications')
@Public()
@Controller('notifications/subscriptions')
@ApiHeader({
  name: 'X-Device-Id',
  required: true,
  description: 'Keychain에 보관한 UUID v4 기기 ID',
})
@ApiHeader({
  name: 'X-Device-Secret',
  required: true,
  description: '최초 기기 등록 시 발급된 비밀값',
})
@ApiHeader({
  name: 'Authorization',
  required: false,
  description: '선택: Bearer access JWT',
})
export class NotificationSubscriptionController {
  constructor(private readonly devices: DeviceService) {}

  @Get()
  @ApiOperation({ summary: '현재 기기의 축제 알림 구독 목록' })
  @ApiResponse({ status: 200, description: '축제 시작·팩 변경 알림 설정 목록' })
  async list(@Req() request: Request) {
    return this.devices.listSubscriptions(
      this.deviceId(request),
      await this.devices.optionalUser(request.header('authorization')),
      request.header('x-device-secret'),
    );
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
  ) {
    return this.devices.subscribe(
      this.deviceId(request),
      festivalId,
      body,
      await this.devices.optionalUser(request.header('authorization')),
      request.header('x-device-secret'),
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
  ) {
    await this.devices.unsubscribe(
      this.deviceId(request),
      festivalId,
      await this.devices.optionalUser(request.header('authorization')),
      request.header('x-device-secret'),
    );
  }

  private deviceId(request: Request): string {
    return request.header('x-device-id') ?? '';
  }
}
