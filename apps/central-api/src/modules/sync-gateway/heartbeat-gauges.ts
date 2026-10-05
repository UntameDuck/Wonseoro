import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { metrics } from '@opentelemetry/api';
import { Db, describeFailure } from '@wonseoro/server-kit';
import { HEARTBEAT_STALE_SECONDS } from '../../config';

/**
 * 대학별 심장박동 나이 (§04 sync.heartbeat, D-60 · D-93)
 *
 * 중앙은 대학마다 마지막 심장박동을 받아 상태 API 의 "연결됨"(HEARTBEAT_STALE_SECONDS 안)으로만 보여 줬다 — 한 대학이
 * 조용해져도 경보가 없었다. 활성 대학마다 지난 시간을 지표로 내고, 경보 UniversityHeartbeatStale 이 같은 기준으로 본다.
 *
 *   university_heartbeat_age_seconds{university}  마지막 심장박동 뒤 지난 시간 — 한 번도 받지 못한 대학은 내지 않는다
 *   university_heartbeat_stale_seconds            "연결됨" 기준(설정 HEARTBEAT_STALE_SECONDS)
 *   university_sync_gaps_open{university}         아직 메우지 못한 순번 누락(sync_gap OPEN) 수 — 중앙이 모르는 이벤트가 있다
 *
 * 스크레이프마다 DB 에 묻지 않는다 — REFRESH_MS 마다 읽어 둔다. 읽기가 실패하면 값을 내지 않는다(0 을 내면 "방금 받음" 으로 읽힌다).
 * 대학 ID 는 개인정보가 아니고 수가 정해져 있어 이름표로 쓴다.
 */
const REFRESH_MS = 15_000;

@Injectable()
export class HeartbeatGauges implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger('heartbeat-gauges');
  private timer: NodeJS.Timeout | null = null;
  private ages: { university: string; age: number }[] | null = null;
  private gaps: { university: string; open: number }[] | null = null;
  private failing = false;

  constructor(private readonly db: Db) {
    const meter = metrics.getMeter('k-admission.central');
    meter
      .createObservableGauge('university_heartbeat_age_seconds', { description: '대학별 마지막 심장박동 뒤 지난 시간', unit: 's' })
      .addCallback((r) => {
        for (const a of this.ages ?? []) r.observe(a.age, { university: a.university });
      });
    meter
      .createObservableGauge('university_heartbeat_stale_seconds', { description: '대학을 "연결됨" 으로 보는 심장박동 기준', unit: 's' })
      .addCallback((r) => r.observe(HEARTBEAT_STALE_SECONDS));
    meter
      .createObservableGauge('university_sync_gaps_open', { description: '대학별 아직 메우지 못한 순번 누락 수' })
      .addCallback((r) => {
        for (const g of this.gaps ?? []) r.observe(g.open, { university: g.university });
      });
  }

  onModuleInit(): void {
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), REFRESH_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** 시험에서 직접 부른다 */
  async refresh(): Promise<{ university: string; age: number }[] | null> {
    try {
      const { rows } = await this.db.query<{ university_id: string; age: string }>(
        `SELECT u.id AS university_id, EXTRACT(EPOCH FROM now() - s.last_heartbeat_at) AS age
           FROM university_registry u
           JOIN university_sync_state s ON s.university_id = u.id
          WHERE u.status = 'ACTIVE' AND s.last_heartbeat_at IS NOT NULL`,
      );
      this.ages = rows.map((r) => ({ university: r.university_id, age: Math.max(0, Math.floor(Number(r.age))) }));
      const gaps = await this.db.query<{ university_id: string; open: string }>(
        `SELECT u.id AS university_id, (SELECT count(*) FROM sync_gap g WHERE g.university_id = u.id AND g.state = 'OPEN') AS open
           FROM university_registry u WHERE u.status = 'ACTIVE'`,
      );
      this.gaps = gaps.rows.map((r) => ({ university: r.university_id, open: Number(r.open) }));
      if (this.failing) this.logger.log('심장박동 지표 읽기 복구');
      this.failing = false;
    } catch (err) {
      this.ages = null;
      this.gaps = null;
      if (!this.failing) this.logger.warn(`심장박동 지표를 읽지 못했다: ${describeFailure(err)}`);
      this.failing = true;
    }
    return this.ages;
  }
}
