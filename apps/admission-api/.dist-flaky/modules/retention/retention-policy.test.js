"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const contracts_1 = require("@wonseoro/contracts");
const config_diff_1 = require("../config/config-diff");
const retention_fixture_1 = require("./retention.fixture");
const codes = (input) => (0, contracts_1.validateRetention)(input).map((p) => p.category);
(0, node_test_1.describe)('보존 정책 검증 (v1.1 §A15)', () => {
    (0, node_test_1.it)('기준을 모두 만족하면 문제가 없다', () => {
        strict_1.default.deepEqual((0, contracts_1.validateRetention)(retention_fixture_1.VALID_RETENTION), []);
    });
    (0, node_test_1.it)('법정 기준보다 짧게 정할 수 없다 — 관리자 접속기록 2년', () => {
        const problems = (0, contracts_1.validateRetention)({ ...retention_fixture_1.VALID_RETENTION, ADMIN_ACCESS_LOG: { days: 365 } });
        strict_1.default.equal(problems.length, 1);
        strict_1.default.equal(problems[0].category, 'ADMIN_ACCESS_LOG');
        strict_1.default.match(problems[0].message, /730/);
    });
    (0, node_test_1.it)('접수 원서는 10년보다 짧게 정할 수 없다 — 입시관리 기록물 (D-38)', () => {
        const problems = (0, contracts_1.validateRetention)({ ...retention_fixture_1.VALID_RETENTION, APPLICATION_SUBMITTED: { days: 1825 } });
        strict_1.default.deepEqual(problems.map((p) => p.category), ['APPLICATION_SUBMITTED']);
        strict_1.default.match(problems[0].message, /3650/);
    });
    (0, node_test_1.it)('결제·동의 기록은 정합성 규칙으로 접수 원서의 10년을 따라간다', () => {
        const problems = (0, contracts_1.validateRetention)({
            ...retention_fixture_1.VALID_RETENTION,
            PAYMENT_RECORD: { days: 1825 },
            CONSENT_RECORD: { days: 1825 },
        });
        strict_1.default.deepEqual(problems.map((p) => p.category).sort(), ['CONSENT_RECORD', 'PAYMENT_RECORD']);
    });
    (0, node_test_1.it)('빠진 항목을 기본값으로 채우지 않는다 — 명시해야 한다', () => {
        const { DOCUMENT_FILE: _omit, ...rest } = retention_fixture_1.VALID_RETENTION;
        strict_1.default.deepEqual(codes(rest), ['DOCUMENT_FILE']);
    });
    (0, node_test_1.it)('감사 기록·적용 기록에는 보존기간을 정할 수 없다', () => {
        strict_1.default.deepEqual(codes({ ...retention_fixture_1.VALID_RETENTION, AUDIT_EVENT: { days: 3650 }, ACTIVATION_RECORD: { days: 3650 } }), ['AUDIT_EVENT', 'ACTIVATION_RECORD']);
    });
    (0, node_test_1.it)('모르는 데이터 종류와 잘못된 값은 거절한다', () => {
        strict_1.default.ok(codes({ ...retention_fixture_1.VALID_RETENTION, CHAT_LOG: { days: 30 } }).includes('CHAT_LOG'));
        strict_1.default.ok(codes({ ...retention_fixture_1.VALID_RETENTION, DOCUMENT_FILE: { days: 0 } }).includes('DOCUMENT_FILE'));
        strict_1.default.ok(codes({ ...retention_fixture_1.VALID_RETENTION, DOCUMENT_FILE: { days: 1.5 } }).includes('DOCUMENT_FILE'));
        // 일 대신 초를 넣는 식의 단위 착각.
        strict_1.default.ok(codes({ ...retention_fixture_1.VALID_RETENTION, DOCUMENT_FILE: { days: 31_536_000 } }).includes('DOCUMENT_FILE'));
        strict_1.default.deepEqual(codes([]), ['*']);
    });
    (0, node_test_1.it)('동의 기록은 그 동의로 처리한 데이터보다 먼저 사라지면 안 된다', () => {
        const problems = (0, contracts_1.validateRetention)({ ...retention_fixture_1.VALID_RETENTION, CONSENT_RECORD: { days: 365 } });
        // 접수 원서·신원이 365 일보다 길다. 둘 다 알려준다. (서류는 정확히 365 일이라 괜찮다)
        strict_1.default.equal(problems.filter((p) => p.category === 'CONSENT_RECORD').length, 2);
    });
    (0, node_test_1.it)('결제 기록은 접수 원서보다 먼저 사라지면 안 된다 — 접수 증적이 깨진다', () => {
        strict_1.default.deepEqual(codes({ ...retention_fixture_1.VALID_RETENTION, PAYMENT_RECORD: { days: 365 } }), ['PAYMENT_RECORD']);
    });
    (0, node_test_1.it)('문제는 한 번에 모두 알려준다', () => {
        const problems = (0, contracts_1.validateRetention)({
            ADMIN_ACCESS_LOG: { days: 30 },
            AUDIT_EVENT: { days: 10 },
        });
        // 법정 미달 1 + 불변 1 + 누락 6
        strict_1.default.equal(problems.length, 8);
    });
});
(0, node_test_1.describe)('보존기간 변경의 위험도 (Diff)', () => {
    (0, node_test_1.it)('줄이면 파기가 앞당겨진다 — DESTRUCTIVE', () => {
        const diff = (0, config_diff_1.diffConfig)({ retention: retention_fixture_1.VALID_RETENTION }, { retention: { ...retention_fixture_1.VALID_RETENTION, DOCUMENT_FILE: { days: 180 } } });
        strict_1.default.equal(diff.destructive.length, 1);
        strict_1.default.equal(diff.destructive[0].path, 'retention.DOCUMENT_FILE.days');
    });
    (0, node_test_1.it)('늘리는 것은 되돌릴 수 있다 — INFO', () => {
        const diff = (0, config_diff_1.diffConfig)({ retention: retention_fixture_1.VALID_RETENTION }, { retention: { ...retention_fixture_1.VALID_RETENTION, DOCUMENT_FILE: { days: 730 } } });
        strict_1.default.equal(diff.destructive.length, 0);
        strict_1.default.equal(diff.changes[0].risk, 'INFO');
    });
    (0, node_test_1.it)('보존정책을 통째로 지우는 것은 DESTRUCTIVE', () => {
        const diff = (0, config_diff_1.diffConfig)({ retention: retention_fixture_1.VALID_RETENTION, forms: {} }, { forms: {} });
        strict_1.default.equal(diff.destructive[0].path, 'retention');
    });
});
//# sourceMappingURL=retention-policy.test.js.map