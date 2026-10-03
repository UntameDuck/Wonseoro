"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuditService = exports.GENESIS_HASH = void 0;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const server_clock_1 = require("../../common/time/server-clock");
const config_1 = require("../../config");
/** 체인의 시작점. 첫 이벤트의 prev_hash. */
exports.GENESIS_HASH = '0'.repeat(64);
/**
 * 감사 이벤트 기록 — 기술설계서 v1.0 §9, v1.1 §A11
 *
 * 보안로그가 아니라 **"마감 시각에 지원자가 어디까지 수행했는지"를 증명하는 업무 증적**이다.
 * 2026년 장애의 구제 판정에 작성·저장·제출·결제 시도 기록이 쓰였다.
 *
 * 절대 규칙
 *   1. 상태를 바꾸는 트랜잭션 **안에서** 기록한다. 커밋 후 별도로 쓰지 않는다.
 *      (별도로 쓰면 커밋은 됐는데 증적이 없는 구간이 생긴다)
 *   2. hash-chain 으로 이어 붙인다. 중간 레코드를 지우거나 고치면 검증에서 드러난다.
 *   3. 운영자에게 삭제·수정 권한을 주지 않는다. (M5 에서 WORM 저장소로 분리)
 *   4. 개인정보를 넣지 않는다. IP 는 원문이 아니라 해시로 남긴다.
 */
