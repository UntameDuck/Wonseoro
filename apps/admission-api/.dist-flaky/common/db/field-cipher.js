"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FIELD_COLUMNS = void 0;
exports.sealField = sealField;
exports.openFields = openFields;
exports.loadFields = loadFields;
exports.encryptLegacy = encryptLegacy;
exports.rewrapDataKeys = rewrapDataKeys;
exports.forgetDataKeysForTest = forgetDataKeysForTest;
const common_1 = require("@nestjs/common");
const api_1 = require("@opentelemetry/api");
const server_kit_1 = require("@wonseoro/server-kit");
const config_1 = require("../../config");
/**
 * 원서 항목 값 암호화 (T-M5-06, 0003_field_encryption.sql)
 *
 * 원서마다 DEK 하나(application_data_key), 값은 `<원서 ID>:<항목 코드>` 에 묶어 봉한다 — 암호문을 다른 원서·항목으로
 * 옮겨 붙이면 풀리지 않는다. DEK 는 `univ:<대학 ID>:application:<원서 ID>` 에 묶어 감싼다 — 다른 대학 DB 로 옮기면 풀리지 않는다.
 *
 * 0003 이전 평문 행(value_json)은 읽되(지표 `field_plaintext_reads`) 새로 쓰지 않는다. `encryptLegacy` 가 옮긴다.
 */
const keys = new server_kit_1.RecordKeyStore(server_kit_1.fieldKeyRing, {
    table: 'application_data_key',
    idColumn: 'application_id',
    scope: `univ:${config_1.UNIVERSITY_ID}:application`,
});
const plaintextReads = api_1.metrics.getMeter('k-admission.field-crypto').createCounter('field_plaintext_reads', {
    description: '암호화 전(0003 이전) 평문으로 남은 원서 항목을 읽은 횟수 — 0 이 되면 encrypt-legacy 가 끝난 것',
});
const logger = new common_1.Logger('field-cipher');
/** SELECT 에 쓰는 열 */
exports.FIELD_COLUMNS = 'field_code, value_json, value_ciphertext';
/** 항목 값을 봉한다 — 원서의 DEK 가 없으면 만든다(같은 트랜잭션 안에서) */
async function sealField(db, applicationId, code, value) {
    const dek = (await keys.dek(db, applicationId, true));
    return (0, server_kit_1.sealJson)(dek, value ?? null, `${applicationId}:${code}`);
}
/** 행들을 값으로 푼다. 키를 쓸 수 없으면 FieldKeyUnavailable — 빈 값으로 대신하지 않는다 */
async function openFields(db, applicationId, rows) {
    const out = {};
    let dek = null;
    for (const r of rows) {
        if (r.value_ciphertext) {
            dek ??= await keys.dek(db, applicationId, false);
            if (!dek)
                throw new Error(`원서 ${applicationId} 의 데이터 키가 없다`);
            out[r.field_code] = (0, server_kit_1.openJson)(dek, r.value_ciphertext, `${applicationId}:${r.field_code}`);
        }
        else {
            plaintextReads.add(1);
            out[r.field_code] = r.value_json;
        }
    }
    return out;
}
/** 원서 항목 전부를 푼다 */
async function loadFields(db, applicationId) {
    const { rows } = await db.query(`SELECT ${exports.FIELD_COLUMNS} FROM application_field_value WHERE application_id = $1`, [applicationId]);
    return openFields(db, applicationId, rows);
}
/** 0003 이전 평문 행을 암호문으로 옮긴다. 옮긴 행 수 */
async function encryptLegacy(db, batch = 500) {
    const { rows } = await db.query(`SELECT id, application_id, field_code, value_json FROM application_field_value
      WHERE value_ciphertext IS NULL ORDER BY application_id LIMIT $1`, [batch]);
    for (const r of rows) {
        const sealed = await sealField(db, r.application_id, r.field_code, r.value_json);
        await db.query(`UPDATE application_field_value SET value_ciphertext = $2, value_json = NULL WHERE id = $1 AND value_ciphertext IS NULL`, [r.id, sealed]);
    }
    if (rows.length > 0)
        logger.log(`평문 원서 항목 ${rows.length}개를 암호문으로 옮겼다`);
    return rows.length;
}
/** 현재 KEK 가 아닌 것으로 감싼 DEK 를 다시 감싼다 */
function rewrapDataKeys(db, from, batch = 500) {
    return keys.rewrap(db, { batch, ...(from ? { from } : {}) });
}
function forgetDataKeysForTest() {
    keys.forgetForTest();
}
//# sourceMappingURL=field-cipher.js.map