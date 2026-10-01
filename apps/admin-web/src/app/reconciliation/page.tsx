'use client';

import { Alert, Button, Card, Field, Select } from '@wonseoro/krds';
import { useCallback, useEffect, useState } from 'react';
import {
  APPLICATION_STATUS_LABEL,
  EVENT_TYPE_LABEL,
  EXCEPTION_FACT_LABEL,
  EXCEPTION_SEVERITY_LABEL,
  EXCEPTION_STATE_LABEL,
  EXCEPTION_TYPE_LABEL,
  OUTBOX_STATUS_LABEL,
  PAYMENT_STATUS_LABEL,
  labelOf,
} from '@wonseoro/contracts';
import { td, th } from '../../components/activation';
import { useConsole } from '../../components/console';
import { actionKey, adminGet, adminPost, describe, kst } from '../../lib/api';

interface Exception {
  id: string;
  applicationId: string;
  exceptionType: string;
  severity: 'CRITICAL' | 'HIGH' | 'WARN' | 'INFO';
  state: 'OPEN' | 'MANUAL_REVIEW' | 'RESOLVED' | 'AUTO_RESOLVED';
  facts: Record<string, unknown>;
  detectedAt: string;
}

/**
 * 사실 항목의 "status" 가 무엇의 상태인지는 예외 종류가 정한다 — 같은 PENDING 이 전송 대기이기도, 결제 확인 중이기도 하다.
 * 대조 검사(reconciliation.service)가 어느 표에서 읽었는지에 맞춘다.
 */
const STATUS_SOURCE: Record<string, { label: string; dict: Record<string, string> }> = {
  CENTRAL_ACK_MISSING: { label: '전송 상태', dict: OUTBOX_STATUS_LABEL },
  OUTBOX_DEAD_LETTER: { label: '전송 상태', dict: OUTBOX_STATUS_LABEL },
  FINALIZED_WITHOUT_SUBMISSION: { label: '원서 상태', dict: APPLICATION_STATUS_LABEL },
  SUBMISSION_WITHOUT_FINALIZED_STATUS: { label: '원서 상태', dict: APPLICATION_STATUS_LABEL },
};

function factLabel(type: string, key: string): string {
  if (key === 'status') return STATUS_SOURCE[type]?.label ?? '결제 상태';
  return labelOf(EXCEPTION_FACT_LABEL, key);
}

/** 발견 당시 사실의 값을 사람 말로 — 시각은 한국 시간, 상태는 사전, 금액은 원. 모르는 값은 그대로. */
function factValue(type: string, key: string, v: unknown): string {
  if (v === null || v === undefined) return '-';
  if (typeof v === 'object') return JSON.stringify(v);
  const s = String(v);
  if (/_at$|At$/.test(key) && !Number.isNaN(Date.parse(s))) return kst(s);
  if (/amount|Amount/.test(key) && Number.isFinite(Number(s))) return `${Number(s).toLocaleString('ko-KR')}원`;
  if (key === 'event_type') return labelOf(EVENT_TYPE_LABEL, s);
  if (key === 'status') return labelOf(STATUS_SOURCE[type]?.dict ?? PAYMENT_STATUS_LABEL, s);
  if (/Status$|^afterVerify$/.test(key)) return labelOf(PAYMENT_STATUS_LABEL, s);
  if (key === 'attempt_count') return `${s}회`;
  return s;
}

const RESOLUTION_OPTIONS = [
  { value: '', label: '선택하십시오' },
  { value: 'MANUAL_RESUBMITTED', label: '수동 재전송함' },
  { value: 'REFUNDED_OUTSIDE', label: 'PG 에서 직접 환불함' },
  { value: 'CONFIRMED_WITH_PG', label: 'PG 와 대조해 정상 확인' },
  { value: 'APPLICANT_CONTACTED', label: '지원자와 확인 완료' },
  { value: 'FALSE_POSITIVE', label: '오탐 — 실제 문제 아님' },
];

/**
 * 대조 · 예외 — T-M3-12, v1.1 §A4·§B16·§B18
 *
 * **정상 건은 여기 없다.** 목록에 정상 건이 섞이면 실제 사고가 묻힌다. (§B18)
 * **이 화면은 데이터를 고치지 않는다.** 결제·접수 상태를 화면에서 바꾸면 돈과 접수 기회가
 * 걸린 상태를 사람이 임의로 바꾸는 경로가 생긴다. 조치는 밖(PG·지원자·재전송)에서 하고,
 * 여기서는 **무엇을 왜 했는지** 사유와 함께 기록한다. (§B16)
 */
