import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Put,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  ApiBody,
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorator/current-user.decorator';
import type { AuthUser } from '../auth/types/social-profile';
import { LiveActivityDto, RegisterDeviceDto } from './device.dto';
import { DeviceService } from './device.service';

@ApiTags('Devices')
@Controller('devices')
@ApiBearerAuth()
@ApiHeader({
  name: 'X-Device-Id',
  required: true,
  description: 'Keychain에 보관한 UUID v4 기기 ID. 기기 API에서만 사용합니다.',
})
export class DeviceController {
  constructor(private readonly service: DeviceService) {}

  @Put()
  @ApiOperation({
    summary: '기기 등록 또는 토큰 갱신',
    description:
      'Bearer access JWT 사용자와 X-Device-Id의 소유자가 일치해야 합니다. 계정을 바꾸려면 이전 계정에서 기기를 삭제한 뒤 다시 등록하세요.',
  })
  @ApiBody({ type: RegisterDeviceDto })
  @ApiResponse({
    status: 200,
    description: '기기 ID, 연결된 사용자 ID와 축제 구독',
    schema: {
      type: 'object',
      properties: {
        code: { type: 'string', example: 'SUCCESS' },
        data: {
          type: 'object',
          properties: {
            deviceId: { type: 'string', format: 'uuid' },
            userId: { type: 'string', format: 'uuid' },
            subscriptions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  festivalId: { type: 'string' },
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
  async register(
    @Body() body: RegisterDeviceDto,
    @Req() request: Request,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.register(this.deviceId(request), body, user.userId);
  }

  @Get()
  @ApiOperation({ summary: '현재 기기 등록 상태 조회' })
  @ApiResponse({
    status: 200,
    description: '푸시 토큰을 제외한 기기 정보',
    schema: {
      type: 'object',
      properties: {
        code: { type: 'string', example: 'SUCCESS' },
        data: {
          type: 'object',
          properties: {
            deviceId: { type: 'string', format: 'uuid' },
            userId: { type: 'string', format: 'uuid' },
            appVersion: { type: 'string', example: '1.0.0' },
            osVersion: { type: 'string', example: '18.0' },
            locale: { type: 'string', example: 'ko-KR' },
            timezone: { type: 'string', example: 'Asia/Seoul' },
            apnsEnvironment: {
              type: 'string',
              enum: ['sandbox', 'production'],
            },
          },
        },
        message: { type: 'string', example: '성공적으로 처리되었습니다.' },
      },
    },
  })
  async get(@Req() request: Request, @CurrentUser() user: AuthUser) {
    return this.service.get(this.deviceId(request), user.userId);
  }

  @Delete()
  @HttpCode(204)
  @ApiOperation({ summary: '현재 기기와 모든 알림 구독 삭제' })
  @ApiResponse({ status: 204, description: '삭제됨' })
  async remove(@Req() request: Request, @CurrentUser() user: AuthUser) {
    await this.service.remove(this.deviceId(request), user.userId);
  }

  @Put('live-activity')
  @HttpCode(204)
  @ApiOperation({ summary: 'Live Activity 토큰 등록 또는 교체' })
  @ApiBody({ type: LiveActivityDto })
  @ApiResponse({ status: 204, description: '등록됨' })
  async startLiveActivity(
    @Body() body: LiveActivityDto,
    @Req() request: Request,
    @CurrentUser() user: AuthUser,
  ) {
    await this.service.startLiveActivity(
      this.deviceId(request),
      body,
      user.userId,
    );
  }

  @Delete('live-activity')
  @HttpCode(204)
  @ApiOperation({ summary: 'Live Activity 토큰 삭제' })
  @ApiResponse({ status: 204, description: '삭제됨' })
  async stopLiveActivity(
    @Req() request: Request,
    @CurrentUser() user: AuthUser,
  ) {
    await this.service.stopLiveActivity(this.deviceId(request), user.userId);
  }

  private deviceId(request: Request): string {
    return request.header('x-device-id') ?? '';
  }
}
