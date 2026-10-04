// 개인정보 유출등 통지·신고 판정 게이트 — 개인정보 보호법 제34조, 시행령 제39·40조 (문서 10 G-14, 대장 D-92, 문서 19)
//
// 사용:
//   node scripts/ops/breach-notice-acceptance.mjs --file=<사건 기록 YAML> [--scope=<ops:breach-scope --out 결과>] [--no-write]
//   시작 양식: deploy/pilot/breach-notice.example.yaml (빈 양식은 의도대로 실패한다)
//
// 사람이 채운 사건 기록이 법정 절차를 지켰는지 본다 — 인지 뒤 72시간 안 통지(제39조 ①)·통지 6개 항목(제34조 ① 1~6),
// 확인 못 한 항목의 우선 통지와 추가 통지(제39조 ②), 연락처를 모를 때 홈페이지 30일 이상 게시(제39조 ③),
// 피해 최소화 조치(제34조 ③), 신고 대상(제40조 ① — 1천 명 이상·민감/고유식별·외부 불법 접근)이면 72시간 안 보호위원회 또는
// 한국인터넷진흥원 신고, 신고 생략은 회수·삭제로 권익 침해 가능성이 현저히 낮아진 증적이 있을 때만(제40조 ① 단서).
// 법이 "즉시" 라고만 한 것(지연 사유 해소 뒤)은 숫자를 지어내지 않고 경고로 사람에게 넘긴다.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const HOURS = 72;
export const REPORT_THRESHOLD = 1000;
/** 제34조 ① 1~6 — 7호(대통령령으로 정하는 사항)는 시행령이 정한 것이 있으면 other 에 */
export const NOTICE_ITEMS = ['leakedItems', 'whenAndHow', 'selfProtection', 'responseAndRemedy', 'contactDepartment', 'legalRights'];
/** 확인 못 해도 우선 통지할 수 있는 항목 — 1호(항목)·2호(시점·경위) */
const DEFERRABLE = ['leakedItems', 'whenAndHow'];
const NOTIFY_DELAY = ['urgent-containment', 'force-majeure'];
const REPORT_DELAY = ['force-majeure'];
const AGENCIES = ['PIPC', 'KISA'];
const PLACEHOLDER = /^(?:tbd|todo|미정|입력|없음|n\/a|<.*>)$/iu;
const hasValue = (v) => typeof v === 'string' && v.trim().length > 0 && !PLACEHOLDER.test(v.trim());
const list = (v) => (Array.isArray(v) ? v : []);
const time = (v) => {
  const d = typeof v === 'string' && hasValue(v) ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};
const hoursBetween = (a, b) => (b.getTime() - a.getTime()) / 3_600_000;

/** 신고 대상인가 — 제40조 ① 각 호 */
export function reportReasons(discovery) {
  const r = [];
  if (Number.isInteger(discovery?.scope?.applicants) && discovery.scope.applicants >= REPORT_THRESHOLD) r.push('1천 명 이상');
  if (discovery?.scope?.sensitive === true) r.push('민감정보');
  if (discovery?.scope?.uniqueIdentifier === true) r.push('고유식별정보');
  if (discovery?.externalIntrusion === true) r.push('외부 불법 접근');
  return r;
}

/**
 * 사건 기록의 범위가 범위 산정 결과(ops:breach-scope --out)와 맞는지 — 손으로 옮기다 수를 줄이거나
 * 민감·고유식별 포함을 빠뜨리면 신고 대상을 놓친다. 산정 결과보다 적게 적으면 막는다(더 넓게 적는 것은 괜찮다).
 */
