'use client';

import { Alert, Button, Card, Field } from '@wonseoro/krds';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivationBadge,
} from '../../components/activation';
import {
  ApprovalProgress,
  BlockReason,
  activateBlock,
  approveBlock,
} from '../../components/approval';
import { NeedsCycle, useConsole } from '../../components/console';
import { ApiError, actionKey, adminGet, adminPost, describe, kst } from '../../lib/api';

interface Version {
  id: string;
  version: string;
  status: 'DRAFT' | 'APPROVED' | 'ACTIVE' | 'RETIRED';
  createdBy: string;
  approvedBy: string[];
  activatedAt: string | null;
  createdAt: string;
}

interface Change {
  path: string;
  kind: 'ADDED' | 'REMOVED' | 'CHANGED';
  risk: 'INFO' | 'WARN' | 'DESTRUCTIVE';
  summary: string;
}

interface Diff {
  changes: Change[];
  destructive: Change[];
  digest: string;
  identical: boolean;
}

const STATUS_LABEL: Record<Version['status'], string> = {
  DRAFT: '승인 대기',
  APPROVED: '승인 완료 · 적용 전',
  ACTIVE: '적용 중',
  RETIRED: '물러남',
};

/**
 * 설정 승인 — T-M3-11, v1.1 §A14
 *
 * 이 화면이 §01 E "단독 운영자 1명으로 마감시간 변경 불가" 를 화면에서 보여준다.
 *
 * **읽히지 않는 Diff 는 없는 Diff 와 같다.** 빈 설정을 절차대로 승인해 모든 전형의
 * 양식이 사라진 적이 있다. 그래서
 *   - 파괴적 변경을 맨 위에, 색이 아니라 글로 따로 묶어 보인다
 *   - "확인했습니다" 를 체크해야 승인 버튼이 열린다. 체크는 지금 본 변경의 digest 에 묶인다
 *   - 본 뒤에 변경이 바뀌면 서버가 409 로 거절하고, 화면은 Diff 를 다시 불러온다
 */
export default function ConfigPage() {
  return (
    <>
      <h1 style={{ fontSize: 'var(--krds-text-2xl)', marginTop: 0 }}>설정 승인</h1>
      <NeedsCycle>{(cycle) => <ConfigConsole cycleId={cycle.id} />}</NeedsCycle>
    </>
  );
}

