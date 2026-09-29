import type { LoggerService, LogLevel } from '@nestjs/common';
import { activeTraceIds } from './trace';

/**
 * 구조화 로그 + trace 상관관계 + 마스킹 (T-M4-20 · T-M4-24, §01 B8).
 *
 * - 한 줄 JSON: time·level·service·university·context·message·trace_id·span_id
 * - **본문 로깅 없음.** 문자열이 아닌 인자(요청 본문·DTO)는 내용을 적지 않고 `[object omitted]` 로만 남긴다
 * - 메시지·오류 문자열은 마스킹을 거친다. 주민등록번호·전화·이메일·카드번호·토큰·접속 비밀번호
 * - 운영에서는 스택을 남기지 않는다 (경로·값이 섞일 수 있다). 오류 이름·마스킹된 메시지만
 */
const MASKS: ReadonlyArray<readonly [RegExp, string]> = [
  // 접속 문자열의 비밀번호 — postgresql://user:pass@host
  [/([a-z][a-z0-9+.-]*:\/\/[^:\s/@]+):[^@\s]+@/gi, '$1:[REDACTED]@'],
  [/\bBearer\s+[A-Za-z0-9._~+/-]+=*/g, 'Bearer [REDACTED]'],
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[JWT]'],
  [/\b(password|passwd|secret|token|api[_-]?key|authorization)(["']?\s*[=:]\s*["']?)[^\s"'&,}]+/gi, '$1$2[REDACTED]'],
  // 주민등록번호·외국인등록번호 (앞 6자리 + 성별 1~8 + 6자리)
  [/\b\d{6}[-\s]?[1-8]\d{6}\b/g, '[RRN]'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[EMAIL]'],
  [/\b01[016-9][-\s]?\d{3,4}[-\s]?\d{4}\b/g, '[PHONE]'],
  // 카드번호 — 13~19자리, 4자리 묶음 구분자 허용
  [/\b(?:\d{4}[-\s]?){3}\d{1,7}\b/g, '[CARD]'],
];

export function maskLogText(text: string): string {
  let out = text;
  for (const [pattern, replacement] of MASKS) out = out.replace(pattern, replacement);
  return out;
}

const LEVEL_ORDER: Record<string, number> = { verbose: 0, debug: 1, info: 2, warn: 3, error: 4, fatal: 5 };

type Level = 'verbose' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface StructuredLoggerOptions {
  /** json(기본·운영) | pretty(개발 콘솔) */
  format?: 'json' | 'pretty';
  /** 이 수준 미만은 버린다. 기본 info */
  level?: Level;
  /** 오류 스택을 남길지. 운영 기본 false */
  includeStack?: boolean;
  write?: (line: string, level: Level) => void;
}

export class StructuredLogger implements LoggerService {
  private readonly format: 'json' | 'pretty';
  private minLevel: number;
  private readonly includeStack: boolean;
  private readonly write: (line: string, level: Level) => void;

  constructor(
    private readonly service: string,
    options: StructuredLoggerOptions = {},
  ) {
    const production = process.env.NODE_ENV === 'production';
    const envFormat = process.env.LOG_FORMAT === 'pretty' || process.env.LOG_FORMAT === 'json'
      ? process.env.LOG_FORMAT
      : undefined;
    this.format = options.format ?? envFormat ?? (production ? 'json' : 'pretty');
    const envLevel = process.env.LOG_LEVEL?.toLowerCase();
    this.minLevel = LEVEL_ORDER[options.level ?? (envLevel && envLevel in LEVEL_ORDER ? envLevel : 'info')]!;
    this.includeStack = options.includeStack ?? !production;
    this.write = options.write ?? ((line, level) => {
      if (this.format === 'pretty' && (level === 'error' || level === 'fatal' || level === 'warn')) {
        process.stderr.write(`${line}\n`);
      } else {
        process.stdout.write(`${line}\n`);
      }
    });
  }

  log(message: unknown, ...params: unknown[]): void { this.emit('info', message, params); }
  error(message: unknown, ...params: unknown[]): void { this.emit('error', message, params); }
  warn(message: unknown, ...params: unknown[]): void { this.emit('warn', message, params); }
  debug(message: unknown, ...params: unknown[]): void { this.emit('debug', message, params); }
  verbose(message: unknown, ...params: unknown[]): void { this.emit('verbose', message, params); }
  fatal(message: unknown, ...params: unknown[]): void { this.emit('fatal', message, params); }

  /** Nest 가 부른다. 받은 수준 중 가장 낮은 것을 하한으로 쓴다. */
  setLogLevels(levels: LogLevel[]): void {
    const mapped = levels.map((l) => LEVEL_ORDER[l === 'log' ? 'info' : l]).filter((n): n is number => n !== undefined);
    if (mapped.length) this.minLevel = Math.min(...mapped);
  }

  private emit(level: Level, message: unknown, params: unknown[]): void {
    if (LEVEL_ORDER[level]! < this.minLevel) return;

    // Nest 규약: 마지막 문자열 인자가 context 다.
    const rest = [...params];
    const context = rest.length > 0 && typeof rest[rest.length - 1] === 'string'
      ? (rest.pop() as string)
      : undefined;

    const record: Record<string, unknown> = {
      time: new Date().toISOString(),
      level,
      service: this.service,
      university: process.env.UNIVERSITY_ID || undefined,
      context,
      message: describe(message),
      ...activeTraceIds(),
    };

    const error = [message, ...rest].find((p): p is Error => p instanceof Error);
    if (error) {
      record.error = {
        name: error.name,
        message: maskLogText(error.message),
        ...(this.includeStack && error.stack ? { stack: maskLogText(error.stack) } : {}),
      };
    } else if (level === 'error' || level === 'fatal') {
      // Nest 규약: error(message, stack, context) — 두 번째 문자열은 스택이다
      const stack = rest.find((p): p is string => typeof p === 'string');
      if (stack && this.includeStack) record.stack = maskLogText(stack);
    }
    if (rest.some((p) => p !== null && typeof p === 'object' && !(p instanceof Error))) {
      record.detail = '[object omitted]';
    }

    this.write(this.format === 'json' ? JSON.stringify(record) : pretty(record), level);
  }
}

function describe(message: unknown): string {
  if (typeof message === 'string') return maskLogText(message);
  if (message instanceof Error) return maskLogText(`${message.name}: ${message.message}`);
  if (message === null || message === undefined) return String(message);
  if (typeof message === 'object') return '[object omitted]';
  return maskLogText(String(message));
}

function pretty(r: Record<string, unknown>): string {
  const trace = r.trace_id ? ` trace=${String(r.trace_id).slice(0, 16)}` : '';
  const ctx = r.context ? ` [${String(r.context)}]` : '';
  const err = r.error ? ` ${JSON.stringify(r.error)}` : r.stack ? `\n${String(r.stack)}` : '';
  return `${String(r.time)} ${String(r.level).toUpperCase().padEnd(5)} ${String(r.service)}${ctx} ${String(r.message)}${trace}${err}`;
}
