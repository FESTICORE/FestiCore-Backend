import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RefreshDto } from '../dto/refresh.dto';
import { SocialLoginDto } from '../dto/social-login.dto';
import { CurrentUser } from '../decorator/current-user.decorator';
import { Public } from '../decorator/public.decorator';
import { AuthService } from '../service/auth.service';
import type { AuthUser } from '../types/social-profile';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '소셜 로그인/가입 (Google·Apple 통합)' })
  login(@Body() dto: SocialLoginDto) {
    if (dto.provider === 'apple' && !dto.authorizationCode) {
      throw new BadRequestException('Apple authorizationCode가 필요합니다.');
    }
    return this.authService.login(dto);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'access/refresh 토큰 재발급 (회전)' })
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '로그아웃 (refresh 토큰 전체 폐기)',
    description: '이미 발급된 access 토큰은 만료(JWT_ACCESS_TTL)까지 유효하다.',
  })
  async logout(@CurrentUser() user: AuthUser) {
    await this.authService.logout(user.userId);
    return { success: true };
  }

  @Delete('session')
  @HttpCode(HttpStatus.OK)
  async deleteSession(@CurrentUser() user: AuthUser) {
    await this.authService.logout(user.userId);
    return { success: true };
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: '현재 로그인 사용자 정보' })
  me(@CurrentUser() user: AuthUser) {
    return this.authService.me(user.userId);
  }

  @Delete('me')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '회원 탈퇴 (provider 연동 해제·계정·refresh 토큰 삭제)',
  })
  async withdraw(@CurrentUser() user: AuthUser) {
    await this.authService.withdraw(user.userId);
    return { success: true };
  }
}
