import { buildDeeplink } from './deeplink';

describe('buildDeeplink', () => {
  it('builds the festival URL the iOS widget link already opens', () => {
    expect(
      buildDeeplink({ type: 'festival', festivalId: 'fst_12345678' }),
    ).toBe('festicore://festival/fst_12345678');
  });

  it('builds a saved performance URL under the festival', () => {
    expect(
      buildDeeplink({
        type: 'set',
        festivalId: 'fst_12345678',
        setId: 'set_a1b2c3d4',
      }),
    ).toBe('festicore://festival/fst_12345678/set/set_a1b2c3d4');
  });

  it('percent-encodes IDs so they cannot add path segments', () => {
    expect(
      buildDeeplink({ type: 'set', festivalId: 'fst_1', setId: 'a/b?c' }),
    ).toBe('festicore://festival/fst_1/set/a%2Fb%3Fc');
  });
});
