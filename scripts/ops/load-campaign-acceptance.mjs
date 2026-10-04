// 외부 M Profile 부하 캠페인 종료 게이트 — T-M4-30·31·32·36·41
//
// 사용:
//   node scripts/ops/load-campaign-acceptance.mjs --file=deploy/pilot/<대학>-load-campaign.yaml
//
// 개별 ops:load-acceptance 결과 5개를 다시 읽어 같은 승인 환경·필수 인원·최소 실행시간,
// Failover writer epoch, Soak 자원 추세를 한 번에 판정한다. D-90 Finalize TPS는 포함하지 않는다.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const PROFILE_SPECS = {
  'baseline-500': { users: 500, minDurationMs: 29 * 60_000 },
  'expected-1500': { users: 1500, minDurationMs: 29 * 60_000 },
  'deadline-3000-rps1000': { users: 3000, minDurationMs: 19 * 60_000 },
  'failover-70': { users: 1050, minDurationMs: 29 * 60_000, writerEpoch: true },
  'soak-6h': { minUsers: 1, maxUsers: 1500, minDurationMs: 5 * 60 * 60_000 + 58 * 60_000 },
};
export const RESOURCE_TRENDS = ['api-memory', 'db-connections', 'pool-wait', 'outbox-lag', 'central-lag'];
const PLACEHOLDER = /^(?:tbd|todo|미정|입력|없음|n\/a|<.*>)$/iu;
const hasValue = (value) => typeof value === 'string' && value.trim().length > 0 && !PLACEHOLDER.test(value.trim());
const list = (value) => (Array.isArray(value) ? value : []);

function requireValue(blockers, value, at, label = at) {
  if (!hasValue(value)) blockers.push({ at, message: `${label} 값이 없다` });
}
function requireEvidence(blockers, value, at) {
  if (list(value).filter(hasValue).length === 0) blockers.push({ at, message: '실행 증적 참조가 없다' });
}

export function validateLoadCampaign(document, results) {
  const blockers = [];
  const doc = document && typeof document === 'object' ? document : {};
  requireValue(blockers, doc.metadata?.universityId, 'metadata.universityId', '대학 ID');
  requireValue(blockers, doc.metadata?.environmentId, 'metadata.environmentId', '환경 ID');
  requireValue(blockers, doc.metadata?.approval, 'metadata.approval', '승인 참조');
  requireValue(blockers, doc.metadata?.approvedAt, 'metadata.approvedAt', '승인 시각');
  requireValue(blockers, doc.metadata?.executedBy, 'metadata.executedBy', '실행 책임자');
  requireEvidence(blockers, doc.metadata?.evidence, 'metadata.evidence');
  if (doc.metadata?.environmentType !== 'csp-load-staging') blockers.push({ at: 'metadata.environmentType', message: '환경 유형은 csp-load-staging이어야 한다' });
  if (/kind|local|docker/iu.test(doc.metadata?.environmentId ?? '')) blockers.push({ at: 'metadata.environmentId', message: '로컬·kind 결과는 외부 M Profile 증적이 아니다' });

  const rows = list(doc.results);
  for (const [profile, spec] of Object.entries(PROFILE_SPECS)) {
    const matching = rows.filter((row) => row?.id === profile);
    const at = `results.${profile}`;
    if (matching.length === 0) {
      blockers.push({ at, message: '필수 프로필 결과가 없다' });
      continue;
    }
    if (matching.length > 1) blockers.push({ at, message: '같은 프로필이 두 번 이상 있다' });
    const result = results?.[profile];
    if (!result) {
      blockers.push({ at: `${at}.file`, message: '결과 파일을 읽지 못했다' });
      continue;
    }
    if (result.profile !== profile) blockers.push({ at: `${at}.profile`, message: '결과 내부 프로필이 다르다' });
    if (result.passed !== true || list(result.blockers).length !== 0) blockers.push({ at: `${at}.passed`, message: '개별 k6+DB 판정이 통과하지 않았다' });
    if (result.execution?.environment !== doc.metadata?.environmentId) blockers.push({ at: `${at}.environment`, message: '캠페인 환경과 결과 환경이 다르다' });
    if (result.execution?.approval !== doc.metadata?.approval) blockers.push({ at: `${at}.approval`, message: '캠페인 승인과 결과 승인이 다르다' });
    const users = result.testSet?.users;
    if (spec.users !== undefined && users !== spec.users) blockers.push({ at: `${at}.users`, message: `합성 사용자 ${spec.users}명이 아니다` });
    if (spec.minUsers !== undefined && (!Number.isInteger(users) || users < spec.minUsers || users > spec.maxUsers)) blockers.push({ at: `${at}.users`, message: `승인 가능한 합성 사용자 ${spec.minUsers}~${spec.maxUsers}명 범위가 아니다` });
    if (!Number.isFinite(result.execution?.durationMs) || result.execution.durationMs < spec.minDurationMs) blockers.push({ at: `${at}.durationMs`, message: '프로필 최소 실행시간에 못 미친다' });
    if (spec.writerEpoch && !list(result.database?.checks).some((item) => item?.id === 'writerEpoch' && item?.passed === true)) {
      blockers.push({ at: `${at}.writerEpoch`, message: 'Failover 뒤 Writer 세대 일치 판정이 없다' });
    }
  }
  for (const row of rows) if (!Object.hasOwn(PROFILE_SPECS, row?.id)) blockers.push({ at: `results.${row?.id ?? '?'}`, message: '알 수 없는 프로필 ID다' });

  const trends = list(doc.resourceTrends);
  for (const id of RESOURCE_TRENDS) {
    const matching = trends.filter((row) => row?.id === id);
    const at = `resourceTrends.${id}`;
    if (matching.length === 0) {
      blockers.push({ at, message: '필수 자원 추세 판정이 없다' });
      continue;
    }
    if (matching.length > 1) blockers.push({ at, message: '같은 자원 추세가 두 번 이상 있다' });
    const row = matching[0];
    if (row.verdict !== 'within-capacity') blockers.push({ at: `${at}.verdict`, message: '승인 용량 안이라는 판정이 없다' });
    requireValue(blockers, row.observed, `${at}.observed`, '관찰 결과');
    requireValue(blockers, row.approvedBy, `${at}.approvedBy`, '판정 승인자');
    requireEvidence(blockers, row.evidence, `${at}.evidence`);
  }
  if (doc.finalDecision?.status !== 'approved') blockers.push({ at: 'finalDecision.status', message: '캠페인 최종 승인이 없다' });
  requireValue(blockers, doc.finalDecision?.approvedAt, 'finalDecision.approvedAt', '최종 승인 시각');
  requireValue(blockers, doc.finalDecision?.approvedBy, 'finalDecision.approvedBy', '최종 승인자');
  requireEvidence(blockers, doc.finalDecision?.evidence, 'finalDecision.evidence');

  return {
    passed: blockers.length === 0,
    blockers,
    summary: {
      profiles: `${Object.keys(PROFILE_SPECS).filter((id) => results?.[id]?.passed === true).length}/${Object.keys(PROFILE_SPECS).length}`,
      resourceTrends: `${RESOURCE_TRENDS.filter((id) => trends.some((row) => row?.id === id && row?.verdict === 'within-capacity')).length}/${RESOURCE_TRENDS.length}`,
    },
  };
}

