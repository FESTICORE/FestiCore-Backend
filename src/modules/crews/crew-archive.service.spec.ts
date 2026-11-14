import { Repository } from 'typeorm';
import { AdminFestival } from '../admin/festival/festival.entity';
import {
  Crew,
  CrewGather,
  CrewMember,
  CrewStatusIdempotency,
} from './crew.entity';
import { CrewArchiveService } from './crew-archive.service';
import { LiveActivityService } from '../notification/live-activity.service';

describe('CrewArchiveService', () => {
  it('마지막 공연일 자정(KST)에 보관하고 30일 뒤 실시간 위치를 지운다', async () => {
    const end = new Date('2026-10-01T12:00:00.000Z');
    const crew = {
      id: 'flg_crew',
      festivalId: 'fst_test',
      archivedAt: null,
    } as Crew;
    const crews: {
      find: jest.Mock;
      update: jest.Mock;
      manager?: { transaction: jest.Mock };
    } = {
      find: jest.fn().mockResolvedValue([crew]),
      update: jest
        .fn()
        .mockImplementation((_: unknown, changes: { archivedAt: Date }) => {
          if (crew.archivedAt) return Promise.resolve({ affected: 0 });
          crew.archivedAt = changes.archivedAt;
          return Promise.resolve({ affected: 1 });
        }),
    };
    crews.manager = {
      transaction: jest.fn((work: (manager: unknown) => Promise<unknown>) =>
        work({ getRepository: () => crews }),
      ),
    };
    const members = { update: jest.fn().mockResolvedValue(undefined) };
    const gathers = { delete: jest.fn().mockResolvedValue(undefined) };
    const festivals = {
      findOne: jest.fn().mockResolvedValue({
        published: { days: [{ endsAt: end.toISOString() }] },
      }),
    };
    const idempotency = { delete: jest.fn().mockResolvedValue(undefined) };
    const liveActivity = {
      enqueueCrewMembers: jest.fn().mockResolvedValue(undefined),
    };
    const service = new CrewArchiveService(
      crews as unknown as Repository<Crew>,
      members as unknown as Repository<CrewMember>,
      gathers as unknown as Repository<CrewGather>,
      festivals as unknown as Repository<AdminFestival>,
      idempotency as unknown as Repository<CrewStatusIdempotency>,
      liveActivity as unknown as LiveActivityService,
    );
    // 종료 2026-10-01 21:00 KST → 보관 2026-10-02 00:00 KST
    const archiveAt = new Date('2026-10-01T15:00:00.000Z');
    await service.run(new Date(archiveAt.getTime() - 1));
    expect(crews.update).not.toHaveBeenCalled();
    await service.run(archiveAt);
    expect(crews.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: crew.id }),
      { archivedAt: archiveAt },
    );
    expect(liveActivity.enqueueCrewMembers).toHaveBeenCalledWith(
      crew.id,
      crew.festivalId,
      expect.anything(),
    );
    expect(crew.archivedAt).toBeInstanceOf(Date);
    expect(members.update).not.toHaveBeenCalled();
    await service.run(new Date(end.getTime() + 31 * 24 * 60 * 60_000));
    expect(members.update).toHaveBeenCalledWith(
      { crewId: crew.id },
      { zoneId: null, state: null, statusUpdatedAt: null },
    );
    expect(gathers.delete).toHaveBeenCalledWith({ crewId: crew.id });
    expect(idempotency.delete).toHaveBeenCalledTimes(3);
  });
});
