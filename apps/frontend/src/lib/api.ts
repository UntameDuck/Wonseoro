/**
 * 백엔드 호출 계층.
 *
 * 화면은 fetch 를 직접 부르지 않는다. 여기 규칙이 전부 들어 있다.
 *   - 모든 mutation 에 Idempotency-Key (최소 16자)
 *   - Draft 수정은 merge-patch + If-Match
 *   - 오류는 problem+json 으로 온다
 */

const ADMISSION = process.env.NEXT_PUBLIC_ADMISSION_API ?? 'http://localhost:3001';
const CENTRAL = process.env.NEXT_PUBLIC_CENTRAL_API ?? 'http://localhost:3000';

export interface Problem {
  type: string;
  title: string;
  status: number;
  code: string;
  traceId: string;
  detail?: string;
  serverTime?: string;
  deadlineAt?: string;
  deadlinePolicyVersion?: string;
}

export class ApiError extends Error {
  constructor(
    readonly problem: Problem,
    readonly httpStatus: number,
    /** 429 RATE_LIMITED 일 때 서버가 준 대기 시간(초). 이보다 먼저 다시 보내지 않는다 (D-51). */
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(problem.detail ?? problem.title);
  }
}

/** 네트워크 자체가 안 될 때. 화면은 이것을 "장애"로 다룬다. */
export class NetworkError extends Error {
  constructor(
    readonly cause_: string,
    /** 이 요청에 붙였던 요청번호 — 연결이 끊겨도 문의할 번호가 남는다 (T-M5-55, U-8) */
    readonly traceId: string = '',
  ) {
    super('서버에 연결할 수 없습니다');
  }
}

/**
 * 요청번호. 화면이 만들어 W3C `traceparent` 로 보낸다 — 서버는 그 추적 ID 를 problem 의 traceId·로그에 쓴다.
 * 화면이 번호를 먼저 알기 때문에 연결이 끊긴 요청에도 번호를 보일 수 있고(U-8), 오래 걸리는 요청 안내에도
 * 지금 기다리는 요청의 번호를 보일 수 있다(U-59). 고객센터는 이 번호로 서버 로그를 찾는다.
 */
let lastTraceId = '';
export function currentRequestId(): string {
  return lastTraceId;
}

function newTraceparent(): { header: string; traceId: string } {
  const hex = (bytes: number) => {
    const buf = new Uint8Array(bytes);
    if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto) crypto.getRandomValues(buf);
    else for (let i = 0; i < bytes; i++) buf[i] = Math.floor(Math.random() * 256);
    return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
  };
  const traceId = hex(16);
  return { header: `00-${traceId}-${hex(8)}-01`, traceId };
}

/**
 * Idempotency-Key 는 **재시도할 때 같은 값을 보내야** 의미가 있다.
 * 매번 새로 만들면 중복 방지가 되지 않는다.
 * 화면이 "하나의 사용자 행동"마다 한 번 만들어 보관한다.
 */
export function newIdempotencyKey(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '')
      : Math.random().toString(36).slice(2).padEnd(24, '0');
  return `${prefix}-${rand}`.slice(0, 64).padEnd(16, '0');
}

interface CallOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  idempotencyKey?: string;
  ifMatch?: string;
  contentType?: string;
  base?: 'admission' | 'central';
  /** 개발용 신원 헤더. M5 에서 세션/OIDC 로 교체된다. */
  applicantId?: string;
  subjectToken?: string;
}

export interface ApiResponse<T> {
  data: T;
  etag: string | null;
  status: number;
}

