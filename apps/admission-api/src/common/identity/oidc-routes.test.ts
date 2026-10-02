import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { RequestMethod } from '@nestjs/common';
import { MODULE_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { parse } from 'yaml';
import { AppModule } from '../../app.module';
import { ADMIN_SCOPE_KEY, STEP_UP_KEY } from './admin-scope';
import { PUBLIC_ROUTES, routeAudience } from './oidc-auth';

/**
 * 인증 경로 분류·운영 API 권한을 계약(OpenAPI)과 구조로 대조한다 — T-M5-02, STRIDE E-03
 *
 * 사람이 표를 맞추면 하나는 빠진다(D-28 소유권 검사 누락이 그랬다). 그래서 실제 AppModule 의 컨트롤러를
 * 훑어 모든 경로에 대해 확인한다.
 *   ① 경로 분류(routeAudience)가 계약의 security 와 같다 — `[]` 는 토큰 없이, `oidc: [scope]` 는 담당자, 전역은 지원자
 *   ② 운영 경로마다 @AdminScope 가 있고 계약의 범위와 같다
 *   ③ 재인증(@StepUp) 경로가 정한 목록과 같다 — 늘리거나 빼면 여기서 결정을 다시 본다
 */
const ROOT = resolve(__dirname, '../../../../..');
const OPENAPI = parse(readFileSync(resolve(ROOT, 'packages/contracts/openapi/k-admission.v1.yaml'), 'utf8')) as {
  paths: Record<string, Record<string, { operationId?: string; security?: Array<Record<string, string[]>> }>>;
};

interface Route {
  method: string;
  /** Fastify 모양 — `/api/v1/applications/:applicationId` */
  url: string;
  scope?: string;
  stepUp: boolean;
}

const METHOD_NAME: Record<number, string> = {
  [RequestMethod.GET]: 'GET',
  [RequestMethod.POST]: 'POST',
  [RequestMethod.PUT]: 'PUT',
  [RequestMethod.PATCH]: 'PATCH',
  [RequestMethod.DELETE]: 'DELETE',
};

function controllersOf(module: unknown, seen = new Set<unknown>()): Function[] {
  if (!module || seen.has(module)) return [];
  seen.add(module);
  const own = (Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, module as object) ?? []) as Function[];
  const imports = (Reflect.getMetadata(MODULE_METADATA.IMPORTS, module as object) ?? []) as unknown[];
  return [...own, ...imports.flatMap((m) => controllersOf((m as { module?: unknown })?.module ?? m, seen))];
}

const join = (...parts: string[]) => `/${parts.map((p) => p.replace(/^\/|\/$/g, '')).filter(Boolean).join('/')}`;

function routes(): Route[] {
  const out: Route[] = [];
  for (const ctrl of controllersOf(AppModule)) {
    const prefix = (Reflect.getMetadata(PATH_METADATA, ctrl) ?? '') as string;
    const classScope = Reflect.getMetadata(ADMIN_SCOPE_KEY, ctrl) as string | undefined;
    const proto = ctrl.prototype as Record<string, unknown>;
    for (const name of Object.getOwnPropertyNames(proto)) {
      const fn = proto[name];
      if (name === 'constructor' || typeof fn !== 'function') continue;
      const method = Reflect.getMetadata(METHOD_METADATA, fn) as number | undefined;
      if (method === undefined) continue;
      const sub = (Reflect.getMetadata(PATH_METADATA, fn) ?? '') as string;
      out.push({
        method: METHOD_NAME[method] ?? String(method),
        url: join(prefix, sub),
        scope: (Reflect.getMetadata(ADMIN_SCOPE_KEY, fn) as string | undefined) ?? classScope,
        stepUp: Reflect.getMetadata(STEP_UP_KEY, fn) === true,
      });
    }
  }
  return out;
}

/** 계약 경로(`{id}`) → Fastify 모양(`:id`) */
const fastifyPath = (p: string) => p.replace(/\{([^}]+)\}/g, ':$1');

