'use client';

import type { OperatingModeView } from '../lib/api';
import type { SaveState } from '../lib/use-autosave';
import type { DeadlineView } from '../lib/use-deadline';
import { formatKst, formatKstTime, formatRemaining } from '../lib/use-deadline';
import { Alert, Button, Icon, LiveRegion, formatTime } from '@wonseoro/krds';
import { useEffect, useRef, useState } from 'react';
import { currentRequestId } from '../lib/api';

/**
 * 자동저장 상태 표시 — 기술설계서 v1.1 §07
 *
 * **항상 텍스트로 보인다.** Toast 로 잠깐 띄우고 사라지면 안 된다.
 * 사용자가 "지금 저장됐나?"를 불안해하는 것이 마감 직전 불안의 큰 부분이다.
 */
export function SaveStatus({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  // 알림 영역 둘을 늘 그려 두고 안의 글만 바꾼다 — 저장 중·완료는 차례를 기다려(polite), 실패는 바로(assertive)
  // 읽는다. 상태마다 영역을 새로 그리면 스크린리더가 바뀐 것을 놓친다 (T-M5-42)
  const failed = state.kind === 'failed';
  return (
    <>
      <LiveRegion>{!failed && <SaveStatusText state={state} />}</LiveRegion>
      <LiveRegion assertive>{failed && <SaveStatusText state={state} onRetry={onRetry} />}</LiveRegion>
    </>
  );
}

function SaveStatusText({ state, onRetry }: { state: SaveState; onRetry?: () => void }) {
  const base = {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--krds-space-2)',
    padding: 'var(--krds-space-2) var(--krds-space-3)',
    borderRadius: 'var(--krds-radius)',
    fontSize: 'var(--krds-text-sm)',
    minHeight: 36,
  } as const;

  if (state.kind === 'failed') {
    return (
      <div
        style={{
          ...base,
          background: 'var(--krds-danger-weak)',
          color: 'var(--krds-danger)',
          fontWeight: 700,
          flexWrap: 'wrap',
        }}
      >
        <Icon name="cross" />
        <span>저장 실패 — {state.reason}</span>
        {state.retryable && onRetry && (
          <button
            type="button"
            onClick={onRetry}
            style={{
              minHeight: 32,
              padding: '0 var(--krds-space-3)',
              background: 'var(--krds-danger)',
              color: '#fff',
              border: 'none',
              borderRadius: 'var(--krds-radius)',
              fontFamily: 'inherit',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            다시 시도
          </button>
        )}
      </div>
    );
  }

  if (state.kind === 'saving') {
    return (
      <div style={{ ...base, background: 'var(--krds-bg-muted)' }}>
        <Icon name="sync" /> 저장 중…
      </div>
    );
  }

  if (state.kind === 'saved') {
    return (
      <div style={{ ...base, background: 'var(--krds-success-weak)', color: 'var(--krds-success)' }}>
        <Icon name="check" /> 저장 완료 {formatKstTime(state.at)}
      </div>
    );
  }

  return <div style={{ ...base, color: 'var(--krds-fg-muted)' }}>자동으로 저장됩니다</div>;
}

/* ────────────────────────────────────────────────────────────────────── */

/**
 * 마감 카운트다운.
 * 서버 시각 기준이며, 서버와 통신이 끊기면 남은 시간을 **단정하지 않는다.**
 */
export function DeadlineBanner({ deadline }: { deadline: DeadlineView }) {
  // 남은 시간은 매초 바뀐다 — 배너 전체를 알림 영역으로 두면 스크린리더가 매초 끼어들어 읽는다(10분 전부터는
  // assertive 라 입력도 끊긴다). 배너는 보이기만 하고, 알림은 경고 단계(30·10·5·1분 전)가 바뀔 때만 한다 (T-M5-42)
  const urgent = deadline.warningMinutes !== null && deadline.warningMinutes <= 10;
  const warning =
    !deadline.stale && !deadline.passed && deadline.warningMinutes !== null
      ? `마감 ${deadline.warningMinutes}분 전입니다. 작성 중인 내용을 먼저 저장해 주십시오.`
      : '';
  return (
    <>
      <DeadlineBannerView deadline={deadline} urgent={urgent} />
      <p className="krds-sr-only" role={urgent ? 'alert' : 'status'} aria-live={urgent ? 'assertive' : 'polite'}>
        {warning}
      </p>
    </>
  );
}

function DeadlineBannerView({ deadline, urgent }: { deadline: DeadlineView; urgent: boolean }) {
  if (deadline.stale) {
    return (
      <div
        style={{
          padding: 'var(--krds-space-3)',
          background: 'var(--krds-bg-muted)',
          borderRadius: 'var(--krds-radius)',
          fontSize: 'var(--krds-text-sm)',
          color: 'var(--krds-fg-muted)',
        }}
      >
        <Icon name="sync" />
        서버 시각을 확인하는 중입니다. 남은 시간은 서버 기준으로 표시됩니다.
      </div>
    );
  }

  if (deadline.passed) {
    return (
      <Alert tone="danger" title="접수가 마감되었습니다">
        서버 시각 기준으로 마감되었습니다. 이미 접수를 완료하셨다면 접수 내역에서 확인하실 수
        있습니다.
      </Alert>
    );
  }

  // 10분 이하부터 경고 톤을 올린다. 색만이 아니라 문구도 바뀐다.
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 'var(--krds-space-3)',
        padding: 'var(--krds-space-3) var(--krds-space-4)',
        background: urgent ? 'var(--krds-danger-weak)' : 'var(--krds-primary-weak)',
        border: `1px solid ${urgent ? 'var(--krds-danger)' : 'var(--krds-primary)'}`,
        borderRadius: 'var(--krds-radius)',
        fontSize: 'var(--krds-text-sm)',
      }}
    >
      <strong style={{ color: urgent ? 'var(--krds-danger)' : 'var(--krds-primary-strong)' }}>
        <Icon name={urgent ? 'warning' : 'clock'} />
        {formatRemaining(deadline.remainingMs)}
      </strong>
      <span style={{ color: 'var(--krds-fg-muted)' }}>
        마감 {formatKst(deadline.deadlineAt)} (서버 시각 기준)
      </span>
      {deadline.warningMinutes !== null && (
        // 같은 문장을 위 알림 영역이 읽는다 — 훑어 읽기에서 두 번 듣지 않게 숨긴다
        <span aria-hidden="true" style={{ fontWeight: 700 }}>
          {deadline.warningMinutes}분 전입니다. 작성 중인 내용을 먼저 저장해 주십시오.
        </span>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────── */

/**
 * 자율 운영 배너 — 기술설계서 v1.1 §A1 · §07
 *
 * 중앙이 끊겨도 **접수는 막히지 않는다.** 막히는 것은 "내 원서" 통합 조회 반영뿐이다.
 * 그런데 지원자는 통합 조회에 접수가 안 보이면 접수가 안 된 줄 알고
 * 다시 결제하거나 처음부터 다시 한다. 그걸 막으려고 먼저 말한다.
 *
 * 그래서 문구의 순서가 정해져 있다.
 *   1. 무엇이 정상인지 (작성·저장·결제·최종제출)
 *   2. 접수 완료를 무엇으로 확인하는지 (접수번호)
 *   3. 무엇이 늦는지 (통합 조회)
 * 경고 톤이 아니라 안내 톤이다. 지원자가 잘못한 것도, 할 일이 있는 것도 아니다.
 */
export function OperatingModeBanner({ view }: { view: OperatingModeView | null }) {
  // 작성 중에 중앙이 끊기면 배너가 나타난다 — 늘 있는 알림 영역 안에 그려야 스크린리더가 알린다 (T-M5-42)
  return <LiveRegion>{view && <OperatingModeAlert view={view} />}</LiveRegion>;
}

function OperatingModeAlert({ view }: { view: OperatingModeView }) {
  const autonomous = view.mode === 'AUTONOMOUS';
  if (!autonomous && !view.sync.lagging) return null;

  // 연결된 적이 있다가 끊긴 경우에만 시각을 보인다. 한 번도 연결된 적이 없으면
  // `since` 는 서버가 뜬 시각일 뿐이라, "그때부터 끊겼다" 고 말하면 사실이 아니다.
  const since =
    autonomous && view.reason === 'CENTRAL_UNREACHABLE' && view.lastCentralContactAt
      ? formatTime(view.since, { seconds: false })
      : null;

  return (
    <Alert
      tone="info"
      title={
        autonomous
          ? '통합 조회 서비스와 연결이 원활하지 않습니다'
          : '통합 조회 반영이 지연되고 있습니다'
      }
    >
      <p style={{ margin: 0 }}>
        원서 작성·저장·서류·결제·최종제출은 <strong>이 대학 서버에서 정상 처리</strong>됩니다.
        최종제출 후 <strong>접수번호가 표시되면 접수가 완료</strong>된 것입니다.
      </p>
      <p style={{ margin: 'var(--krds-space-2) 0 0' }}>
        &lsquo;내 원서&rsquo; 통합 조회에는 늦게 나타날 수 있습니다. 다시 결제하거나 처음부터
        다시 작성하지 마십시오.
        {since && <> ({since}부터)</>}
      </p>
    </Alert>
  );
}

/* ────────────────────────────────────────────────────────────────────── */

/**
 * 장애 UX — 기술설계서 v1.1 §07
 *
 * **여기가 경쟁 서비스와 갈리는 지점이다.**
 *
 * 규칙
 *   - 처음부터 다시 하라고 요구하지 않는다
 *   - 마지막 저장 시각과 "서버가 확인한 상태"를 보여준다
 *   - 요청번호와 상태 재조회 버튼을 준다 (중복 제출 반복 방지)
 *   - 재결제를 유도하지 않는다
 */
export function FailureNotice({
  title,
  detail,
  traceId,
  lastSavedAt,
  savedHere,
  serverState,
  onRecheck,
}: {
  title: string;
  detail?: string;
  traceId?: string;
  /** 서버가 알려 준 마지막 저장 시각 */
  lastSavedAt?: string | null;
  /** 서버에 닿지 못했을 때 — 이 기기에서 마지막으로 저장에 성공한 시각 */
  savedHere?: string | null;
  /** 서버가 확인한 현재 상태(Self-check 요약). 서버에 닿지 못하면 없다 */
  serverState?: string | null;
  onRecheck: () => void;
}) {
  // 장애 안내는 화면 전체를 바꾼다 — 누른 버튼이 사라져 포커스가 문서 처음으로 떨어진다. 안내 제목으로 옮긴다 (T-M5-40)
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  // 약속한 넷(마지막 저장·서버가 확인한 상태·요청번호·재조회)을 비워 두지 않는다 — 모르면 모른다고 쓴다 (U-8)
  const saved = lastSavedAt
    ? formatKst(lastSavedAt)
    : savedHere
      ? `${formatKst(savedHere)} (이 기기에 남은 기록)`
      : '확인할 수 없습니다';
  const rows: Array<[string, string, boolean?]> = [
    ['마지막 저장', saved],
    ['서버가 확인한 상태', serverState ?? '지금은 확인할 수 없습니다. 연결되면 "현재 상태 다시 확인" 을 눌러 주십시오.'],
    ['요청번호', traceId || '-', true],
  ];
  return (
    <div
      role="alert"
      style={{
        padding: 'var(--krds-space-5)',
        background: 'var(--krds-bg)',
        border: '2px solid var(--krds-danger)',
        borderRadius: 'var(--krds-radius-lg)',
        marginBottom: 'var(--krds-space-5)',
      }}
    >
      <h2 ref={headingRef} tabIndex={-1} style={{ margin: '0 0 var(--krds-space-3)', color: 'var(--krds-danger)' }}>
        <Icon name="warning" />
        {title}
      </h2>

      <p style={{ margin: '0 0 var(--krds-space-3)' }}>
        <strong>작성하신 내용은 보관되어 있습니다.</strong> 처음부터 다시 작성하지 않으셔도
        됩니다.
      </p>

      {detail && <p style={{ margin: '0 0 var(--krds-space-3)' }}>{detail}</p>}

      <dl style={{ margin: '0 0 var(--krds-space-4)', fontSize: 'var(--krds-text-sm)', display: 'grid', gap: 'var(--krds-space-2)' }}>
        {rows.map(([k, v, mono]) => (
          <div key={k} style={{ display: 'flex', gap: 'var(--krds-space-3)', flexWrap: 'wrap' }}>
            <dt style={{ fontWeight: 700, minWidth: 120 }}>{k}</dt>
            {/* 요청번호 — 고객센터 문의 시 이 번호로 사건을 특정한다 */}
            <dd style={{ margin: 0, fontFamily: mono ? 'monospace' : undefined, wordBreak: 'break-all' }}>{v}</dd>
          </div>
        ))}
      </dl>

      <Button onClick={onRecheck}>현재 상태 다시 확인</Button>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────── */

/**
 * 요청 한도에 걸렸을 때 — CAPTCHA 대신 접근 가능한 길 (T-M5-46, ADR-0009)
 *
 * 퍼즐(그림·소리·끌기)로 사람임을 증명하게 하지 않는다. 한도는 계정마다 걸리고 시간이 지나면 풀린다 —
 * 그 시각을 글로 알리고, 그때 버튼이 다시 열리며 "이제 다시 시도할 수 있습니다" 를 알린다. 화면을 장애 안내로 바꾸지
 * 않는다(작성 중인 내용과 단계가 그대로). 문의할 때 쓸 요청번호도 함께. 포커스를 받는다 — 누른 버튼이 잠시 비활성이 된다.
 */
export function RateLimitNotice({ until, traceId, onDone }: { until: number; traceId?: string | undefined; onDone: () => void }) {
  const [done, setDone] = useState(Date.now() >= until);
  useEffect(() => {
    setDone(Date.now() >= until);
    const t = setTimeout(() => {
      setDone(true);
      onDone();
    }, Math.max(0, until - Date.now()));
    return () => clearTimeout(t);
  }, [until, onDone]);
  return (
    <Alert
      tone={done ? 'info' : 'warning'}
      title={done ? '이제 다시 시도할 수 있습니다' : '요청이 많아 잠시 멈췄습니다'}
      focusKey={until}
    >
      {done
        ? '방금 누르신 버튼을 다시 눌러 주십시오. 작성하신 내용은 보관되어 있습니다.'
        : `${formatTime(new Date(until).toISOString())}부터 다시 누를 수 있습니다. 작성하신 내용은 보관되어 있습니다. 그때 이 안내가 바뀝니다.`}
      {traceId && (
        <>
          {' '}
          계속 같은 안내가 나오면 요청번호로 문의해 주십시오: <span style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{traceId}</span>
        </>
      )}
    </Alert>
  );
}

/**
 * 오래 걸리는 요청 안내 — 와이어프레임 "요청 처리 시간이 길어지고 있습니다" (T-M5-55, U-59).
 * 결제·접수를 누르고 아무 말 없이 기다리게 하면 같은 버튼을 다시 누른다. 서버는 같은 요청을 한 번만
 * 처리하지만(멱등 키), 지원자는 그것을 모른다. 10초가 넘으면 기다려도 된다는 것과 요청번호를 보인다.
 */
export function SlowNotice({ busy, afterMs = 10_000 }: { busy: boolean; afterMs?: number }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!busy) {
      setSlow(false);
      return;
    }
    const t = setTimeout(() => setSlow(true), afterMs);
    return () => clearTimeout(t);
  }, [busy, afterMs]);
  // 10초 뒤에 나타난다 — 늘 있는 알림 영역 안에 그려야 스크린리더가 알린다 (T-M5-42)
  return <LiveRegion>{slow && <SlowAlert />}</LiveRegion>;
}

function SlowAlert() {
  const id = currentRequestId();
  return (
    <Alert tone="info" title="요청 처리 시간이 길어지고 있습니다">
      같은 버튼을 반복해서 누르지 않아도 됩니다. 처리가 끝나면 이 화면이 바뀝니다.
      {id && (
        <>
          {' '}
          요청번호: <span style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{id}</span>
        </>
      )}
    </Alert>
  );
}
