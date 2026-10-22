import { Body, Controller, Delete, Get, HttpCode, Patch } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { CurrentUser } from '../decorator/current-user.decorator';
import { AuthService } from '../service/auth.service';
import type { AuthUser } from '../types/social-profile';

class AcceptTermsDto {
  @ApiProperty({ description: '동의한 필수 약관 버전', example: '2026-10' })
  @IsString()
  @MinLength(1)
  version!: string;
}

class UpdateMeDto {
  @ApiProperty({
    description: '변경할 닉네임',
    example: '축제관객',
    minLength: 1,
    maxLength: 12,
    required: false,
  })
  @IsString()
  @IsOptional()
  @MinLength(1)
  @MaxLength(12)
  nickname?: string;

  @ApiProperty({
    description: '필수 약관 2개 동의',
    required: false,
    type: AcceptTermsDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => AcceptTermsDto)
  acceptTerms?: AcceptTermsDto;

  @ApiProperty({
    description: '선택 알림 수신 동의',
    required: false,
    type: Boolean,
  })
  @IsOptional()
  @IsBoolean()
  pushOptIn?: boolean;
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
    summary: '가입 정보 및 내 프로필 수정',
    description:
      '닉네임 확정, 필수 약관 2개 동의 및 선택 알림 수신 여부를 한 번에 저장합니다.',
  })
  @ApiResponse({ status: 200, description: '변경된 사용자 정보' })
  @ApiResponse({
    status: 400,
    description: '본문 형식이 잘못되었거나 닉네임 길이가 1~12자가 아님',
  })
  @ApiResponse({
    status: 422,
    description: 'TERMS_VERSION_OUTDATED: 현재 약관 버전과 다름',
  })
  @ApiResponse({
    status: 401,
    description: 'access 토큰이 없거나 유효하지 않음',
  })
  update(@CurrentUser() user: AuthUser, @Body() body: UpdateMeDto) {
    return this.auth.updateMe(user.userId, body);
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
