/**
 * 개발용 본인 확인이 켜져 있는가. 개발 서버에서만 참이다 — 운영 빌드에서는 거짓이 코드에 박힌다(next.config.mjs). (T-M5-53)
 * 이 값이 거짓이면 화면은 지원자 식별자·가명 토큰을 받는 입력을 그리지 않는다.
 */
export const DEV_IDENTITY = process.env.WONSEORO_DEV_IDENTITY === '1';

/**
 * 개발 시드(`infra/db/seed-dev.sql`)에 등록된 지원자. 개발 화면의 "채우기" 버튼만 쓴다.
 * 화면 문구에 적지 않는다 — 운영 화면에 개발 값이 보이면 안 된다.
 */
export const DEMO_APPLICANT = {
  applicantId: '44444444-4444-4444-4444-444444444444',
  subjectToken: 'subj-dev-0001',
} as const;
