const MAX_BYTES = 2_000_000;
const MAX_ERROR_BYTES = 4_096;

export class AnalyticsFetchError extends Error {
  constructor(readonly kind: 'error' | 'rate_limited' | 'empty_environment') {
    super(kind);
  }
}

async function isUnknownSentryEnvironment(
  url: URL,
  response: Response,
): Promise<boolean> {
  if (
    url.hostname !== 'de.sentry.io' ||
    !/^\/api\/0\/organizations\/festicore\/(events-timeseries|issues)\/$/.test(
      url.pathname,
    )
  )
    return false;
  if (Number(response.headers.get('content-length')) > MAX_ERROR_BYTES)
    return false;
  const reader = response.body?.getReader();
  if (!reader) return false;
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_ERROR_BYTES) {
      await reader.cancel();
      return false;
    }
    chunks.push(value);
  }
  const body = Buffer.concat(chunks).toString('utf8').trim();
  if (body === 'Unknown environments selected') return true;
  try {
    const parsed: unknown = JSON.parse(body);
    return (
      parsed !== null &&
      typeof parsed === 'object' &&
      'detail' in parsed &&
      parsed.detail === 'Unknown environments selected'
    );
  } catch {
    return false;
  }
}

export async function fetchAnalytics(
  url: URL,
  authorization: string,
  raw = false,
): Promise<unknown> {
  try {
    const response = await fetch(url, {
      headers: { Authorization: authorization, Accept: 'application/json' },
      signal: AbortSignal.timeout(8_000),
      redirect: 'error',
    });
    if (response.status === 429) throw new AnalyticsFetchError('rate_limited');
    if (
      response.status === 404 &&
      (await isUnknownSentryEnvironment(url, response))
    )
      throw new AnalyticsFetchError('empty_environment');
    if (!response.ok) throw new AnalyticsFetchError('error');
    if (Number(response.headers.get('content-length')) > MAX_BYTES)
      throw new AnalyticsFetchError('error');
    const reader = response.body?.getReader();
    if (!reader) throw new AnalyticsFetchError('error');
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) {
        await reader.cancel();
        throw new AnalyticsFetchError('error');
      }
      chunks.push(value);
    }
    const body = Buffer.concat(chunks).toString('utf8');
    return raw ? body : (JSON.parse(body) as unknown);
  } catch (error) {
    if (error instanceof AnalyticsFetchError) throw error;
    throw new AnalyticsFetchError('error');
  }
}
