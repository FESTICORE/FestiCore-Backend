import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

export const ADMIN_CALLBACK_COOKIE = 'festicore_admin_callback';

export function createCallbackCsrf(
  secret: string,
  token: string,
): { nonce: string; cookie: string } {
  const nonce = randomBytes(32).toString('base64url');
  return { nonce, cookie: `${nonce}.${signature(secret, token, nonce)}` };
}

export function verifyCallbackCsrf(
  secret: string,
  token: string,
  nonce: string,
  cookie: string | undefined,
): boolean {
  if (!/^[A-Za-z0-9_-]{43}$/.test(nonce) || !cookie) return false;
  const [cookieNonce, suppliedSignature, extra] = cookie.split('.');
  if (
    extra ||
    cookieNonce !== nonce ||
    !/^[A-Za-z0-9_-]{43}$/.test(suppliedSignature ?? '')
  ) {
    return false;
  }
  const expected = Buffer.from(signature(secret, token, nonce));
  const supplied = Buffer.from(suppliedSignature);
  return timingSafeEqual(expected, supplied);
}

function signature(secret: string, token: string, nonce: string): string {
  return createHmac('sha256', secret)
    .update(`${token}:${nonce}`)
    .digest('base64url');
}
