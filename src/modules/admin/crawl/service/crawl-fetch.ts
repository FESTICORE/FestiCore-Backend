import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';

const MAX_BYTES = 2_000_000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return (
      a !== 0 &&
      a !== 10 &&
      a !== 127 &&
      a < 224 &&
      !(a === 169 && b === 254) &&
      !(a === 172 && b >= 16 && b <= 31) &&
      !(a === 192 && (b === 0 || b === 168)) &&
      !(a === 100 && b >= 64 && b <= 127) &&
      !(a === 198 && (b === 18 || b === 19))
    );
  }
  const normalized = address.toLowerCase();
  if (isIP(address) !== 6) return false;
  // Only globally routed IPv6 unicast may be fetched. This excludes
  // site-local, link-local, multicast, loopback and unique-local ranges.
  const firstHextet = Number.parseInt(normalized.split(':', 1)[0], 16);
  return (
    firstHextet >= 0x2000 &&
    firstHextet <= 0x3fff &&
    !normalized.startsWith('2001:db8:') &&
    !normalized.startsWith('::ffff:') &&
    normalized !== '::1' &&
    normalized !== '::' &&
    !normalized.startsWith('fc') &&
    !normalized.startsWith('fd') &&
    !normalized.startsWith('fe8') &&
    !normalized.startsWith('fe9') &&
    !normalized.startsWith('fea') &&
    !normalized.startsWith('feb')
  );
}

export function checkedUrl(raw: string): URL {
  const url = new URL(raw);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443')
  ) {
    throw new Error('HTTPS 기본 포트의 공개 URL만 사용할 수 있습니다.');
  }
  if (
    isIP(url.hostname) ||
    url.hostname === 'localhost' ||
    !url.hostname.includes('.')
  ) {
    throw new Error('공개 도메인만 사용할 수 있습니다.');
  }
  return url;
}

export async function safeGetBytes(
  url: URL,
  accept: string,
  maxBytes: number,
): Promise<{ status: number; body: Buffer; contentType: string }> {
  checkedUrl(url.toString());
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (
    !addresses.length ||
    addresses.some((entry) => !isPublicAddress(entry.address))
  ) {
    throw new Error('공개 IP로 해석되지 않는 도메인입니다.');
  }
  const selected = addresses[0];
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: 'GET',
        timeout: 10000,
        headers: {
          'user-agent':
            'FestiCoreCrawler/0.1 (+https://festicore.up.railway.app)',
          accept,
        },
        lookup: (_hostname, options, callback) => {
          if (options.all) callback(null, [selected]);
          else callback(null, selected.address, selected.family);
        },
      },
      (res) => {
        const contentLength = Number(res.headers['content-length']);
        if (Number.isFinite(contentLength) && contentLength > maxBytes) {
          req.destroy(new Error('응답 크기 제한을 초과했습니다.'));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            req.destroy(new Error('응답 크기 제한을 초과했습니다.'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks),
            contentType: String(res.headers['content-type'] ?? '')
              .split(';', 1)[0]
              .trim()
              .toLowerCase(),
          }),
        );
        res.on('error', reject);
      },
    );
    req.on('timeout', () =>
      req.destroy(new Error('요청 시간이 초과되었습니다.')),
    );
    req.on('error', reject);
    req.end();
  });
}

export async function safeGet(
  url: URL,
): Promise<{ status: number; body: string }> {
  const response = await safeGetBytes(
    url,
    'text/html,text/plain;q=0.9,*/*;q=0.1',
    MAX_BYTES,
  );
  return { status: response.status, body: response.body.toString('utf8') };
}

export function safeGetImage(url: URL) {
  return safeGetBytes(url, 'image/jpeg,image/png,image/webp', MAX_IMAGE_BYTES);
}

export function robotsAllows(robots: string, path: string): boolean {
  let agents: string[] = [];
  let readingRules = false;
  const rules: {
    pattern: string;
    allowed: boolean;
    specificity: number;
    agent: string;
  }[] = [];
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.split('#', 1)[0].trim();
    if (!line) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === 'user-agent') {
      if (readingRules) {
        agents = [];
        readingRules = false;
      }
      agents.push(value.toLowerCase());
    } else if (key === 'allow' || key === 'disallow') {
      readingRules = true;
      if (value) {
        for (const agent of agents) {
          if (agent === '*' || agent === 'festicorecrawler') {
            rules.push({
              pattern: value,
              allowed: key === 'allow',
              specificity: value.replace(/[*$]/g, '').length,
              agent,
            });
          }
        }
      }
    }
  }
  const selectedAgent = rules.some((rule) => rule.agent === 'festicorecrawler')
    ? 'festicorecrawler'
    : '*';
  const matching = rules
    .filter((rule) => {
      if (rule.agent !== selectedAgent) return false;
      const anchored = rule.pattern.endsWith('$');
      const pattern = rule.pattern
        .replace(/\$$/, '')
        .split('*')
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*');
      return new RegExp(`^${pattern}${anchored ? '$' : ''}`).test(path);
    })
    .sort(
      (a, b) =>
        b.specificity - a.specificity || Number(b.allowed) - Number(a.allowed),
    );
  return matching[0]?.allowed ?? true;
}
