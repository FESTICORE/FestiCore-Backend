import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';
import type { CrewState } from './crew.entity';

export class CreateCrewDto {
  @ApiProperty({ example: 'fst_2026', description: '발행된 축제 ID' })
  @IsString()
  @Length(1, 32)
  festivalId!: string;

  @ApiProperty({ example: '함께 즐겨요', minLength: 1, maxLength: 20 })
  @IsString()
  @Length(1, 20)
  name!: string;

  @ApiPropertyOptional({
    example: '로이',
    minLength: 1,
    maxLength: 12,
    description: '생략하면 계정 닉네임을 사용합니다.',
  })
  @IsOptional()
  @IsString()
  @Length(1, 12)
  nickname?: string;
}

export class JoinCrewDto {
  @ApiProperty({
    example: 'K7P2QX',
    description: '대소문자 구분 없는 6자리 초대 코드',
  })
  @IsString()
  @Matches(/^[A-HJ-NP-Za-hj-np-z2-9]{6}$/)
  inviteCode!: string;

  @ApiPropertyOptional({ example: '로이', minLength: 1, maxLength: 12 })
  @IsOptional()
  @IsString()
  @Length(1, 12)
  nickname?: string;
}

export class CrewStatusDto {
  @ApiPropertyOptional({
    example: 'zon_main',
    description: '축제에 등록된 존 ID. leaving 상태에서는 무시합니다.',
  })
  @IsOptional()
  @IsString()
  @Length(1, 32)
  zoneId?: string;

  @ApiPropertyOptional({
    enum: ['here', 'eating', 'toilet', 'leaving'],
    example: 'here',
  })
  @IsOptional()
  @IsIn(['here', 'eating', 'toilet', 'leaving'])
  state?: CrewState;

  @ApiProperty({
    example: '2026-10-21T01:00:00.000Z',
    description: '클라이언트 ISO 8601 시각. 서버 시각과 5분 이내여야 합니다.',
  })
  @IsISO8601({ strict: true })
  clientAt!: string;
}

export class CrewGatherDto {
  @ApiProperty({ example: 'zon_main', description: '집결할 축제 존 ID' })
  @IsString()
  @Length(1, 32)
  zoneId!: string;
}

export class RenameCrewDto {
  @ApiProperty({ example: '우리 크루', minLength: 1, maxLength: 20 })
  @IsString()
  @Length(1, 20)
  name!: string;
}

export class RenameCrewMemberDto {
  @ApiProperty({ example: '로이', minLength: 1, maxLength: 12 })
  @IsString()
  @Length(1, 12)
  nickname!: string;
}

export class TransferCrewDto {
  @ApiProperty({
    example: '00000000-0000-4000-8000-000000000002',
    description: '같은 크루의 멤버 ID',
  })
  @IsString()
  @Length(1, 36)
  toUserId!: string;
}
