'use client';

import { Alert, Button, Card } from '@wonseoro/krds';
import { useCallback, useEffect, useState } from 'react';
import { NeedsCycle } from '../../components/console';
import { adminGet, describe, kst } from '../../lib/api';

type Floor =
  | { kind: 'LEGAL'; days: number; basis: string }
  | { kind: 'INSTITUTION'; basis: string }
  | { kind: 'IMMUTABLE'; basis: string };

interface PlanItem {
  code: string;
  label: string;
  floor: Floor;
  purge: 'CONTENT' | 'OBJECT' | 'NONE';
  days: number | null;
  dueAt: string | null;
  status: 'UNSET' | 'RETAINED' | 'DUE' | 'DUE_BUT_CHAINED' | 'IMMUTABLE';
  affected: number | null;
}

interface Plan {
  cycleClosesAt: string;
  configVersion: string | null;
  configured: boolean;
  problems: Array<{ category: string; message: string }>;
  items: PlanItem[];
  generatedAt: string;
}

const STATUS_LABEL: Record<PlanItem['status'], string> = {
  UNSET: '미설정 — 파기 대상 아님',
  RETAINED: '보존 중',
  DUE: '파기 대상',
  // 감사 체인에서 빼면 체인이 끊긴다 — WORM 이관(T-M3-03) 뒤에 처리한다
  DUE_BUT_CHAINED: '기간 지남 — 감사 기록과 묶여 있어 보관 중',
  IMMUTABLE: '기간을 정할 수 없는 기록',
};

/**
 * 보존기간 — v1.1 §A15 (T-M3-10, D-38)
 *
 * **계획만 보인다. 지우지 않는다.** 파기는 되돌릴 수 없어, 지우는 절차는 WORM 이관(M5)과
 * 사람이 계획을 읽고 승인하는 절차와 함께 붙인다. 보존기간을 바꾸는 것은 설정(retention)의
 * 일이라 2인 승인을 탄다 — 이 화면에서 바꾸지 않는다.
 *
 * 전에는 API(matrix·plan)만 있고 콘솔에 화면이 없었다. (D-59)
 */
export default function RetentionPage() {
  return (
    <>
      <h1 style={{ fontSize: 'var(--krds-text-2xl)', marginTop: 0 }}>보존기간</h1>
      <NeedsCycle>{(cycle) => <RetentionPlan cycleId={cycle.id} />}</NeedsCycle>
    </>
  );
}

function RetentionPlan({ cycleId }: { cycleId: string }) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setPlan(await adminGet<Plan>('retention/plan', { cycleId }));
      setError(null);
    } catch (err) {
      setError(describe(err));
    }
  }, [cycleId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <Alert tone="danger" title={error} />;
  if (!plan) return <p role="status">불러오는 중…</p>;

  return (
    <>
      <Alert tone="info" title="파기 계획만 보여 줍니다 — 이 화면은 아무것도 지우지 않습니다">
        보존기간은 설정(retention)으로 바꾸고, 설정은 두 명의 승인을 거쳐 적용됩니다. 모집 마감{' '}
        {kst(plan.cycleClosesAt)} 기준. 적용 설정 {plan.configVersion ?? '없음'}.
      </Alert>
      {!plan.configured && (
        <Alert tone="warning" title="보존 정책이 설정되지 않았습니다">
          설정에 retention 이 없으면 어떤 데이터도 파기 대상이 되지 않습니다.
        </Alert>
      )}
      {plan.problems.length > 0 && (
        <Alert tone="danger" title={`적용 중인 보존 정책이 기준에 맞지 않습니다 (${plan.problems.length}건)`}>
          <ul style={{ margin: 0, paddingLeft: '1.2em' }}>
            {plan.problems.map((p) => (
              <li key={`${p.category}-${p.message}`}>
                [{p.category}] {p.message}
              </li>
            ))}
          </ul>
        </Alert>
      )}
      <Card title="데이터 종류별 계획">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--krds-text-sm)' }}>
          <caption style={{ textAlign: 'left', paddingBottom: 'var(--krds-space-2)', color: 'var(--krds-fg-muted)' }}>
            {kst(plan.generatedAt)} 기준
          </caption>
          <thead>
            <tr>
              {['데이터', '하한과 근거', '설정', '파기 예정', '상태', '대상'].map((h) => (
                <th key={h} scope="col" style={th}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {plan.items.map((i) => (
              <tr key={i.code}>
                <td style={td}>{i.label}</td>
                <td style={td}>
                  {i.floor.kind === 'LEGAL' ? `${i.floor.days}일 이상` : i.floor.kind === 'IMMUTABLE' ? '불변' : '대학 결정'}
                  <br />
                  <span style={{ color: 'var(--krds-fg-muted)' }}>{i.floor.basis}</span>
                </td>
                <td style={td}>{i.days === null ? '-' : `${i.days}일`}</td>
                <td style={td}>{kst(i.dueAt)}</td>
                <td style={td}>{STATUS_LABEL[i.status]}</td>
                <td style={td}>{i.affected ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Button variant="secondary" onClick={() => void load()}>
        다시 계산
      </Button>
    </>
  );
}

const th = {
  textAlign: 'left',
  padding: 'var(--krds-space-2)',
  borderBottom: '2px solid var(--krds-border)',
} as const;
const td = { padding: 'var(--krds-space-2)', borderBottom: '1px solid var(--krds-border)', verticalAlign: 'top' } as const;