export function compareWithScope(discovery, scope) {
  const out = [];
  const s = discovery?.scope ?? {};
  const applicants = scope?.affected?.applicants;
  if (Number.isInteger(applicants) && Number.isInteger(s.applicants) && s.applicants < applicants) {
    out.push({ at: 'discovery.scope.applicants', message: `범위 산정(${applicants}명)보다 적게 적었다(${s.applicants}명)` });
  }
  const b = scope?.breakdown ?? {};
  if ((b.sensitiveApplications ?? 0) > 0 && s.sensitive !== true) out.push({ at: 'discovery.scope.sensitive', message: `범위 산정에 민감정보 동의 원서 ${b.sensitiveApplications}건이 있는데 민감정보 아님으로 적었다` });
  if (((b.uniqueIdApplications ?? 0) > 0 || (b.residentIdApplicants ?? 0) > 0) && s.uniqueIdentifier !== true) {
    out.push({ at: 'discovery.scope.uniqueIdentifier', message: '범위 산정에 고유식별정보가 있는데 고유식별정보 아님으로 적었다' });
  }
  if (typeof scope?.externalIntrusion === 'boolean' && typeof discovery?.externalIntrusion === 'boolean' && scope.externalIntrusion && !discovery.externalIntrusion) {
    out.push({ at: 'discovery.externalIntrusion', message: '범위 산정 때 외부 불법 접근으로 정했는데 사건 기록은 아니라고 적었다' });
  }
  return out;
}

