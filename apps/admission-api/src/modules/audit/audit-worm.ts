import { createHash } from 'node:crypto';
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Inject, Injectable, Logger, Module, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { metrics } from '@opentelemetry/api';
import { Db, describeFailure, envBool, secretOrDev } from '@wonseoro/server-kit';
import { AUDIT_WORM, PEAK_MODE, S3, UNIVERSITY_ID } from '../../config';
import type { Queryable } from '../../common/db/queryable';
import { withLeaderLock } from '../../common/scheduling/leader-lock';
import { PEAK_MODE_POLICY, PeakModePolicy, shouldSuspendNonCriticalJobs } from '../../common/scheduling/peak-mode';

/**
 * 감사 기록 WORM 물리 분리 (T-M3-03, 노션 §01 A11 "감사 분리 저장소", D-75)
 *
 * DB 안의 감사 기록은 앱 권한·트리거·hash-chain 으로 지킨다(D-41·D-62). 그러나 **DB 슈퍼유저**는 트리거를 끄고 지울 수 있다 —
 * 지운 것은 체인으로 "끊김" 을 알아도 무엇이 있었는지는 되찾지 못한다. 그래서 감사 기록을 DB 밖, **지울 수도 고칠 수도 없는**
 * Object Lock(COMPLIANCE) 버킷에 조각(segment)으로 내보낸다. 보관 기간 동안은 버킷 관리자도 루트 계정도 지우지 못한다.
 *
 *   - 조각 하나 = (occurred_at, id) 순서로 이어지는 감사 기록 묶음(NDJSON). 키 `audit/<대학>/<날짜>/<마지막 시각>_<마지막 id>.ndjson`
 *     — 키 이름이 곧 이어 내보낼 자리(DB 에 따로 두지 않는다 — DB 를 믿지 않으려고 만드는 것이다)
 *   - 커밋이 늦게 끝난 기록을 놓치지 않게 `settleSeconds` 지난 것만 내보낸다
 *   - 대조(verify): WORM 조각과 DB 를 맞춰 **DB 에서 사라진 기록·바뀐 기록**을 찾는다. 아직 안 내보낸 것은 따로 센다
 */

export interface WormStore {
  put(key: string, body: Buffer, retainUntil: Date): Promise<void>;
  /** prefix 아래 키 — delimiter 를 주면 바로 아래 접두어 */
  list(prefix: string, delimiter?: string): Promise<string[]>;
  get(key: string): Promise<Buffer>;
}

export class S3WormStore implements WormStore {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  static fromConfig(bucket: string): S3WormStore {
    return new S3WormStore(
      new S3Client({
        region: S3.region,
        endpoint: S3.endpoint,
        forcePathStyle: envBool('S3_FORCE_PATH_STYLE', true),
        credentials: {
          accessKeyId: secretOrDev('S3_ACCESS_KEY', 'wonseoro', 'Object Storage 접근키'),
          secretAccessKey: secretOrDev('S3_SECRET_KEY', 'wonseoro123', 'Object Storage 비밀키'),
        },
      }),
      bucket,
    );
  }

  /** 개발 전용 — Object Lock 을 켠 버킷을 만든다. 운영 버킷은 IaC 가 만든다(기본 보관 규칙 포함) */
  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket, ObjectLockEnabledForBucket: true }));
    }
  }

  async put(key: string, body: Buffer, retainUntil: Date): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: 'application/x-ndjson',
        ContentMD5: createHash('md5').update(body).digest('base64'),
        ObjectLockMode: 'COMPLIANCE',
        ObjectLockRetainUntilDate: retainUntil,
        Metadata: { sha256: createHash('sha256').update(body).digest('hex') },
      }),
    );
  }

  async list(prefix: string, delimiter?: string): Promise<string[]> {
    const out: string[] = [];
    let token: string | undefined;
    do {
      const r = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ...(delimiter ? { Delimiter: delimiter } : {}), ...(token ? { ContinuationToken: token } : {}) }),
      );
      if (delimiter) out.push(...(r.CommonPrefixes ?? []).map((p) => p.Prefix as string));
      else out.push(...(r.Contents ?? []).map((c) => c.Key as string));
      token = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (token);
    return out;
  }

  async get(key: string): Promise<Buffer> {
    const r = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await (r.Body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray());
  }
}

