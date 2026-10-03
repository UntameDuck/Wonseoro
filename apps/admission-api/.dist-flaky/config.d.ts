/**
 * admission-api 설정 — 기동 시점에 전부 확정한다.
 *
 * 값을 쓰는 자리에서 `process.env` 를 읽지 않는다. 그렇게 하면 설정이 빠진 것을
 * 그 코드가 처음 실행될 때에야 알게 된다. 마감 직전에 결제 경로에서 처음 드러나는 식이다.
 */
/** 이 프로세스가 어느 대학의 Data Plane 인가. 서비스의 정체성이다. */
/**
 * 내부 경로 상호 TLS (T-M5-05, D-69) — 서류 워커가 부르는 `/internal/v1/documents/**` 를 같은 대학의 서류 워커 인증서로만 받고,
 * 중앙(공통원서 스냅숏·상태 확인)을 부를 때 이 워크로드의 인증서를 낸다. none 은 개발·단위 시험만 — 운영에서는 기동 거부
 */
export declare const INTERNAL: import("@wonseoro/server-kit").InternalAuthConfig;
export declare const UNIVERSITY_ID: string;
/**
 * 원서 항목 값 암호화의 키 암호화 키(KEK) 묶음 `FIELD_KEK_KEYS` (T-M5-06). 운영은 필수, 개발 KEK(dev)는 운영에서 기동 거부.
 * 기동 때 읽어 빠진 것을 첫 저장이 아니라 지금 안다
 */
export declare const FIELD_KEYS: import("@wonseoro/server-kit").KekProvider;
export declare const PORT: number;
export declare const CORS_ORIGINS: string[];
/** 중앙 Profile Vault. 없으면 공통원서 재사용만 꺼진다 — 접수는 계속된다. (D-18) */
export declare const CENTRAL_SYNC_URL: string;
/**
 * 가명처리 소금.
 *
 * 쓰는 자리(감사 기록·중앙 전달)에서 읽으면, 운영에서 빠진 것을 **첫 접수 때** 알게 된다.
 * 그때는 이미 늦다. 그래서 기동 시점에 확정한다.
 *
 * 고정값이면 가명처리가 아니다 — IPv4 전체를 해시해 대조하면 몇 초면 원본이 나온다.
 */
export declare const AUDIT_IP_SALT: string;
export declare const CENTRAL_ID_SALT: string;
/**
 * "내 원서" 통합 조회용 지원자 참조 키. (v1.1 §A12, T-M3-09)
 *
 * 중앙에 보내는 지원자 참조는 이 키로 만든 HMAC 이다. 키 없는 해시였을 때는 중앙 Vault 의
 * 토큰을 해시하기만 하면 요약과 조인됐다 (D-39). 모든 대학과 중앙 대시보드가 같은 키를
 * 쓴다 — 같은 사람이면 대학이 달라도 같은 참조가 나와야 한다. Vault 는 이 키를 갖지 않는다.
 * 키 보관은 M5 Vault(§06).
 */
export declare const CENTRAL_SUBJECT_KEY: string;
export declare const CENTRAL_SUBJECT_KEY_ID: string;
export declare const VAULT_TIMEOUT_MS: number;
/**
 * 외부 의존성 Circuit Breaker. (v1.1 §01 C8)
 *
 * 연속 몇 번 실패하면 끊고, 얼마 뒤에 탐침을 보낼지.
 * 너무 짧게 잡으면 죽은 의존성에 계속 탐침이 가고, 너무 길게 잡으면
 * 살아난 뒤에도 그만큼 통합 조회·결제 확인이 멈춰 있다.
 */
export declare const BREAKER: {
    readonly failureThreshold: number;
    readonly openMs: number;
};
/**
 * Central Dependency Health Gate. (v1.1 §A1)
 *
 * 중앙을 얼마 간격으로 확인할지, 중앙 반영이 얼마나 밀리면 "지연" 으로 볼지.
 * 확인 결과는 메모리에 두고 화면 조회는 그것만 읽는다. 마감 피크에 지원자
 * 수천 명이 배너 상태를 물어도 DB 와 중앙에는 이 간격으로만 간다.
 */
export declare const CENTRAL_GATE: {
    readonly autostart: boolean;
    readonly intervalMs: number;
    readonly syncLagWarnSeconds: number;
};
/**
 * 서버 시각 측정. (v1.1 §01 A9)
 *
 * 이 노드 시계와 DB 시계의 차이를 intervalMs 마다 probesPerSample 번 재서 왕복이 가장 짧은
 * 표본을 쓴다. 마지막 성공 측정이 intervalMs × 3 보다 오래되면 STALE 로 본다.
 */
