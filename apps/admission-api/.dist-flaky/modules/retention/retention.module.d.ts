import { RetentionService } from './retention.service';
/**
 * Retention Matrix 조회 — v1.1 §A15 (T-M3-10)
 *
 * 보존정책 **설정**은 여기 없다. Config 의 `retention` 섹션으로 들어가서
 * 2인 승인·Diff·서명된 적용 기록을 그대로 탄다. 보존기간을 줄이는 것은 파기를
 * 앞당기는 일이라 Diff 에서 DESTRUCTIVE 로 보인다.
 *
 * 계약: OpenAPI getRetentionMatrix · getRetentionPlan (D-38). 관리자 콘솔 `/retention` 이 보여 준다.
 */
export declare class RetentionController {
    private readonly retention;
    constructor(retention: RetentionService);
    /** 데이터 종류별 하한과 근거. 설정 화면이 이것을 보고 입력칸을 그린다. */
    matrix(): {
        categories: {
            readonly APPLICATION_UNSUBMITTED: {
                readonly label: "\uC811\uC218\uB418\uC9C0 \uC54A\uC740 \uC6D0\uC11C (\uC791\uC131 \uC911\u00B7\uCDE8\uC18C\u00B7\uB9CC\uB8CC)";
                readonly anchor: "CYCLE_CLOSED";
                readonly floor: {
                    readonly kind: "INSTITUTION";
                    readonly basis: "\uAC01 \uB300\uD559 \uAC1C\uC778\uC815\uBCF4\uCC98\uB9AC\uBC29\uCE68\u00B7\uC785\uC2DC\uC5C5\uBB34 \uADDC\uC815";
                };
                readonly purge: "CONTENT";
                readonly personal: true;
            };
            readonly APPLICATION_SUBMITTED: {
                readonly label: "\uC811\uC218\uB41C \uC6D0\uC11C \uBCF8\uBB38\uACFC \uC811\uC218 \uC6D0\uC7A5";
                readonly anchor: "CYCLE_CLOSED";
                readonly floor: {
                    readonly kind: "LEGAL";
                    readonly days: 3650;
                    readonly basis: "\uACF5\uACF5\uAE30\uB85D\uBB3C \uAD00\uB9AC\uC5D0 \uAD00\uD55C \uBC95\uB960 \u00B7 \uB300\uD559 \uAE30\uB85D\uBB3C \uBCF4\uC874\uAE30\uAC04 \uCC45\uC815\uAE30\uC900 \uAC00\uC774\uB4DC(\uAD6D\uAC00\uAE30\uB85D\uC6D0, 2021) \uC785\uC2DC\uAD00\uB9AC\uC5C5\uBB34 10\uB144 \u00B7 \uB300\uD559\uC785\uD559\uC804\uD615\uAE30\uBCF8\uC0AC\uD56D";
                };
                readonly purge: "CONTENT";
                readonly personal: true;
            };
            readonly APPLICANT_PII: {
                readonly label: "\uC9C0\uC6D0\uC790 \uC2E0\uC6D0\uC815\uBCF4 (\uC554\uD638\uD654 \uC800\uC7A5\uBD84)";
                readonly anchor: "CYCLE_CLOSED";
                readonly floor: {
                    readonly kind: "INSTITUTION";
                    readonly basis: "\uAC01 \uB300\uD559 \uAC1C\uC778\uC815\uBCF4\uCC98\uB9AC\uBC29\uCE68\u00B7\uC785\uC2DC\uC5C5\uBB34 \uADDC\uC815";
                };
                readonly purge: "CONTENT";
                readonly personal: true;
            };
            readonly DOCUMENT_FILE: {
                readonly label: "\uC81C\uCD9C \uC11C\uB958 \uD30C\uC77C";
                readonly anchor: "CYCLE_CLOSED";
                readonly floor: {
                    readonly kind: "INSTITUTION";
                    readonly basis: "\uAC01 \uB300\uD559 \uAC1C\uC778\uC815\uBCF4\uCC98\uB9AC\uBC29\uCE68\u00B7\uC785\uC2DC\uC5C5\uBB34 \uADDC\uC815";
                };
                readonly purge: "OBJECT";
                readonly personal: true;
            };
            readonly PAYMENT_RECORD: {
                readonly label: "\uC804\uD615\uB8CC \uACB0\uC81C \uAE30\uB85D";
                readonly anchor: "CYCLE_CLOSED";
                readonly floor: {
                    readonly kind: "INSTITUTION";
                    readonly basis: "\uAC01 \uB300\uD559 \uAC1C\uC778\uC815\uBCF4\uCC98\uB9AC\uBC29\uCE68\u00B7\uC785\uC2DC\uC5C5\uBB34 \uADDC\uC815";
                };
                readonly purge: "CONTENT";
                readonly personal: false;
            };
            readonly CONSENT_RECORD: {
                readonly label: "\uAC1C\uC778\uC815\uBCF4 \uC218\uC9D1\u00B7\uC81C\uACF5 \uB3D9\uC758 \uAE30\uB85D";
                readonly anchor: "CYCLE_CLOSED";
                readonly floor: {
                    readonly kind: "INSTITUTION";
                    readonly basis: "\uAC01 \uB300\uD559 \uAC1C\uC778\uC815\uBCF4\uCC98\uB9AC\uBC29\uCE68\u00B7\uC785\uC2DC\uC5C5\uBB34 \uADDC\uC815";
                };
                readonly purge: "CONTENT";
                readonly personal: false;
            };
            readonly ADMIN_ACCESS_LOG: {
                readonly label: "\uAC1C\uC778\uC815\uBCF4 \uAD00\uB9AC\uC790 \uC811\uC18D\uAE30\uB85D";
                readonly anchor: "EVENT_TIME";
                readonly floor: {
                    readonly kind: "LEGAL";
                    readonly days: 730;
                    readonly basis: "\uAC1C\uC778\uC815\uBCF4\uC758 \uC548\uC804\uC131 \uD655\uBCF4\uC870\uCE58 \uAE30\uC900 \uC81C8\uC870 \u2014 2\uB144 \uC774\uC0C1";
                };
                readonly purge: "NONE";
                readonly personal: false;
            };
            readonly AUDIT_EVENT: {
                readonly label: "\uAC10\uC0AC \uAE30\uB85D (\uC704\uBCC0\uC870 \uAC80\uCD9C \uCCB4\uC778)";
                readonly anchor: "EVENT_TIME";
                readonly floor: {
                    readonly kind: "IMMUTABLE";
                    readonly basis: "\uC811\uC218 \uBD84\uC7C1\uC758 \uC99D\uAC70 \u2014 \uC6B4\uC601\uC790\uB3C4 \uC9C0\uC6B0\uAC70\uB098 \uACE0\uCE60 \uC218 \uC5C6\uB2E4";
                };
                readonly purge: "NONE";
                readonly personal: false;
            };
            readonly ACTIVATION_RECORD: {
                readonly label: "\uB9C8\uAC10\u00B7\uC124\uC815 \uC801\uC6A9 \uAE30\uB85D (\uC11C\uBA85)";
                readonly anchor: "EVENT_TIME";
                readonly floor: {
                    readonly kind: "IMMUTABLE";
                    readonly basis: "\uB9C8\uAC10\u00B7\uC124\uC815 \uBCC0\uACBD\uC758 \uC99D\uAC70 \u2014 \uACE0\uCE60 \uC218 \uC5C6\uB294 \uC11C\uBA85 \uAE30\uB85D";
                };
                readonly purge: "NONE";
                readonly personal: false;
            };
        };
    };
    /** 지금 적용 중인 정책으로 무엇이 언제 파기 대상인가. 지우지 않는다. */
    plan(cycleId?: string): Promise<{
        cycleId: string;
        cycleClosesAt: string;
        configVersion: string | null;
        configured: boolean;
        problems: import("@wonseoro/contracts").RetentionProblem[];
        items: import("./retention.service").RetentionPlanItem[];
        executes: false;
        generatedAt: string;
    }>;
}
export declare class RetentionModule {
}
