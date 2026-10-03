"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var AuditWormScheduler_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuditWormModule = exports.AuditWormScheduler = exports.S3WormStore = void 0;
exports.exportAuditSegment = exportAuditSegment;
exports.verifyAuditWorm = verifyAuditWorm;
const node_crypto_1 = require("node:crypto");
const client_s3_1 = require("@aws-sdk/client-s3");
const common_1 = require("@nestjs/common");
const api_1 = require("@opentelemetry/api");
const server_kit_1 = require("@wonseoro/server-kit");
const config_1 = require("../../config");
const leader_lock_1 = require("../../common/scheduling/leader-lock");
const peak_mode_1 = require("../../common/scheduling/peak-mode");
class S3WormStore {
    client;
    bucket;
    constructor(client, bucket) {
        this.client = client;
        this.bucket = bucket;
    }
    static fromConfig(bucket) {
        return new S3WormStore(new client_s3_1.S3Client({
            region: config_1.S3.region,
            endpoint: config_1.S3.endpoint,
            forcePathStyle: (0, server_kit_1.envBool)('S3_FORCE_PATH_STYLE', true),
            credentials: {
                accessKeyId: (0, server_kit_1.secretOrDev)('S3_ACCESS_KEY', 'wonseoro', 'Object Storage 접근키'),
                secretAccessKey: (0, server_kit_1.secretOrDev)('S3_SECRET_KEY', 'wonseoro123', 'Object Storage 비밀키'),
            },
        }), bucket);
    }
    /** 개발 전용 — Object Lock 을 켠 버킷을 만든다. 운영 버킷은 IaC 가 만든다(기본 보관 규칙 포함) */
    async ensureBucket() {
        try {
            await this.client.send(new client_s3_1.HeadBucketCommand({ Bucket: this.bucket }));
        }
        catch {
            await this.client.send(new client_s3_1.CreateBucketCommand({ Bucket: this.bucket, ObjectLockEnabledForBucket: true }));
        }
    }
    async put(key, body, retainUntil) {
        await this.client.send(new client_s3_1.PutObjectCommand({
            Bucket: this.bucket,
            Key: key,
            Body: body,
            ContentType: 'application/x-ndjson',
            ContentMD5: (0, node_crypto_1.createHash)('md5').update(body).digest('base64'),
            ObjectLockMode: 'COMPLIANCE',
            ObjectLockRetainUntilDate: retainUntil,
            Metadata: { sha256: (0, node_crypto_1.createHash)('sha256').update(body).digest('hex') },
        }));
    }
    async list(prefix, delimiter) {
        const out = [];
        let token;
        do {
            const r = await this.client.send(new client_s3_1.ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ...(delimiter ? { Delimiter: delimiter } : {}), ...(token ? { ContinuationToken: token } : {}) }));
            if (delimiter)
                out.push(...(r.CommonPrefixes ?? []).map((p) => p.Prefix));
            else
                out.push(...(r.Contents ?? []).map((c) => c.Key));
            token = r.IsTruncated ? r.NextContinuationToken : undefined;
        } while (token);
        return out;
    }
    async get(key) {
        const r = await this.client.send(new client_s3_1.GetObjectCommand({ Bucket: this.bucket, Key: key }));
        return Buffer.from(await r.Body.transformToByteArray());
    }
}
exports.S3WormStore = S3WormStore;
const exported = api_1.metrics.getMeter('k-admission.audit').createCounter('audit_worm_exported', {
    description: 'WORM 버킷으로 내보낸 감사 기록 수 (T-M3-03)',
});
const COLUMNS = `id, application_id, actor_type, actor_id, action, result, trace_id, config_version, policy_version, source_ip_hash,
  prev_hash, event_hash, details_redacted, to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS ts`;
