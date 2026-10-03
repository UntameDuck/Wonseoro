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

/** 5분마다·리더 하나 — 다 내보낼 때까지 조각을 잇는다(한 번에 최대 20조각) */
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
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
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
      return total;
    });
  }
}

@Module({
  providers: [{ provide: PEAK_MODE_POLICY, useValue: PEAK_MODE }, AuditWormScheduler],
})
export class AuditWormModule {}
