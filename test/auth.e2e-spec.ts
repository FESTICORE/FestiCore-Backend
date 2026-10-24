import { QueryFailedError } from 'typeorm';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp, TestContext } from './app-factory';
import { AuthService } from '../src/modules/auth/service/auth.service';

interface ApiBody {
  code: string;
  data: {
    accessToken: string;
    refreshToken: string;
    newUser: boolean;
    nickname: string | null;
  } | null;
}

/** supertest 응답 바디를 표준 응답 형식으로 캐스팅한다. */
const bodyOf = (res: request.Response) => res.body as ApiBody;
const dataOf = (res: request.Response) => bodyOf(res).data!;

/**
 * 소셜 로그인 e2e.
 * 외부 의존(Google/Apple 검증)과 DB는 스텁/인메모리로 대체해 순수 HTTP·JWT 흐름을 검증한다.
 */
describe('Auth (e2e)', () => {
  let ctx: TestContext;
  let server: App;

  beforeEach(async () => {
    ctx = await createTestApp();
    server = ctx.app.getHttpServer() as App;
  });

  afterEach(async () => {
    await ctx.app.close();
  });

  const socialLogin = () => {
    ctx.google.verify.mockResolvedValue({
      provider: 'google',
      providerId: 'g-tester',
      email: 'tester@example.com',
      name: 'tester',
    });
    return request(server)
      .post('/api/v1/auth/login')
      .send({ provider: 'google', token: 'id-token' });
  };

  it('삭제된 개발용 로그인 경로는 플래그가 있어도 404', async () => {
    ctx.env.DEV_LOGIN_ENABLED = 'true';
    await request(server)
      .post('/api/v1/auth/dev/login')
      .send({ key: 'tester' })
      .expect(404);
  });

  it('Google 웹과 앱은 같은 로그인 경로를 쓰며 Apple 인증 코드는 필수', async () => {
    await request(server)
      .post('/api/v1/auth/google')
      .send({ token: 'x' })
      .expect(404);
    await request(server)
      .post('/api/v1/auth/apple')
      .send({ token: 'x' })
      .expect(404);
    await request(server).get('/api/v1/auth/google/start').expect(404);
    await request(server).get('/api/v1/auth/google/callback').expect(404);
    await request(server)
      .post('/api/v1/auth/login')
      .send({ provider: 'apple', token: 'identity-token' })
      .expect(400);
    await socialLogin().expect(200);
  });

  it('제거한 인증 호환 경로는 404이고 Swagger에서도 빠진다', async () => {
    const login = await socialLogin().expect(200);
    const bearer = `Bearer ${dataOf(login).accessToken}`;
    await request(server)
      .delete('/api/v1/auth/session')
      .set('Authorization', bearer)
      .expect(404);
    await request(server)
      .get('/api/v1/auth/me')
      .set('Authorization', bearer)
      .expect(404);
    await request(server)
      .delete('/api/v1/auth/me')
      .set('Authorization', bearer)
      .expect(404);
    await request(server)
      .get('/api/v1/me')
      .set('Authorization', bearer)
      .expect(200);
    const paths = SwaggerModule.createDocument(
      ctx.app,
      new DocumentBuilder().setTitle('인증 경로 검증').setVersion('1').build(),
    ).paths;
    expect(paths['/api/v1/auth/session']).toBeUndefined();
    expect(paths['/api/v1/auth/me']).toBeUndefined();
    expect(paths['/api/v1/auth/logout']?.post).toBeDefined();
    expect(paths['/api/v1/auth/session/revoke']?.post).toBeDefined();
    expect(paths['/api/v1/auth/logout']?.post?.parameters).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'X-Device-Id' }),
      ]),
    );
    expect(paths['/api/v1/me']?.get).toBeDefined();
    expect(paths['/api/v1/me']?.delete).toBeDefined();
  });

  it('login → me → refresh(회전) → 이전 refresh 재사용 401 → logout 후 refresh 401', async () => {
    const login = await socialLogin().expect(200);
    const { accessToken, refreshToken } = dataOf(login);
    expect(dataOf(login).newUser).toBe(true);

    const me = await request(server)
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(dataOf(me).nickname).toBe('tester');

    const rotated = await request(server)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken })
      .expect(200);
    await request(server)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken })
      .expect(401);

    await request(server)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${dataOf(rotated).accessToken}`)
      .expect(200);
    await request(server)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: dataOf(rotated).refreshToken })
      .expect(401);
  });

  it('access 헤더 없이 과거 refresh 토큰으로 현재 웹 세션만 반복 폐기한다', async () => {
    const first = dataOf(await socialLogin().expect(200));
    const other = dataOf(await socialLogin().expect(200));
    const rotated = dataOf(
      await request(server)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: first.refreshToken })
        .expect(200),
    );
    for (let i = 0; i < 2; i += 1) {
      const revoked = await request(server)
        .post('/api/v1/auth/session/revoke')
        .send({ refreshToken: first.refreshToken })
        .expect(204);
      expect(revoked.text).toBe('');
    }
    await request(server)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: rotated.refreshToken })
      .expect(401);
    await request(server)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: other.refreshToken })
      .expect(200);
  });

  it('잘못된/만료된/access 토큰은 204이며 본문 크기 오류는 400이다', async () => {
    const login = dataOf(await socialLogin().expect(200));
    for (const refreshToken of ['invalid', login.accessToken]) {
      await request(server)
        .post('/api/v1/auth/session/revoke')
        .send({ refreshToken })
        .expect(204);
    }
    await request(server)
      .post('/api/v1/auth/session/revoke')
      .send({ refreshToken: 'x'.repeat(4097) })
      .expect(400);
    await request(server)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: login.refreshToken })
      .expect(200);
  });

  it('세션 조회 DB 오류를 성공 응답으로 숨기지 않는다', async () => {
    const login = dataOf(await socialLogin().expect(200));
    const findOne = jest
      .spyOn(ctx.refreshTokens, 'findOne')
      .mockRejectedValueOnce(new Error('database unavailable'));
    await request(server)
      .post('/api/v1/auth/session/revoke')
      .send({ refreshToken: login.refreshToken })
      .expect(500);
    findOne.mockRestore();
    await request(server)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: login.refreshToken })
      .expect(200);
  });

  it('같은 refresh 토큰 동시 2회 → 하나만 성공', async () => {
    const login = await socialLogin().expect(200);
    const { refreshToken } = dataOf(login);
    const results = await Promise.all([
      request(server).post('/api/v1/auth/refresh').send({ refreshToken }),
      request(server).post('/api/v1/auth/refresh').send({ refreshToken }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
  });

  it('refresh 토큰을 Bearer 로 쓰면 401 (logout 전후)', async () => {
    const login = await socialLogin().expect(200);
    const { accessToken, refreshToken } = dataOf(login);
    await request(server)
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${refreshToken}`)
      .expect(401);
    await request(server)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    await request(server)
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${refreshToken}`)
      .expect(401);
  });

  it('토큰 없이 me → 401 표준 에러', async () => {
    const res = await request(server).get('/api/v1/me').expect(401);
    expect(bodyOf(res)).toMatchObject({
      code: 'UNAUTHORIZED',
      data: null,
    });
  });

  it('잘못된 provider → 400 표준 에러', async () => {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ provider: 'kakao', token: 'x' })
      .expect(400);
    expect(bodyOf(res).code).toBe('BAD_REQUEST');
  });

  it('google login → find-or-create, 두 번째는 newUser=false', async () => {
    ctx.google.verify.mockResolvedValue({
      provider: 'google',
      providerId: 'g-1',
      email: 'a@b.c',
      name: 'G',
    });
    const first = await request(server)
      .post('/api/v1/auth/login')
      .send({ provider: 'google', token: 'id-token' })
      .expect(200);
    const second = await request(server)
      .post('/api/v1/auth/login')
      .send({ provider: 'google', token: 'id-token' })
      .expect(200);
    expect(dataOf(first).newUser).toBe(true);
    expect(dataOf(second).newUser).toBe(false);
    expect(ctx.users.rows).toHaveLength(1);
  });

  it('첫 로그인 동시 경합(unique 위반) → 재조회해 200 + newUser=false', async () => {
    ctx.apple.verify.mockResolvedValue({
      provider: 'apple',
      providerId: 'a-1',
    });
    // 다른 요청이 먼저 만든 것처럼 행을 넣고, 이 요청의 save 는 23505 로 실패시킨다.
    const raced = ctx.users.create({ provider: 'apple', providerId: 'a-1' });
    const users = ctx.users;
    const original = users.findOne.bind(users) as typeof users.findOne;
    let calls = 0;
    users.findOne = (options) => {
      calls += 1;
      return calls === 1 ? Promise.resolve(null) : original(options);
    };
    await ctx.users.save(raced);
    ctx.users.failNextSave = new QueryFailedError('INSERT', [], {
      code: '23505',
    } as unknown as Error);

    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ provider: 'apple', token: 'identity', authorizationCode: 'c' })
      .expect(200);
    expect(dataOf(res).newUser).toBe(false);
  });

  describe('Apple authorizationCode / 탈퇴 revoke', () => {
    beforeEach(() => {
      ctx.apple.verify.mockResolvedValue({
        provider: 'apple',
        providerId: 'a-2',
      });
    });

    it('apple 로그인 code 누락 → 400', async () => {
      await request(server)
        .post('/api/v1/auth/login')
        .send({ provider: 'apple', token: 'identity' })
        .expect(400);
    });

    it('토큰이 저장된 apple 계정 탈퇴 → revoke 호출', async () => {
      ctx.apple.exchangeAuthCode.mockResolvedValue({
        refreshToken: 'apple-refresh',
        subject: 'a-2',
      });
      const login = await request(server)
        .post('/api/v1/auth/login')
        .send({ provider: 'apple', token: 'identity', authorizationCode: 'c' })
        .expect(200);
      await request(server)
        .delete('/api/v1/me')
        .set('Authorization', `Bearer ${dataOf(login).accessToken}`)
        .expect(204);
      expect(ctx.apple.revokeConnection).toHaveBeenCalledWith(
        'apple-refresh',
        undefined,
      );
      expect(ctx.users.rows).toHaveLength(0);
    });

    it('웹 Services ID로 발급된 토큰은 해당 client ID로 철회', async () => {
      ctx.apple.exchangeAuthCode.mockResolvedValue({
        refreshToken: 'apple-web-refresh',
        subject: 'a-2',
        clientId: 'co.festiCore.io',
      });
      const login = await request(server)
        .post('/api/v1/auth/login')
        .send({
          provider: 'apple',
          token: 'identity',
          authorizationCode: 'code',
        })
        .expect(200);
      await request(server)
        .delete('/api/v1/me')
        .set('Authorization', `Bearer ${dataOf(login).accessToken}`)
        .expect(204);
      expect(ctx.apple.revokeConnection).toHaveBeenCalledWith(
        'apple-web-refresh',
        'co.festiCore.io',
      );
    });

    it('iOS와 웹 토큰을 별도로 저장하고 탈퇴 때 각각 철회', async () => {
      ctx.apple.exchangeAuthCode.mockResolvedValue({
        refreshToken: 'ios-refresh',
        subject: 'a-2',
        clientId: 'io.festiCore.co',
      });
      const login = await request(server)
        .post('/api/v1/auth/login')
        .send({
          provider: 'apple',
          token: 'identity',
          authorizationCode: 'native-code',
        })
        .expect(200);
      const auth = ctx.app.get(AuthService);
      await auth.completeWebLogin(
        { provider: 'apple', providerId: 'a-2', name: '첫 이름' },
        {
          refreshToken: 'web-refresh',
          subject: 'a-2',
          clientId: 'co.festiCore.io',
        },
      );
      await request(server)
        .delete('/api/v1/me')
        .set('Authorization', `Bearer ${dataOf(login).accessToken}`)
        .expect(204);
      expect(ctx.apple.revokeConnection).toHaveBeenCalledWith(
        'ios-refresh',
        'io.festiCore.co',
      );
      expect(ctx.apple.revokeConnection).toHaveBeenCalledWith(
        'web-refresh',
        'co.festiCore.io',
      );
    });

    it('code 교환 결과 sub 가 다르면 저장 안 함 → 탈퇴 시 revoke 미호출', async () => {
      ctx.apple.exchangeAuthCode.mockResolvedValue({
        refreshToken: 'other-refresh',
        subject: 'someone-else',
      });
      const login = await request(server)
        .post('/api/v1/auth/login')
        .send({ provider: 'apple', token: 'identity', authorizationCode: 'c' })
        .expect(200);
      await request(server)
        .delete('/api/v1/me')
        .set('Authorization', `Bearer ${dataOf(login).accessToken}`)
        .expect(204);
      expect(ctx.apple.revokeConnection).not.toHaveBeenCalled();
    });

    it('교환 실패로 토큰 없는 계정 탈퇴 → revoke 미호출, 204', async () => {
      ctx.apple.exchangeAuthCode.mockResolvedValue(undefined);
      const login = await request(server)
        .post('/api/v1/auth/login')
        .send({ provider: 'apple', token: 'identity', authorizationCode: 'c' })
        .expect(200);
      await request(server)
        .delete('/api/v1/me')
        .set('Authorization', `Bearer ${dataOf(login).accessToken}`)
        .expect(204);
      expect(ctx.apple.revokeConnection).not.toHaveBeenCalled();
    });
  });
});
