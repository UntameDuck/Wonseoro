import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import {
  CircuitBreaker,
  CircuitOpenError,
  describeFailure,
  httpServerError,
} from '@wonseoro/server-kit';
import { ADMISSION_API_URL, BREAKER, SCANNER } from './config';

export interface ScanTarget {
  documentId: string;
  objectKey: string;
  mediaType: string;
  sizeBytes: number;
  sha256: string;
}

export type ScanVerdict = 'CLEAN' | 'MALICIOUS' | 'ERROR';

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
 * ⚠️ M2 의 엔진은 Mock 이다. 실제 안티바이러스 연동은 M5. (T-M5-08)
 * 다만 **상태 전이와 보고 경로는 실제로 동작한다.** 접수 확정이 AVAILABLE 기준이므로
 * 이 경로가 없으면 서류가 필요한 전형은 접수가 끝나지 않는다.
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

    for (const target of targets) {
      // 보고할 수 없으면 검사하지 않는다. 판정을 버리게 된다.
      if (this.stopped || !this.admissionApi.allowsRequest()) break;
      const verdict = await this.scan(target);
      const reported = await this.report(target.documentId, verdict);
      if (!reported) continue;

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

  /**
   * Mock 엔진.
   *
   * 실제 엔진처럼 **시간이 걸린다.** 즉시 CLEAN 을 돌려주면
   * "검사 중" 상태가 화면에 한 번도 나타나지 않아 그 UX 를 검증할 수 없다.
   *
   * 판정 규칙은 파일명·크기로 고정한다. 무작위면 재현이 안 된다.
   */
  private async scan(target: ScanTarget): Promise<ScanVerdict> {
    const delay = SCANNER.delayMs;
    await new Promise((r) => setTimeout(r, delay));

    // 시험용 판정. objectKey 에 표식이 있으면 그 결과를 낸다.
    if (target.objectKey.includes('malicious')) return 'MALICIOUS';
    if (target.objectKey.includes('scanerror')) return 'ERROR';

    // 크기가 0이면 검사할 것이 없다. 통과시키지 않는다.
    if (target.sizeBytes <= 0) return 'ERROR';

    return 'CLEAN';
  }

  private async fetchPending(): Promise<ScanTarget[]> {
    try {
      const res = await this.admissionApi.run(
        () =>
          fetch(`${this.apiUrl()}/internal/v1/documents/pending-scan?limit=25`, {
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

  private async report(documentId: string, result: ScanVerdict): Promise<boolean> {
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
            },
            body: JSON.stringify({
              result,
              scanner: 'mock-av',
              engineVersion: SCANNER.version,
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
