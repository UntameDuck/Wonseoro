import { Injectable, Logger } from '@nestjs/common';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { PaymentStatus } from '@wonseoro/contracts';
import { PG_CALLBACK_SECRET } from '../../config';

export interface IntentResult {
  providerTxId: string;
  providerPayload: Record<string, unknown>;
}

/**
 * 서명을 통과한 콜백에서 꺼낸 것. **상태는 담지 않는다** — 콜백이 뭐라고 하든
 * 서버는 PG 에 다시 묻는다. 콜백은 "지금 다시 확인하라" 는 신호일 뿐이다. (§B4)
 */
export interface CallbackNotice {
  providerTxId: string;
  /** PG 쪽 이벤트 ID. 같은 콜백이 여러 번 와도 한 번만 처리하는 근거다. */
  eventId: string;
}

export interface VerifyResult {
  status: PaymentStatus;
  providerApprovedAt?: string;
  amount?: number;
}

/**
 * PG Adapter 포트 — 기술설계서 v1.0 §5.5
 *
 * 플랫폼이 직접 전자금융업자가 되지 않는다.
 * 대학이 계약한 PG 를 Adapter 로 연계한다.
 *
 * 실 PG 연동은 M6 (T-M6-04). 이 인터페이스만 지키면 교체로 끝난다.
 */
export abstract class PaymentProviderPort {
  abstract readonly name: string;
  abstract createIntent(applicationId: string, amount: number): Promise<IntentResult>;
  /** 서버가 PG 에 직접 묻는다. 클라이언트가 보낸 값은 쓰지 않는다. */
  abstract verify(providerTxId: string): Promise<VerifyResult>;
  abstract cancel(providerTxId: string): Promise<{ status: PaymentStatus }>;
  abstract reconcile(from: Date, to: Date): Promise<Array<{ providerTxId: string; status: PaymentStatus }>>;
  /**
   * 콜백 서명 검증. 맞지 않으면 null. 형식은 PG 마다 다르므로 어댑터가 판단한다.
   * `rawBody` 는 받은 바이트 그대로다 — 파싱했다 다시 직렬화하면 서명이 맞지 않는다.
   */
  abstract verifyCallback(signature: string | undefined, rawBody: Buffer): CallbackNotice | null;
}

/**
 * 개발·시험용 Mock PG.
 *
 * 실 PG 의 나쁜 행동을 **일부러 재현한다.**
 *   - 승인 직후 조회에서 아직 PENDING 인 구간
 *   - 응답이 아예 안 오는 UNKNOWN
 * 이런 상황에서 접수가 어떻게 되는지가 이 제품의 핵심이므로,
 * Mock 이 항상 성공하면 검증이 무의미해진다. (v1.1 §B4)
 *
 * 동작은 providerTxId 해시로 결정한다. 같은 거래는 항상 같게 움직인다.
 */
@Injectable()
export class MockPaymentProvider extends PaymentProviderPort {
  readonly name = 'mock-pg';
  private readonly logger = new Logger(MockPaymentProvider.name);
  /** providerTxId → 조회 횟수. PENDING 후 CONFIRMED 로 넘어가는 구간을 만든다. */
  private readonly polls = new Map<string, number>();
  /** 지연 모드에서 다음 결제에 줄 지연의 순번. */
  private delayTurn = 0;

  async createIntent(applicationId: string, amount: number): Promise<IntentResult> {
    if (process.env.MOCK_PG_BEHAVIOUR === 'DOWN') throw pgUnreachable();
    const random = randomUUID().replace(/-/g, '').slice(0, 20).toUpperCase();
    const delays = confirmDelays();
    // 지연 모드: 지연(초)과 승인 시각을 거래 ID 에 새긴다. Pod 가 여럿이어도 어느 Pod 가 조회하든 같게 움직인다.
    const providerTxId = delays.length > 0
      ? `MOCK-D${delays[this.delayTurn++ % delays.length]}-${Date.now().toString(36).toUpperCase()}-${random.slice(0, 12)}`
      : `MOCK-${random}`;
    return {
      providerTxId,
      // 실제 PG 라면 결제창 URL·파라미터가 들어간다.
      providerPayload: {
        provider: this.name,
        providerTxId,
        amount,
        applicationId,
        redirectUrl: `https://mock-pg.local/checkout/${providerTxId}`,
      },
    };
  }

