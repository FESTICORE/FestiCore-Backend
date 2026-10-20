import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';
import {
  AdminAccount,
  AdminAuthAudit,
  AdminMagicLink,
  AdminSession,
} from './admin.entity';
import { AdminSessionGuard } from './admin-session.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AdminAccount,
      AdminMagicLink,
      AdminSession,
      AdminAuthAudit,
    ]),
  ],
  controllers: [AdminAuthController],
  providers: [AdminAuthService, AdminSessionGuard],
  exports: [AdminAuthService, AdminSessionGuard],
})
export class AdminAuthModule {}
