import http from 'k6/http';
import { check, sleep, fail } from 'k6';
import { SharedArray } from 'k6/data';
import exec from 'k6/execution';

const BASE = __ENV.BASE_URL;
const TOKEN = __ENV.ACCESS_TOKEN || '';
const ALLOW = __ENV.ALLOW_LOAD_TEST === 'true';

if (!ALLOW) {
  fail('Refusing to run. Set ALLOW_LOAD_TEST=true only for an authorized load-test environment.');
}
if (!BASE || !/^https:\/\//.test(BASE)) {
  fail('BASE_URL must be an explicit HTTPS load-test target.');
}

export const options = {
  thresholds: {
    http_req_failed: ['rate<0.001'],
    'http_req_duration{kind:read}': ['p(95)<300'],
    'http_req_duration{kind:save}': ['p(95)<500'],
    'http_req_duration{kind:finalize}': ['p(95)<1500'],
    checks: ['rate>0.999'],
  },
  scenarios: {
    baseline_read_save: {
      executor: 'ramping-vus',
      exec: 'browseAndSave',
      startVUs: 0,
      stages: [
        { duration: '5m', target: 500 },
        { duration: '20m', target: 500 },
        { duration: '5m', target: 0 },
      ],
    },
    deadline_flash: {
      executor: 'ramping-arrival-rate',
      exec: 'deadlineFlow',
      startRate: 100,
      timeUnit: '1s',
      preAllocatedVUs: 1500,
      maxVUs: 3000,
      stages: [
        { duration: '3m', target: 500 },
        { duration: '2m', target: 1000 },
        { duration: '5m', target: 1000 },
        { duration: '2m', target: 100 },
      ],
      startTime: '31m',
    },
    finalize_burst: {
      executor: 'constant-arrival-rate',
      exec: 'finalizeOnly',
      rate: Number(__ENV.FINALIZE_TPS || 150),
      timeUnit: '1s',
      duration: '5m',
      preAllocatedVUs: 500,
      maxVUs: 1500,
      startTime: '38m',
    },
  },
};

function headers(extra = {}) {
  return {
    Authorization: TOKEN ? `Bearer ${TOKEN}` : undefined,
    'Content-Type': 'application/json',
    ...extra,
  };
}

function idem(prefix) {
  return `${prefix}-${exec.vu.idInTest}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createApplication() {
  const cycleId = __ENV.CYCLE_ID;
  const admissionTypeId = __ENV.ADMISSION_TYPE_ID;
  const departmentId = __ENV.DEPARTMENT_ID;
  const res = http.post(
    `${BASE}/api/v1/applications`,
    JSON.stringify({ cycleId, admissionTypeId, departmentId }),
    { headers: headers({ 'Idempotency-Key': idem('create') }), tags: { kind: 'save' } }
  );
  check(res, { 'create application 201/409': r => r.status === 201 || r.status === 409 });
  if (res.status !== 201) return null;
  return { body: res.json(), etag: res.headers.ETag || res.headers.Etag };
}

export function browseAndSave() {
  http.get(`${BASE}/api/v1/meta/time`, { tags: { kind: 'read' } });
  http.get(`${BASE}/api/v1/admission-cycles/current`, { headers: headers(), tags: { kind: 'read' } });

  const app = createApplication();
  if (app) {
    const payload = { fields: { syntheticAnswer: 'load-test' } };
    const res = http.patch(
      `${BASE}/api/v1/applications/${app.body.id}`,
      JSON.stringify(payload),
      {
        headers: headers({
          'Idempotency-Key': idem('save'),
          'If-Match': app.etag || `"v${app.body.version}"`,
          'Content-Type': 'application/merge-patch+json',
        }),
        tags: { kind: 'save' },
      }
    );
    check(res, { 'draft save 200': r => r.status === 200 });
  }
  sleep(Math.random() * 2);
}

export function deadlineFlow() {
  const choice = Math.random();
  if (choice < 0.25) {
    http.get(`${BASE}/api/v1/meta/time`, { tags: { kind: 'read' } });
  } else if (choice < 0.65) {
    browseAndSave();
  } else {
    http.get(`${BASE}/api/v1/admission-types?cycleId=${__ENV.CYCLE_ID}`, { headers: headers(), tags: { kind: 'read' } });
  }
}

export function finalizeOnly() {
  // This scenario expects TEST_PREPARED_APPLICATION_ID to refer to a synthetic,
  // paid, finalizable application in an isolated test environment.
  const appId = __ENV.TEST_PREPARED_APPLICATION_ID;
  if (!appId) {
    fail('Set TEST_PREPARED_APPLICATION_ID for finalize burst testing.');
  }
  const key = idem('finalize');
  const res = http.post(
    `${BASE}/api/v1/applications/${appId}/finalize`,
    null,
    { headers: headers({ 'Idempotency-Key': key }), tags: { kind: 'finalize' } }
  );
  check(res, {
    'finalize accepted/idempotent': r => r.status === 201 || r.status === 200 || r.status === 409,
  });
}
