import { Body, Controller, Delete, Get, HttpCode, Patch } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { CurrentUser } from '../decorator/current-user.decorator';
import { AuthService } from '../service/auth.service';
import type { AuthUser } from '../types/social-profile';

class UpdateMeDto {
  @ApiProperty({
    description: '변경할 닉네임',
    example: '축제관객',
    minLength: 1,
    maxLength: 12,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(12)
  nickname!: string;
}

@ApiTags('Me')
@ApiBearerAuth()
@Controller('me')
export class MeController {
  constructor(private readonly auth: AuthService) {}

  @Get()
  @ApiOperation({
    summary: '내 프로필 조회',
    description:
      '현재 access 토큰의 사용자 정보와 활성 관리자 권한(admin: {id, role} 또는 null)을 조회합니다.',
  })
  @ApiResponse({ status: 200, description: '현재 사용자 정보' })
  @ApiResponse({
    status: 401,
    description: 'access 토큰이 없거나 유효하지 않음',
  })
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.userId);
  }

  @Patch()
  @ApiOperation({
    summary: '내 닉네임 변경',
    description:
      '현재 로그인한 사용자의 닉네임을 변경하고 변경된 사용자 정보를 반환합니다.',
  })
  @ApiResponse({ status: 200, description: '변경된 사용자 정보' })
  @ApiResponse({
    status: 400,
    description: '닉네임이 없거나 길이가 1~12자가 아님',
  })
  @ApiResponse({
    status: 401,
    description: 'access 토큰이 없거나 유효하지 않음',
  })
  update(@CurrentUser() user: AuthUser, @Body() body: UpdateMeDto) {
    return this.auth.updateMe(user.userId, body.nickname);
  }

  @Delete()
  @HttpCode(204)
  @ApiOperation({
    summary: '회원 탈퇴',
    description:
      '요청 본문 없이 현재 access 토큰의 계정과 refresh 토큰을 삭제합니다. 탈퇴 확인은 클라이언트 화면에서 처리합니다.',
  })
  @ApiResponse({ status: 204, description: '탈퇴 완료. 응답 본문 없음' })
  @ApiResponse({
    status: 401,
    description: 'access 토큰이 없거나 유효하지 않음',
  })
  async withdraw(@CurrentUser() user: AuthUser): Promise<void> {
    await this.auth.withdraw(user.userId);
  }
}
