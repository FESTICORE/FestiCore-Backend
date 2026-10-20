import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AdminFestival } from '../admin/festival/festival.entity';
import { festivalSetId } from '../admin/festival/festival-set-id';
import { ReplaceScheduleDto } from './schedule.dto';
import { UserSchedule } from './schedule.entity';

@Injectable()
export class ScheduleService {
  constructor(
    @InjectRepository(UserSchedule)
    private readonly schedules: Repository<UserSchedule>,
    @InjectRepository(AdminFestival)
    private readonly festivals: Repository<AdminFestival>,
    private readonly dataSource: DataSource,
  ) {}

  async replace(userId: string, festivalId: string, body: ReplaceScheduleDto) {
    this.validateFestivalId(festivalId);
    const clientAt = new Date(body.clientAt);
    if (
      Number.isNaN(clientAt.getTime()) ||
      clientAt.getTime() > Date.now() + 5 * 60_000
    )
      throw new BadRequestException('clientAt이 미래이거나 유효하지 않습니다.');
    return this.dataSource.transaction(async (manager) => {
      // 탈퇴와 일정 저장을 직렬화해 삭제된 사용자의 FK 오류를 노출하지 않는다.
      const users: Array<{ id: string }> = await manager.query(
        'SELECT "id" FROM "users" WHERE "id" = $1 FOR UPDATE',
        [userId],
      );
      if (!users.length)
        throw new NotFoundException('사용자를 찾을 수 없습니다.');
      const festival = await manager.getRepository(AdminFestival).findOne({
        where: { id: festivalId },
        lock: { mode: 'pessimistic_read' },
      });
      this.assertPublishedSets(festival, body.setIds);
      // 동일 사용자·페스티벌의 동시 오프라인 재전송도 시각 순서로 처리한다.
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
        [userId, festivalId],
      );
      let row = await manager
        .getRepository(UserSchedule)
        .findOne({ where: { userId, festivalId } });
      if (
        row &&
        clientAt.getTime() === row.clientAt.getTime() &&
        JSON.stringify(body.setIds) === JSON.stringify(row.setIds)
      )
        return { setIds: row.setIds, updatedAt: row.updatedAt.toISOString() };
      if (row && clientAt.getTime() <= row.clientAt.getTime())
        throw new ConflictException({
          code: 'STATUS_STALE',
          message: '더 최신 일정이 저장되어 있습니다.',
          current: { setIds: row.setIds, updatedAt: row.updatedAt },
        });
      if (!row) row = this.schedules.create({ userId, festivalId });
      row.setIds = body.setIds;
      row.clientAt = clientAt;
      const saved = await manager.getRepository(UserSchedule).save(row);
      return { setIds: saved.setIds, updatedAt: saved.updatedAt.toISOString() };
    });
  }

  async get(userId: string, festivalId: string) {
    this.validateFestivalId(festivalId);
    const festival = await this.festivals.findOne({
      where: { id: festivalId },
    });
    if (!festival?.published || festival.publishedVersion < 1)
      throw new NotFoundException('공개된 페스티벌을 찾을 수 없습니다.');
    const row = await this.schedules.findOne({ where: { userId, festivalId } });
    return row
      ? { setIds: row.setIds, updatedAt: row.updatedAt.toISOString() }
      : { setIds: [], updatedAt: null };
  }

  private validateFestivalId(festivalId: string): void {
    if (!/^fst_[0-9a-z]+$/.test(festivalId))
      throw new BadRequestException('festivalId 형식이 올바르지 않습니다.');
  }

  private assertPublishedSets(
    festival: AdminFestival | null,
    setIds: string[],
  ): void {
    if (!festival?.published || festival.publishedVersion < 1)
      throw new NotFoundException('공개된 페스티벌을 찾을 수 없습니다.');
    const validIds = new Set(
      (Array.isArray(festival.published.sets) ? festival.published.sets : [])
        .filter(
          (set): set is Record<string, unknown> =>
            set !== null && typeof set === 'object' && !Array.isArray(set),
        )
        .map((set) => festivalSetId(set)),
    );
    const errors = setIds.filter((id) => !validIds.has(id));
    if (errors.length)
      throw new BadRequestException({
        code: 'VALIDATION',
        message: '없는 setId가 있습니다.',
        errors,
      });
  }
}
