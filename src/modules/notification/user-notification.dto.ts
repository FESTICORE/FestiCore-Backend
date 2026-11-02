import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  Equals,
  IsArray,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

const NOTIFICATION_ID = /^ntf_[0-9a-f]{32}$/;
const FESTIVAL_ID = /^fst_[0-9a-z]{1,28}$/;

export class MarkNotificationsReadDto {
  @ApiPropertyOptional({
    type: [String],
    example: ['ntf_0123456789abcdef0123456789abcdef'],
    description: '읽음 처리할 알림 ID 1~100개. all과 함께 보낼 수 없습니다.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @Matches(NOTIFICATION_ID, { each: true })
  ids?: string[];

  @ApiPropertyOptional({
    example: true,
    description: 'true면 내 알림 전체(또는 festivalId 범위)를 읽음 처리합니다.',
  })
  @IsOptional()
  @Equals(true)
  all?: true;

  @ApiPropertyOptional({
    example: 'fst_2026',
    description: 'all=true일 때만 사용하는 축제 범위',
  })
  @IsOptional()
  @Matches(FESTIVAL_ID)
  festivalId?: string;
}

export class DeleteNotificationsDto {
  @ApiProperty({
    type: [String],
    example: ['ntf_0123456789abcdef0123456789abcdef'],
    description:
      '삭제할 내 알림 ID 1~100개. 다른 사용자의 ID나 없는 ID는 무시합니다.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @Matches(NOTIFICATION_ID, { each: true })
  ids!: string[];
}
