import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import {
  APPLICATION_STATUS,
  DEADLINE_MODE,
  DOCUMENT_STATUS,
  IDEMPOTENCY_KEY_MAX_LENGTH,
  IDEMPOTENCY_KEY_MIN_LENGTH,
  PAYMENT_STATUS,
} from '@wonseoro/contracts';
import { IDEMPOTENCY_STATE } from './common/idempotency/idempotency.store';

/**
 * 계약 적합성 테스트 — T-M1-14
 *
 * 노션 설계서의 canonical 첨부(DDL · OpenAPI)와 TypeScript 상수가
 * 어긋나면 여기서 깨진다. 사람이 대조하지 않아도 드리프트가 잡힌다.
 * (docs/01-notion-sync-protocol.md §2 — 태스크 완료 시 동기화의 자동화판)
 *
 * 첨부를 새 버전으로 교체했는데 이 테스트가 깨지면,
 * 코드를 고치기 전에 먼저 불일치 대장에 등록한다.
 */
const ROOT = resolve(__dirname, '../../..');
const DDL = readFileSync(resolve(ROOT, 'infra/db/migrations/0001_init.sql'), 'utf8');
const OPENAPI = readFileSync(
  resolve(ROOT, 'packages/contracts/openapi/k-admission.v1.yaml'),
  'utf8',
);
const EVENTS = readFileSync(
  resolve(ROOT, 'packages/contracts/events/k-admission-cloudevents.schema.json'),
  'utf8',
);

/** DDL 의 CHECK (col IN ('A','B')) 에서 값 목록을 뽑는다. 여러 줄에 걸쳐 있을 수 있다. */
function ddlCheckValues(table: string, column: string): string[] {
  const tableBody = DDL.split(`CREATE TABLE ${table} (`)[1];
  assert.ok(tableBody, `DDL 에 ${table} 테이블이 없습니다`);
  const idx = tableBody.indexOf(`${column} `);
  assert.ok(idx >= 0, `${table}.${column} 컬럼이 없습니다`);
  const after = tableBody.slice(idx);
  const check = after.match(/CHECK \([^)]*IN \(([\s\S]*?)\)\)/);
  assert.ok(check?.[1], `${table}.${column} 에 CHECK IN 제약이 없습니다`);
  return [...check[1].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1] as string);
}

/** OpenAPI 의 enum: [A, B, C] 에서 값 목록을 뽑는다. */
function openApiEnum(anchor: string): string[] {
  const idx = OPENAPI.indexOf(anchor);
  assert.ok(idx >= 0, `OpenAPI 에 ${anchor} 가 없습니다`);
  const after = OPENAPI.slice(idx);
  const m = after.match(/enum: \[([^\]]+)\]/);
  assert.ok(m?.[1], `${anchor} 뒤에 enum 이 없습니다`);
  return m[1].split(',').map((v) => v.trim());
}

describe('계약 적합성 — DDL (k-admission-postgresql-ddl.txt)', () => {
  it('application.status 가 contracts 와 일치한다', () => {
    assert.deepEqual(
      [...ddlCheckValues('application', 'status')].sort(),
      [...APPLICATION_STATUS].sort(),
    );
  });

  it('payment.status 가 contracts 와 일치한다', () => {
    assert.deepEqual(
      [...ddlCheckValues('payment', 'status')].sort(),
      [...PAYMENT_STATUS].sort(),
    );
  });

  it('document.status 가 contracts 와 일치한다', () => {
    assert.deepEqual(
      [...ddlCheckValues('document', 'status')].sort(),
      [...DOCUMENT_STATUS].sort(),
    );
  });

  it('deadline_policy.mode 가 contracts 와 일치한다', () => {
    assert.deepEqual(
      [...ddlCheckValues('deadline_policy', 'mode')].sort(),
      [...DEADLINE_MODE].sort(),
    );
  });

  it('idempotency_record.state 가 저장소 구현과 일치한다', () => {
    assert.deepEqual(
      [...ddlCheckValues('idempotency_record', 'state')].sort(),
      [...IDEMPOTENCY_STATE].sort(),
    );
  });

  it('정합성 제약 5종이 DDL 에 실제로 존재한다 (infra/db/README.md)', () => {
    assert.match(DDL, /application_id uuid NOT NULL UNIQUE REFERENCES application\(id\)/);
    assert.match(DDL, /UNIQUE \(aggregate_id, aggregate_sequence\)/);
    assert.match(DDL, /uq_payment_provider_tx ON payment\(provider, provider_tx_id\)/);
    assert.match(DDL, /version bigint NOT NULL DEFAULT 1 CHECK \(version > 0\)/);
    assert.match(DDL, /idx_outbox_pending .* WHERE status IN \('PENDING','SENDING'\)/);
  });

  it('마감 정책은 2인 승인을 DB 제약으로 강제한다 (v1.1 §A14)', () => {
    assert.match(DDL, /CHECK \(approved_by_1 <> approved_by_2\)/);
  });
});

