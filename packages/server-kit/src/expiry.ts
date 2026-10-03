import { X509Certificate } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { metrics } from '@opentelemetry/api';
import type { MtlsFiles } from './mtls';

/**
 * 인증서·자격증명 만료 지표 (T-M5-65, §01 B9 "30/14/7/3/1일 사전 경보")
 *
 *   credential_expiry_timestamp_seconds{kind, name}  만료 시각(유닉스 초). 경보는 `- time()` 으로 남은 시간을 본다
 *     kind=workload-cert  이 워크로드의 상호 TLS 인증서(파일 — 바뀌면 다시 읽는다)
 *     kind=ca-cert        플랫폼 CA(상대를 검증하는 인증서 — 끝나면 모든 내부 호출이 끊긴다)
 *     kind=db-credential  Vault DB 동적 계정의 임대 끝
 *     kind=signing-key 등 다른 것도 recordExpiry 로 더한다
 * 경보 규칙은 deploy/platform/observability/expiry-rules.yaml. 갱신이 멈추면(Vault 장애·잘못된 교체) 남은 시간이 줄어 경보가 울린다.
 */

const expiries = new Map<string, { kind: string; name: string; at: () => number | null }>();
let registered = false;

function register(): void {
  if (registered) return;
  registered = true;
  metrics
    .getMeter('k-admission.expiry')
    .createObservableGauge('credential_expiry_timestamp_seconds', {
      description: '인증서·자격증명 만료 시각(유닉스 초) — 경보는 남은 시간(이 값 - time())을 본다 (T-M5-65)',
      unit: 's',
    })
    .addCallback((r) => {
      for (const e of expiries.values()) {
        const at = e.at();
        if (at !== null) r.observe(Math.floor(at / 1000), { kind: e.kind, name: e.name });
      }
    });
}

/** 만료 시각을 알린다(같은 kind·name 이면 바꾼다). 날짜가 없으면 지운다 */
export function recordExpiry(kind: string, name: string, at: Date | null): void {
  register();
  const key = `${kind}|${name}`;
  if (!at) expiries.delete(key);
  else expiries.set(key, { kind, name, at: () => at.getTime() });
}

/** 인증서 파일의 notAfter — 파일이 바뀌면 다시 읽는다(Vault 가 인증서를 바꿔 쓴다) */
function certFileExpiry(file: string): () => number | null {
  let seen = -1;
  let value: number | null = null;
  return () => {
    try {
      const m = statSync(file).mtimeMs;
      if (m !== seen) {
        seen = m;
        value = new Date(new X509Certificate(readFileSync(file)).validTo).getTime();
      }
    } catch {
      value = null; // 파일이 없다 — 지표를 내지 않는다(없음 자체는 기동 검사가 잡는다)
    }
    return value;
  };
}

/** 상호 TLS 인증서·CA 의 만료를 지표로 — 각 서비스 기동 때 */
export function watchCertificateExpiry(files: MtlsFiles | null, workload: string): void {
  if (!files) return;
  register();
  expiries.set(`workload-cert|${workload}`, { kind: 'workload-cert', name: workload, at: certFileExpiry(files.certFile) });
  expiries.set(`ca-cert|platform`, { kind: 'ca-cert', name: 'platform', at: certFileExpiry(files.caFile) });
}

/** 시험용 — 지금 알고 있는 만료 시각 */
export function knownExpiries(): Array<{ kind: string; name: string; at: number | null }> {
  return [...expiries.values()].map((e) => ({ kind: e.kind, name: e.name, at: e.at() }));
}
