import { DeadlinePolicy } from '@wonseoro/contracts';

/**
 * Deadline Policy 조회 포트. (v1.1 §A2)
 *
 * ⚠️ 마감 시각을 코드 상수로 박지 않는다.
 * M1 에서는 설정에서 읽는 정적 구현을 쓰고,
 * M3 에서 서명된 정책 버전 + 2인 승인 엔진으로 교체한다.
 * 그때 이 포트의 구현체만 갈아끼우면 호출부는 바뀌지 않는다.
 */
export abstract class DeadlinePolicyPort {
  abstract current(admissionCycleId: string): Promise<DeadlinePolicy>;
}
