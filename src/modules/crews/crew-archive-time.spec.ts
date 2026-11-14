import { crewArchiveTime } from './crew-archive-time';

describe('crewArchiveTime', () => {
  it('마지막 공연이 끝난 날의 자정(KST)을 돌려준다', () => {
    const days = [
      { endsAt: '2026-11-21T22:00:00+09:00' },
      { endsAt: '2026-11-22T23:00:00+09:00' },
    ];
    expect(crewArchiveTime(days)).toBe(Date.parse('2026-11-23T00:00:00+09:00'));
  });

  it('자정을 넘겨 끝난 공연은 그다음 자정까지 유지한다', () => {
    const days = [{ endsAt: '2026-11-23T01:00:00+09:00' }];
    expect(crewArchiveTime(days)).toBe(Date.parse('2026-11-24T00:00:00+09:00'));
  });

  it('공연이 정확히 자정에 끝나면 그 자정에 보관한다', () => {
    const days = [{ endsAt: '2026-11-23T00:00:00+09:00' }];
    expect(crewArchiveTime(days)).toBe(Date.parse('2026-11-23T00:00:00+09:00'));
  });

  it('종료 시각이 없으면 보관하지 않는다', () => {
    expect(crewArchiveTime(undefined)).toBe(Infinity);
    expect(crewArchiveTime([{ endsAt: null }, {}])).toBe(Infinity);
  });
});