function contractOps(): Map<string, { security: Array<Record<string, string[]>> | undefined }> {
  const map = new Map<string, { security: Array<Record<string, string[]>> | undefined }>();
  for (const [path, ops] of Object.entries(OPENAPI.paths)) {
    for (const [method, op] of Object.entries(ops)) {
      if (!op?.operationId) continue;
      map.set(`${method.toUpperCase()} ${fastifyPath(path)}`, { security: op.security });
    }
  }
  return map;
}

const ALL = routes();
const CONTRACT = contractOps();

describe('인증 경로 분류 — 계약과 같다 (T-M5-02)', () => {
  it('컨트롤러를 실제로 훑었다', () => {
    assert.ok(ALL.length >= 40, `경로가 너무 적다: ${ALL.length}`);
    assert.ok(ALL.some((r) => r.url === '/admin/v1/config/active'));
  });

  it('계약에 있는 경로는 security 대로 분류된다', () => {
    const wrong: string[] = [];
    for (const r of ALL) {
      const op = CONTRACT.get(`${r.method} ${r.url}`);
      if (!op) continue;
      const sec = op.security;
      const expected =
        sec === undefined
          ? 'applicant'
          : sec.length === 0
            ? r.url.startsWith('/api/v1/')
              ? 'public'
              : 'none'
            : sec.some((s) => 'oidc' in s)
              ? 'staff'
              : 'none'; // mutualTLS
      const actual = routeAudience(r.method, r.url);
      if (actual !== expected) wrong.push(`${r.method} ${r.url}: 계약 ${expected} · 분류 ${actual}`);
    }
    assert.deepEqual(wrong, []);
  });

  it('계약에 없는 지원자 경로도 기본은 토큰 필요다(닫힌 기본값)', () => {
    for (const r of ALL.filter((x) => x.url.startsWith('/api/v1/') && !CONTRACT.has(`${x.method} ${x.url}`))) {
      assert.equal(routeAudience(r.method, r.url), 'applicant', `${r.method} ${r.url}`);
    }
  });

  it('공개 경로 목록이 실제 경로를 가리킨다(오타로 비어 있지 않다)', () => {
    for (const key of PUBLIC_ROUTES) assert.ok(ALL.some((r) => `${r.method} ${r.url}` === key), key);
  });
});

describe('운영 API 권한 — 계약 범위와 같다 (T-M5-10, STRIDE E-03)', () => {
  const admin = ALL.filter((r) => r.url.startsWith('/admin/v1/'));

  it('모든 운영 경로에 권한 범위가 붙어 있다', () => {
    assert.deepEqual(admin.filter((r) => !r.scope).map((r) => `${r.method} ${r.url}`), []);
  });

  it('권한 범위가 계약의 oidc 범위와 같다', () => {
    const wrong: string[] = [];
    for (const r of admin) {
      const op = CONTRACT.get(`${r.method} ${r.url}`);
      // 계약에 없는 운영 경로(D-22 마감 활성화)는 같은 묶음의 범위(admin)를 쓴다
      const expected = op?.security?.find((s) => 'oidc' in s)?.oidc?.[0] ?? 'admin';
      if (r.scope !== expected) wrong.push(`${r.method} ${r.url}: 계약 ${expected} · 코드 ${r.scope}`);
    }
    assert.deepEqual(wrong, []);
  });

  it('재인증(Step-up) 경로 — 승인·활성화·되돌리기·연장·대사 예외 해결·증적 열람', () => {
    const stepUp = admin.filter((r) => r.stepUp).map((r) => `${r.method} ${r.url}`).sort();
    assert.deepEqual(stepUp, [
      'GET /admin/v1/evidence/applications/:applicationId',
      'POST /admin/v1/config/versions/:configId/activate',
      'POST /admin/v1/config/versions/:configId/approve',
      'POST /admin/v1/config/versions/:configId/rollback',
      'POST /admin/v1/deadline-policies/:policyId/activate',
      'POST /admin/v1/deadline-policies/:policyId/approve',
      'POST /admin/v1/deadline-policies/extensions',
      'POST /admin/v1/reconciliation/:exceptionId/resolve',
    ]);
  });

  it('지원자 경로에는 운영 권한 표시가 없다', () => {
    assert.deepEqual(ALL.filter((r) => !r.url.startsWith('/admin/v1/') && (r.scope || r.stepUp)).map((r) => r.url), []);
  });
});
