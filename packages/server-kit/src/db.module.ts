import { DynamicModule, Global, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { databaseConnectionString, poolBudgetFor, startupJitter } from './db.config';

/**
 * PostgreSQL 접근 계층.
 *
 * 이 DB 가 해당 대학 접수의 System of Record 다. (v1.1 §02)
 * 중앙(central-api)은 여기에 쓰지 않는다.
 */
export class Db implements OnApplicationShutdown {
  private readonly logger = new Logger(Db.name);
  readonly pool: Pool;

  /**
   * @param service  커넥션 예산을 고르는 키. db.config.ts 의 DB_POOL_BUDGET 에 있어야 한다.
   * @param schema   search_path. 대학은 kadmission, 중앙은 kadmission_central.
   */
  constructor(
    private readonly service: string,
    schema = 'kadmission',
  ) {
    const budget = poolBudgetFor(service);
    this.pool = new Pool({
      connectionString: databaseConnectionString(),
      // v1.1 §B2 Connection Storm 차단 — Pod 당 상한을 고정한다.
      max: budget.max,
      idleTimeoutMillis: budget.idleTimeoutMs,
      connectionTimeoutMillis: budget.acquireTimeoutMs,
      // 죽은 상대(노드 장애의 PgBouncer)로 향한 연결이 끝없이 매달리지 않게 (T-M4-39)
      query_timeout: budget.queryTimeoutMs,
      // 종료 중인 PgBouncer 에서 연결이 저절로 옮겨 가게 한다 (ADR-0008)
      maxUses: budget.maxUses,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000,
      // 모든 세션이 같은 스키마를 보게 한다.
      options: `-c search_path=${schema},public`,
    });

    this.pool.on('error', (err) => {
      // 본문·연결문자열을 로깅하지 않는다. (v1.1 §B8)
      this.logger.error(`idle client error: ${err.name}`);
    });
  }

  /** 기동 시 여러 Pod 가 동시에 커넥션을 열지 않게 한다. (v1.1 §B2) */
  async jitter(): Promise<void> {
    const ms = startupJitter(this.service);
    if (ms > 0) await new Promise((r) => setTimeout(r, ms));
  }

  /**
   * 연결을 빌린다. 빌려 쓰는 동안 DB 가 연결을 끊어도(재시작·장애 전환·관리자 종료) 프로세스가 죽지 않게
   * 오류 처리기를 붙이고, 반납할 때 뗀다 (D-63).
   *
   * pg 풀은 쉬고 있는 연결에만 처리기를 붙인다. 빌린 연결의 'error' 이벤트를 받을 곳이 없으면 Node 가
   * 처리되지 않은 오류로 프로세스를 끝낸다 — DB 를 다시 만들 때 event-relay 가 이렇게 죽었다.
   * 그 연결로 하던 일은 다음 쿼리에서 실패하고, 반납 때 버려진다(`release(err)`).
   */
  async checkout(): Promise<PoolClient> {
    const client = await this.pool.connect();
    const onError = (err: Error) => this.logger.error(`checked-out client error: ${err.name}`);
    client.on('error', onError);
    const release = client.release.bind(client);
    client.release = ((err?: Error | boolean) => {
      client.off('error', onError);
      return release(err);
    }) as typeof client.release;
    return client;
  }

  query<T extends Record<string, unknown>>(sql: string, params: unknown[] = []) {
    return this.pool.query<T>(sql, params);
  }

  /**
   * 단일 트랜잭션.
   *
   * ⚠️ 이 콜백 안에서 외부 HTTP 호출을 하지 않는다.
   * PG 조회·PDF·SMS·메일·중앙 전송은 커밋 이후다. (v1.0 §5.6, v1.1 §B3)
   * 락 유지 시간이 외부 지연에 묶이면 마감 피크에 전체가 멈춘다.
   */
  async tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.checkout();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      client.release();
      return result;
    } catch (err) {
      if (isBrokenConnection(err)) {
        // 연결이 죽었다 — ROLLBACK 도 매달린다. 풀에 돌려주지 않고 버린다(서버는 연결이 끊기면 스스로 롤백한다)
        client.release(err as Error);
        throw err;
      }
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
      throw err;
    }
  }

  async healthy(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end().catch(() => undefined);
  }
}

/**
 * 연결 자체가 죽었다는 신호 — 쿼리 시간 초과·연결 종료. 업무 오류(제약 위반 등)와 달리 그 연결은 다시 쓰면 안 된다.
 */
export function isBrokenConnection(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as { code?: string }).code;
  return /Query read timeout|Connection terminated|connection timeout/i.test(err.message)
    || code === 'ECONNRESET' || code === 'EPIPE' || code === 'ETIMEDOUT';
}

/**
 * 앱마다 서비스명·스키마가 다르므로 forRoot 로 만든다.
 *   DbModule.forRoot('admission-api')
 *   DbModule.forRoot('central-api', 'kadmission_central')
 */
@Global()
@Module({})
export class DbModule {
  static forRoot(service: string, schema = 'kadmission'): DynamicModule {
    return {
      module: DbModule,
      providers: [{ provide: Db, useFactory: () => new Db(service, schema) }],
      exports: [Db],
    };
  }
}
