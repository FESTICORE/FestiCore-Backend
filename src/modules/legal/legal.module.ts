import { Module } from '@nestjs/common';
import { AdminAuditModule } from '../admin/audit/admin-audit.module';
import { AdminLegalController } from './admin-legal.controller';
import { LegalController } from './legal.controller';
import { LegalService } from './legal.service';

@Module({
  imports: [AdminAuditModule],
  controllers: [LegalController, AdminLegalController],
  providers: [LegalService],
})
export class LegalModule {}
