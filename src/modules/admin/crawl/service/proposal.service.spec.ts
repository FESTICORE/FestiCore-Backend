import { AdminFestival } from '../../festival/festival.entity';
import { CrawlSource } from '../entity/crawl-source.entity';
import { Proposal, ProposalItem } from '../entity/proposal.entity';
import { ProposalService } from './proposal.service';

const day = {
  date: '2026-11-20',
  startsAt: '2026-11-20T12:00:00+09:00',
  endsAt: '2026-11-20T20:00:00+09:00',
};

function harness(
  after: unknown,
  options: { existing?: boolean; bound?: boolean } = {},
) {
  const item: ProposalItem = {
    id: '0',
    op: 'add',
    path: '/',
    before: null,
    after,
    decision: 'pending',
    decidedBy: null,
    decidedAt: null,
  };
  const proposal = {
    id: 'proposal-1',
    festivalId: null,
    sourceId: 'source-1',
    kind: 'festival.new',
    status: 'open',
    items: [item],
  } as unknown as Proposal;
  const source = {
    id: 'source-1',
    festivalId: options.bound ? 'fst_existing' : null,
    kind: 'discovery',
    url: 'https://tickets.example.com/festivals',
    parserConfig: { sourceName: '예매처' },
  } as unknown as CrawlSource;
  const festivalRepo = {
    create: jest.fn((value: unknown) => value),
    save: jest.fn((value: unknown) => Promise.resolve(value)),
    createQueryBuilder: jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      getOne: jest
        .fn()
        .mockResolvedValue(options.existing ? { id: 'fst_existing' } : null),
    })),
  };
  const proposalRepo = {
    findOne: jest.fn().mockResolvedValue(proposal),
    save: jest.fn((value: unknown) => Promise.resolve(value)),
  };
  const manager = {
    getRepository: jest.fn((entity: unknown) => {
      if (entity === Proposal) return proposalRepo;
      if (entity === CrawlSource)
        return { findOneBy: jest.fn().mockResolvedValue(source) };
      if (entity === AdminFestival) return festivalRepo;
      throw new Error('unexpected repository');
    }),
    query: jest.fn().mockResolvedValue([]),
  };
  const dataSource = {
    transaction: jest.fn((fn: (value: typeof manager) => unknown) =>
      fn(manager),
    ),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new ProposalService(
    {} as never,
    dataSource as never,
    audit as never,
  );
  return {
    service,
    proposal,
    item,
    festivalRepo,
    proposalRepo,
    manager,
    audit,
  };
}

