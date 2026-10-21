import {
  Injectable,
  HttpException,
  HttpStatus,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'crypto';
import { DataSource, IsNull, MoreThan, Repository } from 'typeorm';
import {
  AdminAccount,
  AdminAuthAudit,
  AdminMagicLink,
  AdminSession,
} from './admin.entity';
import type { AdminRole } from './admin-roles.decorator';

const LINK_TTL_MS = 15 * 60 * 1000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const REQUEST_LIMIT = 5;
const MIN_RESPONSE_MS = 1500;

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
    @InjectRepository(AdminMagicLink)
    private readonly links: Repository<AdminMagicLink>,
    @InjectRepository(AdminSession)
    private readonly sessions: Repository<AdminSession>,
    @InjectRepository(AdminAuthAudit)
    private readonly audit: Repository<AdminAuthAudit>,
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

  async requestMagicLink(
    emailInput: string,
    ipAddress: string | null,
  ): Promise<void> {
    await this.prepareMagicLink(emailInput, ipAddress);
  }

  /** 등록된 계정을 관리하는 owner 요청에서만 메일 준비 결과를 노출한다. */
  async requestInviteLink(
    emailInput: string,
    ipAddress: string | null,
  ): Promise<boolean> {
    return this.prepareMagicLink(emailInput, ipAddress);
  }

  private async prepareMagicLink(
    emailInput: string,
    ipAddress: string | null,
  ): Promise<boolean> {
    const email = emailInput.trim().toLowerCase();
    await this.checkRateLimit(ipAddress);

    const apiKey = this.config.get<string>('ADMIN_RESEND_API_KEY');
    const from = this.config.get<string>('ADMIN_EMAIL_FROM');
    const apiUrl =
      this.config.get<string>('ADMIN_API_PUBLIC_URL') ??
      this.config.get<string>('PUBLIC_URL');
    if (!apiKey || !from || !apiUrl) {
      throw new ServiceUnavailableException(
        '관리자 이메일 로그인이 설정되지 않았습니다.',
      );
    }
    const startedAt = Date.now();
    let link: AdminMagicLink | undefined;
    try {
      const account = await this.accounts.findOneBy({ email, active: true });
      // 존재하지 않는 이메일도 같은 응답을 반환한다.
      if (!account) return false;
      const pending = await this.links.findOneBy({
        adminId: account.id,
        consumedAt: IsNull(),
        expiresAt: MoreThan(new Date()),
      });
      if (pending) return false;

      const token = randomBytes(32).toString('base64url');
      link = this.links.create({
        adminId: account.id,
        tokenHash: this.hash(token),
        expiresAt: new Date(Date.now() + LINK_TTL_MS),
        consumedAt: null,
      });
      await this.links.save(link);
      await this.recordAudit(account.id, 'magic_link_requested', ipAddress);
      const url = new URL('/api/v1/admin/auth/callback', apiUrl);
      if (
        this.config.get<string>('NODE_ENV') === 'production' &&
        url.protocol !== 'https:'
      ) {
        throw new Error('Production admin callback must use HTTPS.');
      }
      url.searchParams.set('token', token);
      void this.deliverMagicLink(link.id, apiKey, from, email, url.toString());
      return true;
    } catch {
      if (link?.id) {
        try {
          await this.links.delete(link.id);
        } catch {
          this.logger.error('Failed to invalidate an undelivered admin link.');
        }
      }
      this.logger.error('Admin magic-link preparation failed.');
      // 준비 실패도 같은 202 응답으로 처리해 계정 존재 여부를 드러내지 않는다.
      return false;
    } finally {
      const wait = MIN_RESPONSE_MS - (Date.now() - startedAt);
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }

  private async deliverMagicLink(
    linkId: string,
    apiKey: string,
    from: string,
    email: string,
    url: string,
  ): Promise<void> {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: [email],
          subject: 'FestiCore 관리자 로그인',
          html: `<p>15분 이내에 아래 링크로 로그인하세요.</p><p><a href="${url}">관리자 로그인</a></p>`,
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok)
        throw new Error(`Email provider returned ${response.status}.`);
    } catch {
      try {
        await this.links.delete(linkId);
      } catch {
        this.logger.error('Failed to invalidate an undelivered admin link.');
      }
      this.logger.error('Admin magic-link delivery failed.');
    }
  }

  async consumeMagicLink(
    token: string,
    ipAddress: string | null,
  ): Promise<{ admin: AuthenticatedAdmin; sessionToken: string }> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new UnauthorizedException('유효하지 않은 로그인 링크입니다.');
    const sessionToken = randomBytes(32).toString('base64url');
    const tokenHash = this.hash(token);
    const sessionHash = this.hash(sessionToken);
    const admin = await this.dataSource.transaction(async (manager) => {
      const consumed: { adminId: string }[] = await manager.query(
        `UPDATE "admin_magic_links" SET "consumedAt" = now()
         WHERE "tokenHash" = $1 AND "consumedAt" IS NULL AND "expiresAt" > now()
         RETURNING "adminId"`,
        [tokenHash],
      );
      if (consumed.length !== 1)
        throw new UnauthorizedException(
          '유효하지 않거나 만료된 로그인 링크입니다.',
        );
      const account = await manager
        .getRepository(AdminAccount)
        .findOneBy({ id: consumed[0].adminId, active: true });
      if (!account)
        throw new UnauthorizedException('사용할 수 없는 관리자 계정입니다.');
      await manager.getRepository(AdminSession).save({
        adminId: account.id,
        tokenHash: sessionHash,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
        revokedAt: null,
      });
      return account;
    });
    await this.recordAudit(admin.id, 'login', ipAddress);
    return {
      admin: { id: admin.id, email: admin.email, role: admin.role },
      sessionToken,
    };
  }

  async validateSession(token: string): Promise<AuthenticatedAdmin> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new UnauthorizedException('관리자 세션이 유효하지 않습니다.');
    const session = await this.sessions
      .createQueryBuilder('session')
      .where('session.tokenHash = :tokenHash', { tokenHash: this.hash(token) })
      .andWhere('session.revokedAt IS NULL')
      .getOne();
    if (!session || session.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('관리자 세션이 만료되었습니다.');
    }
    const account = await this.accounts.findOneBy({
      id: session.adminId,
      active: true,
    });
    if (!account)
      throw new UnauthorizedException('사용할 수 없는 관리자 계정입니다.');
    return { id: account.id, email: account.email, role: account.role };
  }

  async logout(
    token: string,
    adminId: string,
    ipAddress: string | null,
  ): Promise<void> {
    await this.sessions.update(
      { tokenHash: this.hash(token), adminId },
      { revokedAt: new Date() },
    );
    await this.recordAudit(adminId, 'logout', ipAddress);
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
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
    const apiUrl =
      this.config.get<string>('ADMIN_API_PUBLIC_URL') ??
      this.config.get<string>('PUBLIC_URL');
    const api = apiUrl ? new URL(apiUrl) : null;
    const web = new URL(webUrl);
    const sameSite = this.config.get<string>('ADMIN_SESSION_SAME_SITE');
    if (sameSite && !['lax', 'strict', 'none'].includes(sameSite)) {
      throw new Error('ADMIN_SESSION_SAME_SITE must be lax, strict, or none.');
    }
    if (sameSite === 'none' && api?.protocol !== 'https:') {
      throw new Error('SameSite=None requires an HTTPS admin API URL.');
    }
    if (this.config.get<string>('NODE_ENV') === 'production') {
      if (!api || api.protocol !== 'https:' || web.protocol !== 'https:') {
        throw new Error('Production admin URLs must use HTTPS.');
      }
    }
  }

  private async checkRateLimit(ipAddress: string | null): Promise<void> {
    const key = `ip:${this.hash(ipAddress ?? 'unknown')}`;
    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `SELECT pg_advisory_xact_lock(hashtext('admin_magic_link'), hashtext($1))`,
        [key],
      );
      const rows: { count: number }[] = await manager.query(
        `SELECT count(*)::int AS count FROM "admin_auth_audit"
         WHERE "action" = 'magic_link_request_attempt'
           AND "ipAddress" = $1
           AND "createdAt" > now() - interval '15 minutes'`,
        [key],
      );
      if (Number(rows[0]?.count ?? 0) >= REQUEST_LIMIT) {
        throw new HttpException(
          '잠시 후 다시 시도하세요.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      await manager.query(
        `INSERT INTO "admin_auth_audit" ("adminId", "action", "ipAddress")
         VALUES (NULL, 'magic_link_request_attempt', $1)`,
        [key],
      );
    });
  }

  private async recordAudit(
    adminId: string,
    action: string,
    ipAddress: string | null,
  ): Promise<void> {
    await this.audit.save(this.audit.create({ adminId, action, ipAddress }));
  }
}
