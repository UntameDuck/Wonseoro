import { HttpException } from '@nestjs/common';
import { ProblemDetails, ProblemType } from '@wonseoro/contracts';

/**
 * 모든 업무 오류는 이 예외로 던진다. (기술설계서 v1.1 §03)
 * 응답은 application/problem+json 으로 통일된다.
 */
export class ProblemException extends HttpException {
  constructor(readonly problem: ProblemDetails) {
    super(problem, problem.status);
  }

  static validationFailed(detail: string): ProblemException {
    return new ProblemException({
      type: ProblemType.VALIDATION_FAILED,
      title: '요청 값이 올바르지 않습니다',
      status: 400,
      detail,
    });
  }

  static idempotencyKeyRequired(): ProblemException {
    return new ProblemException({
      type: ProblemType.IDEMPOTENCY_KEY_REQUIRED,
      title: 'Idempotency-Key 헤더가 필요합니다',
      status: 400,
      detail: '상태를 변경하는 모든 요청은 Idempotency-Key 를 포함해야 합니다.',
    });
  }

  static idempotencyKeyReused(): ProblemException {
    return new ProblemException({
      type: ProblemType.IDEMPOTENCY_KEY_REUSED,
      title: '같은 Idempotency-Key 로 다른 요청이 들어왔습니다',
      status: 409,
      detail: '이미 사용된 키입니다. 새 요청에는 새 키를 사용하십시오.',
    });
  }

  static versionConflict(detail: string): ProblemException {
    return new ProblemException({
      type: ProblemType.VERSION_CONFLICT,
      title: '다른 곳에서 먼저 수정되었습니다',
      status: 409,
      detail,
    });
  }

  static illegalTransition(from: string, to: string): ProblemException {
    return new ProblemException({
      type: ProblemType.ILLEGAL_TRANSITION,
      title: '허용되지 않은 상태 전이입니다',
      status: 409,
      detail: `${from} → ${to} 전이는 허용되지 않습니다.`,
    });
  }

  /**
   * 마감 관련 오류에는 분쟁 대응을 위해 serverTime·deadlineAt·policyVersion 을 반드시 싣는다.
   * (v1.1 §A2 — "기억"이 아니라 전산증적에 근거해 판정할 수 있어야 한다)
   */
  static deadlinePassed(args: {
    serverTime: string;
    deadlineAt: string;
    policyVersion: string;
  }): ProblemException {
    return new ProblemException({
      type: ProblemType.DEADLINE_PASSED,
      title: '접수 마감 시간이 지났습니다',
      status: 409,
      detail: '서버 시각 기준으로 마감 이후 요청입니다.',
      ...args,
    });
  }

  static retryable(detail: string): ProblemException {
    return new ProblemException({
      type: ProblemType.RETRYABLE,
      title: '일시적인 오류입니다. 다시 시도해 주십시오',
      status: 503,
      detail,
    });
  }
}
