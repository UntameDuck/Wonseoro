import { envInt, envList } from '@wonseoro/server-kit';

/** central-api 설정. */
export const PORT = envInt('PORT', 3000, { min: 1, max: 65535 });

export const CORS_ORIGINS = envList(
  'CORS_ORIGINS',
  ['http://localhost:4000'],
  '지원자 웹의 오리진',
);
