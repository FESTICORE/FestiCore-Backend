import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

/** Provider별 모바일 로그인 경로의 공통 요청 본문. */
export class ProviderLoginDto {
  @IsString()
  @IsNotEmpty()
  token!: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  authorizationCode?: string;
}
