// CSP 적합성 사전 점검 — 새 클러스터(K-PaaS·CSP)가 차트에 필요한 능력을 갖췄는지 (T-M6-03, 노션 §01 A8)
//
// 사용: node scripts/ops/csp-preflight.mjs --context=<kube 컨텍스트>   (npm run ops:csp-preflight -- --context=kind-univ-a)
// 실제로 만들어 보고 지운다(점검용 네임스페이스 kadmission-preflight-<시각>). 필수가 하나라도 없으면 종료 코드 1.
//   필수  Kubernetes ≥ 1.30(승인 정책 GA) · 기본 StorageClass · NetworkPolicy 가 **실제로 막는다** · ValidatingAdmissionPolicy API ·
//         Pod Security Admission(restricted) · LoadBalancer 주소 발급 · 노드 zone 2개 이상
//   권장  Gateway API(GatewayClass — ingress-nginx 은퇴 D-53) · 메트릭 API(HPA) · 볼륨 확장
//   사람  저장 데이터 암호화(KMS)·백업 소산·KCMVP — API 로 알 수 없다. 결과에 질문으로 남긴다
// 결과는 tests/ops/results/csp-preflight-<컨텍스트>-<시각>.json
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CONTEXT = process.argv.find((a) => a.startsWith('--context='))?.split('=')[1] ?? 'kind-univ-a';
const NS = `kadmission-preflight-${Date.now()}`;
const IMAGE = process.env.PREFLIGHT_IMAGE ?? 'node:22-alpine';
const started = Date.now();
const steps = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const k = (args, input) => {
  const r = spawnSync('kubectl', [`--context=${CONTEXT}`, ...args], { input, encoding: 'utf8', timeout: 120_000 });
  return { ok: r.status === 0, out: `${r.stdout ?? ''}`.trim(), err: `${r.stderr ?? ''}`.trim() };
};
const json = (args) => {
  const r = k([...args, '-o', 'json']);
  return r.ok ? JSON.parse(r.out) : null;
};
const record = (level, ok, what, detail) => {
  steps.push({ level, ok: !!ok, what, ...(detail !== undefined ? { detail } : {}) });
  const mark = ok ? '✔' : level === 'required' ? '✘' : '△';
  console.log(`${mark} [${{ required: '필수', recommended: '권장', manual: '사람' }[level]}] ${what}${detail !== undefined ? ` ${JSON.stringify(detail)}` : ''}`);
};

