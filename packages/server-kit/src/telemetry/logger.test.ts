import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { context, propagation, trace, TraceFlags } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { W3CTraceContextPropagator } from '@opentelemetry/core';

// SDK 가 서비스에서 하는 등록을 시험에서도 한다 — 없으면 context.with 가 아무것도 전달하지 않는다
context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
propagation.setGlobalPropagator(new W3CTraceContextPropagator());
import { maskLogText, StructuredLogger } from './logger';
import { activeTraceIds, traceHeaders, withSpan } from './trace';

function capture(options: ConstructorParameters<typeof StructuredLogger>[1] = {}) {
  const lines: Array<Record<string, unknown>> = [];
  const logger = new StructuredLogger('test-service', {
    format: 'json',
    write: (line) => lines.push(JSON.parse(line) as Record<string, unknown>),
    ...options,
  });
  return { logger, lines };
}

const PARENT = {
  traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
  spanId: '00f067aa0ba902b7',
  traceFlags: TraceFlags.SAMPLED,
};

describe('로그 마스킹 (T-M4-24, §01 B8)', () => {
  it('개인정보·비밀을 가린다', () => {
    const masked = maskLogText(
      '주민 900101-1234567 메일 kim@example.kr 전화 010-1234-5678 카드 4111 1111 1111 1111 ' +
        'Authorization: Bearer abc.def-ghi postgresql://kadmission_app:s3cret@db:5432/univ_a password=hunter2 ' +
        'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig_value',
    );
    for (const leaked of ['900101-1234567', 'kim@example.kr', '010-1234-5678', '4111 1111', 'abc.def-ghi', 's3cret', 'hunter2', 'eyJhbGci']) {
      assert.equal(masked.includes(leaked), false, `${leaked} 가 남았다: ${masked}`);
    }
    assert.match(masked, /\[RRN\].*\[EMAIL\].*\[PHONE\].*\[CARD\]/);
    assert.match(masked, /postgresql:\/\/kadmission_app:\[REDACTED\]@db/);
  });

  it('운영에 필요한 식별자·수치는 그대로 둔다', () => {
    const text = 'relay: sent=3 failed=0 application=84f21d99-750b-4b4d-a43c-f8acb30672bd 1727600000000ms';
    assert.equal(maskLogText(text), text);
  });
});

describe('구조화 로그 (T-M4-20)', () => {
  it('한 줄 JSON 에 서비스·context·마스킹된 메시지를 담는다', () => {
    const { logger, lines } = capture();
    logger.log('지원자 kim@example.kr 저장', 'ApplicationService');
    assert.equal(lines.length, 1);
    assert.equal(lines[0]!.service, 'test-service');
    assert.equal(lines[0]!.level, 'info');
    assert.equal(lines[0]!.context, 'ApplicationService');
    assert.equal(lines[0]!.message, '지원자 [EMAIL] 저장');
    assert.equal(lines[0]!.trace_id, undefined);
  });

  it('활성 span 이 있으면 trace_id·span_id 를 붙인다', () => {
    const { logger, lines } = capture();
    context.with(trace.setSpanContext(context.active(), PARENT), () => {
      assert.deepEqual(activeTraceIds(), { trace_id: PARENT.traceId, span_id: PARENT.spanId });
      logger.log('확정', 'FinalizationService');
      // 내부 호출 헤더도 같은 trace 를 잇는다
      assert.equal(traceHeaders().traceparent, `00-${PARENT.traceId}-${PARENT.spanId}-01`);
    });
    assert.equal(lines[0]!.trace_id, PARENT.traceId);
    assert.equal(lines[0]!.span_id, PARENT.spanId);
  });

  it('본문 객체는 내용을 적지 않는다', () => {
    const { logger, lines } = capture();
    logger.warn({ name: '홍길동', rrn: '900101-1234567' }, 'X');
    logger.log('요청 본문', { phone: '010-1234-5678' }, 'Y');
    assert.equal(lines[0]!.message, '[object omitted]');
    assert.equal(lines[1]!.detail, '[object omitted]');
    assert.equal(JSON.stringify(lines).includes('홍길동'), false);
    assert.equal(JSON.stringify(lines).includes('010-1234-5678'), false);
  });

  it('운영(스택 끔)에서는 오류 이름·마스킹된 메시지만 남긴다', () => {
    const { logger, lines } = capture({ includeStack: false });
    const error = new Error('connect failed postgresql://u:pw@db/x');
    logger.error('DB 오류', error, 'Db');
    assert.deepEqual(lines[0]!.error, { name: 'Error', message: 'connect failed postgresql://u:[REDACTED]@db/x' });
    logger.error('Nest 형식', 'Error: x\n    at secret-path', 'Db');
    assert.equal(lines[1]!.stack, undefined);
  });

  it('수준 하한 아래는 버린다', () => {
    const { logger, lines } = capture({ level: 'warn' });
    logger.log('버림');
    logger.debug('버림');
    logger.warn('남김');
    assert.deepEqual(lines.map((l) => l.message), ['남김']);
  });
});

describe('trace 헬퍼', () => {
  it('span 속성은 식별자 형태만 남기고, SDK 가 없어도 동작한다', async () => {
    const value = await withSpan('t', 'job', { 'event.type': 'kr.kadmission.application.submitted', note: '홍길동 원서' }, async () => 42);
    assert.equal(value, 42);
  });

  it('활성 trace 가 없으면 전파 헤더도 비어 있다', () => {
    assert.deepEqual(traceHeaders(), {});
  });
});
