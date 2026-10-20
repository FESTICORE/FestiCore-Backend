import { authConfig } from './auth.config';

/** ConfigModule.forRoot 의 load 에 넘길 설정 팩토리 목록. */
export const configurations = [authConfig];

export { authConfig };
export type { AuthConfig } from './auth.config';
