import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { toIssue } from './form-schema.service';

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

function issues(data: Record<string, unknown>) {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const fn = ajv.compile(SCHEMA);
  fn(data);
  return (fn.errors ?? []).map((e) => toIssue(e, SCHEMA));
}

describe('검증 문구 (T-M5-52)', () => {
  it('빠진 항목은 항목 이름과 받침에 맞는 조사로 말한다 — 경로는 화면이 칸을 찾도록 남는다', () => {
    const found = issues({ gpa: 1 });
    const hs = found.find((i) => i.path === '/highSchool');
    assert.equal(hs?.message, '출신 고등학교를 입력해 주십시오.');
    assert.equal(found.find((i) => i.path === '/selfIntro')?.message, '자기소개를 입력해 주십시오.');
  });

  it('길이·범위·형식·숫자 오류도 사람 말이다', () => {
    const found = issues({
      highSchool: 'X', selfIntro: '가'.repeat(30), gpa: 7, contactEmail: 'nope', csatNumber: 'abc',
    });
    const by = (p: string) => found.find((i) => i.path === p)?.message;
    assert.equal(by('/highSchool'), '출신 고등학교는 2자 이상 입력해 주십시오.');
    assert.equal(by('/selfIntro'), '자기소개는 20자 이하로 입력해 주십시오.');
    assert.equal(by('/gpa'), '내신 성적은 5 이하로 입력해 주십시오.');
    assert.equal(by('/contactEmail'), '이메일 형식이 올바르지 않습니다. 예: name@example.com');
    assert.equal(by('/csatNumber'), '수험번호 형식이 올바르지 않습니다. (숫자 8자리)', '정규식은 보이지 않고 양식의 안내를 쓴다');
    assert.equal(issues({ highSchool: '한국고', selfIntro: '가'.repeat(12), gpa: '높음' }).find((i) => i.path === '/gpa')?.message, '내신 성적에는 숫자를 입력해 주십시오.');
  });

  it('영문 검증기 문구가 하나도 나가지 않는다', () => {
    const found = issues({ unknownField: 1, gpa: 'x', contactEmail: 'x', csatNumber: 'x', highSchool: '', selfIntro: '' });
    for (const i of found) assert.doesNotMatch(i.message, /must|should|property|characters|equal to|match/, i.message);
  });
});
