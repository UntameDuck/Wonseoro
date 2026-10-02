/**
 * 오류를 화면에 보이는 말 — 오류 code 마다 하나. (T-M5-52, docs/08-ui-production-readiness.md 결정 5)
 *
 * 화면은 서버의 `problem.title`·`detail` 을 그대로 보이지 않는다. 서버 문구는 API 를 쓰는 개발자에게도 쓰여
 * "허용되지 않은 상태 전이입니다 — DRAFT → PAYMENT_PENDING" 처럼 지원자가 읽을 수 없는 것이 섞인다.
 * 대신 이 표의 제목을 보이고, `detail` 은 **업무 오류(사용자 행동에 대한 답)** 일 때만 덧붙인다 —
 * 그 문구는 서버가 사용자에게 쓰도록 지킨다(`scripts/check-ui-copy.mjs` 가 서버 오류 문구도 본다).
 *
 * `Record<ProblemCodeValue, …>` 라 계약에 오류 code 가 늘면 타입 검사가 빠진 것을 잡는다.
 */
import { ProblemCode, type ProblemCodeValue } from './problem';

export interface ProblemText {
  /** 화면 제목. 무엇이 일어났는가. */
  title: string;
  /** 서버 설명을 쓰지 않을 때의 설명. 무엇을 하면 되는가. */
  detail: string;
}

const RELOAD = '화면을 새로고침한 뒤 다시 시도해 주십시오. 작성하신 내용은 보관되어 있습니다.';

export const PROBLEM_TEXT: Record<ProblemCodeValue, ProblemText> = {
  VALIDATION_FAILED: { title: '입력한 내용을 확인해 주십시오', detail: '입력한 값 가운데 받을 수 없는 것이 있습니다.' },
  DEADLINE_PASSED: { title: '접수가 마감되었습니다', detail: '서버 시각 기준으로 마감 이후의 요청입니다.' },
  VERSION_CONFLICT: { title: '다른 곳에서 먼저 저장되었습니다', detail: RELOAD },
  IDEMPOTENCY_KEY_REQUIRED: { title: '요청을 처리하지 못했습니다', detail: RELOAD },
  IDEMPOTENCY_KEY_INVALID: { title: '요청을 처리하지 못했습니다', detail: RELOAD },
  IDEMPOTENCY_KEY_REUSED: { title: '요청을 처리하지 못했습니다', detail: RELOAD },
  PAYMENT_NOT_CONFIRMED: { title: '결제가 확인되지 않았습니다', detail: '결제를 마치셨다면 잠시 후 결제 상태를 다시 확인해 주십시오.' },
  PAYMENT_STATE_UNKNOWN: { title: '결제 상태를 확인하는 중입니다', detail: '다시 결제하지 마시고 잠시 후 결제 상태를 다시 확인해 주십시오.' },
  PAYMENT_IN_PROGRESS: { title: '이미 진행 중인 결제가 있습니다', detail: '다시 결제하지 마시고 결제 상태를 확인해 주십시오.' },
  DOCUMENT_NOT_AVAILABLE: { title: '서류 검사가 끝나지 않았습니다', detail: '서류 검사가 끝난 뒤 다시 시도해 주십시오.' },
  ALREADY_FINALIZED: { title: '이미 접수가 완료된 원서입니다', detail: '접수가 끝난 원서는 고치거나 취소할 수 없습니다. 입학처에 문의해 주십시오.' },
  ONE_DEPARTMENT_PER_ADMISSION_TYPE: { title: '이 전형에는 이미 작성 중인 원서가 있습니다', detail: '한 전형에는 모집단위 하나만 지원할 수 있습니다. 내 원서에서 확인해 주십시오.' },
  ILLEGAL_TRANSITION: { title: '지금 원서 상태에서는 할 수 없는 요청입니다', detail: '현재 상태를 다시 확인해 주십시오.' },
  RETRYABLE: { title: '잠시 처리할 수 없습니다', detail: '잠시 후 다시 시도해 주십시오. 작성하신 내용은 보관되어 있습니다.' },
  FORBIDDEN: { title: '이 요청을 처리할 수 없습니다', detail: '본인확인 정보가 맞지 않습니다. 접수 홈에서 다시 본인확인을 해 주십시오.' },
  UNAUTHENTICATED: { title: '다시 로그인해 주십시오', detail: '로그인이 끝났거나 확인되지 않았습니다. 다시 로그인한 뒤 이어서 진행해 주십시오.' },
  STEP_UP_REQUIRED: { title: '본인 확인을 한 번 더 해 주십시오', detail: '중요한 작업이라 방금 한 본인 확인이 필요합니다. 다시 로그인한 뒤 이어서 진행해 주십시오.' },
  AUTH_UNAVAILABLE: { title: '지금 로그인을 확인할 수 없습니다', detail: '잠시 후 다시 시도해 주십시오. 계속되면 요청번호와 함께 문의해 주십시오.' },
  INTERNAL: { title: '처리 중 문제가 생겼습니다', detail: '잠시 후 다시 시도해 주십시오. 계속되면 요청번호와 함께 문의해 주십시오.' },
  NOT_FOUND: { title: '찾을 수 없습니다', detail: '주소를 다시 확인해 주십시오.' },
  // 버튼 동작은 저절로 다시 보내지 않는다 — "자동으로 다시 시도" 라고 하면 사실이 아니다. 자동저장은 따로 말한다 (T-M5-46)
  RATE_LIMITED: { title: '요청이 많아 잠시 기다려야 합니다', detail: '잠시 기다린 뒤 다시 시도해 주십시오. 작성하신 내용은 보관되어 있습니다.' },
};

/**
 * 서버 `detail` 을 화면에 덧붙여도 되는 code — 사용자 행동에 대한 업무 답이다
 * (예: "이 모집에서 선택할 수 없는 전형입니다", "연장은 마감을 늦추는 것만 가능합니다").
 * 나머지(프로토콜·상태 전이·내부 오류)는 이 표의 설명만 보인다.
 */
export const PROBLEM_DETAIL_SHOWN: readonly ProblemCodeValue[] = [
  ProblemCode.VALIDATION_FAILED,
  ProblemCode.PAYMENT_IN_PROGRESS,
  ProblemCode.DOCUMENT_NOT_AVAILABLE,
  ProblemCode.NOT_FOUND,
];

/** 화면에 보일 제목·설명. 모르는 code(다른 서버·옛 서버)는 일반 문구다. */
export function problemText(problem: { code?: string; detail?: string } | null | undefined): ProblemText {
  const code = problem?.code as ProblemCodeValue | undefined;
  const known = code && Object.prototype.hasOwnProperty.call(PROBLEM_TEXT, code) ? PROBLEM_TEXT[code] : null;
  if (!known) return PROBLEM_TEXT.INTERNAL;
  const detail = PROBLEM_DETAIL_SHOWN.includes(code!) && problem?.detail ? problem.detail : known.detail;
  return { title: known.title, detail };
}
