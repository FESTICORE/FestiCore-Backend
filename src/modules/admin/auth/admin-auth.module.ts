import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAuthService } from './admin-auth.service';
import { AdminAccount } from './admin.entity';
import { AdminSessionGuard } from './admin-session.guard';
import { AdminAuditModule } from '../audit/admin-audit.module';
import { AdminAccountsController } from './admin-accounts.controller';
import { AdminAccountsService } from './admin-accounts.service';

@Module({
  imports: [AdminAuditModule, TypeOrmModule.forFeature([AdminAccount])],
  controllers: [AdminAccountsController],
  providers: [AdminAuthService, AdminAccountsService, AdminSessionGuard],
  exports: [AdminAuthService, AdminSessionGuard],
})
export class AdminAuthModule {}
