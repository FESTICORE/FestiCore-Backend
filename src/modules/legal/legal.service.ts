import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AdminAuditService } from '../admin/audit/admin-audit.service';
import { DEFAULT_PRIVACY_CONTENT } from './privacy-content';

type PrivacyRow = { content: string; version: number; updatedAt: Date };
export type PrivacyDocument = {
  content: string;
  version: number;
  updatedAt: string | null;
};

@Injectable()
export class LegalService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: AdminAuditService,
  ) {}

  async privacy(): Promise<PrivacyDocument> {
    const rows: PrivacyRow[] = await this.dataSource.query(
      'SELECT "content", "version", "updatedAt" FROM "legal_documents" WHERE "kind" = $1',
      ['privacy'],
    );
    const row = rows[0];
    return row
      ? {
          content: row.content,
          version: row.version,
          updatedAt: row.updatedAt.toISOString(),
        }
      : { content: DEFAULT_PRIVACY_CONTENT, version: 0, updatedAt: null };
  }

  async updatePrivacy(
    actor: string,
    content: string,
    expectedVersion: number,
  ): Promise<PrivacyDocument> {
    const normalized = content.trim();
    if (!normalized || normalized.length > 30000 || normalized.includes('\0')) {
      throw new BadRequestException(
        '개인정보처리방침 본문은 1~30000자여야 합니다.',
      );
    }
    return this.dataSource.transaction(async (manager) => {
      const beforeRows: PrivacyRow[] = await manager.query(
        'SELECT "content", "version", "updatedAt" FROM "legal_documents" WHERE "kind" = $1 FOR UPDATE',
        ['privacy'],
      );
      const before = beforeRows[0];
      if ((before?.version ?? 0) !== expectedVersion) {
        throw new ConflictException(
          '문서가 이미 변경되었습니다. 다시 불러오세요.',
        );
      }
      const afterRows: PrivacyRow[] = before
        ? await manager.query(
            `UPDATE "legal_documents" SET "content" = $1, "version" = "version" + 1,
              "updatedAt" = now(), "updatedBy" = $2
             WHERE "kind" = $3 RETURNING "content", "version", "updatedAt"`,
            [normalized, actor, 'privacy'],
          )
        : await manager.query(
            `INSERT INTO "legal_documents" ("kind", "content", "version", "updatedBy")
             VALUES ($1, $2, 1, $3) ON CONFLICT ("kind") DO NOTHING
             RETURNING "content", "version", "updatedAt"`,
            ['privacy', normalized, actor],
          );
      const after = afterRows[0];
      if (!after) {
        throw new ConflictException(
          '문서가 이미 변경되었습니다. 다시 불러오세요.',
        );
      }
      await this.audit.record(manager, {
        actor,
        action: 'legal.privacy.update',
        target: 'privacy',
        before: {
          version: before?.version ?? 0,
          content: before?.content ?? DEFAULT_PRIVACY_CONTENT,
        },
        after: { version: after.version, content: after.content },
      });
      return {
        content: after.content,
        version: after.version,
        updatedAt: after.updatedAt.toISOString(),
      };
    });
  }
}
