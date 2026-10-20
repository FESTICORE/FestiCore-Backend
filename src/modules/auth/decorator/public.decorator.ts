import { SetMetadata } from '@nestjs/common';

/** 전역 JwtAuthGuard를 건너뛰게 하는 메타데이터 키. */
export const IS_PUBLIC_KEY = 'isPublic';

/**
 * 인증 없이 접근 가능한 라우트에 붙인다.
 * 전역 인증(APP_GUARD)이 기본이라, 로그인·웹훅·헬스체크처럼
 * 토큰이 없는 공개 엔드포인트에만 명시적으로 표시한다.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
