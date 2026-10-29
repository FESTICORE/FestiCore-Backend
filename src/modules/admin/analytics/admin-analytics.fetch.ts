const MAX_BYTES = 2_000_000;
const MAX_ERROR_BYTES = 4_096;

export class AnalyticsFetchError extends Error {
  constructor(
    readonly kind:
      'error' | 'rate_limited' | 'empty_environment' | 'empty_issues',
  ) {
    super(kind);
  }
}

async function sentryNotFoundKind(
  url: URL,
  response: Response,
): Promise<'empty_environment' | 'empty_issues' | null> {
  if (
    url.hostname !== 'de.sentry.io' ||
    !/^\/api\/0\/organizations\/festicore\/(events-timeseries|issues)\/$/.test(
      url.pathname,
    )
  )
    return null;
  if (Number(response.headers.get('content-length')) > MAX_ERROR_BYTES)
    return null;
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_ERROR_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const body = Buffer.concat(chunks).toString('utf8').trim();
  let detail = body;
  try {
    const parsed: unknown = JSON.parse(body);
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      'detail' in parsed &&
      typeof parsed.detail === 'string'
    )
      detail = parsed.detail;
  } catch {
    // Sentry also returns plain text for some 404 responses.
  }
  if (detail === 'Unknown environments selected') return 'empty_environment';
  if (
    url.pathname.endsWith('/issues/') &&
    detail === 'The requested resource does not exist'
  )
    return 'empty_issues';
  return null;
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
    if (response.status === 404) {
      const kind = await sentryNotFoundKind(url, response);
      if (kind) throw new AnalyticsFetchError(kind);
    }
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
