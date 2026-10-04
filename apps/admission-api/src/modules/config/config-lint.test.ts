import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { lintConfig } from './config-lint';
import { documentsOf, profileFieldsOf } from './form-schema.service';

/**
 * Config Linter — v1.1 §01 A5
 *
 * 깨진 양식이 승인·적용되면 그 전형의 저장·검증·결제가 모두 503 으로 멈춘다.
 * 초안을 만들 때 런타임과 같은 엔진으로 먼저 걸러낸다.
 */
const GOOD = {
  forms: {
    EARLY: {
      type: 'object',
      required: ['highSchool'],
      properties: {
        highSchool: { type: 'string', maxLength: 100, title: '출신 고등학교', 'x-profile': true },
        academicNote: { type: 'string', maxLength: 1500, title: '학적 사항' },
      },
    },
  },
  requiredDocuments: { EARLY: ['TRANSCRIPT'] },
  optionalDocuments: { EARLY: ['AWARD'] },
  documentLabels: { TRANSCRIPT: '학교생활기록부', AWARD: '수상 실적' },
};

describe('Config Linter (§A5)', () => {
  it('올바른 설정은 오류도 경고도 없다', () => {
    assert.deepEqual(lintConfig(GOOD, ['EARLY']), { errors: [], warnings: [] });
  });

  it('컴파일되지 않는 JSON Schema 는 초안조차 만들지 않는다', () => {
    const broken = structuredClone(GOOD) as { forms: { EARLY: Record<string, unknown> } };
    broken.forms.EARLY.properties = { highSchool: { type: 'strnig' } };
    const r = lintConfig(broken, ['EARLY']);
    assert.ok(r.errors.some((e) => e.startsWith('forms.EARLY: JSON Schema 를 컴파일할 수 없습니다')), r.errors.join('\n'));
  });

  it('정의하지 않은 항목을 필수로 요구하면 오류다 — 누구도 채울 수 없는 원서가 된다', () => {
    const cfg = structuredClone(GOOD) as { forms: { EARLY: { required: string[] } } };
    cfg.forms.EARLY.required = ['highSchool', 'motto'];
    const r = lintConfig(cfg, ['EARLY']);
    assert.ok(r.errors.some((e) => e.includes('motto')));
  });

  it('서류 종류 형식이 틀리면 오류다 (document_type varchar(64))', () => {
    const r = lintConfig({ requiredDocuments: { EARLY: ['생활기록부'] } }, ['EARLY']);
    assert.equal(r.errors.length, 1);
  });

  it('모르는 전형 코드는 경고다 — 전형을 먼저 설정하고 뒤에 만드는 경우가 있다', () => {
    const r = lintConfig(GOOD, ['REGULAR']);
    assert.equal(r.errors.length, 0);
    assert.ok(r.warnings.some((w) => w.includes('forms.EARLY')));
    assert.ok(r.warnings.some((w) => w.includes('requiredDocuments.EARLY')));
  });

  it('이름(title) 없는 항목은 초안을 거절한다 — 화면에 항목 코드가 보인다 (U-29)', () => {
    const r = lintConfig(
      { forms: { EARLY: { type: 'object', properties: { highSchool: { type: 'string' } } } } },
      ['EARLY'],
    );
    assert.ok(r.errors.some((e) => e.includes('title') && e.includes('highSchool')));
  });

  it('공통원서 표시 없는 옛 양식은 경고한다', () => {
    const r = lintConfig(
      { forms: { EARLY: { type: 'object', properties: { highSchool: { type: 'string', title: '출신 고등학교' } } } } },
      ['EARLY'],
    );
    assert.ok(r.warnings.some((w) => w.includes('x-profile')));
  });
});

describe('설정에서 화면 정보 만들기 (§A5, D-56)', () => {
  it('공통원서 항목은 x-profile 표시에서 온다', () => {
    assert.deepEqual(profileFieldsOf(GOOD.forms.EARLY), ['highSchool']);
  });

  it('표시가 없는 옛 양식은 기본 항목 중 양식에 있는 것만 쓴다', () => {
    const legacy = { properties: { highSchool: {}, selfIntro: {} } };
    assert.deepEqual(profileFieldsOf(legacy), ['highSchool']);
  });

  it('서류 목록은 필수 먼저, 이름은 documentLabels 에서', () => {
    assert.deepEqual(documentsOf(GOOD, 'EARLY'), [
      { documentType: 'TRANSCRIPT', label: '학교생활기록부', required: true },
      { documentType: 'AWARD', label: '수상 실적', required: false },
    ]);
  });

  it('필수와 선택에 같은 서류가 있으면 필수로 본다', () => {
    const docs = documentsOf({ requiredDocuments: { A: ['X'] }, optionalDocuments: { A: ['X', 'Y'] } }, 'A');
    assert.deepEqual(docs.map((d) => [d.documentType, d.required]), [['X', true], ['Y', false]]);
  });

  it('자기소개서로 보이는 항목은 경고한다 — 거절하지는 않는다(문서 10 G-1)', () => {
    for (const [code, title] of [['selfIntro', '지원 동기'], ['motivation', '자기소개'], ['essay', '자소서']] as const) {
      const config = {
        forms: { EARLY: { type: 'object', properties: { [code]: { type: 'string', title } } } },
      };
      const r = lintConfig(config, ['EARLY']);
      assert.deepEqual(r.errors, []);
      assert.ok(r.warnings.some((w) => w.includes('자기소개서') && w.includes(title)), `${code}/${title}: ${r.warnings.join(' | ')}`);
    }
  });
});
