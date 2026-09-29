// T-M4-07 로컬 축소 검증 — Peak Mode 예약이 서명 커밋 → Flux Pull → API 최소 replica 로 이어지는가 (D-48)
//
// 전제: kind-univ-a 에 T-M4-05 로컬 Flux(GitRepository·Kustomization·HelmRelease `wonseoro-local`/`univ-a`)가
// 설치되어 있고, 시험 저장소 사본(--work)의 git 설정에 신뢰된 임시 SSH 서명키가 잡혀 있다.
// 시험 저장소·서명키는 저장소 밖(E:\DockerData)에 있다. 이 스크립트는 키를 읽지 않고 `git commit -S` 만 부른다.
//
//   node tests/m4/peak-mode-gitops.mjs --git-root E:\DockerData\gitops-test-... --work E:\DockerData\gitops-test-...\work
//
// 순서: 사본에 dev-folder main 을 서명 병합 → 예약 창(지금 시작)을 넣고 생성기로 overlay 를 만든 서명 커밋
//   → Flux 재개 → API replica 2→3·PEAK_MODE_* env 확인 → 종료 시각 기준으로 다시 생성한 서명 커밋
//   → replica 3→2·env 제거 확인 → Flux 다시 suspend.
import { execFile, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const CONTEXT = 'kind-univ-a';
const NAMESPACE = 'kadmission-app';
const DEPLOYMENT = 'univ-a-api';
const BASE_REPLICAS = 2;          // values-local api.replicas
const PEAK_REPLICAS = 3;          // 이 시험의 예약 창 apiMinReplicas (축소 환경 DB 연결 예산 30 안)
const FLUX = [
  ['gitrepository', 'wonseoro-local'],
  ['kustomization', 'wonseoro-local'],
  ['helmrelease', 'univ-a'],
];

function arg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) throw new Error(`${name} 가 필요하다`);
  return resolve(process.argv[index + 1]);
}
const gitRoot = arg('--git-root');
const work = arg('--work');
const bare = join(gitRoot, 'Wonseoro.git');
const repo = process.cwd();

const result = {
  test: 'T-M4-07',
  scenario: 'Peak Mode 예약 → 서명 커밋 → Flux Pull → API 최소 replica 전환·원복',
  environment: 'local-kind-univ-a (축소 환경)',
  limitations: [
    '로컬 kind 단일 노드·autoscaling off — HPA minReplicas 대신 Deployment replicas 로 같은 values 경로를 확인했다.',
    '예약 실행 주체(GitHub Actions 예약 워크플로)는 대신 이 스크립트가 같은 생성기(scripts/peak-mode-sync.mjs)와 git commit -S 로 흉내 냈다. GitHub 예약 지연은 측정하지 않았다.',
    '서명키는 T-M4-05 의 임시 SSH 키다. 운영 서명 주체·보호된 environment secret 은 미검증.',
    '실행 중인 이미지는 이전 빌드라 PEAK_MODE_ENDS_AT 의 앱 동작은 단위 시험으로만 확인했다. 여기서는 env 전달까지 본다.',
  ],
  startedAt: new Date().toISOString(),
  checks: {},
  timeline: [],
};

function check(name, pass, detail = {}) {
  result.checks[name] = { pass, ...detail };
  console.log(`${pass ? '✔' : '✖'} ${name} ${JSON.stringify(detail)}`);
  if (!pass) throw new Error(`실패: ${name}`);
}
function mark(event, detail = {}) {
  const entry = { at: new Date().toISOString(), event, ...detail };
  result.timeline.push(entry);
  console.log(`· ${event} ${JSON.stringify(detail)}`);
}
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function run(command, args, cwd = repo, timeout = 120_000) {
  return exec(command, args, { cwd, encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024 })
    .then(({ stdout }) => stdout.trim());
}
const git = (args) => run('git', args, work);
const kubectl = (args, timeout) => run('kubectl', ['--context', CONTEXT, '-n', NAMESPACE, ...args], repo, timeout);

