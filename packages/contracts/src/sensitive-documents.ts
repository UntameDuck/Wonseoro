/**
 * 민감정보 서류 — 장애·건강(진단서·입원확인서 등)을 담은 서류는 다른 개인정보와 **별도로** 동의를 받는다
 * (보호법 제23조 ① 1, 문서 10 G-8, 대장 D-85).
 *
 * 전형 설정 `sensitiveDocuments` 가 서류 종류마다 그 서류에 필요한 별도 동의 코드를 정한다 —
 * `{ "DISABILITY_CERT": "SENSITIVE_HEALTH" }`. 동의 문안 자체는 `consents` 에 둔다(필수 아님 — 해당자만 동의한다).
 * 그 서류를 올리려면 먼저 그 동의를 해야 하고, 그 서류가 원서에 있는 동안 동의를 거두면 접수할 수 없다.
 */

/** 서류 종류·이름이 이 말을 담으면 민감정보 서류로 보인다 — 표시가 없으면 설정 검사가 경고한다 */
export const SENSITIVE_DOCUMENT_HINT = /장애|진단|입원|건강|질병|질환|병원|의료|disab|medical|health|hospital|diagnos/i;

/** 설정 값에서 형식이 맞는 (서류 종류 → 동의 코드) 쌍만 꺼낸다 */
export function pickSensitiveDocuments(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [type, code] of Object.entries(value as Record<string, unknown>)) {
    if (/^[A-Z][A-Z0-9_]{0,63}$/.test(type) && typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(code)) out[type] = code;
  }
  return out;
}
