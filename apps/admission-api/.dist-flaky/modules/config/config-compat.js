"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkInFlightCompatibility = checkInFlightCompatibility;
exports.describeCompat = describeCompat;
const ajv_1 = __importDefault(require("ajv"));
const ajv_formats_1 = __importDefault(require("ajv-formats"));
const field_cipher_1 = require("../../common/db/field-cipher");
const STRICT = new Set(['READY', 'PAYMENT_PENDING', 'PAID']);
function withoutRequired(schema) {
    if (Array.isArray(schema))
        return schema.map(withoutRequired);
    if (typeof schema !== 'object' || schema === null)
        return schema;
    const out = {};
    for (const [k, v] of Object.entries(schema))
        if (k !== 'required')
            out[k] = withoutRequired(v);
    return out;
}
async function checkInFlightCompatibility(db, cycleId, config, limit = 20_000) {
    const forms = (config?.forms ?? {});
    const ajv = new ajv_1.default({ allErrors: true, strict: false, coerceTypes: false });
    (0, ajv_formats_1.default)(ajv);
    const compiled = new Map();
    const validators = (code) => {
        if (!compiled.has(code) && forms[code]) {
            compiled.set(code, { full: ajv.compile(forms[code]), lenient: ajv.compile(withoutRequired(forms[code])) });
        }
        return compiled.get(code);
    };
    const { rows } = await db.query(`SELECT a.id, a.status, t.code FROM application a JOIN admission_type t ON t.id = a.admission_type_id
      WHERE a.cycle_id = $1 AND a.status IN ('DRAFT','READY','PAYMENT_PENDING','PAID')
      ORDER BY a.created_at LIMIT $2`, [cycleId, limit]);
    const result = { checked: 0, broken: [] };
    for (const a of rows) {
        const v = validators(a.code);
        if (!v)
            continue; // 이 전형에 추가 양식이 없다
        result.checked++;
        const fields = await (0, field_cipher_1.loadFields)(db, a.id);
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
function describeCompat(r) {
    const byProblem = new Map();
    for (const b of r.broken)
        for (const p of b.problems)
            byProblem.set(`${b.admissionTypeCode} ${p}`, (byProblem.get(`${b.admissionTypeCode} ${p}`) ?? 0) + 1);
    return [...byProblem].map(([p, n]) => `${p} — ${n}건`).join('; ');
}
//# sourceMappingURL=config-compat.js.map