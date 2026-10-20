import { checkedUrl, isPublicAddress, robotsAllows } from './crawl-fetch';

describe('crawl target safety', () => {
  it('accepts only credential-free HTTPS public hostnames', () => {
    expect(checkedUrl('https://festival.example.com/notice').hostname).toBe(
      'festival.example.com',
    );
    expect(() => checkedUrl('http://festival.example.com')).toThrow();
    expect(() => checkedUrl('https://localhost/admin')).toThrow();
    expect(() => checkedUrl('https://127.0.0.1/admin')).toThrow();
    expect(() =>
      checkedUrl('https://user:pass@festival.example.com'),
    ).toThrow();
  });

  it('rejects non-public IPv6 DNS answers', () => {
    for (const address of [
      'fec0::1',
      'ff02::1',
      'fe80::1',
      'fc00::1',
      '::1',
      '2001:db8::1',
    ]) {
      expect(isPublicAddress(address)).toBe(false);
    }
    expect(isPublicAddress('2606:4700:4700::1111')).toBe(true);
  });

  it('follows the longest matching robots rule and specific user agent', () => {
    const robots = `User-agent: *\nDisallow: /private\nAllow: /private/public\n\nUser-agent: FestiCoreCrawler\nDisallow: /blocked/*\nAllow: /blocked/allowed$`;
    expect(robotsAllows(robots, '/blocked/foo')).toBe(false);
    expect(robotsAllows(robots, '/blocked/allowed')).toBe(true);
    expect(robotsAllows(robots, '/private/page')).toBe(true);
    expect(
      robotsAllows(
        'User-agent: *\nDisallow: /private\nAllow: /private/public',
        '/private/page',
      ),
    ).toBe(false);
    expect(
      robotsAllows(
        'User-agent: *\nDisallow: /private\nAllow: /private/public',
        '/private/public',
      ),
    ).toBe(true);
  });
});
