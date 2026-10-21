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
import { AdminAuditModule } from '../audit/admin-audit.module';
import { AdminAccountsController } from './admin-accounts.controller';
import { AdminAccountsService } from './admin-accounts.service';

@Module({
  imports: [
    AdminAuditModule,
    TypeOrmModule.forFeature([
      AdminAccount,
      AdminMagicLink,
      AdminSession,
      AdminAuthAudit,
    ]),
  ],
  controllers: [AdminAuthController, AdminAccountsController],
  providers: [AdminAuthService, AdminAccountsService, AdminSessionGuard],
  exports: [AdminAuthService, AdminSessionGuard],
})
export class AdminAuthModule {}
