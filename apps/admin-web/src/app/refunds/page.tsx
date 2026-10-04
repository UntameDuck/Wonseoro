'use client';

import { Alert, Button, Card, DescriptionList, Field, Select, TableScroll } from '@wonseoro/krds';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import {
  FEE_REFUND_METHOD_LABEL,
  FEE_REFUND_NOTE_MAX,
  FEE_REFUND_REASON_LABEL,
  FEE_REFUND_REASON_MIN,
  FEE_REFUND_STATUS_LABEL,
  formatSupportCode,
  type FeeRefundQueueItem,
} from '@wonseoro/contracts';
import { td, th } from '../../components/activation';
import { useConsole } from '../../components/console';
import { actionKey, adminGet, adminPost, describe, kst } from '../../lib/api';

type Filter = 'OPEN' | 'DONE' | 'ALL';
type Outcome = 'APPROVED' | 'REJECTED';

const FILTER_LABEL: Record<Filter, string> = { OPEN: '검토 중', DONE: '결정 끝', ALL: '전체' };
const DETAIL_TITLE_ID = 'refund-detail-title';
const won = (n: number | null) => (n === null ? '-' : `${n.toLocaleString('ko-KR')}원`);

/**
 * 전형료 반환·면제/감액 신청 큐 — 고등교육법 시행령 제42조의3 (문서 10 G-5, 대장 D-89)
 *
 * 줄에는 계좌 원문이 없다(끝 네 자리 표기만). 한 건을 열면 계좌·신청 내용이 보이고 그 열람이 원서 처리 이력에 남는다.
 * 열기·결정은 재인증을 받는다. 결정은 한 번 — 승인은 금액(낸 전형료 이하), 거절은 사유. 이체·방문 지급은 재무 절차다.
 */
