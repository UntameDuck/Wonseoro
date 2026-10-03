import type { FastifyRequest } from 'fastify';
import { Db } from '@wonseoro/server-kit';
import { Ownership } from '../../common/identity/ownership.service';
import { FormSchemaService } from './form-schema.service';
/**
 * 추가문항 스키마 조회 — 기술설계서 v1.1 §A5
 *
 * 계약: OpenAPI getApplicationFormSchema (D-19). profileFields·documents 는 v1.4.0 에서 더했다 (D-56).
 *
 * **이 API 가 없으면 §A5 가 UI 에서 깨진다.**
 * 백엔드는 Config 만 바꿔 새 전형을 받을 수 있는데, 화면이 필드를 하드코딩하면
 * 전형이 늘 때마다 프론트를 고쳐야 한다. 그러면 "code fork 0" 이 아니다.
 *
 * 원서 단위로 준다. 스키마는 전형 × 활성 Config 버전의 조합이고,
 * 원서는 이미 둘 다 알고 있으므로 클라이언트가 조합을 계산할 필요가 없다.
 */
export declare class FormSchemaController {
    private readonly db;
    private readonly forms;
    private readonly ownership;
    constructor(db: Db, forms: FormSchemaService, ownership: Ownership);
    get(applicationId: string, req: FastifyRequest): Promise<{
        admissionTypeCode: string;
        schemaVersion: string;
        schema: Record<string, unknown>;
        profileFields: string[];
        documents: import("./form-schema.service").DocumentSpec[];
    }>;
}
