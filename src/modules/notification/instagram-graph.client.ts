import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const GRAPH_HOST = 'https://graph.facebook.com';
/** v25.0은 2028-07-29까지 지원된다(Graph API changelog). INSTAGRAM_GRAPH_VERSION으로 바꿀 수 있다. */
const DEFAULT_GRAPH_VERSION = 'v25.0';
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 2_000_000;
/** 한 번에 받는 최근 게시물 수 */
export const RECENT_MEDIA_LIMIT = 12;
/** 인스타그램 사용자 이름 규칙(영문·숫자·마침표·밑줄, 30자 이하) */
export const INSTAGRAM_USERNAME = /^[A-Za-z0-9._]{1,30}$/;

export interface InstagramMediaChild {
  media_type?: string;
  media_url?: string;
  thumbnail_url?: string;
}

export interface InstagramMedia {
  id: string;
  caption?: string;
  media_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  timestamp?: string;
  children?: { data?: InstagramMediaChild[] };
}

export type InstagramFetchErrorKind =
  | 'not_configured'
  | 'token_invalid'
  | 'rate_limited'
  | 'account_unavailable'
  | 'error';

/** Meta 오류는 종류와 숫자 코드만 남긴다. 메시지·토큰·URL은 담지 않는다. */
export class InstagramFetchError extends Error {
  constructor(
    readonly kind: InstagramFetchErrorKind,
    readonly code?: number,
  ) {
    super(kind);
  }
}

const TOKEN_ERROR_CODES = new Set([102, 190]);
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80002]);
const ACCOUNT_ERROR_CODES = new Set([100, 110]);

/** Graph 오류 본문을 호출을 멈출지 정하는 종류로 바꾼다. */
export function classifyGraphError(
  body: unknown,
  status: number,
): InstagramFetchError {
  const error =
    typeof body === 'object' && body !== null && 'error' in body
      ? (body as { error?: { code?: unknown } }).error
      : undefined;
  const code = typeof error?.code === 'number' ? error.code : undefined;
  if (code !== undefined) {
    if (
      TOKEN_ERROR_CODES.has(code) ||
      (code >= 200 && code < 300) ||
      code === 10
    )
      return new InstagramFetchError('token_invalid', code);
    if (RATE_LIMIT_CODES.has(code))
      return new InstagramFetchError('rate_limited', code);
    if (ACCOUNT_ERROR_CODES.has(code))
      return new InstagramFetchError('account_unavailable', code);
  }
  if (status === 401 || status === 403)
    return new InstagramFetchError('token_invalid', code);
  if (status === 429) return new InstagramFetchError('rate_limited', code);
  return new InstagramFetchError('error', code);
}

function isMedia(value: unknown): value is InstagramMedia {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { id?: unknown }).id === 'string'
  );
}

async function readJson(response: Response): Promise<unknown> {
  if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES)
    throw new InstagramFetchError('error');
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) throw new InstagramFetchError('error');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new InstagramFetchError('error');
  }
}

/**
 * Meta Business Discovery로 다른 비즈니스·크리에이터 계정의 최근 게시물을 받는다.
 * 호출 주체는 FestiCore 인스타그램 비즈니스 계정(INSTAGRAM_BUSINESS_ACCOUNT_ID)이다.
 */
@Injectable()
export class InstagramGraphClient {
  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(this.token() && this.accountId());
  }

  async recentMedia(username: string): Promise<InstagramMedia[]> {
    const token = this.token();
    const accountId = this.accountId();
    if (!token || !accountId) throw new InstagramFetchError('not_configured');
    if (!INSTAGRAM_USERNAME.test(username))
      throw new InstagramFetchError('account_unavailable');
    const url = new URL(
      `${GRAPH_HOST}/${this.version()}/${encodeURIComponent(accountId)}`,
    );
    url.searchParams.set(
      'fields',
      `business_discovery.username(${username}){media.limit(${RECENT_MEDIA_LIMIT}){id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,children{media_type,media_url,thumbnail_url}}}`,
    );
    url.searchParams.set('access_token', token);
    let response: Response;
    try {
      response = await fetch(url, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        redirect: 'error',
      });
    } catch {
      throw new InstagramFetchError('error');
    }
    const body = await readJson(response);
    if (!response.ok) throw classifyGraphError(body, response.status);
    const media = (
      body as { business_discovery?: { media?: { data?: unknown } } }
    )?.business_discovery?.media?.data;
    return Array.isArray(media) ? media.filter(isMedia) : [];
  }

  private token(): string | undefined {
    return (
      this.config.get<string>('INSTAGRAM_GRAPH_TOKEN')?.trim() || undefined
    );
  }

  private accountId(): string | undefined {
    const id = this.config.get<string>('INSTAGRAM_BUSINESS_ACCOUNT_ID')?.trim();
    return id && /^\d{1,32}$/.test(id) ? id : undefined;
  }

  private version(): string {
    const version = this.config.get<string>('INSTAGRAM_GRAPH_VERSION')?.trim();
    return version && /^v\d{2,3}\.0$/.test(version)
      ? version
      : DEFAULT_GRAPH_VERSION;
  }
}
