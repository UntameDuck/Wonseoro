'use client';

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
