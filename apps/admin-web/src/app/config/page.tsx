'use client';

import { Alert, Button, Card, Field, TableScroll } from '@wonseoro/krds';
import { useCallback, useEffect, useState } from 'react';
import { CONFIG_VERSION_STATUS_LABEL } from '@wonseoro/contracts';
import {
  ActivationBadge,
} from '../../components/activation';
import {
  ApprovalProgress,
  BlockReason,
  activateBlock,
  approveBlock,
} from '../../components/approval';
import { ConfigOnboarding } from '../../components/config-onboarding';
import { NeedsCycle, useConsole } from '../../components/console';
import { ApiError, actionKey, admissionTypes as loadAdmissionTypes, adminGet, adminPost, describe, kst, type AdmissionType } from '../../lib/api';
import { emptyConfig, isObject } from '../../lib/config-onboarding';

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
  /** 설정 검사 경고 — 동작은 하지만 의도와 다를 수 있는 것 (§A5) */
  warnings?: string[];
}

const STATUS_LABEL: Record<Version['status'], string> = CONFIG_VERSION_STATUS_LABEL;

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
  /** 불러오는 중과 "버전 없음" 을 나눈다 (T-M5-55) */
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const r = await adminGet<{ versions: Version[] }>('config/versions', { cycleId });
      setVersions(r.versions);
      setLoaded(true);
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
        {!loaded ? (
          <p role="status" style={{ margin: 0 }}>
            불러오는 중…
          </p>
        ) : versions.length === 0 ? (
          <p style={{ margin: 0 }}>설정 버전이 없습니다.</p>
        ) : (
          <TableScroll label="설정 버전 목록">
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
          </TableScroll>
        )}
      </Card>
      {current && (
        <VersionReview key={current.id} version={current} operator={operator} onChanged={reload} />
      )}
      <DraftCreator
        cycleId={cycleId}
        operator={operator}
        onCreated={async (id) => {
          await reload();
          setSelected(id);
        }}
      />
    </>
  );
}

/**
 * 새 설정 초안 — 지금 적용 중인 설정을 복사해 고친다. (D-59)
 *
 * 전에는 콘솔에 초안을 만드는 곳이 없어 API 를 직접 불러야 했다. 초안은 효력이 없다 —
 * 작성자가 아닌 두 명이 Diff 를 확인하고 승인해야 적용된다. 서버가 양식이 컴파일되는지
 * 먼저 본다(Config Linter) — 깨진 양식은 초안조차 만들지 않는다.
 */
