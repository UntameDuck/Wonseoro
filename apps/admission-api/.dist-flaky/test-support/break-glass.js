"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.breakGlass = breakGlass;
exports.asAdmin = asAdmin;
const pg_1 = require("pg");
/**
 * **시험 전용** — 감사 기록을 고치거나 지우는 유일한 경로. 운영 코드에서 import 하지 않는다.
 *
 * 0004 이후 감사 기록(audit_event · activation_record)은 두 겹으로 막혀 있다 (D-41).
 *   1. 앱 역할(`DATABASE_URL`)에는 UPDATE·DELETE 권한이 없다
 *   2. 트리거가 소유자·슈퍼유저의 평소 경로도 막는다
 *
 * 시험은 두 가지 때문에 이것을 넘어야 한다 — 끝나고 원서를 지우려면 감사 기록이 먼저
 * 없어야 하고(FK), 변조 검출 시험은 변조를 재현해야 한다. 그래서 **슈퍼유저 연결**
 * (`DATABASE_ADMIN_URL`)로 트리거를 일부러 끈다(`session_replication_role = replica`).
 * 운영에서 이 경로가 남는 것이 WORM(M5)이 필요한 이유다.
 *
 * ⚠️ replica 모드는 외래키 검사도 끈다. 지우는 순서를 자식 → 부모로 지킨다.
 */
async function breakGlass(fn) {
    const url = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
    const client = new pg_1.Client({ connectionString: url, options: '-c search_path=kadmission,public' });
    await client.connect();
    try {
        await client.query('BEGIN');
        await client.query(`SET LOCAL session_replication_role = replica`);
        const result = await fn(client);
        // replica 모드는 외래키의 연쇄 삭제도 끈다 — 원서를 지운 시험이 남긴 자식 행(데이터 키·항목 값)을 치운다.
        // 남겨 두면 덤프를 복구할 때 외래키 위반으로 멈춘다(복구 검증 T-M5-62 가 찾았다)
        await client.query(`DELETE FROM kadmission.application_data_key k WHERE NOT EXISTS (SELECT 1 FROM kadmission.application a WHERE a.id = k.application_id)`);
        await client.query(`DELETE FROM kadmission.application_field_value v WHERE NOT EXISTS (SELECT 1 FROM kadmission.application a WHERE a.id = v.application_id)`);
        await client.query('COMMIT');
        return result;
    }
    catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
    }
    finally {
        await client.end().catch(() => undefined);
    }
}
/** 슈퍼유저 연결로 한 문장 — 트리거는 **켠 채로.** "소유자라도 막히는가" 를 확인할 때 쓴다. */
async function asAdmin(sql, params = []) {
    const url = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
    const client = new pg_1.Client({ connectionString: url, options: '-c search_path=kadmission,public' });
    await client.connect();
    try {
        await client.query(sql, params);
    }
    finally {
        await client.end().catch(() => undefined);
    }
}
//# sourceMappingURL=break-glass.js.map