describe('ProposalService festival discovery', () => {
  it('audits dismissal in the proposal transaction', async () => {
    const { service, proposal, manager, audit } = harness({});

    await expect(
      service.dismiss(proposal.id, ' duplicate ', 'admin-1'),
    ).resolves.toBe(proposal);
    expect(audit.record).toHaveBeenCalledWith(manager, {
      actor: 'admin-1',
      action: 'crawl.proposal.dismissed',
      target: `proposal:${proposal.id}`,
      before: { status: 'open', pendingItemIds: ['0'] },
      after: { status: 'rejected', reason: 'duplicate' },
    });
  });

  it('creates an unpublished validated draft for a complete accepted entry', async () => {
    const { service, item, festivalRepo, proposalRepo, manager, audit } =
      harness({
        name: '가을 페스티벌',
        venue: '서울 공연장',
        days: [day],
        url: 'https://tickets.example.com/festival/1',
      });

    const result = await service.decide(
      'proposal-1',
      [{ itemId: '0', decision: 'accepted' }],
      'admin-1',
    );

    expect(result.conflicts).toEqual([]);
    expect(result.proposal.status).toBe('applied');
    expect(item.decision).toBe('accepted');
    const saved = festivalRepo.save.mock.calls[0]?.[0] as AdminFestival;
    expect(saved.id).toMatch(/^fst_[0-9a-z]{8}$/);
    expect(saved.draftVersion).toBe(1);
    expect(saved.draftUpdatedBy).toBe('admin-1');
    expect(saved.published).toBeNull();
    expect(saved.publishedVersion).toBe(0);
    expect(saved.draft.name).toBe('가을 페스티벌');
    expect(saved.draft.venue).toBe('서울 공연장');
    expect(saved.draft.days).toEqual([day]);
    expect((saved.draft.source as { url: string }).url).toBe(
      'https://tickets.example.com/festival/1',
    );
    expect(proposalRepo.save).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(manager, {
      actor: 'admin-1',
      action: 'festival.created',
      target: `festival:${saved.id}`,
      before: null,
      after: { draftVersion: 1, draft: saved.draft },
    });
    expect(audit.record).toHaveBeenCalledWith(manager, {
      actor: 'admin-1',
      action: 'crawl.proposal.decided',
      target: 'proposal:proposal-1',
      before: {
        status: 'open',
        decisions: [{ itemId: '0', decision: 'pending' }],
      },
      after: {
        status: 'applied',
        decisions: [{ itemId: '0', decision: 'accepted' }],
        festivalId: saved.id,
        draftVersion: 1,
        conflicts: [],
      },
    });
  });

  it('accepts a 17-day NOL World date range without inventing show times', async () => {
    const { service, item, festivalRepo } = harness({
      name: '함평 겨울 행사',
      venue: '함평',
      date: '2026.10.23 - 2026.11.08',
      url: 'https://world.nol.com/en/ticket/products/26014860',
    });
    const result = await service.decide(
      'proposal-1',
      [{ itemId: '0', decision: 'accepted' }],
      'admin-1',
    );
    expect(result.conflicts).toEqual([]);
    expect(item.decision).toBe('accepted');
    const saved = festivalRepo.save.mock.calls[0]?.[0] as AdminFestival;
    expect(saved.draft.days).toEqual([]);
    expect(saved.draft.eventPeriod).toEqual({
      firstDate: '2026-10-23',
      lastDate: '2026-11-08',
    });
    expect(saved.publishedVersion).toBe(0);
  });

  it('requires reviewed timed days to include both source period endpoints', async () => {
    const candidate = {
      name: '함평 겨울 행사',
      venue: '함평',
      date: '2026.10.23 - 2026.11.08',
      url: 'https://world.nol.com/en/ticket/products/26014860',
    };
    const firstDay = {
      date: '2026-10-23',
      startsAt: '2026-10-23T12:00:00+09:00',
      endsAt: '2026-10-23T20:00:00+09:00',
    };
    const lastDay = {
      date: '2026-11-08',
      startsAt: '2026-11-08T12:00:00+09:00',
      endsAt: '2026-11-08T20:00:00+09:00',
    };
    const partial = harness(candidate);
    const rejected = await partial.service.decide(
      'proposal-1',
      [{ itemId: '0', decision: 'accepted', after: { days: [firstDay] } }],
      'admin-1',
    );
    expect(rejected.conflicts[0]?.reason).toContain('첫날과 마지막 날');
    expect(partial.item.decision).toBe('pending');
    expect(partial.festivalRepo.save).not.toHaveBeenCalled();

    const complete = harness(candidate);
    const accepted = await complete.service.decide(
      'proposal-1',
      [
        {
          itemId: '0',
          decision: 'accepted',
          after: { days: [firstDay, lastDay] },
        },
      ],
      'admin-1',
    );
    expect(accepted.conflicts).toEqual([]);
    const saved = complete.festivalRepo.save.mock
      .calls[0]?.[0] as AdminFestival;
    expect(saved.draft.days).toEqual([firstDay, lastDay]);
    expect(saved.draft.eventPeriod).toEqual({
      firstDate: firstDay.date,
      lastDate: lastDay.date,
    });
  });

  it('does not treat an explicitly null day list as a date-only draft', async () => {
    const { service, item, festivalRepo } = harness({
      name: '함평 겨울 행사',
      venue: '함평',
      date: '2026.10.23 - 2026.11.08',
      url: 'https://world.nol.com/en/ticket/products/26014860',
    });
    const result = await service.decide(
      'proposal-1',
      [{ itemId: '0', decision: 'accepted', after: { days: null } }],
      'admin-1',
    );
    expect(result.conflicts[0]?.reason).toContain('days');
    expect(item.decision).toBe('pending');
    expect(festivalRepo.save).not.toHaveBeenCalled();
  });

  it('keeps an overlong NOL World period pending', async () => {
    const { service, item, festivalRepo } = harness({
      name: '장기 행사',
      venue: '함평',
      date: '2026.10.23 - 2026.11.24',
      url: 'https://world.nol.com/en/ticket/products/26014860',
    });
    const result = await service.decide(
      'proposal-1',
      [{ itemId: '0', decision: 'accepted', after: { days: [day] } }],
      'admin-1',
    );
    expect(result.conflicts).toHaveLength(1);
    expect(item.decision).toBe('pending');
    expect(festivalRepo.save).not.toHaveBeenCalled();
  });

  it('keeps an incomplete discovery entry pending for review', async () => {
    const { service, item, festivalRepo } = harness({
      name: '가을 페스티벌',
      url: 'https://tickets.example.com/festival/1',
    });

    const result = await service.decide(
      'proposal-1',
      [{ itemId: '0', decision: 'accepted' }],
      'admin-1',
    );

    expect(result.conflicts[0]?.itemId).toBe('0');
    expect(result.conflicts[0]?.reason).toContain('venue');
    expect(item.decision).toBe('pending');
    expect(result.proposal.status).toBe('open');
    expect(festivalRepo.save).not.toHaveBeenCalled();
  });

  it('uses reviewed venue and days while preserving the discovered source URL', async () => {
    const { service, item, festivalRepo } = harness({
      name: '가을 페스티벌',
      url: 'https://tickets.example.com/festival/1',
    });

    const result = await service.decide(
      'proposal-1',
      [
        {
          itemId: '0',
          decision: 'accepted',
          after: { venue: '서울 공연장', days: [day] },
        },
      ],
      'admin-1',
    );

    expect(result.conflicts).toEqual([]);
    expect(item.decision).toBe('accepted');
    const saved = festivalRepo.save.mock.calls[0]?.[0] as AdminFestival;
    expect(saved.draft.venue).toBe('서울 공연장');
    expect(saved.draft.days).toEqual([day]);
    expect((saved.draft.source as { url: string }).url).toBe(
      'https://tickets.example.com/festival/1',
    );
  });

  it('rejects reviewed values that try to replace the discovered URL', async () => {
    const { service, item, festivalRepo } = harness({
      name: '가을 페스티벌',
      url: 'https://tickets.example.com/festival/1',
    });

    const result = await service.decide(
      'proposal-1',
      [
        {
          itemId: '0',
          decision: 'accepted',
          after: {
            venue: '서울 공연장',
            days: [day],
            url: 'https://attacker.example.com',
          },
        },
      ],
      'admin-1',
    );

    expect(result.conflicts[0]?.reason).toContain('날짜만');
    expect(item.decision).toBe('pending');
    expect(festivalRepo.save).not.toHaveBeenCalled();
  });

  it('does not create a second draft for the same discovered URL', async () => {
    const { service, item, festivalRepo } = harness(
      {
        name: '가을 페스티벌',
        venue: '서울 공연장',
        days: [day],
        url: 'https://tickets.example.com/festival/1',
      },
      { existing: true },
    );

    const result = await service.decide(
      'proposal-1',
      [{ itemId: '0', decision: 'accepted' }],
      'admin-1',
    );

    expect(result.conflicts).toEqual([
      expect.objectContaining({
        reason: '같은 축제 URL의 초안이 이미 있습니다.',
      }),
    ]);
    expect(item.decision).toBe('pending');
    expect(festivalRepo.save).not.toHaveBeenCalled();
  });

  it('rejects a discovery proposal attached to an existing festival source', async () => {
    const { service, item, festivalRepo } = harness(
      {
        name: '가을 페스티벌',
        venue: '서울 공연장',
        days: [day],
        url: 'https://tickets.example.com/festival/1',
      },
      { bound: true },
    );

    const result = await service.decide(
      'proposal-1',
      [{ itemId: '0', decision: 'accepted' }],
      'admin-1',
    );

    expect(result.conflicts).toEqual([
      expect.objectContaining({
        reason: '발견 제안의 출처가 올바르지 않습니다.',
      }),
    ]);
    expect(item.decision).toBe('pending');
    expect(festivalRepo.save).not.toHaveBeenCalled();
  });
});

