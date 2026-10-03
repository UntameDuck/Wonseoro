// break-glass 회수·경보 (T-M5-03, docs/13 단계 5) — 차트 CronJob 이 매분 돌린다(node 표준 라이브러리만)
//
//   비상 역할 바인딩이 있으면
//     끝나는 시각 전  → Warning 이벤트 BreakGlassActive(매분 — 켜져 있는 동안 계속 보인다) + 경보 웹훅(있으면)
//     끝나는 시각 뒤  → 바인딩을 지우고 Warning 이벤트 BreakGlassRevoked + 경보 웹훅
//   바인딩이 없으면 아무것도 하지 않는다.
// GitOps 가 바인딩을 되살리지 않는다 — 차트는 끝나는 시각이 지나면 바인딩을 렌더링하지 않는다(rbac.yaml).
// 환경: BINDING(바인딩 이름) · NAMESPACE · ALERT_WEBHOOK_URL(선택, Alertmanager v2 /api/v2/alerts 형식)
import { readFileSync } from 'node:fs';
import https from 'node:https';

const SA = '/var/run/secrets/kubernetes.io/serviceaccount';
const API = `https://${process.env.KUBERNETES_SERVICE_HOST}:${process.env.KUBERNETES_SERVICE_PORT}`;
const NS = process.env.NAMESPACE ?? readFileSync(`${SA}/namespace`, 'utf8').trim();
const BINDING = process.env.BINDING;
const token = readFileSync(`${SA}/token`, 'utf8').trim();
const ca = readFileSync(`${SA}/ca.crt`);

function kube(method, path, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(`${API}${path}`, { method, ca, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }));
    });
    req.on('error', reject);
    req.setTimeout(10_000, () => req.destroy(new Error('kube API 시간 초과')));
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

const log = (level, msg, extra = {}) => console.log(JSON.stringify({ level, logger: 'break-glass', msg, binding: BINDING, namespace: NS, ...extra, time: new Date().toISOString() }));

async function event(reason, message) {
  const now = new Date().toISOString();
  const res = await kube('POST', `/api/v1/namespaces/${NS}/events`, {
    metadata: { generateName: `${BINDING}.`, namespace: NS },
    involvedObject: { kind: 'RoleBinding', apiVersion: 'rbac.authorization.k8s.io/v1', name: BINDING, namespace: NS },
    reason,
    message,
    type: 'Warning',
    firstTimestamp: now,
    lastTimestamp: now,
    count: 1,
    source: { component: 'break-glass-reaper' },
  });
  if (res.status >= 300) log('error', '이벤트를 남기지 못했다', { status: res.status });
}

async function alert(name, labels, annotations, endsAt) {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify([{ labels: { alertname: name, severity: 'critical', namespace: NS, ...labels }, annotations, startsAt: new Date().toISOString(), ...(endsAt ? { endsAt } : {}) }]),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) log('error', '경보 웹훅 실패', { status: res.status });
  } catch (err) {
    log('error', '경보 웹훅 실패', { error: err.message });
  }
}

const got = await kube('GET', `/apis/rbac.authorization.k8s.io/v1/namespaces/${NS}/rolebindings/${BINDING}`);
if (got.status === 404) {
  log('info', '비상 역할이 꺼져 있다');
  process.exit(0);
}
if (got.status !== 200) {
  log('error', '비상 역할 바인딩을 읽지 못했다', { status: got.status });
  process.exit(1);
}
const a = got.body.metadata.annotations ?? {};
const expiresAt = a['kadmission.kr/break-glass-expires-at'];
const reason = a['kadmission.kr/break-glass-reason'] ?? '';
const group = got.body.subjects?.map((s) => s.name).join(',') ?? '';
const expires = Date.parse(expiresAt ?? '');

// 끝나는 시각이 없거나 읽을 수 없으면 끝난 것으로 본다 — 닫힌 쪽으로
if (!Number.isFinite(expires) || Date.now() >= expires) {
  const del = await kube('DELETE', `/apis/rbac.authorization.k8s.io/v1/namespaces/${NS}/rolebindings/${BINDING}`);
  if (del.status >= 300 && del.status !== 404) {
    log('error', '비상 역할을 회수하지 못했다', { status: del.status });
    await event('BreakGlassRevokeFailed', `비상 역할 회수 실패(${del.status}) — 끝나는 시각 ${expiresAt}`);
    process.exit(1);
  }
  log('warn', '비상 역할 회수 — 끝나는 시각이 지났다', { expiresAt, group });
  await event('BreakGlassRevoked', `끝나는 시각 ${expiresAt} 이 지나 비상 역할을 회수했다(그룹 ${group}, 사유 ${reason})`);
  await alert('BreakGlassRevoked', { group }, { summary: '비상 역할을 회수했다', reason, expiresAt });
  process.exit(0);
}
log('warn', '비상 역할이 켜져 있다', { expiresAt, group, reason });
await event('BreakGlassActive', `비상 역할이 켜져 있다 — 그룹 ${group}, 끝나는 시각 ${expiresAt}, 사유 ${reason}`);
await alert('BreakGlassActive', { group }, { summary: '비상 역할이 켜져 있다', reason, expiresAt }, expiresAt);
