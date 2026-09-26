'use client';

import type { OperatingModeView } from '../lib/api';
import type { SaveState } from '../lib/use-autosave';
import type { DeadlineView } from '../lib/use-deadline';
import { formatKstTime, formatRemaining } from '../lib/use-deadline';
import { Alert, Button } from './components';

/**
 * 자동저장 상태 표시 — 기술설계서 v1.1 §07
 *
 * **항상 텍스트로 보인다.** Toast 로 잠깐 띄우고 사라지면 안 된다.
 * 사용자가 "지금 저장됐나?"를 불안해하는 것이 마감 직전 불안의 큰 부분이다.
 */
export function SaveStatus({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
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
        role="alert"
        style={{
          ...base,
          background: 'var(--krds-danger-weak)',
          color: 'var(--krds-danger)',
          fontWeight: 700,
          flexWrap: 'wrap',
        }}
      >
        <span aria-hidden="true">✕</span>
        <span>저장 실패 — {state.reason}</span>
        {state.retryable && (
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
      <div role="status" style={{ ...base, background: 'var(--krds-bg-muted)' }}>
        <span aria-hidden="true">⟳</span> 저장 중…
      </div>
    );
  }

  if (state.kind === 'saved') {
    return (
      <div role="status" style={{ ...base, background: 'var(--krds-success-weak)', color: 'var(--krds-success)' }}>
        <span aria-hidden="true">✓</span> 저장 완료 {formatKstTime(state.at)}
      </div>
    );
  }

  return (
    <div role="status" style={{ ...base, color: 'var(--krds-fg-muted)' }}>
      자동으로 저장됩니다
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────── */

/**
 * 마감 카운트다운.
 * 서버 시각 기준이며, 서버와 통신이 끊기면 남은 시간을 **단정하지 않는다.**
 */
export function DeadlineBanner({ deadline }: { deadline: DeadlineView }) {
  if (deadline.stale) {
    return (
      <div
        role="status"
        style={{
          padding: 'var(--krds-space-3)',
          background: 'var(--krds-bg-muted)',
          borderRadius: 'var(--krds-radius)',
          fontSize: 'var(--krds-text-sm)',
          color: 'var(--krds-fg-muted)',
        }}
      >
        <span aria-hidden="true">⟳ </span>
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

  // 30분 이하부터 경고 톤을 올린다. 색만이 아니라 문구도 바뀐다.
  const urgent = deadline.warningMinutes !== null && deadline.warningMinutes <= 10;
  return (
    <div
      role="status"
      aria-live={urgent ? 'assertive' : 'polite'}
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
        <span aria-hidden="true">{urgent ? '⚠ ' : '🕐 '}</span>
        {formatRemaining(deadline.remainingMs)}
      </strong>
      <span style={{ color: 'var(--krds-fg-muted)' }}>
        마감 {deadline.deadlineAt ? formatKstTime(deadline.deadlineAt) : '-'} (서버 시각 기준)
      </span>
      {deadline.warningMinutes !== null && (
        <span style={{ fontWeight: 700 }}>
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
  if (!view) return null;
  const autonomous = view.mode === 'AUTONOMOUS';
  if (!autonomous && !view.sync.lagging) return null;

  // 연결된 적이 있다가 끊긴 경우에만 시각을 보인다. 한 번도 연결된 적이 없으면
  // `since` 는 서버가 뜬 시각일 뿐이라, "그때부터 끊겼다" 고 말하면 사실이 아니다.
  const since =
    autonomous && view.reason === 'CENTRAL_UNREACHABLE' && view.lastCentralContactAt
      ? new Date(view.since).toLocaleTimeString('ko-KR', {
          timeZone: 'Asia/Seoul',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        })
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
  traceId,
  lastSavedAt,
  onRecheck,
  children,
}: {
  title: string;
  traceId?: string;
  lastSavedAt?: string | null;
  onRecheck: () => void;
  children?: React.ReactNode;
}) {
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
      <h2 style={{ margin: '0 0 var(--krds-space-3)', color: 'var(--krds-danger)' }}>
        <span aria-hidden="true">⚠ </span>
        {title}
      </h2>

      <p style={{ margin: '0 0 var(--krds-space-3)' }}>
        <strong>작성하신 내용은 보관되어 있습니다.</strong> 처음부터 다시 작성하지 않으셔도
        됩니다.
      </p>

      {children}

      <dl style={{ margin: '0 0 var(--krds-space-4)', fontSize: 'var(--krds-text-sm)' }}>
        {lastSavedAt && (
          <div style={{ display: 'flex', gap: 'var(--krds-space-3)' }}>
            <dt style={{ fontWeight: 700 }}>마지막 저장</dt>
            <dd style={{ margin: 0 }}>{formatKstTime(lastSavedAt)}</dd>
          </div>
        )}
        {traceId && (
          <div style={{ display: 'flex', gap: 'var(--krds-space-3)' }}>
            <dt style={{ fontWeight: 700 }}>요청번호</dt>
            {/* 고객센터 문의 시 이 번호로 사건을 특정한다. */}
            <dd style={{ margin: 0, fontFamily: 'monospace' }}>{traceId}</dd>
          </div>
        )}
      </dl>

      <Button onClick={onRecheck}>현재 상태 다시 확인</Button>
    </div>
  );
}
