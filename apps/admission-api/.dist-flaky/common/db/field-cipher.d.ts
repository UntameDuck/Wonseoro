import type { Queryable } from './queryable';
export interface FieldRow extends Record<string, unknown> {
    field_code: string;
    value_json: unknown;
    value_ciphertext: Buffer | null;
}
/** SELECT 에 쓰는 열 */
export declare const FIELD_COLUMNS = "field_code, value_json, value_ciphertext";
/** 항목 값을 봉한다 — 원서의 DEK 가 없으면 만든다(같은 트랜잭션 안에서) */
export declare function sealField(db: Queryable, applicationId: string, code: string, value: unknown): Promise<Buffer>;
/** 행들을 값으로 푼다. 키를 쓸 수 없으면 FieldKeyUnavailable — 빈 값으로 대신하지 않는다 */
export declare function openFields(db: Queryable, applicationId: string, rows: readonly FieldRow[]): Promise<Record<string, unknown>>;
/** 원서 항목 전부를 푼다 */
export declare function loadFields(db: Queryable, applicationId: string): Promise<Record<string, unknown>>;
/** 0003 이전 평문 행을 암호문으로 옮긴다. 옮긴 행 수 */
export declare function encryptLegacy(db: Queryable, batch?: number): Promise<number>;
/** 현재 KEK 가 아닌 것으로 감싼 DEK 를 다시 감싼다 */
export declare function rewrapDataKeys(db: Queryable, from?: string, batch?: number): Promise<number>;
export declare function forgetDataKeysForTest(): void;
