import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { describe, it } from 'node:test';
import { FieldKeyUnavailable, LocalKeyRing, RecordKeyStore, openJson, sealJson, type Queryable } from './field-crypto';

const key = () => randomBytes(32);
const unavailable = (reason: string) => (e: unknown) => e instanceof FieldKeyUnavailable && e.reason === reason;

/** DEK 표 하나를 흉내 내는 메모리 DB — RecordKeyStore 가 쓰는 SQL 넷만 */
function memoryDb() {
  const rows = new Map<string, { kek_version: string; wrapped_dek: Buffer }>();
  const db: Queryable = {
    async query(text: string, params: unknown[] = []) {
      const [a, b, c, d] = params as [string, string, Buffer, string];
      if (text.startsWith('SELECT kek_version')) return { rows: rows.has(a) ? [rows.get(a)] : [] } as never;
      if (text.startsWith('INSERT')) {
        if (!rows.has(a)) rows.set(a, { kek_version: b, wrapped_dek: c });
        return { rows: [] };
      }
      if (text.startsWith('SELECT')) {
        const from = params[2] as string | null;
        return { rows: [...rows].filter(([, r]) => r.kek_version !== a && (!from || r.kek_version === from)).map(([id, r]) => ({ id, ...r })) } as never;
      }
      if (text.startsWith('UPDATE') && rows.get(a)?.kek_version === d) rows.set(a, { kek_version: b, wrapped_dek: c });
      return { rows: [] };
    },
  };
  return { db, rows };
}

describe('필드 암호화 — 봉투 (T-M5-06)', () => {
  it('값은 DEK 로 봉하고, 다른 레코드·항목의 연결 데이터로는 풀리지 않는다', () => {
    const dek = key();
    const blob = sealJson(dek, { phone: '010-1234-5678' }, 'app-1:phone');
    assert.equal(blob.includes(Buffer.from('010-1234-5678')), false, '암호문에 평문이 없다');
    assert.deepEqual(openJson(dek, blob, 'app-1:phone'), { phone: '010-1234-5678' });
    assert.throws(() => openJson(dek, blob, 'app-2:phone'), unavailable('decrypt-failed'), '다른 원서로 옮겨 붙이기');
    assert.throws(() => openJson(dek, blob, 'app-1:contactEmail'), unavailable('decrypt-failed'), '다른 항목으로 옮겨 붙이기');
    assert.throws(() => openJson(key(), blob, 'app-1:phone'), unavailable('decrypt-failed'), '다른 DEK');
    const tampered = Buffer.from(blob);
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] as number) ^ 1;
    assert.throws(() => openJson(dek, tampered, 'app-1:phone'), unavailable('decrypt-failed'), '한 비트 변조');
  });

  it('키 묶음 — 첫 번째가 현재 KEK, 형식이 틀리면 거절', () => {
    const r = LocalKeyRing.parse(`k2=${key().toString('base64')}, k1=${key().toString('base64')}`);
    assert.equal(r.activeId, 'k2');
    assert.deepEqual(r.ids(), ['k2', 'k1']);
    assert.throws(() => LocalKeyRing.parse('k1=c2hvcnQ='), /32바이트/);
    assert.throws(() => LocalKeyRing.parse(`k1=${key().toString('base64')},k1=${key().toString('base64')}`), /겹친다/);
    assert.throws(() => LocalKeyRing.parse(''), /하나도/);
  });

  it('KEK 교체 — 옛 레코드는 옛 KEK 로 읽히고, rewrap 뒤에는 옛 KEK 없이 읽힌다', async () => {
    const k1 = { id: 'k1', key: key() };
    const k2 = { id: 'k2', key: key() };
    let ring = new LocalKeyRing([k1]);
    const store = new RecordKeyStore(() => ring, { table: 't', idColumn: 'id', scope: 'univ:A:application', ttlMs: 0 });
    const { db, rows } = memoryDb();

    const dek = (await store.dek(db, 'app-1', true)) as Buffer;
    const blob = sealJson(dek, '서울고등학교', 'app-1:highSchool');
    assert.equal(rows.get('app-1')?.kek_version, 'k1');
    assert.equal(await store.dek(db, 'app-없음', false), null, '읽기는 DEK 를 만들지 않는다');

    ring = new LocalKeyRing([k2, k1]); // 새 KEK 를 앞에
    assert.equal(openJson((await store.dek(db, 'app-1', false)) as Buffer, blob, 'app-1:highSchool'), '서울고등학교');
    await store.dek(db, 'app-2', true);
    assert.equal(rows.get('app-2')?.kek_version, 'k2', '새 레코드는 새 KEK');

    assert.equal(await store.rewrap(db), 1);
    assert.equal(rows.get('app-1')?.kek_version, 'k2');
    ring = new LocalKeyRing([k2]); // 옛 KEK 를 뺀다
    assert.equal(openJson((await store.dek(db, 'app-1', false)) as Buffer, blob, 'app-1:highSchool'), '서울고등학교');
  });

  it('닫힌 실패 — KEK 가 없거나 다른 대학 범위면 풀지 않는다', async () => {
    const k1 = { id: 'k1', key: key() };
    let ring = new LocalKeyRing([k1]);
    const a = new RecordKeyStore(() => ring, { table: 't', idColumn: 'id', scope: 'univ:A:application', ttlMs: 0 });
    const { db } = memoryDb();
    await a.dek(db, 'app-1', true);

    const b = new RecordKeyStore(() => ring, { table: 't', idColumn: 'id', scope: 'univ:B:application', ttlMs: 0 });
    await assert.rejects(b.dek(db, 'app-1', false), unavailable('unwrap-failed'), 'A 대학 DB 의 키를 B 대학이 풀기');

    ring = new LocalKeyRing([{ id: 'k9', key: key() }]);
    await assert.rejects(a.dek(db, 'app-1', false), unavailable('unknown-kek'));
  });
});