export default function RefundQueuePage() {
  const { operator } = useConsole();
  const [filter, setFilter] = useState<Filter>('OPEN');
  const [queue, setQueue] = useState<{ items: FeeRefundQueueItem[]; counts: { open: number } } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [opened, setOpened] = useState<FeeRefundQueueItem | null>(null);
  const [outcome, setOutcome] = useState<Outcome | ''>('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [result, setResult] = useState<{ tone: 'success' | 'danger'; title: string } | null>(null);
  const [decisionKey, setDecisionKey] = useState(() => actionKey('refund-decision'));

  const load = useCallback(async (f: Filter) => {
    setError(null);
    try {
      setQueue(await adminGet('fee-refunds', { status: f }));
    } catch (err) {
      setError(describe(err));
    }
  }, []);

  useEffect(() => {
    void load(filter);
  }, [filter, load]);

  useEffect(() => {
    if (opened) document.getElementById(DETAIL_TITLE_ID)?.focus();
  }, [opened?.requestNumber]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = async (number: string) => {
    setBusy(true);
    setResult(null);
    try {
      const item = await adminGet<FeeRefundQueueItem>(`fee-refunds/${encodeURIComponent(number)}`);
      setOpened(item);
      setOutcome('');
      setAmount(String(item.paidAmount));
      setNote('');
      setDecisionKey(actionKey('refund-decision'));
    } catch (err) {
      setResult({ tone: 'danger', title: describe(err) });
    } finally {
      setBusy(false);
    }
  };

  const amountValue = Number(amount);
  const block = !operator
    ? '담당자를 먼저 지정해 주십시오. 누가 결정했는지 기록에 남습니다.'
    : outcome === ''
      ? '결정을 골라 주십시오.'
      : outcome === 'APPROVED' && (!Number.isInteger(amountValue) || amountValue < 1 || (opened !== null && amountValue > opened.paidAmount))
        ? '돌려줄 금액을 1원 이상, 낸 전형료 이하의 원 단위로 적어 주십시오.'
        : note.trim().length === 0
          ? '지원자에게 보낼 안내를 적어 주십시오.'
          : outcome === 'REJECTED' && note.trim().length < FEE_REFUND_REASON_MIN
            ? `반환하지 않는 사유를 ${FEE_REFUND_REASON_MIN}자 이상 적어 주십시오.`
            : null;

  const decide = async () => {
    if (!opened || block) return;
    setBusy(true);
    try {
      const done = await adminPost<FeeRefundQueueItem>(
        `fee-refunds/${encodeURIComponent(opened.requestNumber)}/decision`,
        { outcome, note: note.trim(), ...(outcome === 'APPROVED' ? { amount: amountValue } : {}) },
        decisionKey,
      );
      setOpened(done);
      setResult({ tone: 'success', title: `신청번호 ${done.requestNumber} — 결정했습니다. 지원자 화면에 결과가 보입니다.` });
      await load(filter);
    } catch (err) {
      setResult({ tone: 'danger', title: describe(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1 style={{ fontSize: 'var(--krds-text-2xl)', marginTop: 0 }}>전형료 반환</h1>
      <p>지원자가 보낸 전형료 반환·면제 감액 신청입니다. 결정한 뒤 이체·방문 지급은 대학 재무 절차에 따라 처리해 주십시오.</p>

      <Card title="신청 현황">
        {queue ? <DescriptionList items={[['검토 중', `${queue.counts.open}건`]]} /> : !error && <p role="status" style={{ margin: 0 }}>불러오는 중…</p>}
        <Select
          label="보기"
          value={filter}
          onChange={(v) => setFilter(v as Filter)}
          options={(Object.keys(FILTER_LABEL) as Filter[]).map((f) => ({ value: f, label: FILTER_LABEL[f] }))}
        />
        <Button variant="secondary" disabled={busy} onClick={() => void load(filter)}>
          새로 고침
        </Button>
      </Card>

      {error && <Alert tone="danger" title={`신청 목록을 불러오지 못했습니다. ${error}`} />}

      {queue && (
        <Card title={`${FILTER_LABEL[filter]} 신청 (${queue.items.length}건)`}>
          {queue.items.length === 0 ? (
            <p style={{ margin: 0 }}>해당하는 신청이 없습니다.</p>
          ) : (
            <TableScroll label="전형료 반환 신청 목록">
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--krds-text-sm)' }}>
                <thead>
                  <tr>
                    {['신청번호', '사유', '원서', '낸 전형료', '받은 시각', '상태', '열기'].map((h) => (
                      <th key={h} scope="col" style={th}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {queue.items.map((r) => (
                    <tr key={r.requestNumber}>
                      <td style={td}>{r.requestNumber}</td>
                      <td style={td}>{FEE_REFUND_REASON_LABEL[r.reason]}</td>
                      <td style={td}>{r.applicationNumber ? `접수번호 ${r.applicationNumber}` : `상담 확인번호 ${formatSupportCode(r.supportCode)}`}</td>
                      <td style={td}>{won(r.paidAmount)}</td>
                      <td style={td}>{kst(r.receivedAt)}</td>
                      <td style={td}>{FEE_REFUND_STATUS_LABEL[r.status]}</td>
                      <td style={td}>
                        <Button variant="secondary" disabled={busy} onClick={() => void open(r.requestNumber)}>
                          {`${r.requestNumber} 열기`}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          )}
        </Card>
      )}

      {result && <Alert tone={result.tone} title={result.title} focusKey={result} />}

      {opened && (
        <Card title={`반환 신청 ${opened.requestNumber}`} titleId={DETAIL_TITLE_ID}>
          <Alert tone="info" title="이 열람은 기록됩니다">
            계좌와 신청 내용을 열어 본 사실이 원서 처리 이력에 담당자 열람으로 남습니다.
          </Alert>
          <DescriptionList
            items={[
              ['상태', FEE_REFUND_STATUS_LABEL[opened.status]],
              ['사유', FEE_REFUND_REASON_LABEL[opened.reason]],
              ['원서', opened.applicationNumber ? `접수번호 ${opened.applicationNumber}` : '접수 전'],
              ['낸 전형료', won(opened.paidAmount)],
              ['받은 시각', kst(opened.receivedAt)],
              ['돌려받을 방법', FEE_REFUND_METHOD_LABEL[opened.method]],
              ...(opened.account
                ? ([['계좌', `${opened.account.bank} ${opened.account.number} (예금주 ${opened.account.holder})`]] as Array<[string, ReactNode]>)
                : []),
              ['신청 내용', opened.detail ? <span key="d" style={{ whiteSpace: 'pre-wrap' }}>{opened.detail}</span> : '적은 내용 없음'],
              ...(opened.status !== 'RECEIVED'
                ? ([
                    ['결정 시각', kst(opened.decidedAt)],
                    ['결정한 담당자', opened.decidedBy ?? '-'],
                    ['돌려줄 금액', won(opened.approvedAmount)],
                    ['보낸 안내', <span key="n" style={{ whiteSpace: 'pre-wrap' }}>{opened.resultNote ?? ''}</span>],
                  ] as Array<[string, ReactNode]>)
                : []),
            ]}
          />

          {opened.status === 'RECEIVED' && (
            <>
              <h3 style={{ fontSize: 'var(--krds-text-lg)', margin: 'var(--krds-space-5) 0 var(--krds-space-3)' }}>결정</h3>
              <Select
                label="결정"
                value={outcome}
                onChange={(v) => setOutcome(v as Outcome)}
                options={[
                  { value: '', label: '선택해 주십시오' },
                  { value: 'APPROVED', label: FEE_REFUND_STATUS_LABEL.APPROVED },
                  { value: 'REJECTED', label: FEE_REFUND_STATUS_LABEL.REJECTED },
                ]}
              />
              {outcome === 'APPROVED' && (
                <Field label="돌려줄 금액(원)" type="number" value={amount} onChange={setAmount} hint={`낸 전형료 ${won(opened.paidAmount)} 이하`} required />
              )}
              <Field
                label="지원자에게 보낼 안내"
                hint="지원자 화면에 그대로 보입니다. 이체 예정일·방문 장소·거절 사유를 적습니다. 결정은 한 번만 할 수 있습니다."
                value={note}
                onChange={setNote}
                maxLength={FEE_REFUND_NOTE_MAX}
                multiline
                required
              />
              <Button disabled={busy || block !== null} onClick={() => void decide()}>
                {busy ? '결정하는 중…' : '결정 보내기'}
              </Button>
              {block && (
                <p style={{ margin: 'var(--krds-space-2) 0 0', fontSize: 'var(--krds-text-sm)', color: 'var(--krds-fg-muted)' }}>{block}</p>
              )}
            </>
          )}
        </Card>
      )}
    </>
  );
}
