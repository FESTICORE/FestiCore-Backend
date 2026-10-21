import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';

// 요청 바디에 실려도 로그에 남기면 안 되는 민감 키(소문자 정확 일치).
const REDACTED_KEYS = new Set([
  'auth',
  'authentication',
  'authorization',
  'authorizationcode',
  'code',
  'email',
  'idtoken',
  'id_token',
  'identitytoken',
  'nonce',
  'linktoken',
  'magictoken',
  'otp',
  'password',
  'secret',
  'signature',
  'token',
  'accesstoken',
  'apnstoken',
  'pushtoken',
  'liveactivitypushtostarttoken',
  'refreshtoken',
  'state',
  'user',
  'sessionid',
]);

/**
 * 모든 JSON 예외를 { code, data, message } 표준 형식으로 변환한다.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(@Optional() private readonly config?: ConfigService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = '내부 서버 오류가 발생했습니다.';
    let code = 'INTERNAL_SERVER_ERROR';
    const details: Record<string, unknown> = {};

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = HttpStatus[status] ?? `HTTP_${status}`;
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (typeof body === 'object' && body !== null) {
        const fields = body as Record<string, unknown>;
        if (typeof fields.code === 'string') code = fields.code;
        const msg = fields.message as string | string[] | undefined;
        message = Array.isArray(msg) ? msg.join(', ') : (msg ?? message);
        // API 계약에 명시된 오류 필드만 노출한다. 임의 예외 객체의 비밀값은 내보내지 않는다.
        for (const key of [
          'draft',
          'draftVersion',
          'errors',
          'warnings',
          'retryAfter',
        ]) {
          if (key in fields) details[key] = fields[key];
        }
        if (
          status === HttpStatus.CONFLICT &&
          fields.code === 'STATUS_STALE' &&
          typeof fields.current === 'object' &&
          fields.current !== null &&
          !Array.isArray(fields.current)
        ) {
          const current = fields.current as Record<string, unknown>;
          if (
            Array.isArray(current.setIds) &&
            current.setIds.every((id) => typeof id === 'string') &&
            current.updatedAt instanceof Date
          ) {
            details.current = {
              setIds: current.setIds,
              updatedAt: current.updatedAt.toISOString(),
            };
          }
        }
      }
    }

    // 4xx(인증 없음·검증 실패·not found 등)는 예상된 클라이언트 오류이므로
    // 스택 없이 warn 으로 남긴다. 5xx(진짜 서버 오류)만 스택과 함께 error 로 남겨
    // 로그에서 실제 장애가 401/404 노이즈에 묻히지 않게 한다.
    const line = `${request.method} ${request.url.split('?')[0]} - ${status} - ${message}`;
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        line,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      // 비운영 환경에서 400(검증 실패)이면 요청 바디를 함께 남긴다.
      // ValidationPipe 는 컨트롤러 앞에서 막아 바디가 어디에도 안 찍히므로,
      // 클라이언트가 실제로 무엇을 보냈는지 확인해 스펙 불일치를 진단하기 위함이다.
      if (status === HttpStatus.BAD_REQUEST && this.isDiagnosticsEnabled()) {
        this.logger.warn(`${line} | body=${this.safeBody(request.body)}`);
      } else {
        this.logger.warn(line);
      }
    }

    response.status(status).json({
      code,
      data: Object.keys(details).length ? details : null,
      message,
    });
  }

  /**
   * 요청 바디 로깅은 개발 진단용이라 운영에서는 절대 켜지 않는다.
   * Railway production 환경이면 항상 끈다.
   */
  private isDiagnosticsEnabled(): boolean {
    if (!this.config) return false;
    const nodeEnv = this.config.get<string>('NODE_ENV');
    const railwayEnv = this.config.get<string>('RAILWAY_ENVIRONMENT_NAME');
    if (railwayEnv === 'production') return false;
    if (nodeEnv === 'test') return false;
    return nodeEnv !== 'production' || railwayEnv === 'develop';
  }

  /** 민감 키를 가린 요청 바디를 한 줄 JSON 으로 만든다. */
  private safeBody(body: unknown): string {
    if (body === null || typeof body !== 'object') return String(body);
    try {
      return JSON.stringify(this.redact(body));
    } catch {
      return '[unserializable]';
    }
  }

  private redact(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((item) => this.redact(item));
    if (value === null || typeof value !== 'object') return value;

    const redacted: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(
      value as Record<string, unknown>,
    )) {
      redacted[key] = REDACTED_KEYS.has(key.toLowerCase())
        ? '***'
        : this.redact(child);
    }
    return redacted;
  }
}
