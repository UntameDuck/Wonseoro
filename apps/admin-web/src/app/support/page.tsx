'use client';

import { Alert, Button, Card, DescriptionList, Field, Select, TableScroll } from '@wonseoro/krds';
import { useState } from 'react';
import {
  APPLICATION_STATUS_LABEL,
  AUDIT_RESULT_LABEL,
  PAYMENT_STATUS_LABEL,
  SUPPORT_LOOKUP_KIND_LABEL,
  SUPPORT_REASON,
  SUPPORT_REASON_LABEL,
  labelOf,
  type SupportReason,
} from '@wonseoro/contracts';
import { td, th } from '../../components/activation';
import { useConsole } from '../../components/console';
import { actionKey, adminGet, adminPost, describe, kst } from '../../lib/api';

/** 응답 모양 — 계약 SupportView (OpenAPI 1.9.0). 서버가 허용 목록으로만 만든다 */
interface SupportView {
  evidenceNumber: string;
  lookedUpAt: string;
  reason: SupportReason;
  lookupKind: 'APPLICATION_NUMBER' | 'SUPPORT_CODE';
  universityName: string;
  cycleName: string;
  application: { status: string; summary: string; lastSavedAt: string | null };
  submission: { submitted: boolean; applicationNumber: string | null; finalizedAt: string | null };
  payment: { status: string | null; amount: number | null; requestedAt: string | null; verifiedAt: string | null; guidance: string };
  documents: { available: number; scanning: number; rejected: number; uploading: number };
  centralSync: { pending: number; sent: number; lastSentAt: string | null; guidance: string };
  deadline: { deadlineAt: string | null };
  incidents: Array<{ severity: string; title: string; startsAt: string }>;
  timeline: Array<{ at: string; what: string; result: string }>;
  agentGuidance: string[];
  /** 증적번호로 다시 열 때만 */
  snapshotHash?: string;
  intact?: boolean;
}

const SEVERITY: Record<string, string> = { NOTICE: '안내', DEGRADED: '일부 기능 지연', OUTAGE: '서비스 장애' };

/**
 * 상담 조회 — 노션 §01 B11 "자동 증적번호, PII 최소 Support View" (T-M6-07, 대장 D-79)
 *
 * 장애 중 고객센터가 지원자의 이름·연락처를 묻지 않고 접수번호나 상담 확인번호로 "서버가 아는 상태" 를 본다.
 * 원서 내용·서류·연락처는 서버 응답에 처음부터 없다 — 이 화면이 숨기는 것이 아니다.
 * 조회할 때마다 증적번호가 생기고 그 순간 보인 내용이 그대로 남는다. 지원자와의 통화 기록에 증적번호를 적는다.
 */
export default function SupportPage() {
  const { operator } = useConsole();
  const [key, setKey] = useState('');
  const [reason, setReason] = useState<SupportReason | ''>('');
  const [view, setView] = useState<SupportView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [evidence, setEvidence] = useState('');

  const block = !operator
    ? '담당자를 먼저 지정해 주십시오. 누가 조회했는지 기록에 남습니다.'
    : key.trim().length === 0
      ? '접수번호나 상담 확인번호를 적어 주십시오.'
      : reason === ''
        ? '문의 분류를 선택해 주십시오.'
        : null;

  const run = async (fn: () => Promise<SupportView>) => {
    setBusy(true);
    setView(null);
    setError(null);
    try {
      setView(await fn());
    } catch (err) {
      setError(describe(err));
    } finally {
      setBusy(false);
    }
  };

  const lookup = () =>
    run(() => adminPost<SupportView>('support/lookups', { key: key.trim(), reason }, actionKey('support-lookup')));
  const reopen = () => run(() => adminGet<SupportView>(`support/lookups/${encodeURIComponent(evidence.trim())}`));

  return (
    <>
      <h1 style={{ fontSize: 'var(--krds-text-2xl)', marginTop: 0 }}>상담 조회</h1>
      <p>지원자가 불러 준 접수번호나 상담 확인번호로 접수·결제·서류 상태를 확인합니다. 이름·연락처·원서 내용은 보이지 않으며, 묻지 않습니다.</p>

      <Card title="원서 찾기">
        <Alert tone="info" title="이 조회는 기록됩니다">
          조회할 때마다 증적번호가 만들어지고, 그때 본 내용이 그대로 남습니다. 지원자의 처리 이력에도 상담 조회로 표시됩니다.
        </Alert>
        <Field
          label="접수번호 또는 상담 확인번호"
          hint="상담 확인번호는 지원자의 내 원서 상태 확인 화면에 있는 10자리 번호입니다."
          value={key}
          onChange={setKey}
          maxLength={80}
          required
        />
        {/* 빈 선택지가 있는 필수 select 는 처음부터 "올바르지 않음" 으로 읽힌다 — 필수 표시는 안내로, 막는 것은 버튼으로 */}
        <Select
          label="문의 분류"
          hint="통화 내용에 맞는 분류를 고릅니다. 고르지 않으면 조회할 수 없습니다."
          value={reason}
          onChange={(value) => setReason(value as SupportReason)}
          options={[
            { value: '', label: '선택해 주십시오' },
            ...SUPPORT_REASON.map((r) => ({ value: r, label: SUPPORT_REASON_LABEL[r] })),
          ]}
        />
        <Button disabled={busy || block !== null} onClick={() => void lookup()}>
          조회
        </Button>
        {block && (
          <p style={{ margin: 'var(--krds-space-2) 0 0', fontSize: 'var(--krds-text-sm)', color: 'var(--krds-fg-muted)' }}>{block}</p>
        )}
      </Card>

      <Card title="증적번호로 다시 보기">
        <p style={{ marginTop: 0 }}>앞서 안내한 내용을 다시 확인합니다. 지금 상태가 아니라 그때 보인 내용입니다.</p>
        <Field label="증적번호" value={evidence} onChange={setEvidence} maxLength={20} required />
        <Button variant="secondary" disabled={busy || evidence.trim().length === 0} onClick={() => void reopen()}>
          다시 보기
        </Button>
      </Card>

      {error && <Alert tone="danger" title={error} focusKey={error} />}
      {view && <SupportResult view={view} />}
    </>
  );
}

