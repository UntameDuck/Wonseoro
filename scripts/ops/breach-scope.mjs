// 개인정보 유출등 범위 산정 — 개인정보 보호법 제34조, 시행령 제39·40조 (문서 10 G-14, 대장 D-92, 문서 19)
//
// 사용 (대학 DB 를 읽기 전용 감사 계정으로 — kadmission_auditor):
//   DATABASE_URL=… node scripts/ops/breach-scope.mjs --actor=<계정 ID> --from=<시각> --to=<시각>   계정 탈취·내부자: 그 계정이 개인정보를 연 원서
//   DATABASE_URL=… node scripts/ops/breach-scope.mjs --all --at=<시각>                          DB·백업 유출: 그 시각에 있던 모든 원서
//   선택: --discovered-at=<인지 시각>(통지·신고 기한 계산) --list(원서 ID 목록 포함) --out=<파일>
//
// 결과에는 개인정보가 없다 — 수와 분류, 기한만(원서 ID 는 --list 일 때만). 통지 대상 연락처는 입학처가 콘솔·업무 절차로 꺼낸다.
// 신고 대상 판단(시행령 제40조 ①): 1천 명 이상 · 민감정보 또는 고유식별정보 · 외부 불법 접근 — 셋째는 DB 로 알 수 없어 사람이 정한다.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const NOTICE_HOURS = 72;
export const REPORT_THRESHOLD = 1000;
/** 담당자가 개인정보 원문을 연 감사 동작 — 상담 조회(SUPPORT_LOOKUP)는 허용 목록 응답이라 원문이 아니다(따로 센다) */
export const PII_VIEW_ACTIONS = ['ADMIN_VIEWED_PII'];

/** 전형 설정에서 별도 동의 코드를 꺼낸다 — sensitiveDocuments 값은 민감정보, x-sensitive-consent 는 고유식별정보(여권번호 등) */
export function sensitiveConsentCodes(configs) {
  const sensitive = new Set();
  const uniqueId = new Set();
  const walk = (v) => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) return v.forEach(walk);
    for (const [k, x] of Object.entries(v)) {
      if (k === 'sensitiveDocuments' && x && typeof x === 'object' && !Array.isArray(x)) {
        for (const code of Object.values(x)) if (typeof code === 'string') sensitive.add(code);
      } else if (k === 'x-sensitive-consent' && typeof x === 'string') uniqueId.add(x);
      walk(x);
    }
  };
  for (const c of configs) walk(c);
  return { sensitive: [...sensitive].sort(), uniqueId: [...uniqueId].sort() };
}

/**
 * 산정 결과 → 통지·신고 판단. externalIntrusion 은 사람이 정한 값(true/false/null=미정).
 * 통지는 유출등이면 언제나(제34조 ①), 기한은 인지 뒤 72시간(시행령 제39조 ①).
 */
export function assess({ applicants, applications, sensitiveApplications, uniqueIdApplications, residentIdApplicants, externalIntrusion = null, discoveredAt = null }) {
  const reasons = [];
  if (applicants >= REPORT_THRESHOLD) reasons.push(`정보주체 ${applicants}명 — 1천 명 이상(시행령 제40조 ① 1)`);
  if (sensitiveApplications > 0) reasons.push(`민감정보 별도 동의 원서 ${sensitiveApplications}건(시행령 제40조 ① 2)`);
  if (uniqueIdApplications > 0 || residentIdApplicants > 0) {
    reasons.push(`고유식별정보 — 별도 동의 항목 원서 ${uniqueIdApplications}건·주민등록번호 저장 지원자 ${residentIdApplicants}명(시행령 제40조 ① 2)`);
  }
  if (externalIntrusion === true) reasons.push('외부로부터의 불법적인 접근(시행령 제40조 ① 3)');
  const deadline = discoveredAt ? new Date(new Date(discoveredAt).getTime() + NOTICE_HOURS * 3_600_000).toISOString() : null;
  return {
    affected: { applicants, applications },
    notifyRequired: applicants > 0,
    notifyDeadline: deadline,
    reportRequired: reasons.length > 0 ? true : externalIntrusion === null ? 'undecided' : false,
    reportReasons: reasons,
    reportDeadline: reasons.length > 0 || externalIntrusion === null ? deadline : null,
    pending: externalIntrusion === null ? ['외부 불법 접근 여부를 정해야 신고 대상인지 확정된다(--external=yes|no)'] : [],
  };
}

