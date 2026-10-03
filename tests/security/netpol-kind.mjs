// NetworkPolicy 기본 차단 — kind 두 대학에서 워크로드별 출구 행렬 (T-M5-01, docs/13 단계 2, D-45 를 다시 돌릴 수 있게)
//
// 사용: kind 두 클러스터(kind-univ-a·kind-univ-b)와 로컬 데이터 서비스(compose: DB 두 개·Redis, 중앙 :3000·MinIO :9000 은 없어도 된다)
//       npm run test:security:netpol
// 각 워크로드 파드 안에서 Node 로 TCP 연결을 시도한다.
//   열림  = 연결됨 또는 연결 거부(상대가 없어도 네트워크는 통과했다)
//   막힘  = 2.5초 시간 초과(NetworkPolicy 가 버린다 — kindnet 은 거부 대신 버린다)
// 기대값은 차트의 NetworkPolicy 와 대학별 값(deploy/local/values-*.yaml)에서 나온다. 로컬 데이터 서비스는 Docker 호스트(192.168.65.254)에 있다.
// 결과는 tests/security/results/netpol-kind-<시각>.json
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const HOST = '192.168.65.254';
const UNIVERSITIES = [
  { ctx: 'kind-univ-a', release: 'univ-a', ownDb: 5432, otherDb: 5442, otherNodePort: 18082 },
  { ctx: 'kind-univ-b', release: 'univ-b', ownDb: 5442, otherDb: 5432, otherNodePort: 18081 },
];

const started = Date.now();
const steps = [];
const problems = [];
const check = (ok, what, detail) => {
  steps.push({ ok: !!ok, what, ...(detail !== undefined ? { detail } : {}) });
  console.log(`${ok ? '✔' : '✘'} ${what}${detail !== undefined ? ` ${JSON.stringify(detail)}` : ''}`);
  if (!ok) problems.push(what);
};

/** 파드 안에서 목적지 목록에 연결해 본다 — [{name, host, port}] → {name: 결과} */
function probe(ctx, pod, targets) {
  const script = `
const net=require('net'),dns=require('dns').promises;
const t=(h,p)=>new Promise(r=>{const s=net.connect({host:h,port:p});const done=v=>{s.destroy();r(v)};s.setTimeout(2500,()=>done('timeout'));s.on('connect',()=>done('connected'));s.on('error',e=>done(e.code))});
(async()=>{const out={};for(const x of ${JSON.stringify(targets)}){let ip=x.host;if(!/^[0-9.]+$/.test(ip)){try{ip=(await dns.lookup(x.host)).address}catch(e){out[x.name]='dns-'+e.code;continue}}out[x.name]=await t(ip,x.port)}console.log(JSON.stringify(out))})()`;
  const r = spawnSync('kubectl', [`--context=${ctx}`, '-n', 'kadmission-app', 'exec', pod, '--', 'node', '-e', script], { encoding: 'utf8', timeout: 120_000 });
  const line = (r.stdout ?? '').trim().split('\n').pop();
  try {
    return JSON.parse(line);
  } catch {
    throw new Error(`${ctx}/${pod} 연결 시험 실패: ${(r.stderr ?? '').slice(-300)}`);
  }
}
const isOpen = (v) => v === 'connected' || v === 'ECONNREFUSED';

let cells = 0;
try {
  for (const u of UNIVERSITIES) {
    const podOf = (app) => {
      const r = spawnSync('kubectl', [`--context=${u.ctx}`, '-n', 'kadmission-app', 'get', 'pods', '-l', `app=${app}`, '--field-selector=status.phase=Running', '-o', 'jsonpath={.items[0].metadata.name}'], { encoding: 'utf8' });
      if (!r.stdout) throw new Error(`${u.ctx} 에 ${app} 파드가 없다`);
      return r.stdout.trim();
    };
    const T = {
      pgbouncer: { host: `${u.release}-pgbouncer`, port: 6432 },
      ownApi: { host: `${u.release}-api`, port: 80 },
      ownDbDirect: { host: HOST, port: u.ownDb },
      otherDb: { host: HOST, port: u.otherDb },
      redis: { host: HOST, port: 6379 },
      central: { host: HOST, port: 3000 },
      objectStorage: { host: HOST, port: 9000 },
      otherHostPort: { host: HOST, port: 8080 },
      otherUniversity: { host: HOST, port: u.otherNodePort },
      internet: { host: '1.1.1.1', port: 443 },
      metadata: { host: '169.254.169.254', port: 80 },
      kubeApi: { host: 'kubernetes.default', port: 443 },
    };
    // 워크로드 → 열려야 할 목적지(나머지는 모두 막혀야 한다)
    const OPEN = {
      'admission-api': ['pgbouncer', 'redis', 'central', 'objectStorage'],
      'event-relay': ['pgbouncer', 'redis', 'central', 'objectStorage'],
      'document-service': ['ownApi'],
    };
    for (const [app, open] of Object.entries(OPEN)) {
      const result = probe(u.ctx, podOf(app), Object.entries(T).map(([name, t]) => ({ name, ...t })));
      const wrong = Object.keys(T)
        .filter((name) => isOpen(result[name]) !== open.includes(name))
        .map((name) => `${name}: ${result[name]}(기대 ${open.includes(name) ? '열림' : '막힘'})`);
      cells += Object.keys(T).length;
      check(wrong.length === 0, `${u.release} ${app} — 열림 ${open.length} · 막힘 ${Object.keys(T).length - open.length}`, wrong.length ? wrong : result);
    }
  }
} catch (err) {
  check(false, `중단: ${err.message}`);
}

const result = {
  test: 'NetworkPolicy 기본 차단 — 워크로드별 출구 행렬 (T-M5-01)',
  environment: '축소 환경 — 로컬 kind 두 클러스터(kindnet NetworkPolicy), 데이터 서비스는 Docker 호스트',
  at: new Date(started).toISOString(),
  cells,
  passed: problems.length === 0,
  steps,
};
const dir = path.join(ROOT, 'tests/security/results');
mkdirSync(dir, { recursive: true });
const file = path.join(dir, `netpol-kind-${new Date(started).toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
console.log(`${result.passed ? '✔' : '✘'} NetworkPolicy 행렬 ${cells}칸 — 문제 ${problems.length}건 → ${path.relative(ROOT, file)}`);
process.exitCode = result.passed ? 0 : 1;