function SupportResult({ view }: { view: SupportView }) {
  const reopened = view.snapshotHash !== undefined;
  const doc = view.documents;
  return (
    <>
      {/* 조회 결과의 맨 위로 포커스 — 누른 버튼이 처리 중 비활성이 되며 포커스가 떨어진다 (T-M5-41) */}
      {reopened && view.intact === false ? (
        <Alert tone="danger" title={`증적번호 ${view.evidenceNumber} — 기록이 남은 뒤 바뀌었습니다`} focusKey={view}>
          이 기록을 안내 근거로 쓰지 말고 보안 담당에게 알려 주십시오.
        </Alert>
      ) : (
        <Alert
          tone="success"
          title={`증적번호 ${view.evidenceNumber}`}
          focusKey={view}
        >
          {reopened
            ? `${kst(view.lookedUpAt)}에 안내한 내용입니다. 기록 원본과 같습니다.`
            : '통화 기록에 이 번호를 적어 주십시오. 지원자에게 알려 주어도 됩니다.'}
        </Alert>
      )}

      <Card title="안내할 말">
        <ul style={{ margin: 0, paddingLeft: 'var(--krds-space-5)' }}>
          {view.agentGuidance.map((g) => (
            <li key={g}>{g}</li>
          ))}
        </ul>
      </Card>

      {view.incidents.length > 0 && (
        <Card title="지금 표시 중인 장애 공지">
          <ul style={{ margin: 0, paddingLeft: 'var(--krds-space-5)' }}>
            {view.incidents.map((i) => (
              <li key={`${i.startsAt}-${i.title}`}>
                {SEVERITY[i.severity] ?? '안내'} · {i.title} ({kst(i.startsAt)}부터)
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title={`${view.universityName} · ${view.cycleName}`}>
        <DescriptionList
          items={[
            ['원서 상태', `${labelOf(APPLICATION_STATUS_LABEL, view.application.status, '확인 중')} — ${view.application.summary}`],
            [
              '접수',
              view.submission.submitted
                ? `접수 완료 · 접수번호 ${view.submission.applicationNumber} · ${kst(view.submission.finalizedAt)}`
                : '아직 접수되지 않았습니다',
            ],
            [
              '결제',
              view.payment.status
                ? `${labelOf(PAYMENT_STATUS_LABEL, view.payment.status, '확인 중')} · ${(view.payment.amount ?? 0).toLocaleString('ko-KR')}원 · 요청 ${kst(view.payment.requestedAt)}${view.payment.verifiedAt ? ` · 확인 ${kst(view.payment.verifiedAt)}` : ''}`
                : view.payment.guidance,
            ],
            ['서류', `검사 완료 ${doc.available}건 · 검사 중 ${doc.scanning}건 · 통과 못 함 ${doc.rejected}건 · 올리는 중 ${doc.uploading}건`],
            ['통합 조회 반영', view.centralSync.guidance],
            ['마지막 저장', kst(view.application.lastSavedAt)],
            ['접수 마감', kst(view.deadline.deadlineAt)],
            ['찾은 번호', SUPPORT_LOOKUP_KIND_LABEL[view.lookupKind]],
            ['문의 분류', SUPPORT_REASON_LABEL[view.reason]],
            ['조회 시각', kst(view.lookedUpAt)],
          ]}
        />
      </Card>

      <Card title={`처리 이력 (${view.timeline.length}건)`}>
        <TableScroll label="처리 이력">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--krds-text-sm)' }}>
            <thead>
              <tr>
                {['시각', '처리', '결과'].map((h) => (
                  <th key={h} scope="col" style={th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.timeline.map((t, i) => (
                <tr key={`${t.at}-${i}`}>
                  <td style={td}>{kst(t.at)}</td>
                  <td style={td}>{t.what}</td>
                  <td style={td}>{labelOf(AUDIT_RESULT_LABEL, t.result)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      </Card>
    </>
  );
}
