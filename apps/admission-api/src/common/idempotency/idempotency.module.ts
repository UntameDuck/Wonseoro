import { Global, Module } from '@nestjs/common';
import { IdempotencyStore, InMemoryIdempotencyStore } from './idempotency.store';

@Global()
@Module({
  providers: [
    // TODO(T-M1-01 이후): Postgres 어댑터로 교체한다. DDL 배치가 선행 조건.
    { provide: IdempotencyStore, useClass: InMemoryIdempotencyStore },
  ],
  exports: [IdempotencyStore],
})
export class IdempotencyModule {}
