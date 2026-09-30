import { Global, Module } from '@nestjs/common';
import { Db } from '@wonseoro/server-kit';
import { PEAK_MODE } from '../../config';
import { PEAK_MODE_POLICY } from '../scheduling/peak-mode';
import { IdempotencyPurgeScheduler } from './idempotency-purge.scheduler';
import { IdempotencyStore } from './idempotency.store';
import { PostgresIdempotencyStore } from './postgres-idempotency.store';

@Global()
@Module({
  providers: [
    {
      provide: IdempotencyStore,
      useFactory: (db: Db) => new PostgresIdempotencyStore(db),
      inject: [Db],
    },
    { provide: PEAK_MODE_POLICY, useValue: PEAK_MODE },
    IdempotencyPurgeScheduler,
  ],
  exports: [IdempotencyStore],
})
export class IdempotencyModule {}
