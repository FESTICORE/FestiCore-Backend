const MAX_BYTES = 2_000_000;

export class AnalyticsFetchError extends Error {
  constructor(readonly kind: 'error' | 'rate_limited') {
    super(kind);
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
