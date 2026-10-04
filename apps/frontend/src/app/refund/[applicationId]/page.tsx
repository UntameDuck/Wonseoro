'use client';

import { type ReactNode, use, useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, DescriptionList, Field, Select } from '@wonseoro/krds';
import {
  FEE_REFUND_DETAIL_MAX,
  FEE_REFUND_METHOD,
  FEE_REFUND_METHOD_LABEL,
  FEE_REFUND_REASON,
  FEE_REFUND_REASON_LABEL,
  FEE_REFUND_STATUS_LABEL,
  problemText,
  type FeeRefundMethod,
  type FeeRefundReason,
  type FeeRefundView,
} from '@wonseoro/contracts';
import { Breadcrumb } from '../../../krds/navigation';
import { FeeRefundNotice } from '../../../krds/university-notices';
import { ApiError, NetworkError, api, newIdempotencyKey } from '../../../lib/api';
import { loadSession } from '../../../lib/session';
import { formatKst } from '../../../lib/use-deadline';

/**
 * 전형료 반환·면제/감액 신청 — 고등교육법 시행령 제42조의3 (문서 10 G-5, D-89)
 *
 * 결제가 확인된 원서에만 받는다(서버가 409). 계좌는 신청할 때만 받고 서버가 원서 데이터 키로 봉한다 —
 * 화면에는 끝 네 자리만 다시 보인다. 받는 방법은 둘(계좌이체·방문 수령)이다(제42조의3 ⑤).
 */