export declare const CLOCK: {
    readonly autostart: boolean;
    readonly intervalMs: number;
    readonly probesPerSample: number;
};
/**
 * 인증 방식.
 *   dev-headers — x-applicant-id / x-admin-id 헤더를 그대로 신뢰한다. **개발 전용**
 *   gateway     — 앞단 인증 게이트웨이가 검증해 넣어준 신원을 쓴다
 *   oidc        — 이 API 가 `Authorization: Bearer` 액세스 토큰을 직접 검증한다(발급자 공개키 캐시).
 *                 지원자 렐름·담당자 렐름을 따로 둔다 (T-M5-02·10, docs/12-authentication-plan.md A3)
 *
 * 운영에서 dev-headers 면 기동하지 않는다. 헤더만 바꾸면 누구나 남의 원서를
 * 열람·수정할 수 있기 때문이다.
 */
export declare const AUTH_MODE: "dev-headers" | "gateway" | "oidc";
/**
 * OIDC 검증 설정 (AUTH_MODE=oidc 일 때만).
 *
 *   applicantIssuer / staffIssuer — 렐름 둘. 지원자 토큰으로 운영 API 를, 담당자 토큰으로 지원자 API 를 쓸 수 없다
 *   audience       — 토큰 aud 에 이 API 이름이 있어야 한다
 *   staffAcr       — 담당자 토큰의 인증 수준. 비밀번호+OTP 가 아니면 운영 API 를 열지 않는다(T-M5-10)
 *   stepUpMaxAgeSec — 민감 동작(승인·활성화·증적 열람 등)은 이 시간 안에 직접 인증했어야 한다
 *   jwksSnapshotDir — 발급자 공개키를 남길 폴더. 발급자 장애 중에 Pod 가 다시 떠도 검증이 이어진다(T-M3-06)
 *   jwksMaxStaleMs — 발급자에서 키를 못 받은 채 이 시간이 지나면 검증을 멈춘다(닫힌 실패)
 *   applicantOutageGraceMs — 발급자가 끊긴 동안 **지원자** 토큰이 만료돼도 이 시간까지 받는다(D-67). 단절 전에 끝난 토큰,
 *                     발급자가 살아 있을 때의 만료 토큰은 받지 않는다. 담당자 토큰에는 두지 않는다 — 운영 동작은 기다려도 된다.
 *                     기본 2시간 = 중앙 단절 인수기준(§01 A1). 0 이면 끈다
 */
export declare const OIDC: {
    applicantIssuer: string;
    staffIssuer: string;
    audience: string;
    staffAcr: string;
    stepUpMaxAgeSec: number;
    jwksSnapshotDir: string | null;
    jwksMaxStaleMs: number;
    applicantOutageGraceMs: number;
} | null;
/**
 * 운영 화면(/admin/v1)의 공유 비밀 — dev-headers·gateway 모드의 임시 문.
 * oidc 모드에서는 쓰지 않는다(담당자 토큰의 역할·인증 수준으로 막는다). 그 외 모드에서 없으면 운영에서 기동하지 않는다.
 */
export declare const ADMIN_API_TOKEN: string;
/** 결제 대행사. Mock 은 운영에서 선택될 수 없다. */
export declare const PAYMENT_PROVIDER: "mock";
/**
 * PG 콜백 서명 비밀. (v1.1 §A4·§B4, D-40)
 * 콜백은 인터넷에서 들어온다. 서명이 맞지 않으면 누구나 "결제 완료" 를 보낼 수 있다 —
 * 다만 콜백 값으로 상태를 정하지는 않는다(PG 에 다시 묻는다). 서명은 쓸데없는 재조회를 막는다.
 */
export declare const PG_CALLBACK_SECRET: string;
/**
 * 결제 재확인 워커. (D-40)
 *
 * PENDING·UNKNOWN 결제를 PG 에 다시 묻는다. 지원자가 결제 직후 창을 닫아도
 * 결제 확인이 저절로 끝나야 한다. 간격은 결제마다 Backoff 로 늘어난다(30초 → 30분).
 * maxAgeHours 가 지나면 더 묻지 않고 대조(PAYMENT_STATE_UNKNOWN_STALE)에 넘긴다.
 */
export declare const PAYMENT_RECHECK: {
    readonly autostart: boolean;
    readonly intervalMs: number;
    readonly batchSize: number;
    readonly maxAgeHours: number;
};
/**
 * 대조 자동 실행. (§B18 "D+1 자동 대조", D-40)
 * 사람이 눌러야만 도는 대조는 사고가 난 뒤에야 돈다. 매시간 최근 sinceHours 를 본다 —
 * 48시간 창이면 D+1 을 매시간 덮는다.
 */
