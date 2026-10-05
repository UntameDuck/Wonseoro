import { Logger } from '@nestjs/common';
import { metrics } from '@opentelemetry/api';
import type { Db } from '@wonseoro/server-kit';
import type { Queryable } from '../db/queryable';
import { withLeaderLock } from './leader-lock';

/**
 * 주기 작업의 "때" 와 마지막 성공을 DB(scheduled_job_run, 0012)로 정한다 (대장 D-93)
 *
 * 타이머만으로 주기를 세면 재시작마다 처음부터 센다 — 주기(대조 최대 24시간·보관 1시간)보다 자주 다시 뜨는
 * Pod 들만 있으면 작업이 돌지 않는다. 그리고 계속 실패해도 경고 로그뿐이라 아무도 모른다.
 * 그래서
 *   - 타이머는 짧게(주기와 5분 중 짧은 쪽) "때가 됐나" 만 보고, 때는 DB 의 마지막 성공으로 정한다(재시작해도 이어진다)
 *   - 리더 잠금을 잡은 뒤 다시 본다 — 다른 Pod 가 막 끝냈으면 하지 않는다
 *   - 모든 Pod 가 DB 의 마지막 성공·주기·억제 여부를 지표로 낸다 → 경보 ScheduledJobStale(주기의 두 배)
 * 앞날 시각은 믿지 않는다(시계가 어긋난 Pod 가 쓴 값으로 작업이 멈추지 않게).
 */

const CHECK_MAX_MS = 5 * 60_000;
const FUTURE_SKEW_MS = 60_000;

interface JobState {
  intervalMs: number;
  lastSuccess: number;
  suspended: boolean;
}
const jobs = new Map<string, JobState>();

const meter = metrics.getMeter('k-admission.scheduling');
meter
  .createObservableGauge('scheduled_job_last_success_seconds', {
    description: '주기 작업이 마지막으로 끝난 시각(유닉스 초, DB 기준) — 켰는데 한 번도 끝난 적이 없으면 0',
  })
  .addCallback((r) => {
    for (const [job, s] of jobs) r.observe(s.lastSuccess / 1000, { task: job });
  });
meter
  .createObservableGauge('scheduled_job_interval_seconds', { description: '주기 작업의 주기(초)' })
  .addCallback((r) => {
    for (const [job, s] of jobs) r.observe(s.intervalMs / 1000, { task: job });
  });
meter
  .createObservableGauge('scheduled_job_suspended', { description: 'Peak Mode 억제로 쉬는 중이면 1' })
  .addCallback((r) => {
    for (const [job, s] of jobs) r.observe(s.suspended ? 1 : 0, { task: job });
  });

export interface PeriodicJob {
  /** 지표 이름표 task — 대학 없이(reconciliation·outbox-archive …). Prometheus 의 수집 이름표 job 과 부딪치지 않게 task 로 낸다 */
  name: string;
  /** DB 열쇠에 붙는 대학 ID */
  university: string;
  intervalMs: number;
}

export const jobKey = (j: Pick<PeriodicJob, 'name' | 'university'>): string => `${j.name}:${j.university}`;

/** 타이머 주기 — 주기와 5분 중 짧은 쪽 */
export const checkEveryMs = (intervalMs: number): number => Math.min(intervalMs, CHECK_MAX_MS);

/** 지표에 올린다(켠 Pod 만). 한 번도 끝난 적이 없으면 마지막 성공은 0 */
export function registerPeriodicJob(j: PeriodicJob): void {
  if (!jobs.has(j.name)) jobs.set(j.name, { intervalMs: j.intervalMs, lastSuccess: 0, suspended: false });
}

export function markSuspended(j: Pick<PeriodicJob, 'name'>, suspended: boolean): void {
  const s = jobs.get(j.name);
  if (s) s.suspended = suspended;
}

/** DB 의 마지막 성공 — 없거나 앞날이면 null */
export async function lastJobSuccess(db: Queryable, j: Pick<PeriodicJob, 'name' | 'university'>, now = Date.now()): Promise<number | null> {
  const { rows } = await db.query<{ at: Date }>(`SELECT last_success_at AS at FROM scheduled_job_run WHERE job = $1`, [jobKey(j)]);
  const at = rows[0]?.at?.getTime();
  if (at === undefined || at > now + FUTURE_SKEW_MS) return null;
  const s = jobs.get(j.name);
  if (s && at > s.lastSuccess) s.lastSuccess = at;
  return at;
}

/** 0012(scheduled_job_run)를 아직 적용하지 않은 DB — 예전처럼 타이머마다 돈다(작업이 아예 멈추는 것보다 낫다). 한 번만 알린다 */
export const isMissingJobTable = (err: unknown): boolean => (err as { code?: string })?.code === '42P01';
let missingTableWarned = false;
function warnMissingTable(): void {
  if (missingTableWarned) return;
  missingTableWarned = true;
  new Logger('periodic-job').warn('scheduled_job_run 표가 없다(마이그레이션 0012 미적용) — 주기 작업을 타이머마다 돌리고 마지막 성공은 남기지 않는다');
}

export async function isJobDue(db: Queryable, j: PeriodicJob, now = Date.now()): Promise<boolean> {
  let last: number | null;
  try {
    last = await lastJobSuccess(db, j, now);
  } catch (err) {
    if (!isMissingJobTable(err)) throw err;
    warnMissingTable();
    // DB 에 기록이 없으니 이 프로세스가 마지막으로 끝낸 시각으로 주기를 지킨다 — 타이머(최대 5분)마다 돌면 1시간 주기 작업이 12배로 돈다
    const s = jobs.get(j.name);
    return !s || now - s.lastSuccess >= j.intervalMs;
  }
  return last === null || now - last >= j.intervalMs;
}

export async function recordJobSuccess(db: Db, j: Pick<PeriodicJob, 'name' | 'university'>, result: Record<string, unknown> = {}): Promise<void> {
  // 지표는 먼저 — DB 에 못 남겨도(표 없음) 이 프로세스가 끝낸 것은 알린다
  const s0 = jobs.get(j.name);
  if (s0) s0.lastSuccess = Math.max(s0.lastSuccess, Date.now());
  try {
    await recordRow(db, j, result);
  } catch (err) {
    if (!isMissingJobTable(err)) throw err;
    warnMissingTable();
  }
}

async function recordRow(db: Db, j: Pick<PeriodicJob, 'name' | 'university'>, result: Record<string, unknown>): Promise<void> {
  await db.tx((c) =>
    c.query(
      `INSERT INTO scheduled_job_run (job, last_success_at, result) VALUES ($1, now(), $2)
       ON CONFLICT (job) DO UPDATE SET last_success_at = EXCLUDED.last_success_at, result = EXCLUDED.result`,
      [jobKey(j), JSON.stringify(result)],
    ),
  );
}

/**
 * 때가 됐으면 리더 하나가 `work` 를 돌리고 성공을 남긴다. 때가 아니거나 리더가 아니면 null.
 * `work` 가 던지면 기록하지 않는다(마지막 성공이 그대로라 경보가 본다).
 */
export async function runIfDue<T>(
  db: Db,
  j: PeriodicJob,
  lock: string,
  work: () => Promise<T>,
  summarize: (r: T) => Record<string, unknown> = () => ({}),
): Promise<T | null> {
  if (!(await isJobDue(db, j))) return null;
  return withLeaderLock(db, lock, async () => {
    if (!(await isJobDue(db, j))) return null;
    const r = await work();
    await recordJobSuccess(db, j, summarize(r));
    return r;
  });
}
