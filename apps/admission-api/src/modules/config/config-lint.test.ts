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
  consents: [
    { code: 'APPLICATION_COLLECTION', title: '개인정보 수집·이용', text: '수집 목적: 입학전형', required: true, version: 'v1' },
  ],
  notices: {
    privacyPolicyUrl: 'https://univ.example/privacy',
    privacyOfficer: '입학처 개인정보 보호 담당',
    feeRefund: '착오로 더 낸 전형료는 더 낸 금액을 돌려드립니다.',
    applicationRules: '수시모집은 최대 6회까지 지원할 수 있습니다. 위반하면 입학이 무효가 됩니다.',
  },
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

  it('민감정보 서류는 별도 동의 코드를 싣는다 (G-8, D-85)', () => {
    const docs = documentsOf({ ...GOOD, sensitiveDocuments: { AWARD: 'SENSITIVE_HEALTH' } }, 'EARLY');
    assert.deepEqual(docs[1], { documentType: 'AWARD', label: '수상 실적', required: false, sensitiveConsentCode: 'SENSITIVE_HEALTH' });
    assert.equal('sensitiveConsentCode' in docs[0]!, false);
  });

  it('민감정보 서류 — 없는 동의를 가리키면 오류, 필수 동의·안 받는 서류는 경고, 민감해 보이는데 표시가 없으면 경고 (G-8, D-85)', () => {
    const health = { code: 'SENSITIVE_HEALTH', title: '민감정보 처리', text: '장애 수험생 편의 제공', required: false, version: 'v1' };
    const cert = {
      ...GOOD,
      optionalDocuments: { EARLY: ['AWARD', 'DISABILITY_CERT'] },
      documentLabels: { ...GOOD.documentLabels, DISABILITY_CERT: '장애인 증명서' },
    };
    // 표시가 없으면 경고 — 서류 이름에서 알아본다
    assert.ok(lintConfig(cert, ['EARLY']).warnings.some((w) => w.startsWith('sensitiveDocuments:') && w.includes('장애인 증명서')));
    // 올바르게 표시하면 오류도 경고도 없다
    const marked = { ...cert, consents: [...GOOD.consents, health], sensitiveDocuments: { DISABILITY_CERT: 'SENSITIVE_HEALTH' } };
    assert.deepEqual(lintConfig(marked, ['EARLY']), { errors: [], warnings: [] });
    // 문안이 없는 동의를 가리키면 아무도 올릴 수 없다 — 거절
    assert.ok(lintConfig({ ...cert, sensitiveDocuments: { DISABILITY_CERT: 'NOPE' } }, ['EARLY']).errors.some((e) => e.includes('consents 에 없습니다')));
    // 필수 동의면 모든 지원자가 동의해야 한다 — 경고
    const required = lintConfig({ ...marked, consents: [...GOOD.consents, { ...health, required: true }] }, ['EARLY']);
    assert.ok(required.warnings.some((w) => w.includes('필수를 풀어')));
    // 어느 전형도 받지 않는 서류
    assert.ok(lintConfig({ ...marked, sensitiveDocuments: { ...marked.sensitiveDocuments, MEDICAL_NOTE: 'SENSITIVE_HEALTH' } }, ['EARLY']).warnings.some((w) => w.includes('받지 않는 서류')));
    // 형식
    assert.ok(lintConfig({ ...GOOD, sensitiveDocuments: ['X'] }, ['EARLY']).errors.some((e) => e.startsWith('sensitiveDocuments')));
  });

  it('항목 단위 별도 동의 — 없는 동의는 오류, 필수 동의·필수 항목은 경고, 여권번호로 보이는데 표시가 없으면 경고 (G-9, D-88)', () => {
    const passport = { code: 'PASSPORT_COLLECTION', title: '여권번호 수집', text: '외국인 지원자 본인 확인', required: false, version: 'v1' };
    const withField = (prop: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
      ...GOOD,
      consents: [...GOOD.consents, passport],
      forms: { EARLY: { ...GOOD.forms.EARLY, properties: { ...GOOD.forms.EARLY.properties, passportNumber: { type: 'string', title: '여권번호', ...prop } } }, ...extra },
    });
    assert.ok(lintConfig(withField({}), ['EARLY']).warnings.some((w) => w.includes('고유식별정보로 보입니다')));
    assert.deepEqual(lintConfig(withField({ 'x-sensitive-consent': 'PASSPORT_COLLECTION' }), ['EARLY']), { errors: [], warnings: [] });
    assert.ok(lintConfig(withField({ 'x-sensitive-consent': 'NOPE' }), ['EARLY']).errors.some((e) => e.includes('consents 에 없습니다')));
    assert.ok(lintConfig(withField({ 'x-sensitive-consent': 'bad code' }), ['EARLY']).errors.some((e) => e.includes('x-sensitive-consent')));
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

  it('지원자 고지 — 없으면 경고, 빠진 법정 고지는 경고, 형식이 틀리면 오류 (G-4·G-6, D-80)', () => {
    const { notices: _n, ...without } = GOOD;
    assert.ok(lintConfig(without, ['EARLY']).warnings.some((w) => w.startsWith('notices:')));

    const partial = lintConfig({ ...GOOD, notices: { privacyPolicyUrl: 'https://univ.example/privacy' } }, ['EARLY']);
    assert.deepEqual(partial.errors, []);
    assert.ok(partial.warnings.some((w) => w.includes('privacyOfficer') && w.includes('feeRefund')));

    const bad = lintConfig(
      { ...GOOD, notices: { ...GOOD.notices, privacyPolicyUrl: 'http://univ.example/privacy', contact: '', feeRefund: 'x'.repeat(2001) } },
      ['EARLY'],
    );
    assert.ok(bad.errors.some((e) => e.includes('notices.privacyPolicyUrl') && e.includes('https')));
    assert.ok(bad.errors.some((e) => e.includes('notices.contact')));
    assert.ok(bad.errors.some((e) => e.includes('notices.feeRefund')));
    assert.ok(lintConfig({ ...GOOD, notices: 'x' }, ['EARLY']).errors.some((e) => e.startsWith('notices')));
  });

  it('원서 동의 — 없으면 경고, 필수가 없으면 경고, 형식이 틀리면 오류 (G-2, D-81)', () => {
    const { consents: _c, ...without } = GOOD;
    assert.ok(lintConfig(without, ['EARLY']).warnings.some((w) => w.startsWith('consents:')));
    const optionalOnly = lintConfig({ ...GOOD, consents: [{ ...GOOD.consents[0], required: false }] }, ['EARLY']);
    assert.deepEqual(optionalOnly.errors, []);
    assert.ok(optionalOnly.warnings.some((w) => w.includes('필수 동의가 없습니다')));
    const bad = lintConfig(
      { ...GOOD, consents: [GOOD.consents[0], GOOD.consents[0], { code: 'PROFILE_SNAPSHOT', title: '', text: 'x', version: 'v1' }, { code: 'lower', title: 't', text: 'x'.repeat(4001), version: 'v1', required: 'yes' }] },
      ['EARLY'],
    );
    for (const want of ['두 번', '공통원서 제공', 'title', 'consents[3].code', 'consents[3].text', 'consents[3].required']) {
      assert.ok(bad.errors.some((e) => e.includes(want)), `${want}: ${bad.errors.join(' | ')}`);
    }
  });
});
