import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { RefreshDto } from '../dto/refresh.dto';
import { RevokeSessionDto } from '../dto/revoke-session.dto';
import { SocialLoginDto } from '../dto/social-login.dto';
import { CurrentUser } from '../decorator/current-user.decorator';
import { Public } from '../decorator/public.decorator';
import { AuthService } from '../service/auth.service';
import type { AuthUser } from '../types/social-profile';
import { Throttle } from '@nestjs/throttler';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '소셜 로그인/가입 (Google·Apple 통합)',
    description:
      '웹과 iOS 모두 이 경로를 사용합니다. Google은 ID 토큰을, Apple은 identity token과 authorization code를 보냅니다. 새 사용자면 계정을 만듭니다.',
  })
  @ApiBody({
    type: SocialLoginDto,
    examples: {
      google: {
        summary: 'Google 웹·앱',
        value: { provider: 'google', token: '<Google ID token>' },
      },
      apple: {
        summary: 'Apple 웹·앱',
        value: {
          provider: 'apple',
          token: '<Apple identity token>',
          authorizationCode: '<Apple authorization code>',
          name: '축제관객',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: '앱 access/refresh 토큰과 새 사용자 여부',
  })
  @ApiResponse({
    status: 400,
    description: 'provider 또는 필수 토큰/Apple 코드 누락',
  })
  @ApiResponse({ status: 401, description: '소셜 자격증명 검증 실패' })
  login(@Body() dto: SocialLoginDto) {
    if (dto.provider === 'apple' && !dto.authorizationCode) {
      throw new BadRequestException('Apple authorizationCode가 필요합니다.');
    }
    return this.authService.login(dto);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'access/refresh 토큰 재발급 (회전)',
    description:
      '본문의 refresh 토큰을 한 번만 사용하고 새 access/refresh 토큰을 발급합니다. 이전 refresh 토큰은 즉시 폐기됩니다.',
  })
  @ApiBody({ type: RefreshDto })
  @ApiResponse({ status: 200, description: '새 access/refresh 토큰' })
  @ApiResponse({
    status: 401,
    description: 'refresh 토큰이 만료·폐기·재사용됨',
  })
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Public()
  @Post('session/revoke')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @ApiOperation({
    summary: '제시된 refresh 세션 폐기',
    description:
      'access 토큰 없이 refreshToken으로 해당 세션만 폐기합니다. 이미 회전되거나 만료된 서명 유효 토큰도 같은 세션의 후속 토큰을 폐기합니다. 계정의 다른 웹·iOS 세션은 변경하지 않습니다. 웹과 iOS가 공용 로그인 경로를 사용하므로 토큰 자체에는 플랫폼 구분이 없습니다. 클라이언트는 자신이 보유한 세션 토큰만 전달하고 이후 도착한 재발급 결과를 저장하지 않아야 합니다. 이미 발급된 access 토큰은 만료까지 유효합니다.',
  })
  @ApiBody({ type: RevokeSessionDto })
  @ApiResponse({
    status: 204,
    description: '세션 폐기 완료 또는 유효하지 않거나 이미 폐기된 토큰',
  })
  @ApiResponse({ status: 400, description: '본문 형식 오류' })
  @ApiResponse({ status: 429, description: '요청 빈도 제한' })
  async revokeSession(@Body() dto: RevokeSessionDto): Promise<void> {
    await this.authService.revokeSession(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '로그아웃 (refresh 토큰 폐기 및 계정 기기 알림 해제)',
    description:
      '계정의 refresh 토큰을 모두 폐기하고 이 계정에 연결된 모든 기기의 푸시 토큰과 알림 설정을 해제합니다. 익명 기기와 다른 계정의 기기는 변경하지 않습니다. 이미 발급된 access 토큰은 만료까지 유효합니다.',
  })
  @ApiResponse({ status: 200, description: '{ success: true }' })
  @ApiResponse({
    status: 401,
    description: '앱 access 토큰이 없거나 유효하지 않음',
  })
  async logout(@CurrentUser() user: AuthUser) {
    await this.authService.logout(user.userId);
    return { success: true };
  }
}