export async function call<T>(path: string, opts: CallOptions = {}): Promise<ApiResponse<T>> {
  const base = opts.base === 'central' ? CENTRAL : ADMISSION;
  const headers: Record<string, string> = {};

  if (opts.body !== undefined) {
    headers['content-type'] = opts.contentType ?? 'application/json';
  }
  if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey;
  if (opts.ifMatch) headers['if-match'] = opts.ifMatch;
  if (opts.applicantId) headers['x-applicant-id'] = opts.applicantId;
  if (opts.subjectToken) headers['x-subject-token'] = opts.subjectToken;
  const trace = newTraceparent();
  headers.traceparent = trace.header;
  lastTraceId = trace.traceId;

  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch (err) {
    throw new NetworkError((err as Error).message, trace.traceId);
  }

  const text = await res.text();
  const parsed: unknown = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const retryAfter = Number(res.headers.get('retry-after'));
    throw new ApiError(parsed as Problem, res.status, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null);
  }
  return {
    data: parsed as T,
    etag: res.headers.get('etag'),
    status: res.status,
  };
}

/* ── 도메인 타입 ──────────────────────────────────────────────────────── */

export interface ServerTime {
  serverTime: string;
  deadlineAt: string;
  deadlinePolicyVersion: string;
  remainingMs: number;
  warningMinutes: number | null;
  passed: boolean;
}

export interface Application {
  id: string;
  cycleId: string;
  admissionTypeId: string;
  departmentId: string;
  status: string;
  version: number;
  lastSavedAt: string | null;
  fields: Record<string, unknown>;
  serverTime: string;
  deadlineAt: string;
  deadlinePolicyVersion: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: Array<{ code: string; path: string; message: string }>;
}

export interface SelfCheck {
  applicationId: string;
  serverTime: string;
  deadlineAt: string;
  application: { status: string; lastSavedAt: string | null; summary: string };
  submission: {
    submissionId: string;
    applicationNumber: string;
    finalizedAt: string;
  } | null;
  /** paymentId 가 있으면 새 결제를 만들지 않고 이 결제를 다시 확인한다 (재결제 방지). */
  payment: { exists: boolean; paymentId?: string; status?: string; amount?: number; requestedAt?: string; guidance: string };
  documents: Array<{ documentType: string; status: string; guidance: string }>;
  centralSync: { pending: number; sent: number; guidance: string };
  timeline: Array<{ at: string; what: string; result: string }>;
}

/** 이 대학 서버가 중앙 없이 돌고 있는가. 배너의 근거. (v1.1 §A1) */
export interface OperatingModeView {
  mode: 'CONNECTED' | 'AUTONOMOUS';
  reason: 'CENTRAL_NOT_CONFIGURED' | 'CENTRAL_UNREACHABLE' | null;
  since: string;
  lastCentralContactAt: string | null;
  sync: { pendingEvents: number; oldestPendingAgeSeconds: number; lagging: boolean };
  checkedAt: string;
  serverTime: string;
}

/** 전형이 받는 서류. 대학 설정에서 온다 — 화면에 서류 종류를 박지 않는다. (§A5, D-56) */
export interface DocumentSpec {
  documentType: string;
  label: string;
  required: boolean;
}

/** 공통원서 — 중앙 Vault 에 있는 지원자 본인의 것. (D-57) */
export interface CommonProfile {
  fields: Record<string, string | number>;
  consents: Array<{ universityId: string; universityName?: string | null; fieldCodes: string[]; grantedAt: string }>;
  updatedAt: string | null;
}

export interface Submission {
  applicationId: string;
  submissionId: string;
  applicationNumber: string;
  status: 'FINALIZED';
  finalizedAt: string;
  deadlinePolicyVersion: string;
}

/* ── 호출 ─────────────────────────────────────────────────────────────── */

