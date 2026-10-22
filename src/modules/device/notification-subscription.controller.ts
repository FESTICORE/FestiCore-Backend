import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Put,
  Req,
  UseGuards,
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
import { Public } from '../auth/decorator/public.decorator';
import { DeviceAuthGuard, type DeviceRequest } from './device-auth.guard';
import { DeviceSubscriptionDto, PackDownloadDto } from './device.dto';
import { DeviceService } from './device.service';

@ApiTags('Notifications')
@Controller('notifications/subscriptions')
@Public()
@UseGuards(DeviceAuthGuard)
@ApiBearerAuth()
@ApiHeader({
  name: 'X-Device-Id',
  required: true,
  description: 'Keychain에 보관한 UUID v4 기기 ID',
})
export class NotificationSubscriptionController {
  constructor(private readonly devices: DeviceService) {}

  @Get()
  @ApiOperation({
    summary: '현재 기기의 축제 알림 구독 목록',
    description:
      '계정 Bearer 또는 최초 기기 등록 시 받은 deviceAccessToken과 X-Device-Id가 필요합니다.',
  })
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
  async list(@Req() request: DeviceRequest) {
    return this.devices.listSubscriptions(
      this.deviceId(request),
      request.devicePrincipal,
    );
  }

  @Put(':festivalId')
  @ApiOperation({
    summary: '축제 핀 및 알림 설정',
    description:
      'pinned는 필수입니다. pinned=false도 행을 보존합니다. reminders 기본값은 true, packUpdates 기본값은 false입니다.',
  })
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
      (request as DeviceRequest).devicePrincipal,
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
      (request as DeviceRequest).devicePrincipal,
    );
  }

  @Put(':festivalId/pack-download')
  @HttpCode(204)
  @ApiOperation({
    summary: '기기에 저장된 팩 버전 확인',
    description:
      '현재 발행된 팩 버전과 같을 때만 기록합니다. D-1 알림의 팩 다운로드 안내 여부에 사용됩니다.',
  })
  @ApiBody({ type: PackDownloadDto })
  @ApiResponse({ status: 204, description: '기록됨' })
  async acknowledgePackDownload(
    @Param('festivalId') festivalId: string,
    @Body() body: PackDownloadDto,
    @Req() request: DeviceRequest,
  ) {
    await this.devices.acknowledgePackDownload(
      this.deviceId(request),
      festivalId,
      body,
      request.devicePrincipal,
    );
  }

  private deviceId(request: Request): string {
    return request.header('x-device-id') ?? '';
  }
}
