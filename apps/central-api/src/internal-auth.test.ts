import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { parse } from 'yaml';
import { INTERNAL_ROUTES } from './internal-auth';
import { sourceUniversity } from './modules/sync-gateway/sync-gateway.controller';

/**
 * 내부 경로 상호 TLS — 중앙 API (T-M5-05·09, D-69)
 * 계약에서 mutualTLS 를 요구하는 중앙 경로가 모두 표에 있어야 한다 — 빠지면 인증 없이 열린다.
 */
const ROOT = resolve(__dirname, '../../..');
const OPENAPI = parse(readFileSync(resolve(ROOT, 'packages/contracts/openapi/k-admission.v1.yaml'), 'utf8')) as {
  paths: Record<string, Record<string, { security?: Array<Record<string, string[]>> }>>;
};

describe('중앙 내부 경로 — 계약의 mutualTLS', () => {
  it('계약의 중앙 mutualTLS 경로가 모두 표에 있고, 표에는 그것뿐이다', () => {
    const contract = Object.entries(OPENAPI.paths)
      .filter(([p]) => p.startsWith('/internal/') && !p.startsWith('/internal/v1/documents'))
      .flatMap(([p, ops]) =>
        Object.entries(ops)
          .filter(([, op]) => op.security?.some((s) => 'mutualTLS' in s))
          .map(([m]) => `${m.toUpperCase()} ${p.replace(/\{(\w+)\}/g, ':$1')}`),
      )
      .sort();
    assert.deepEqual(Object.keys(INTERNAL_ROUTES).sort(), contract);
  });

  it('이벤트 출처에서 대학을 읽는다 — 모양이 다르면 대학이 아니다', () => {
    assert.equal(sourceUniversity('urn:k-admission:university:UNIV-A'), 'UNIV-A');
    for (const bad of ['urn:k-admission:university:univ-a', 'urn:k-admission:university:', 'urn:evil:university:UNIV-A', 42, undefined]) {
      assert.equal(sourceUniversity(bad), null, String(bad));
    }
  });
});
