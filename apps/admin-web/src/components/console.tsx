'use client';

import { labelOf, STAFF_ROLE_LABEL } from '@wonseoro/contracts';
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
  AUTH_REQUIRED_EVENT,
  clearOperator,
  currentCycle,
  describe,
  getSession,
  kst,
  loginUrl,
  logout,
  setOperator,
  type AuthNeed,
  type ConsoleSession,
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

const NO_SESSION: ConsoleSession = { mode: 'dev', operator: null, name: null, roles: [], devOperator: false, unavailable: null };

/**
 * 담당자 · 모집 틀.
 *
 * 관리자 로그인(T-M5-10) — 로그인한 담당자의 이름·역할과 로그아웃. 로그인은 발급자 화면에서 비밀번호와 일회용 번호를
 * 차례로 받는다. 운영 API 가 "로그인이 끝났다"·"방금 한 본인 확인이 필요하다"(재인증) 로 답하면 여기서 안내하고
 * 다시 로그인으로 보낸다 — 안내로 포커스를 옮긴다(누른 버튼 자리에서 결과를 놓치지 않게).
 *
 * 개발 서버 — **담당자 입력은 개발 서버에서만 그린다(T-M5-53).** 여기 적은 이름이 그대로 승인·적용 기록에 남는다.
 * 증명된 신원이 아니라는 것을 화면에서 숨기지 않는다 — 숨기면 이 기록을 신원 증명으로 믿게 된다.
 */
