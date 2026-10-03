import { Db } from '@wonseoro/server-kit';
import { DeadlineService } from '../deadline/deadline.service';
/**
 * GET /api/v1/meta/time
 * canonical: k-admission-openapi.yaml — operationId getServerTime,
 *            응답 스키마 #/components/schemas/ServerTime
 *
 * 클라이언트는 자기 시계로 마감을 계산하지 않는다. (v1.1 §A2)
 * 남은 시간 표시·경고·제출 가능 여부 판단의 기준을 모두 이 응답에서 가져간다.
 */
export declare class MetaController {
    private readonly deadline;
    private readonly db;
    constructor(deadline: DeadlineService, db: Db);
    time(admissionCycleId?: string): Promise<import("../deadline/deadline.service").DeadlineSnapshot>;
}
