import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

type TokenColumn = 'oauthRefreshToken' | 'oauthWebRefreshToken';
const PREFIX = 'enc:v1:';

function parseKey(raw: string | undefined): Buffer | null {
  if (!raw) return null;
  const key = Buffer.from(raw, /^[a-f0-9]{64}$/i.test(raw) ? 'hex' : 'base64');
  if (key.length !== 32)
    throw new Error('OAuth 토큰 암호화 키 형식이 올바르지 않습니다.');
  return key;
}

function keyId(key: Buffer): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}

/** 기존 평문 읽기와 키 교체 기간의 구·신 암호문 읽기를 지원한다. */
export class OauthTokenCipher {
  private readonly current: Buffer | null;
  private readonly keys = new Map<string, Buffer>();
  private readonly writeEncrypted: boolean;

  constructor(env: NodeJS.ProcessEnv) {
    this.current = parseKey(env.OAUTH_TOKEN_ENCRYPTION_KEY);
    const previous = parseKey(env.OAUTH_TOKEN_ENCRYPTION_PREVIOUS_KEY);
    if (this.current) this.keys.set(keyId(this.current), this.current);
    if (previous) this.keys.set(keyId(previous), previous);
    const writeMode = env.OAUTH_TOKEN_ENCRYPTION_WRITE;
    if (
      (writeMode !== undefined &&
        writeMode !== 'true' &&
        writeMode !== 'false') ||
      (this.current && writeMode === undefined)
    )
      throw new Error('OAuth 토큰 암호화 쓰기 설정이 올바르지 않습니다.');
    this.writeEncrypted = writeMode === 'true';
    if (this.writeEncrypted && !this.current)
      throw new Error('OAuth 토큰 암호화 쓰기에는 현재 키가 필요합니다.');
  }

  currentPrefix(): string {
    if (!this.current) throw new Error('OAuth 토큰 현재 키가 없습니다.');
    return `${PREFIX}${keyId(this.current)}:`;
  }

  requireEncryptedWrites(): void {
    if (!this.writeEncrypted)
      throw new Error('OAuth 토큰 암호화 쓰기가 꺼져 있습니다.');
  }

  needsReencrypt(value: string | null): boolean {
    return Boolean(value && !value.startsWith(this.currentPrefix()));
  }

  encode(token: string, userId: string, column: TokenColumn): string {
    if (!this.writeEncrypted) return token;
    const key = this.current!;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(`${userId}\0${column}`));
    const ciphertext = Buffer.concat([
      cipher.update(token, 'utf8'),
      cipher.final(),
    ]);
    return `${PREFIX}${keyId(key)}:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${ciphertext.toString('base64url')}`;
  }

  decode(
    value: string | null,
    userId: string,
    column: TokenColumn,
  ): string | null {
    if (!value || !value.startsWith(PREFIX)) return value;
    const parts = value.slice(PREFIX.length).split(':');
    if (parts.length !== 4)
      throw new Error('OAuth 토큰 암호문 형식이 올바르지 않습니다.');
    const [id, ivText, tagText, ciphertextText] = parts;
    const key = this.keys.get(id);
    if (!key) throw new Error('OAuth 토큰 암호문에 필요한 키가 없습니다.');
    const iv = Buffer.from(ivText, 'base64url');
    const tag = Buffer.from(tagText, 'base64url');
    if (iv.length !== 12 || tag.length !== 16)
      throw new Error('OAuth 토큰 암호문 형식이 올바르지 않습니다.');
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(Buffer.from(`${userId}\0${column}`));
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextText, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}
