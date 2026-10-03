"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const application_state_service_1 = require("./application-state.service");
const svc = new application_state_service_1.ApplicationStateService();
(0, node_test_1.describe)('Application 상태머신 (v1.0 §5.6)', () => {
    (0, node_test_1.it)('정상 경로 전이를 허용한다', () => {
        strict_1.default.ok(svc.can('DRAFT', 'READY'));
        strict_1.default.ok(svc.can('READY', 'PAYMENT_PENDING'));
        strict_1.default.ok(svc.can('PAYMENT_PENDING', 'PAID'));
        strict_1.default.ok(svc.can('PAID', 'FINALIZING'));
        strict_1.default.ok(svc.can('FINALIZING', 'FINALIZED'));
    });
    (0, node_test_1.it)('FINALIZING 에서 재시도 가능 실패로 PAID 로 돌아간다', () => {
        strict_1.default.ok(svc.can('FINALIZING', 'PAID'));
    });
    (0, node_test_1.it)('마감으로 EXPIRED 전이를 허용한다', () => {
        strict_1.default.ok(svc.can('DRAFT', 'EXPIRED'));
        strict_1.default.ok(svc.can('READY', 'EXPIRED'));
    });
    (0, node_test_1.it)('단계를 건너뛰는 전이를 거부한다', () => {
        strict_1.default.equal(svc.can('DRAFT', 'FINALIZED'), false);
        strict_1.default.equal(svc.can('DRAFT', 'PAID'), false);
        strict_1.default.equal(svc.can('READY', 'FINALIZING'), false);
    });
    (0, node_test_1.it)('FINALIZED 는 종착 상태다 — 어디로도 가지 않는다', () => {
        strict_1.default.ok(svc.isTerminal('FINALIZED'));
        strict_1.default.equal(svc.nextStates('FINALIZED').length, 0);
    });
    (0, node_test_1.it)('FINALIZED 원서 변경 시도는 409 로 거부한다', () => {
        strict_1.default.throws(() => svc.assertCan('FINALIZED', 'DRAFT'), (err) => err.problem?.status === 409);
    });
    (0, node_test_1.it)('EXPIRED 도 종착 상태다', () => {
        strict_1.default.ok(svc.isTerminal('EXPIRED'));
    });
    (0, node_test_1.it)('업무필드 수정은 DRAFT/READY 에서만 허용한다', () => {
        strict_1.default.ok(svc.isEditable('DRAFT'));
        strict_1.default.ok(svc.isEditable('READY'));
        strict_1.default.equal(svc.isEditable('PAID'), false);
        strict_1.default.equal(svc.isEditable('FINALIZED'), false);
    });
});
(0, node_test_1.describe)('Finalize 는 한 트랜잭션이다 (D-55)', () => {
    (0, node_test_1.it)('PAID 에서 FINALIZED 로 바로 간다 — FINALIZING 은 DB 에 남지 않는다', () => {
        strict_1.default.ok(svc.can('PAID', 'FINALIZED'));
    });
    (0, node_test_1.it)('그래도 작성 단계에서 접수로 건너뛰지는 못한다', () => {
        strict_1.default.equal(svc.can('DRAFT', 'FINALIZED'), false);
        strict_1.default.equal(svc.can('PAYMENT_PENDING', 'FINALIZED'), false);
    });
    (0, node_test_1.it)('결제가 실패하면 결제 전(READY)으로 돌아간다', () => {
        strict_1.default.ok(svc.can('PAYMENT_PENDING', 'READY'));
    });
    (0, node_test_1.it)('결제를 시작한 원서는 고칠 수 없다', () => {
        strict_1.default.equal(svc.isEditable('PAYMENT_PENDING'), false);
    });
});
//# sourceMappingURL=application-state.test.js.map