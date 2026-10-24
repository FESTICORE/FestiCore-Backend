import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RevokeSessionDto {
  @ApiProperty({
    description: '폐기할 현재 세션의 FestiCore refresh 토큰',
    example: '<FestiCore refresh token>',
    maxLength: 4096,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  refreshToken!: string;
}
