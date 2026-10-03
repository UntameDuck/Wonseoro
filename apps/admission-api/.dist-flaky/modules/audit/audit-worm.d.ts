import { S3Client } from '@aws-sdk/client-s3';
import { OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Db } from '@wonseoro/server-kit';
import type { Queryable } from '../../common/db/queryable';
import { PeakModePolicy } from '../../common/scheduling/peak-mode';
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
export declare class S3WormStore implements WormStore {
    private readonly client;
    private readonly bucket;
    constructor(client: S3Client, bucket: string);
    static fromConfig(bucket: string): S3WormStore;
    /** 개발 전용 — Object Lock 을 켠 버킷을 만든다. 운영 버킷은 IaC 가 만든다(기본 보관 규칙 포함) */
    ensureBucket(): Promise<void>;
    put(key: string, body: Buffer, retainUntil: Date): Promise<void>;
    list(prefix: string, delimiter?: string): Promise<string[]>;
    get(key: string): Promise<Buffer>;
}
export interface ExportOptions {
    university: string;
    settleSeconds: number;
    batch: number;
    retentionDays: number;
}
/** 이어서 한 조각 내보낸다. 내보낸 기록 수(0 이면 할 것이 없다) */
export declare function exportAuditSegment(db: Queryable, store: WormStore, o: ExportOptions): Promise<{
    exported: number;
    key: string | null;
}>;
export interface WormVerifyResult {
    segments: number;
    checked: number;
    /** WORM 에 있는데 DB 에 없다 — 지워졌다 */
    missingInDb: string[];
    /** 둘 다 있는데 내용(해시·값)이 다르다 — 고쳐졌다 */
    alteredInDb: string[];
}
/** WORM 조각 전부를 DB 와 맞춘다 */
export declare function verifyAuditWorm(db: Queryable, store: WormStore, university: string): Promise<WormVerifyResult>;
/** 5분마다·리더 하나 — 다 내보낼 때까지 조각을 잇는다(한 번에 최대 20조각) */
export declare class AuditWormScheduler implements OnModuleInit, OnApplicationShutdown {
    private readonly db;
    private readonly peakMode;
    static readonly LOCK = "audit:worm";
    private readonly logger;
    private timer;
    private store;
    constructor(db: Db, peakMode?: PeakModePolicy);
    onModuleInit(): Promise<void>;
    onApplicationShutdown(): void;
    private safeTick;
    tick(): Promise<number | null>;
}
export declare class AuditWormModule {
}
