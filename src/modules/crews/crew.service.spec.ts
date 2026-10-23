import {
  ConflictException,
  ForbiddenException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';
import { Repository } from 'typeorm';
import { AdminFestival } from '../admin/festival/festival.entity';
import { User } from '../auth/entity/user.entity';
import {
  Crew,
  CrewGather,
  CrewMember,
  CrewStatusIdempotency,
} from './crew.entity';
import { CrewService } from './crew.service';
import { SocialNotificationService } from '../notification/social-notification.service';

const ownerId = '00000000-0000-4000-8000-000000000001';
const otherId = '00000000-0000-4000-8000-000000000002';
const crew: Crew = {
  id: 'flg_1234567890abcdef',
  festivalId: 'fst_test',
  name: '친구들',
  ownerId,
  inviteCode: 'K7P2QX',
  inviteExpiresAt: new Date(Date.now() + 3600_000),
  archivedAt: null,
  lastGatherAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function setup() {
  const crewRepository = {
    findOne: jest.fn().mockResolvedValue({ ...crew }),
    save: jest.fn((value: Crew) => Promise.resolve(value)),
  };
  const memberRepository = {
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(1),
  };
  const festivalRepository = {
    findOne: jest.fn().mockResolvedValue({
      id: 'fst_test',
      published: {
        name: '테스트',
        days: [{ endsAt: new Date(Date.now() + 3600_000).toISOString() }],
        zones: [{ id: 'zon_test' }],
      },
    }),
  };
  const gatherRepository = { findOne: jest.fn().mockResolvedValue(null) };
  const service = new CrewService(
    crewRepository as unknown as Repository<Crew>,
    memberRepository as unknown as Repository<CrewMember>,
    gatherRepository as unknown as Repository<CrewGather>,
    festivalRepository as unknown as Repository<AdminFestival>,
    {} as Repository<User>,
    {
      enqueueCrewStatus: jest.fn().mockResolvedValue(undefined),
      enqueueCrewGather: jest.fn().mockResolvedValue(undefined),
    } as unknown as SocialNotificationService,
  );
  return { service, crewRepository, memberRepository };
}

describe('CrewService authorization and invitations', () => {
  it('does not expose crew details to a non-member', async () => {
    const { service } = setup();
    await expect(service.detail(crew.id, otherId)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('only lets the owner rotate the invitation', async () => {
    const { service, memberRepository, crewRepository } = setup();
    memberRepository.findOne.mockResolvedValue({
      crewId: crew.id,
      userId: otherId,
    });
    await expect(service.rotate(crew.id, otherId)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(crewRepository.save).not.toHaveBeenCalled();
  });

  it('hides invitation credentials from members who are not the owner', async () => {
    const { service, memberRepository } = setup();
    memberRepository.findOne.mockResolvedValue({
      crewId: crew.id,
      userId: otherId,
    });
    memberRepository.find.mockResolvedValue([
      {
        crewId: crew.id,
        userId: otherId,
        nickname: '손님',
        joinedAt: new Date(),
        zoneId: null,
        state: null,
        statusUpdatedAt: null,
      },
    ]);
    const result = await service.detail(crew.id, otherId);
    expect(result.inviteCode).toBeNull();
    expect(result.inviteExpiresAt).toBeNull();
    expect(result.live?.ownerId).toBe(ownerId);
  });

  it('rejects an older status while holding the member row lock', async () => {
    const { service, crewRepository, memberRepository } = setup();
    const member = {
      crewId: crew.id,
      userId: ownerId,
      zoneId: 'zon_test',
      state: 'here',
      statusUpdatedAt: new Date(),
    };
    memberRepository.findOne.mockResolvedValue(member);
    const locked = { findOne: jest.fn().mockResolvedValue(member) };
    Object.assign(crewRepository, {
      manager: {
        transaction: (
          work: (manager: {
            getRepository: () => typeof locked;
          }) => Promise<unknown>,
        ) => work({ getRepository: () => locked }),
      },
    });
    await expect(
      service.status(crew.id, ownerId, {
        state: 'eating',
        clientAt: new Date(Date.now() - 1000).toISOString(),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(locked.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
    );
  });

  it('returns identical 404s for unknown and expired invitations', async () => {
    const { service, crewRepository } = setup();
    crewRepository.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({
      ...crew,
      inviteExpiresAt: new Date(Date.now() - 1000),
    });
    await expect(service.invite('K7P2QX')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.invite('K7P2QX')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('returns the current member status for an identical clientAt retry', async () => {
    const { service, crewRepository, memberRepository } = setup();
    const clientAt = new Date();
    const member = {
      crewId: crew.id,
      userId: ownerId,
      zoneId: 'zon_test',
      state: 'here',
      statusUpdatedAt: clientAt,
    };
    memberRepository.findOne.mockResolvedValue(member);
    const locked = {
      findOne: jest.fn().mockResolvedValue(member),
      save: jest.fn(),
    };
    Object.assign(crewRepository, {
      manager: {
        transaction: (
          work: (manager: {
            getRepository: () => typeof locked;
          }) => Promise<unknown>,
        ) => work({ getRepository: () => locked }),
      },
    });
    await expect(
      service.status(crew.id, ownerId, {
        zoneId: 'zon_test',
        state: 'here',
        clientAt: clientAt.toISOString(),
      }),
    ).resolves.toEqual({
      userId: ownerId,
      zoneId: 'zon_test',
      state: 'here',
      updatedAt: clientAt,
    });
    expect(locked.save).not.toHaveBeenCalled();
  });

  it('replays a keyed status once and rejects reusing the key with another body', async () => {
    const { service, crewRepository, memberRepository } = setup();
    const member = {
      crewId: crew.id,
      userId: ownerId,
      zoneId: null,
      state: null,
      statusUpdatedAt: null,
    };
    memberRepository.findOne.mockResolvedValue(member);
    let saved: Partial<CrewStatusIdempotency> | null = null;
    const idempotency = {
      findOne: jest.fn().mockImplementation(() => Promise.resolve(saved)),
      save: jest.fn().mockImplementation((row: CrewStatusIdempotency) => {
        saved = { ...row };
        return Promise.resolve(row);
      }),
    };
    const memberRows = {
      findOne: jest.fn().mockResolvedValue(member),
      save: jest
        .fn()
        .mockImplementation((row: CrewMember) => Promise.resolve(row)),
    };
    const testManager = {
      query: jest.fn().mockResolvedValue([]),
      getRepository: (entity: unknown) =>
        entity === Crew
          ? { findOne: jest.fn().mockResolvedValue(crew) }
          : entity === CrewMember
            ? memberRows
            : idempotency,
    };
    Object.assign(crewRepository, {
      manager: {
        transaction: (
          work: (manager: typeof testManager) => Promise<unknown>,
        ) => work(testManager),
      },
    });
    const body = { state: 'here' as const, clientAt: new Date().toISOString() };
    const first = await service.status(crew.id, ownerId, body, 'request-1');
    await expect(
      service.status(crew.id, ownerId, body, 'request-1'),
    ).resolves.toEqual(first);
    await expect(
      service.status(
        crew.id,
        ownerId,
        { clientAt: body.clientAt, state: 'here' },
        'request-1',
      ),
    ).resolves.toEqual(first);
    expect(memberRows.save).toHaveBeenCalledTimes(1);
    expect(idempotency.save).toHaveBeenCalledTimes(1);
    await expect(
      service.status(
        crew.id,
        ownerId,
        { ...body, state: 'eating' },
        'request-1',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(memberRows.save).toHaveBeenCalledTimes(1);
    memberRows.findOne.mockResolvedValueOnce(null);
    await expect(
      service.status(crew.id, ownerId, body, 'request-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns the current leaving status when a retry includes an ignored zoneId', async () => {
    const { service, crewRepository, memberRepository } = setup();
    const clientAt = new Date();
    const member = {
      crewId: crew.id,
      userId: ownerId,
      zoneId: null,
      state: 'leaving',
      statusUpdatedAt: clientAt,
    };
    memberRepository.findOne.mockResolvedValue(member);
    const locked = {
      findOne: jest.fn().mockResolvedValue(member),
      save: jest.fn(),
    };
    Object.assign(crewRepository, {
      manager: {
        transaction: (
          work: (manager: {
            getRepository: () => typeof locked;
          }) => Promise<unknown>,
        ) => work({ getRepository: () => locked }),
      },
    });
    await expect(
      service.status(crew.id, ownerId, {
        state: 'leaving',
        zoneId: 'zon_test',
        clientAt: clientAt.toISOString(),
      }),
    ).resolves.toEqual({
      userId: ownerId,
      zoneId: null,
      state: 'leaving',
      updatedAt: clientAt,
    });
    expect(locked.save).not.toHaveBeenCalled();
  });

  it('locks the crew before a member status and rejects a newly archived crew', async () => {
    const { service, crewRepository, memberRepository } = setup();
    memberRepository.findOne.mockResolvedValue({
      crewId: crew.id,
      userId: ownerId,
    });
    const events: string[] = [];
    const crewRows = {
      findOne: jest.fn().mockImplementation(() => {
        events.push('crew-lock');
        return Promise.resolve({ ...crew, archivedAt: new Date() });
      }),
    };
    const memberRows = {
      findOne: jest.fn().mockImplementation(() => {
        events.push('member-check');
        return Promise.resolve({ crewId: crew.id, userId: ownerId });
      }),
      save: jest.fn(),
    };
    Object.assign(crewRepository, {
      manager: {
        transaction: (
          work: (manager: {
            getRepository: (entity: unknown) => unknown;
          }) => Promise<unknown>,
        ) =>
          work({
            getRepository: (entity) =>
              entity === Crew ? crewRows : memberRows,
          }),
      },
    });
    await expect(
      service.status(crew.id, ownerId, {
        state: 'here',
        clientAt: new Date().toISOString(),
      }),
    ).rejects.toBeInstanceOf(GoneException);
    expect(events).toEqual(['crew-lock', 'member-check']);
    expect(memberRows.save).not.toHaveBeenCalled();
  });

  it('returns the same crew to an existing member even after invite expiry and ignores nickname changes', async () => {
    const { service, crewRepository, memberRepository } = setup();
    const expired = { ...crew, inviteExpiresAt: new Date(Date.now() - 1000) };
    const crewRows = { findOne: jest.fn().mockResolvedValue(expired) };
    const memberRows = {
      findOne: jest
        .fn()
        .mockResolvedValue({ crewId: crew.id, userId: ownerId }),
      save: jest.fn(),
      count: jest.fn(),
    };
    Object.assign(crewRepository, {
      manager: {
        transaction: (
          work: (manager: {
            getRepository: (entity: unknown) => unknown;
          }) => Promise<unknown>,
        ) =>
          work({
            getRepository: (entity) =>
              entity === Crew ? crewRows : memberRows,
          }),
      },
    });
    memberRepository.find.mockResolvedValue([
      {
        crewId: crew.id,
        userId: ownerId,
        nickname: '기존 이름',
        joinedAt: new Date(),
      },
    ]);
    const result = await service.join(ownerId, {
      inviteCode: crew.inviteCode,
      nickname: '',
    });
    expect(result.id).toBe(crew.id);
    expect(result.members[0].nickname).toBe('기존 이름');
    expect(memberRows.save).not.toHaveBeenCalled();
    expect(memberRows.count).not.toHaveBeenCalled();
  });

  it('locks the crew before transferring ownership to a current member', async () => {
    const { service, crewRepository, memberRepository } = setup();
    memberRepository.findOne.mockImplementation(
      ({ where }: { where: { userId: string } }) =>
        Promise.resolve({ crewId: crew.id, userId: where.userId }),
    );
    const operations: string[] = [];
    const lockedCrew = { ...crew };
    const lockedCrewRepository = {
      findOne: jest.fn().mockImplementation(() => {
        operations.push('lock-crew');
        return Promise.resolve(lockedCrew);
      }),
      save: jest
        .fn()
        .mockImplementation((value: Crew) => Promise.resolve(value)),
    };
    const lockedMemberRepository = {
      findOne: jest.fn().mockImplementation(() => {
        operations.push('read-member');
        return Promise.resolve({ crewId: crew.id, userId: otherId });
      }),
    };
    Object.assign(crewRepository, {
      manager: {
        transaction: (
          work: (manager: {
            getRepository: (entity: unknown) => unknown;
          }) => Promise<unknown>,
        ) =>
          work({
            getRepository: (entity) =>
              entity === Crew ? lockedCrewRepository : lockedMemberRepository,
          }),
      },
    });
    await service.transfer(crew.id, ownerId, otherId);
    expect(operations).toEqual(['lock-crew', 'read-member', 'read-member']);
    expect(lockedCrewRepository.findOne).toHaveBeenCalledWith({
      where: { id: crew.id },
      lock: { mode: 'pessimistic_write' },
    });
    expect(lockedCrewRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: otherId }),
    );
  });

  it('refuses to remove an owner even when another member requested removal', async () => {
    const { service, crewRepository, memberRepository } = setup();
    memberRepository.findOne.mockResolvedValue({
      crewId: crew.id,
      userId: ownerId,
    });
    const lockedCrewRepository = {
      findOne: jest.fn().mockResolvedValue({ ...crew }),
    };
    Object.assign(crewRepository, {
      manager: {
        transaction: (
          work: (manager: {
            getRepository: () => typeof lockedCrewRepository;
          }) => Promise<unknown>,
        ) => work({ getRepository: () => lockedCrewRepository }),
      },
    });
    await expect(
      service.removeMember(crew.id, ownerId, ownerId),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(lockedCrewRepository.findOne).toHaveBeenCalledWith({
      where: { id: crew.id },
      lock: { mode: 'pessimistic_write' },
    });
  });

  it('does not gather after the caller loses membership before the crew lock', async () => {
    const { service, crewRepository, memberRepository } = setup();
    memberRepository.findOne.mockResolvedValue({
      crewId: crew.id,
      userId: ownerId,
    });
    const lockedCrewRepository = {
      findOne: jest.fn().mockResolvedValue({ ...crew }),
    };
    const lockedMemberRepository = {
      findOne: jest.fn().mockResolvedValue(null),
    };
    const gatherRepository = { create: jest.fn(), save: jest.fn() };
    Object.assign(crewRepository, {
      manager: {
        transaction: (
          work: (manager: {
            getRepository: (entity: unknown) => unknown;
          }) => Promise<unknown>,
        ) =>
          work({
            getRepository: (entity) =>
              entity === Crew
                ? lockedCrewRepository
                : entity === CrewMember
                  ? lockedMemberRepository
                  : gatherRepository,
          }),
      },
    });
    await expect(
      service.gather(crew.id, ownerId, 'zon_test'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(lockedCrewRepository.findOne).toHaveBeenCalledWith({
      where: { id: crew.id },
      lock: { mode: 'pessimistic_write' },
    });
    expect(gatherRepository.save).not.toHaveBeenCalled();
  });
});