async function query(db, mode) {
  const configs = (await db.query(`SELECT config_json FROM kadmission.config_version WHERE status IN ('ACTIVE','RETIRED','APPROVED')`)).rows.map((r) => r.config_json);
  const codes = sensitiveConsentCodes(configs);
  // 영향받은 원서 집합 — 계정 모드는 그 계정이 원문을 연 원서, 전체 모드는 그 시각에 있던 원서
  const scope =
    mode.kind === 'actor'
      ? {
          sql: `SELECT DISTINCT application_id AS id FROM kadmission.audit_event
                 WHERE actor_id = $1 AND occurred_at >= $2 AND occurred_at <= $3 AND action = ANY($4) AND result = 'ACCEPTED' AND application_id IS NOT NULL`,
          params: [mode.actor, mode.from, mode.to, PII_VIEW_ACTIONS],
        }
      : { sql: `SELECT id FROM kadmission.application WHERE created_at <= $1`, params: [mode.at] };
  const { rows } = await db.query(
    `WITH s AS (${scope.sql})
     SELECT count(DISTINCT a.id)::int AS applications,
            count(DISTINCT a.applicant_id)::int AS applicants,
            count(DISTINCT a.id) FILTER (WHERE EXISTS (SELECT 1 FROM kadmission.consent_record c WHERE c.application_id = a.id AND c.granted AND c.consent_code = ANY($${scope.params.length + 1})))::int AS sensitive,
            count(DISTINCT a.id) FILTER (WHERE EXISTS (SELECT 1 FROM kadmission.consent_record c WHERE c.application_id = a.id AND c.granted AND c.consent_code = ANY($${scope.params.length + 2})))::int AS unique_id,
            count(DISTINCT a.applicant_id) FILTER (WHERE p.pii_key_version IS DISTINCT FROM 'none' AND p.pii_ciphertext IS NOT NULL AND length(p.pii_ciphertext) > 1)::int AS resident_id,
            coalesce(array_agg(DISTINCT a.id::text) FILTER (WHERE a.id IS NOT NULL), '{}') AS ids
       FROM s JOIN kadmission.application a ON a.id = s.id
       LEFT JOIN kadmission.applicant p ON p.id = a.applicant_id`,
    [...scope.params, codes.sensitive, codes.uniqueId],
  );
  const support =
    mode.kind === 'actor'
      ? (await db.query(`SELECT count(*)::int AS n FROM kadmission.audit_event WHERE actor_id = $1 AND occurred_at >= $2 AND occurred_at <= $3 AND action = 'SUPPORT_LOOKUP'`, [mode.actor, mode.from, mode.to])).rows[0].n
      : null;
  // 그 계정의 권한 부여·변경·말소 기록(G-15, D-91) — 감사 기록의 담당자 ID 는 로그인 이름(없으면 계정 ID)이다.
  // 언제부터 어떤 권한으로 열 수 있었는지가 유출 시점·경위(통지 2호)의 근거가 된다. 0011 이 없는 DB 면 건너뛴다
  let grants = null;
  if (mode.kind === 'actor') {
    try {
      grants = (
        await db.query(
          `SELECT seq::int, to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS at, action, change_kind AS kind, roles, actor
             FROM kadmission.access_grant_log
            WHERE subject = $1 OR subject IN (SELECT subject FROM kadmission.access_grant_log WHERE details->>'username' = $1)
            ORDER BY seq`,
          [mode.actor],
        )
      ).rows;
    } catch {
      grants = null;
    }
  }
  return { row: rows[0], codes, support, grants };
}