export function validateBreachNotice(document, scope = null) {
  const blockers = [];
  const warnings = [];
  const block = (at, message) => blockers.push({ at, message });
  const doc = document && typeof document === 'object' ? document : {};
  const need = (v, at, label) => !hasValue(v) && block(at, `${label} 값이 없다`);
  const evidence = (v, at) => list(v).filter(hasValue).length === 0 && block(at, '증적 참조가 없다');

  need(doc.metadata?.universityId, 'metadata.universityId', '대학 ID');
  need(doc.metadata?.incidentId, 'metadata.incidentId', '사건 번호');
  need(doc.metadata?.privacyOfficer, 'metadata.privacyOfficer', '개인정보 보호책임자');

  // ── 인지·범위 ──
  const d = doc.discovery ?? {};
  const discovered = time(d.discoveredAt);
  if (!discovered) block('discovery.discoveredAt', '유출등을 알게 된 시각이 없다 — 72시간은 이 시각부터 센다');
  need(d.route, 'discovery.route', '유출 경로');
  if (typeof d.externalIntrusion !== 'boolean') block('discovery.externalIntrusion', '외부 불법 접근 여부를 정하지 않았다 — 신고 대상 판단에 필요하다');
  if (!Number.isInteger(d.scope?.applicants) || d.scope.applicants < 0) block('discovery.scope.applicants', '영향받은 정보주체 수가 없다(ops:breach-scope 결과)');
  for (const k of ['sensitive', 'uniqueIdentifier']) {
    if (typeof d.scope?.[k] !== 'boolean') block(`discovery.scope.${k}`, `${k === 'sensitive' ? '민감정보' : '고유식별정보'} 포함 여부를 정하지 않았다`);
  }
  evidence(d.scope?.evidence, 'discovery.scope.evidence');
  if (scope) blockers.push(...compareWithScope(d, scope));
  else warnings.push({ at: 'discovery.scope', message: '범위 산정 결과 파일(--scope=)과 대조하지 않았다' });

  // ── 피해 최소화 (제34조 ③) ──
  if (list(doc.containment?.actions).filter(hasValue).length === 0) block('containment.actions', '피해 확산 방지·최소화 조치가 없다(제34조 ③)');
  evidence(doc.containment?.evidence, 'containment.evidence');

  // ── 정보주체 통지 (제34조 ①, 시행령 제39조) ──
  const n = doc.notification ?? {};
  const items = n.items ?? {};
  const pending = DEFERRABLE.filter((k) => items[k] === 'pending');
  for (const k of NOTICE_ITEMS) {
    if (DEFERRABLE.includes(k) && items[k] === 'pending') continue;
    if (!hasValue(items[k])) block(`notification.items.${k}`, '통지 항목이 비어 있다(제34조 ① 각 호)');
  }
  if (pending.length > 0) {
    // 제39조 ② — 확인 못 한 1·2호는 유출 사실·그때까지 확인된 내용과 3~6호를 우선 통지하고, 확인되는 즉시 추가 통지
    need(n.confirmedSoFar, 'notification.confirmedSoFar', '유출 사실과 그때까지 확인된 내용');
    const followed = list(n.followUps).filter((f) => time(f?.at) && list(f?.items).length > 0);
    const covered = new Set(followed.flatMap((f) => f.items));
    for (const k of pending) if (!covered.has(k)) block(`notification.followUps.${k}`, '우선 통지한 뒤 확인된 내용의 추가 통지가 없다(제39조 ②)');
  }
  const sent = time(n.sentAt);
  if (!sent) block('notification.sentAt', '통지한 시각이 없다');
  if (!['written', 'substitute'].includes(n.method)) block('notification.method', '통지 방법은 서면등(written) 또는 홈페이지 게시로 갈음(substitute)이어야 한다');
  if (n.method === 'substitute') {
    need(n.substitute?.reason, 'notification.substitute.reason', '연락처를 알 수 없는 등 갈음 사유');
    const from = time(n.substitute?.postedFrom);
    const until = time(n.substitute?.postedUntil);
    if (!from || !until || hoursBetween(from, until) < 30 * 24) block('notification.substitute', '홈페이지 게시가 30일 이상이 아니다(제39조 ③)');
  } else if (Number.isInteger(n.recipients) && Number.isInteger(d.scope?.applicants) && n.recipients < d.scope.applicants) {
    block('notification.recipients', `통지 받은 정보주체(${n.recipients})가 영향받은 정보주체(${d.scope.applicants})보다 적다 — 나머지는 게시로 갈음했는지 적는다`);
  }
  if (discovered && sent) {
    const h = hoursBetween(discovered, sent);
    if (h < 0) block('notification.sentAt', '통지 시각이 인지 시각보다 앞선다');
    else if (h > HOURS) {
      const delay = n.delay ?? {};
      const resolved = time(delay.resolvedAt);
      if (!NOTIFY_DELAY.includes(delay.reason) || !resolved) {
        block('notification.sentAt', `인지 뒤 ${h.toFixed(1)}시간에 통지했다 — 72시간을 넘긴 사유(긴급 조치·천재지변 등)와 해소 시각이 없다(제39조 ①)`);
      } else {
        warnings.push({ at: 'notification.delay', message: `지연 통지 — 사유 해소 뒤 ${hoursBetween(resolved, sent).toFixed(1)}시간. 법은 "즉시" 라고 한다 — 보호책임자가 확인한다` });
        evidence(delay.evidence, 'notification.delay.evidence');
      }
    }
  }
  evidence(n.evidence, 'notification.evidence');

  // ── 신고 (제34조 ④, 시행령 제40조) ──
  const reasons = reportReasons(d);
  const r = doc.report ?? {};
  if (reasons.length > 0) {
    if (r.status === 'exempted') {
      // 제40조 ① 단서 — 경로가 확인되고 회수·삭제 등으로 권익 침해 가능성이 현저히 낮아진 경우
      need(r.exemption?.reason, 'report.exemption.reason', '신고 생략 사유(회수·삭제로 권익 침해 가능성이 현저히 낮아짐)');
      evidence(r.exemption?.evidence, 'report.exemption.evidence');
      warnings.push({ at: 'report.exemption', message: '신고 생략 — 판단 근거를 보호책임자·법무가 확인한다' });
    } else if (r.status === 'sent') {
      if (!AGENCIES.includes(r.agency)) block('report.agency', '신고처는 개인정보보호위원회(PIPC) 또는 한국인터넷진흥원(KISA)이다');
      const reported = time(r.reportedAt);
      if (!reported) block('report.reportedAt', '신고한 시각이 없다');
      else if (discovered) {
        const h = hoursBetween(discovered, reported);
        if (h > HOURS) {
          if (!REPORT_DELAY.includes(r.delay?.reason) || !time(r.delay?.resolvedAt)) block('report.reportedAt', `인지 뒤 ${h.toFixed(1)}시간에 신고했다 — 72시간을 넘긴 부득이한 사유와 해소 시각이 없다(제40조 ①)`);
          else warnings.push({ at: 'report.delay', message: '지연 신고 — 사유 해소 뒤 즉시였는지 보호책임자가 확인한다' });
        }
      }
      if (pending.length > 0 && list(r.followUps).filter((f) => time(f?.at)).length === 0) block('report.followUps', '확인 못 한 항목이 있으면 우선 신고 뒤 추가 신고가 있어야 한다(제40조 ②)');
      evidence(r.evidence, 'report.evidence');
    } else {
      block('report.status', `신고 대상이다(${reasons.join('·')}) — 신고(sent) 또는 신고 생략 근거(exempted)가 없다`);
    }
  } else if (r.status === 'sent') {
    warnings.push({ at: 'report', message: '신고 대상 기준(제40조 ①)에 해당하지 않지만 신고했다 — 문제는 아니다' });
  }

  if (doc.finalDecision?.status !== 'approved') block('finalDecision.status', '보호책임자 확인이 없다');
  need(doc.finalDecision?.approvedBy, 'finalDecision.approvedBy', '확인자');
  need(doc.finalDecision?.approvedAt, 'finalDecision.approvedAt', '확인 시각');

  const deadline = discovered ? new Date(discovered.getTime() + HOURS * 3_600_000).toISOString() : null;
  return {
    passed: blockers.length === 0,
    blockers,
    warnings,
    summary: {
      applicants: d.scope?.applicants ?? null,
      deadline,
      noticeHours: discovered && sent ? Number(hoursBetween(discovered, sent).toFixed(1)) : null,
      noticeItems: `${NOTICE_ITEMS.filter((k) => hasValue(items[k]) || (DEFERRABLE.includes(k) && items[k] === 'pending')).length}/${NOTICE_ITEMS.length}`,
      reportRequired: reasons.length > 0,
      reportReasons: reasons,
      reportStatus: r.status ?? null,
    },
  };
}

