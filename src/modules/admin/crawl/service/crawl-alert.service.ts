import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CrawlAlert } from '../entity/crawl-alert.entity';

@Injectable()
export class CrawlAlertService {
  constructor(
    @InjectRepository(CrawlAlert)
    private readonly alerts: Repository<CrawlAlert>,
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
    const result = await this.alerts
      .createQueryBuilder()
      .update()
      .set({ acknowledgedAt: new Date(), acknowledgedBy: adminId })
      .where('id = :id AND "acknowledgedAt" IS NULL', { id })
      .execute();
    if (!result.affected) {
      const existing = await this.alerts.findOneBy({ id });
      if (!existing)
        throw new NotFoundException('크롤 알림을 찾을 수 없습니다.');
      return existing;
    }
    return this.alerts.findOneByOrFail({ id });
  }
}
