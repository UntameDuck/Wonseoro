import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { metrics } from '@opentelemetry/api';
import {
  CircuitBreaker,
  CircuitOpenError,
  describeFailure,
  httpServerError,
  traceHeaders,
  withSpan,
} from '@wonseoro/server-kit';

/** 판정별 검사 수 (T-M4-20). 서류·원서 식별자는 라벨에 넣지 않는다. */
const scanResults = metrics.getMeter('k-admission.document').createCounter('document_scans', {
  description: '서류 검사 판정별 수 (보고까지 끝난 것만)',
});
// 첫 검사에서 처음 생긴 시계열은 rate() 가 그 증가를 놓친다. 판정 라벨을 0 으로 만들어 둔다.
for (const verdict of ['CLEAN', 'MALICIOUS', 'ERROR']) scanResults.add(0, { verdict });
import { ADMISSION_API_URL, BREAKER, CLAMD, SCANNER, SCANNER_ENGINE } from './config';
import { ClamAvEngine, EngineUnavailable, MockEngine, ScanEngine, ScanTarget, ScanVerdict } from './engines';

export type { ScanTarget, ScanVerdict } from './engines';

export interface ScanStats {
  scanned: number;
  clean: number;
  malicious: number;
  errors: number;
}

/**
 * 악성코드 검사 워커 — 기술설계서 v1.0 §5.4, v1.1 §B5, ADR-0004
 *
 * **별도 프로세스인 이유는 하나다. 검사는 오래 걸리고 CPU 를 쓴다.**
 * 마감 피크에 접수 트랜잭션과 자원을 다투면 안 된다.
 *
 * 흐름
 *   admission-api  : upload → magic-byte·해시 검증 → QUARANTINED
 *   document-service: QUARANTINED 를 가져가 검사 → scan-result 보고
 *   admission-api  : CLEAN 이면 AVAILABLE, 아니면 REJECTED
 *
 * 엔진은 SCANNER_ENGINE 으로 고른다 — clamav(clamd INSTREAM) 또는 개발용 mock. (engines.ts, D-58)
 * 보고에는 **실제로 검사한 엔진의 이름과 버전**을 싣는다. 전에는 모든 보고가 'mock-av' 였다.
 * 엔진에 닿지 못하면(EngineUnavailable) 보고하지 않는다 — 판정이 아니므로 서류를 떨어뜨리지 않고
 * 검사 대기로 남겨 다음 주기에 다시 가져온다.
 *
 * **접수 API 가 끊기면 검사하지 않는다.** (v1.1 §01 C8)
 * 보고 경로가 막힌 채 검사를 계속하면 CPU 를 써서 얻은 판정을 버리게 된다.
 * 서류는 QUARANTINED 로 남아 있으므로, 접수 API 가 돌아오면 다시 가져온다.
 */
