import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthController } from './controller/auth.controller';
import { RefreshToken } from './entity/refresh-token.entity';
import { User } from './entity/user.entity';
import { JwtAuthGuard } from './guard/jwt-auth.guard';
import { AppleService } from './service/apple.service';
import { AuthService } from './service/auth.service';
import { GoogleService } from './service/google.service';
import { TokenService } from './service/token.service';

/**
 * 소셜 로그인(Google·Apple) 모듈.
 * provider별 검증 서비스는 분리하되 HTTP 엔드포인트는 하나로 통합한다.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([User, RefreshToken]),
    JwtModule.register({}),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    GoogleService,
    AppleService,
    TokenService,
    JwtAuthGuard,
  ],
  // 다른 기능 모듈에서 @UseGuards(JwtAuthGuard) 로 재사용할 수 있게 내보낸다.
  exports: [JwtAuthGuard],
})
export class AuthModule {}