describe('계약 적합성 — OpenAPI (k-admission-openapi.yaml)', () => {
  it('Application.status enum 이 contracts 와 일치한다', () => {
    assert.deepEqual(
      openApiEnum('    Application:').sort(),
      [...APPLICATION_STATUS].sort(),
    );
  });

  it('Payment.status enum 이 contracts 와 일치한다', () => {
    assert.deepEqual(openApiEnum('    Payment:').sort(), [...PAYMENT_STATUS].sort());
  });

  it('Document.status enum 이 contracts 와 일치한다', () => {
    assert.deepEqual(openApiEnum('    Document:').sort(), [...DOCUMENT_STATUS].sort());
  });

  it('Idempotency-Key 길이 제약이 contracts 상수와 일치한다', () => {
    const m = OPENAPI.match(
      /IdempotencyKey:[\s\S]*?minLength: (\d+), maxLength: (\d+)/,
    );
    assert.ok(m);
    assert.equal(Number(m[1]), IDEMPOTENCY_KEY_MIN_LENGTH);
    assert.equal(Number(m[2]), IDEMPOTENCY_KEY_MAX_LENGTH);
  });

  it('Problem 은 code 와 traceId 를 필수로 요구한다', () => {
    assert.match(OPENAPI, /Problem:\s*\n\s*type: object\s*\n\s*required: \[type, title, status, code, traceId\]/);
  });

  it('Draft 수정은 merge-patch 이고 If-Match 를 요구한다', () => {
    assert.match(OPENAPI, /application\/merge-patch\+json/);
    assert.match(OPENAPI, /name: If-Match\s*\n\s*required: true/);
  });

  it('Finalize 는 재시도 시 200, 신규 시 201 을 반환한다', () => {
    const idx = OPENAPI.indexOf('operationId: finalizeApplication');
    const section = OPENAPI.slice(idx, idx + 800);
    assert.match(section, /'200':\s*\n\s*description: Existing finalized result for idempotent retry/);
    assert.match(section, /'201':\s*\n\s*description: Application finalized/);
  });
});

describe('계약 적합성 — CloudEvents (k-admission-cloudevents.schema.json)', () => {
  it('이벤트 네임스페이스는 kr.kadmission.* 다 (불일치 대장 D-1)', () => {
    assert.match(EVENTS, /kr\.kadmission\.application\.finalized\.v1/);
    assert.equal(EVENTS.includes('"kr.admission.'), false, 'v1.0 구 네임스페이스가 남아 있습니다');
  });

  it('sequence 는 data 가 아니라 확장 속성이다 (불일치 대장 D-4)', () => {
    assert.match(EVENTS, /"kadmissionsequence": \{ "type": "integer", "minimum": 1 \}/);
  });

  it('중앙 전송 payload 에 개인정보 필드가 없다 (v1.0 §17.1)', () => {
    const finalized = EVENTS.split('"ApplicationFinalizedData"')[1]?.split('"ApplicationFinalizedEvent"')[0] ?? '';
    for (const banned of ['name', 'phone', 'email', 'address', 'residentRegistration']) {
      assert.equal(
        new RegExp(`"${banned}"\\s*:`).test(finalized),
        false,
        `중앙 이벤트에 ${banned} 가 포함되어 있습니다`,
      );
    }
  });
});