export default function ReconciliationPage() {
  const { operator } = useConsole();
  const [state, setState] = useState('OPEN');
  const [items, setItems] = useState<Exception[] | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger' | 'info'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      setItems((await adminGet<{ exceptions: Exception[] }>('reconciliation/exceptions', { state })).exceptions);
    } catch (err) {
      setMessage({ tone: 'danger', text: describe(err) });
    }
  }, [state]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const run = async () => {
    setBusy(true);
    try {
      const r = await adminPost<{ checked: number; opened: number; autoResolved: number; stillOpen: number }>(
        'reconciliation/run',
        { sinceHours: 48 },
        actionKey('recon-run'),
      );
      setMessage({
        tone: 'info',
        text: `최근 48시간 대조: 검사 ${r.checked}건 · 새 불일치 ${r.opened}건 · 자동 해소 ${r.autoResolved}건 · 남은 불일치 ${r.stillOpen}건`,
      });
      await reload();
    } catch (err) {
      setMessage({ tone: 'danger', text: describe(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1 style={{ fontSize: 'var(--krds-text-2xl)', marginTop: 0 }}>대조 · 예외</h1>
      <Card>
        <div style={{ display: 'flex', gap: 'var(--krds-space-4)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 220 }}>
            <Select
              label="상태"
              value={state}
              onChange={setState}
              options={[
                { value: 'OPEN', label: '미해결' },
                { value: 'MANUAL_REVIEW', label: '수동 검토 중' },
                { value: 'RESOLVED', label: '해소됨' },
                { value: 'AUTO_RESOLVED', label: EXCEPTION_STATE_LABEL.AUTO_RESOLVED },
                { value: 'ALL', label: '전체' },
              ]}
            />
          </div>
          <div style={{ paddingBottom: 'var(--krds-space-3)' }}>
            <Button variant="secondary" disabled={busy || !operator} onClick={() => void run()}>
              지금 대조 실행 (최근 48시간)
            </Button>
          </div>
        </div>
        {message && <Alert tone={message.tone} title={message.text} focusKey={message} />}
      </Card>

      {items === null ? (
        <Card>
          <p role="status" style={{ margin: 0 }}>
            불러오는 중…
          </p>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <p style={{ margin: 0 }}>{state === 'OPEN' ? '미해결 불일치가 없습니다.' : '해당하는 항목이 없습니다.'}</p>
        </Card>
      ) : (
        items.map((e) => (
          <ExceptionItem
            key={e.id}
            item={e}
            operator={operator}
            onResolved={async () => {
              // 해소한 항목은 미해결 목록에서 빠진다 — 결과를 위 알림으로 말하고 포커스도 그리로 (T-M5-41)
              setMessage({ tone: 'success', text: '해소로 기록했습니다. 사유와 처리 전후가 감사 기록에 남았습니다.' });
              await reload();
            }}
          />
        ))
      )}
    </>
  );
}

function ExceptionItem({ item, operator, onResolved }: { item: Exception; operator: string | null; onResolved: () => Promise<void> }) {
  const [code, setCode] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const open = item.state === 'OPEN' || item.state === 'MANUAL_REVIEW';
  const block = !operator
    ? '담당자를 먼저 지정해 주십시오.'
    : !code
      ? '처리 코드를 고르십시오.'
      : reason.trim().length < 5
        ? '무엇을 확인하고 무엇을 했는지 사유를 적어 주십시오.'
        : null;

  const resolve = async () => {
    setBusy(true);
    try {
      await adminPost(`reconciliation/${item.id}/resolve`, { resolutionCode: code, reason }, actionKey('recon-resolve'));
      await onResolved();
    } catch (err) {
      setError(describe(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={`[${labelOf(EXCEPTION_SEVERITY_LABEL, item.severity)}] ${labelOf(EXCEPTION_TYPE_LABEL, item.exceptionType)}`}>
      <table style={{ borderCollapse: 'collapse', fontSize: 'var(--krds-text-sm)', marginBottom: 'var(--krds-space-3)' }}>
        <tbody>
          <tr>
            <th scope="row" style={th}>원서</th>
            <td style={td}>
              <a href={`/evidence?applicationId=${item.applicationId}`}>{item.applicationId}</a>
            </td>
          </tr>
          <tr>
            <th scope="row" style={th}>발견</th>
            <td style={td}>{kst(item.detectedAt)}</td>
          </tr>
          <tr>
            <th scope="row" style={th}>처리 상태</th>
            <td style={td}>{labelOf(EXCEPTION_STATE_LABEL, item.state)}</td>
          </tr>
          {/* 발견 당시 사실(before). 해소 뒤 상태는 감사 기록에 남는다. */}
          {Object.entries(item.facts).map(([k, v]) => (
            <tr key={k}>
              <th scope="row" style={th}>{factLabel(item.exceptionType, k)}</th>
              <td style={td}>{factValue(item.exceptionType, k, v)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {open && (
        <>
          {error && <Alert tone="danger" title={error} focusKey={error} />}
          <Select label="처리 코드" value={code} onChange={setCode} options={RESOLUTION_OPTIONS} required />
          <Field label="사유 — 무엇을 확인했고 무엇을 했는가" value={reason} onChange={setReason} required multiline maxLength={1000} />
          <Button disabled={busy || block !== null} onClick={() => void resolve()}>
            해소로 기록
          </Button>
          {block && (
            <p style={{ margin: 'var(--krds-space-2) 0 0', fontSize: 'var(--krds-text-sm)', color: 'var(--krds-fg-muted)' }}>{block}</p>
          )}
        </>
      )}
    </Card>
  );
}
