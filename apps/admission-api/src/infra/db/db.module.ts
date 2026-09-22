import { Global, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { poolBudgetFor, startupJitter } from './db.config';

export const SERVICE_NAME = 'admission-api';

/**
 * PostgreSQL 접근 계층.
 *
 * 이 DB 가 해당 대학 접수의 System of Record 다. (v1.1 §02)
 * 중앙(central-api)은 여기에 쓰지 않는다.
 */
export class Db implements OnApplicationShutdown {
  private readonly logger = new Logger(Db.name);
  readonly pool: Pool;

  constructor() {
    const budget = poolBudgetFor(SERVICE_NAME);
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // v1.1 §B2 Connection Storm 차단 — Pod 당 상한을 고정한다.
      max: budget.max,
      idleTimeoutMillis: budget.idleTimeoutMs,
      connectionTimeoutMillis: budget.acquireTimeoutMs,
      // 모든 세션이 kadmission 스키마를 보게 한다.
      options: '-c search_path=kadmission,public',
    });

    this.pool.on('error', (err) => {
      // 본문·연결문자열을 로깅하지 않는다. (v1.1 §B8)
      this.logger.error(`idle client error: ${err.name}`);
    });
  }

  /** 기동 시 여러 Pod 가 동시에 커넥션을 열지 않게 한다. (v1.1 §B2) */
  static async jitter(): Promise<void> {
    const ms = startupJitter(SERVICE_NAME);
    if (ms > 0) await new Promise((r) => setTimeout(r, ms));
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
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
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

@Global()
@Module({
  providers: [{ provide: Db, useFactory: () => new Db() }],
  exports: [Db],
})
export class DbModule {}
