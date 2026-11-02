import {
  changedDepartures,
  changedDirection,
  packChangesEtag,
} from './public-festival.service';
import { PUBLIC_PACK_PROJECTION_VERSION } from '../redis/service/cache.service';

const pack = (directions: unknown) => ({ directions });
const at = (time: string) => `2026-11-20T${time}:00+09:00`;

describe('pack change summary helpers', () => {
  it('lists only added, removed or changed departure dates in date order', () => {
    const previous = pack({
      lastDepartures: [
        { date: '2026-11-21', shuttleAt: at('23:40'), trainAt: null },
        { date: '2026-11-20', shuttleAt: at('23:40'), trainAt: at('23:52') },
        { date: '2026-11-22', shuttleAt: null, trainAt: at('23:30') },
      ],
    });
    const current = pack({
      lastDepartures: [
        { date: '2026-11-20', shuttleAt: at('23:40'), trainAt: at('23:52') },
        { date: '2026-11-21', shuttleAt: at('23:20'), trainAt: null },
        { date: '2026-11-23', trainAt: at('23:10') },
      ],
    });
    expect(changedDepartures(previous, current)).toEqual([
      {
        date: '2026-11-21',
        before: { shuttleAt: at('23:40'), trainAt: null },
        after: { shuttleAt: at('23:20'), trainAt: null },
      },
      {
        date: '2026-11-22',
        before: { shuttleAt: null, trainAt: at('23:30') },
        after: null,
      },
      {
        date: '2026-11-23',
        before: null,
        after: { shuttleAt: null, trainAt: at('23:10') },
      },
    ]);
  });

  it('returns null when departures are equal or missing on both sides', () => {
    const same = pack({
      lastDepartures: [{ date: '2026-11-20', shuttleAt: at('23:40') }],
    });
    expect(changedDepartures(same, same)).toBeNull();
    expect(changedDepartures(pack(null), pack({}))).toBeNull();
  });

  it('reports single-value direction changes and keys the ETag by from and to versions', () => {
    expect(
      changedDirection(
        pack({ lastTrainAt: at('23:52') }),
        pack({ lastTrainAt: null }),
        'lastTrainAt',
      ),
    ).toEqual({ before: at('23:52'), after: null });
    expect(packChangesEtag(6, 7)).toBe(
      `"cdm${PUBLIC_PACK_PROJECTION_VERSION}-chg6-v7"`,
    );
  });
});
