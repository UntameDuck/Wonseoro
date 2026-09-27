import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

/**
 * 소유권 검사 누락을 구조로 잡는다. (D-28)
 *
 * D-28 에서 지원자 경로 전부에 소유권 검사를 붙였는데 self-check 하나가 빠져 있었다.
 * 원서 ID 만 알면 남의 접수번호·결제 상태·시도 이력을 볼 수 있었다. 사람이 목록을 대조하면
 * 하나는 빠진다 — 그래서 컨트롤러를 훑는다.
 *
 * 규칙: `/api/v1` 아래에서 경로에 지원자 자원 식별자(원서·결제·서류·접수)가 있는 핸들러는
 * 본문에서 `this.ownership.assert…` 를 불러야 한다. 새 경로를 만들면서 빠뜨리면 여기서 깨진다.
 */
// 빌드된 시험은 dist/common/identity 에서 돈다. 원본 소스를 훑는다.
const SRC = resolve(__dirname, '../../../src');

/** 지원자 자원 식별자. 이게 경로에 있으면 남의 것일 수 있다. */
const RESOURCE_PARAM = /:(applicationId|paymentId|documentId|submissionId)\b/;

/** 지원자가 아니라 외부가 부르는 경로. 신원 대신 서명으로 막는다 (D-40). */
const EXEMPT = new Set<string>(['POST /api/v1/payments/callbacks/:provider']);

interface Handler {
  route: string;
  body: string;
  file: string;
}

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, e.name);
    if (e.isDirectory()) out.push(...tsFiles(full));
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

/** 핸들러마다 경로와 본문(다음 라우트 데코레이터 전까지)을 뽑는다. */
function handlers(): Handler[] {
  const out: Handler[] = [];
  const re = /@Controller\(\s*(?:'([^']*)')?\s*\)|@(Get|Post|Patch|Put|Delete)\(\s*(?:'([^']*)')?\s*\)/g;
  for (const file of tsFiles(SRC)) {
    const src = readFileSync(file, 'utf8');
    if (!src.includes('@Controller(')) continue;
    const marks = [...src.matchAll(re)];
    let prefix = '';
    marks.forEach((m, i) => {
      if (m[0].startsWith('@Controller')) {
        prefix = m[1] ?? '';
        return;
      }
      const end = marks[i + 1]?.index ?? src.length;
      const path = '/' + [prefix, m[3] ?? ''].filter(Boolean).join('/');
      out.push({
        route: `${m[2]!.toUpperCase()} ${path}`,
        body: src.slice(m.index!, end),
        file: file.slice(SRC.length + 1),
      });
    });
  }
  return out;
}

describe('소유권 검사 누락 방지 (D-28)', () => {
  it('지원자 자원 식별자를 받는 /api/v1 경로는 전부 소유권을 확인한다', () => {
    const scoped = handlers().filter(
      (h) => h.route.includes(' /api/v1/') && RESOURCE_PARAM.test(h.route) && !EXEMPT.has(h.route),
    );
    // 훑는 것이 실제로 동작하는지 — 0건이면 정규식이 깨진 것이다.
    assert.ok(scoped.length >= 10, `검사 대상이 너무 적다: ${scoped.length}`);

    const missing = scoped
      .filter((h) => !/this\.ownership\.assert\w+\(/.test(h.body))
      .map((h) => `${h.route}  (${h.file})`);
    assert.deepEqual(missing, [], `소유권 검사가 없는 경로:\n${missing.join('\n')}`);
  });
});
