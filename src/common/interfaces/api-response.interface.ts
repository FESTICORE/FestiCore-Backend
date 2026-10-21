/** JSON API 응답의 공통 형식. HTTP 상태는 응답 상태 줄에서 확인한다. */
export interface ApiResponse<T> {
  code: string;
  data: T | null;
  message: string;
}

export function apiSuccess<T>(data: T): ApiResponse<T> {
  return {
    code: 'SUCCESS',
    data: data ?? null,
    message: '성공적으로 처리되었습니다.',
  };
}
