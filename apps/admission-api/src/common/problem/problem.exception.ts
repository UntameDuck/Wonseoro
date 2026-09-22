import { HttpException } from '@nestjs/common';
import { ProblemCode, ProblemCodeValue, ProblemDetails, problemType } from '@wonseoro/contracts';

type ProblemInit = Omit<ProblemDetails, 'type' | 'code' | 'traceId'> & {
  code: ProblemCodeValue;
  traceId?: string;
};

/**
 * 모든 업무 오류는 이 예외로 던진다.
 * canonical: k-admission-openapi.yaml #/components/schemas/Problem
 *
 * `code` 와 `traceId` 는 계약상 필수다. traceId 는 필터가 요청에서 채운다.
 */
export class ProblemException extends HttpException {
  readonly problem: ProblemDetails;

  constructor(init: ProblemInit) {
    const problem: ProblemDetails = {
      ...init,
      type: problemType(init.code),
      traceId: init.traceId ?? '',
    };
    super(problem, init.status);
    this.problem = problem;
  }

  static validationFailed(detail: string): ProblemException {
    return new ProblemException({
      code: ProblemCode.VALIDATION_FAILED,
      title: '요청 값이 올바르지 않습니다',
      status: 400,
      detail,
    });
  }

  static idempotencyKeyRequired(): ProblemException {
    return new ProblemException({
      code: ProblemCode.IDEMPOTENCY_KEY_REQUIRED,
      title: 'Idempotency-Key 헤더가 필요합니다',
      status: 400,
      detail: '상태를 변경하는 모든 요청은 Idempotency-Key 를 포함해야 합니다.',
    });
  }

  static idempotencyKeyInvalid(detail: string): ProblemException {
    return new ProblemException({
      code: ProblemCode.IDEMPOTENCY_KEY_INVALID,
      title: 'Idempotency-Key 형식이 올바르지 않습니다',
      status: 400,
      detail,
    });
  }

  static idempotencyKeyReused(): ProblemException {
    return new ProblemException({
      code: ProblemCode.IDEMPOTENCY_KEY_REUSED,
      title: '같은 Idempotency-Key 로 다른 요청이 들어왔습니다',
      status: 409,
      detail: '이미 사용된 키입니다. 새 요청에는 새 키를 사용하십시오.',
    });
  }

  /**
   * If-Match 불일치. OpenAPI updateApplication 이 412 를 명시한다.
   * 409(VERSION_CONFLICT)는 상태 충돌용으로 구분해 쓴다.
   */
  static preconditionFailed(detail: string): ProblemException {
    return new ProblemException({
      code: ProblemCode.VERSION_CONFLICT,
      title: '원서가 이미 수정되었습니다',
      status: 412,
      detail,
    });
  }

  static versionConflict(detail: string): ProblemException {
    return new ProblemException({
      code: ProblemCode.VERSION_CONFLICT,
      title: '다른 곳에서 먼저 수정되었습니다',
      status: 409,
      detail,
    });
  }

  static illegalTransition(from: string, to: string): ProblemException {
    return new ProblemException({
      code: ProblemCode.ILLEGAL_TRANSITION,
      title: '허용되지 않은 상태 전이입니다',
      status: 409,
      detail: `${from} → ${to} 전이는 허용되지 않습니다.`,
    });
  }

  static alreadyFinalized(): ProblemException {
    return new ProblemException({
      code: ProblemCode.ALREADY_FINALIZED,
      title: '이미 접수가 완료된 원서입니다',
      status: 409,
      detail: '접수 완료 후에는 원서를 변경할 수 없습니다.',
    });
  }

  /**
   * 마감 관련 오류에는 분쟁 대응을 위해
   * serverTime · deadlineAt · deadlinePolicyVersion 을 반드시 싣는다. (v1.1 §A2)
   */
  static deadlinePassed(args: {
    serverTime: string;
    deadlineAt: string;
    deadlinePolicyVersion: string;
  }): ProblemException {
    return new ProblemException({
      code: ProblemCode.DEADLINE_PASSED,
      title: '접수 마감 시간이 지났습니다',
      status: 409,
      detail: '서버 시각 기준으로 마감 이후 요청입니다.',
      ...args,
    });
  }

  /** 결제가 서버 재검증을 통과하지 않았다. CONFIRMED 만 Finalize 에 쓸 수 있다. */
  static paymentNotConfirmed(): ProblemException {
    return new ProblemException({
      code: ProblemCode.PAYMENT_NOT_CONFIRMED,
      title: '결제가 확인되지 않았습니다',
      status: 409,
      detail:
        '결제 확인이 끝나야 접수가 완료됩니다. 이미 결제하셨다면 잠시 후 상태를 다시 확인해 주십시오.',
    });
  }

  /** 결제 상태를 PG 에서 확인하지 못했다. 재결제를 유도하지 않는다. (v1.1 §B4) */
  static paymentStateUnknown(): ProblemException {
    return new ProblemException({
      code: ProblemCode.PAYMENT_STATE_UNKNOWN,
      title: '결제 상태를 확인하는 중입니다',
      status: 202,
      detail:
        '결제사 응답을 확인하는 중입니다. 다시 결제하지 마시고 잠시 후 상태를 확인해 주십시오.',
    });
  }

  static documentNotAvailable(detail: string): ProblemException {
    return new ProblemException({
      code: ProblemCode.DOCUMENT_NOT_AVAILABLE,
      title: '서류 검사가 완료되지 않았습니다',
      status: 409,
      detail,
    });
  }

  /** 업무 검증 실패. OpenAPI finalizeApplication 이 422 를 명시한다. */
  static unprocessable(detail: string): ProblemException {
    return new ProblemException({
      code: ProblemCode.VALIDATION_FAILED,
      title: '원서를 접수할 수 없습니다',
      status: 422,
      detail,
    });
  }

  /** 권한·절차 위반. 2인 승인 규칙 위반이 여기로 온다. */
  static forbidden(detail: string): ProblemException {
    return new ProblemException({
      code: ProblemCode.FORBIDDEN,
      title: '허용되지 않은 요청입니다',
      status: 403,
      detail,
    });
  }

  static retryable(detail: string): ProblemException {
    return new ProblemException({
      code: ProblemCode.RETRYABLE,
      title: '일시적인 오류입니다. 다시 시도해 주십시오',
      status: 503,
      detail,
    });
  }
}
