import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from 'node:crypto';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { AppleRevokeRetry } from '../entity/apple-revoke-retry.entity';
import { AppleService } from './apple.service';

const MAX_ATTEMPTS = 12;
const BATCH_SIZE = 10;
const POLL_INTERVAL_MS = 60_000;

/**
 * 회원 탈퇴 후에도 남겨야 하는 Apple refresh 토큰 폐기 작업.
 * 토큰은 AES-256-GCM 암호문으로만 보관하고, 성공 시 즉시 행을 삭제한다.
 */
@Injectable()
export class AppleRevokeRetryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AppleRevokeRetryService.name);
  private readonly key: Buffer | null;
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly db: DataSource,
    private readonly apple: AppleService,
  ) {
    const raw = this.config.get<string>('APPLE_REVOKE_ENCRYPTION_KEY');
    const key = raw
      ? Buffer.from(raw, /^[a-f0-9]{64}$/i.test(raw) ? 'hex' : 'base64')
      : null;
    this.key = key?.length === 32 ? key : null;
  }

  onModuleInit(): void {
    if (!this.key) {
      this.logger.warn(
        'APPLE_REVOKE_ENCRYPTION_KEY가 없어 Apple 폐기 재시도 작업이 비활성입니다.',
      );
      return;
    }
    this.timer = setInterval(() => {
      void this.runDue().catch(() => {
        this.logger.error('Apple 폐기 재시도 작업에 실패했습니다.');
      });
    }, POLL_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** 탈퇴 트랜잭션에 함께 저장하면 사용자 삭제와 작업 저장이 원자적으로 완료된다. */
  async enqueue(
    refreshToken: string,
    clientId = this.config.get<string>('auth.apple.clientId'),
    manager?: EntityManager,
  ): Promise<void> {
    if (!this.key || !refreshToken || !clientId) {
      throw new Error(
        'Apple 폐기 재시도 토큰, client ID 또는 암호화 키가 없습니다.',
      );
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(refreshToken, 'utf8'),
      cipher.final(),
    ]);
    const tokenHash = createHmac('sha256', this.key)
      .update(clientId)
      .update('\0')
      .update(refreshToken)
      .digest('hex');
    const sql = `
      INSERT INTO "apple_revoke_retries"
        ("tokenHash", "clientId", "ciphertext", "iv", "authTag")
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT ("tokenHash") DO NOTHING`;
    await (manager ?? this.db).query(sql, [
      tokenHash,
      clientId,
      ciphertext.toString('base64'),
      iv.toString('base64'),
      cipher.getAuthTag().toString('base64'),
    ]);
  }

  /** 여러 인스턴스에서 동시에 실행돼도 SKIP LOCKED로 각 작업을 한 번만 처리한다. */
  async runDue(): Promise<void> {
    if (!this.key || this.running) return;
    this.running = true;
    try {
      for (let count = 0; count < BATCH_SIZE; count += 1) {
        const processed = await this.db.transaction(async (manager) => {
          const rows = await manager.query<AppleRevokeRetry[]>(`
            SELECT * FROM "apple_revoke_retries"
            WHERE "nextAttemptAt" <= now() AND "exhaustedAt" IS NULL
            ORDER BY "nextAttemptAt", "createdAt"
            LIMIT 1 FOR UPDATE SKIP LOCKED`);
          const job = rows[0];
          if (!job) return false;

          let succeeded = false;
          let decryptFailed = false;
          let token: string | undefined;
          try {
            const decipher = createDecipheriv(
              'aes-256-gcm',
              this.key!,
              Buffer.from(job.iv, 'base64'),
            );
            decipher.setAuthTag(Buffer.from(job.authTag, 'base64'));
            token = Buffer.concat([
              decipher.update(Buffer.from(job.ciphertext, 'base64')),
              decipher.final(),
            ]).toString('utf8');
          } catch {
            decryptFailed = true;
            this.logger.error(
              'Apple 폐기 재시도 암호문을 복호화하지 못했습니다.',
            );
          }
          if (token) {
            try {
              succeeded = await this.apple.revokeConnection(
                token,
                job.clientId,
              );
            } catch {
              this.logger.warn('Apple 폐기 재시도 요청에 실패했습니다.');
            }
          }

          if (succeeded) {
            await manager.delete(AppleRevokeRetry, { id: job.id });
            return true;
          }
          const attempts = job.attempts + 1;
          const exhausted = decryptFailed || attempts >= MAX_ATTEMPTS;
          await manager.query(
            `UPDATE "apple_revoke_retries"
             SET "attempts" = $2,
                 "nextAttemptAt" = now() + ($3 * interval '1 minute'),
                 "exhaustedAt" = CASE WHEN $4 THEN now() ELSE NULL END
             WHERE "id" = $1`,
            [job.id, attempts, Math.min(2 ** attempts, 24 * 60), exhausted],
          );
          if (exhausted) {
            this.logger.error('Apple 폐기 재시도 횟수가 소진됐습니다.');
          }
          return true;
        });
        if (!processed) break;
      }
    } finally {
      this.running = false;
    }
  }
}
