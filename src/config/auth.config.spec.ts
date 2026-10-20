import { assertJwtSecrets } from './auth.config';

describe('assertJwtSecrets', () => {
  it('두 secret 이 다르면 통과', () => {
    expect(() =>
      assertJwtSecrets({ JWT_ACCESS_SECRET: 'a', JWT_REFRESH_SECRET: 'b' }),
    ).not.toThrow();
  });

  it('누락되면 에러', () => {
    expect(() => assertJwtSecrets({ JWT_ACCESS_SECRET: 'a' })).toThrow(
      '설정되지 않았습니다',
    );
    expect(() => assertJwtSecrets({})).toThrow('설정되지 않았습니다');
  });

  it('같으면 에러', () => {
    expect(() =>
      assertJwtSecrets({ JWT_ACCESS_SECRET: 's', JWT_REFRESH_SECRET: 's' }),
    ).toThrow('서로 달라야');
  });

  it('NODE_ENV=test 는 건너뜀', () => {
    expect(() => assertJwtSecrets({ NODE_ENV: 'test' })).not.toThrow();
  });
});
