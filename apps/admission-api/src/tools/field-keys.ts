/**
 * 원서 항목 암호화 관리 명령 (T-M5-06) — 대학 API 와 같은 환경(DATABASE_URL·UNIVERSITY_ID·FIELD_KEK_KEYS)에서 돌린다.
 *
 *   node dist/tools/field-keys.js status          평문 행 수·KEK 별 DEK 수
 *   node dist/tools/field-keys.js encrypt-legacy  0003 이전 평문 행을 암호문으로(다 옮길 때까지)
 *   node dist/tools/field-keys.js rewrap [KEK]    새 KEK 를 FIELD_KEK_KEYS 맨 앞에 더한 뒤 — 옛 KEK(주면 그것만)로 감싼 DEK 를 다시 감싼다
 *
 * 차트의 Job 이나 `kubectl exec` 로 부른다. 몇 번을 돌려도 결과가 같다.
 */
import { Db, fieldKeyRing } from '@wonseoro/server-kit';
import { encryptLegacy, rewrapDataKeys } from '../common/db/field-cipher';

async function main(cmd: string | undefined, from: string | undefined): Promise<number> {
  const db = new Db('admission-api');
  try {
    if (cmd === 'encrypt-legacy' || cmd === 'rewrap') {
      let total = 0;
      for (let n = -1; n !== 0; total += n) n = cmd === 'rewrap' ? await rewrapDataKeys(db, from) : await encryptLegacy(db);
      console.log(JSON.stringify({ cmd, changed: total, activeKek: fieldKeyRing().activeId }));
    }
    const plaintext = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM application_field_value WHERE value_ciphertext IS NULL`);
    const byKek = await db.query<{ kek_version: string; n: string }>(
      `SELECT kek_version, count(*)::text AS n FROM application_data_key GROUP BY kek_version ORDER BY kek_version`,
    );
    console.log(
      JSON.stringify({
        activeKek: fieldKeyRing().activeId,
        plaintextFieldRows: Number(plaintext.rows[0]?.n ?? 0),
        dataKeysByKek: Object.fromEntries(byKek.rows.map((r) => [r.kek_version, Number(r.n)])),
      }),
    );
    if (cmd && !['status', 'encrypt-legacy', 'rewrap'].includes(cmd)) {
      console.error('사용: field-keys status|encrypt-legacy|rewrap');
      return 2;
    }
    return 0;
  } finally {
    await db.pool.end();
  }
}

main(process.argv[2], process.argv[3]).then(
  (code) => process.exit(code),
  (err: Error) => {
    console.error(`${err.name}: ${err.message}`);
    process.exit(1);
  },
);
