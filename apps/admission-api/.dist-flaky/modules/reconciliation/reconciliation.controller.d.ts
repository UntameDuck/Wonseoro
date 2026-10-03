import type { FastifyRequest } from 'fastify';
import { ExceptionState, ReconciliationService } from './reconciliation.service';
export declare class ReconciliationController {
    private readonly reconciliation;
    constructor(reconciliation: ReconciliationService);
    list(state?: string): Promise<{
        exceptions: {
            id: string;
            applicationId: string;
            exceptionType: string;
            severity: import("./reconciliation.service").Severity;
            state: ExceptionState;
            facts: Record<string, unknown>;
            detectedAt: string;
        }[];
    }>;
    run(body: {
        sinceHours?: number;
    }): Promise<import("./reconciliation.service").ReconcileResult>;
    resolve(exceptionId: string, body: {
        resolutionCode?: string;
        reason?: string;
    }, req: FastifyRequest): Promise<{
        id: string;
        state: ExceptionState;
    }>;
}
