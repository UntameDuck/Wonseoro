/**
 * 공통원서 금고 암호화 관리 명령 (T-M5-06) — 중앙 API 와 같은 환경(DATABASE_URL·FIELD_KEK_KEYS)에서 돌린다.
 *
 *   node dist/tools/field-keys.js status          평문 공통원서 수·KEK 별 수
 *   node dist/tools/field-keys.js encrypt-legacy  0004 이전 평문 공통원서를 암호문으로
 *   node dist/tools/field-keys.js rewrap [KEK]    새 KEK 를 FIELD_KEK_KEYS 맨 앞에 더한 뒤 — 옛 KEK(주면 그것만)로 감싼 DEK 를 다시 감싼다
 */
import { Db, fieldKeyRing } from '@wonseoro/server-kit';
import { ProfileVaultService } from '../modules/profile-vault/profile-vault.service';

async function main(cmd: string | undefined, from: string | undefined): Promise<number> {
  const db = new Db('central-api', 'kadmission_central');
  const vault = new ProfileVaultService(db);
  try {
    if (cmd === 'encrypt-legacy' || cmd === 'rewrap') {
      let total = 0;
      for (let n = -1; n !== 0; total += n) n = cmd === 'rewrap' ? await vault.rewrapKeys(from) : await vault.encryptLegacy();
      console.log(JSON.stringify({ cmd, changed: total, activeKek: fieldKeyRing().activeId }));
    }
    const byKek = await db.query<{ key_version: string; n: string }>(
      `SELECT key_version, count(*)::text AS n FROM kadmission_vault.applicant_profile GROUP BY key_version ORDER BY key_version`,
    );
    console.log(
      JSON.stringify({ activeKek: fieldKeyRing().activeId, profilesByKey: Object.fromEntries(byKek.rows.map((r) => [r.key_version, Number(r.n)])) }),
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
