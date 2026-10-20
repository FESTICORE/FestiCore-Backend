/**
 * API 도메인 목록.
 * Gateway 경로·문서 경로·엔드포인트 접두사가 여기서 갈라져 나가므로 한 곳에서만 정의한다.
 * (모듈 클래스는 참조하지 않는다 — 순환 의존을 피하려고 순수 데이터로 둔다)
 */
export interface ApiDomain {
  /** Gateway 라우팅 키이자 문서 경로. 예: auth → /api/v1/auth, /api-docs/auth */
  slug: string;
  title: string;
  description: string;
  /** 전역 prefix(api/v1) 뒤에 붙는 경로 접두사. */
  pathPrefix: string;
}

export const API_DOMAINS: ApiDomain[] = [
  {
    slug: 'auth',
    title: 'Auth',
    description: '소셜 로그인(Google·Apple)·JWT·회원 탈퇴',
    pathPrefix: 'auth',
  },
];