const exported = metrics.getMeter('k-admission.audit').createCounter('audit_worm_exported', {
  description: 'WORM 버킷으로 내보낸 감사 기록 수 (T-M3-03)',
});

interface AuditRow extends Record<string, unknown> {
  id: string;
  ts: string; // occurred_at — 마이크로초까지, UTC 글자
  event_hash: string;
}

const COLUMNS = `id, application_id, actor_type, actor_id, action, result, trace_id, config_version, policy_version, source_ip_hash,
  prev_hash, event_hash, details_redacted, to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS ts`;

/** 마지막으로 내보낸 자리 — 가장 늦은 날짜 접두어의 가장 큰 키 */
async function cursorOf(store: WormStore, university: string): Promise<{ ts: string; id: string } | null> {
  const days = (await store.list(`audit/${university}/`, '/')).sort();
  for (let i = days.length - 1; i >= 0; i--) {
    const keys = (await store.list(days[i] as string)).filter((k) => k.endsWith('.ndjson')).sort();
    const last = keys.at(-1);
    if (last) {
      const m = /\/([^/]+)_([0-9a-f-]{36})\.ndjson$/.exec(last);
      if (m) return { ts: m[1] as string, id: m[2] as string };
    }
  }
  return null;
}

export interface ExportOptions {
  university: string;
  settleSeconds: number;
  batch: number;
  retentionDays: number;
}