@Injectable()
export class ScannerService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(ScannerService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;

  /** 접수 API 보고 경로. 상태는 이 프로세스 안에만 있다. */
  readonly admissionApi = new CircuitBreaker({
    name: 'admission-api',
    failureThreshold: BREAKER.failureThreshold,
    openMs: BREAKER.openMs,
    onStateChange: (c) => {
      const line = `circuit ${c.name} ${c.from} -> ${c.to} (consecutiveFailures=${c.consecutiveFailures})`;
      if (c.to === 'OPEN') this.logger.error(`${line} — 검사를 멈춘다`);
      else this.logger.warn(line);
    },
  });

  private engineDown = false;

  /** 검사 엔진. 시험이 바꿔 끼울 수 있다. */
  engine: ScanEngine =
    SCANNER_ENGINE === 'clamav'
      ? new ClamAvEngine(CLAMD.host, CLAMD.port, CLAMD.timeoutMs)
      : new MockEngine(SCANNER.delayMs, SCANNER.version);

  onModuleInit(): void {
    if (!SCANNER.autostart) {
      this.logger.log('scanner loop disabled (SCANNER_AUTOSTART=false)');
      return;
    }
    const interval = SCANNER.intervalMs;
    this.timer = setInterval(() => void this.tick(), interval);
    this.logger.log(`scanner loop started (every ${interval}ms)`);
  }

  onApplicationShutdown(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<ScanStats> {
    const empty: ScanStats = { scanned: 0, clean: 0, malicious: 0, errors: 0 };
    if (this.running || this.stopped) return empty;
    this.running = true;
    try {
      return await this.drainOnce();
    } catch (err) {
      // 워커가 죽으면 서류가 영원히 QUARANTINED 로 남는다. 루프를 지킨다.
      this.logger.error(`scan tick failed: ${describeFailure(err)}`);
      return empty;
    } finally {
      this.running = false;
    }
  }

  async drainOnce(): Promise<ScanStats> {
    const stats: ScanStats = { scanned: 0, clean: 0, malicious: 0, errors: 0 };
    if (!this.admissionApi.allowsRequest()) return stats;
    const targets = await this.fetchPending();

    // 엔진 버전은 주기마다 한 번 묻는다 — 서명 DB 는 하루에도 여러 번 바뀐다.
    let engineVersion: string | null = null;
    for (const target of targets) {
      // 보고할 수 없으면 검사하지 않는다. 판정을 버리게 된다.
      if (this.stopped || !this.admissionApi.allowsRequest()) break;
      // 서류 한 건 = span 한 개. 결과 보고에 traceparent 를 실어 접수 API 처리까지 잇는다
      const outcome = await withSpan('k-admission.document', 'document scan', {}, async () => {
        try {
          engineVersion ??= await this.engine.version();
          const result = await this.engine.scan(target);
          if (this.engineDown) this.logger.warn(`scan engine ${this.engine.name} 복구`);
          this.engineDown = false;
          return {
            verdict: result.verdict,
            reported: await this.report(target.documentId, result.verdict, engineVersion, result.signature),
          };
        } catch (err) {
          if (err instanceof EngineUnavailable) {
            // 판정이 아니다. 이번 주기의 남은 서류도 같은 엔진이라 멈춘다 — 다음 주기에 다시 가져온다.
            // 죽어 있는 동안 주기마다 남기면 로그가 묻힌다. 바뀔 때 한 번만.
            if (!this.engineDown) this.logger.error(`scan engine unavailable (${err.message}) — 서류는 검사 대기로 남는다`);
            this.engineDown = true;
            return null;
          }
          throw err;
        }
      });
      if (outcome === null) break;
      const { verdict, reported } = outcome;
      if (!reported) continue;
      scanResults.add(1, { verdict });

      stats.scanned += 1;
      if (verdict === 'CLEAN') stats.clean += 1;
      else if (verdict === 'MALICIOUS') stats.malicious += 1;
      else stats.errors += 1;
    }

    if (stats.scanned > 0) {
      this.logger.log(
        `scanned=${stats.scanned} clean=${stats.clean} malicious=${stats.malicious} error=${stats.errors}`,
      );
    }
    return stats;
  }

  private async fetchPending(): Promise<ScanTarget[]> {
    try {
      const res = await this.admissionApi.run(
        () =>
          fetch(`${this.apiUrl()}/internal/v1/documents/pending-scan?limit=25`, {
            headers: traceHeaders(),
            signal: AbortSignal.timeout(SCANNER.timeoutMs),
          }),
        { isFailure: httpServerError },
      );
      if (!res.ok) return [];
      const body = (await res.json()) as { documents?: ScanTarget[] };
      return body.documents ?? [];
    } catch (err) {
      if (err instanceof CircuitOpenError) return [];
      // 접수 API 가 재기동 중일 수 있다. 다음 주기에 다시 온다.
      this.logger.warn(`pending-scan unavailable: ${describeFailure(err)}`);
      return [];
    }
  }

  private async report(
    documentId: string,
    result: ScanVerdict,
    engineVersion: string,
    signature?: string,
  ): Promise<boolean> {
    try {
      const res = await this.admissionApi.run(
        () =>
          fetch(`${this.apiUrl()}/internal/v1/documents/${documentId}/scan-result`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              // 내부 API 도 mutation 이므로 Idempotency-Key 를 요구한다. 예외 없다.
              // **문서 단위로 고정된 키**를 쓴다. 같은 서류의 검사 결과를 다시 보고해도
              // 상태가 두 번 바뀌면 안 된다.
              'idempotency-key': `scan-${documentId}`,
              ...traceHeaders(),
            },
            body: JSON.stringify({
              result,
              // 실제로 검사한 엔진 — Evidence Package 에 그대로 남는다
              scanner: this.engine.name,
              engineVersion,
              ...(signature && result !== 'CLEAN' ? { signature } : {}),
            }),
            signal: AbortSignal.timeout(SCANNER.timeoutMs),
        }),
        { isFailure: httpServerError },
      );
      if (res.ok) return true;

      // 400 을 "다른 워커가 먼저 처리했다"로만 보면 진짜 원인이 가려진다.
      // 실제로 Idempotency-Key 누락을 경쟁 상황으로 착각해 한참 헤맸다.
      // problem+json 의 code 를 꺼내 남긴다.
      const problem = (await res.json().catch(() => null)) as { code?: string } | null;
      const code = problem?.code ?? 'UNKNOWN';
      if (res.status === 400 && code === 'VALIDATION_FAILED') {
        // 이미 검사 대기 상태가 아니다. 다른 워커가 먼저 처리한 것으로 본다.
        return false;
      }
      this.logger.warn(`scan-result rejected ${res.status}/${code} document=${documentId}`);
      return false;
    } catch (err) {
      if (err instanceof CircuitOpenError) return false;
      this.logger.warn(`scan-result failed: ${describeFailure(err)}`);
      return false;
    }
  }

  private apiUrl(): string {
    return ADMISSION_API_URL;
  }
}
