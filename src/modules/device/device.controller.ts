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
  ApiHeader,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../auth/decorator/public.decorator';
import { LiveActivityDto, RegisterDeviceDto } from './device.dto';
import { DeviceService } from './device.service';

@ApiTags('Devices')
@Public()
@Controller('devices')
@ApiHeader({
  name: 'X-Device-Id',
  required: true,
  description: 'Keychain에 보관한 UUID v4 기기 ID. 기기 API에서만 사용합니다.',
})
@ApiHeader({
  name: 'X-Device-Secret',
  required: false,
  description:
    '첫 등록 시 한 번 발급되는 비밀값. 기존 기기의 변경 요청에 필수입니다.',
})
@ApiHeader({
  name: 'Authorization',
  required: false,
  description:
    '선택: Bearer access JWT. 로그인 계정에 기기를 연결할 때 보냅니다.',
})
export class DeviceController {
  constructor(private readonly service: DeviceService) {}

  @Put()
  @ApiOperation({
    summary: '기기 등록 또는 토큰 갱신',
    description:
      '최초 등록 응답의 deviceSecret은 한 번만 반환됩니다. Keychain에 저장하고 이후 X-Device-Secret 헤더로 보내세요. 계정 변경 시에도 기기 비밀값을 확인합니다.',
  })
  @ApiBody({ type: RegisterDeviceDto })
  @ApiResponse({
    status: 200,
    description:
      '기기 ID, 연결된 사용자 ID, 축제 구독 및 최초 등록 시 deviceSecret',
    schema: {
      type: 'object',
      properties: {
        code: { type: 'string', example: 'SUCCESS' },
        data: {
          type: 'object',
          properties: {
            deviceId: { type: 'string', format: 'uuid' },
            userId: { type: 'string', format: 'uuid', nullable: true },
            deviceSecret: {
              type: 'string',
              description: '첫 등록 응답에만 포함되는 64자 hex 비밀값',
            },
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
  async register(@Body() body: RegisterDeviceDto, @Req() request: Request) {
    return this.service.register(
      this.deviceId(request),
      body,
      await this.service.optionalUser(request.header('authorization')),
      request.header('x-device-secret'),
    );
  }

  @Get()
  @ApiOperation({ summary: '현재 기기 등록 상태 조회' })
  @ApiResponse({
    status: 200,
    description: '비밀값과 푸시 토큰을 제외한 기기 정보',
  })
  async get(@Req() request: Request) {
    return this.service.get(
      this.deviceId(request),
      await this.service.optionalUser(request.header('authorization')),
      request.header('x-device-secret'),
    );
  }

  @Delete()
  @HttpCode(204)
  @ApiOperation({ summary: '현재 기기와 모든 알림 구독 삭제' })
  @ApiResponse({ status: 204, description: '삭제됨' })
  async remove(@Req() request: Request) {
    await this.service.remove(
      this.deviceId(request),
      await this.service.optionalUser(request.header('authorization')),
      request.header('x-device-secret'),
    );
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
      await this.service.optionalUser(request.header('authorization')),
      request.header('x-device-secret'),
    );
  }

  @Delete('live-activity')
  @HttpCode(204)
  @ApiOperation({ summary: 'Live Activity 토큰 삭제' })
  @ApiResponse({ status: 204, description: '삭제됨' })
  async stopLiveActivity(@Req() request: Request) {
    await this.service.stopLiveActivity(
      this.deviceId(request),
      await this.service.optionalUser(request.header('authorization')),
      request.header('x-device-secret'),
    );
  }

  private deviceId(request: Request): string {
    return request.header('x-device-id') ?? '';
  }
}
