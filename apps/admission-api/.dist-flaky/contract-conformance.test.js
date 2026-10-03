"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_test_1 = require("node:test");
const contracts_1 = require("@wonseoro/contracts");
const server_kit_1 = require("@wonseoro/server-kit");
const idempotency_store_1 = require("./common/idempotency/idempotency.store");
const adaptive_throttle_1 = require("./common/throttle/adaptive-throttle");
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
const ROOT = (0, node_path_1.resolve)(__dirname, '../../..');
const DDL = (0, node_fs_1.readFileSync)((0, node_path_1.resolve)(ROOT, 'infra/db/migrations/0001_init.sql'), 'utf8');
const OPENAPI = (0, node_fs_1.readFileSync)((0, node_path_1.resolve)(ROOT, 'packages/contracts/openapi/k-admission.v1.yaml'), 'utf8');
const EVENTS = (0, node_fs_1.readFileSync)((0, node_path_1.resolve)(ROOT, 'packages/contracts/events/k-admission-cloudevents.schema.json'), 'utf8');
/** DDL 의 CHECK (col IN ('A','B')) 에서 값 목록을 뽑는다. 여러 줄에 걸쳐 있을 수 있다. */
function ddlCheckValues(table, column) {
    const tableBody = DDL.split(`CREATE TABLE ${table} (`)[1];
    strict_1.default.ok(tableBody, `DDL 에 ${table} 테이블이 없습니다`);
    const idx = tableBody.indexOf(`${column} `);
    strict_1.default.ok(idx >= 0, `${table}.${column} 컬럼이 없습니다`);
    const after = tableBody.slice(idx);
    const check = after.match(/CHECK \([^)]*IN \(([\s\S]*?)\)\)/);
    strict_1.default.ok(check?.[1], `${table}.${column} 에 CHECK IN 제약이 없습니다`);
    return [...check[1].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
}
/** OpenAPI 의 enum: [A, B, C] 에서 값 목록을 뽑는다. */
function openApiEnum(anchor) {
    const idx = OPENAPI.indexOf(anchor);
    strict_1.default.ok(idx >= 0, `OpenAPI 에 ${anchor} 가 없습니다`);
    const after = OPENAPI.slice(idx);
    const m = after.match(/enum: \[([^\]]+)\]/);
    strict_1.default.ok(m?.[1], `${anchor} 뒤에 enum 이 없습니다`);
    return m[1].split(',').map((v) => v.trim());
}
/**
 * 계약에 두지 않기로 한 경로. 이유 없이 늘리지 않는다.
 */
