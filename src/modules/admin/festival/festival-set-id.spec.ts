import { festivalSetId } from './festival-set-id';

describe('festivalSetId', () => {
  it('gives legacy published sets a stable ID and preserves explicit IDs', () => {
    const set = {
      stageId: 'stg_main',
      artist: '밴드',
      startsAt: '2026-10-24T13:00:00+09:00',
      endsAt: '2026-10-24T14:00:00+09:00',
    };
    expect(festivalSetId(set)).toMatch(/^set_[0-9a-f]{16}$/);
    expect(festivalSetId({ ...set, note: 'new note' })).toBe(
      festivalSetId(set),
    );
    expect(
      festivalSetId({ ...set, startsAt: '2026-10-24T13:30:00+09:00' }),
    ).not.toBe(festivalSetId(set));
    expect(festivalSetId({ ...set, id: 'set_existing' })).toBe('set_existing');
  });
});
