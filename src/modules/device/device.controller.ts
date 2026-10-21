import {
  Body,
  Controller,
  Delete,
  Headers,
  HttpCode,
  Param,
  Put,
} from '@nestjs/common';
import {
  ApiBody,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../auth/decorator/public.decorator';
import {
  DeviceSubscriptionDto,
  LiveActivityDto,
  RegisterDeviceDto,
} from './device.dto';
import { DeviceService } from './device.service';

@ApiTags('Devices')
@Public()
@Controller('devices')
@ApiHeader({
  name: 'X-Device-Secret',
  required: false,
  description:
    '첫 등록 시 응답으로 받은 비밀값. 이후 모든 기기 변경 요청에 필수입니다.',
})
@ApiHeader({
  name: 'Authorization',
  required: false,
  description:
    '선택: Bearer access JWT. 로그인 계정에 기기를 연결할 때 보냅니다.',
})
@ApiParam({
  name: 'deviceId',
  description: 'Keychain에 보관한 UUID v4 기기 ID',
})
export class DeviceController {
  constructor(private readonly service: DeviceService) {}

  @Put(':deviceId')
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
        success: { type: 'boolean', example: true },
        statusCode: { type: 'integer', example: 200 },
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
                },
              },
            },
          },
        },
        message: { type: 'string' },
      },
    },
  })
  async register(
    @Param('deviceId') id: string,
    @Body() body: RegisterDeviceDto,
    @Headers('authorization') auth?: string,
    @Headers('x-device-secret') secret?: string,
  ) {
    return this.service.register(
      id,
      body,
      await this.service.optionalUser(auth),
      secret,
    );
  }

  @Put(':deviceId/live-activity')
  @HttpCode(204)
  @ApiOperation({ summary: 'Live Activity 토큰 등록 또는 교체' })
  @ApiBody({ type: LiveActivityDto })
  @ApiResponse({ status: 204, description: '등록됨' })
  async startLiveActivity(
    @Param('deviceId') id: string,
    @Body() body: LiveActivityDto,
    @Headers('authorization') auth?: string,
    @Headers('x-device-secret') secret?: string,
  ) {
    await this.service.startLiveActivity(
      id,
      body,
      await this.service.optionalUser(auth),
      secret,
    );
  }

  @Delete(':deviceId/live-activity')
  @HttpCode(204)
  @ApiOperation({ summary: 'Live Activity 토큰 삭제' })
  @ApiResponse({ status: 204, description: '삭제됨' })
  async stopLiveActivity(
    @Param('deviceId') id: string,
    @Headers('authorization') auth?: string,
    @Headers('x-device-secret') secret?: string,
  ) {
    await this.service.stopLiveActivity(
      id,
      await this.service.optionalUser(auth),
      secret,
    );
  }

  @Put(':deviceId/subscriptions/:festivalId')
  @ApiOperation({ summary: '축제 팩 변경 알림 구독 설정' })
  @ApiParam({ name: 'festivalId', description: '발행된 축제 ID' })
  @ApiBody({ type: DeviceSubscriptionDto })
  @ApiResponse({ status: 200, description: '축제 ID와 packUpdates 설정' })
  async subscribe(
    @Param('deviceId') id: string,
    @Param('festivalId') festivalId: string,
    @Body() body: DeviceSubscriptionDto,
    @Headers('authorization') auth?: string,
    @Headers('x-device-secret') secret?: string,
  ) {
    return this.service.subscribe(
      id,
      festivalId,
      body,
      await this.service.optionalUser(auth),
      secret,
    );
  }
}
