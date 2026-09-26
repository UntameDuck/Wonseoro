'use client';

import { Alert, Button, Card, Field } from '@wonseoro/krds';
import { useCallback, useEffect, useState } from 'react';
import { ActivationTable, td, th, type ActivationList } from '../../components/activation';
import {
  ApprovalProgress,
  BlockReason,
  activateBlock,
  approveBlock,
} from '../../components/approval';
import { NeedsCycle, useConsole } from '../../components/console';
import { ApiError, actionKey, adminGet, adminPost, describe, kst } from '../../lib/api';

interface Policy {
  policyId: string;
  version: string;
  mode: string;
  deadlineAt: string;
  approvedBy: string[];
  activatedAt: string | null;
  createdBy: string;
  extension: {
    extendsVersion: string;
    extendsDeadlineAt: string;
    reason: string;
    decisionRef: string;
  } | null;
}

/**
 * 마감 · 연장 — T-M3-14 화면, v1.1 §B17
 *
 * **이 시스템은 연장을 결정하지 않는다.** 입학처의 결정을 기록하고 집행한다.
 * 그래서 연장 양식의 첫 칸이 새 마감시각이 아니라 **입학처 결정 문서번호**다.
 *
 * 흐름: 연장 초안(사유·결정번호) → 작성자가 아닌 2명 승인 → 적용 → 서명된 기록.
 * 409 는 실패가 아니다 — 승인하는 사이 다른 정책이 적용됐다는 뜻이고, 현재 마감을
 * 기준으로 다시 작성하라는 안내로 보여준다.
 */
export default function DeadlinePage() {
  return (
    <>
      <h1 style={{ fontSize: 'var(--krds-text-2xl)', marginTop: 0 }}>마감 · 연장</h1>
      <NeedsCycle>{(cycle) => <DeadlineConsole cycleId={cycle.id} />}</NeedsCycle>
    </>
  );
}

function DeadlineConsole({ cycleId }: { cycleId: string }) {
  const { operator } = useConsole();
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [activations, setActivations] = useState<ActivationList | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 적용이 끝난 정책은 대기 목록에서 빠진다. 그 카드 안에 성공 알림을 두면 함께 사라진다.
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [p, a] = await Promise.all([
        adminGet<{ policies: Policy[] }>('deadline-policies', { cycleId }),
        adminGet<ActivationList>('activations', { cycleId }),
      ]);
      setPolicies(p.policies);
      setActivations(a);
      setError(null);
    } catch (err) {
      setError(describe(err));
    }
  }, [cycleId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // 지금 효력이 있는 정책 — 적용 시각이 지난 것 중 가장 최근.
  const now = Date.now();
  const current = policies
    .filter((p) => p.activatedAt && Date.parse(p.activatedAt) <= now)
    .sort((a, b) => Date.parse(b.activatedAt!) - Date.parse(a.activatedAt!))[0];
  const pending = policies.filter((p) => !p.activatedAt);

  return (
    <>
      {error && <Alert tone="danger" title={error} />}
      {notice && <Alert tone="success" title={notice} />}
      <Card title="지금 적용 중인 마감">
        {current ? (
          <p style={{ margin: 0, fontSize: 'var(--krds-text-lg)' }}>
            <strong>{kst(current.deadlineAt)}</strong>{' '}
            <span style={{ fontSize: 'var(--krds-text-sm)', color: 'var(--krds-fg-muted)' }}>
              정책 {current.version} · {current.mode} · 적용 {kst(current.activatedAt)}
            </span>
          </p>
        ) : (
          <Alert tone="warning" title="적용 중인 마감 정책이 없습니다">
            마감 판정이 거부되고 있거나, 개발용 환경변수 정책으로 판정 중입니다.
          </Alert>
        )}
      </Card>

      {current && <ExtensionForm cycleId={cycleId} current={current} operator={operator} onCreated={reload} />}

      <Card title="승인 대기">
        {pending.length === 0 ? (
          <p style={{ margin: 0 }}>승인 대기 중인 마감 정책이 없습니다.</p>
        ) : (
          pending.map((p) => (
            <PendingPolicy
              key={p.policyId}
              policy={p}
              current={current ?? null}
              operator={operator}
              onChanged={async (done) => {
                if (done) setNotice(done);
                await reload();
              }}
            />
          ))
        )}
      </Card>

      <Card title="적용 이력 (서명된 기록)">
        {activations ? <ActivationTable list={activations} filter="DEADLINE_POLICY" /> : <p>불러오는 중…</p>}
      </Card>
    </>
  );
}

