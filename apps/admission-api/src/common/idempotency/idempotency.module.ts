import { Global, Module } from '@nestjs/common';
import { Db } from '../../infra/db/db.module';
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
  ],
  exports: [IdempotencyStore],
})
export class IdempotencyModule {}
