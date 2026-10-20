import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class RefreshDto {
  @ApiProperty({
    description:
      'FestiCore 로그인 또는 직전 재발급 응답의 refreshToken. 한 번 사용하면 폐기되므로 새 응답의 refreshToken으로 교체해야 합니다.',
    example: '<FestiCore refresh token>',
  })
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}
