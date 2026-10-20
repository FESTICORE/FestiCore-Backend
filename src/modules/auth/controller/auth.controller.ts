import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DevLoginDto } from '../dto/dev-login.dto';
import { RefreshDto } from '../dto/refresh.dto';
import { SocialLoginDto } from '../dto/social-login.dto';
import { CurrentUser } from '../decorator/current-user.decorator';
import { Public } from '../decorator/public.decorator';
import { AuthService } from '../service/auth.service';
import type { AuthUser } from '../types/social-profile';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '소셜 로그인/가입 (Google·Apple 통합)' })
  login(@Body() dto: SocialLoginDto) {
    return this.authService.login(dto);
  }

  @Public()
  @Post('dev/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '[개발 전용] 소셜 검증 없이 토큰 발급',
    description:
      'DEV_LOGIN_ENABLED=true 이고 production 환경이 아닐 때만 동작한다. ' +
      '같은 key로 호출하면 같은 계정으로 로그인된다.',
  })
  devLogin(@Body() dto: DevLoginDto) {
    if (!this.isDevLoginEnabled()) {
      throw new ForbiddenException('개발용 로그인이 비활성화되어 있습니다.');
    }
    return this.authService.devLogin(dto);
  }

  /**
   * dev 로그인 허용 여부.
   * 1) DEV_LOGIN_ENABLED=true 명시가 필수
   * 2) Railway production 환경이면 항상 거부
   * 3) NODE_ENV=production 이면 Railway develop 환경일 때만 허용
   */
  private isDevLoginEnabled(): boolean {
    if (this.config.get<string>('DEV_LOGIN_ENABLED') !== 'true') return false;
    const railwayEnv = this.config.get<string>('RAILWAY_ENVIRONMENT_NAME');
    if (railwayEnv === 'production') return false;
    return (
      this.config.get<string>('NODE_ENV') !== 'production' ||
      railwayEnv === 'develop'
    );
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
