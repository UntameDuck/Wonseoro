import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { diffConfig } from './config-diff';

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

describe('Config Diff — 위험한 변경 (v1.1 §A14)', () => {
  it('전형 양식이 통째로 사라지면 DESTRUCTIVE 다', () => {
    // 실제로 겪은 사고다. 빈 Config 를 절차대로 활성화해 모든 양식이 사라졌다.
    const diff = diffConfig(FORMS, { forms: {}, fees: { EARLY: 55000 } });
    const hit = diff.destructive.find((c) => c.path === 'forms.EARLY');
    assert.ok(hit, '양식 삭제를 승인 화면에 띄우지 못하면 같은 사고가 또 난다');
    assert.equal(hit.kind, 'REMOVED');
    assert.match(hit.summary, /삭제/);
  });

  it('전형료 변경은 DESTRUCTIVE 다', () => {
    // 이미 결제한 지원자와 앞으로 결제할 지원자가 다른 금액을 낸다.
    const diff = diffConfig(FORMS, { ...FORMS, fees: { EARLY: 60000 } });
    assert.equal(diff.destructive.length, 1);
    assert.equal(diff.destructive[0]?.path, 'fees.EARLY');
  });

  it('길이 상한을 줄이면 DESTRUCTIVE 다 — 이미 쓴 자기소개서가 오류가 된다', () => {
    const after = structuredClone(FORMS);
    after.forms.EARLY.properties.selfIntro.maxLength = 500;
    const diff = diffConfig(FORMS, after);
    assert.equal(diff.destructive[0]?.path, 'forms.EARLY.properties.selfIntro.maxLength');
  });

  it('길이 상한을 늘리는 것은 위험하지 않다', () => {
    const after = structuredClone(FORMS);
    after.forms.EARLY.properties.selfIntro.maxLength = 3000;
    assert.equal(diffConfig(FORMS, after).destructive.length, 0);
  });

  it('하한을 올리면 DESTRUCTIVE 다', () => {
    const after = structuredClone(FORMS);
    after.forms.EARLY.properties.highSchool.minLength = 50;
    assert.equal(diffConfig(FORMS, after).destructive.length, 1);
  });

  it('type 이나 pattern 을 바꾸면 DESTRUCTIVE 다', () => {
    const after = structuredClone(FORMS);
    (after.forms.EARLY.properties.highSchool as { type: string }).type = 'number';
    assert.equal(diffConfig(FORMS, after).destructive.length, 1);
  });
});

describe('Config Diff — 안전한 변경', () => {
  it('항목을 더하는 것은 INFO 다', () => {
    const after = structuredClone(FORMS) as typeof FORMS & { forms: { EARLY: { properties: Record<string, unknown> } } };
    after.forms.EARLY.properties.gpa = { type: 'number' };
    const diff = diffConfig(FORMS, after);
    assert.equal(diff.destructive.length, 0);
    assert.equal(diff.changes[0]?.kind, 'ADDED');
  });

  it('필수 항목 추가는 WARN 이다 — 이미 작성한 지원자가 다시 입력해야 한다', () => {
    const after = structuredClone(FORMS);
    after.forms.EARLY.required = ['highSchool', 'selfIntro', 'gpa'];
    const diff = diffConfig(FORMS, after);
    const hit = diff.changes.find((c) => c.path.includes('required'));
    assert.equal(hit?.risk, 'WARN');
  });

  it('새 전형 추가는 위험하지 않다 — §A5 가 바라는 변경이다', () => {
    const after = structuredClone(FORMS) as typeof FORMS & { forms: Record<string, unknown> };
    after.forms.REGULAR = { type: 'object', required: [], properties: {} };
    assert.equal(diffConfig(FORMS, after).destructive.length, 0);
  });
});

describe('Diff digest — 승인이 본 것과 같은지', () => {
  it('바뀐 것이 없으면 identical 이다', () => {
    const diff = diffConfig(FORMS, structuredClone(FORMS));
    assert.equal(diff.identical, true);
    assert.equal(diff.changes.length, 0);
  });

  it('같은 변경은 같은 digest 를 낸다', () => {
    const after = structuredClone(FORMS);
    after.fees.EARLY = 60000;
    assert.equal(diffConfig(FORMS, after).digest, diffConfig(FORMS, structuredClone(after)).digest);
  });

  it('값만 달라져도 digest 가 달라진다', () => {
    // 60,000 을 보고 한 승인이 99,000 을 통과시키면 안 된다.
    const a = structuredClone(FORMS); a.fees.EARLY = 60000;
    const b = structuredClone(FORMS); b.fees.EARLY = 99000;
    assert.notEqual(diffConfig(FORMS, a).digest, diffConfig(FORMS, b).digest);
  });

  it('기준이 달라지면 digest 도 달라진다', () => {
    // 승인은 "이 변경에 동의한다" 는 뜻이다. 본 뒤에 기준이 바뀌면
    // 같은 승인이 다른 의미가 된다.
    const after = structuredClone(FORMS);
    after.fees.EARLY = 60000;

    const otherBase = structuredClone(FORMS);
    otherBase.forms.EARLY.required = ['highSchool'];

    assert.notEqual(diffConfig(FORMS, after).digest, diffConfig(otherBase, after).digest);
  });

  it('위험한 변경이 먼저 나온다 — 아래로 밀리면 안 읽힌다', () => {
    const after = structuredClone(FORMS) as typeof FORMS & { forms: { EARLY: { properties: Record<string, unknown> } } };
    after.forms.EARLY.properties.gpa = { type: 'number' };
    after.fees.EARLY = 60000;

    const diff = diffConfig(FORMS, after);
    assert.equal(diff.changes[0]?.risk, 'DESTRUCTIVE');
  });
});
