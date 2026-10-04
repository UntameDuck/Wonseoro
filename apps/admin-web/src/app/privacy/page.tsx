'use client';

import { Alert, Button, Card, DescriptionList, Field, Icon, Select, TableScroll } from '@wonseoro/krds';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import {
  APPLICATION_STATUS_LABEL,
  PRIVACY_REQUEST_DUE_DAYS,
  PRIVACY_REQUEST_KIND_LABEL,
  PRIVACY_REQUEST_NOTE_MAX,
  PRIVACY_REQUEST_OUTCOME,
  PRIVACY_REQUEST_REASON_MIN,
  PRIVACY_REQUEST_STATUS_LABEL,
  formatSupportCode,
  labelOf,
  type PrivacyQueueItem,
  type PrivacyRequestOutcome,
} from '@wonseoro/contracts';
import { td, th } from '../../components/activation';
import { useConsole } from '../../components/console';
import { actionKey, adminGet, adminPost, describe, kst } from '../../lib/api';

type Filter = 'OPEN' | 'DONE' | 'ALL';

const FILTER_LABEL: Record<Filter, string> = { OPEN: '처리 중', DONE: '회신 끝', ALL: '전체' };
const OUTCOME_HELP: Record<PrivacyRequestOutcome, string> = {
  COMPLETED: '요청대로 처리했습니다. 무엇을 했는지 지원자에게 알립니다.',
  PARTIALLY_COMPLETED: '일부만 처리했습니다. 처리하지 못한 부분과 그 사유를 알립니다.',
  REFUSED: '처리하지 않습니다. 법령상 사유(보존 의무, 입학자 선발 업무에 중대한 지장 등)를 알립니다.',
};
const DETAIL_TITLE_ID = 'privacy-detail-title';

/**
 * 정보주체 권리 요청 처리 큐 — 보호법 제35~38조, 시행령 제41·43·44조 (문서 10 G-10, 대장 D-84)
 *
 * 지원자가 원서에 남긴 열람·정정·삭제·처리정지 요청을 받은 날부터 10일 안에 회신한다. 큐 줄에는 요청 내용이 없다 —
 * 한 건을 열면 지원자가 쓴 내용(개인정보)이 보이고, 그 열람은 원서 처리 이력에 남는다. 열기·회신은 재인증을 받는다.
 * 실제 정정·삭제는 대학 규정·보존 의무를 따져 정한 절차로 한 뒤 결과를 여기서 회신한다 — 회신 문장은 지원자 화면에 그대로 보인다.
 */
