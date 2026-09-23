import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  assertConfigured,
  ConfigError,
  devOnlyFlag,
  envChoice,
  envInt,
  envList,
  envOrDev,
  requireEnv,
  resetConfigProblemsForTest,
  secretOrDev,
} from './env';

/** 각 테스트가 서로의 환경을 물려받지 않게 한다. */
const touched: string[] = [];
function setEnv(name: string, value: string | undefined): void {
  touched.push(name);
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  for (const name of touched) delete process.env[name];
  touched.length = 0;
  delete process.env.NODE_ENV;
  resetConfigProblemsForTest();
});

function problemsOf(fn: () => void): readonly string[] {
  fn();
  try {
    assertConfigured();
    return [];
  } catch (err) {
    assert.ok(err instanceof ConfigError);
    return err.problems;
  }
}

describe('필수 설정', () => {
  it('없으면 기동을 막는다', () => {
    const p = problemsOf(() => requireEnv('TEST_MISSING', '테스트'));
    assert.equal(p.length, 1);
    assert.match(p[0]!, /TEST_MISSING/);
  });

  it('빈 문자열은 없는 것으로 본다 — 빈 값으로 뜨는 게 더 위험하다', () => {
    setEnv('TEST_EMPTY', '');
    assert.equal(problemsOf(() => requireEnv('TEST_EMPTY', '테스트')).length, 1);
  });

  it('여러 개가 빠져도 한 번에 보여준다', () => {
    const p = problemsOf(() => {
      requireEnv('TEST_A', 'a');
      requireEnv('TEST_B', 'b');
      requireEnv('TEST_C', 'c');
    });
    // 하나씩 고치며 세 번 재기동하게 만들지 않는다.
    assert.equal(p.length, 3);
  });
});

describe('운영에서의 기본값 금지', () => {
  it('개발에서는 기본값을 쓴다', () => {
    setEnv('NODE_ENV', 'development');
    assert.equal(envOrDev('TEST_URL', 'http://localhost:1', '테스트'), 'http://localhost:1');
    assert.equal(problemsOf(() => {}).length, 0);
  });

  it('운영에서는 기본값을 허용하지 않는다', () => {
    setEnv('NODE_ENV', 'production');
    assert.equal(problemsOf(() => envOrDev('TEST_URL', 'http://localhost:1', '테스트')).length, 1);
  });

  it('비밀값도 같은 규칙이다', () => {
    setEnv('NODE_ENV', 'production');
    // 소스에 기본 비밀키가 있으면 그건 비밀이 아니다.
    assert.equal(problemsOf(() => secretOrDev('TEST_KEY', 'dev-key', '테스트')).length, 1);
  });
});

describe('개발 전용 스위치', () => {
  it('운영에서 켜져 있으면 조용히 끄지 않고 기동을 막는다', () => {
    setEnv('NODE_ENV', 'production');
    setEnv('TEST_FLAG', 'true');
    // 몰래 꺼주면 운영자는 그게 켜져 있다고 믿은 채로 다른 판단을 한다.
    assert.equal(problemsOf(() => devOnlyFlag('TEST_FLAG', '테스트')).length, 1);
  });

  it('개발에서는 켜진다', () => {
    setEnv('NODE_ENV', 'development');
    setEnv('TEST_FLAG', 'true');
    assert.equal(devOnlyFlag('TEST_FLAG', '테스트'), true);
  });
});

describe('값 검증', () => {
  it('정수가 아니면 막는다', () => {
    setEnv('TEST_PORT', 'eighty');
    assert.equal(problemsOf(() => envInt('TEST_PORT', 80)).length, 1);
  });

  it('범위를 벗어나면 막는다', () => {
    setEnv('TEST_PORT', '70000');
    assert.equal(problemsOf(() => envInt('TEST_PORT', 80, { min: 1, max: 65535 })).length, 1);
  });

  it('알 수 없는 선택지는 막는다 — 오타 하나로 Mock 이 뜨면 안 된다', () => {
    setEnv('TEST_MODE', 'moc');
    assert.equal(problemsOf(() => envChoice('TEST_MODE', ['mock', 'real'], 'mock', '테스트')).length, 1);
  });

  it('목록은 공백을 정리하고 빈 항목을 버린다', () => {
    setEnv('TEST_LIST', ' a , ,b ');
    assert.deepEqual(envList('TEST_LIST', [], '테스트'), ['a', 'b']);
  });
});