async function setSuspend(suspend) {
  for (const [kind, name] of FLUX) {
    await kubectl(['patch', kind, name, '--type=merge', '-p', JSON.stringify({ spec: { suspend } })]);
  }
  if (!suspend) {
    const at = new Date().toISOString();
    for (const [kind, name] of FLUX) {
      await kubectl(['annotate', '--overwrite', kind, name, `reconcile.fluxcd.io/requestedAt=${at}`]);
    }
  }
}

async function deploymentState() {
  const d = JSON.parse(await kubectl(['get', 'deployment', DEPLOYMENT, '-o', 'json']));
  const env = Object.fromEntries(
    (d.spec.template.spec.containers[0].env ?? []).filter((e) => e.name.startsWith('PEAK_MODE_')).map((e) => [e.name, e.value]),
  );
  return {
    replicas: d.spec.replicas,
    ready: d.status.readyReplicas ?? 0,
    updated: d.status.updatedReplicas ?? 0,
    generationObserved: d.status.observedGeneration === d.metadata.generation,
    env,
  };
}

async function helmReleaseRevision() {
  const hr = JSON.parse(await kubectl(['get', 'helmrelease', 'univ-a', '-o', 'json']));
  const ready = hr.status?.conditions?.find((c) => c.type === 'Ready');
  return { ready: ready?.status === 'True', reason: ready?.reason, revision: hr.status?.lastAttemptedRevision ?? '' };
}

async function waitFor(label, predicate, timeoutMs = 600_000) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeoutMs) {
    last = await predicate();
    if (last.ok) return { seconds: Math.round((Date.now() - started) / 100) / 10, ...last };
    await sleep(5_000);
  }
  throw new Error(`${label} 시간 초과: ${JSON.stringify(last)}`);
}

async function signedCommitAndPush(message) {
  await git(['commit', '-q', '-S', '-m', message]);
  const sha = await git(['rev-parse', 'HEAD']);
  // 검증은 Flux(SourceVerified)가 한다. 여기서는 SSH 서명 헤더가 실렸는지만 본다 (로컬 git 에는 allowedSigners 가 없다)
  const signed = (await git(['cat-file', 'commit', sha])).includes('gpgsig -----BEGIN SSH SIGNATURE');
  await git(['push', '-q', bare, 'HEAD:main']);
  mark('push', { sha, sshSignatureHeader: signed });
  return sha;
}

async function applyOverlay(nowIso, label) {
  const schedule = join(work, 'deploy/local/peak-schedule-univ-a.yaml');
  const overlay = join(work, 'deploy/local/peak-mode-univ-a.yaml');
  await run('node', ['scripts/peak-mode-sync.mjs', '--write', '--now', nowIso, '--schedule', schedule, '--out', overlay]);
  await git(['add', 'deploy/local/peak-schedule-univ-a.yaml', 'deploy/local/peak-mode-univ-a.yaml']);
  return signedCommitAndPush(`test: Peak Mode ${label}`);
}

async function waitRollout(sha, expectReplicas, expectPeakEnv) {
  const release = await waitFor('HelmRelease 수렴', async () => {
    const hr = await helmReleaseRevision();
    return { ok: hr.ready && hr.revision.includes(sha.slice(0, 12)), ...hr };
  });
  const rollout = await waitFor('Deployment 수렴', async () => {
    const d = await deploymentState();
    const envOk = expectPeakEnv
      ? d.env.PEAK_MODE_ENABLED === 'true' && Boolean(d.env.PEAK_MODE_ACTIVATES_AT) && Boolean(d.env.PEAK_MODE_ENDS_AT)
      : d.env.PEAK_MODE_ENABLED === 'false' && !d.env.PEAK_MODE_ACTIVATES_AT && !d.env.PEAK_MODE_ENDS_AT;
    return {
      ok: d.generationObserved && d.replicas === expectReplicas && d.ready === expectReplicas && d.updated === expectReplicas && envOk,
      ...d,
    };
  });
  return { release, rollout };
}