function ConfigConsole({ cycleId }: { cycleId: string }) {
  const { operator } = useConsole();
  const [versions, setVersions] = useState<Version[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const r = await adminGet<{ versions: Version[] }>('config/versions', { cycleId });
      setVersions(r.versions);
      setError(null);
    } catch (err) {
      setError(describe(err));
    }
  }, [cycleId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const current = versions.find((v) => v.id === selected) ?? null;

  return (
    <>
      {error && <Alert tone="danger" title={error} />}
      <Card title="설정 버전">
        {versions.length === 0 ? (
          <p style={{ margin: 0 }}>설정 버전이 없습니다.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--krds-text-sm)' }}>
            <caption style={{ textAlign: 'left', paddingBottom: 'var(--krds-space-2)', color: 'var(--krds-fg-muted)' }}>
              최근 50개. 승인 대기부터 확인하십시오.
            </caption>
            <thead>
              <tr>
                {['버전', '상태', '작성', '승인', '적용 시각', ''].map((h) => (
                  <th key={h} scope="col" style={th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => (
                <tr key={v.id} aria-current={v.id === selected ? 'true' : undefined} style={v.id === selected ? { background: 'var(--krds-primary-weak)' } : undefined}>
                  <td style={td}>{v.version}</td>
                  <td style={td}>{STATUS_LABEL[v.status]}</td>
                  <td style={td}>{v.createdBy}</td>
                  <td style={td}>{v.approvedBy.length}/2</td>
                  <td style={td}>{kst(v.activatedAt)}</td>
                  <td style={td}>
                    <Button variant="secondary" onClick={() => setSelected(v.id)}>
                      {v.status === 'DRAFT' || v.status === 'APPROVED' ? '검토' : '보기'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {current && (
        <VersionReview key={current.id} version={current} operator={operator} onChanged={reload} />
      )}
    </>
  );
}

function VersionReview({
  version,
  operator,
  onChanged,
}: {
  version: Version;
  operator: string | null;
  onChanged: () => Promise<void>;
}) {
  const [diff, setDiff] = useState<Diff | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger' | 'warning'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');

  const loadDiff = useCallback(async () => {
    setAcknowledged(false);
    try {
      setDiff(await adminGet<Diff>(`config/versions/${version.id}/diff`));
    } catch (err) {
      setMessage({ tone: 'danger', text: describe(err) });
    }
  }, [version.id]);

  useEffect(() => {
    void loadDiff();
  }, [loadDiff]);

  // "확인했습니다" 는 사람마다 해야 한다. 담당자가 바뀌면 앞사람의 체크를 물려받지 않는다.
  useEffect(() => {
    setAcknowledged(false);
  }, [operator]);

  /**
   * 멱등키는 **누를 때마다** 새로 만든다. 화면을 열 때 한 번 만들어 두면, 담당자를 바꿔
   * 같은 버전을 두 번째로 승인할 때 같은 키가 재사용되어 첫 승인의 응답이 그대로 재생된다 —
   * 두 번째 승인이 기록되지 않는다. 중복 클릭은 busy 로 막는다.
   */
  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      setAcknowledged(false);
      setMessage({ tone: 'success', text: done });
      await onChanged();
    } catch (err) {
      if (err instanceof ApiError && err.problem.status === 409) {
        // 본 뒤에 변경이 바뀌었다. 실패가 아니라 다시 보라는 뜻이다.
        setMessage({ tone: 'warning', text: `${describe(err)} 변경 내역을 다시 불러왔습니다.` });
        await loadDiff();
      } else {
        setMessage({ tone: 'danger', text: describe(err) });
      }
    } finally {
      setBusy(false);
    }
  };

  const state = { createdBy: version.createdBy, approvedBy: version.approvedBy };
  const pending = version.status === 'DRAFT' || version.status === 'APPROVED';
  // 사람에 걸린 이유(작성자·이미 승인)를 먼저 보인다. 체크 안내가 먼저 나오면
  // 이미 승인한 사람이 "다시 체크하면 되겠구나" 로 읽는다.
  const approveReason = !pending
    ? '승인 단계가 아닙니다.'
    : (approveBlock(state, operator) ??
      (diff?.identical
        ? '현재 설정과 같습니다. 바뀌는 내용이 없는 설정은 승인하지 않습니다.'
        : !acknowledged
          ? '위 변경 내역을 확인했다고 체크해야 승인할 수 있습니다.'
          : null));
  const activateReason = version.status !== 'APPROVED' && version.status !== 'DRAFT'
    ? '적용 단계가 아닙니다.'
    : activateBlock(state, operator);
  const canRollback = version.status === 'RETIRED' && version.activatedAt !== null;

  return (
    <Card title={`${version.version} — ${STATUS_LABEL[version.status]}`}>
      <ApprovalProgress state={state} />
      {message && <Alert tone={message.tone} title={message.text} />}

      <h3 style={{ marginBottom: 'var(--krds-space-2)' }}>무엇이 바뀌는가 (현재 적용 중인 설정 대비)</h3>
      {!diff ? (
        <p>불러오는 중…</p>
      ) : diff.identical ? (
        <Alert tone="warning" title="현재 설정과 같습니다">바뀌는 내용이 없습니다. 대개 잘못 만든 초안입니다.</Alert>
      ) : (
        <>
          {diff.destructive.length > 0 && (
            <Alert tone="danger" title={`되돌리기 어려운 변경 ${diff.destructive.length}건`}>
              <ChangeList changes={diff.destructive} />
            </Alert>
          )}
          <ChangeList changes={diff.changes.filter((c) => c.risk !== 'DESTRUCTIVE')} />
          {pending && (
            <label style={{ display: 'flex', gap: 'var(--krds-space-2)', alignItems: 'flex-start', margin: 'var(--krds-space-4) 0' }}>
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                style={{ width: 20, height: 20, marginTop: 2 }}
              />
              <span>
                위 변경 <strong>{diff.changes.length}건</strong>
                {diff.destructive.length > 0 && (
                  <>
                    {' '}(되돌리기 어려운 변경 <strong>{diff.destructive.length}건</strong> 포함)
                  </>
                )}
                을 확인했습니다. <span style={{ color: 'var(--krds-fg-muted)' }}>확인 번호 {diff.digest.slice(0, 8)}</span>
              </span>
            </label>
          )}
        </>
      )}

      {pending && (
        <div style={{ display: 'flex', gap: 'var(--krds-space-4)', flexWrap: 'wrap' }}>
          <div>
            <Button
              disabled={busy || approveReason !== null}
              onClick={() =>
                void act(
                  () => adminPost(`config/versions/${version.id}/approve`, { acknowledgedDiffDigest: diff?.digest }, actionKey('cfg-approve')),
                  '승인했습니다.',
                )
              }
            >
              승인
            </Button>
            <BlockReason reason={approveReason} id="approve-reason" />
          </div>
          <div>
            <Button
              variant="secondary"
              disabled={busy || activateReason !== null}
              onClick={() =>
                void act(() => adminPost(`config/versions/${version.id}/activate`, {}, actionKey('cfg-activate')), '적용했습니다. 서명된 적용 기록이 남았습니다.')
              }
            >
              지금 적용
            </Button>
            <BlockReason reason={activateReason} id="activate-reason" />
          </div>
        </div>
      )}

      {canRollback && (
        <div style={{ marginTop: 'var(--krds-space-5)' }}>
          <h3>이 설정으로 되돌리기</h3>
          <p style={{ fontSize: 'var(--krds-text-sm)', color: 'var(--krds-fg-muted)' }}>
            전에 두 명의 승인을 받아 적용된 적이 있는 설정입니다. 새 승인 없이 되돌릴 수 있지만
            사유가 서명된 기록에 남습니다. 마감 임박 잠금에도 걸리지 않습니다 — 복구는 막지 않습니다.
          </p>
          <Field label="되돌리는 사유" value={reason} onChange={setReason} required multiline maxLength={500} />
          <Button
            variant="danger"
            disabled={busy || !operator || reason.trim().length < 2}
            onClick={() =>
              void act(
                () => adminPost(`config/versions/${version.id}/rollback`, { reason }, actionKey('cfg-rollback')),
                '되돌렸습니다. 사유와 함께 서명된 기록이 남았습니다.',
              )
            }
          >
            되돌리기
          </Button>
        </div>
      )}
      {version.status === 'ACTIVE' && <ActivationBadge text="적용 중인 설정입니다." />}
    </Card>
  );
}

function ChangeList({ changes }: { changes: Change[] }) {
  if (changes.length === 0) return null;
  const riskLabel = { DESTRUCTIVE: '위험', WARN: '주의', INFO: '안내' } as const;
  return (
    <ul style={{ margin: 'var(--krds-space-2) 0', paddingLeft: '1.2em', lineHeight: 1.7 }}>
      {changes.map((c) => (
        <li key={`${c.kind}:${c.path}`}>
          <strong>[{riskLabel[c.risk]}]</strong> {c.summary}{' '}
          <code style={{ fontSize: 'var(--krds-text-sm)', color: 'var(--krds-fg-muted)' }}>{c.path}</code>
        </li>
      ))}
    </ul>
  );
}

const th = {
  textAlign: 'left',
  padding: 'var(--krds-space-2)',
  borderBottom: '2px solid var(--krds-border)',
} as const;
const td = { padding: 'var(--krds-space-2)', borderBottom: '1px solid var(--krds-border)' } as const;
