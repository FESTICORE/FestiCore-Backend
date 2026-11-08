import { validateDraft } from '../modules/admin/festival/festival-validation';
import { liveTodayPlan, seedMapStages, seedZones } from './seed-zone-map';

describe('zone map seed', () => {
  it('builds ten zones and stage headers that pass draft validation', () => {
    const zones = seedZones();
    const draft = {
      name: 'Festival',
      venue: 'Venue',
      timezone: 'Asia/Seoul',
      days: [
        {
          date: '2026-11-20',
          startsAt: '2026-11-20T12:00:00+09:00',
          endsAt: '2026-11-20T21:40:00+09:00',
        },
      ],
      flagsEnabled: true,
      stages: [
        { id: 'stg_rivet', name: 'RIVET STAGE', order: 1 },
        { id: 'stg_wonder', name: 'WONDER STAGE', order: 2 },
      ],
      sets: [],
      zones,
      flags: [],
      checklist: [],
      rules: [],
      mapImageUrl: null,
      mapAspect: 0.655,
      mapStages: seedMapStages(['stg_rivet', 'stg_wonder']),
      source: { name: 'Official', verifiedAt: '2026-11-18T12:00:00+09:00' },
    };
    expect(zones).toHaveLength(10);
    expect(zones.map((zone) => zone.order)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    expect(zones.find((zone) => zone.id === 'zon_tent')?.landmark).toBe(
      'TENT 무대',
    );
    expect(validateDraft(draft)).toEqual([]);
  });

  it('plans a live day in KST with a now-playing set on every stage', () => {
    for (const iso of [
      '2026-11-08T08:05:00Z',
      '2026-11-08T03:10:00Z',
      '2026-11-08T12:40:00Z',
    ]) {
      const now = new Date(iso);
      const plan = liveTodayPlan(now);
      expect(plan.day.date).toBe(
        new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10),
      );
      for (const stage of plan.stages) {
        const playing = plan.sets.find(
          (set) =>
            set.stageId === stage.id &&
            Date.parse(set.startsAt) <= now.getTime() &&
            now.getTime() < Date.parse(set.endsAt),
        );
        expect(playing?.offset).toBe(0);
        expect(
          plan.sets.some((set) => set.stageId === stage.id && set.offset === 1),
        ).toBe(true);
      }
      const draft = {
        name: 'Festival',
        venue: 'Venue',
        timezone: 'Asia/Seoul',
        days: [plan.day],
        flagsEnabled: true,
        stages: plan.stages,
        sets: plan.sets.map((set) => ({
          stageId: set.stageId,
          artist: set.artist,
          startsAt: set.startsAt,
          endsAt: set.endsAt,
        })),
        zones: [],
        flags: [],
        checklist: [],
        rules: [],
        mapImageUrl: null,
        mapAspect: null,
        source: { name: 'Official', verifiedAt: '2026-11-08T00:00:00Z' },
      };
      expect(validateDraft(draft, true)).toEqual([]);
    }
  });
});
