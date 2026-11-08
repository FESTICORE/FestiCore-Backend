import { validateDraft } from '../modules/admin/festival/festival-validation';
import { seedMapStages, seedZones } from './seed-zone-map';

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
});