export default function FeeRefundPage({ params }: { params: Promise<{ applicationId: string }> }) {
  const { applicationId } = use(params);
  const [applicantId, setApplicantId] = useState<string | null>(null);
  const [noSession, setNoSession] = useState(false);
  const [requests, setRequests] = useState<FeeRefundView[] | null>(null);
  const [loadError, setLoadError] = useState<{ title: string; detail: string } | null>(null);
  const [feeRefund, setFeeRefund] = useState<string | undefined>(undefined);

  const [reason, setReason] = useState<FeeRefundReason | ''>('');
  const [method, setMethod] = useState<FeeRefundMethod>('ACCOUNT');
  const [bank, setBank] = useState('');
  const [holder, setHolder] = useState('');
  const [number, setNumber] = useState('');
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(() => newIdempotencyKey('refund'));
  const [result, setResult] = useState<{ tone: 'success' | 'info' | 'danger'; title: string; body: string } | null>(null);

  const load = useCallback(async (who: string) => {
    setLoadError(null);
    try {
      setRequests((await api.feeRefunds(applicationId, who)).data.requests);
    } catch (err) {
      setLoadError(
        err instanceof NetworkError
          ? { title: '대학 접수 서버에 연결할 수 없습니다', detail: '잠시 후 다시 시도해 주십시오. 보낸 신청이 사라진 것은 아닙니다.' }
          : problemText(err instanceof ApiError ? err.problem : null),
      );
    }
  }, [applicationId]);

  useEffect(() => {
    const session = loadSession();
    if (!session) {
      setNoSession(true);
      return;
    }
    setApplicantId(session.applicantId);
    void load(session.applicantId);
    void api.currentCycle().then((c) => setFeeRefund(c.data.notices?.feeRefund), () => undefined);
  }, [load]);

  const block =
    reason === ''
      ? '반환 사유를 골라 주십시오.'
      : method === 'ACCOUNT' && (!bank.trim() || !holder.trim() || !/^[0-9][0-9-]{5,29}$/.test(number.replace(/\s/g, '')))
        ? '은행 이름·예금주·계좌번호(숫자와 하이픈)를 적어 주십시오.'
        : null;

  async function submit() {
    if (!applicantId || block || reason === '') return;
    setBusy(true);
    try {
      const res = await api.createFeeRefund(
        applicationId,
        {
          reason,
          method,
          ...(method === 'ACCOUNT' ? { account: { bank: bank.trim(), holder: holder.trim(), number: number.replace(/\s/g, '') } } : {}),
          ...(detail.trim() ? { detail: detail.trim() } : {}),
        },
        applicantId,
        key,
      );
      setResult(
        res.status === 201
          ? { tone: 'success', title: '전형료 반환을 신청했습니다', body: `신청번호 ${res.data.requestNumber}. 입학처가 검토한 뒤 결과를 이 화면에 알려 드립니다.` }
          : { tone: 'info', title: '이미 검토 중인 신청이 있습니다', body: `신청번호 ${res.data.requestNumber}. 같은 신청을 다시 보내지 않아도 됩니다.` },
      );
      setReason('');
      setBank('');
      setHolder('');
      setNumber('');
      setDetail('');
      setKey(newIdempotencyKey('refund'));
      await load(applicantId);
    } catch (err) {
      const text =
        err instanceof NetworkError
          ? { title: '신청을 보내지 못했습니다', detail: '대학 접수 서버에 연결할 수 없습니다. 잠시 후 같은 내용으로 다시 보내 주십시오.' }
          : err instanceof ApiError && err.httpStatus === 409
            ? { title: '반환을 신청할 수 없는 원서입니다', detail: '전형료 결제가 확인된 원서만 반환을 신청할 수 있습니다.' }
            : problemText(err instanceof ApiError ? err.problem : null);
      setResult({ tone: 'danger', title: text.title, body: text.detail });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Breadcrumb
        trail={[
          { label: '홈', href: '/' },
          { label: '원서 작성', href: `/apply/${applicationId}` },
          { label: '전형료 반환 신청' },
        ]}
      />
      <h1 style={{ fontSize: 'var(--krds-text-2xl)', marginTop: 0 }}>전형료 반환 신청</h1>

      {noSession ? (
        <Card title="본인확인이 필요합니다">
          <p style={{ marginTop: 0 }}>신청하려면 접수 홈에서 먼저 본인확인을 해 주십시오.</p>
          <a href="/" style={{ color: 'var(--krds-primary)' }}>
            접수 홈으로
          </a>
        </Card>
      ) : (
        <>
          <p>전형료를 돌려받을 사유가 있거나 전형료 면제·감액 대상이면 신청해 주십시오. 입학처가 검토해 결과를 알려 드립니다.</p>
          <FeeRefundNotice text={feeRefund} level={2} />

          {result && (
            <Alert tone={result.tone} title={result.title} focusKey={result}>
              {result.body}
            </Alert>
          )}

          <Card title="새 신청">
            <Select
              label="반환 사유"
              value={reason}
              onChange={(v) => setReason(v as FeeRefundReason)}
              options={[{ value: '', label: '선택해 주십시오' }, ...FEE_REFUND_REASON.map((r) => ({ value: r, label: FEE_REFUND_REASON_LABEL[r] }))]}
              hint="면제·감액 대상이면 증빙 서류를 원서 서류 단계에 올리거나 입학처 안내에 따라 내 주십시오."
            />
            <Select
              label="돌려받을 방법"
              value={method}
              onChange={(v) => setMethod(v as FeeRefundMethod)}
              options={FEE_REFUND_METHOD.map((m) => ({ value: m, label: FEE_REFUND_METHOD_LABEL[m] }))}
            />
            {method === 'ACCOUNT' && (
              <>
                <Field label="은행 이름" value={bank} onChange={setBank} maxLength={40} required />
                <Field label="예금주" value={holder} onChange={setHolder} maxLength={40} required />
                <Field
                  label="계좌번호"
                  value={number}
                  onChange={setNumber}
                  maxLength={30}
                  hint="숫자와 하이픈으로 적습니다. 반환 처리에만 쓰고 입학처 담당자만 봅니다."
                  required
                />
              </>
            )}
            <Field
              label="신청 내용"
              value={detail}
              onChange={setDetail}
              hint="사유를 설명할 내용이 있으면 적어 주십시오."
              maxLength={FEE_REFUND_DETAIL_MAX}
              multiline
            />
            <Button onClick={() => void submit()} disabled={busy || !applicantId || block !== null}>
              {busy ? '보내는 중…' : '반환 신청'}
            </Button>
            {block && (
              <p style={{ margin: 'var(--krds-space-2) 0 0', fontSize: 'var(--krds-text-sm)', color: 'var(--krds-fg-muted)' }}>{block}</p>
            )}
          </Card>

          <Card title="보낸 신청과 결과">
            {loadError ? (
              <Alert tone="danger" title={loadError.title}>
                <p style={{ margin: '0 0 var(--krds-space-3)' }}>{loadError.detail}</p>
                <Button variant="secondary" onClick={() => applicantId && void load(applicantId)}>
                  다시 불러오기
                </Button>
              </Alert>
            ) : requests === null ? (
              <p role="status">불러오는 중…</p>
            ) : requests.length === 0 ? (
              <p style={{ margin: 0 }}>아직 보낸 신청이 없습니다.</p>
            ) : (
              requests.map((r) => (
                <section key={r.requestNumber} style={{ borderTop: '1px solid var(--krds-border)', paddingTop: 'var(--krds-space-4)', marginTop: 'var(--krds-space-4)' }}>
                  <h3 style={{ margin: '0 0 var(--krds-space-2)', fontSize: 'var(--krds-text-lg)' }}>
                    {FEE_REFUND_REASON_LABEL[r.reason]} · {FEE_REFUND_STATUS_LABEL[r.status]}
                  </h3>
                  <DescriptionList
                    items={[
                      ['신청번호', r.requestNumber],
                      ['받은 시각', formatKst(r.receivedAt)],
                      ['낸 전형료', `${r.paidAmount.toLocaleString('ko-KR')}원`],
                      ['돌려받을 방법', r.accountMasked ? `${FEE_REFUND_METHOD_LABEL[r.method]} (${r.accountMasked})` : FEE_REFUND_METHOD_LABEL[r.method]],
                      ...(r.approvedAmount !== null ? ([['돌려받을 금액', `${r.approvedAmount.toLocaleString('ko-KR')}원`]] as Array<[string, ReactNode]>) : []),
                      ...(r.decidedAt ? ([['결정 시각', formatKst(r.decidedAt)]] as Array<[string, ReactNode]>) : []),
                      ...(r.resultNote ? ([['입학처 안내', <span key="n" style={{ whiteSpace: 'pre-wrap' }}>{r.resultNote}</span>]] as Array<[string, ReactNode]>) : []),
                    ]}
                  />
                </section>
              ))
            )}
          </Card>
        </>
      )}
    </>
  );
}
