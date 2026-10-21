import {
  ForbiddenException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AdminAccount } from './admin.entity';
import type { AdminRole } from './admin-roles.decorator';

export interface AuthenticatedAdmin {
  id: string;
  email: string;
  role: AdminRole;
}

@Injectable()
export class AdminAuthService implements OnModuleInit {
  private readonly logger = new Logger(AdminAuthService.name);

  constructor(
    @InjectRepository(AdminAccount)
    private readonly accounts: Repository<AdminAccount>,
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.validateDeploymentConfig();
    const ownerEmail = this.config
      .get<string>('ADMIN_OWNER_EMAIL')
      ?.trim()
      .toLowerCase();
    if (!ownerEmail) {
      this.logger.warn(
        'ADMIN_OWNER_EMAIL is not configured; initial admin login is unavailable.',
      );
      return;
    }
    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `SELECT pg_advisory_xact_lock(hashtext('admin_owner_seed'))`,
      );
      await manager.query(
        `INSERT INTO "admin_accounts" ("email", "role", "active")
         SELECT $1, 'owner', true
         WHERE NOT EXISTS (SELECT 1 FROM "admin_accounts")
         ON CONFLICT ("email") DO NOTHING`,
        [ownerEmail],
      );
    });
  }

  async findActiveByUserId(userId: string): Promise<AuthenticatedAdmin> {
    const account = await this.accounts.findOneBy({ userId, active: true });
    if (!account) throw new ForbiddenException('관리자 권한이 없습니다.');
    return { id: account.id, email: account.email, role: account.role };
  }

  private validateDeploymentConfig(): void {
    const webUrl = this.config.get<string>('ADMIN_WEB_URL');
    if (!webUrl) return;
    const origin = new URL(webUrl).origin;
    const corsOrigins = (this.config.get<string>('CORS_ORIGINS') ?? '')
      .split(',')
      .map((value) => value.trim());
    if (!corsOrigins.includes(origin)) {
      throw new Error('ADMIN_WEB_URL origin must be listed in CORS_ORIGINS.');
    }
    if (
      this.config.get<string>('NODE_ENV') === 'production' &&
      new URL(webUrl).protocol !== 'https:'
    ) {
      throw new Error('Production admin URL must use HTTPS.');
    }
  }
}
