import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { knownExpiries, recordExpiry, watchCertificateExpiry } from './expiry';

const ROOT = path.resolve(__dirname, '../../..');
const DIR = path.join(ROOT, '.cache/test-expiry');

function cert(name: string, days: number): string {
  const file = path.join(DIR, `${name}.crt`);
  execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-keyout', path.join(DIR, `${name}.key`),
    '-out', file, '-subj', `/CN=${name}`, '-days', String(days)], { stdio: 'ignore' });
  return file;
}

describe('인증서·자격증명 만료 지표 (T-M5-65)', () => {
  it('인증서 파일의 만료 시각을 읽고, 파일이 바뀌면(갱신) 새 시각을 낸다', () => {
    rmSync(DIR, { recursive: true, force: true });
    mkdirSync(DIR, { recursive: true });
    const ca = cert('ca', 400);
    const leaf = cert('leaf', 2);
    watchCertificateExpiry({ certFile: leaf, keyFile: leaf.replace('.crt', '.key'), caFile: ca }, 'admission-api');
    const days = (kind: string) => {
      const e = knownExpiries().find((x) => x.kind === kind);
      return e?.at ? Math.round((e.at - Date.now()) / 86_400_000) : null;
    };
    assert.equal(days('workload-cert'), 2);
    assert.equal(days('ca-cert'), 400);
    const before = readFileSync(leaf);
    cert('leaf', 30); // 갱신 — 같은 경로를 새 인증서로
    assert.notDeepEqual(readFileSync(leaf), before);
    assert.equal(days('workload-cert'), 30);
    rmSync(DIR, { recursive: true, force: true });
  });

  it('임대 끝(DB 동적 계정)을 알리고 지운다', () => {
    recordExpiry('db-credential', 'admission-api', new Date(Date.now() + 3_600_000));
    assert.ok(knownExpiries().some((e) => e.kind === 'db-credential'));
    recordExpiry('db-credential', 'admission-api', null);
    assert.ok(!knownExpiries().some((e) => e.kind === 'db-credential'));
  });

  it('경보 규칙 — 30/14/7/3/1일 날짜 경보와 갱신 멈춤 경보가 같은 지표를 본다', () => {
    const text = readFileSync(path.join(ROOT, 'deploy/platform/observability/expiry-rules.yaml'), 'utf8');
    const horizons = [...text.matchAll(/horizon: (\w+)/g)].map((m) => m[1]);
    assert.deepEqual(horizons, ['30d', '14d', '7d', '3d', '1d']);
    const rules = [...text.matchAll(/- alert: (\w+)\n\s+expr: (.+)/g)].map((m) => ({ alert: m[1] as string, expr: m[2] as string }));
    assert.equal(rules.length, 8);
    for (const r of rules) assert.match(r.expr, /credential_expiry_timestamp_seconds/, r.alert);
    assert.ok(rules.some((r) => r.alert === 'WorkloadCertificateNotRenewed') && rules.some((r) => r.alert === 'DbCredentialNotRotated'));
  });
});