let AuditService = class AuditService {
    /**
     * 트랜잭션 안에서 감사 이벤트를 기록한다.
     * 체인은 application 단위로 잇는다 — Evidence Package 가 원서 하나를 재구성해야 하므로.
     *
     * 원서에 딸리지 않은 이벤트(마감·설정 적용 같은 운영자 행위)는 **시스템 체인** 하나로
     * 잇는다. 전에는 이것들이 전부 GENESIS 에서 시작해 체인이 아니었다 — 하나를 지워도
     * 드러나지 않았다. 운영자 행위야말로 지워지면 안 되는 기록이다. (D-36)
     */
    async record(client, input) {
        // 체인의 끝을 잠그고 읽는다. 원서 체인과 시스템 체인 모두 — 잠그지 않으면 두 기록이 같은 끝을 보고
        // 각자 이어붙여 체인이 갈라진다. (D-62: 원서 체인에는 잠금이 없었다)
        const last = input.applicationId
            ? await this.lockApplicationChain(client, input.applicationId)
            : await this.lockSystemChain(client);
        const prevHash = last.hash;
        // DB 시계에 맞춘 시각이다(§A2). 다만 offset 은 측정마다 바뀌어(D-61) 이어 쓰는 기록의 시각이
        // 거꾸로 갈 수 있다. 직전 기록보다 반드시 뒤에 둔다 — 증적의 시간 순서가 기록 순서와 같아야 읽힌다.
        let occurredAt = (0, server_clock_1.serverNow)();
        if (last.at && occurredAt.getTime() <= last.at.getTime()) {
            occurredAt = new Date(last.at.getTime() + 1);
        }
        const eventId = (0, node_crypto_1.randomUUID)();
        const sourceIpHash = input.sourceIp ? this.hashIp(input.sourceIp) : null;
        const eventHash = this.chainHash(prevHash, {
            eventId,
            occurredAt: occurredAt.toISOString(),
            applicationId: input.applicationId ?? null,
            actorType: input.actorType,
            actorId: input.actorId ?? null,
            action: input.action,
            result: input.result,
            configVersion: input.configVersion ?? null,
            policyVersion: input.policyVersion ?? null,
        });
        await client.query(`INSERT INTO audit_event (
         id, application_id, actor_type, actor_id, action, result,
         trace_id, config_version, policy_version, source_ip_hash,
         prev_hash, event_hash, details_redacted, occurred_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`, [
            eventId,
            input.applicationId ?? null,
            input.actorType,
            input.actorId ?? null,
            input.action,
            input.result,
            input.traceId ?? null,
            input.configVersion ?? null,
            input.policyVersion ?? null,
            sourceIpHash,
            prevHash,
            eventHash,
            JSON.stringify(input.details ?? {}),
            occurredAt,
        ]);
        return eventHash;
    }
    /**
     * 체인 무결성 검증. Evidence Package 생성 시 함께 돌린다. (M3 T-M3-07)
     * 한 건이라도 끊기면 그 지점을 반환한다. 순서는 시각이 아니라 앞 해시 연결로 따라간다(`walk`).
     */
    async verifyChain(client, applicationId) {
        const { rows } = await client.query(`SELECT id, application_id, actor_type, actor_id, action, result,
              config_version, policy_version, prev_hash, event_hash, occurred_at
         FROM audit_event
        WHERE application_id = $1
        ORDER BY occurred_at ASC, id ASC`, [applicationId]);
        return this.walk(rows);
    }
    /**
     * 시스템 체인의 끝을 잡는다. 트랜잭션이 끝날 때까지 다른 기록은 기다린다.
     * 잠그지 않으면 두 활성화가 같은 끝을 보고 각자 이어붙여 체인이 갈라진다.
     */
    async lockSystemChain(client) {
        await client.query(`SELECT pg_advisory_xact_lock(hashtext('audit:system-chain'))`);
        const { rows } = await client.query(`SELECT event_hash, occurred_at FROM audit_event
        WHERE application_id IS NULL
        ORDER BY occurred_at DESC, id DESC
        LIMIT 1`);
        return { hash: rows[0]?.event_hash ?? exports.GENESIS_HASH, at: rows[0]?.occurred_at ?? null };
    }
    /** 시스템 체인(운영자 행위) 검증. 끊긴 지점이 있으면 그 이벤트를 돌려준다. */
    async verifySystemChain(client) {
        const { rows } = await client.query(`SELECT id, application_id, actor_type, actor_id, action, result,
              config_version, policy_version, prev_hash, event_hash, occurred_at
         FROM audit_event
        WHERE application_id IS NULL
        ORDER BY occurred_at ASC, id ASC`);
        return this.walk(rows);
    }
    /**
     * 원서 체인의 끝을 잠그고 읽는다. 같은 원서의 기록은 이 잠금에서 줄을 선다.
     *
     * 새 advisory 잠금이 아니라 **원서 행 잠금**이다 — 원서를 바꾸는 흐름(저장·결제 의도·접수)은 이미 이
     * 행을 먼저 잠그므로 잠금 순서가 새로 생기지 않는다(교착 방지). `FOR NO KEY UPDATE` 라 다른 표의 행이
     * 이 원서를 참조하며 들어오는 것(외래키 KEY SHARE)은 막지 않는다.
     * READ COMMITTED 에서 잠금을 기다린 뒤의 다음 문장은 앞 트랜잭션이 커밋한 기록을 본다.
     */
    async lockApplicationChain(client, applicationId) {
        await client.query(`SELECT 1 FROM application WHERE id = $1 FOR NO KEY UPDATE`, [applicationId]);
        return this.chainTail(client, applicationId);
    }
    /**
     * 체인의 끝 — 아무도 앞 해시로 가리키지 않는 기록이다. 시각으로 고르지 않는다: 고치기 전 코드가
     * 시각이 뒤집힌 채 남긴 기록에서 "가장 늦은 시각" 은 끝이 아닐 수 있다(D-62).
     * 시각은 체인 전체에서 가장 늦은 것을 돌려준다 — 새 기록은 그보다 뒤에 둔다.
     */
    async chainTail(client, applicationId) {
        const { rows } = await client.query(`SELECT (SELECT a.event_hash FROM audit_event a
                WHERE a.application_id = $1
                  AND NOT EXISTS (SELECT 1 FROM audit_event b
                                   WHERE b.application_id = $1 AND b.prev_hash = a.event_hash)
                ORDER BY a.occurred_at DESC, a.id DESC
                LIMIT 1) AS event_hash,
              (SELECT max(occurred_at) FROM audit_event WHERE application_id = $1) AS latest`, [applicationId]);
        return { hash: rows[0]?.event_hash ?? exports.GENESIS_HASH, at: rows[0]?.latest ?? null };
    }
    /**
     * 앞 해시 연결을 GENESIS 부터 따라가며 각 기록의 해시를 다시 계산한다.
     *
     * 시각 순서를 믿지 않는다(D-62) — 시각이 뒤집혀 쌓인 기록도 연결과 해시가 맞으면 변조가 아니다.
     * 끊김으로 보는 것: 해시 불일치(고침), 같은 앞 해시에 둘이 붙음(갈라짐 — 늦은 쪽을 지목),
     * 연결로 닿지 못한 기록(중간 기록이 지워짐 — 닿지 못한 것 중 가장 이른 기록을 지목).
     */
    walk(rows) {
        const children = new Map();
        for (const row of rows) {
            const list = children.get(row.prev_hash);
            if (list)
                list.push(row);
            else
                children.set(row.prev_hash, [row]);
        }
        const visited = new Set();
        let expectedPrev = exports.GENESIS_HASH;
        for (;;) {
            const next = children.get(expectedPrev);
            if (!next)
                break;
            if (next.length > 1) {
                return { valid: false, brokenAt: next[1].id, checked: rows.length };
            }
            const row = next[0];
            const recomputed = this.chainHash(row.prev_hash, {
                eventId: row.id,
                occurredAt: row.occurred_at.toISOString(),
                applicationId: row.application_id,
                actorType: row.actor_type,
                actorId: row.actor_id,
                action: row.action,
                result: row.result,
                configVersion: row.config_version,
                policyVersion: row.policy_version,
            });
            if (recomputed !== row.event_hash || visited.has(row.id)) {
                return { valid: false, brokenAt: row.id, checked: rows.length };
            }
            visited.add(row.id);
            expectedPrev = row.event_hash;
        }
        // rows 는 시각순이라 닿지 못한 것 중 첫 번째가 가장 이른 기록이다
        const unreachable = rows.find((r) => !visited.has(r.id));
        if (unreachable)
            return { valid: false, brokenAt: unreachable.id, checked: rows.length };
        return { valid: true, checked: rows.length };
    }
    chainHash(prevHash, fields) {
        const canonical = Object.keys(fields)
            .sort()
            .map((k) => `${k}=${String(fields[k])}`)
            .join('&');
        return (0, node_crypto_1.createHash)('sha256').update(`${prevHash}|${canonical}`).digest('hex');
    }
    /** IP 원문을 저장하지 않는다. (v1.0 §9 sourceIpHash) */
    /**
     * IP 는 원문으로 남기지 않는다. 소금이 고정값이면 가명처리가 아니다 —
     * IPv4 전체를 해시해 대조하면 몇 초면 원본이 나온다.
     * 그래서 운영에서는 소금이 없으면 기동하지 않는다.
     */
    hashIp(ip) {
        return (0, node_crypto_1.createHash)('sha256').update(`${config_1.AUDIT_IP_SALT}|${ip}`).digest('hex');
    }
};
exports.AuditService = AuditService;
exports.AuditService = AuditService = __decorate([
    (0, common_1.Injectable)()
], AuditService);
//# sourceMappingURL=audit.service.js.map