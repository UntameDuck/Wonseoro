"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * 원서 항목 암호화 관리 명령 (T-M5-06) — 대학 API 와 같은 환경(DATABASE_URL·UNIVERSITY_ID·FIELD_KEK_KEYS)에서 돌린다.
 *
 *   node dist/tools/field-keys.js status          평문 행 수·KEK 별 DEK 수
 *   node dist/tools/field-keys.js encrypt-legacy  0003 이전 평문 행을 암호문으로(다 옮길 때까지)
 *   node dist/tools/field-keys.js rewrap [KEK]    새 KEK 를 FIELD_KEK_KEYS 맨 앞에 더한 뒤 — 옛 KEK(주면 그것만)로 감싼 DEK 를 다시 감싼다
 *
 * 차트의 Job 이나 `kubectl exec` 로 부른다. 몇 번을 돌려도 결과가 같다.
 */
const common_1 = require("@nestjs/common");
const server_kit_1 = require("@wonseoro/server-kit");
const field_cipher_1 = require("../common/db/field-cipher");
const logger = new common_1.Logger('field-keys');
async function main(cmd, from) {
    const db = new server_kit_1.Db('admission-api');
    try {
        if (cmd === 'encrypt-legacy' || cmd === 'rewrap') {
            let total = 0;
            for (let n = -1; n !== 0; total += n)
                n = cmd === 'rewrap' ? await (0, field_cipher_1.rewrapDataKeys)(db, from) : await (0, field_cipher_1.encryptLegacy)(db);
            logger.log(JSON.stringify({ cmd, changed: total, activeKek: (0, server_kit_1.fieldKeyRing)().activeId }));
        }
        const plaintext = await db.query(`SELECT count(*)::text AS n FROM application_field_value WHERE value_ciphertext IS NULL`);
        const byKek = await db.query(`SELECT kek_version, count(*)::text AS n FROM application_data_key GROUP BY kek_version ORDER BY kek_version`);
        logger.log(JSON.stringify({
            activeKek: (0, server_kit_1.fieldKeyRing)().activeId,
            plaintextFieldRows: Number(plaintext.rows[0]?.n ?? 0),
            dataKeysByKek: Object.fromEntries(byKek.rows.map((r) => [r.kek_version, Number(r.n)])),
        }));
        if (cmd && !['status', 'encrypt-legacy', 'rewrap'].includes(cmd)) {
            logger.error('사용: field-keys status|encrypt-legacy|rewrap');
            return 2;
        }
        return 0;
    }
    finally {
        await db.pool.end();
    }
}
main(process.argv[2], process.argv[3]).then((code) => process.exit(code), (err) => {
    logger.error(`${err.name}: ${err.message}`);
    process.exit(1);
});
//# sourceMappingURL=field-keys.js.map