function cli() {
  const fileArg = process.argv.find((a) => a.startsWith('--file='))?.slice('--file='.length);
  if (!fileArg) {
    console.error('사용: node scripts/ops/breach-notice-acceptance.mjs --file=<사건 기록 YAML> [--no-write]');
    process.exit(2);
  }
  const absolute = path.resolve(ROOT, fileArg);
  const document = parse(readFileSync(absolute, 'utf8'));
  const scopeArg = process.argv.find((a) => a.startsWith('--scope='))?.slice('--scope='.length);
  const scope = scopeArg ? JSON.parse(readFileSync(path.resolve(ROOT, scopeArg), 'utf8')) : null;
  const v = validateBreachNotice(document, scope);
  const result = {
    test: '개인정보 유출등 통지·신고 판정 게이트 (제34조, 시행령 제39·40조)',
    at: new Date().toISOString(),
    source: path.relative(ROOT, absolute).replaceAll('\\', '/'),
    incidentId: document?.metadata?.incidentId ?? null,
    ...v,
  };
  console.log(`${result.passed ? '✔' : '✘'} 유출 통지·신고 ${result.incidentId ?? '(사건 번호 없음)'}`);
  console.log(`  정보주체 ${v.summary.applicants ?? '?'}명, 기한 ${v.summary.deadline ?? '?'}, 통지 ${v.summary.noticeHours ?? '?'}시간·항목 ${v.summary.noticeItems}, 신고 ${v.summary.reportRequired ? `대상(${v.summary.reportReasons.join('·')})` : '대상 아님'}`);
  for (const b of v.blockers) console.log(`  - ${b.at}: ${b.message}`);
  for (const w of v.warnings) console.log(`  ! ${w.at}: ${w.message}`);
  if (!process.argv.includes('--no-write')) {
    const dir = path.join(ROOT, 'tests/ops/results');
    mkdirSync(dir, { recursive: true });
    const slug = `${result.incidentId ?? 'unknown'}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '') || 'unknown';
    const out = path.join(dir, `breach-notice-${slug}-${result.at.replace(/[:.]/g, '-')}.json`);
    writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
    console.log(`  결과: ${path.relative(ROOT, out)}`);
  }
  process.exit(result.passed ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) cli();
