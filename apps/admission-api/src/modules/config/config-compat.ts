import Ajv, { type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import type { Queryable } from '../../common/db/queryable';
import { loadFields } from '../../common/db/field-cipher';

/**
 * 진행 중 원서와의 호환 시험 — 기술설계서 v1.1 §01 A5 "Compatibility Test" (T-M6-02, D-77)
 *
 * Config Linter 는 설정 **자체**가 맞는지 본다(컴파일·항목 이름·서류 코드). 그러나 새 설정이 **이미 쓰고 있는 원서**와
 * 맞는지는 모른다 — 최대 글자 수를 줄이거나 선택지를 빼거나 형식을 바꾸면 저장된 값이 새 양식에 어긋나고,
 * 필수 항목을 더하면 이미 검증·결제를 마친 원서가 접수 확정에서 막힌다(마감 직전이면 지원자가 고칠 시간도 없다).
 *
 * 적용(activate) 직전에 이 주기의 진행 중 원서를 새 양식으로 검사한다. 하나라도 깨지면 적용하지 않는다.
 *   - 작성 중(DRAFT): 저장된 값만 본다 — 아직 안 쓴 필수 항목은 지원자가 채울 수 있다
 *   - 검증 끝·결제 중·결제 완료(READY·PAYMENT_PENDING·PAID): 필수까지 본다 — 이 원서들은 다시 고칠 수 없거나(결제 뒤) 다시 검증을 거쳐야 한다
 * 값은 원서마다 풀어 검사하고 남기지 않는다(필드 암호화, D-70). 결과에는 원서 ID·항목 경로만 담는다.
 */

export interface CompatProblem {
  applicationId: string;
  status: string;
  admissionTypeCode: string;
  problems: string[];
}

export interface CompatResult {
  checked: number;
  broken: CompatProblem[];
}

const STRICT = new Set(['READY', 'PAYMENT_PENDING', 'PAID']);

function withoutRequired(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(withoutRequired);
  if (typeof schema !== 'object' || schema === null) return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) if (k !== 'required') out[k] = withoutRequired(v);
  return out;
}

export async function checkInFlightCompatibility(db: Queryable, cycleId: string, config: unknown, limit = 20_000): Promise<CompatResult> {
  const forms = ((config as { forms?: Record<string, unknown> } | null)?.forms ?? {}) as Record<string, unknown>;
  const ajv = new Ajv({ allErrors: true, strict: false, coerceTypes: false });
  addFormats(ajv);
  const compiled = new Map<string, { full: ValidateFunction; lenient: ValidateFunction }>();
  const validators = (code: string) => {
    if (!compiled.has(code) && forms[code]) {
      compiled.set(code, { full: ajv.compile(forms[code] as object), lenient: ajv.compile(withoutRequired(forms[code]) as object) });
    }
    return compiled.get(code);
  };

  const { rows } = await db.query<{ id: string; status: string; code: string }>(
    `SELECT a.id, a.status, t.code FROM application a JOIN admission_type t ON t.id = a.admission_type_id
      WHERE a.cycle_id = $1 AND a.status IN ('DRAFT','READY','PAYMENT_PENDING','PAID')
      ORDER BY a.created_at LIMIT $2`,
    [cycleId, limit],
  );
  const result: CompatResult = { checked: 0, broken: [] };
  for (const a of rows) {
    const v = validators(a.code);
    if (!v) continue; // 이 전형에 추가 양식이 없다
    result.checked++;
    const fields = await loadFields(db, a.id);
    const validate = STRICT.has(a.status) ? v.full : v.lenient;
    if (!validate(fields)) {
      result.broken.push({
        applicationId: a.id,
        status: a.status,
        admissionTypeCode: a.code,
        problems: (validate.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.keyword}${e.params && 'missingProperty' in e.params ? `(${String(e.params.missingProperty)})` : ''}`),
      });
    }
  }
  return result;
}

/** 승인 화면·거절 문구용 요약 — 항목 경로와 건수만 */
export function describeCompat(r: CompatResult): string {
  const byProblem = new Map<string, number>();
  for (const b of r.broken) for (const p of b.problems) byProblem.set(`${b.admissionTypeCode} ${p}`, (byProblem.get(`${b.admissionTypeCode} ${p}`) ?? 0) + 1);
  return [...byProblem].map(([p, n]) => `${p} — ${n}건`).join('; ');
}
