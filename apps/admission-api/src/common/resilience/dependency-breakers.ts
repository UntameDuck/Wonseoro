import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { CircuitBreaker, CircuitSnapshot, CircuitStateChange } from '@wonseoro/server-kit';
import { BREAKER } from '../../config';

/**
 * 접수 API 가 기대는 외부 의존성과 그 Circuit Breaker. (v1.1 §01 C8)
 *
 * 의존성마다 **끊겼을 때의 규칙이 다르다.** 규칙은 호출하는 쪽에 있다.
 *
 *   centralVault — fail-open. 끊기면 빈 Snapshot 으로 원서를 만든다. (D-18)
 *                  중앙은 편의 계층이다. 편의가 없다고 접수 기회를 잃으면 안 된다
 *   paymentGateway — **fail-open 금지.** 확인 못 한 결제를 CONFIRMED 로 넘기면
 *                  돈을 안 받고 접수시키는 것이다. 끊기면 UNKNOWN 으로 두고
 *                  Reconciliation 에 맡긴다. (§B4)
 *
 * 문자·메일은 아직 없다. 붙일 때 여기에 추가하고, 끊겼을 때의 규칙을 함께 정한다.
 */
@Injectable()
export class DependencyBreakers {
  private readonly logger = new Logger('circuit');

  readonly centralVault = this.create('central-profile-vault');
  readonly paymentGateway = this.create('payment-gateway');

  snapshot(): CircuitSnapshot[] {
    return [this.centralVault.snapshot(), this.paymentGateway.snapshot()];
  }

  private create(name: string): CircuitBreaker {
    return new CircuitBreaker({
      name,
      failureThreshold: BREAKER.failureThreshold,
      openMs: BREAKER.openMs,
      onStateChange: (c) => this.report(c),
    });
  }

  /** 열림은 경보 대상이다. 닫힘은 복구 확인이다. 둘 다 남긴다. */
  private report(c: CircuitStateChange): void {
    const line = `${c.name} ${c.from} -> ${c.to} (consecutiveFailures=${c.consecutiveFailures})`;
    if (c.to === 'OPEN') this.logger.error(line);
    else this.logger.warn(line);
  }
}

@Global()
@Module({
  providers: [DependencyBreakers],
  exports: [DependencyBreakers],
})
export class ResilienceModule {}
