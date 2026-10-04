// K-PaaS/CSP 외부 환경용 M Profile 부하 프로필.
// 노션 첨부 사본 tests/load/k6-admission.js는 바이트를 바꾸지 않고, 실제 다중 사용자·프로필 실행은 여기서 한다.
//
// 필수 환경:
//   ALLOW_LOAD_TEST=true, BASE_URL=https://..., LOAD_PROFILE, LOAD_TEST_APPROVAL, TARGET_ENVIRONMENT,
//   LOAD_USERS_FILE(토큰·원서 ID·유효한 저장 payload JSON, 저장소에 커밋 금지), SUMMARY_PATH
// 6시간 Soak는 OIDC_TOKEN_ENDPOINT·OIDC_CLIENT_ID와 사용자별 refreshToken이 추가로 필요하다.
import http from 'k6/http';
import { check, fail, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import exec from 'k6/execution';

const BASE = __ENV.BASE_URL;
const PROFILE = __ENV.LOAD_PROFILE;
const APPROVAL = __ENV.LOAD_TEST_APPROVAL;
const ENVIRONMENT = __ENV.TARGET_ENVIRONMENT;
const USERS_FILE = __ENV.LOAD_USERS_FILE;
const SUMMARY_PATH = __ENV.SUMMARY_PATH;
const SOAK_VUS = Number(__ENV.SOAK_VUS || 0);
const INITIALIZED_AT = new Date().toISOString();
const TOKEN_ENDPOINT = __ENV.OIDC_TOKEN_ENDPOINT || '';
const OIDC_CLIENT_ID = __ENV.OIDC_CLIENT_ID || '';
const OIDC_CLIENT_SECRET = __ENV.OIDC_CLIENT_SECRET || '';

if (__ENV.ALLOW_LOAD_TEST !== 'true') fail('승인된 부하 환경에서만 ALLOW_LOAD_TEST=true를 설정한다.');
if (!BASE || !/^https:\/\//u.test(BASE)) fail('BASE_URL은 승인된 HTTPS 시험 주소여야 한다.');
if (!APPROVAL || !ENVIRONMENT) fail('LOAD_TEST_APPROVAL과 TARGET_ENVIRONMENT를 기록한다.');
if (!USERS_FILE || !SUMMARY_PATH) fail('LOAD_USERS_FILE과 SUMMARY_PATH를 지정한다.');

const profileSpecs = {
  'baseline-500': { users: 500 },
  'expected-1500': { users: 1500 },
  'deadline-3000-rps1000': { users: 3000 },
  'failover-70': { users: 1050 },
  'soak-6h': { users: SOAK_VUS },
};
const spec = profileSpecs[PROFILE];
if (!spec) fail(`알 수 없는 LOAD_PROFILE: ${PROFILE}`);
if (PROFILE === 'soak-6h' && (!Number.isInteger(SOAK_VUS) || SOAK_VUS < 1 || SOAK_VUS > 1500)) {
  fail('SOAK_VUS는 기관이 승인한 1~1500 정수여야 한다.');
}

const users = new SharedArray('authorized synthetic load users', () => {
  const parsed = JSON.parse(open(USERS_FILE));
  if (!Array.isArray(parsed)) fail('LOAD_USERS_FILE은 JSON 배열이어야 한다.');
  return parsed.map((row, index) => {
    if (!row || typeof row !== 'object' || !row.accessToken || !row.expiresAt || !row.applicationId || !row.savePayload || typeof row.savePayload !== 'object' || Array.isArray(row.savePayload)) {
      fail(`LOAD_USERS_FILE ${index + 1}행에 accessToken·expiresAt·applicationId·savePayload가 모두 있어야 한다.`);
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(row.applicationId)) {
      fail(`LOAD_USERS_FILE ${index + 1}행 applicationId가 UUID가 아니다.`);
    }
    if (Number.isNaN(Date.parse(row.expiresAt))) fail(`LOAD_USERS_FILE ${index + 1}행 expiresAt이 ISO 날짜·시각이 아니다.`);
    if (PROFILE === 'soak-6h' && !row.refreshToken) fail(`6시간 Soak 사용자 ${index + 1}행에 refreshToken이 없다.`);
    return row;
  });
});
if (users.length < spec.users) fail(`${PROFILE}은 합성 사용자 ${spec.users}명이 필요하지만 ${users.length}명뿐이다.`);
if (new Set(users.slice(0, spec.users).map((user) => user.applicationId)).size !== spec.users) {
  fail(`${PROFILE} 시험 구간의 applicationId가 중복됐다.`);
}
if (PROFILE === 'soak-6h' && (!/^https:\/\//u.test(TOKEN_ENDPOINT) || !OIDC_CLIENT_ID)) {
  fail('6시간 Soak는 HTTPS OIDC_TOKEN_ENDPOINT와 OIDC_CLIENT_ID가 필요하다.');
}

const thresholds = {
  http_req_failed: ['rate<0.001'],
  'http_req_duration{kind:read}': ['p(95)<300'],
  'http_req_duration{kind:save}': ['p(95)<500'],
  checks: ['rate>0.999'],
  dropped_iterations: ['count==0'],
};

const journeyStages = (target) => [
  { duration: '5m', target },
  { duration: '20m', target },
  { duration: '5m', target: 0 },
];

const scenarios = {
  'baseline-500': {
    applicants: { executor: 'ramping-vus', exec: 'applicantJourney', startVUs: 0, stages: journeyStages(500), gracefulRampDown: '1m' },
  },
  'expected-1500': {
    applicants: { executor: 'ramping-vus', exec: 'applicantJourney', startVUs: 0, stages: journeyStages(1500), gracefulRampDown: '1m' },
  },
  'deadline-3000-rps1000': {
    stressUsers: {
      executor: 'ramping-vus', exec: 'applicantJourney', startVUs: 0,
      stages: [{ duration: '5m', target: 3000 }, { duration: '10m', target: 3000 }, { duration: '5m', target: 0 }],
      gracefulRampDown: '1m',
    },
    apiBurst: {
      executor: 'ramping-arrival-rate', exec: 'burstRead', startRate: 100, timeUnit: '1s', preAllocatedVUs: 1000, maxVUs: 3000,
      stages: [{ duration: '2m', target: 1000 }, { duration: '5m', target: 1000 }, { duration: '2m', target: 100 }],
      startTime: '5m', gracefulStop: '1m',
    },
  },
  'failover-70': {
    applicants: { executor: 'ramping-vus', exec: 'applicantJourney', startVUs: 0, stages: journeyStages(1050), gracefulRampDown: '1m' },
  },
  'soak-6h': {
    applicants: {
      executor: 'ramping-vus', exec: 'applicantJourney', startVUs: 0,
      stages: [{ duration: '10m', target: SOAK_VUS }, { duration: '5h40m', target: SOAK_VUS }, { duration: '10m', target: 0 }],
      gracefulRampDown: '2m',
    },
  },
};

export const options = {
  scenarios: scenarios[PROFILE],
  thresholds,
  summaryTrendStats: ['min', 'med', 'avg', 'p(90)', 'p(95)', 'p(99)', 'max'],
  tags: { profile: PROFILE, environment: ENVIRONMENT, approval: APPROVAL },
};

const userForVu = () => users[(exec.vu.idInTest - 1) % users.length];
let vuAuth = null;
function accessToken(user) {
  if (!vuAuth || vuAuth.applicationId !== user.applicationId) {
    vuAuth = { applicationId: user.applicationId, accessToken: user.accessToken, refreshToken: user.refreshToken, expiresAt: Date.parse(user.expiresAt) };
  }
  if (vuAuth.expiresAt > Date.now() + 60_000) return vuAuth.accessToken;
  if (!vuAuth.refreshToken || !TOKEN_ENDPOINT || !OIDC_CLIENT_ID) fail(`VU ${exec.vu.idInTest}의 OIDC 토큰이 끝났고 갱신 설정이 없다.`);
  const response = http.post(TOKEN_ENDPOINT, {
    grant_type: 'refresh_token',
    client_id: OIDC_CLIENT_ID,
    refresh_token: vuAuth.refreshToken,
    ...(OIDC_CLIENT_SECRET ? { client_secret: OIDC_CLIENT_SECRET } : {}),
  }, { tags: { kind: 'auth' }, timeout: '10s' });
  if (!check(response, { 'OIDC 토큰 갱신 200': (result) => result.status === 200 })) fail(`VU ${exec.vu.idInTest}의 OIDC 토큰 갱신 실패`);
  const body = response.json();
  vuAuth = {
    ...vuAuth,
    accessToken: body.access_token,
    refreshToken: body.refresh_token || vuAuth.refreshToken,
    expiresAt: Date.now() + Number(body.expires_in || 0) * 1000,
  };
  if (!vuAuth.accessToken || vuAuth.expiresAt <= Date.now() + 60_000) fail(`VU ${exec.vu.idInTest}가 쓸 수 있는 갱신 토큰을 받지 못했다.`);
  return vuAuth.accessToken;
}
const headers = (user, extra = {}) => ({
  Authorization: `Bearer ${accessToken(user)}`,
  'Content-Type': 'application/json',
  ...extra,
});
const idem = (prefix) => `${prefix}-${exec.vu.idInTest}-${exec.scenario.iterationInTest}-${Date.now()}`;

export function applicantJourney() {
  const user = userForVu();
  const read = http.get(`${BASE}/api/v1/applications/${user.applicationId}`, {
    headers: headers(user), tags: { kind: 'read' }, timeout: '10s',
  });
  const readOk = check(read, { '원서 조회 200': (response) => response.status === 200 });
  const etag = read.headers.ETag || read.headers.Etag;

  if (readOk && etag && Math.random() < 0.5) {
    const saved = http.patch(`${BASE}/api/v1/applications/${user.applicationId}`, JSON.stringify(user.savePayload), {
      headers: headers(user, {
        'Content-Type': 'application/merge-patch+json',
        'If-Match': etag,
        'Idempotency-Key': idem('load-save'),
      }),
      tags: { kind: 'save' }, timeout: '10s',
    });
    check(saved, { '자동저장 200': (response) => response.status === 200 });
  }
  // 실제 사용자의 읽기·입력 시간을 흉내 낸다. 정확한 분포는 대학 승인 실행계획에 기록한다.
  sleep(2 + Math.random() * 3);
}

export function burstRead() {
  const user = userForVu();
  const response = http.get(`${BASE}/api/v1/applications/${user.applicationId}/self-check`, {
    headers: headers(user), tags: { kind: 'read' }, timeout: '10s',
  });
  check(response, { '상태 확인 200': (result) => result.status === 200 });
}

export function setup() {
  console.log(JSON.stringify({
    event: 'load-test-start', profile: PROFILE, environment: ENVIRONMENT, approval: APPROVAL,
    users: spec.users, at: new Date().toISOString(),
    ...(PROFILE === 'failover-70' ? { operatorAction: '시험 시작 10~15분 사이 승인된 HA 콘솔에서 Primary Failover 실행' } : {}),
  }));
}

export function handleSummary(data) {
  return {
    [SUMMARY_PATH]: `${JSON.stringify({
      metadata: { profile: PROFILE, environment: ENVIRONMENT, approval: APPROVAL, users: spec.users, baseUrlOrigin: new URL(BASE).origin, startedAt: INITIALIZED_AT },
      ...data,
    }, null, 2)}\n`,
  };
}