const server = spawn('node', ['tests/m4/helpers/git-smart-http-server.mjs', gitRoot, '9418'], { cwd: repo, stdio: 'ignore' });
let resumed = false;
try {
  await sleep(1_000);

  // 0) 시작 상태
  const before = await deploymentState();
  check('시작 상태 평시', before.replicas === BASE_REPLICAS && before.ready === BASE_REPLICAS, before);

  // 1) 시험 사본에 새 main 을 서명 병합 (이전 시험 커밋은 순변경이 없다 → bare 에 fast-forward)
  await git(['fetch', '-q', 'origin', 'main']);
  await git(['merge', '-q', '--no-edit', '-S', 'origin/main']);
  const treeEqual = (await git(['rev-parse', 'HEAD^{tree}'])) === (await git(['rev-parse', 'origin/main^{tree}']));
  check('사본 트리 = dev-folder main', treeEqual, { main: await git(['rev-parse', '--short', 'origin/main']) });

  // 2) 예약 창을 지금 시작으로 넣는다: 억제 5분 뒤, 종료 60분 뒤
  const now = Date.now();
  const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const window = {
    id: 'local-peak-test',
    scaleOutAt: iso(now - 60_000),
    suspendJobsAt: iso(now + 5 * 60_000),
    endsAt: iso(now + 60 * 60_000),
  };
  writeFileSync(join(work, 'deploy/local/peak-schedule-univ-a.yaml'), [
    '# 로컬 축소 시험이 만든 예약 — 시험 저장소 사본에만 있다',
    'university: UNIV-A',
    'leadMinutes: 0',
    'windows:',
    `  - id: ${window.id}`,
    `    scaleOutAt: "${window.scaleOutAt}"`,
    `    suspendJobsAt: "${window.suspendJobsAt}"`,
    `    endsAt: "${window.endsAt}"`,
    `    apiMinReplicas: ${PEAK_REPLICAS}`,
    '',
  ].join('\n'));
  result.window = { ...window, apiMinReplicas: PEAK_REPLICAS };

  const activateSha = await applyOverlay(new Date(now).toISOString(), '예약 창 시작');
  const pushedAt = Date.now();
  await setSuspend(false);
  resumed = true;
  mark('flux resumed');
  const up = await waitRollout(activateSha, PEAK_REPLICAS, true);
  check('예약 창 시작 → API replica 상향', true, {
    from: BASE_REPLICAS, to: up.rollout.replicas, env: up.rollout.env,
    helmRevision: up.release.revision, secondsFromPush: Math.round((Date.now() - pushedAt) / 1000),
  });
  check('억제·종료 시각이 예약과 같다',
    up.rollout.env.PEAK_MODE_ACTIVATES_AT === window.suspendJobsAt && up.rollout.env.PEAK_MODE_ENDS_AT === window.endsAt,
    up.rollout.env);

  // 3) 종료 시각 기준으로 다시 생성 → 평시 overlay
  const endSha = await applyOverlay(window.endsAt, '예약 창 종료');
  const endPushedAt = Date.now();
  const down = await waitRollout(endSha, BASE_REPLICAS, false);
  check('예약 창 종료 → API replica 원복·억제 env 제거', true, {
    from: PEAK_REPLICAS, to: down.rollout.replicas, env: down.rollout.env,
    helmRevision: down.release.revision, secondsFromPush: Math.round((Date.now() - endPushedAt) / 1000),
  });

  // 4) Source 서명 검증이 계속 통과했는가
  const source = JSON.parse(await kubectl(['get', 'gitrepository', 'wonseoro-local', '-o', 'json']));
  const verified = source.status?.conditions?.find((c) => c.type === 'SourceVerified');
  check('서명 검증 통과 유지', verified?.status === 'True', {
    artifact: source.status?.artifact?.revision, reason: verified?.reason,
  });
} finally {
  if (resumed) {
    await setSuspend(true).then(() => mark('flux suspended')).catch((error) => mark('flux suspend 실패', { error: String(error) }));
  }
  server.kill();
  result.finishedAt = new Date().toISOString();
  result.pass = Object.values(result.checks).every((c) => c.pass) && Object.keys(result.checks).length >= 6;
  mkdirSync('tests/m4/results', { recursive: true });
  const output = `tests/m4/results/peak-mode-gitops-${result.startedAt.replace(/[:.]/g, '-')}.json`;
  writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`결과: ${output} (${result.pass ? 'PASS' : 'FAIL'})`);
}
