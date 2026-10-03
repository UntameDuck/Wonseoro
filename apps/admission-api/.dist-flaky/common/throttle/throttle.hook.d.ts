import type { FastifyInstance } from 'fastify';
import { AdaptiveThrottle } from './adaptive-throttle';
export declare function installAdaptiveThrottle(fastify: FastifyInstance, throttle?: AdaptiveThrottle): AdaptiveThrottle | null;
/** 소유권 검사가 부른다(ownership.service). 훅이 걸려 있지 않으면(off·시험) 아무것도 하지 않는다. */
export declare function noteOwnershipMiss(applicantId: string): void;