export function ConsoleProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<ConsoleSession>(NO_SESSION);
  const [cycle, setCycle] = useState<Cycle | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [loginFailed, setLoginFailed] = useState<string | null>(null);
  const [authNeed, setAuthNeed] = useState<{ need: AuthNeed; seq: number } | null>(null);
  const operator = session.operator;
  const oidc = session.mode === 'oidc';

  useEffect(() => {
    void (async () => {
      try {
        setSession(await getSession());
      } catch (err) {
        setError(describe(err));
      }
      try {
        setCycle(await currentCycle());
      } catch (err) {
        setError(`진행 중인 모집을 불러오지 못했습니다. ${describe(err)}`);
      }
      // 로그인 콜백이 실패를 알리고 돌려보낸 경우(?login=failed) — 한 번 알리고 주소에서 지운다
      const params = new URLSearchParams(window.location.search);
      const failed = params.get('login');
      if (failed) {
        setLoginFailed(
          failed === 'unavailable'
            ? '로그인 서버에 연결할 수 없어 로그인을 마치지 못했습니다. 잠시 후 다시 로그인해 주십시오.'
            : '로그인을 마치지 못했습니다. 다시 로그인해 주십시오.',
        );
        params.delete('login');
        const rest = params.toString();
        window.history.replaceState(null, '', `${window.location.pathname}${rest ? `?${rest}` : ''}`);
      }
      setReady(true);
    })();
  }, []);

  // 운영 API 가 401 로 답하면 다시 로그인 안내. 로그인하지 않은 상태의 조회 실패는 이미 로그인 안내가 있어 다시 띄우지 않는다
  useEffect(() => {
    // 화면 본문도 같은 실패를 자기 결과 안내로 띄우고 포커스를 옮긴다. 다시 로그인 버튼은 이 안내에 있으므로
    // 본문 안내가 그려진 **뒤에** 이 안내를 띄워 포커스가 마지막에 여기로 오게 한다 — 스크린리더가 버튼까지 바로 듣는다
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onNeed = (e: Event) => {
      const need = (e as CustomEvent<AuthNeed>).detail;
      clearTimeout(timer);
      timer = setTimeout(() => setAuthNeed((prev) => ({ need, seq: (prev?.seq ?? 0) + 1 })), 150);
    };
    window.addEventListener(AUTH_REQUIRED_EVENT, onNeed);
    return () => {
      clearTimeout(timer);
      window.removeEventListener(AUTH_REQUIRED_EVENT, onNeed);
    };
  }, []);
  const showAuthNeed = authNeed && (authNeed.need === 'stepUp' || operator);

  // 지정·바꾸기를 누르면 입력칸과 버튼이 서로 바뀐다 — 사라진 자리 대신 바뀐 자리로 포커스를 옮긴다 (T-M5-41)
  const [focusId, setFocusId] = useState<string | null>(null);
  useEffect(() => {
    if (focusId) document.getElementById(focusId)?.focus();
  }, [focusId, operator]);

  const signIn = useCallback(async () => {
    try {
      const name = await setOperator(draft);
      setSession((s) => ({ ...s, operator: name }));
      setError(null);
      setFocusId('operator-change');
    } catch (err) {
      setError(describe(err));
    }
  }, [draft]);

  const signOut = useCallback(async () => {
    await clearOperator();
    setSession((s) => ({ ...s, operator: null }));
    setFocusId('operator-id');
  }, []);

  const signOutOidc = useCallback(async () => {
    try {
      await logout();
    } catch (err) {
      setError(describe(err));
    }
  }, []);

  const roles = session.roles.map((r) => labelOf(STAFF_ROLE_LABEL, r)).join(', ');

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
        {oidc ? (
          operator ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--krds-space-2)', alignItems: 'center' }}>
              <span>
                <strong>담당자</strong> {session.name ? `${session.name} (${operator})` : operator}
                {roles && <span style={{ color: 'var(--krds-fg-muted)' }}> · {roles}</span>}
              </span>
              <Button id="console-logout" variant="secondary" onClick={() => void signOutOidc()}>
                로그아웃
              </Button>
            </div>
          ) : (
            ready &&
            !session.unavailable && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--krds-space-2)', alignItems: 'center' }}>
                <Button id="console-login" onClick={() => window.location.assign(loginUrl())}>
                  관리자 로그인
                </Button>
              </div>
            )
          )
        ) : operator ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--krds-space-2)', alignItems: 'center' }}>
            <span>
              <strong>담당자</strong> {operator}{' '}
              <span style={{ color: 'var(--krds-fg-muted)' }}>(개발용 — 신원 증명 아님)</span>
            </span>
            <Button id="operator-change" variant="secondary" onClick={() => void signOut()}>
              담당자 바꾸기
            </Button>
          </div>
        ) : !session.devOperator ? (
          ready && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--krds-space-2)', alignItems: 'center' }}>
              <Button disabled>관리자 로그인</Button>
            </div>
          )
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void signIn();
            }}
            style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--krds-space-2)', alignItems: 'center' }}
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
      {session.unavailable && <Alert tone="danger" title={session.unavailable} />}
      {loginFailed && <Alert tone="danger" title={loginFailed} />}
      {showAuthNeed && (
        <Alert
          tone="warning"
          focusKey={authNeed.seq}
          title={authNeed.need === 'stepUp' ? '본인 확인을 한 번 더 해 주십시오' : '로그인이 끝났습니다'}
        >
          <p style={{ margin: '0 0 var(--krds-space-3)' }}>
            {authNeed.need === 'stepUp'
              ? '승인·적용·되돌리기·연장·해소·증적 열람은 방금(5분 안에) 본인 확인을 한 담당자만 할 수 있습니다. 다시 로그인한 뒤 같은 버튼을 다시 눌러 주십시오. 처리된 것은 없습니다.'
              : '다시 로그인한 뒤 이어서 진행해 주십시오. 처리된 것은 없습니다.'}
          </p>
          <Button id="console-relogin" onClick={() => window.location.assign(loginUrl(authNeed.need === 'stepUp'))}>
            {authNeed.need === 'stepUp' ? '본인 확인 다시 하기' : '다시 로그인'}
          </Button>
        </Alert>
      )}
      {ready && oidc && !operator && !session.unavailable && (
        <Alert tone="info" title="관리자 로그인이 필요합니다">
          조회·승인·적용·해소는 로그인한 담당자만 할 수 있습니다. 로그인하면 비밀번호와 인증 앱의 일회용 번호를 차례로
          묻습니다.
        </Alert>
      )}
      {ready && !oidc && !operator && session.devOperator && (
        <Alert tone="info" title="담당자를 지정해야 승인·적용할 수 있습니다">
          조회는 담당자 없이도 됩니다. 승인·적용·해소는 누가 했는지 기록에 남아야 하므로
          담당자가 필요합니다.
        </Alert>
      )}
      {ready && !oidc && !operator && !session.devOperator && (
        <Alert tone="info" title="관리자 로그인이 필요합니다">
          승인·적용·해소는 누가 했는지 기록에 남아야 하므로 로그인한 담당자만 할 수 있습니다. 관리자 로그인이
          구성되지 않았습니다.
        </Alert>
      )}
      {/* 관리자 로그인 모드에서 로그인 전에는 화면 본문을 그리지 않는다 — 조회도 로그인한 담당자만 한다. 본문이 먼저
          불러오다 실패 안내를 겹쳐 띄우지 않게, 담당자를 확인한 뒤에 그린다 */}
      {ready && oidc && !operator && <h1 style={{ fontSize: 'var(--krds-text-2xl)', marginTop: 0 }}>관리자 로그인</h1>}
      {ready && !(oidc && !operator) && children}
    </ConsoleContext.Provider>
  );
}

/** 조회 화면 공통 — 모집이 없으면 아무것도 그리지 않는다. */
export function NeedsCycle({ children }: { children: (cycle: Cycle) => ReactNode }) {
  const { cycle } = useConsole();
  if (!cycle) return null;
  return <>{children(cycle)}</>;
}
