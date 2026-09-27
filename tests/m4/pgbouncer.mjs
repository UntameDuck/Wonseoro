// T-M4-09 로컬 축소 검증 — PgBouncer 경유, 직접 DB 차단, 서버 커넥션 상한
//
// 전제: kind-univ-a가 deploy/local values로 배포되어 있고 로컬 DB가 :5432에 떠 있다.
// 이 시험은 운영 부하 수치가 아니라 차트 배선과 Connection Storm 상한만 확인한다.
//
//   node tests/m4/pgbouncer.mjs
import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { promisify } from 'node:util';
import pg from 'pg';

const exec = promisify(execFile);
const { Client } = pg;
const CONTEXT = 'kind-univ-a';
const NAMESPACE = 'kadmission-app';
const UPSTREAM_LIMIT = 10; // values-local: default 8 + reserve 2
const result = {
  test: 'T-M4-09-partial',
  environment: 'local-kind-univ-a (축소 환경)',
  limitation: '로컬 단일 DB에서 차트 배선·우회 차단·상한만 검증. 운영 HA/피크 부하는 미검증.',
  startedAt: new Date().toISOString(),
  checks: {},
};

function check(name, pass, detail) {
  result.checks[name] = { pass, ...detail };
  console.log(`${pass ? '✔' : '✖'} ${name} ${JSON.stringify(detail)}`);
}

function kubectl(args, timeout = 120_000) {
  return exec('kubectl', ['--context', CONTEXT, '-n', NAMESPACE, ...args], {
    cwd: process.cwd(), encoding: 'utf8', timeout, maxBuffer: 4 * 1024 * 1024,
  });
}

const connectionProbe = String.raw`
const net = require('node:net');
const direct = new URL(process.env.DATABASE_URL);
const attempt = (host, port) => new Promise((resolve) => {
  const socket = net.createConnection({host, port: Number(port)});
  const finish = (value) => { socket.destroy(); resolve(value); };
  socket.setTimeout(1500, () => finish('timeout'));
  socket.once('connect', () => finish('connected'));
  socket.once('error', (error) => finish(error.code || error.message));
});
(async () => console.log(JSON.stringify({
  proxy: await attempt(process.env.DB_PROXY_HOST, process.env.DB_PROXY_PORT),
  direct: await attempt(direct.hostname, direct.port || 5432),
})))().catch((error) => { console.error(error); process.exit(1); });
`;

const loadThroughProxy = String.raw`
const { Client } = require('pg');
const source = new URL(process.env.DATABASE_URL);
source.hostname = process.env.DB_PROXY_HOST;
source.port = process.env.DB_PROXY_PORT;
const run = async () => {
  const clients = Array.from({length: 30}, () => new Client({
    connectionString: source.toString(),
    options: '-c search_path=kadmission,public',
  }));
  const settled = await Promise.allSettled(clients.map(async (client) => {
    await client.connect();
    try { await client.query('select pg_sleep(5), count(*) from application'); }
    finally { await client.end(); }
  }));
  const failures = settled.filter((item) => item.status === 'rejected').map((item) => String(item.reason));
  console.log(JSON.stringify({total: settled.length, failures}));
  if (failures.length) process.exit(1);
};
run().catch((error) => { console.error(error); process.exit(1); });
`;

let admin;
try {
  const deployments = JSON.parse((await kubectl(['get', 'deployments', '-o', 'json'])).stdout);
  const ready = Object.fromEntries(deployments.items.map((item) => [
    item.metadata.name,
    { desired: item.spec.replicas, ready: item.status.readyReplicas ?? 0 },
  ]));
  check('pgbouncer-and-apps-ready', ['univ-a-pgbouncer', 'univ-a-api', 'univ-a-event-relay']
    .every((name) => ready[name]?.desired === ready[name]?.ready), { ready });

  const pod = (await kubectl(['get', 'pods', '-l', 'app=admission-api', '-o', 'jsonpath={.items[0].metadata.name}'])).stdout.trim();
  const env = JSON.parse((await kubectl(['exec', pod, '--', 'node', '-e', connectionProbe])).stdout.trim().split(/\r?\n/).at(-1));
  check('api-reaches-pooler', env.proxy === 'connected', env);
  check('api-cannot-bypass-pooler', env.direct !== 'connected', env);

  admin = new Client({ connectionString: 'postgresql://wonseoro:wonseoro@127.0.0.1:5432/univ_a' });
  await admin.connect();
  const load = kubectl(['exec', pod, '--', 'node', '-e', loadThroughProxy], 180_000);
  let maxConnections = 0;
  while (true) {
    const completed = await Promise.race([
      load.then((value) => ({ done: true, value }), (error) => ({ done: true, error })),
      new Promise((resolve) => setTimeout(() => resolve({ done: false }), 100)),
    ]);
    const count = Number((await admin.query(
      "select count(*)::int as count from pg_stat_activity where datname='univ_a' and usename='kadmission_app'",
    )).rows[0].count);
    maxConnections = Math.max(maxConnections, count);
    if (completed.done) {
      if (completed.error) throw completed.error;
      const summary = JSON.parse(completed.value.stdout.trim().split(/\r?\n/).at(-1));
      check('30-concurrent-queries-complete', summary.total === 30 && summary.failures.length === 0, summary);
      break;
    }
  }
  check('upstream-connections-stay-within-budget', maxConnections <= UPSTREAM_LIMIT, {
    observedMax: maxConnections,
    configuredMax: UPSTREAM_LIMIT,
  });
} catch (error) {
  result.error = error instanceof Error ? error.message : String(error);
  console.error(`✖ 중단: ${result.error}`);
} finally {
  await admin?.end().catch(() => {});
}

result.finishedAt = new Date().toISOString();
result.passed = !result.error && Object.values(result.checks).every((item) => item.pass);
mkdirSync('tests/m4/results', { recursive: true });
const output = `tests/m4/results/pgbouncer-${result.startedAt.replace(/[:.]/g, '-')}.json`;
writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(`${result.passed ? '통과' : '실패'} — ${output}`);
process.exit(result.passed ? 0 : 1);
