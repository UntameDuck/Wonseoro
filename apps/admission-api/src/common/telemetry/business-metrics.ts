import { HttpException } from '@nestjs/common';
import { metrics } from '@opentelemetry/api';

/**
 * 업무 KPI 지표 (T-M4-22, 기술설계서 v1.0 §15·§10.4).
 *
 * 비율은 앱이 계산하지 않는다. 결과별 카운터를 내고 Prometheus 가 나눈다 — Pod 가 여럿이어도 합이 맞는다.
 *   draft_save_success_rate     = saved / (saved + error)
 *   payment_verify_success_rate = verified / (verified + unverified + error)
 *   finalize_success_rate       = (finalized + already_finalized) / (finalized + already_finalized + error)
 *   finalize_retry_rate         = already_finalized / (전체)
 * `rejected`(업무 검증 거절: 마감·필수값·상태)와 `conflict`(If-Match 불일치)는 시스템 실패가 아니라서 분모에서 뺀다.
 * §16 의 "Error Rate < 0.1%(업무 Validation 오류 제외)" 와 같은 기준이다.
 *
 * 라벨은 결과·경로 종류뿐이다. 원서·지원자·거래 식별자는 넣지 않는다 (§15 PII 보호).
 */
const meter = metrics.getMeter('k-admission.business');

const draftSaves = meter.createCounter('draft_saves', {
  description: '자동저장 결과별 수 (saved·conflict·rejected·error)',
});
const paymentVerifications = meter.createCounter('payment_verifications', {
  description: '결제 서버측 재검증 결과별 수 (verified·pending·failed·unverified·error)',
});
const paymentVerifyDuration = meter.createHistogram('payment_verify_duration', {
  description: 'PG 재조회를 포함한 결제 재검증 시간',
  unit: 's',
});
const finalizations = meter.createCounter('finalizations', {
  description: 'Finalize 결과별 수 (finalized·already_finalized·rejected·error), trigger=applicant|payment_confirmed',
});

// 알려진 결과 라벨을 기동 때 0 으로 만들어 둔다. 첫 요청에서 처음 생긴 시계열은 Prometheus 가 이미
// 올라간 값으로 처음 보게 돼 rate()·increase() 가 그 증가를 놓친다 — 마감 직후 첫 오류가 안 보이는 식이다.
for (const outcome of ['saved', 'conflict', 'rejected', 'error']) draftSaves.add(0, { outcome });
for (const outcome of ['verified', 'pending', 'failed', 'unverified', 'rejected', 'error']) {
  paymentVerifications.add(0, { outcome });
}
for (const trigger of ['applicant', 'payment_confirmed']) {
  for (const outcome of ['finalized', 'already_finalized', 'rejected', 'error']) finalizations.add(0, { outcome, trigger });
}

export type Outcome = 'success' | 'conflict' | 'rejected' | 'error';

/** 던져진 예외를 KPI 결과로 나눈다. 4xx 업무 예외는 거절, 412 는 충돌, 나머지는 시스템 오류다. */
export function classifyFailure(error: unknown): Exclude<Outcome, 'success'> {
  if (error instanceof HttpException) {
    const status = error.getStatus();
    if (status === 412 || status === 409) return 'conflict';
    if (status < 500) return 'rejected';
  }
  return 'error';
}

export async function trackDraftSave<T>(fn: () => Promise<T>): Promise<T> {
  try {
    const result = await fn();
    draftSaves.add(1, { outcome: 'saved' });
    return result;
  } catch (error) {
    draftSaves.add(1, { outcome: classifyFailure(error) });
    throw error;
  }
}

/** 결제 재검증. 결과 상태를 받아 verified·pending·failed·unverified 로 센다. */
export async function trackPaymentVerify<T extends { status: string }>(
  fn: () => Promise<{ row: T; unverified: boolean }>,
): Promise<T> {
  const started = performance.now();
  try {
    const { row, unverified } = await fn();
    paymentVerifications.add(1, { outcome: unverified ? 'unverified' : paymentOutcome(row.status) });
    return row;
  } catch (error) {
    paymentVerifications.add(1, { outcome: classifyFailure(error) === 'error' ? 'error' : 'rejected' });
    throw error;
  } finally {
    paymentVerifyDuration.record((performance.now() - started) / 1_000);
  }
}

function paymentOutcome(status: string): string {
  if (status === 'CONFIRMED') return 'verified';
  if (status === 'FAILED' || status === 'CANCELLED') return 'failed';
  if (status === 'UNKNOWN') return 'unverified';
  return 'pending';
}

export async function trackFinalize<T extends { created: boolean }>(
  trigger: 'applicant' | 'payment_confirmed',
  fn: () => Promise<T>,
): Promise<T> {
  try {
    const result = await fn();
    finalizations.add(1, { outcome: result.created ? 'finalized' : 'already_finalized', trigger });
    return result;
  } catch (error) {
    const failure = classifyFailure(error);
    finalizations.add(1, { outcome: failure === 'conflict' ? 'rejected' : failure, trigger });
    throw error;
  }
}
