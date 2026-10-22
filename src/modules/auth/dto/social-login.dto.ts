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
  @ApiProperty({
    enum: ['google', 'apple'],
    description:
      '로그인 제공자. Google 웹·앱은 google, Apple 앱은 apple을 사용합니다.',
    example: 'google',
  })
  @IsIn(['google', 'apple'])
  provider!: SocialProvider;

  @ApiProperty({
    description:
      '제공자가 발급한 ID 토큰. Google 웹·앱은 Google ID token, Apple 앱은 identity token을 넣습니다. 자체 access token이나 authorization code를 넣지 마세요.',
    example: '<Google ID token 또는 Apple identity token>',
  })
  @IsString()
  @IsNotEmpty()
  token!: string;

  @ApiPropertyOptional({
    description:
      'Apple 첫 로그인에서만 받을 수 있는 사용자 이름(최대 30자). 이후 로그인이나 Google 로그인에서는 생략합니다.',
    example: '축제관객',
  })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  name?: string;

  @ApiPropertyOptional({
    description:
      '제공자의 일회용 인가 코드. Apple 로그인에서는 authorizationCode가 필수이며, Google은 serverAuthCode가 있을 때 전달합니다. ' +
      '서버가 제공자 refresh token으로 교환해 저장하고 회원 탈퇴 때 연동 해제에 사용합니다. ID 토큰과 혼동하지 마세요.',
    example: '<Apple authorization code 또는 Google server auth code>',
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
