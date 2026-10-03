import { Db } from '@wonseoro/server-kit';
/**
 * 모집 카탈로그 — canonical: k-admission-openapi.yaml
 *   getCurrentCycle / listAdmissionTypes / listDepartments
 *
 * 조회성 트래픽이라 중앙에서 Cache 해도 되는 대상이지만 (v1.1 §10 §10),
 * **원본은 대학이 제공한다.** 중앙 검색이 죽어도 대학 직접 URL 로 접수할 수 있어야 하므로
 * 이 경로는 대학 Data Plane 에 있다. (v1.1 §10 §1)
 */
export declare class CatalogController {
    private readonly db;
    constructor(db: Db);
    currentCycle(): Promise<{
        id: string;
        universityId: string;
        universityName: string;
        admissionYear: number;
        name: string;
        opensAt: string;
        closesAt: string;
        status: string;
    }>;
    admissionTypes(cycleId?: string): Promise<{
        id: string;
        code: string;
        name: string;
        feeAmount: number;
    }[]>;
    departments(cycleId?: string): Promise<{
        id: string;
        code: string;
        name: string;
        quota: number | null;
    }[]>;
}
