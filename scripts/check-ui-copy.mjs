#!/usr/bin/env node
/**
 * 화면 문구 검사 (T-M5-50, docs/08-ui-production-readiness.md 「회귀 방지」)
 *
 * 화면에 나갈 수 있는 글 — JSX 텍스트와 문자열·템플릿 리터럴 — 에 개발자가 개발자에게 하는 말이 들어가지 않게 한다.
 * 설계 문서 번호(§·D-N·T-Mx·v1.x), "기술설계서", 개발 단계 안내, 시드 값 안내 같은 것이다.
 * **주석은 보지 않는다** — 설계 근거는 주석에 두는 것이 맞다. TypeScript 파서로 리터럴만 꺼낸다.
 *
 * 개발 서버에서만 그려지는 파일(T-M5-53)은 개발용이라는 표시가 정직한 문구라 허용 목록에 둔다.
 *
 *   node scripts/check-ui-copy.mjs        위반이 있으면 목록을 보이고 1 로 끝난다
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

/** 화면에 글을 내보내는 코드. 사람 말 사전·보존 근거처럼 화면에 그대로 뜨는 계약 값도 넣는다. */
const TARGETS = [
  'apps/frontend/src',
  'apps/admin-web/src',
  'packages/krds/src',
  'packages/contracts/src/retention.ts',
  'packages/contracts/src/labels.ts',
];

const RULES = [
  { id: 'spec-section', re: /§/, why: '설계 문서 절 번호' },
  { id: 'register', re: /\bD-\d+\b/, why: '불일치 대장 번호' },
  { id: 'task', re: /\bT-M\d/, why: '태스크 번호' },
  { id: 'spec-version', re: /\bv1\.[01]\b/, why: '설계 문서 판 번호' },
  { id: 'spec-doc', re: /기술설계서/, why: '설계 문서 이름' },
  { id: 'dev-stage', re: /개발 단계|개발 시드|시드 지원자/, why: '개발 단계 안내' },
  { id: 'dev-only', re: /개발용/, why: '개발용 안내 — 개발 서버 전용 파일에서만' },
  { id: 'pseudonym', re: /가명 토큰/, why: '내부 식별 방식 — 개발 서버 전용 파일에서만' },
  { id: 'architecture', re: /원본으로 관리|원본은 대학|서비스의 구조|중앙 조회/, why: '시스템 구조 설명' },
];

/** 파일별로 허용하는 규칙 — 개발 서버에서만 그려지는 화면이다 (T-M5-53). */
const ALLOW = {
  'apps/frontend/src/krds/identity.tsx': ['dev-only', 'pseudonym'],
  // 담당자 입력칸 옆 "(개발용 — 신원 증명 아님)" — devOperator 일 때만 그린다
  'apps/admin-web/src/components/console.tsx': ['dev-only'],
};

function files(target) {
  const abs = join(ROOT, target);
  if (statSync(abs).isFile()) return [abs];
  return readdirSync(abs, { recursive: true })
    .map((f) => join(abs, f))
    .filter((f) => /\.(tsx?|mts)$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.endsWith('.d.ts'));
}

/** 화면에 나갈 수 있는 글. import 경로·타입 위치 문자열은 뺀다. */
function literals(source) {
  const out = [];
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isLiteralTypeNode(node)) return;
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    ) {
      const text = node.text.trim();
      if (text) out.push({ text, pos: node.getStart(source) });
    }
    node.forEachChild(visit);
  };
  visit(source);
  return out;
}

const problems = [];
let scanned = 0;
for (const target of TARGETS) {
  for (const file of files(target)) {
    const rel = relative(ROOT, file).split(sep).join('/');
    const allowed = ALLOW[rel] ?? [];
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    scanned++;
    for (const { text, pos } of literals(source)) {
      for (const rule of RULES) {
        if (allowed.includes(rule.id) || !rule.re.test(text)) continue;
        const { line } = source.getLineAndCharacterOfPosition(pos);
        problems.push(`${rel}:${line + 1}  [${rule.why}]  ${text.replace(/\s+/g, ' ').slice(0, 100)}`);
      }
    }
  }
}

