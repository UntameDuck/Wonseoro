// 계약 파일 검사 — OpenAPI 구조·호환성, CloudEvents 스키마 (CI contracts 잡)
//
// 전에는 CI 에 "TODO(M1): OpenAPI lint + breaking-change 검사 · CloudEvents JSON Schema 검증" 만 있었다.
// 계약 적합성 시험(admission-api contract-conformance)은 "구현한 경로가 계약에 있는가" 를 보지만,
// 계약 파일 자체가 깨졌는지(없는 $ref, 겹친 operationId)와 이전 버전과 호환되는지는 보지 않는다.
//
//   node scripts/check-contracts.mjs                 구조 검사 + HEAD~1 대비 호환성
//   node scripts/check-contracts.mjs --base <ref>    비교 기준을 바꾼다 (예: origin/main)
//
// 호환 규칙 (§A16): optional 필드·경로 추가는 호환, 경로·응답·필드·enum 값 삭제와 새 필수 입력은
// 비호환 — info.version 의 major 를 올리지 않았으면 실패한다.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import YAML from 'yaml';

const ROOT = resolve(import.meta.dirname, '..');
const OPENAPI = 'packages/contracts/openapi/k-admission.v1.yaml';
const EVENTS = 'packages/contracts/events/k-admission-cloudevents.schema.json';
const REGISTER = 'docs/02-spec-discrepancy-register.md';
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

// ajv 는 admission-api 의 선언된 의존성이다(런타임과 같은 엔진). 루트 호이스팅에 기대지 않고 거기서 찾는다.
const requireFromApi = createRequire(resolve(ROOT, 'apps/admission-api/package.json'));
const Ajv2020 = requireFromApi('ajv/dist/2020').default;
const addFormats = requireFromApi('ajv-formats').default;

const errors = [];
const notes = [];
const fail = (msg) => errors.push(msg);

// ── 1. OpenAPI 구조 ─────────────────────────────────────────────────────
const current = YAML.parse(readFileSync(resolve(ROOT, OPENAPI), 'utf8'));

function* walk(node, path = []) {
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i += 1) yield* walk(node[i], [...path, i]);
  } else if (node && typeof node === 'object') {
    yield [node, path];
    for (const [k, v] of Object.entries(node)) yield* walk(v, [...path, k]);
  }
}

function resolvePointer(doc, ref) {
  if (!ref.startsWith('#/')) return undefined;
  return ref
    .slice(2)
    .split('/')
    .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'))
    .reduce((node, key) => (node == null ? undefined : node[key]), doc);
}

for (const [node, path] of walk(current)) {
  if (typeof node.$ref === 'string' && resolvePointer(current, node.$ref) === undefined) {
    fail(`OpenAPI: 풀리지 않는 $ref ${node.$ref} (${path.join('.')})`);
  }
}

