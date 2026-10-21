import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AdminAuditService } from '../audit/admin-audit.service';
import type { AdminRole } from './admin-roles.decorator';
import { AdminAccount } from './admin.entity';
import { AdminAuthService } from './admin-auth.service';

export interface AdminAccountView {
  id: string;
  email: string;
  role: AdminRole;
  active: boolean;
  createdAt: Date;
}

@Injectable()
export class AdminAccountsService {
  constructor(
    @InjectRepository(AdminAccount)
    private readonly accounts: Repository<AdminAccount>,
    private readonly dataSource: DataSource,
    private readonly audit: AdminAuditService,
    private readonly auth: AdminAuthService,
  ) {}

  async list(): Promise<{ items: AdminAccountView[] }> {
    const rows = await this.accounts.find({
      order: { createdAt: 'DESC', id: 'DESC' },
    });
    return { items: rows.map((row) => this.view(row)) };
  }

  async invite(
    actorId: string,
    emailInput: string,
    role: AdminRole,
    ipAddress: string | null,
  ): Promise<AdminAccountView & { loginLinkRequested: boolean }> {
    const email = emailInput.trim().toLowerCase();
    if (!email || !['viewer', 'editor', 'owner'].includes(role)) {
      throw new BadRequestException('관리자 계정 입력이 올바르지 않습니다.');
    }
    const account = await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `SELECT pg_advisory_xact_lock(hashtext('admin_account_management'))`,
      );
      const repo = manager.getRepository(AdminAccount);
      const existing = await repo.findOneBy({ email });
      if (existing?.active) {
        throw new ConflictException('이미 등록된 관리자 이메일입니다.');
      }
      const before = existing
        ? { role: existing.role, active: existing.active }
        : null;
      const row = existing ?? repo.create({ email, role, active: true });
      row.role = role;
      row.active = true;
      const saved = await repo.save(row);
      await this.audit.record(manager, {
        actor: actorId,
        action: 'admin.invite',
        target: `admin:${saved.id}`,
        before,
        after: { email: saved.email, role: saved.role, active: true },
      });
      return saved;
    });
    let loginLinkRequested = true;
    try {
      loginLinkRequested = await this.auth.requestInviteLink(email, ipAddress);
    } catch (error) {
      if (
        !(error instanceof HttpException) ||
        ![
          HttpStatus.TOO_MANY_REQUESTS,
          HttpStatus.SERVICE_UNAVAILABLE,
        ].includes(error.getStatus())
      ) {
        throw error;
      }
      loginLinkRequested = false;
    }
    return { ...this.view(account), loginLinkRequested };
  }

  async disable(actorId: string, id: string): Promise<void> {
    if (actorId === id) {
      throw new ForbiddenException('자신의 관리자 계정은 삭제할 수 없습니다.');
    }
    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `SELECT pg_advisory_xact_lock(hashtext('admin_account_management'))`,
      );
      const repo = manager.getRepository(AdminAccount);
      const account = await repo.findOneBy({ id });
      if (!account || !account.active) {
        throw new NotFoundException('관리자 계정을 찾을 수 없습니다.');
      }
      if (account.role === 'owner') {
        const activeOwners = await repo.countBy({
          role: 'owner',
          active: true,
        });
        if (activeOwners <= 1) {
          throw new ConflictException(
            '마지막 owner 계정은 삭제할 수 없습니다.',
          );
        }
      }
      await repo.update({ id, active: true }, { active: false });
      await manager.query(
        `UPDATE "admin_sessions" SET "revokedAt" = now()
         WHERE "adminId" = $1 AND "revokedAt" IS NULL`,
        [id],
      );
      await manager.query(
        `UPDATE "admin_magic_links" SET "consumedAt" = now()
         WHERE "adminId" = $1 AND "consumedAt" IS NULL`,
        [id],
      );
      await this.audit.record(manager, {
        actor: actorId,
        action: 'admin.disable',
        target: `admin:${id}`,
        before: { email: account.email, role: account.role, active: true },
        after: { email: account.email, role: account.role, active: false },
      });
    });
  }

  private view(account: AdminAccount): AdminAccountView {
    return {
      id: account.id,
      email: account.email,
      role: account.role,
      active: account.active,
      createdAt: account.createdAt,
    };
  }
}
