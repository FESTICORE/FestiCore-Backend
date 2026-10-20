import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import type { SocialProvider } from '../types/social-profile';

export class SocialLoginDto {
  @ApiProperty({ enum: ['google', 'apple'], description: '소셜 provider' })
  @IsIn(['google', 'apple'])
  provider!: SocialProvider;

  @ApiProperty({
    description: 'provider 자격증명 (Google idToken / Apple identityToken)',
  })
  @IsString()
  @IsNotEmpty()
  token!: string;

  @ApiPropertyOptional({
    description: 'Apple 최초 로그인 시 전달되는 사용자 이름',
  })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  name?: string;

  @ApiPropertyOptional({
    description:
      'provider authorization code (Apple authorizationCode / Google serverAuthCode). ' +
      '전달 시 refresh 토큰을 발급받아 저장하며, 회원 탈퇴 시 연동 해제(revoke)에 사용한다. ' +
      'Apple 은 탈퇴 시 revoke 가 필수(App Store 5.1.1)라 apple 로그인에서는 필수.',
  })
  // apple 은 필수, google 은 선택.
  @ValidateIf(
    (o: SocialLoginDto) =>
      o.provider === 'apple' || o.authorizationCode !== undefined,
  )
  @IsString()
  @IsNotEmpty()
  authorizationCode?: string;
}
