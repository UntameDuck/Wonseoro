"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const ajv_1 = __importDefault(require("ajv"));
const ajv_formats_1 = __importDefault(require("ajv-formats"));
const form_schema_service_1 = require("./form-schema.service");
/**
 * 검증 문구는 지원자가 읽는 문장이다 (T-M5-52, U-1).
 * 전에는 `highSchool — must have required property 'highSchool'` 처럼 검증기 영문 원문과 항목 코드가 나갔다.
 */
const SCHEMA = {
    type: 'object',
    required: ['highSchool', 'selfIntro', 'gpa'],
    additionalProperties: false,
    properties: {
        highSchool: { type: 'string', minLength: 2, maxLength: 100, title: '출신 고등학교' },
        selfIntro: { type: 'string', minLength: 10, maxLength: 20, title: '자기소개' },
        gpa: { type: 'number', minimum: 0, maximum: 5, title: '내신 성적' },
        contactEmail: { type: 'string', format: 'email', title: '이메일' },
        csatNumber: { type: 'string', pattern: '^[0-9]{8}$', title: '수험번호', description: '숫자 8자리' },
    },
};
function issues(data) {
    const ajv = new ajv_1.default({ allErrors: true, strict: false });
    (0, ajv_formats_1.default)(ajv);
    const fn = ajv.compile(SCHEMA);
    fn(data);
    return (fn.errors ?? []).map((e) => (0, form_schema_service_1.toIssue)(e, SCHEMA));
}
(0, node_test_1.describe)('검증 문구 (T-M5-52)', () => {
    (0, node_test_1.it)('빠진 항목은 항목 이름과 받침에 맞는 조사로 말한다 — 경로는 화면이 칸을 찾도록 남는다', () => {
        const found = issues({ gpa: 1 });
        const hs = found.find((i) => i.path === '/highSchool');
        strict_1.default.equal(hs?.message, '출신 고등학교를 입력해 주십시오.');
        strict_1.default.equal(found.find((i) => i.path === '/selfIntro')?.message, '자기소개를 입력해 주십시오.');
    });
    (0, node_test_1.it)('길이·범위·형식·숫자 오류도 사람 말이다', () => {
        const found = issues({
            highSchool: 'X', selfIntro: '가'.repeat(30), gpa: 7, contactEmail: 'nope', csatNumber: 'abc',
        });
        const by = (p) => found.find((i) => i.path === p)?.message;
        strict_1.default.equal(by('/highSchool'), '출신 고등학교는 2자 이상 입력해 주십시오.');
        strict_1.default.equal(by('/selfIntro'), '자기소개는 20자 이하로 입력해 주십시오.');
        strict_1.default.equal(by('/gpa'), '내신 성적은 5 이하로 입력해 주십시오.');
        strict_1.default.equal(by('/contactEmail'), '이메일 형식이 올바르지 않습니다. 예: name@example.com');
        strict_1.default.equal(by('/csatNumber'), '수험번호 형식이 올바르지 않습니다. (숫자 8자리)', '정규식은 보이지 않고 양식의 안내를 쓴다');
        strict_1.default.equal(issues({ highSchool: '한국고', selfIntro: '가'.repeat(12), gpa: '높음' }).find((i) => i.path === '/gpa')?.message, '내신 성적에는 숫자를 입력해 주십시오.');
    });
    (0, node_test_1.it)('영문 검증기 문구가 하나도 나가지 않는다', () => {
        const found = issues({ unknownField: 1, gpa: 'x', contactEmail: 'x', csatNumber: 'x', highSchool: '', selfIntro: '' });
        for (const i of found)
            strict_1.default.doesNotMatch(i.message, /must|should|property|characters|equal to|match/, i.message);
    });
});
//# sourceMappingURL=form-schema-messages.test.js.map