  async verify(providerTxId: string): Promise<VerifyResult> {
    const delayed = parseDelayed(providerTxId);
    if (delayed) {
      // 돈은 결제 시각에 나갔지만 PG 가 그 사실을 늦게 알린다(콜백·조회 모두). 그동안은 "모른다" 다.
      if (Date.now() < delayed.approvedAtMs + delayed.delayMs) return { status: 'UNKNOWN' };
      return { status: 'CONFIRMED', providerApprovedAt: new Date(delayed.approvedAtMs).toISOString() };
    }
    const behaviour = this.behaviourOf(providerTxId);
    if (behaviour === 'DOWN') throw pgUnreachable();
    const count = (this.polls.get(providerTxId) ?? 0) + 1;
    this.polls.set(providerTxId, count);

    switch (behaviour) {
      case 'FAIL':
        return { status: 'FAILED' };
      case 'UNKNOWN':
        // 응답을 못 받는 상황. FAILED 로 떨어뜨리면 안 된다.
        // 돈은 나갔는데 접수는 안 된 상태가 만들어진다. (v1.1 §B4)
        return { status: 'UNKNOWN' };
      case 'SLOW':
        // 첫 조회는 아직 PENDING. 두 번째부터 CONFIRMED.
        if (count < 2) return { status: 'PENDING' };
        return { status: 'CONFIRMED', providerApprovedAt: new Date().toISOString() };
      default:
        return { status: 'CONFIRMED', providerApprovedAt: new Date().toISOString() };
    }
  }

  async cancel(providerTxId: string): Promise<{ status: PaymentStatus }> {
    this.logger.log(`cancel ${providerTxId}`);
    return { status: 'CANCELLED' };
  }

  async reconcile(): Promise<Array<{ providerTxId: string; status: PaymentStatus }>> {
    // M3 Reconciliation Center 에서 실제 대조에 쓴다. (T-M3-04)
    return [];
  }

  /**
   * Mock 콜백 서명: `x-pg-signature: hex(HMAC-SHA256(PG_CALLBACK_SECRET, 원문))`.
   * 본문: `{ "providerTxId": "...", "eventId": "..." }` — 다른 필드(예: status)는 읽지 않는다.
   */
  verifyCallback(signature: string | undefined, rawBody: Buffer): CallbackNotice | null {
    if (!signature) return null;
    const expected = createHmac('sha256', PG_CALLBACK_SECRET).update(rawBody).digest('hex');
    const given = Buffer.from(signature, 'utf8');
    const want = Buffer.from(expected, 'utf8');
    if (given.length !== want.length || !timingSafeEqual(given, want)) return null;
    try {
      const body = JSON.parse(rawBody.toString('utf8')) as { providerTxId?: unknown; eventId?: unknown };
      if (typeof body.providerTxId !== 'string' || typeof body.eventId !== 'string') return null;
      if (!body.providerTxId || !body.eventId || body.eventId.length > 160) return null;
      return { providerTxId: body.providerTxId, eventId: body.eventId };
    } catch {
      return null;
    }
  }

  /**
   * 테스트가 결과를 고를 수 있게 한다.
   * providerTxId 에 표식을 넣거나, 환경변수로 전체 동작을 고정한다.
   */
  private behaviourOf(providerTxId: string): 'OK' | 'SLOW' | 'FAIL' | 'UNKNOWN' | 'DOWN' {
    const forced = process.env.MOCK_PG_BEHAVIOUR;
    if (
      forced === 'SLOW' ||
      forced === 'FAIL' ||
      forced === 'UNKNOWN' ||
      forced === 'OK' ||
      forced === 'DOWN'
    ) {
      return forced;
    }
    if (providerTxId.includes('SLOW')) return 'SLOW';
    if (providerTxId.includes('FAIL')) return 'FAIL';
    if (providerTxId.includes('UNKNOWN')) return 'UNKNOWN';
    // 기본은 성공. 나쁜 경로는 명시적으로 요청해야 나온다.
    createHash('sha256').update(providerTxId).digest();
    return 'OK';
  }
}

/**
 * 지연 모드 (T-M4-34 실제 시간 판) — `MOCK_PG_CONFIRM_DELAYS_S=60,300,900,1800`.
 * 결제마다 목록의 지연을 차례로 주고, 그 시간 동안 조회에 UNKNOWN 으로 답한 뒤 CONFIRMED 로 바뀐다.
 * 승인 시각은 결제 시각이다 — 마감 판정(PAYMENT_APPROVED_BEFORE_DEADLINE)은 늦은 확인과 무관해야 한다.
 */
function confirmDelays(): number[] {
  const spec = process.env.MOCK_PG_CONFIRM_DELAYS_S;
  if (!spec) return [];
  return spec.split(',').map((v) => Number(v.trim())).filter((v) => Number.isInteger(v) && v > 0 && v <= 86_400);
}

export function parseDelayed(providerTxId: string): { delayMs: number; approvedAtMs: number } | null {
  const m = /^MOCK-D(\d+)-([0-9A-Z]+)-/.exec(providerTxId);
  if (!m?.[1] || !m[2]) return null;
  const approvedAtMs = parseInt(m[2], 36);
  return Number.isFinite(approvedAtMs) ? { delayMs: Number(m[1]) * 1000, approvedAtMs } : null;
}

/**
 * PG 에 닿지 않는 상황. UNKNOWN 응답과 다르다 — 그건 PG 가 "모른다"고 답한 것이고,
 * 이건 대답 자체가 없는 것이다. Circuit Breaker 는 이것을 장애로 센다.
 * (`MOCK_PG_BEHAVIOUR=DOWN`)
 */
function pgUnreachable(): Error {
  return Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
}
