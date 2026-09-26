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
  ) {
    super(problem.detail ?? problem.title);
  }
}

/** 네트워크 자체가 안 될 때. 화면은 이것을 "장애"로 다룬다. */
export class NetworkError extends Error {
  constructor(readonly cause_: string) {
    super('서버에 연결할 수 없습니다');
  }
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
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
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

  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch (err) {
    throw new NetworkError((err as Error).message);
  }

  const text = await res.text();
  const parsed: unknown = text ? JSON.parse(text) : null;

  if (!res.ok) {
    throw new ApiError(parsed as Problem, res.status);
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
  payment: { exists: boolean; status?: string; guidance: string };
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

  getApplication: (id: string) => call<Application>(`/api/v1/applications/${id}`),

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

  validate: (id: string, applicantId: string) =>
    call<ValidationResult>(`/api/v1/applications/${id}/validate`, {
      method: 'POST',
      idempotencyKey: newIdempotencyKey('validate'),
      applicantId,
    }),

  createPaymentIntent: (id: string, applicantId: string, key: string) =>
    call<{ paymentId: string; amount: number; currency: string; provider: string }>(
      `/api/v1/applications/${id}/payment-intents`,
      { method: 'POST', idempotencyKey: key, applicantId },
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

  selfCheck: (id: string) => call<SelfCheck>(`/api/v1/applications/${id}/self-check`),

  operatingMode: () => call<OperatingModeView>('/api/v1/meta/operating-mode'),

  /**
   * 추가문항 스키마. 화면은 이것을 보고 입력 필드를 그린다.
   * 전형이 늘어도 프론트 코드를 고치지 않는 근거다. (v1.1 §A5)
   */
  formSchema: (id: string) =>
    call<{
      admissionTypeCode: string;
      schemaVersion: string;
      schema: {
        type?: string;
        properties?: Record<string, Record<string, unknown>>;
        required?: string[];
      };
    }>(`/api/v1/applications/${id}/form-schema`),

  submission: (id: string) => call<Submission>(`/api/v1/applications/${id}/submission`),

  /* ── 모집 카탈로그. 하드코딩을 걷어내는 근거다 ─────────────────────── */

  currentCycle: () =>
    call<{
      id: string;
      universityId: string;
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
        applicationNumber: string | null;
        status: string;
        admissionTypeCode: string;
        departmentCode: string;
        lastSyncedAt: string;
      }>;
    }>(
      `/api/v1/dashboard/applications?applicantToken=${encodeURIComponent(applicantToken)}`,
      { base: 'central' },
    ),

  saveProfile: (body: {
    subjectToken: string;
    fields: Record<string, unknown>;
    consents: Array<{ universityId: string; fieldCodes: string[] }>;
  }) => call<{ ok: boolean }>('/internal/v1/profiles', { method: 'POST', body, base: 'central' }),
};
