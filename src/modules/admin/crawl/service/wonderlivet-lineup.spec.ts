import {
  parseWonderlivetLineup,
  WONDERLIVET_IMAGE_ORIGIN,
} from './wonderlivet-lineup';

const image = (day: string, id: string) =>
  `${WONDERLIVET_IMAGE_ORIGIN}/lineup/artists/production/live/${day}/${id}.webp`;

function fixture(artists: unknown[], state = 'ready') {
  return JSON.stringify({
    result: {
      data: {
        json: { dataState: state, isComingSoon: false, artists },
        meta: { values: {} },
      },
    },
  });
}

describe('parseWonderlivetLineup', () => {
  it('reads published official artists and exact image URLs from the tRPC envelope', () => {
    const body = fixture([
      {
        name: 'First Act',
        performanceDay: 'DAY1',
        isPublished: true,
        imageUrl: image('day1', 'first-123'),
      },
      {
        name: 'Unpublished Act',
        performanceDay: 'DAY2',
        isPublished: false,
        imageUrl: null,
      },
      {
        name: 'Second Act',
        performanceDay: 'DAY3',
        isPublished: true,
        imageUrl: image('day3', 'second-456'),
      },
    ]);
    expect(
      parseWonderlivetLineup(body).map(({ artistName, imageUrl }) => [
        artistName,
        imageUrl.href,
      ]),
    ).toEqual([
      ['First Act', image('day1', 'first-123')],
      ['Second Act', image('day3', 'second-456')],
    ]);
  });

  it('rejects the observed upstream DB error and incomplete lineup without returning partial entries', () => {
    expect(() =>
      parseWonderlivetLineup(
        JSON.stringify({ error: { json: { message: 'Failed query' } } }),
      ),
    ).toThrow();
    expect(() => parseWonderlivetLineup(fixture([], 'ready'))).toThrow();
    expect(() =>
      parseWonderlivetLineup(
        fixture([
          {
            name: 'Valid Act',
            performanceDay: 'DAY1',
            isPublished: true,
            imageUrl: image('day1', 'valid'),
          },
          {
            name: 'Bad Act',
            performanceDay: 'DAY2',
            isPublished: true,
            imageUrl: 'https://evil.example.com/bad.webp',
          },
        ]),
      ),
    ).toThrow('이미지 출처');
  });

  it('rejects normalized duplicate names and mismatched day paths', () => {
    expect(() =>
      parseWonderlivetLineup(
        fixture([
          {
            name: 'Act A',
            performanceDay: 'DAY1',
            isPublished: true,
            imageUrl: image('day1', 'first'),
          },
          {
            name: 'ＡＣＴ Ａ',
            performanceDay: 'DAY2',
            isPublished: true,
            imageUrl: image('day2', 'second'),
          },
        ]),
      ),
    ).toThrow('중복');
    expect(() =>
      parseWonderlivetLineup(
        fixture([
          {
            name: 'Act A',
            performanceDay: 'DAY1',
            isPublished: true,
            imageUrl: image('day2', 'first'),
          },
        ]),
      ),
    ).toThrow('이미지 출처');
  });
});
