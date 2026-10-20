import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * 개발 전용 로그인 요청.
 * 소셜 검증 없이 고정 식별자(key)로 사용자를 find-or-create 해 토큰을 발급한다.
 * 운영 환경에서는 사용할 수 없다.
 */
export class DevLoginDto {
  @ApiPropertyOptional({
    description:
      '개발용 사용자 식별 키. 같은 key로 호출하면 같은 계정으로 로그인된다.',
    default: 'default',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  key?: string;

  @ApiPropertyOptional({ description: '닉네임(미지정 시 key로 대체)' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  nickname?: string;

  @ApiPropertyOptional({ description: '이메일(선택)' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  email?: string;
}
