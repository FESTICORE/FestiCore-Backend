/** 모든 API 응답의 표준 형식 */
export interface ApiResponse<T> {
  success: boolean;
  statusCode: number;
  data: T | null;
  message: string;
}