export declare const RECON_SCHEDULE: {
    readonly autostart: boolean;
    readonly intervalMs: number;
    readonly sinceHours: number;
};
/**
 * 만료된 멱등 기록 정리. (D-11)
 * 기록은 24시간 뒤 만료된다. 지우지 않으면 마감 피크의 모든 변경 요청이 영원히 쌓인다.
 * Peak Mode 억제 구간에는 돌지 않는다 — 접수 핵심 경로가 아니다.
 */
export declare const IDEMPOTENCY_PURGE: {
    readonly autostart: boolean;
    readonly intervalMs: number;
};
/**
 * 감사 기록 WORM (T-M3-03, D-75) — Object Lock(COMPLIANCE) 버킷으로 감사 기록을 조각으로 내보낸다.
 * 운영은 버킷이 필수다(없으면 기동 거부) — 버킷은 IaC 가 Object Lock 을 켜서 만든다. 개발은 비우면 끈다.
 * 보관 기간 기본 5년 — 버킷의 기본 보관 규칙보다 짧으면 버킷 규칙이 이긴다.
 */
export declare const AUDIT_WORM: {
    readonly bucket: string;
    readonly autostart: boolean;
    readonly intervalMs: number;
    readonly settleSeconds: number;
    readonly batch: number;
    readonly retentionDays: number;
};
/**
 * Outbox 보관 (T-M4-10, §01 B7, 0005_outbox_archive.sql) — 전송·확인이 끝나고 afterDays 지난 이벤트를 영수증과 함께 월별 파티션으로 옮기고,
 * keepMonths 보다 오래된 달은 파티션째 지운다. 기본 보관 13개월 — 한 입시 주기와 이의 신청 기간을 넘긴다.
 */
export declare const OUTBOX_ARCHIVE: {
    readonly autostart: boolean;
    readonly intervalMs: number;
    readonly afterDays: number;
    readonly keepMonths: number;
    readonly batch: number;
};
export declare const PEAK_MODE: {
    readonly enabled: boolean;
    readonly scheduledActivationMs: number | null;
    readonly scheduledEndMs: number | null;
    readonly suspendNonCriticalJobs: boolean;
};
/**
 * 지원자 단위 Adaptive Throttling (§01 B6, T-M4-40, ADR-0007).
 * IP 가 아니라 인증된 지원자 기준이라 학교 NAT 뒤 정상 수험생을 묶어 막지 않는다.
 * observe 는 판정만 세고 막지 않는다 — 운영 첫 적용·한도 조정 때 먼저 켠다.
 */
export declare const THROTTLE_MODE: "enforce" | "observe" | "off";
/** 활성 마감정책이 없을 때 환경변수로 대신하는 개발용 경로. */
export declare const ALLOW_ENV_DEADLINE_POLICY: boolean;
/**
 * 마감 임박 구간에는 설정을 바꾸지 않는다. (v1.1 §A14 Freeze)
 *
 * 마지막 몇 시간에 지원자가 몰리고, 그때의 설정 변경은 검증할 시간이 없다.
 * 전형료·양식이 이 시점에 바뀌면 이미 작성 중인 원서가 무효가 된다.
 *
 * 마감 **연장**은 이 잠금과 무관하다. 연장은 `deadline_policy` 의 일이고
 * `config_version` 을 건드리지 않는다. (§B17)
 */
export declare const CONFIG_FREEZE_HOURS: number;
/**
 * 활성화 기록 서명 키 — Ed25519 개인키(PKCS#8 PEM). (v1.1 §B17 · §A1, T-M3-15)
 *
 * 마감·설정을 적용할 때마다 "누가 언제 왜 무엇을" 을 이 키로 서명해 남긴다.
 * 공개키는 `GET /api/v1/meta/signing-keys` 로 공개한다. 대학 밖에서도 검증할 수 있어야
 * 서명의 의미가 있다.
 *
 * 비우면 개발용 고정 키를 쓴다. **운영에서는 필수다** — 개발 키로 서명한 기록은
 * 누구나 같은 서명을 만들 수 있으므로 아무것도 증명하지 못한다.
 * 키 보관은 M5 Vault(§06)로 옮긴다.
 */
export declare const POLICY_SIGNING_KEY: string;
/** 키 교체를 대비해 기록마다 어떤 키로 서명했는지 남긴다. */
export declare const POLICY_SIGNING_KEY_ID: string;
export declare const S3: {
    readonly bucket: string;
    readonly region: string;
    readonly endpoint: string;
    readonly autoCreateBucket: boolean;
};
/**
 * 출구 허용 목록 (T-M5-07) — 이 서비스가 부르는 곳만: 중앙, 로그인 서버 두 렐름, Object Storage. 더할 것은 EGRESS_ALLOWLIST.
 * 연결 순간 메타데이터·링크 로컬 주소(운영은 루프백도)는 어느 이름으로 풀려도 거절한다.
 */
export declare const EGRESS: import("@wonseoro/server-kit").EgressPolicy;
