import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { parse } from 'yaml';
import { parseWorkloadUri } from '@wonseoro/server-kit';
import { UNIVERSITY_ID } from '../../config';
import { INTERNAL_ROUTES, internalDecision } from './internal-auth';

/**
 * 내부 경로 상호 TLS — 대학 API (T-M5-05·09, D-69)
 *   ① 계약에서 mutualTLS 를 요구하는 대학 API 경로가 모두 표에 있다(빠지면 인증 없이 열린다)
 *   ② 같은 대학의 서류 워커만 — 다른 워크로드·다른 대학·신원 없음은 거절
 */
const ROOT = resolve(__dirname, '../../../../..');
const OPENAPI = parse(readFileSync(resolve(ROOT, 'packages/contracts/openapi/k-admission.v1.yaml'), 'utf8')) as {
  paths: Record<string, Record<string, { security?: Array<Record<string, string[]>> }>>;
};
const id = (uri: string) => parseWorkloadUri(uri);

describe('대학 API 내부 경로 — 계약의 mutualTLS', () => {
  it('계약의 대학 API mutualTLS 경로가 모두 표에 있고, 표에는 그것뿐이다', () => {
    const contract = Object.entries(OPENAPI.paths)
      .filter(([p]) => p.startsWith('/internal/v1/documents'))
      .flatMap(([p, ops]) =>
        Object.entries(ops)
          .filter(([, op]) => op.security?.some((s) => 'mutualTLS' in s))
          .map(([m]) => `${m.toUpperCase()} ${p.replace(/\{(\w+)\}/g, ':$1')}`),
      )
      .sort();
    assert.deepEqual(Object.keys(INTERNAL_ROUTES).sort(), contract);
  });

  it('같은 대학의 서류 워커만 통과한다', () => {
    const route = ['GET', '/internal/v1/documents/pending-scan'] as const;
    assert.equal(internalDecision(...route, id(`spiffe://wonseoro/university/${UNIVERSITY_ID}/document-service`)), 'ok');
    assert.equal(internalDecision(...route, null), 401);
    assert.equal(internalDecision(...route, id(`spiffe://wonseoro/university/${UNIVERSITY_ID}/event-relay`)), 403);
    assert.equal(internalDecision(...route, id('spiffe://wonseoro/university/UNIV-Z/document-service')), 403);
    assert.equal(internalDecision(...route, id('spiffe://wonseoro/central/document-service')), 403);
    assert.equal(internalDecision('GET', '/internal/v1/unknown', id(`spiffe://wonseoro/university/${UNIVERSITY_ID}/document-service`)), 403);
  });
});
