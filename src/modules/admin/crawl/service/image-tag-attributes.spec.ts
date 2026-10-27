import { imageTagAttributes } from './image-tag-attributes';

describe('image tag attributes', () => {
  it('does not treat another quoted attribute value as an image source', () => {
    const tag = `<img alt="x data-src='https://cdnimg.melon.co.kr/artist/false.jpg'" src="https://cdnimg.melon.co.kr/artist/real.jpg">`;
    expect(imageTagAttributes(tag, ['data-src', 'src'])).toEqual([
      'https://cdnimg.melon.co.kr/artist/real.jpg',
    ]);
  });

  it('prefers a real lazy image independent of attribute order', () => {
    const tag = `<img src="/placeholder.gif" alt="artist" data-src='https://cdnimg.melon.co.kr/artist/real.jpg'>`;
    expect(imageTagAttributes(tag, ['data-src', 'src'])).toEqual([
      'https://cdnimg.melon.co.kr/artist/real.jpg',
      '/placeholder.gif',
    ]);
  });
});
