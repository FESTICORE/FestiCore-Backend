import { IS_PUBLIC_KEY } from '../auth/decorator/public.decorator';
import { LegalController } from './legal.controller';

function response() {
  const state = { status: 0, headers: {} as Record<string, string>, body: '' };
  const mock = {
    status(code: number) {
      state.status = code;
      return mock;
    },
    type(value: string) {
      state.headers['Content-Type'] = value;
      return mock;
    },
    set(name: string, value: string) {
      state.headers[name] = value;
      return mock;
    },
    send(value: string) {
      state.body = value;
      return mock;
    },
  };
  return { state, mock: mock as never };
}

describe('LegalController', () => {
  const controller = new LegalController();

  it.each(['home', 'privacy', 'terms'] as const)(
    '%s is a public HTML page with navigation and safe headers',
    (method) => {
      const { state, mock } = response();
      controller[method](mock);
      expect(state.status).toBe(200);
      expect(state.headers['Content-Type']).toBe('html');
      expect(state.headers['Cache-Control']).toBe('public, max-age=3600');
      expect(state.headers['Content-Security-Policy']).toContain(
        "default-src 'none'",
      );
      expect(state.body).toContain('lang="ko"');
      expect(state.body).toContain('/api/v1/legal/privacy');
      expect(state.body).toContain('/api/v1/legal/terms');
    },
  );

  it('explains Google account information access, use, storage and sharing', () => {
    const { state, mock } = response();
    controller.privacy(mock);
    expect(state.body).toContain('Google 로그인에서 접근하는 정보');
    expect(state.body).toContain('로그인 확인, 계정 연결과 프로필 표시');
    expect(state.body).toContain('서비스 데이터베이스에 저장');
    expect(state.body).toContain('다른 이용자에게 공개하지 않습니다');
  });

  it('does not require authentication', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, LegalController)).toBe(true);
  });
});
