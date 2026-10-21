import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AdminAuditService } from '../../audit/admin-audit.service';
import { CrawlAlert } from '../entity/crawl-alert.entity';

@Injectable()
export class CrawlAlertService {
  constructor(
    @InjectRepository(CrawlAlert)
    private readonly alerts: Repository<CrawlAlert>,
    private readonly dataSource: DataSource,
    private readonly audit: AdminAuditService,
  ) {}

  async recordThresholdFailure(
    sourceId: string,
    runId: string,
    reason: string,
  ) {
    await this.alerts
      .createQueryBuilder()
      .insert()
      .values({ sourceId, runId, reason: reason.slice(0, 1000) })
      .orIgnore()
      .execute();
  }

  async list(status?: string, limit?: string) {
    if (status && status !== 'open' && status !== 'acknowledged') {
      throw new BadRequestException('알림 상태가 올바르지 않습니다.');
    }
    const count = Number(limit);
    const take =
      Number.isInteger(count) && count >= 1 && count <= 100 ? count : 50;
    const query = this.alerts.createQueryBuilder('alert');
    if (status === 'open') query.where('alert.acknowledgedAt IS NULL');
    if (status === 'acknowledged')
      query.where('alert.acknowledgedAt IS NOT NULL');
    const items = await query
      .orderBy('alert.createdAt', 'DESC')
      .take(take)
      .getMany();
    return { items };
  }

  async acknowledge(id: string, adminId: string) {
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(CrawlAlert);
      const alert = await repo.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!alert) throw new NotFoundException('크롤 알림을 찾을 수 없습니다.');
      if (alert.acknowledgedAt) return alert;
      alert.acknowledgedAt = new Date();
      alert.acknowledgedBy = adminId;
      const saved = await repo.save(alert);
      await this.audit.record(manager, {
        actor: adminId,
        action: 'crawl.alert.acknowledged',
        target: `crawl-alert:${id}`,
        before: { acknowledgedAt: null, acknowledgedBy: null },
        after: {
          acknowledgedAt: saved.acknowledgedAt,
          acknowledgedBy: saved.acknowledgedBy,
        },
      });
      return saved;
    });
  }
}