/* ── 서버 오류 문구 (T-M5-52) ──────────────────────────────────────────────
 * 업무 오류의 설명(detail)은 화면에 그대로 덧붙는다(packages/contracts/src/problem-text.ts PROBLEM_DETAIL_SHOWN).
 * 그래서 서버가 오류 문구에 필드 이름·헤더 이름·상태 코드를 쓰지 않게 한다. 화면이 code 로 바꿔 보이는
 * 프로토콜 오류(멱등 키 등)는 이 검사의 대상이 아니다 — 해당 팩토리 정의 파일만 허용한다.
 */
const SERVER_TARGETS = ['apps/admission-api/src', 'apps/central-api/src'];
const SERVER_RULES = [
  { id: 'identifier', re: /\b[a-z]+[A-Z][A-Za-z]*\b/, why: '코드 식별자(camelCase)' },
  { id: 'header', re: /If-Match|Idempotency-Key|\bx-[a-z]+(-[a-z]+)+/i, why: '헤더 이름' },
  { id: 'enum', re: /\b[A-Z]{3,}(_[A-Z]+)+\b/, why: '내부 상태 코드' },
  { id: 'format', re: /\bJSON\b|sha256|UUID/, why: '기술 형식 이름' },
  ...RULES.filter((r) => ['spec-section', 'register', 'task', 'spec-version', 'spec-doc'].includes(r.id)),
];
const SERVER_ALLOW = {
  // 프로토콜 오류 팩토리 — 화면은 code 로 PROBLEM_TEXT 를 보인다
  'apps/admission-api/src/common/problem/problem.exception.ts': ['header'],
  'apps/admission-api/src/common/idempotency/idempotency.interceptor.ts': ['header'],
};

/** 오류 문구 자리: ProblemException.xxx(...) 의 인자, 그리고 { title|detail: ... } 의 값. */
function problemLiterals(source) {
  const out = [];
  const collect = (node) => {
    // 비교 대상(status === 'PAYMENT_PENDING')은 문구가 아니다
    const compared =
      node.parent && ts.isBinaryExpression(node.parent) &&
      [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(node.parent.operatorToken.kind);
    if (!compared && ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      const text = node.text.trim();
      if (text) out.push({ text, pos: node.getStart(source) });
    }
    node.forEachChild(collect);
  };
  const visit = (node) => {
    const callee = ts.isCallExpression(node) ? node.expression.getText(source) : '';
    // illegalTransition(from, to) 의 인자는 상태 코드다 — 문장은 팩토리가 사람 말로 만든다
    if (callee.startsWith('ProblemException.') && callee !== 'ProblemException.illegalTransition') {
      node.arguments.forEach(collect);
    } else if (
      ts.isPropertyAssignment(node) &&
      ['title', 'detail'].includes(node.name.getText(source)) &&
      !ts.isObjectLiteralExpression(node.initializer)
    ) {
      collect(node.initializer);
    }
    node.forEachChild(visit);
  };
  visit(source);
  return out;
}

for (const target of SERVER_TARGETS) {
  for (const file of files(target)) {
    const rel = relative(ROOT, file).split(sep).join('/');
    const allowed = SERVER_ALLOW[rel] ?? [];
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    scanned++;
    for (const { text, pos } of problemLiterals(source)) {
      for (const rule of SERVER_RULES) {
        if (allowed.includes(rule.id) || !rule.re.test(text)) continue;
        const { line } = source.getLineAndCharacterOfPosition(pos);
        problems.push(`${rel}:${line + 1}  [서버 오류 문구 — ${rule.why}]  ${text.replace(/\s+/g, ' ').slice(0, 100)}`);
      }
    }
  }
}

if (problems.length) {
  console.error(`✖ 화면 문구 검사 — ${problems.length}건. 설계 근거는 주석으로, 화면에는 사용자가 읽을 말만 둔다 (docs/08-ui-production-readiness.md)`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`✔ 화면 문구 — 파일 ${scanned}개, 설계 문서 번호·개발 안내·구조 설명 없음`);