try {
  // ── 버전·API ──────────────────────────────────────────────────────
  const ver = json(['version']);
  const minor = Number(ver?.serverVersion?.minor?.replace(/\D/g, '') ?? 0);
  record('required', Number(ver?.serverVersion?.major) === 1 && minor >= 30, 'Kubernetes 1.30 이상', { server: ver?.serverVersion?.gitVersion });
  const apis = k(['api-versions']).out.split('\n');
  record('required', apis.includes('admissionregistration.k8s.io/v1') && k(['api-resources', '--api-group=admissionregistration.k8s.io', '-o', 'name']).out.includes('validatingadmissionpolicies'),
    'ValidatingAdmissionPolicy API(서명 이미지·sre 수정 범위 정책)');
  record('recommended', apis.some((a) => a.startsWith('gateway.networking.k8s.io/')), 'Gateway API(GatewayClass) — 공개 입구', { gatewayClasses: json(['get', 'gatewayclasses'])?.items?.map((g) => g.metadata.name) ?? [] });
  record('recommended', apis.includes('metrics.k8s.io/v1beta1'), '메트릭 API — HPA');

  // ── 저장소 ───────────────────────────────────────────────────────
  const scs = json(['get', 'storageclasses'])?.items ?? [];
  const def = scs.find((s) => s.metadata.annotations?.['storageclass.kubernetes.io/is-default-class'] === 'true');
  record('required', !!def, '기본 StorageClass', { default: def?.metadata.name ?? null, all: scs.map((s) => s.metadata.name) });
  record('recommended', !!def?.allowVolumeExpansion, '볼륨 확장(allowVolumeExpansion)');

  // ── 노드 zone ────────────────────────────────────────────────────
  const zones = new Set((json(['get', 'nodes'])?.items ?? []).map((n) => n.metadata.labels?.['topology.kubernetes.io/zone']).filter(Boolean));
  record('required', zones.size >= 2, '노드 zone 2개 이상(topologySpread·Multi-AZ)', { zones: [...zones] });

  // ── 실제로 만들어 본다 ───────────────────────────────────────────
  k(['create', 'namespace', NS]);
  k(['label', 'namespace', NS, 'pod-security.kubernetes.io/enforce=restricted']);
  // Pod Security — restricted 위반 Pod 는 거절돼야 한다
  const priv = k(['run', 'privileged', '-n', NS, `--image=${IMAGE}`, '--restart=Never', '--overrides', JSON.stringify({ spec: { containers: [{ name: 'privileged', image: IMAGE, securityContext: { privileged: true } }] } })]);
  record('required', !priv.ok && /forbidden|violates PodSecurity/i.test(priv.err), 'Pod Security Admission(restricted) 이 위반 Pod 를 거절');

  // NetworkPolicy — 실제로 막는가(정책을 모르는 CNI 는 조용히 통과시킨다)
  const sc = { runAsNonRoot: true, runAsUser: 10001, allowPrivilegeEscalation: false, capabilities: { drop: ['ALL'] }, seccompProfile: { type: 'RuntimeDefault' } };
  const pod = (name, args, labels) => ({
    apiVersion: 'v1', kind: 'Pod', metadata: { name, namespace: NS, labels },
    spec: { containers: [{ name, image: IMAGE, command: ['node', '-e', args], securityContext: sc }], restartPolicy: 'Never' },
  });
  k(['apply', '-f', '-'], JSON.stringify(pod('server', "require('http').createServer((q,s)=>s.end('ok')).listen(8080)", { app: 'server' })));
  k(['expose', 'pod', 'server', '-n', NS, '--port=8080']);
  k(['wait', '-n', NS, '--for=condition=Ready', 'pod/server', '--timeout=120s']);
  const probe = (name) => {
    k(['apply', '-f', '-'], JSON.stringify(pod(name, "const s=require('net').connect(8080,'server');s.setTimeout(3000,()=>{console.log('timeout');process.exit(0)});s.on('connect',()=>{console.log('open');process.exit(0)});s.on('error',e=>{console.log(e.code);process.exit(0)})", { app: name })));
    k(['wait', '-n', NS, '--for=jsonpath={.status.phase}=Succeeded', `pod/${name}`, '--timeout=90s']);
    return k(['logs', '-n', NS, name]).out;
  };
  const before = probe('client-before');
  k(['apply', '-n', NS, '-f', '-'], JSON.stringify({ apiVersion: 'networking.k8s.io/v1', kind: 'NetworkPolicy', metadata: { name: 'deny' }, spec: { podSelector: { matchLabels: { app: 'server' } }, policyTypes: ['Ingress'] } }));
  await sleep(3000);
  const after = probe('client-after');
  record('required', before === 'open' && after !== 'open', 'NetworkPolicy 가 실제로 막는다(정책 전 열림 → 정책 뒤 막힘)', { before, after });

  // LoadBalancer — 주소가 나오는가(공개 입구·Edge)
  k(['expose', 'pod', 'server', '-n', NS, '--name=lb', '--type=LoadBalancer', '--port=80', '--target-port=8080']);
  let lb = null;
  for (let i = 0; i < 12 && !lb; i++) {
    await sleep(5000);
    const ing = json(['get', 'service', 'lb', '-n', NS])?.status?.loadBalancer?.ingress?.[0];
    lb = ing?.ip ?? ing?.hostname ?? null;
  }
  record('required', !!lb, 'LoadBalancer 주소 발급(60초 안)', { address: lb });

  // ── 사람이 확인할 것 ─────────────────────────────────────────────
  for (const q of [
    'etcd·디스크 저장 데이터 암호화(KMS 연동, 키 관리 주체)',
    '백업 소산 — 다른 장애영역·리전으로 PITR 기본 백업·WAL 복제(T-M5-61)',
    '암호 모듈 검증(KCMVP) 대상 여부 — Transit·TLS 구현',
    'Object Storage Object Lock(COMPLIANCE) 지원 — 감사 기록 WORM(T-M3-03)',
    '노드 장애 시 NotReady 판정 시간·Edge 재시도(ADR-0008)',
  ]) record('manual', false, q);
} catch (err) {
  record('required', false, `중단: ${err.message}`);
} finally {
  k(['delete', 'namespace', NS, '--wait=false', '--ignore-not-found']);
}

const missing = steps.filter((s) => s.level === 'required' && !s.ok).map((s) => s.what);
const result = {
  test: 'CSP 적합성 사전 점검 (T-M6-03)',
  context: CONTEXT,
  at: new Date(started).toISOString(),
  passed: missing.length === 0,
  missingRequired: missing,
  steps,
};
const dir = path.join(ROOT, 'tests/ops/results');
mkdirSync(dir, { recursive: true });
const file = path.join(dir, `csp-preflight-${CONTEXT}-${new Date(started).toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
console.log(`${result.passed ? '✔' : '✘'} ${CONTEXT} — 필수 ${steps.filter((s) => s.level === 'required').length}개 중 없음 ${missing.length} → ${path.relative(ROOT, file)}`);
process.exit(result.passed ? 0 : 1);
