import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AdminAuditService } from '../admin/audit/admin-audit.service';
import { CreateNoticeDto, UpdateNoticeDto } from './notice.dto';

type NoticeRow = {
  id: string;
  title: string;
  content: string;
  published: boolean;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type PublicNoticeSummary = {
  id: string;
  title: string;
  publishedAt: string;
};

export type PublicNoticeDetail = PublicNoticeSummary & { content: string };

export type AdminNotice = Omit<PublicNoticeDetail, 'publishedAt'> & {
  published: boolean;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

function text(value: string, name: string, max: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max || normalized.includes('\0')) {
    throw new BadRequestException(`${name}은 1~${max}자여야 합니다.`);
  }
  return normalized;
}

function listLimit(value: string | undefined): number {
  if (value === undefined) return 100;
  if (!/^(?:[1-9]|[1-9][0-9]|100)$/.test(value)) {
    throw new BadRequestException('limit는 1~100의 정수여야 합니다.');
  }
  return Number(value);
}

function listOffset(value: string | undefined): number {
  if (value === undefined) return 0;
  if (!/^(?:0|[1-9][0-9]{0,3}|10000)$/.test(value)) {
    throw new BadRequestException('offset은 0~10000의 정수여야 합니다.');
  }
  return Number(value);
}

function publicSummary(row: NoticeRow): PublicNoticeSummary {
  return {
    id: row.id,
    title: row.title,
    publishedAt: row.publishedAt!.toISOString(),
  };
}

function adminNotice(row: NoticeRow): AdminNotice {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    published: row.published,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function auditValue(row: NoticeRow | undefined) {
  return row
    ? {
        title: row.title,
        published: row.published,
        publishedAt: row.publishedAt?.toISOString() ?? null,
        contentLength: row.content.length,
      }
    : null;
}

@Injectable()
export class NoticesService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: AdminAuditService,
  ) {}

  async publicList(): Promise<{ items: PublicNoticeSummary[] }> {
    const rows: NoticeRow[] = await this.dataSource.query(
      `SELECT "id", "title", "publishedAt" FROM "notices"
       WHERE "published" = true
       ORDER BY "publishedAt" DESC, "id" DESC LIMIT 100`,
    );
    return { items: rows.map(publicSummary) };
  }

  async publicDetail(id: string): Promise<PublicNoticeDetail> {
    const rows: NoticeRow[] = await this.dataSource.query(
      `SELECT "id", "title", "content", "publishedAt" FROM "notices"
       WHERE "id" = $1 AND "published" = true`,
      [id],
    );
    const row = rows[0];
    if (!row) throw new NotFoundException('공지를 찾을 수 없습니다.');
    return { ...publicSummary(row), content: row.content };
  }

  async adminList(
    limit?: string,
    offset?: string,
  ): Promise<{ items: AdminNotice[] }> {
    const rows: NoticeRow[] = await this.dataSource.query(
      `SELECT * FROM "notices"
       ORDER BY "createdAt" DESC, "id" DESC LIMIT $1 OFFSET $2`,
      [listLimit(limit), listOffset(offset)],
    );
    return { items: rows.map(adminNotice) };
  }

  async adminDetail(id: string): Promise<AdminNotice> {
    const rows: NoticeRow[] = await this.dataSource.query(
      'SELECT * FROM "notices" WHERE "id" = $1',
      [id],
    );
    const row = rows[0];
    if (!row) throw new NotFoundException('공지를 찾을 수 없습니다.');
    return adminNotice(row);
  }

  async create(actor: string, body: CreateNoticeDto): Promise<AdminNotice> {
    const title = text(body.title, '제목', 200);
    const content = text(body.content, '본문', 30000);
    if (typeof body.published !== 'boolean') {
      throw new BadRequestException('게시 상태가 올바르지 않습니다.');
    }
    return this.dataSource.transaction(async (manager) => {
      const rows: NoticeRow[] = await manager.query(
        `INSERT INTO "notices" ("title", "content", "published", "publishedAt")
         VALUES ($1, $2, $3, CASE WHEN $3 THEN now() ELSE NULL END)
         RETURNING *`,
        [title, content, body.published],
      );
      const row = rows[0];
      await this.audit.record(manager, {
        actor,
        action: 'notices.create',
        target: row.id,
        before: null,
        after: auditValue(row),
      });
      return adminNotice(row);
    });
  }

  async update(
    actor: string,
    id: string,
    body: UpdateNoticeDto,
  ): Promise<AdminNotice> {
    if (
      body.title === undefined &&
      body.content === undefined &&
      body.published === undefined
    ) {
      throw new BadRequestException('수정할 필드가 없습니다.');
    }
    const title =
      body.title === undefined ? undefined : text(body.title, '제목', 200);
    const content =
      body.content === undefined
        ? undefined
        : text(body.content, '본문', 30000);
    if (body.published !== undefined && typeof body.published !== 'boolean') {
      throw new BadRequestException('게시 상태가 올바르지 않습니다.');
    }
    return this.dataSource.transaction(async (manager) => {
      const beforeRows: NoticeRow[] = await manager.query(
        'SELECT * FROM "notices" WHERE "id" = $1 FOR UPDATE',
        [id],
      );
      const before = beforeRows[0];
      if (!before) throw new NotFoundException('공지를 찾을 수 없습니다.');
      const published = body.published ?? before.published;
      const afterRows: NoticeRow[] = await manager.query(
        `UPDATE "notices" SET "title" = $2, "content" = $3,
         "publishedAt" = CASE
           WHEN $4 = true AND "published" = false THEN now()
           WHEN $4 = true THEN "publishedAt"
           ELSE NULL END,
         "published" = $4, "updatedAt" = now()
         WHERE "id" = $1 RETURNING *`,
        [id, title ?? before.title, content ?? before.content, published],
      );
      const after = afterRows[0];
      await this.audit.record(manager, {
        actor,
        action: 'notices.update',
        target: id,
        before: auditValue(before),
        after: auditValue(after),
      });
      return adminNotice(after);
    });
  }
}
