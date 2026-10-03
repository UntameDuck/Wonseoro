import type { FastifyInstance } from 'fastify';
import { type WorkloadIdentity } from '@wonseoro/server-kit';
/**
 * 내부 경로(`/internal/**`)의 상호 TLS 인증 — 대학 API (T-M5-05·09, docs/13 B1~B4, D-69)
 *
 * 서류 검사 워커만 부르는 경로 둘이다(검사 대기 목록 — 서류 내려받기 주소가 들어 있다 — 과 검사 결과 보고).
 * 전에는 공개 경로와 같은 포트에서 인증 없이 열려 있었다. 앞단이 경로를 거르지 않으면 바깥에서 지원자 서류를 받아 가거나
 * 악성 파일을 "깨끗함" 으로 보고할 수 있었다. 이제 **같은 대학의 서류 워커 인증서**만 받는다.
 * `INTERNAL_AUTH=none`(개발·단위 시험)이면 검사하지 않는다 — 운영에서는 기동이 막힌다.
 */
declare module 'fastify' {
    interface FastifyRequest {
        internalPeer?: WorkloadIdentity | null;
    }
}
/** 경로 → 부를 수 있는 워크로드(이 대학의 것만) */
export declare const INTERNAL_ROUTES: Record<string, readonly string[]>;
/** 어느 워크로드가 이 경로를 부를 수 있나 — 신원이 없으면 401, 있지만 아니면 403 */
export declare function internalDecision(method: string, url: string, identity: WorkloadIdentity | null): 'ok' | 401 | 403;
export declare function installInternalAuth(fastify: FastifyInstance): void;
