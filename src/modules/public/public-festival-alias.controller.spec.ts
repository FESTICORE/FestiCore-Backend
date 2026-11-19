import { PublicFestivalController } from './public-festival.controller';

const canonical = 'fst_c39663182b10a105';
const alias = 'fst_c6dacea8997cd72b';

function fixture() {
  const festival = {
    list: jest.fn().mockResolvedValue({
      items: [{ id: canonical, name: 'COUNTDOWN FANTASY 2026-2027' }],
      nextCursor: null,
    }),
    etag: jest.fn().mockReturnValue('hash'),
  };
  const live = {
    board: jest.fn().mockResolvedValue({
      body: { festivalId: canonical },
      etag: 'live',
    }),
  };
  const auth = { resolveOptionalPrincipal: jest.fn().mockResolvedValue({}) };
  const devices = {
    listSubscriptions: jest.fn().mockResolvedValue({
      items: [{ festivalId: alias, pinned: true }],
    }),
  };
  const headers = new Map<string, string>();
  const response = {
    setHeader: jest.fn((name: string, value: string) => {
      headers.set(name, value);
    }),
    hasHeader: jest.fn((name: string) => headers.has(name)),
    json: jest.fn((body: unknown) => body),
  };
  const controller = new PublicFestivalController(
    festival as never,
    live as never,
    auth as never,
    devices as never,
  );
  return { controller, festival, live, response };
}

describe('COUNTDOWN 공개 ID 별칭', () => {
  it('keeps an existing alias pin visible on the canonical catalog item', async () => {
    const { controller, response } = fixture();
    await controller.list(
      undefined,
      undefined,
      undefined,
      { header: () => 'device-id' } as never,
      response as never,
    );
    const envelope = response.json.mock.calls[0][0] as {
      data: { items: { id: string; pinned: boolean }[] };
    };
    expect(envelope.data.items[0]).toMatchObject({
      id: canonical,
      pinned: true,
    });
  });

  it('loads an old festival live URL through the canonical ID', async () => {
    const { controller, live, response } = fixture();
    await controller.live(
      alias,
      'device-id',
      undefined,
      undefined,
      response as never,
    );
    expect(live.board).toHaveBeenCalledWith(canonical, 'device-id', undefined);
  });
});