function DraftCreator({
  cycleId,
  operator,
  onCreated,
}: {
  cycleId: string;
  operator: string | null;
  onCreated: (id: string) => Promise<void>;
}) {
  const [text, setText] = useState('');
  const [version, setVersion] = useState('');
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [types, setTypes] = useState<AdmissionType[]>([]);
  const [builderConfig, setBuilderConfig] = useState<Record<string, unknown> | null>(null);
  const [builderKey, setBuilderKey] = useState(0);

  useEffect(() => {
    void loadAdmissionTypes(cycleId)
      .then(setTypes)
      .catch((err) => setMessage({ tone: 'danger', text: describe(err) }));
  }, [cycleId]);

  async function startFromActive() {
    try {
      const active = await adminGet<{ version: string; config: Record<string, unknown> }>('config/active', { cycleId });
      setText(JSON.stringify(active.config, null, 2));
      setVersion(`${active.version}-next`);
      setBuilderConfig(active.config);
      setBuilderKey((value) => value + 1);
      setMessage(null);
    } catch (err) {
      setMessage({ tone: 'danger', text: describe(err) });
    }
  }

  function startEmpty() {
    const config = emptyConfig(types);
    setText(JSON.stringify(config, null, 2));
    setVersion('cfg-v1');
    setBuilderConfig(config);
    setBuilderKey((value) => value + 1);
    setMessage(null);
  }

  function reloadBuilder() {
    try {
      const parsed: unknown = JSON.parse(text);
      if (!isObject(parsed)) throw new Error('object');
      setBuilderConfig(parsed);
      setBuilderKey((value) => value + 1);
      setMessage(null);
    } catch {
      setMessage({ tone: 'danger', text: '고급 편집 내용이 올바른 설정 형식이 아닙니다. 먼저 형식 오류를 고쳐 주십시오.' });
    }
  }

  async function create() {
    let config: unknown;
    try {
      config = JSON.parse(text);
    } catch (err) {
      setMessage({ tone: 'danger', text: jsonProblem(text, err as Error) });
      return;
    }
    setBusy(true);
    try {
      const row = await adminPost<{ id: string; version: string }>(
        'config/versions',
        { cycleId, version: version.trim(), config },
        actionKey('cfg-create'),
      );
      setMessage({ tone: 'success', text: `초안 ${row.version} 을 만들었습니다. 작성자가 아닌 두 명의 승인이 필요합니다.` });
      await onCreated(row.id);
    } catch (err) {
      setMessage({ tone: 'danger', text: describe(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="새 설정 초안 만들기">
      <p style={{ marginTop: 0, fontSize: 'var(--krds-text-sm)', color: 'var(--krds-fg-muted)' }}>
        초안은 효력이 없습니다. 만든 사람이 아닌 두 명이 변경 내역을 확인하고 승인해야 적용됩니다.
        전형 양식·제출 서류·서류 이름·보존기간을 고칠 수 있습니다. 지금 적용 중인 설정에서 시작해 필요한 곳만 고치십시오.
      </p>
      {message && <Alert tone={message.tone} title={message.text} focusKey={message} />}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--krds-space-2)' }}>
        <Button variant="secondary" onClick={() => void startFromActive()}>
          지금 적용 중인 설정에서 시작
        </Button>
        <Button variant="secondary" disabled={types.length === 0} onClick={startEmpty}>
          빈 설정에서 시작
        </Button>
        {text.trim() && (
          <Button variant="secondary" onClick={reloadBuilder}>
            고급 편집 내용을 구성 화면에 불러오기
          </Button>
        )}
      </div>
      {builderConfig && (
        <ConfigOnboarding
          key={builderKey}
          config={builderConfig}
          types={types}
          onApply={(config) => {
            setBuilderConfig(config);
            setText(JSON.stringify(config, null, 2));
          }}
        />
      )}
      <Field label="초안 버전 이름" value={version} onChange={setVersion} required maxLength={64} />
      <Field label="설정 내용 (고급 편집)" value={text} onChange={setText} required multiline />
      <Button
        disabled={busy || !operator || !version.trim() || !text.trim()}
        onClick={() => void create()}
      >
        {busy ? '만드는 중…' : '초안 만들기'}
      </Button>
      {!operator && <BlockReason reason="담당자를 먼저 입력해 주십시오." id="draft-reason" />}
    </Card>
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

  // "검토" 를 누르면 검토 칸이 표 아래에 열린다 — 키보드 사용자가 표의 나머지 줄을 지나지 않게 그 제목으로 간다 (T-M5-41)
  useEffect(() => {
    document.getElementById('version-review-title')?.focus();
  }, []);

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
    <Card title={`${version.version} — ${STATUS_LABEL[version.status]}`} titleId="version-review-title">
      <ApprovalProgress state={state} />
      {message && <Alert tone={message.tone} title={message.text} focusKey={message} />}

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
          {(diff.warnings?.length ?? 0) > 0 && (
            <Alert tone="warning" title={`설정 검사 경고 ${diff.warnings!.length}건 — 동작은 하지만 의도와 다를 수 있습니다`}>
              <ul style={{ margin: 0, paddingLeft: '1.2em' }}>
                {diff.warnings!.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
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
            전에 두 명의 승인을 받아 적용된 적이 있는 설정입니다. 새 승인 없이, 마감 직전에도 되돌릴 수
            있습니다. 되돌린 사유는 서명된 기록에 남습니다.
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

/**
 * 설정 내용 오류를 줄·칸으로. 엔진 영문 원문("Unexpected token } in JSON at position 120")을 보이지 않는다 (T-M5-52, U-41).
 * 엔진마다 위치를 다르게 말한다 — position N 이나 (line L column C) 를 찾고, 없으면 위치 없이 말한다.
 */
function jsonProblem(source: string, err: Error): string {
  const hint = '쉼표·따옴표·괄호가 빠지거나 남지 않았는지 확인해 주십시오.';
  const lc = /line (\d+) column (\d+)/.exec(err.message);
  const pos = /position (\d+)/.exec(err.message);
  let line: number | null = lc ? Number(lc[1]) : null;
  let col: number | null = lc ? Number(lc[2]) : null;
  if (line === null && pos) {
    const before = source.slice(0, Number(pos[1]));
    line = before.split('\n').length;
    col = before.length - before.lastIndexOf('\n');
  }
  return line !== null
    ? `설정 내용 ${line}번째 줄 ${col}번째 칸에서 형식이 깨졌습니다. ${hint}`
    : `설정 내용의 형식이 올바르지 않습니다. ${hint}`;
}

function ChangeList({ changes }: { changes: Change[] }) {
  if (changes.length === 0) return null;
  const riskLabel = { DESTRUCTIVE: '위험', WARN: '주의', INFO: '안내' } as const;
  return (
    <ul style={{ margin: 'var(--krds-space-2) 0', paddingLeft: '1.2em', lineHeight: 1.7 }}>
      {changes.map((c) => (
        <li key={`${c.kind}:${c.path}`}>
          <strong>[{riskLabel[c.risk]}]</strong> {c.summary}{' '}
          {/* 설정 경로는 요약이 이름으로 말한다. 원문은 문의·대조용으로 접어 둔다 (T-M5-51) */}
          <details style={{ display: 'inline-block', fontSize: 'var(--krds-text-sm)', color: 'var(--krds-fg-muted)' }}>
            <summary style={{ cursor: 'pointer', padding: '2px 0', whiteSpace: 'nowrap' }}>설정 위치</summary>
            <code>{c.path}</code>
          </details>
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
