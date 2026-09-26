'use client';

import { Alert, Button } from '@wonseoro/krds';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import {
  clearOperator,
  currentCycle,
  describe,
  getOperator,
  kst,
  setOperator,
  type Cycle,
} from '../lib/api';

interface ConsoleState {
  operator: string | null;
  cycle: Cycle | null;
}

const ConsoleContext = createContext<ConsoleState>({ operator: null, cycle: null });

/** 지금 담당자와 모집. 화면마다 따로 묻지 않는다. */
export function useConsole(): ConsoleState {
  return useContext(ConsoleContext);
}

/**
 * 담당자 · 모집 틀.
 *
 * **담당자 입력은 개발 전용이다.** 여기 적은 이름이 그대로 승인·적용 기록에 남는다.
 * 증명된 신원이 아니라는 것을 화면에서 숨기지 않는다 — 숨기면 이 기록을 신원 증명으로
 * 믿게 된다. 관리자 SSO(T-M5-10)가 이 자리를 대신한다.
 */
export function ConsoleProvider({ children }: { children: ReactNode }) {
  const [operator, setOp] = useState<string | null>(null);
  const [cycle, setCycle] = useState<Cycle | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        setOp(await getOperator());
      } catch (err) {
        setError(describe(err));
      }
      try {
        setCycle(await currentCycle());
      } catch (err) {
        setError(`진행 중인 모집을 불러오지 못했습니다. ${describe(err)}`);
      }
      setReady(true);
    })();
  }, []);

  const signIn = useCallback(async () => {
    try {
      setOp(await setOperator(draft));
      setError(null);
    } catch (err) {
      setError(describe(err));
    }
  }, [draft]);

  const signOut = useCallback(async () => {
    await clearOperator();
    setOp(null);
  }, []);

  return (
    <ConsoleContext.Provider value={{ operator, cycle }}>
      <section
        aria-label="담당자와 모집"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 'var(--krds-space-3)',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: 'var(--krds-space-3) var(--krds-space-4)',
          background: 'var(--krds-bg-muted)',
          borderRadius: 'var(--krds-radius)',
          marginBottom: 'var(--krds-space-4)',
          fontSize: 'var(--krds-text-sm)',
        }}
      >
        <div>
          <strong>모집</strong>{' '}
          {cycle ? `${cycle.name} (마감 ${kst(cycle.closesAt)})` : ready ? '없음' : '불러오는 중…'}
        </div>
        {operator ? (
          <div style={{ display: 'flex', gap: 'var(--krds-space-2)', alignItems: 'center' }}>
            <span>
              <strong>담당자</strong> {operator}{' '}
              <span style={{ color: 'var(--krds-fg-muted)' }}>(개발용 — 신원 증명 아님)</span>
            </span>
            <Button variant="secondary" onClick={() => void signOut()}>
              담당자 바꾸기
            </Button>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void signIn();
            }}
            style={{ display: 'flex', gap: 'var(--krds-space-2)', alignItems: 'center' }}
          >
            <label htmlFor="operator-id">
              <strong>담당자 ID</strong>
            </label>
            <input
              id="operator-id"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="예: officer2@univ-a"
              autoComplete="username"
              style={{ minHeight: 36, padding: '0 var(--krds-space-2)', fontFamily: 'inherit' }}
            />
            <Button type="submit">지정</Button>
          </form>
        )}
      </section>
      {error && <Alert tone="danger" title={error} />}
      {ready && !operator && (
        <Alert tone="info" title="담당자를 지정해야 승인·적용할 수 있습니다">
          조회는 담당자 없이도 됩니다. 승인·적용·해소는 누가 했는지 기록에 남아야 하므로
          담당자가 필요합니다.
        </Alert>
      )}
      {children}
    </ConsoleContext.Provider>
  );
}

/** 조회 화면 공통 — 모집이 없으면 아무것도 그리지 않는다. */
export function NeedsCycle({ children }: { children: (cycle: Cycle) => ReactNode }) {
  const { cycle } = useConsole();
  if (!cycle) return null;
  return <>{children(cycle)}</>;
}