const CONTRACT_EXEMPT = new Map([
    // relay 시험·운영 수동 트리거. 외부 계약이 아니다
    ['POST /internal/v1/sync/drain', 'ops trigger'],
]);
/** 컨트롤러 소스를 훑어 구현된 경로를 모은다. 데코레이터 순서 그대로 읽는다. */
function implementedRoutes() {
    const roots = ['apps/admission-api/src', 'apps/central-api/src', 'apps/event-relay/src'];
    const routes = [];
    for (const root of roots) {
        for (const file of tsFiles((0, node_path_1.resolve)(ROOT, root))) {
            const src = (0, node_fs_1.readFileSync)(file, 'utf8');
            if (!src.includes('@Controller('))
                continue;
            let prefix = '';
            const re = /@Controller\(\s*(?:'([^']*)')?\s*\)|@(Get|Post|Patch|Put|Delete)\(\s*(?:'([^']*)')?\s*\)/g;
            for (const m of src.matchAll(re)) {
                if (m[0].startsWith('@Controller')) {
                    prefix = m[1] ?? '';
                    continue;
                }
                const path = '/' + [prefix, m[3] ?? ''].filter(Boolean).join('/').replace(/:(\w+)/g, '{$1}');
                routes.push({ method: m[2].toUpperCase(), path, file: file.slice(ROOT.length + 1) });
            }
        }
    }
    return routes;
}
function tsFiles(dir) {
    const out = [];
    for (const entry of (0, node_fs_1.readdirSync)(dir, { withFileTypes: true })) {
        const full = (0, node_path_1.resolve)(dir, entry.name);
        if (entry.isDirectory())
            out.push(...tsFiles(full));
        else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts'))
            out.push(full);
    }
    return out;
}
/** paths 아래 `  /경로:` 블록들을 [경로, 메서드, 오퍼레이션 본문] 으로 쪼갠다. */
function openApiOperations() {
    const paths = OPENAPI.slice(OPENAPI.indexOf('\npaths:\n'), OPENAPI.indexOf('\ncomponents:\n'));
    const ops = [];
    for (const block of paths.split(/\n(?=  \/)/).slice(1)) {
        const path = block.slice(2, block.indexOf(':\n'));
        for (const op of block.split(/\n(?=    (?:get|post|patch|put|delete):\n)/).slice(1)) {
            ops.push([path, op.slice(4, op.indexOf(':')), op]);
        }
    }
    return ops;
}
function openApiHas(method, path) {
    return openApiOperations().some(([p, m]) => p === path && m === method.toLowerCase());
}
(0, node_test_1.describe)('계약 적합성 — DDL (k-admission-postgresql-ddl.txt)', () => {
    (0, node_test_1.it)('application.status 가 contracts 와 일치한다', () => {
        strict_1.default.deepEqual([...ddlCheckValues('application', 'status')].sort(), [...contracts_1.APPLICATION_STATUS].sort());
    });
    (0, node_test_1.it)('payment.status 가 contracts 와 일치한다', () => {
        strict_1.default.deepEqual([...ddlCheckValues('payment', 'status')].sort(), [...contracts_1.PAYMENT_STATUS].sort());
    });
    (0, node_test_1.it)('document.status 가 contracts 와 일치한다', () => {
        strict_1.default.deepEqual([...ddlCheckValues('document', 'status')].sort(), [...contracts_1.DOCUMENT_STATUS].sort());
    });
    (0, node_test_1.it)('deadline_policy.mode 가 contracts 와 일치한다', () => {
        strict_1.default.deepEqual([...ddlCheckValues('deadline_policy', 'mode')].sort(), [...contracts_1.DEADLINE_MODE].sort());
    });
    (0, node_test_1.it)('idempotency_record.state 가 저장소 구현과 일치한다', () => {
        strict_1.default.deepEqual([...ddlCheckValues('idempotency_record', 'state')].sort(), [...idempotency_store_1.IDEMPOTENCY_STATE].sort());
    });
    (0, node_test_1.it)('정합성 제약 5종이 DDL 에 실제로 존재한다 (infra/db/README.md)', () => {
        strict_1.default.match(DDL, /application_id uuid NOT NULL UNIQUE REFERENCES application\(id\)/);
        strict_1.default.match(DDL, /UNIQUE \(aggregate_id, aggregate_sequence\)/);
        strict_1.default.match(DDL, /uq_payment_provider_tx ON payment\(provider, provider_tx_id\)/);
        strict_1.default.match(DDL, /version bigint NOT NULL DEFAULT 1 CHECK \(version > 0\)/);
        strict_1.default.match(DDL, /idx_outbox_pending .* WHERE status IN \('PENDING','SENDING'\)/);
    });
    (0, node_test_1.it)('버전 문자열 길이 제약을 명시한다 — 길면 접수 시점에 INSERT 가 깨진다', () => {
        // 실제로 여기에 걸려 Finalize 가 500 난 적이 있다. 회귀 방지용.
        strict_1.default.match(DDL, /deadline_policy_version varchar\(64\) NOT NULL/);
        strict_1.default.match(DDL, /config_version varchar\(64\) NOT NULL/);
        strict_1.default.match(DDL, /version varchar\(64\) NOT NULL/);
    });
    (0, node_test_1.it)('마감 정책은 2인 승인을 DB 제약으로 강제한다 (v1.1 §A14)', () => {
        strict_1.default.match(DDL, /CHECK \(approved_by_1 <> approved_by_2\)/);
    });
});
(0, node_test_1.describe)('계약 적합성 — OpenAPI (k-admission-openapi.yaml)', () => {
    (0, node_test_1.it)('Application.status enum 이 contracts 와 일치한다', () => {
        strict_1.default.deepEqual(openApiEnum('    Application:').sort(), [...contracts_1.APPLICATION_STATUS].sort());
    });
    (0, node_test_1.it)('Payment.status enum 이 contracts 와 일치한다', () => {
        strict_1.default.deepEqual(openApiEnum('    Payment:').sort(), [...contracts_1.PAYMENT_STATUS].sort());
    });
    (0, node_test_1.it)('Document.status enum 이 contracts 와 일치한다', () => {
        strict_1.default.deepEqual(openApiEnum('    Document:').sort(), [...contracts_1.DOCUMENT_STATUS].sort());
    });
    (0, node_test_1.it)('Idempotency-Key 길이 제약이 contracts 상수와 일치한다', () => {
        const m = OPENAPI.match(/IdempotencyKey:[\s\S]*?minLength: (\d+), maxLength: (\d+)/);
        strict_1.default.ok(m);
        strict_1.default.equal(Number(m[1]), contracts_1.IDEMPOTENCY_KEY_MIN_LENGTH);
        strict_1.default.equal(Number(m[2]), contracts_1.IDEMPOTENCY_KEY_MAX_LENGTH);
    });
    (0, node_test_1.it)('Problem 은 code 와 traceId 를 필수로 요구한다', () => {
        strict_1.default.match(OPENAPI, /Problem:\s*\n\s*type: object\s*\n\s*required: \[type, title, status, code, traceId\]/);
    });
    (0, node_test_1.it)('Draft 수정은 merge-patch 이고 If-Match 를 요구한다', () => {
        strict_1.default.match(OPENAPI, /application\/merge-patch\+json/);
        strict_1.default.match(OPENAPI, /name: If-Match\s*\n\s*required: true/);
    });
    (0, node_test_1.it)('구현된 모든 경로가 계약에 있다 — 코드가 먼저 앞서가면 여기서 깨진다', () => {
        const missing = implementedRoutes()
            .filter((r) => !CONTRACT_EXEMPT.has(`${r.method} ${r.path}`))
            .filter((r) => !openApiHas(r.method, r.path))
            .map((r) => `${r.method} ${r.path}  (${r.file})`);
        strict_1.default.deepEqual(missing, [], `계약(OpenAPI)에 없는 경로:\n${missing.join('\n')}`);
    });
    (0, node_test_1.it)('외부 콜백 말고는 모든 mutation 이 Idempotency-Key 를 요구한다 (전역 인터셉터와 같은 규칙)', () => {
        const lacking = [];
        for (const [path, method, op] of openApiOperations()) {
            if (!['post', 'patch', 'put', 'delete'].includes(method))
                continue;
            if (op.includes('x-kadmission-external-callback: true'))
                continue;
            // 중앙 호스트 경로는 admission-api 인터셉터 밖이다.
            if (op.includes('tags: [Central]'))
                continue;
            if (!op.includes("$ref: '#/components/parameters/IdempotencyKey'")) {
                lacking.push(`${method.toUpperCase()} ${path}`);
            }
        }
        strict_1.default.deepEqual(lacking, []);
    });
    (0, node_test_1.it)('요청 한도가 걸리는 지원자 경로는 모두 429 + Retry-After 를 계약에 둔다 (D-51, ADR-0007)', () => {
        const lacking = [];
        const extra = [];
        for (const [path, method, op] of openApiOperations()) {
            if (op.includes('tags: [Central]'))
                continue; // 중앙 호스트 — admission-api 한도 밖
            const limited = (0, adaptive_throttle_1.classifyRoute)(method, path) !== null;
            const has429 = op.includes("'429':\n          $ref: '#/components/responses/RateLimited'");
            if (limited && !has429)
                lacking.push(`${method.toUpperCase()} ${path}`);
            if (!limited && has429)
                extra.push(`${method.toUpperCase()} ${path}`);
        }
        strict_1.default.deepEqual(lacking, [], '한도가 걸리는데 계약에 429 가 없다');
        strict_1.default.deepEqual(extra, [], '한도가 걸리지 않는데 계약에 429 가 있다');
        strict_1.default.match(OPENAPI, /RateLimited:[\s\S]*?headers:\s*\n\s*Retry-After:/);
        strict_1.default.ok(Object.values(contracts_1.ProblemCode).includes('RATE_LIMITED'));
    });
    (0, node_test_1.it)('Finalize 는 재시도 시 200, 신규 시 201 을 반환한다', () => {
        const op = openApiOperations().find(([, , body]) => body.includes('operationId: finalizeApplication'));
        strict_1.default.ok(op, 'finalizeApplication 이 없습니다');
        const section = op[2];
        strict_1.default.match(section, /'200':\s*\n\s*description: Existing finalized result for idempotent retry/);
        strict_1.default.match(section, /'201':\s*\n\s*description: Application finalized/);
    });
});
(0, node_test_1.describe)('계약 적합성 — CloudEvents (k-admission-cloudevents.schema.json)', () => {
    (0, node_test_1.it)('이벤트 네임스페이스는 kr.kadmission.* 다 (불일치 대장 D-1)', () => {
        strict_1.default.match(EVENTS, /kr\.kadmission\.application\.finalized\.v1/);
        strict_1.default.equal(EVENTS.includes('"kr.admission.'), false, 'v1.0 구 네임스페이스가 남아 있습니다');
    });
    (0, node_test_1.it)('sequence 는 data 가 아니라 확장 속성이다 (불일치 대장 D-4)', () => {
        strict_1.default.match(EVENTS, /"kadmissionsequence": \{ "type": "integer", "minimum": 1 \}/);
    });
    (0, node_test_1.it)('subjectRef 는 optional 이고 목적 키 HMAC 형식이다 (D-27 · D-39, §04 Schema Evolution)', () => {
        const data = JSON.parse(EVENTS).$defs.ApplicationFinalizedData;
        strict_1.default.equal(data.required.includes('subjectRef'), false, 'required 추가는 호환 변경이 아니다');
        const pattern = new RegExp(data.properties.subjectRef.pattern);
        strict_1.default.ok(pattern.test(`k1.${'A'.repeat(43)}`));
        strict_1.default.equal(pattern.test('sha256-of-token-without-key'), false);
    });
    (0, node_test_1.it)('subjectRef 키 ID 상한이 생성기와 같고 전체가 중앙 varchar(64) 에 들어간다 (D-47)', () => {
        const pattern = new RegExp(JSON.parse(EVENTS).$defs.ApplicationFinalizedData.properties.subjectRef.pattern);
        const longest = `${'k'.repeat(16)}.${'A'.repeat(43)}`;
        strict_1.default.ok(pattern.test(longest) && (0, server_kit_1.isPurposeRef)(longest));
        strict_1.default.ok(longest.length <= 64);
        const tooLong = `${'k'.repeat(17)}.${'A'.repeat(43)}`;
        strict_1.default.equal(pattern.test(tooLong), false, '계약이 생성기보다 긴 키 ID 를 허용한다');
        strict_1.default.equal((0, server_kit_1.isPurposeRef)(tooLong), false);
    });
    (0, node_test_1.it)('중앙 전송 payload 에 개인정보 필드가 없다 (v1.0 §17.1)', () => {
        const finalized = EVENTS.split('"ApplicationFinalizedData"')[1]?.split('"ApplicationFinalizedEvent"')[0] ?? '';
        for (const banned of ['name', 'phone', 'email', 'address', 'residentRegistration']) {
            strict_1.default.equal(new RegExp(`"${banned}"\\s*:`).test(finalized), false, `중앙 이벤트에 ${banned} 가 포함되어 있습니다`);
        }
    });
});
//# sourceMappingURL=contract-conformance.test.js.map