/** 마지막으로 내보낸 자리 — 가장 늦은 날짜 접두어의 가장 큰 키 */
async function cursorOf(store, university) {
    const days = (await store.list(`audit/${university}/`, '/')).sort();
    for (let i = days.length - 1; i >= 0; i--) {
        const keys = (await store.list(days[i])).filter((k) => k.endsWith('.ndjson')).sort();
        const last = keys.at(-1);
        if (last) {
            const m = /\/([^/]+)_([0-9a-f-]{36})\.ndjson$/.exec(last);
            if (m)
                return { ts: m[1], id: m[2] };
        }
    }
    return null;
}
/** 이어서 한 조각 내보낸다. 내보낸 기록 수(0 이면 할 것이 없다) */
async function exportAuditSegment(db, store, o) {
    const cursor = await cursorOf(store, o.university);
    const { rows } = await db.query(`SELECT ${COLUMNS} FROM audit_event
      WHERE occurred_at < now() - make_interval(secs => $1)
        AND ($2::timestamptz IS NULL OR (occurred_at, id) > ($2::timestamptz, $3::uuid))
      ORDER BY occurred_at, id
      LIMIT $4`, [o.settleSeconds, cursor?.ts ?? null, cursor?.id ?? '00000000-0000-0000-0000-000000000000', o.batch]);
    if (rows.length === 0)
        return { exported: 0, key: null };
    const last = rows.at(-1);
    const key = `audit/${o.university}/${last.ts.slice(0, 10)}/${last.ts}_${last.id}.ndjson`;
    const body = Buffer.from(rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
    await store.put(key, body, new Date(Date.now() + o.retentionDays * 86_400_000));
    exported.add(rows.length);
    return { exported: rows.length, key };
}
/** WORM 조각 전부를 DB 와 맞춘다 */
async function verifyAuditWorm(db, store, university) {
    const keys = (await store.list(`audit/${university}/`)).filter((k) => k.endsWith('.ndjson')).sort();
    const result = { segments: keys.length, checked: 0, missingInDb: [], alteredInDb: [] };
    for (const key of keys) {
        const archived = (await store.get(key)).toString('utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
        const ids = archived.map((r) => r.id);
        const { rows } = await db.query(`SELECT ${COLUMNS} FROM audit_event WHERE id = ANY($1::uuid[])`, [ids]);
        const live = new Map(rows.map((r) => [r.id, r]));
        for (const a of archived) {
            result.checked++;
            const d = live.get(a.id);
            if (!d)
                result.missingInDb.push(a.id);
            else if (JSON.stringify(d) !== JSON.stringify(a))
                result.alteredInDb.push(a.id);
        }
    }
    return result;
}
/** 5분마다·리더 하나 — 다 내보낼 때까지 조각을 잇는다(한 번에 최대 20조각) */
let AuditWormScheduler = class AuditWormScheduler {
    static { AuditWormScheduler_1 = this; }
    db;
    peakMode;
    static LOCK = 'audit:worm';
    logger = new common_1.Logger('audit-worm');
    timer = null;
    store = null;
    constructor(db, peakMode = config_1.PEAK_MODE) {
        this.db = db;
        this.peakMode = peakMode;
    }
    async onModuleInit() {
        if (!config_1.AUDIT_WORM.bucket || !config_1.AUDIT_WORM.autostart)
            return;
        this.store = S3WormStore.fromConfig(config_1.AUDIT_WORM.bucket);
        if (config_1.S3.autoCreateBucket)
            await this.store.ensureBucket().catch((e) => this.logger.warn(`WORM 버킷 준비 실패: ${e.message}`));
        this.timer = setInterval(() => void this.safeTick(), config_1.AUDIT_WORM.intervalMs);
        this.timer.unref();
    }
    onApplicationShutdown() {
        if (this.timer)
            clearInterval(this.timer);
    }
    async safeTick() {
        try {
            const n = await this.tick();
            if (n)
                this.logger.log(`감사 기록 ${n}건을 WORM 버킷으로 내보냈다`);
        }
        catch (err) {
            this.logger.warn(`audit worm export failed (${(0, server_kit_1.describeFailure)(err)})`);
        }
    }
    async tick() {
        const store = this.store;
        if (!store || (0, peak_mode_1.shouldSuspendNonCriticalJobs)(this.peakMode))
            return null;
        return (0, leader_lock_1.withLeaderLock)(this.db, AuditWormScheduler_1.LOCK, async () => {
            let total = 0;
            for (let i = 0; i < 20; i++) {
                const r = await exportAuditSegment(this.db, store, { university: config_1.UNIVERSITY_ID, ...config_1.AUDIT_WORM });
                total += r.exported;
                if (r.exported < config_1.AUDIT_WORM.batch)
                    break;
            }
            return total;
        });
    }
};
exports.AuditWormScheduler = AuditWormScheduler;
exports.AuditWormScheduler = AuditWormScheduler = AuditWormScheduler_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(1, (0, common_1.Inject)(peak_mode_1.PEAK_MODE_POLICY)),
    __metadata("design:paramtypes", [server_kit_1.Db, Object])
], AuditWormScheduler);
let AuditWormModule = class AuditWormModule {
};
exports.AuditWormModule = AuditWormModule;
exports.AuditWormModule = AuditWormModule = __decorate([
    (0, common_1.Module)({
        providers: [{ provide: peak_mode_1.PEAK_MODE_POLICY, useValue: config_1.PEAK_MODE }, AuditWormScheduler],
    })
], AuditWormModule);
//# sourceMappingURL=audit-worm.js.map