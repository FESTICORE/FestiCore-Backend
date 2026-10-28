import { venuePoint, verifiedVenueLocation } from './festival-location';

describe('festival venue location', () => {
  const point = {
    latitude: 37.66469544695199,
    longitude: 126.742064181796,
    label: 'KINTEX HALL 7/8/9/10',
  };
  const source = {
    name: '멜론티켓',
    url: 'https://ticket.melon.com/performance/index.htm?prodId=213793',
    verifiedAt: '2026-10-28T11:00:00.000Z',
  };

  it('accepts a finite coordinate pair with a verified HTTPS source', () => {
    expect(venuePoint(point)).toEqual(point);
    expect(
      verifiedVenueLocation({ ...point, source, internalSecret: 'hidden' }),
    ).toEqual({ ...point, source });
  });

  it.each([
    { ...point, latitude: 91 },
    { ...point, longitude: -181 },
    { ...point, latitude: Number.NaN },
    { ...point, latitude: '37.66' },
    { ...point, label: ' ' },
  ])('rejects an invalid point', (invalid) => {
    expect(venuePoint(invalid)).toBeNull();
    expect(verifiedVenueLocation({ ...invalid, source })).toBeNull();
  });

  it('rejects missing or insecure source evidence', () => {
    expect(verifiedVenueLocation(point)).toBeNull();
    expect(
      verifiedVenueLocation({
        ...point,
        source: { ...source, url: 'http://ticket.melon.com/' },
      }),
    ).toBeNull();
    expect(
      verifiedVenueLocation({
        ...point,
        source: { ...source, verifiedAt: 'yesterday' },
      }),
    ).toBeNull();
  });
});
