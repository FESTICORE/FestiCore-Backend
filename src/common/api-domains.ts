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
    slug: 'health',
    title: 'Health',
    description: '서버와 데이터베이스 상태',
    pathPrefix: 'health',
  },
  {
    slug: 'auth',
    title: 'Auth',
    description: '소셜 로그인(Google·Apple)·JWT·회원 탈퇴',
    pathPrefix: 'auth',
  },
  {
    slug: 'admin-auth',
    title: 'Admin Auth',
    description: '관리자 매직 링크 로그인과 세션',
    pathPrefix: 'admin/auth',
  },
  {
    slug: 'admin-festivals',
    title: 'Admin Festivals',
    description: '축제 초안, 발행, 버전, 롤백',
    pathPrefix: 'admin/festivals',
  },
  {
    slug: 'admin-crawl',
    title: 'Admin Crawl',
    description: '축제 정보 수집 소스·실행·제안 검토·이미지',
    pathPrefix: 'admin/crawl',
  },
  {
    slug: 'admin-proposals',
    title: 'Admin Proposals',
    description: '수집 제안 승인과 초안 반영',
    pathPrefix: 'admin/proposals',
  },
  {
    slug: 'flags',
    title: 'Flags',
    description: '깃발·팔로우·기수·관리자 신고 처리',
    pathPrefix: 'flags',
  },
  {
    slug: 'festivals',
    title: 'Festivals',
    description: '발행 축제 목록·팩·깃발·라이브 보드',
    pathPrefix: 'festivals',
  },
  {
    slug: 'crews',
    title: 'Crews',
    description: '비공개 크루 생성·초대·상태·집결·멤버 관리',
    pathPrefix: 'crews',
  },
  {
    slug: 'schedule',
    title: 'Schedule',
    description: '내 페스티벌 일정 저장과 조회',
    pathPrefix: 'me/schedule',
  },
  {
    slug: 'devices',
    title: 'Devices',
    description: '기기 등록·조회·삭제와 Live Activity 토큰',
    pathPrefix: 'devices',
  },
  {
    slug: 'notifications',
    title: 'Notifications',
    description: '축제 시작·팩 변경 알림 구독',
    pathPrefix: 'notifications',
  },
  {
    slug: 'metrics',
    title: 'Metrics',
    description: '앱 관측 이벤트 일괄 수집',
    pathPrefix: 'metrics',
  },
  {
    slug: 'admin-metrics',
    title: 'Admin Metrics',
    description: '축제별 앱 관측 지표 집계',
    pathPrefix: 'admin/metrics',
  },
  {
    slug: 'admin-audit',
    title: 'Admin Audit',
    description: '관리자 변경 감사 이력',
    pathPrefix: 'admin/audit',
  },
  {
    slug: 'admin-push',
    title: 'Admin Push',
    description: '등록 기기에 테스트 푸시 발송',
    pathPrefix: 'admin/push',
  },
];
