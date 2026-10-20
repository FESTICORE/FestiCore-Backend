import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/** Provider별 모바일 로그인 경로의 공통 요청 본문. */
export class ProviderLoginDto {
  @IsString()
  @IsNotEmpty()
  token!: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  name?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  authorizationCode?: string;
}