function cli() {
  const fileArg = process.argv.find((arg) => arg.startsWith('--file='))?.slice('--file='.length);
  if (!fileArg) {
    console.error('사용: node scripts/ops/load-campaign-acceptance.mjs --file=deploy/pilot/<대학>-load-campaign.yaml [--no-write]');
    process.exit(2);
  }
  const absolute = path.resolve(ROOT, fileArg);
  const document = parse(readFileSync(absolute, 'utf8'));
  const results = {};
  for (const row of list(document?.results)) {
    if (!hasValue(row?.file) || !Object.hasOwn(PROFILE_SPECS, row.id)) continue;
    try { results[row.id] = JSON.parse(readFileSync(path.resolve(ROOT, row.file), 'utf8')); } catch { /* validator reports unreadable */ }
  }
  const validation = validateLoadCampaign(document, results);
  const result = {
    test: '외부 M Profile 부하 캠페인 종료 게이트 (T-M4-30·31·32·36·41)',
    at: new Date().toISOString(),
    source: path.relative(ROOT, absolute).replaceAll('\\', '/'),
    universityId: document?.metadata?.universityId ?? null,
    environmentId: document?.metadata?.environmentId ?? null,
    ...validation,
  };
  console.log(`${result.passed ? '✔' : '✘'} M Profile 부하 캠페인 ${result.universityId ?? '(대학 없음)'} / ${result.environmentId ?? '(환경 없음)'}`);
  console.log(`  프로필 ${result.summary.profiles}, 자원 추세 ${result.summary.resourceTrends}`);
  for (const blocker of result.blockers) console.log(`  - ${blocker.at}: ${blocker.message}`);
  if (!process.argv.includes('--no-write')) {
    const dir = path.join(ROOT, 'tests/load/results');
    mkdirSync(dir, { recursive: true });
    const slug = `${result.universityId ?? 'unknown'}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '') || 'unknown';
    const stamp = result.at.replace(/[:.]/g, '-');
    const out = path.join(dir, `load-campaign-acceptance-${slug}-${stamp}.json`);
    writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
    console.log(`  결과: ${path.relative(ROOT, out)}`);
  }
  process.exit(result.passed ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) cli();
