import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'crypto';
import { IsNull, MoreThan, Repository } from 'typeorm';
import { AuthService, type LoginResult } from '../service/auth.service';
import { AppleService } from '../service/apple.service';
import { GoogleService } from '../service/google.service';
import { WebOauthState, WebOauthTicket } from './web-oauth-state.entity';

type Provider = 'google' | 'apple';

@Injectable()
export class WebOauthService {
  constructor(
    private readonly config: ConfigService,
    private readonly auth: AuthService,
    private readonly google: GoogleService,
    private readonly apple: AppleService,
    @InjectRepository(WebOauthState)
    private readonly states: Repository<WebOauthState>,
    @InjectRepository(WebOauthTicket)
    private readonly tickets: Repository<WebOauthTicket>,
  ) {}

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private random(): string {
    return randomBytes(32).toString('base64url');
  }

  redirectUri(provider: Provider): string {
    const key =
      provider === 'google'
        ? 'GOOGLE_WEB_REDIRECT_URI'
        : 'APPLE_WEB_REDIRECT_URI';
    const configured = this.config.get<string>(key);
    if (!configured)
      throw new ServiceUnavailableException(
        `${provider} 웹 콜백 URI가 설정되지 않았습니다.`,
      );
    let url: URL;
    try {
      url = new URL(configured);
    } catch {
      throw new ServiceUnavailableException(
        `${provider} 웹 콜백 URI가 올바르지 않습니다.`,
      );
    }
    const expectedPath = `/api/v1/auth/${provider}/callback`;
    if (
      url.protocol !== 'https:' ||
      !['festicore.up.railway.app', 'festicore-dev.up.railway.app'].includes(
        url.hostname,
      ) ||
      url.pathname !== expectedPath ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    ) {
      throw new ServiceUnavailableException(
        `${provider} 웹 콜백 URI가 올바르지 않습니다.`,
      );
    }
    return url.toString();
  }

  async begin(
    provider: Provider,
  ): Promise<{ url: string; browserToken: string }> {
    const redirectUri = this.redirectUri(provider);
    const state = this.random();
    const browserToken = this.random();
    const nonce = this.random();
    await this.states.save(
      this.states.create({
        stateHash: this.hash(state),
        browserHash: this.hash(browserToken),
        provider,
        nonce,
        expiresAt: new Date(Date.now() + 5 * 60_000),
        consumedAt: null,
      }),
    );
    const clientId =
      provider === 'google'
        ? this.config.get<string>('auth.google.clientId')
        : this.config.get<string>('APPLE_WEB_CLIENT_ID');
    if (!clientId)
      throw new ServiceUnavailableException(
        `${provider} 웹 클라이언트가 설정되지 않았습니다.`,
      );
    const url = new URL(
      provider === 'google'
        ? 'https://accounts.google.com/o/oauth2/v2/auth'
        : 'https://appleid.apple.com/auth/authorize',
    );
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set(
      'response_type',
      provider === 'google' ? 'code' : 'code id_token',
    );
    url.searchParams.set(
      'scope',
      provider === 'google' ? 'openid email profile' : 'name email',
    );
    url.searchParams.set('state', state);
    url.searchParams.set('nonce', nonce);
    if (provider === 'google') url.searchParams.set('access_type', 'offline');
    else url.searchParams.set('response_mode', 'form_post');
    return { url: url.toString(), browserToken };
  }

  async finish(
    provider: Provider,
    code: string,
    state: string,
    browserToken: string,
  ): Promise<string> {
    if (!code || !state || !browserToken)
      throw new UnauthorizedException('웹 로그인 상태가 없습니다.');
    const stateHash = this.hash(state);
    const record = await this.states.findOne({
      where: {
        stateHash,
        browserHash: this.hash(browserToken),
        provider,
        consumedAt: IsNull(),
        expiresAt: MoreThan(new Date()),
      },
    });
    if (!record)
      throw new UnauthorizedException(
        '만료되었거나 일치하지 않는 웹 로그인 상태입니다.',
      );
    const claimed = await this.states.update(
      {
        stateHash,
        browserHash: record.browserHash,
        provider,
        consumedAt: IsNull(),
        expiresAt: MoreThan(new Date()),
      },
      { consumedAt: new Date() },
    );
    if (claimed.affected !== 1)
      throw new UnauthorizedException('이미 사용된 웹 로그인 상태입니다.');
    const identity =
      provider === 'google'
        ? await this.google.exchangeWebCode(
            code,
            this.redirectUri(provider),
            record.nonce,
          )
        : await this.apple.exchangeWebCode(
            code,
            this.redirectUri(provider),
            record.nonce,
          );
    const completed = await this.auth.completeWebLogin(
      identity.profile,
      identity.grant,
    );
    const ticket = this.random();
    await this.tickets.save(
      this.tickets.create({
        ticketHash: this.hash(ticket),
        ...completed,
        expiresAt: new Date(Date.now() + 60_000),
        consumedAt: null,
      }),
    );
    return ticket;
  }

  async consumeTicket(ticket: string): Promise<LoginResult> {
    if (!ticket) throw new UnauthorizedException('웹 로그인 티켓이 없습니다.');
    const ticketHash = this.hash(ticket);
    const record = await this.tickets.findOne({
      where: {
        ticketHash,
        consumedAt: IsNull(),
        expiresAt: MoreThan(new Date()),
      },
    });
    if (!record)
      throw new UnauthorizedException(
        '만료되었거나 사용된 웹 로그인 티켓입니다.',
      );
    const claimed = await this.tickets.update(
      {
        ticketHash,
        consumedAt: IsNull(),
        expiresAt: MoreThan(new Date()),
      },
      { consumedAt: new Date() },
    );
    if (claimed.affected !== 1)
      throw new UnauthorizedException('이미 사용된 웹 로그인 티켓입니다.');
    return this.auth.issueWebLogin(record.userId, record.newUser);
  }
}
