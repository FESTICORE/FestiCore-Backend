import {
  IsBoolean,
  IsDefined,
  IsIn,
  IsOptional,
  IsInt,
  Min,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const hexToken = /^(?:[0-9a-fA-F]{2}){1,128}$/;

export class RegisterDeviceDto {
  @ApiProperty({
    enum: ['sandbox', 'production'],
    description: '앱의 APNs entitlement 환경. Railway 배포 환경과 별개입니다.',
  })
  @IsIn(['sandbox', 'production'])
  apnsEnvironment!: 'sandbox' | 'production';

  @ApiProperty({
    nullable: true,
    example: 'a'.repeat(64),
    description: 'APNs 기기 토큰(hex). 알림 권한이 없으면 null',
  })
  @ValidateIf((_, value: unknown) => value !== null)
  @IsDefined()
  @Matches(hexToken)
  apnsToken!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    example: 'b'.repeat(64),
    description: 'iOS 17.2+ Live Activity 원격 시작 토큰(hex)',
  })
  @IsOptional()
  @Matches(hexToken)
  liveActivityPushToStartToken?: string | null;

  @ApiProperty({ example: '1.0.0' })
  @MaxLength(32)
  @Matches(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/)
  appVersion!: string;

  @ApiProperty({ example: '18.0' })
  @IsString()
  @MaxLength(64)
  osVersion!: string;

  @ApiProperty({ example: 'ko-KR' })
  @MaxLength(35)
  @Matches(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/)
  locale!: string;

  @ApiProperty({ example: 'Asia/Seoul' })
  @IsString()
  @MaxLength(64)
  timezone!: string;
}

export class LiveActivityDto {
  @ApiProperty({ example: 'fst_example' })
  @Matches(/^fst_[0-9a-z]+$/)
  festivalId!: string;

  @ApiProperty({ example: 'activity-123' })
  @IsString()
  @MaxLength(128)
  activityId!: string;

  @ApiProperty({
    example: 'c'.repeat(64),
    description: 'ActivityKit 업데이트 토큰(hex)',
  })
  @Matches(hexToken)
  pushToken!: string;
}

export class DeviceSubscriptionDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  pinned!: boolean;

  @ApiPropertyOptional({ example: true, default: true })
  @IsOptional()
  @IsBoolean()
  reminders?: boolean;

  @ApiProperty({ example: true, description: '축제 개최일 시작 알림' })
  @IsOptional()
  @IsBoolean()
  festivalStarts?: boolean;

  @ApiPropertyOptional({ example: false, default: false })
  @IsOptional()
  @IsBoolean()
  packUpdates?: boolean;
}

export class PackDownloadDto {
  @ApiProperty({ example: 1, minimum: 1 })
  @IsInt()
  @Min(1)
  packVersion!: number;
}

export class NotificationSettingsDto {
  @ApiPropertyOptional({ example: true, description: '팔로우한 깃발 이동' })
  @IsOptional()
  @IsBoolean()
  flagStatus?: boolean;

  @ApiPropertyOptional({ example: true, description: '크루원 상태' })
  @IsOptional()
  @IsBoolean()
  crewStatus?: boolean;

  @ApiPropertyOptional({ example: true, description: '크루 모여! 요청' })
  @IsOptional()
  @IsBoolean()
  crewGather?: boolean;

  @ApiPropertyOptional({
    example: true,
    description: '공연 10분 전. 서버 발송 기능 전까지 값만 저장합니다.',
  })
  @IsOptional()
  @IsBoolean()
  setReminders?: boolean;

  @ApiPropertyOptional({
    example: true,
    description: '귀가 알림. 서버 발송 기능 전까지 값만 저장합니다.',
  })
  @IsOptional()
  @IsBoolean()
  homecoming?: boolean;

  @ApiPropertyOptional({
    example: true,
    description: '팩 업데이트. 꺼지면 축제별 packUpdates 구독보다 우선합니다.',
  })
  @IsOptional()
  @IsBoolean()
  packUpdates?: boolean;
}
