import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Put,
  Req,
  SetMetadata,
  UseGuards,
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
import { Public } from '../auth/decorator/public.decorator';
import {
  ALLOW_ANONYMOUS_DEVICE_REGISTRATION,
  DeviceAuthGuard,
  type DeviceRequest,
} from './device-auth.guard';
import { LiveActivityDto, RegisterDeviceDto } from './device.dto';
import { DeviceService } from './device.service';

@ApiTags('Devices')
@Controller('devices')
@Public()
@UseGuards(DeviceAuthGuard)
@ApiBearerAuth()
@ApiHeader({
  name: 'X-Device-Id',
  required: true,
  description: 'Keychain에 보관한 UUID v4 기기 ID. 기기 API에서만 사용합니다.',
})
export class DeviceController {
  constructor(private readonly service: DeviceService) {}

  @Put()
  @SetMetadata(ALLOW_ANONYMOUS_DEVICE_REGISTRATION, true)
  @ApiOperation({
    summary: '기기 등록 또는 토큰 갱신',
    description:
      '처음 등록하는 UUID v4 기기는 Bearer 없이 요청할 수 있습니다. 응답의 deviceAccessToken을 안전하게 저장하고 이후 Authorization: Bearer와 X-Device-Id를 함께 전송하세요. 등록된 기기를 UUID만으로 갱신할 수 없습니다. 계정 기기는 계정 Bearer로 등록합니다.',
  })
  @ApiBody({ type: RegisterDeviceDto })
  @ApiResponse({
    status: 200,
    description:
      '기기 ID, 선택적 사용자 ID, 익명 기기 전용 deviceAccessToken과 축제 구독',
    schema: {
      type: 'object',
      properties: {
        code: { type: 'string', example: 'SUCCESS' },
        data: {
          type: 'object',
          properties: {
            deviceId: { type: 'string', format: 'uuid' },
            userId: { type: 'string', format: 'uuid' },
            deviceAccessToken: {
              type: 'string',
              description:
                '익명 기기 등록·갱신 시 발급. 갱신 전 토큰도 만료 전까지 유효합니다.',
            },
            subscriptions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  festivalId: { type: 'string' },
                  packUpdates: { type: 'boolean' },
                  festivalStarts: { type: 'boolean' },
                  pinned: { type: 'boolean' },
                  reminders: { type: 'boolean' },
                  pinnedAt: {
                    type: 'string',
                    format: 'date-time',
                    nullable: true,
                  },
                },
              },
            },
          },
        },
        message: { type: 'string', example: '성공적으로 처리되었습니다.' },
      },
    },
  })
  async register(@Body() body: RegisterDeviceDto, @Req() request: Request) {
    return this.service.register(
      this.deviceId(request),
      body,
      (request as DeviceRequest).devicePrincipal,
    );
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
  async get(@Req() request: DeviceRequest) {
    return this.service.get(this.deviceId(request), request.devicePrincipal);
  }

  @Delete()
  @HttpCode(204)
  @ApiOperation({ summary: '현재 기기와 모든 알림 구독 삭제' })
  @ApiResponse({ status: 204, description: '삭제됨' })
  async remove(@Req() request: DeviceRequest) {
    await this.service.remove(this.deviceId(request), request.devicePrincipal);
  }

  @Put('live-activity')
  @HttpCode(204)
  @ApiOperation({ summary: 'Live Activity 토큰 등록 또는 교체' })
  @ApiBody({ type: LiveActivityDto })
  @ApiResponse({ status: 204, description: '등록됨' })
  async startLiveActivity(
    @Body() body: LiveActivityDto,
    @Req() request: Request,
  ) {
    await this.service.startLiveActivity(
      this.deviceId(request),
      body,
      (request as DeviceRequest).devicePrincipal,
    );
  }

  @Delete('live-activity')
  @HttpCode(204)
  @ApiOperation({ summary: 'Live Activity 토큰 삭제' })
  @ApiResponse({ status: 204, description: '삭제됨' })
  async stopLiveActivity(@Req() request: Request) {
    await this.service.stopLiveActivity(
      this.deviceId(request),
      (request as DeviceRequest).devicePrincipal,
    );
  }

  private deviceId(request: Request): string {
    return request.header('x-device-id') ?? '';
  }
}