describe('ProposalService timetable removals', () => {
  it('accepts two removals by set id after the first removal shifts array indexes', async () => {
    const sets = [
      {
        id: 'set_a',
        stageId: 'stg_12345678',
        artist: 'A',
        startsAt: '2026-11-20T13:00:00+09:00',
        endsAt: '2026-11-20T14:00:00+09:00',
        crawlSourceId: 'source-1',
      },
      {
        id: 'set_b',
        stageId: 'stg_12345678',
        artist: 'B',
        startsAt: '2026-11-20T14:00:00+09:00',
        endsAt: '2026-11-20T15:00:00+09:00',
        crawlSourceId: 'source-1',
      },
    ];
    const festival = {
      id: 'fst_12345678',
      draftVersion: 1,
      draft: {
        id: 'fst_12345678',
        name: 'Festival',
        venue: 'Venue',
        timezone: 'Asia/Seoul',
        days: [day],
        flagsEnabled: false,
        stages: [{ id: 'stg_12345678', name: 'Main', order: 1 }],
        sets,
        zones: [],
        flags: [],
        checklist: [],
        rules: [],
        mapImageUrl: null,
        mapAspect: null,
        source: { name: 'Official', verifiedAt: '2026-11-18T12:00:00+09:00' },
      },
    } as unknown as AdminFestival;
    const originalDraft = structuredClone(festival.draft);
    const proposal = {
      id: 'proposal-1',
      festivalId: festival.id,
      sourceId: 'source-1',
      kind: 'sets.diff',
      status: 'open',
      items: sets.map((set, index) => ({
        id: set.id,
        op: 'remove',
        path: `/sets/${index}`,
        before: set,
        after: null,
        decision: 'pending',
        decidedBy: null,
        decidedAt: null,
      })),
    } as unknown as Proposal;
    const manager = {
      getRepository: jest.fn((entity: unknown) => {
        if (entity === Proposal)
          return {
            findOne: jest.fn().mockResolvedValue(proposal),
            save: jest
              .fn()
              .mockImplementation((value: unknown) => Promise.resolve(value)),
          };
        if (entity === AdminFestival)
          return {
            findOne: jest.fn().mockResolvedValue(festival),
            save: jest
              .fn()
              .mockImplementation((value: unknown) => Promise.resolve(value)),
          };
        if (entity === CrawlSource)
          return {
            findOneBy: jest.fn().mockResolvedValue({
              id: 'source-1',
              kind: 'timetable',
              url: 'https://festival.example.com/timetable',
              parserConfig: { sourceName: 'Official' },
            }),
          };
        throw new Error('unexpected repository');
      }),
    };
    const dataSource = {
      transaction: jest.fn((fn: (value: typeof manager) => unknown) =>
        fn(manager),
      ),
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const service = new ProposalService(
      {} as never,
      dataSource as never,
      audit as never,
    );

    const result = await service.decide(
      'proposal-1',
      [
        { itemId: 'set_a', decision: 'accepted' },
        { itemId: 'set_b', decision: 'accepted' },
      ],
      'admin-1',
    );

    expect(result.conflicts).toEqual([]);
    expect(festival.draft.sets).toEqual([]);
    expect(result.proposal.status).toBe('applied');
    expect(audit.record).toHaveBeenCalledWith(manager, {
      actor: 'admin-1',
      action: 'festival.draft.updated',
      target: `festival:${festival.id}`,
      before: { draftVersion: 1, draft: originalDraft },
      after: { draftVersion: 2, draft: festival.draft },
    });
  });
});