/** 이어서 한 조각 내보낸다. 내보낸 기록 수(0 이면 할 것이 없다) */
export async function exportAuditSegment(db: Queryable, store: WormStore, o: ExportOptions): Promise<{ exported: number; key: string | null }> {
  const cursor = await cursorOf(store, o.university);
  const { rows } = await db.query<AuditRow>(
    `SELECT ${COLUMNS} FROM audit_event
      WHERE occurred_at < now() - make_interval(secs => $1)
        AND ($2::timestamptz IS NULL OR (occurred_at, id) > ($2::timestamptz, $3::uuid))
      ORDER BY occurred_at, id
      LIMIT $4`,
    [o.settleSeconds, cursor?.ts ?? null, cursor?.id ?? '00000000-0000-0000-0000-000000000000', o.batch],
  );
  if (rows.length === 0) return { exported: 0, key: null };
  const last = rows.at(-1) as AuditRow;
  const key = `audit/${o.university}/${last.ts.slice(0, 10)}/${last.ts}_${last.id}.ndjson`;
  const body = Buffer.from(rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  await store.put(key, body, new Date(Date.now() + o.retentionDays * 86_400_000));
  exported.add(rows.length);
  return { exported: rows.length, key };
}

export interface WormVerifyResult {
  segments: number;
  checked: number;
  /** WORM 에 있는데 DB 에 없다 — 지워졌다 */
  missingInDb: string[];
  /** 둘 다 있는데 내용(해시·값)이 다르다 — 고쳐졌다 */
  alteredInDb: string[];
}

/** WORM 조각 전부를 DB 와 맞춘다 */
export async function verifyAuditWorm(db: Queryable, store: WormStore, university: string): Promise<WormVerifyResult> {
  const keys = (await store.list(`audit/${university}/`)).filter((k) => k.endsWith('.ndjson')).sort();
  const result: WormVerifyResult = { segments: keys.length, checked: 0, missingInDb: [], alteredInDb: [] };
  for (const key of keys) {
    const archived = (await store.get(key)).toString('utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as AuditRow);
    const ids = archived.map((r) => r.id);
    const { rows } = await db.query<AuditRow>(`SELECT ${COLUMNS} FROM audit_event WHERE id = ANY($1::uuid[])`, [ids]);
    const live = new Map(rows.map((r) => [r.id, r]));
    for (const a of archived) {
      result.checked++;
      const d = live.get(a.id);
      if (!d) result.missingInDb.push(a.id);
      else if (JSON.stringify(d) !== JSON.stringify(a)) result.alteredInDb.push(a.id);
    }
  }
  return result;
}

/* ── 권한 부여·변경·말소 기록 (G-15, D-91 — 0011 access_grant_log) ─────────────
 * DB 의 추가 전용·해시 체인은 슈퍼유저가 트리거를 끄고 지우면 "지워졌다" 는 알아도 되찾지 못한다 — 감사 기록과 같이 WORM 조각으로 밖에 둔다.
 * 순번은 잠금 안에서 커밋 순서대로 매겨지므로 안정화 대기 없이 순번으로 잇는다. 보관은 법정 하한 3년보다 짧게 두지 않는다.
 */
export const GRANT_WORM_MIN_DAYS = 1095;

interface GrantRow extends Record<string, unknown> {
  seq: string;
  recorded: string;
  row_hash: string;
}

const GRANT_COLUMNS = `seq::text, source, source_event_id, to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS occurred,
  action, change_kind, subject, roles, actor, details, to_char(recorded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS recorded, prev_hash, row_hash`;

/** 마지막으로 내보낸 순번 — 가장 늦은 날짜 접두어의 가장 큰 키(순번은 12자리로 채워 글자 순서 = 숫자 순서) */
async function grantCursorOf(store: WormStore, university: string): Promise<number> {
  const days = (await store.list(`access-grants/${university}/`, '/')).sort();
  for (let i = days.length - 1; i >= 0; i--) {
    const last = (await store.list(days[i] as string)).filter((k) => k.endsWith('.ndjson')).sort().at(-1);
    const m = last ? /\/(\d{12})\.ndjson$/.exec(last) : null;
    if (m) return Number(m[1]);
  }
  return 0;
}

export async function exportGrantSegment(
  db: Queryable,
  store: WormStore,
  o: { university: string; batch: number; retentionDays: number },
): Promise<{ exported: number; key: string | null }> {
  const cursor = await grantCursorOf(store, o.university);
  // 정렬은 표의 숫자 순번으로 — 결과 열 seq 는 글자라 그대로 정렬하면 "99" 가 "140" 뒤에 온다
  const { rows } = await db.query<GrantRow>(
    `SELECT ${GRANT_COLUMNS} FROM access_grant_log g WHERE g.seq > $1 ORDER BY g.seq LIMIT $2`,
    [cursor, o.batch],
  );
  if (rows.length === 0) return { exported: 0, key: null };
  const last = rows.at(-1) as GrantRow;
  const key = `access-grants/${o.university}/${last.recorded.slice(0, 10)}/${last.seq.padStart(12, '0')}.ndjson`;
  const body = Buffer.from(rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  await store.put(key, body, new Date(Date.now() + o.retentionDays * 86_400_000));
  exported.add(rows.length, { log: 'access-grants' });
  return { exported: rows.length, key };
}

/** WORM 조각 전부를 DB 와 맞춘다 — 순번으로 */
export async function verifyGrantWorm(db: Queryable, store: WormStore, university: string): Promise<WormVerifyResult> {
  const keys = (await store.list(`access-grants/${university}/`)).filter((k) => k.endsWith('.ndjson')).sort();
  const result: WormVerifyResult = { segments: keys.length, checked: 0, missingInDb: [], alteredInDb: [] };
  for (const key of keys) {
    const archived = (await store.get(key)).toString('utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as GrantRow);
    const { rows } = await db.query<GrantRow>(`SELECT ${GRANT_COLUMNS} FROM access_grant_log WHERE seq = ANY($1::bigint[])`, [archived.map((r) => r.seq)]);
    const live = new Map(rows.map((r) => [r.seq, r]));
    for (const a of archived) {
      result.checked++;
      const d = live.get(a.seq);
      if (!d) result.missingInDb.push(a.seq);
      else if (JSON.stringify(d) !== JSON.stringify(a)) result.alteredInDb.push(a.seq);
    }
  }
  return result;
}

/* ── 정기 대조 — WORM 조각과 DB 가 다르면(지워졌거나 고쳐졌으면) 지표로 알린다 ──────────────
 * 경보 규칙: deploy/platform/observability/expiry-rules.yaml 의 AuditWormMismatch·AuditWormVerifyStale.
 * 지운 줄·고친 줄의 ID 는 로그에만(지표 이름표에 싣지 않는다 — 수가 끝없이 늘 수 있다).
 *
 * 마지막 대조 시각·불일치 수는 DB(scheduled_job_run, 0012)에도 남긴다(D-93). 프로세스 안에만 두면
 *   - 주기 타이머가 재시작마다 처음부터 다시 세어, 하루 안에 다시 뜨는 Pod 들만 있으면 대조가 한 번도 돌지 않고
 *   - 재시작한 Pod 는 마지막 성공 지표가 없어(경보 식이 비어) 대조가 멈춰도 AuditWormVerifyStale 이 울리지 않으며
 *   - 불일치를 찾은 뒤 재시작하면 불일치 수가 0 으로 돌아가 AuditWormMismatch 가 조용히 꺼진다.
 * DB 기록은 "언제 돌릴지" 와 재시작 뒤 지표의 바닥값으로만 쓴다 — 슈퍼유저가 이 행을 고쳐 대조를 미뤄도, 프로세스는 자기가 뜬 뒤
 * 주기만큼 대조하지 못했으면 DB 와 상관없이 대조한다(예전과 같은 보장). 앞날 시각은 믿지 않는다.
 */
type VerifyCounts = Record<'audit' | 'access-grants', { missing: number; altered: number }>;
const zeroCounts = (): VerifyCounts => ({ audit: { missing: 0, altered: 0 }, 'access-grants': { missing: 0, altered: 0 } });
let verifyState: VerifyCounts = zeroCounts();
let lastVerifiedAt = 0;
let verifyEnabled = false;
const meter = metrics.getMeter('k-admission.audit');
meter
  .createObservableGauge('audit_worm_verify_mismatches', { description: 'WORM 조각과 다른 DB 기록 수 — 지워짐(missing)·고쳐짐(altered) (D-75·D-91)' })
  .addCallback((r) => {
    for (const [log, s] of Object.entries(verifyState)) {
      r.observe(s.missing, { log, kind: 'missing' });
      r.observe(s.altered, { log, kind: 'altered' });
    }
  });
meter
  .createObservableGauge('audit_worm_verify_last_success_seconds', {
    description: '마지막으로 WORM 대조를 끝낸 시각(유닉스 초) — 대조를 켰는데 한 번도 끝난 적이 없으면 0',
  })
  .addCallback((r) => {
    if (verifyEnabled || lastVerifiedAt) r.observe(lastVerifiedAt / 1000);
  });
// 경보(AuditWormVerifyStale)가 "주기의 두 배" 를 보게 — 주기는 설정으로 최대 7일까지 바뀐다(이틀 고정이면 사흘 주기에서 매번 울린다)
meter
  .createObservableGauge('audit_worm_verify_interval_seconds', { description: 'WORM 정기 대조 주기(초) — 대조를 켠 Pod 만' })
  .addCallback((r) => {
    if (verifyEnabled) r.observe(AUDIT_WORM.verifyIntervalMs / 1000);
  });

/** 감사 기록·권한 변경 기록의 WORM 조각 전부를 DB 와 맞춘다 */
export async function verifyAllWorm(db: Queryable, store: WormStore, university: string): Promise<Record<'audit' | 'access-grants', WormVerifyResult>> {
  return { audit: await verifyAuditWorm(db, store, university), 'access-grants': await verifyGrantWorm(db, store, university) };
}

export const wormVerifyJob = (university: string): string => `audit-worm-verify:${university}`;

/** 시계가 어긋난 Pod 를 감안해 이만큼까지의 앞날은 받아 준다 */
const FUTURE_SKEW_MS = 60_000;
/** "대조할 때가 됐나" 를 보는 주기 — 한 줄 읽기라 싸다 */
const VERIFY_CHECK_MS = 10 * 60_000;

export interface WormVerifyRecord {
  at: number;
  counts: VerifyCounts;
}

/** DB 에 남긴 마지막 대조 — 없거나 앞날이면 null */
export async function loadWormVerify(db: Queryable, university: string, now = Date.now()): Promise<WormVerifyRecord | null> {
  const { rows } = await db.query<{ at: Date; result: Partial<VerifyCounts> }>(
    `SELECT last_success_at AS at, result FROM scheduled_job_run WHERE job = $1`,
    [wormVerifyJob(university)],
  );
  const row = rows[0];
  if (!row || row.at.getTime() > now + FUTURE_SKEW_MS) return null;
  const counts = zeroCounts();
  for (const log of ['audit', 'access-grants'] as const) {
    counts[log] = { missing: Number(row.result?.[log]?.missing ?? 0), altered: Number(row.result?.[log]?.altered ?? 0) };
  }
  return { at: row.at.getTime(), counts };
}

async function recordWormVerify(db: Db, university: string, counts: VerifyCounts): Promise<void> {
  await db.tx((c) =>
    c.query(
      `INSERT INTO scheduled_job_run (job, last_success_at, result) VALUES ($1, now(), $2)
       ON CONFLICT (job) DO UPDATE SET last_success_at = EXCLUDED.last_success_at, result = EXCLUDED.result`,
      [wormVerifyJob(university), JSON.stringify(counts)],
    ),
  );
}

/** 지표를 DB 기록과 맞춘다 — 이 프로세스가 더 최근에 대조했으면 그 값을 둔다 */
function applyVerifyRecord(rec: WormVerifyRecord | null): void {
  if (rec && rec.at > lastVerifiedAt) {
    lastVerifiedAt = rec.at;
    verifyState = rec.counts;
  }
}

export interface WormVerifyOptions {
  university: string;
  intervalMs: number;
  /** 이 프로세스가 마지막으로 대조를 끝낸 시각(없으면 뜬 시각) — DB 기록과 상관없이 이만큼 지나면 대조한다 */
  processSince: number;
  now?: number;
  /** 대조는 끝났는데 DB 에 남기지 못했을 때 — 결과는 그대로 돌려준다(이 프로세스의 지표는 이미 바뀌었다) */
  onRecordError?: (err: Error) => void;
}

/**
 * 대조할 때가 됐으면(DB 기록이 없거나·주기가 지났거나·앞날이거나, 이 프로세스가 주기만큼 대조하지 못했으면) 리더 하나가 대조하고 기록한다.
 * 때가 아니거나 리더가 아니면 null. 잠금을 잡은 뒤 다시 본다 — 다른 Pod 가 막 끝냈으면 하지 않는다.
 */
export async function verifyWormIfDue(db: Db, store: WormStore, o: WormVerifyOptions): Promise<Record<'audit' | 'access-grants', WormVerifyResult> | null> {
  const due = async (): Promise<boolean> => {
    const now = o.now ?? Date.now();
    const rec = await loadWormVerify(db, o.university, now);
    applyVerifyRecord(rec);
    return !rec || now - rec.at >= o.intervalMs || now - o.processSince >= o.intervalMs;
  };
  if (!(await due())) return null;
  return withLeaderLock(db, `${AuditWormScheduler.LOCK}:verify`, async () => {
    if (!(await due())) return null;
    const r = await verifyAllWorm(db, store, o.university);
    const counts = zeroCounts();
    for (const log of ['audit', 'access-grants'] as const) {
      counts[log] = { missing: r[log].missingInDb.length, altered: r[log].alteredInDb.length };
    }
    // 지표를 먼저 — 기록이 실패해도(DB 쓰기 거절) 이 프로세스의 결과는 알린다
    verifyState = counts;
    lastVerifiedAt = Date.now();
    await recordWormVerify(db, o.university, counts).catch((err: Error) => o.onRecordError?.(err));
    return r;
  });
}

/** 5분마다·리더 하나 — 다 내보낼 때까지 조각을 잇는다(한 번에 최대 20조각). 권한 변경 기록도 같은 주기에. 대조는 따로(기본 하루) */
@Injectable()
export class AuditWormScheduler implements OnModuleInit, OnApplicationShutdown {
  static readonly LOCK = 'audit:worm';
  private readonly logger = new Logger('audit-worm');
  private timer: NodeJS.Timeout | null = null;
  private store: S3WormStore | null = null;

  constructor(
    private readonly db: Db,
    @Inject(PEAK_MODE_POLICY) private readonly peakMode: PeakModePolicy = PEAK_MODE,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!AUDIT_WORM.bucket || !AUDIT_WORM.autostart) return;
    this.store = S3WormStore.fromConfig(AUDIT_WORM.bucket);
    if (S3.autoCreateBucket) await this.store.ensureBucket().catch((e: Error) => this.logger.warn(`WORM 버킷 준비 실패: ${e.message}`));
    this.timer = setInterval(() => void this.safeTick(), AUDIT_WORM.intervalMs);
    this.timer.unref();
    if (AUDIT_WORM.verifyIntervalMs > 0) {
      // 대조 주기(기본 하루)마다가 아니라 자주 "때가 됐나" 만 본다 — 때는 DB 의 마지막 대조로 정한다(재시작해도 이어진다, D-93)
      verifyEnabled = true;
      this.processSince = Date.now();
      this.verifyTimer = setInterval(() => void this.safeVerify(), Math.min(AUDIT_WORM.verifyIntervalMs, VERIFY_CHECK_MS));
      this.verifyTimer.unref();
    }
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.verifyTimer) clearInterval(this.verifyTimer);
  }

  private verifyTimer: NodeJS.Timeout | null = null;
  private processSince = Date.now();

  private async safeVerify(): Promise<void> {
    try {
      await this.verify();
    } catch (err) {
      this.logger.warn(`audit worm verify failed (${describeFailure(err)})`);
    }
  }

  /** 때가 됐으면 리더 하나가 대조하고 지표·DB 기록을 바꾼다. 다르면 지운·고친 ID 를 로그에 남긴다 */
  async verify(): Promise<Record<'audit' | 'access-grants', WormVerifyResult> | null> {
    const store = this.store;
    if (!store || shouldSuspendNonCriticalJobs(this.peakMode)) return null;
    const r = await verifyWormIfDue(this.db, store, {
      university: UNIVERSITY_ID,
      intervalMs: AUDIT_WORM.verifyIntervalMs,
      processSince: this.processSince,
      onRecordError: (err) => this.logger.warn(`audit worm verify record failed (${describeFailure(err)})`),
    });
    if (!r) return null;
    this.processSince = Date.now();
    for (const log of ['audit', 'access-grants'] as const) {
      if (r[log].missingInDb.length || r[log].alteredInDb.length) {
        this.logger.error(`WORM 대조 불일치(${log}) — 지워짐 ${r[log].missingInDb.slice(0, 20).join(',')} · 고쳐짐 ${r[log].alteredInDb.slice(0, 20).join(',')}`);
      }
    }
    return r;
  }

  private async safeTick(): Promise<void> {
    try {
      const n = await this.tick();
      if (n) this.logger.log(`감사 기록 ${n}건을 WORM 버킷으로 내보냈다`);
    } catch (err) {
      this.logger.warn(`audit worm export failed (${describeFailure(err)})`);
    }
  }

  async tick(): Promise<number | null> {
    const store = this.store;
    if (!store || shouldSuspendNonCriticalJobs(this.peakMode)) return null;
    return withLeaderLock(this.db, AuditWormScheduler.LOCK, async () => {
      let total = 0;
      for (let i = 0; i < 20; i++) {
        const r = await exportAuditSegment(this.db, store, { university: UNIVERSITY_ID, ...AUDIT_WORM });
        total += r.exported;
        if (r.exported < AUDIT_WORM.batch) break;
      }
      for (let i = 0; i < 20; i++) {
        // 감사 기록 보관을 3년보다 짧게 정했어도 권한 변경 기록은 법정 하한까지 잠근다
        const retentionDays = Math.max(AUDIT_WORM.retentionDays, GRANT_WORM_MIN_DAYS);
        const r = await exportGrantSegment(this.db, store, { university: UNIVERSITY_ID, batch: AUDIT_WORM.batch, retentionDays });
        total += r.exported;
        if (r.exported < AUDIT_WORM.batch) break;
      }
      return total;
    });
  }
}

@Module({
  providers: [{ provide: PEAK_MODE_POLICY, useValue: PEAK_MODE }, AuditWormScheduler],
})
export class AuditWormModule {}
