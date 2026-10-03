"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const config_diff_1 = require("./config-diff");
/**
 * Diff 의 목적은 "변경을 빠짐없이 나열하는 것" 이 아니라
 * **승인자가 위험한 변경을 놓치지 않게 하는 것**이다.
 * 그래서 테스트도 위험도 판정에 집중한다.
 */
const FORMS = {
    forms: {
        EARLY: {
            type: 'object',
            required: ['highSchool', 'selfIntro'],
            properties: {
                highSchool: { type: 'string', minLength: 2, maxLength: 100 },
                selfIntro: { type: 'string', minLength: 10, maxLength: 1500 },
            },
        },
    },
    fees: { EARLY: 55000 },
};
(0, node_test_1.describe)('Config Diff — 위험한 변경 (v1.1 §A14)', () => {
    (0, node_test_1.it)('전형 양식이 통째로 사라지면 DESTRUCTIVE 다', () => {
        // 실제로 겪은 사고다. 빈 Config 를 절차대로 활성화해 모든 양식이 사라졌다.
        const diff = (0, config_diff_1.diffConfig)(FORMS, { forms: {}, fees: { EARLY: 55000 } });
        const hit = diff.destructive.find((c) => c.path === 'forms.EARLY');
        strict_1.default.ok(hit, '양식 삭제를 승인 화면에 띄우지 못하면 같은 사고가 또 난다');
        strict_1.default.equal(hit.kind, 'REMOVED');
        strict_1.default.match(hit.summary, /삭제/);
    });
    (0, node_test_1.it)('전형료 변경은 DESTRUCTIVE 다', () => {
        // 이미 결제한 지원자와 앞으로 결제할 지원자가 다른 금액을 낸다.
        const diff = (0, config_diff_1.diffConfig)(FORMS, { ...FORMS, fees: { EARLY: 60000 } });
        strict_1.default.equal(diff.destructive.length, 1);
        strict_1.default.equal(diff.destructive[0]?.path, 'fees.EARLY');
    });
    (0, node_test_1.it)('길이 상한을 줄이면 DESTRUCTIVE 다 — 이미 쓴 자기소개서가 오류가 된다', () => {
        const after = structuredClone(FORMS);
        after.forms.EARLY.properties.selfIntro.maxLength = 500;
        const diff = (0, config_diff_1.diffConfig)(FORMS, after);
        strict_1.default.equal(diff.destructive[0]?.path, 'forms.EARLY.properties.selfIntro.maxLength');
    });
    (0, node_test_1.it)('길이 상한을 늘리는 것은 위험하지 않다', () => {
        const after = structuredClone(FORMS);
        after.forms.EARLY.properties.selfIntro.maxLength = 3000;
        strict_1.default.equal((0, config_diff_1.diffConfig)(FORMS, after).destructive.length, 0);
    });
    (0, node_test_1.it)('하한을 올리면 DESTRUCTIVE 다', () => {
        const after = structuredClone(FORMS);
        after.forms.EARLY.properties.highSchool.minLength = 50;
        strict_1.default.equal((0, config_diff_1.diffConfig)(FORMS, after).destructive.length, 1);
    });
    (0, node_test_1.it)('type 이나 pattern 을 바꾸면 DESTRUCTIVE 다', () => {
        const after = structuredClone(FORMS);
        after.forms.EARLY.properties.highSchool.type = 'number';
        strict_1.default.equal((0, config_diff_1.diffConfig)(FORMS, after).destructive.length, 1);
    });
});
(0, node_test_1.describe)('Config Diff — 안전한 변경', () => {
    (0, node_test_1.it)('항목을 더하는 것은 INFO 다', () => {
        const after = structuredClone(FORMS);
        after.forms.EARLY.properties.gpa = { type: 'number' };
        const diff = (0, config_diff_1.diffConfig)(FORMS, after);
        strict_1.default.equal(diff.destructive.length, 0);
        strict_1.default.equal(diff.changes[0]?.kind, 'ADDED');
    });
    (0, node_test_1.it)('필수 항목 추가는 WARN 이다 — 이미 작성한 지원자가 다시 입력해야 한다', () => {
        const after = structuredClone(FORMS);
        after.forms.EARLY.required = ['highSchool', 'selfIntro', 'gpa'];
        const diff = (0, config_diff_1.diffConfig)(FORMS, after);
        const hit = diff.changes.find((c) => c.path.includes('required'));
        strict_1.default.equal(hit?.risk, 'WARN');
    });
    (0, node_test_1.it)('새 전형 추가는 위험하지 않다 — §A5 가 바라는 변경이다', () => {
        const after = structuredClone(FORMS);
        after.forms.REGULAR = { type: 'object', required: [], properties: {} };
        strict_1.default.equal((0, config_diff_1.diffConfig)(FORMS, after).destructive.length, 0);
    });
});
(0, node_test_1.describe)('Diff digest — 승인이 본 것과 같은지', () => {
    (0, node_test_1.it)('바뀐 것이 없으면 identical 이다', () => {
        const diff = (0, config_diff_1.diffConfig)(FORMS, structuredClone(FORMS));
        strict_1.default.equal(diff.identical, true);
        strict_1.default.equal(diff.changes.length, 0);
    });
    (0, node_test_1.it)('같은 변경은 같은 digest 를 낸다', () => {
        const after = structuredClone(FORMS);
        after.fees.EARLY = 60000;
        strict_1.default.equal((0, config_diff_1.diffConfig)(FORMS, after).digest, (0, config_diff_1.diffConfig)(FORMS, structuredClone(after)).digest);
    });
    (0, node_test_1.it)('값만 달라져도 digest 가 달라진다', () => {
        // 60,000 을 보고 한 승인이 99,000 을 통과시키면 안 된다.
        const a = structuredClone(FORMS);
        a.fees.EARLY = 60000;
        const b = structuredClone(FORMS);
        b.fees.EARLY = 99000;
        strict_1.default.notEqual((0, config_diff_1.diffConfig)(FORMS, a).digest, (0, config_diff_1.diffConfig)(FORMS, b).digest);
    });
    (0, node_test_1.it)('기준이 달라지면 digest 도 달라진다', () => {
        // 승인은 "이 변경에 동의한다" 는 뜻이다. 본 뒤에 기준이 바뀌면
        // 같은 승인이 다른 의미가 된다.
        const after = structuredClone(FORMS);
        after.fees.EARLY = 60000;
        const otherBase = structuredClone(FORMS);
        otherBase.forms.EARLY.required = ['highSchool'];
        strict_1.default.notEqual((0, config_diff_1.diffConfig)(FORMS, after).digest, (0, config_diff_1.diffConfig)(otherBase, after).digest);
    });
    (0, node_test_1.it)('위험한 변경이 먼저 나온다 — 아래로 밀리면 안 읽힌다', () => {
        const after = structuredClone(FORMS);
        after.forms.EARLY.properties.gpa = { type: 'number' };
        after.fees.EARLY = 60000;
        const diff = (0, config_diff_1.diffConfig)(FORMS, after);
        strict_1.default.equal(diff.changes[0]?.risk, 'DESTRUCTIVE');
    });
});
(0, node_test_1.describe)('Config Diff — 요약은 승인자가 읽을 말이다 (T-M5-51, U-42)', () => {
    const TITLED = {
        forms: {
            EARLY: {
                type: 'object',
                properties: {
                    gpa: { type: 'number', maximum: 5, title: '내신 성적' },
                    selfIntro: { type: 'string', maxLength: 1500, title: '자기소개' },
                },
            },
        },
        fees: { EARLY: 55000 },
        documentLabels: { TRANSCRIPT: '학교생활기록부' },
    };
    const NAMES = { EARLY: '학생부종합전형' };
    (0, node_test_1.it)('항목 삭제는 전형 이름과 항목 이름으로 말한다 — 경로는 path 에 남는다', () => {
        const after = structuredClone(TITLED);
        delete after.forms.EARLY.properties.gpa;
        const hit = (0, config_diff_1.diffConfig)(TITLED, after, NAMES).changes.find((c) => c.path === 'forms.EARLY.properties.gpa');
        strict_1.default.ok(hit);
        strict_1.default.match(hit.summary, /^학생부종합전형 — '내신 성적' 항목이 삭제됩니다/);
    });
    (0, node_test_1.it)('제약 변경·전형료 변경도 이름으로 말한다', () => {
        const after = structuredClone(TITLED);
        after.forms.EARLY.properties.selfIntro.maxLength = 500;
        after.fees.EARLY = 60000;
        const summaries = (0, config_diff_1.diffConfig)(TITLED, after, NAMES).changes.map((c) => c.summary);
        strict_1.default.ok(summaries.includes("학생부종합전형 — '자기소개' 항목의 최대 글자 수가 1500 → 500(으)로 바뀝니다."), summaries.join('\n'));
        strict_1.default.ok(summaries.includes('학생부종합전형 전형료가 55000 → 60000(으)로 바뀝니다.'), summaries.join('\n'));
    });
    (0, node_test_1.it)('이름을 모르면 코드로 말하되 설정 경로를 쏟지 않는다', () => {
        const after = structuredClone(TITLED);
        after.fees.EARLY = 60000;
        const [change] = (0, config_diff_1.diffConfig)(TITLED, after).changes;
        strict_1.default.equal(change?.summary, 'EARLY 전형 전형료가 55000 → 60000(으)로 바뀝니다.');
    });
});
//# sourceMappingURL=config-diff.test.js.map