function ExtensionForm({
  cycleId,
  current,
  operator,
  onCreated,
}: {
  cycleId: string;
  current: Policy;
  operator: string | null;
  onCreated: () => Promise<void>;
}) {
  const [decisionRef, setDecisionRef] = useState('');
  const [reason, setReason] = useState('');
  const [deadline, setDeadline] = useState('');
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // datetime-local 은 브라우저의 지역 시각이다. 서버에는 UTC ISO 로 보낸다.
  const newDeadline = deadline ? new Date(deadline) : null;
  const later = newDeadline !== null && newDeadline.getTime() > Date.parse(current.deadlineAt);
  const block = !operator
    ? '담당자를 먼저 지정해 주십시오.'
    : !decisionRef.trim()
      ? '입학처 결정 문서번호가 필요합니다. 결정 없이 연장을 만들 수 없습니다.'
      : reason.trim().length < 5
        ? '연장 사유를 구체적으로 입력해 주십시오.'
        : !newDeadline
          ? '새 마감시각을 입력해 주십시오.'
          : !later
            ? '연장은 마감을 늦추는 것만 가능합니다.'
            : null;

  const submit = async () => {
    setBusy(true);
    try {
      const r = await adminPost<{ version: string }>(
        'deadline-policies/extensions',
        { cycleId, deadlineAt: newDeadline!.toISOString(), reason, decisionRef },
        actionKey('ext-create'),
      );
      setMessage({ tone: 'success', text: `연장 초안 ${r.version} 을 만들었습니다. 작성자가 아닌 두 명의 승인이 필요합니다.` });
      setDecisionRef('');
      setReason('');
      setDeadline('');
      await onCreated();
    } catch (err) {
      setMessage({ tone: 'danger', text: describe(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="마감 연장 초안 만들기">
      <p style={{ marginTop: 0, fontSize: 'var(--krds-text-sm)' }}>
        현재 마감 <strong>{kst(current.deadlineAt)}</strong> ({current.version}) 을 기준으로 연장합니다.
        판정 방식은 그대로 물려받습니다. 마감 임박 잠금에는 걸리지 않습니다.
      </p>
      {message && <Alert tone={message.tone} title={message.text} />}
      <Field
        label="입학처 결정 문서번호"
        value={decisionRef}
        onChange={setDecisionRef}
        required
        maxLength={128}
        hint="연장을 결정한 입학처 문서의 번호. 서명된 적용 기록에 영구히 남습니다."
      />
      <Field label="연장 사유" value={reason} onChange={setReason} required multiline maxLength={500} hint="예: 접수 서버 장애로 40분간 제출 불가" />
      <div style={{ margin: 'var(--krds-space-3) 0' }}>
        <label htmlFor="new-deadline" style={{ display: 'block', fontWeight: 700 }}>
          새 마감시각 <span aria-hidden="true">*</span>
        </label>
        <input
          id="new-deadline"
          type="datetime-local"
          value={deadline}
          onChange={(e) => setDeadline(e.target.value)}
          aria-describedby="new-deadline-hint"
          style={{ minHeight: 40, padding: '0 var(--krds-space-2)', fontFamily: 'inherit' }}
        />
        <p id="new-deadline-hint" style={{ margin: 'var(--krds-space-1) 0 0', fontSize: 'var(--krds-text-sm)', color: 'var(--krds-fg-muted)' }}>
          이 컴퓨터의 시간대로 입력합니다. 확인: {newDeadline ? `${kst(newDeadline.toISOString())} (한국 시간)` : '-'}
        </p>
      </div>
      <Button disabled={busy || block !== null} onClick={() => void submit()}>
        연장 초안 만들기
      </Button>
      <BlockReason reason={block} id="ext-block" />
    </Card>
  );
}

function PendingPolicy({
  policy,
  current,
  operator,
  onChanged,
}: {
  policy: Policy;
  current: Policy | null;
  operator: string | null;
  onChanged: (done?: string) => Promise<void>;
}) {
  const [message, setMessage] = useState<{ tone: 'success' | 'danger' | 'warning'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const state = { createdBy: policy.createdBy, approvedBy: policy.approvedBy };
  const stale = policy.extension && current && policy.extension.extendsVersion !== current.version;

  // 멱등키는 누를 때마다 새로 만든다. 담당자가 바뀌면 다른 요청이다.
  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      setMessage({ tone: 'success', text: done });
      await onChanged(done);
    } catch (err) {
      const conflict = err instanceof ApiError && err.problem.status === 409;
      setMessage({ tone: conflict ? 'warning' : 'danger', text: describe(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ borderTop: '1px solid var(--krds-border)', paddingTop: 'var(--krds-space-4)', marginTop: 'var(--krds-space-4)' }}>
      <h3 style={{ margin: 0 }}>
        {policy.version} {policy.extension ? '— 마감 연장' : '— 새 마감 정책'}
      </h3>
      <table style={{ borderCollapse: 'collapse', fontSize: 'var(--krds-text-sm)', margin: 'var(--krds-space-3) 0' }}>
        <tbody>
          {policy.extension && (
            <>
              <tr>
                <th scope="row" style={th}>현재 마감</th>
                <td style={td}>{kst(policy.extension.extendsDeadlineAt)} ({policy.extension.extendsVersion})</td>
              </tr>
            </>
          )}
          <tr>
            <th scope="row" style={th}>{policy.extension ? '새 마감' : '마감'}</th>
            <td style={{ ...td, fontWeight: 700 }}>{kst(policy.deadlineAt)}</td>
          </tr>
          {policy.extension && (
            <>
              <tr>
                <th scope="row" style={th}>결정 문서번호</th>
                <td style={td}>{policy.extension.decisionRef}</td>
              </tr>
              <tr>
                <th scope="row" style={th}>사유</th>
                <td style={td}>{policy.extension.reason}</td>
              </tr>
            </>
          )}
        </tbody>
      </table>
      <ApprovalProgress state={state} />
      {stale && (
        <Alert tone="warning" title="기준 정책이 바뀌었습니다">
          이 연장은 {policy.extension!.extendsVersion} 을 기준으로 만들어졌는데, 지금은 {current!.version} 이 적용 중입니다.
          적용하면 거절됩니다. 현재 마감을 기준으로 연장을 다시 작성해 주십시오.
        </Alert>
      )}
      {message && <Alert tone={message.tone} title={message.text} />}
      <div style={{ display: 'flex', gap: 'var(--krds-space-4)', flexWrap: 'wrap' }}>
        <div>
          <Button
            disabled={busy || approveBlock(state, operator) !== null}
            onClick={() => void act(() => adminPost(`deadline-policies/${policy.policyId}/approve`, {}, actionKey('pol-approve')), '승인했습니다.')}
          >
            승인
          </Button>
          <BlockReason reason={approveBlock(state, operator)} id={`ap-${policy.policyId}`} />
        </div>
        <div>
          <Button
            variant="secondary"
            disabled={busy || activateBlock(state, operator) !== null}
            onClick={() =>
              void act(
                () => adminPost(`deadline-policies/${policy.policyId}/activate`, {}, actionKey('pol-activate')),
                '적용했습니다. 지원자 화면의 마감이 바뀌고, 서명된 적용 기록이 남았습니다.',
              )
            }
          >
            지금 적용
          </Button>
          <BlockReason reason={activateBlock(state, operator)} id={`ac-${policy.policyId}`} />
        </div>
      </div>
    </div>
  );
}
