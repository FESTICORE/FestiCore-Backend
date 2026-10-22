import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsUUID } from 'class-validator';
import type { TestPushType } from '../../notification/apns.service';

export class TestPushDto {
  @ApiProperty({
    description:
      '서버에 등록된 테스트 대상 기기 UUID v4. APNs 토큰은 요청으로 받지 않습니다.',
    format: 'uuid',
    example: '1f0d7050-9b11-4099-84b5-7d71e31f8850',
  })
  @IsUUID('4')
  deviceId!: string;

  @ApiProperty({
    description: '검증할 APNs 푸시 유형. pack.updated는 사일런트 푸시입니다.',
    enum: ['flag.status', 'crew.status', 'crew.gather', 'pack.updated'],
    example: 'pack.updated',
  })
  @IsIn(['flag.status', 'crew.status', 'crew.gather', 'pack.updated'])
  type!: TestPushType;
}
