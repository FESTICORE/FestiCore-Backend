import { wonderlivetMelonProduct } from './wonderlivet-ticket-link';

const product = 'https://ticket.melon.com/performance/index.htm?prodId=213793';
const page = (
  link = `<a href="${product}">[멜론티켓] 예매페이지 바로가기</a>`,
) =>
  `<html><head><title>WONDERLIVET·원더리벳</title></head><body><main>
   <h1>WONDERLIVET·원더리벳</h1>
   <p>원더리벳 2026 전체 라인업과 타임테이블이 공개되었습니다.</p>
   <a href="https://www.wonderli.vet/">홈페이지 바로가기</a>
   <h2>TICKET</h2>${link}</main></body></html>`;

describe('원더리벳 공식 티켓 링크', () => {
  it('reads the current exact Melon product rather than a fixed product ID', () => {
    expect(wonderlivetMelonProduct(page())).toBe(product);
    expect(
      wonderlivetMelonProduct(page().replace('prodId=213793', 'prodId=214999')),
    ).toBe('https://ticket.melon.com/performance/index.htm?prodId=214999');
  });

  it.each([
    'https://ticket.melon.com/performance/index.htm?prodId=213793&redirect=evil',
    'https://ticket.melon.com/performance/index.htm?prodId=213793#fragment',
    'https://ticket.melon.com.evil.test/performance/index.htm?prodId=213793',
    'http://ticket.melon.com/performance/index.htm?prodId=213793',
    'https://ticket.melon.com/performance/index.htm?prodId=0',
    'https://ticket.melon.com/performance/index.htm?prodId=213793/',
  ])('rejects a malformed or foreign product URL: %s', (url) => {
    expect(() =>
      wonderlivetMelonProduct(
        page(`<a href="${url}">[멜론티켓] 예매페이지 바로가기</a>`),
      ),
    ).toThrow();
  });

  it('rejects duplicate href attributes, conflicting Melon links, and fake quoted anchors', () => {
    expect(() =>
      wonderlivetMelonProduct(
        page(
          `<a href="${product}" href="https://evil.test">[멜론티켓] 예매페이지 바로가기</a>`,
        ),
      ),
    ).toThrow();
    expect(() =>
      wonderlivetMelonProduct(
        page(`<a href="${product}">[멜론티켓] 예매페이지 바로가기</a>
          <a href="https://ticket.melon.com/performance/index.htm?prodId=9">다른 공연</a>`),
      ),
    ).toThrow();
    expect(() =>
      wonderlivetMelonProduct(
        page(
          `<div data-note='<a href="${product}">[멜론티켓] 예매페이지 바로가기</a>'></div>`,
        ),
      ),
    ).toThrow();
  });

  it('ignores script, comment, and non-anchor content', () => {
    const forged = `<script><a href="${product}">[멜론티켓] 예매페이지 바로가기</a></script>
      <!--<a href="${product}">[멜론티켓] 예매페이지 바로가기</a>-->
      <div data-href="${product}">[멜론티켓] 예매페이지 바로가기</div>`;
    expect(() => wonderlivetMelonProduct(page(forged))).toThrow();
  });

  it('requires the official page identity and homepage link', () => {
    expect(() =>
      wonderlivetMelonProduct(page().replace('원더리벳 2026', '원더리벳 2025')),
    ).toThrow();
    expect(() =>
      wonderlivetMelonProduct(
        page().replace('https://www.wonderli.vet/', 'https://evil.test/'),
      ),
    ).toThrow();
  });
});
