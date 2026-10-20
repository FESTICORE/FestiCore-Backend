import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { FlagClaimBudget } from './flag.entity';

export interface FlagClaimContext {
  deviceId: string;
  ip: string;
}

@Injectable()
export class FlagClaimThrottleService {
  constructor(
    private readonly db: DataSource,
    private readonly config: ConfigService,
  ) {}

  private keys(
    festivalId: string,
    userId: string,
    codeHash: string,
    context: FlagClaimContext,
  ): string[] {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        context.deviceId,
      ) ||
      !context.ip
    )
      throw new BadRequestException({
        code: 'VALIDATION',
        message: 'X-Device-Id UUID가 필요합니다.',
      });
    const secret = this.config.get<string>('auth.jwt.accessSecret');
    if (!secret)
      throw new Error(
        'JWT access secret is required for flag claim throttling',
      );
    return [
      `user:${festivalId}:${userId}`,
      `device:${festivalId}:${context.deviceId.toLowerCase()}`,
      `ip:${festivalId}:${context.ip}`,
      `code:${festivalId}:${codeHash}`,
    ]
      .map((value) => createHmac('sha256', secret).update(value).digest('hex'))
      .sort();
  }

  async locked(
    festivalId: string,
    userId: string,
    codeHash: string,
    context: FlagClaimContext,
    now = new Date(),
    manager?: EntityManager,
  ): Promise<number> {
    const keys = this.keys(festivalId, userId, codeHash, context);
    const rows = await (manager ?? this.db)
      .getRepository(FlagClaimBudget)
      .findByIds(keys);
    return Math.max(
      0,
      ...rows.map((row) =>
        row.lockedUntil && row.lockedUntil > now
          ? Math.ceil((row.lockedUntil.getTime() - now.getTime()) / 1000)
          : 0,
      ),
    );
  }

  async failed(
    festivalId: string,
    userId: string,
    codeHash: string,
    context: FlagClaimContext,
    now = new Date(),
    manager?: EntityManager,
  ): Promise<{ remainingAttempts: number; retryAfter: number }> {
    const keys = this.keys(festivalId, userId, codeHash, context);
    const recordFailure = async (writer: EntityManager) => {
      const repository = writer.getRepository(FlagClaimBudget);
      let remainingAttempts = 3;
      let retryAfter = 0;
      for (const keyHash of keys) {
        await writer.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          keyHash,
        ]);
        const prior = await repository.findOne({ where: { keyHash } });
        const within =
          prior && now.getTime() - prior.firstFailedAt.getTime() < 10 * 60_000;
        const failures = (within ? prior.failures : 0) + 1;
        const lockedUntil =
          failures >= 3 ? new Date(now.getTime() + 10 * 60_000) : null;
        await repository.save(
          repository.create({
            keyHash,
            failures,
            firstFailedAt: within ? prior.firstFailedAt : now,
            lockedUntil,
          }),
        );
        remainingAttempts = Math.min(
          remainingAttempts,
          Math.max(0, 3 - failures),
        );
        retryAfter = Math.max(retryAfter, lockedUntil ? 600 : 0);
      }
      return { remainingAttempts, retryAfter };
    };
    return manager
      ? recordFailure(manager)
      : this.db.transaction(recordFailure);
  }
}