const operationIds = new Map();
// 계약이 가리키는 근거 — 불일치 대장 번호(D-N) 또는 마일스톤 태스크 번호(T-Mx-yy)
const registerIds = new Set([
  ...[...readFileSync(resolve(ROOT, REGISTER), 'utf8').matchAll(/^## (D-\d+)\./gm)].map((m) => m[1]),
  ...['M0-foundation', 'M1-admission-core', 'M2-payment-finalize-mvp', 'M3-operational-safeguards', 'M4-federated-proof', 'M5-reliability-security', 'M6-pilot-readiness']
    .flatMap((f) => [...readFileSync(resolve(ROOT, `docs/milestones/${f}.md`), 'utf8').matchAll(/\b(T-M\d-\d+)\b/g)].map((m) => m[1])),
]);
for (const [p, item] of Object.entries(current.paths ?? {})) {
  for (const method of METHODS) {
    const op = item?.[method];
    if (!op) continue;
    const where = `${method.toUpperCase()} ${p}`;
    if (!op.operationId) fail(`OpenAPI: ${where} 에 operationId 가 없다`);
    else if (operationIds.has(op.operationId)) {
      fail(`OpenAPI: operationId ${op.operationId} 가 겹친다 (${operationIds.get(op.operationId)} · ${where})`);
    } else operationIds.set(op.operationId, where);
    const codes = Object.keys(op.responses ?? {});
    if (!codes.some((c) => /^2\d\d$/.test(c))) fail(`OpenAPI: ${where} 에 성공(2xx) 응답이 없다`);
    const reg = op['x-kadmission-register'];
    if (reg !== undefined && !registerIds.has(reg)) {
      fail(`OpenAPI: ${where} 의 x-kadmission-register ${reg} 가 불일치 대장·마일스톤에 없다`);
    }
  }
}

// ── 2. OpenAPI 호환성 (직전 버전 대비) ─────────────────────────────────
const baseArg = process.argv.indexOf('--base');
const baseRef = baseArg > 0 ? process.argv[baseArg + 1] : 'HEAD~1';
let previous = null;
try {
  previous = YAML.parse(
    execFileSync('git', ['show', `${baseRef}:${OPENAPI}`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }),
  );
} catch {
  notes.push(`호환성 검사 건너뜀 — ${baseRef} 의 계약 파일을 읽을 수 없다 (얕은 checkout 이거나 첫 커밋)`);
}

const breaking = [];
if (previous) {
  const deref = (doc, s) => (s && typeof s.$ref === 'string' ? resolvePointer(doc, s.$ref) : s);

  for (const [p, item] of Object.entries(previous.paths ?? {})) {
    for (const method of METHODS) {
      const before = item?.[method];
      if (!before) continue;
      const where = `${method.toUpperCase()} ${p}`;
      const after = current.paths?.[p]?.[method];
      if (!after) {
        breaking.push(`${where} 삭제`);
        continue;
      }
      if (before.operationId && after.operationId !== before.operationId) {
        breaking.push(`${where} operationId 변경 ${before.operationId} → ${after.operationId}`);
      }
      for (const code of Object.keys(before.responses ?? {})) {
        if (/^2\d\d$/.test(code) && !after.responses?.[code]) breaking.push(`${where} 응답 ${code} 삭제`);
      }
      const params = (doc, op) =>
        new Map(
          (op.parameters ?? [])
            .map((x) => deref(doc, x))
            .filter(Boolean)
            .map((x) => [`${x.in}:${x.name}`, x]),
        );
      const pb = params(previous, before);
      for (const [key, param] of params(current, after)) {
        if (param.required && !pb.get(key)?.required) breaking.push(`${where} 필수 파라미터 ${key} 추가`);
      }
      const bodyOf = (doc, op) => deref(doc, op.requestBody?.content?.['application/json']?.schema);
      const bb = bodyOf(previous, before);
      const ab = bodyOf(current, after);
      for (const r of ab?.required ?? []) {
        if (!(bb?.required ?? []).includes(r)) breaking.push(`${where} 요청 본문 필수 필드 ${r} 추가`);
      }
    }
  }

  for (const [name, before] of Object.entries(previous.components?.schemas ?? {})) {
    const after = current.components?.schemas?.[name];
    if (!after) {
      breaking.push(`스키마 ${name} 삭제`);
      continue;
    }
    for (const [prop, bp] of Object.entries(before.properties ?? {})) {
      const ap = after.properties?.[prop];
      if (!ap) {
        breaking.push(`스키마 ${name}.${prop} 삭제`);
        continue;
      }
      if (Array.isArray(bp.enum) && Array.isArray(ap.enum)) {
        const removed = bp.enum.filter((v) => !ap.enum.includes(v));
        if (removed.length) breaking.push(`스키마 ${name}.${prop} enum 값 삭제 ${removed.join(', ')}`);
      }
      const typeOf = (s) => JSON.stringify(s.type ?? null);
      if (bp.type && ap.type && typeOf(bp) !== typeOf(ap)) {
        const widened = Array.isArray(ap.type) && [bp.type].flat().every((t) => ap.type.includes(t));
        if (!widened) breaking.push(`스키마 ${name}.${prop} 타입 변경 ${typeOf(bp)} → ${typeOf(ap)}`);
      }
    }
  }

  const major = (v) => Number(String(v ?? '0').split('.')[0]);
  if (breaking.length > 0) {
    if (major(current.info?.version) > major(previous.info?.version)) {
      notes.push(`비호환 변경 ${breaking.length}건 — major 버전을 올렸다 (${previous.info.version} → ${current.info.version})`);
    } else {
      for (const b of breaking) fail(`OpenAPI 비호환 변경(${baseRef} 대비): ${b} — major 를 올리거나 되돌린다 (§A16)`);
    }
  }
  if (previous.info?.version !== current.info?.version) {
    notes.push(`OpenAPI ${previous.info?.version} → ${current.info?.version} — 노션 §03 첨부 교체 대상 (R5, 06-notion-changeset)`);
  }
}

// ── 3. CloudEvents 스키마 ───────────────────────────────────────────────
const events = JSON.parse(readFileSync(resolve(ROOT, EVENTS), 'utf8'));
try {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  ajv.compile(events);
} catch (err) {
  fail(`CloudEvents: 스키마를 컴파일할 수 없다 — ${err.message}`);
}
const schemaTypes = new Set(
  [...JSON.stringify(events).matchAll(/"const":"(kr\.kadmission\.[a-z.]+\.v\d+)"/g)].map((m) => m[1]),
);
const codeTypes = [
  ...readFileSync(resolve(ROOT, 'packages/contracts/src/events.ts'), 'utf8').matchAll(/'(kr\.kadmission\.[a-z.]+\.v\d+)'/g),
].map((m) => m[1]);
for (const t of new Set(codeTypes)) {
  if (!schemaTypes.has(t)) fail(`CloudEvents: 코드의 이벤트 타입 ${t} 가 스키마에 없다`);
}

// ── 결과 ────────────────────────────────────────────────────────────────
for (const n of notes) console.log(`ℹ ${n}`);
if (errors.length) {
  for (const e of errors) console.log(`✖ ${e}`);
  process.exit(1);
}
console.log(
  `✔ OpenAPI ${current.info?.version} — 오퍼레이션 ${operationIds.size}개, $ref·operationId·대장 번호 이상 없음` +
    (previous ? `, ${baseRef} 대비 호환` : ''),
);
console.log(`✔ CloudEvents — 스키마 컴파일, 이벤트 타입 ${new Set(codeTypes).size}종 대조`);