export default function PrivacyQueuePage() {
  const { operator } = useConsole();
  const [filter, setFilter] = useState<Filter>('OPEN');
  const [queue, setQueue] = useState<{ items: PrivacyQueueItem[]; counts: { open: number; overdue: number; dueSoon: number } } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [opened, setOpened] = useState<PrivacyQueueItem | null>(null);
  const [outcome, setOutcome] = useState<PrivacyRequestOutcome | ''>('');
  const [note, setNote] = useState('');
  const [result, setResult] = useState<{ tone: 'success' | 'danger'; title: string } | null>(null);
  /** 같은 회신을 다시 눌러도 한 번만 처리되게 — 요청을 새로 열 때 바꾼다 */
  const [decisionKey, setDecisionKey] = useState(() => actionKey('privacy-decision'));

  const load = useCallback(async (f: Filter) => {
    setError(null);
    try {
      setQueue(await adminGet('privacy-requests', { status: f }));
    } catch (err) {
      setError(describe(err));
    }
  }, []);

  useEffect(() => {
    void load(filter);
  }, [filter, load]);

  // 연 요청의 제목으로 포커스 — "열기" 를 누른 표 줄에서 아래 상세로 옮긴다 (T-M5-40)
  useEffect(() => {
    if (opened) document.getElementById(DETAIL_TITLE_ID)?.focus();
  }, [opened?.requestNumber]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = async (number: string) => {
    setBusy(true);
    setResult(null);
    try {
      setOpened(await adminGet<PrivacyQueueItem>(`privacy-requests/${encodeURIComponent(number)}`));
      setOutcome('');
      setNote('');
      setDecisionKey(actionKey('privacy-decision'));
    } catch (err) {
      setResult({ tone: 'danger', title: describe(err) });
    } finally {
      setBusy(false);
    }
  };

  const noteShort = outcome !== '' && outcome !== 'COMPLETED' && note.trim().length < PRIVACY_REQUEST_REASON_MIN;
  const block = !operator
    ? '담당자를 먼저 지정해 주십시오. 누가 회신했는지 기록에 남습니다.'
    : outcome === ''
      ? '처리 결과를 골라 주십시오.'
      : note.trim().length === 0
        ? '지원자에게 보낼 결과 안내를 적어 주십시오.'
        : noteShort
          ? `일부 처리·처리하지 않음은 사유를 ${PRIVACY_REQUEST_REASON_MIN}자 이상 적어 주십시오.`
          : null;

  const decide = async () => {
    if (!opened || block) return;
    setBusy(true);
    try {
      const done = await adminPost<PrivacyQueueItem>(
        `privacy-requests/${encodeURIComponent(opened.requestNumber)}/decision`,
        { outcome, note: note.trim() },
        decisionKey,
      );
      setOpened(done);
      setResult({ tone: 'success', title: `요청번호 ${done.requestNumber} — 회신했습니다. 지원자 화면에 결과가 보입니다.` });
      await load(filter);
    } catch (err) {
      setResult({ tone: 'danger', title: describe(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1 style={{ fontSize: 'var(--krds-text-2xl)', marginTop: 0 }}>개인정보 권리 요청</h1>
      <p>
        지원자가 원서에 남긴 개인정보 열람·정정·삭제·처리정지 요청입니다. 받은 날부터 {PRIVACY_REQUEST_DUE_DAYS}일 안에 결과를
        회신합니다. 정정·삭제는 대학 규정과 보존 의무를 확인해 처리한 뒤 회신해 주십시오.
      </p>

      <Card title="처리 현황">
        {queue ? (
          <DescriptionList
            items={[
              ['처리 중', `${queue.counts.open}건`],
              [
                '처리 기한 지남',
                queue.counts.overdue > 0 ? (
                  <strong key="o" style={{ color: 'var(--krds-danger)' }}>
                    <Icon name="warning" />
                    {queue.counts.overdue}건
                  </strong>
                ) : (
                  '없음'
                ),
              ],
              ['3일 안에 기한', `${queue.counts.dueSoon}건`],
            ]}
          />
        ) : (
          !error && <p role="status" style={{ margin: 0 }}>불러오는 중…</p>
        )}
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

      {error && <Alert tone="danger" title={`요청 목록을 불러오지 못했습니다. ${error}`} />}

      {queue && (
        <Card title={`${FILTER_LABEL[filter]} 요청 (${queue.items.length}건)`}>
          {queue.items.length === 0 ? (
            <p style={{ margin: 0 }}>해당하는 요청이 없습니다.</p>
          ) : (
            <TableScroll label="권리 요청 목록">
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--krds-text-sm)' }}>
                <thead>
                  <tr>
                    {/* 숨김 글(위치 고정)은 표 스크롤 영역 밖으로 빠져 문서에 가로 스크롤을 만든다 — 머리글은 보이는 글로 */}
                    {['요청번호', '종류', '원서', '받은 시각', '처리 기한', '상태', '열기'].map((h) => (
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
                      <td style={td}>{PRIVACY_REQUEST_KIND_LABEL[r.kind]}</td>
                      <td style={td}>
                        {r.applicationNumber ? `접수번호 ${r.applicationNumber}` : `상담 확인번호 ${formatSupportCode(r.supportCode)}`}
                      </td>
                      <td style={td}>{kst(r.receivedAt)}</td>
                      <td style={td}>
                        {kst(r.dueAt)}
                        {r.status === 'RECEIVED' && <DueBadge item={r} />}
                      </td>
                      <td style={td}>{PRIVACY_REQUEST_STATUS_LABEL[r.status]}</td>
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
        <Card title={`${PRIVACY_REQUEST_KIND_LABEL[opened.kind]} 요청 ${opened.requestNumber}`} titleId={DETAIL_TITLE_ID}>
          <Alert tone="info" title="이 열람은 기록됩니다">
            요청 내용을 열어 본 사실이 원서 처리 이력에 담당자 열람으로 남습니다.
          </Alert>
          <DescriptionList
            items={[
              ['상태', PRIVACY_REQUEST_STATUS_LABEL[opened.status]],
              ['원서', opened.applicationNumber ? `접수번호 ${opened.applicationNumber}` : '접수 전'],
              ['상담 확인번호', formatSupportCode(opened.supportCode)],
              ['원서 상태', labelOf(APPLICATION_STATUS_LABEL, opened.applicationStatus, '확인 중')],
              ['받은 시각', kst(opened.receivedAt)],
              ['처리 기한', `${kst(opened.dueAt)}${opened.status === 'RECEIVED' ? (opened.overdue ? ' (지남)' : ` (${opened.daysLeft}일 남음)`) : ''}`],
              ['요청 내용', opened.detail ? <span key="d" style={{ whiteSpace: 'pre-wrap' }}>{opened.detail}</span> : '적은 내용 없음'],
              ...(opened.status !== 'RECEIVED'
                ? ([
                    ['회신 시각', kst(opened.decidedAt)],
                    ['회신한 담당자', opened.decidedBy ?? '-'],
                    ['보낸 안내', <span key="n" style={{ whiteSpace: 'pre-wrap' }}>{opened.resultNote ?? ''}</span>],
                  ] as Array<[string, ReactNode]>)
                : []),
            ]}
          />

          {opened.status === 'RECEIVED' && (
            <>
              <h3 style={{ fontSize: 'var(--krds-text-lg)', margin: 'var(--krds-space-5) 0 var(--krds-space-3)' }}>회신</h3>
              <Select
                label="처리 결과"
                value={outcome}
                onChange={(v) => setOutcome(v as PrivacyRequestOutcome)}
                hint={outcome ? OUTCOME_HELP[outcome] : '결과에 따라 지원자에게 알릴 내용이 다릅니다.'}
                options={[
                  { value: '', label: '선택해 주십시오' },
                  ...PRIVACY_REQUEST_OUTCOME.map((o) => ({ value: o, label: PRIVACY_REQUEST_STATUS_LABEL[o] })),
                ]}
              />
              <Field
                label="지원자에게 보낼 결과 안내"
                hint="지원자 화면에 그대로 보입니다. 열람이면 자료를 받는 방법, 정정·삭제면 처리한 내용을 적습니다. 회신은 한 번만 할 수 있습니다."
                value={note}
                onChange={setNote}
                maxLength={PRIVACY_REQUEST_NOTE_MAX}
                multiline
                required
                {...(noteShort ? { error: `사유를 ${PRIVACY_REQUEST_REASON_MIN}자 이상 적어 주십시오.` } : {})}
              />
              <Button disabled={busy || block !== null} onClick={() => void decide()}>
                {busy ? '회신하는 중…' : '회신'}
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

/** 기한까지 남은 날 — 지났으면 강조 (색만으로 구분하지 않는다: 아이콘·글 함께) */
function DueBadge({ item }: { item: PrivacyQueueItem }) {
  if (item.overdue) {
    return (
      <strong style={{ display: 'block', color: 'var(--krds-danger)' }}>
        <Icon name="warning" />
        기한 지남
      </strong>
    );
  }
  return (
    <span style={{ display: 'block', color: item.daysLeft <= 3 ? 'var(--krds-warning)' : 'var(--krds-fg-muted)' }}>
      {item.daysLeft <= 0 ? '오늘까지' : `${item.daysLeft}일 남음`}
    </span>
  );
}
