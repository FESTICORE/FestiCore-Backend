import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { AdminFestivalModule } from './admin/festival/admin-festival.module';
import { FlagsModule } from './flags/flags.module';
import { PublicFestivalModule } from './public/public-festival.module';

/**
 * app.module imports 에 펼칠(...) 기능 모듈 목록.
 * 새 기능 모듈을 추가하면 이 배열에만 등록하면 된다.
 * (ConfigModule/TypeOrmModule 처럼 설정이 붙은 루트 모듈은 제외)
 */
export const featureModules = [
  HealthModule,
  AuthModule,
  AdminFestivalModule,
  FlagsModule,
  PublicFestivalModule,
];
