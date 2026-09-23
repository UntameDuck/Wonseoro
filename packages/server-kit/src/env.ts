import { Logger } from '@nestjs/common';

/**
 * 환경 설정 계약 — 기동 시점에 전부 검증한다.
 *
 * 왜 기동 시점인가
 *   설정이 빠진 것을 첫 요청에서 알면 이미 늦다. 마감 직전에 Pod 가 뜨고
 *   첫 지원자가 500 을 받는 식으로 드러난다. 없는 설정은 뜨지 않는 것이 낫다.
 *
 * 왜 기본값을 안 쓰는가
 *   `process.env.X ?? '개발값'` 은 개발에서 편하지만 운영에서는 **조용한 오동작**이 된다.
 *   비밀키가 기본값이면 비밀이 아니고, 엔드포인트가 localhost 면 아무 데도 안 보내면서
 *   성공한 것처럼 보인다. 그래서 운영에서는 기본값 자체를 금지한다.
 */

const logger = new Logger('config');

export type Environment = 'development' | 'test' | 'production';

export function environment(): Environment {
  const raw = process.env.NODE_ENV;
  if (raw === 'production' || raw === 'test') return raw;
  return 'development';
}

export function isProduction(): boolean {
  return environment() === 'production';
}

/** 설정 오류는 한 번에 모아서 보여준다. 하나씩 고치며 재기동하지 않도록. */
export class ConfigError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`설정이 올바르지 않아 기동할 수 없습니다.\n  - ${problems.join('\n  - ')}`);
    this.name = 'ConfigError';
  }
}

const problems: string[] = [];
const warned = new Set<string>();

function fail(message: string): void {
  problems.push(message);
}

/**
 * 모아둔 설정 오류를 확인한다. 각 서비스의 bootstrap 첫 줄에서 부른다.
 * 하나라도 있으면 기동하지 않는다.
 */
export function assertConfigured(): void {
  if (problems.length > 0) throw new ConfigError([...problems]);
}

/** 운영·개발 모두에서 반드시 있어야 하는 값. */
export function requireEnv(name: string, why: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') {
    fail(`${name} 가 필요합니다 — ${why}`);
    return '';
  }
  return v;
}

/**
 * 운영에서는 필수, 개발에서는 기본값을 허용하는 값.
 * 기본값을 쓸 때마다 경고를 남긴다. 조용히 넘어가지 않는다.
 */
export function envOrDev(name: string, devValue: string, why: string): string {
  const v = process.env[name];
  if (v !== undefined && v !== '') return v;
  if (isProduction()) {
    fail(`${name} 가 필요합니다 — ${why}`);
    return '';
  }
  if (!warned.has(name)) {
    warned.add(name);
    logger.warn(`${name} 미설정 → 개발 기본값 사용 (${devValue}). 운영에서는 필수입니다.`);
  }
  return devValue;
}

/**
 * 비밀값. 개발 기본값은 허용하되 **값을 절대 로그에 남기지 않는다.**
 * 운영에서 빠지면 기동을 막는다.
 */
export function secretOrDev(name: string, devValue: string, why: string): string {
  const v = process.env[name];
  if (v !== undefined && v !== '') return v;
  if (isProduction()) {
    fail(`${name} 가 필요합니다 — ${why}`);
    return '';
  }
  if (!warned.has(name)) {
    warned.add(name);
    logger.warn(`${name} 미설정 → 개발 기본값 사용. 운영에서는 필수입니다.`);
  }
  return devValue;
}

/**
 * 운영에서 켜면 안 되는 개발용 스위치.
 * 켜져 있는데 운영이면 기동을 막는다 — 끄는 것이 아니라 막는다.
 * 조용히 꺼주면 운영자는 그게 켜져 있다고 믿은 채로 다른 판단을 한다.
 */
export function devOnlyFlag(name: string, why: string): boolean {
  const on = process.env[name] === 'true';
  if (on && isProduction()) {
    fail(`${name}=true 는 운영에서 허용되지 않습니다 — ${why}`);
    return false;
  }
  return on;
}

export function envInt(
  name: string,
  devValue: number,
  bounds?: { min?: number; max?: number },
): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return devValue;

  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    fail(`${name} 는 정수여야 합니다 (받은 값: ${raw})`);
    return devValue;
  }
  if (bounds?.min !== undefined && n < bounds.min) {
    fail(`${name} 는 ${bounds.min} 이상이어야 합니다 (받은 값: ${n})`);
    return devValue;
  }
  if (bounds?.max !== undefined && n > bounds.max) {
    fail(`${name} 는 ${bounds.max} 이하여야 합니다 (받은 값: ${n})`);
    return devValue;
  }
  return n;
}

export function envBool(name: string, devValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return devValue;
  return raw === 'true';
}

/** 쉼표로 구분된 목록. 빈 항목은 버린다. */
export function envList(name: string, devValue: readonly string[], why: string): string[] {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    if (isProduction()) {
      fail(`${name} 가 필요합니다 — ${why}`);
      return [];
    }
    if (!warned.has(name)) {
      warned.add(name);
      logger.warn(`${name} 미설정 → 개발 기본값 사용 (${devValue.join(',')})`);
    }
    return [...devValue];
  }
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * 하나만 고르는 설정. 알 수 없는 값이면 기동을 막는다.
 * 오타 하나로 Mock PG 가 운영에 뜨는 일을 막는 자리다.
 */
export function envChoice<T extends string>(
  name: string,
  choices: readonly T[],
  devValue: T,
  why: string,
): T {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    if (isProduction()) {
      fail(`${name} 가 필요합니다 — ${why}. 가능한 값: ${choices.join(' | ')}`);
      return devValue;
    }
    return devValue;
  }
  if (!(choices as readonly string[]).includes(raw)) {
    fail(`${name} 값이 올바르지 않습니다 (받은 값: ${raw}). 가능한 값: ${choices.join(' | ')}`);
    return devValue;
  }
  return raw as T;
}

/**
 * 흉내 구현(Mock) 어댑터. 운영에서 선택되면 기동을 막는다.
 *
 * 기능이 없는 것보다 **있는 척하는 것이 더 위험하다.** Mock 결제는 돈을 받지 않고
 * 받았다고 기록하고, Mock 검사는 아무것도 검사하지 않고 안전하다고 기록한다.
 * 둘 다 그 기록을 믿고 다음 단계가 진행된다.
 */
export function assertNotMockInProduction(what: string, adapter: string): void {
  if (isProduction()) {
    fail(`${what}에 흉내 구현(${adapter})을 운영에서 쓸 수 없습니다`);
  }
}

/** 테스트 전용. 모듈 수준 누적 상태를 비운다. */
export function resetConfigProblemsForTest(): void {
  problems.length = 0;
  warned.clear();
}