function arg(name) {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}
function iso(value, label) {
  const d = new Date(value ?? '');
  if (!value || Number.isNaN(d.getTime())) {
    console.error(`${label} 시각이 올바르지 않다: ${value ?? '(없음)'}`);
    process.exit(2);
  }
  return d.toISOString();
}

async function cli() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL 이 필요하다 — 대학 DB 를 읽기 전용 감사 계정으로');
    process.exit(2);
  }
  const all = process.argv.includes('--all');
  const actor = arg('actor');
  if (!all && !actor) {
    console.error('사용: breach-scope --actor=<계정 ID> --from=<시각> --to=<시각> | --all --at=<시각> [--discovered-at=<시각>] [--external=yes|no] [--list] [--out=<파일>]');
    process.exit(2);
  }
  const mode = all ? { kind: 'all', at: iso(arg('at'), '--at') } : { kind: 'actor', actor, from: iso(arg('from'), '--from'), to: iso(arg('to'), '--to') };
  const ext = arg('external');
  const externalIntrusion = ext === 'yes' ? true : ext === 'no' ? false : null;
  const discoveredAt = arg('discovered-at') ? iso(arg('discovered-at'), '--discovered-at') : null;

  const { default: pg } = await import('pg');
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    const { row, codes, support, grants } = await query(db, mode);
    const decision = assess({
      applicants: row.applicants,
      applications: row.applications,
      sensitiveApplications: row.sensitive,
      uniqueIdApplications: row.unique_id,
      residentIdApplicants: row.resident_id,
      externalIntrusion,
      discoveredAt,
    });
    const result = {
      test: '개인정보 유출등 범위 산정 (제34조, 시행령 제39·40조)',
      at: new Date().toISOString(),
      mode,
      sensitiveConsentCodes: codes,
      breakdown: {
        sensitiveApplications: row.sensitive,
        uniqueIdApplications: row.unique_id,
        residentIdApplicants: row.resident_id,
        supportLookups: support,
      },
      externalIntrusion,
      discoveredAt,
      ...(grants ? { accessGrants: grants } : {}),
      ...decision,
      ...(process.argv.includes('--list') ? { applicationIds: row.ids } : {}),
    };
    console.log(`영향 정보주체 ${row.applicants}명 · 원서 ${row.applications}건 (민감 ${row.sensitive} · 고유식별 항목 ${row.unique_id} · 주민번호 저장 ${row.resident_id})`);
    console.log(`통지 ${decision.notifyRequired ? `필요 — 기한 ${decision.notifyDeadline ?? '(인지 시각을 넣으면 계산)'}` : '대상 없음'}`);
    if (grants) console.log(`권한 변경 기록 ${grants.length}줄${grants.length ? ` — 처음 ${grants[0].at} ${grants[0].kind}, 마지막 ${grants.at(-1).at} ${grants.at(-1).kind} [${grants.at(-1).roles.join(', ')}]` : ' — 로그인 서버 계정과 이어지지 않는다(로그인 이름 확인)'}`);
    console.log(`신고 ${decision.reportRequired === true ? `필요 — ${decision.reportReasons.join(' / ')}` : decision.reportRequired === false ? '기준 해당 없음' : '미정 — 외부 불법 접근 여부를 정한다'}`);
    const out = arg('out');
    if (out) {
      writeFileSync(path.resolve(ROOT, out), `${JSON.stringify(result, null, 2)}\n`);
      console.log(`결과: ${out}`);
    } else console.log(JSON.stringify(result, null, 2));
  } finally {
    await db.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().catch((err) => {
    console.error(`${err.name}: ${err.message}`);
    process.exit(1);
  });
}