export const api = {
  /** 마감 판정의 기준. **브라우저 시간을 쓰지 않는다.** (v1.1 §A2) */
  serverTime: (cycleId: string) =>
    call<ServerTime>(`/api/v1/meta/time?admissionCycleId=${encodeURIComponent(cycleId)}`),

  createApplication: (
    body: { cycleId: string; admissionTypeId: string; departmentId: string },
    who: { applicantId: string; subjectToken?: string },
  ) =>
    call<Application>('/api/v1/applications', {
      method: 'POST',
      body,
      idempotencyKey: newIdempotencyKey('create'),
      applicantId: who.applicantId,
      ...(who.subjectToken ? { subjectToken: who.subjectToken } : {}),
    }),

  /**
   * 원서 조회는 **본인 것만** 된다. (D-28) 신원 없이 부르면 403 이다.
   * 조회 호출이 신원을 안 실어서 원서 생성 직후 화면이 멈춘 적이 있다.
   */
  getApplication: (id: string, applicantId: string) =>
    call<Application>(`/api/v1/applications/${id}`, { applicantId }),

  /** 자동저장. If-Match 가 없으면 서버가 거부한다. */
  patchApplication: (
    id: string,
    fields: Record<string, unknown>,
    etag: string,
    applicantId: string,
    idempotencyKey: string,
  ) =>
    call<Application>(`/api/v1/applications/${id}`, {
      method: 'PATCH',
      body: { fields },
      contentType: 'application/merge-patch+json',
      ifMatch: etag,
      idempotencyKey,
      applicantId,
    }),

  /**
   * 최종 검증. 통과하면 서버가 원서를 READY 로 옮기고 새 ETag 를 준다 —
   * 이어서 저장하려면 그 ETag 를 써야 한다(아니면 412).
   */
  validate: (id: string, applicantId: string) =>
    call<ValidationResult>(`/api/v1/applications/${id}/validate`, {
      method: 'POST',
      idempotencyKey: newIdempotencyKey('validate'),
      applicantId,
    }),

  /**
   * 결제 의도. 201 새 결제창 · 200 이미 열린 결제창(같은 결제) ·
   * 409 PAYMENT_IN_PROGRESS 확인 중·확정된 결제가 있다 — 다시 결제하지 않는다.
   */
  createPaymentIntent: (id: string, applicantId: string, key: string) =>
    call<{ paymentId: string; amount: number; currency: string; provider: string }>(
      `/api/v1/applications/${id}/payment-intents`,
      { method: 'POST', idempotencyKey: key, applicantId },
    ),

  /** 접수 전 취소. 사유가 필요하다. 확인된 결제가 있으면 대학이 환불을 처리한다. (D-7) */
  cancel: (id: string, reason: string, applicantId: string, key: string) =>
    call<{ applicationId: string; status: 'CANCELLED'; cancelledAt: string; refundRequired: boolean }>(
      `/api/v1/applications/${id}/cancel`,
      { method: 'POST', body: { reason }, idempotencyKey: key, applicantId },
    ),

  /** 접수증. 발급할 때마다 서버가 기록한다(RECEIPT_ISSUED). */
  receipt: (submissionId: string, applicantId: string) =>
    call<{
      submissionId: string;
      applicationNumber: string;
      finalizedAt: string;
      /** 접수증 항목 (계약 1.6.0) — 옛 서버는 없다 */
      admissionTypeName?: string;
      departmentName?: string;
      status?: 'FINALIZED';
    }>(
      `/api/v1/submissions/${submissionId}/receipt`,
      { applicantId },
    ),

  verifyPayment: (paymentId: string, applicantId: string, key: string) =>
    call<{ id: string; status: string; amount: number }>(
      `/api/v1/payments/${paymentId}/verify`,
      { method: 'POST', idempotencyKey: key, applicantId },
    ),

  finalize: (id: string, applicantId: string, key: string) =>
    call<Submission>(`/api/v1/applications/${id}/finalize`, {
      method: 'POST',
      idempotencyKey: key,
      applicantId,
    }),

  selfCheck: (id: string, applicantId: string) =>
    call<SelfCheck>(`/api/v1/applications/${id}/self-check`, { applicantId }),

  operatingMode: () => call<OperatingModeView>('/api/v1/meta/operating-mode'),

  /**
   * 추가문항 스키마. 화면은 이것을 보고 입력 필드를 그린다.
   * 전형이 늘어도 프론트 코드를 고치지 않는 근거다. (v1.1 §A5)
   */
  formSchema: (id: string, applicantId: string) =>
    call<{
      admissionTypeCode: string;
      schemaVersion: string;
      schema: {
        type?: string;
        properties?: Record<string, Record<string, unknown>>;
        required?: string[];
      };
      /** 공통원서에서 가져오는 항목 — 1단계에 그린다 */
      profileFields?: string[];
      /** 이 전형이 받는 서류 */
      documents?: DocumentSpec[];
    }>(`/api/v1/applications/${id}/form-schema`, { applicantId }),

  submission: (id: string, applicantId: string) =>
    call<Submission>(`/api/v1/applications/${id}/submission`, { applicantId }),

  /* ── 모집 카탈로그. 하드코딩을 걷어내는 근거다 ─────────────────────── */

  currentCycle: () =>
    call<{
      id: string;
      universityId: string;
      universityName?: string;
      admissionYear: number;
      name: string;
      closesAt: string;
    }>('/api/v1/admission-cycles/current'),

  admissionTypes: (cycleId: string) =>
    call<Array<{ id: string; code: string; name: string; feeAmount: number }>>(
      `/api/v1/admission-types?cycleId=${encodeURIComponent(cycleId)}`,
    ),

  departments: (cycleId: string) =>
    call<Array<{ id: string; code: string; name: string; quota: number | null }>>(
      `/api/v1/departments?cycleId=${encodeURIComponent(cycleId)}`,
    ),

  /* ── 서류 ─────────────────────────────────────────────────────────── */

  createUploadIntent: (
    applicationId: string,
    body: { documentType: string; filename: string; mediaType: string; sizeBytes: number },
    applicantId: string,
    key: string,
  ) =>
    call<{
      documentId: string;
      uploadUrl: string;
      expiresAt: string;
      requiredHeaders: Record<string, string>;
    }>(`/api/v1/applications/${applicationId}/documents/upload-intents`, {
      method: 'POST',
      body,
      idempotencyKey: key,
      applicantId,
    }),

  completeUpload: (
    documentId: string,
    body: { sha256: string; sizeBytes: number },
    applicantId: string,
    key: string,
  ) =>
    call<{ id: string; status: string }>(`/api/v1/documents/${documentId}/complete`, {
      method: 'POST',
      body,
      idempotencyKey: key,
      applicantId,
    }),

  /** 중앙 Dashboard. 중앙이 죽어 있으면 NetworkError 가 난다 — 화면이 그것을 다룬다. */
  dashboard: (applicantToken: string) =>
    call<{
      serverTime: string;
      applications: Array<{
        universityId: string;
        universityName?: string;
        /** false 면 그 대학 심장박동이 끊겼다 — 이 행이 최신이 아닐 수 있다 (D-60) */
        universityReachable?: boolean;
        universityLastHeartbeatAt?: string | null;
        applicationNumber: string | null;
        status: string;
        admissionTypeCode: string;
        departmentCode: string;
        /** 표시 이름 (계약 1.5.0). 이름 없이 동기화된 옛 행은 null — 화면은 코드를 보이지 않는다 */
        admissionTypeName?: string | null;
        departmentName?: string | null;
        lastSyncedAt: string;
      }>;
    }>(
      // 식별자를 URL 에 싣지 않는다. 프록시·접근 로그·브라우저 기록에 남는다. (D-39)
      '/api/v1/dashboard/applications',
      { base: 'central', subjectToken: applicantToken },
    ),

  /** 내 공통원서. 중앙이 죽어 있으면 NetworkError — 원서 작성은 계속할 수 있다. (D-18) */
  profile: (subjectToken: string) =>
    call<CommonProfile>('/api/v1/profile', { base: 'central', subjectToken }),

  /**
   * 공통원서 저장 — 통째로 바꾼다(PUT). 동의 목록에서 뺀 대학의 동의는 철회된다.
   * 신원은 헤더로만 보낸다. 본문에 토큰을 싣지 않는다.
   */
  saveProfile: (
    subjectToken: string,
    body: {
      fields: Record<string, string | number | null>;
      consents: Array<{ universityId: string; fieldCodes: string[] }>;
    },
  ) => call<CommonProfile>('/api/v1/profile', { method: 'PUT', body, base: 'central', subjectToken }),
};
