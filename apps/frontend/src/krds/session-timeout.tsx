'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, formatTime } from '@wonseoro/krds';
import {
  SESSION_EVENT,
  SESSION_EXPIRING_EVENT,
  SESSION_WARN_MS,
  endSession,
  extendSession,
  lastSavedHere,
  peekSession,
  sessionExpiresAt,
} from '../lib/session';
import { formatKstTime } from '../lib/use-deadline';

type Phase = 'none' | 'ok' | 'warning' | 'expired';

/**
 * 세션 만료 사전 경고 — 노션 §07 「접근성」 Session Timeout 사전경고 (T-M5-45)
 *
 * 끝나기 5분 전에 대화상자로 알리고 "계속 이용하기" 한 번으로 연장한다(KWCAG 시간 조절 — 20초 이상 여유).
 * 알리는 순간과 끝나는 순간에 작성 화면이 **바로 저장**한다 — 자동저장은 입력이 멈추고 15초 뒤라, 그 사이에
 * 세션이 끝나면 마지막 입력을 잃는다. 끝나면 대화상자를 닫을 수 없게 두고(끝난 신원으로 요청하지 않게)
 * 마지막 저장 시각과 다시 본인확인하는 길을 준다.
 *
 * 대화상자는 브라우저 기본 모달(<dialog>)이다 — 포커스가 안에 갇히고, 스크린리더가 제목·설명을 읽고,
 * 닫히면 원래 자리로 돌아온다. 남은 시간은 매초 바뀌므로 읽지 않고(숨김), 끝나는 시각을 설명으로 읽는다.
 */
export function SessionTimeout() {
  const [phase, setPhase] = useState<Phase>('none');
  const [remaining, setRemaining] = useState(0);
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const phaseRef = useRef<Phase>('none');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const applicationRef = useRef<string | null>(null);

  const move = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const expire = useCallback(() => {
    // 끝나기 직전 마지막 저장 — 세션을 지우기 전에 알린다
    applicationRef.current = peekSession()?.applicationId ?? null;
    window.dispatchEvent(new Event(SESSION_EXPIRING_EVENT));
    endSession();
    move('expired');
  }, [move]);

  useEffect(() => {
    const tick = () => {
      if (phaseRef.current === 'expired') {
        // 끝날 때 보낸 저장이 끝나면 그 시각을 보인다
        if (applicationRef.current) setSavedAt(lastSavedHere(applicationRef.current));
        return;
      }
      const at = sessionExpiresAt();
      if (at === null) {
        if (phaseRef.current !== 'none') move('none');
        return;
      }
      const left = at - Date.now();
      setRemaining(left);
      setEndsAt(at);
      if (left <= 0) {
        expire();
      } else if (left <= SESSION_WARN_MS) {
        if (phaseRef.current !== 'warning') {
          returnFocus.current = document.activeElement as HTMLElement | null;
          window.dispatchEvent(new Event(SESSION_EXPIRING_EVENT));
          move('warning');
        }
      } else if (phaseRef.current !== 'ok') {
        move('ok');
      }
    };
    tick();
    const t = setInterval(tick, 1000);
    window.addEventListener(SESSION_EVENT, tick);
    return () => {
      clearInterval(t);
      window.removeEventListener(SESSION_EVENT, tick);
    };
  }, [expire, move]);

  // 대화상자 열기·닫기. 닫히면 경고 전에 있던 자리로 포커스를 돌려준다.
  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if ((phase === 'warning' || phase === 'expired') && !d.open) d.showModal();
    if ((phase === 'ok' || phase === 'none') && d.open) {
      d.close();
      returnFocus.current?.focus();
      returnFocus.current = null;
    }
    // 열리면 할 일(계속 이용하기 / 다시 본인확인)에 포커스
    if (d.open) d.querySelector<HTMLElement>('#session-extend, [data-primary]')?.focus();
  }, [phase]);

  const minutes = Math.max(0, Math.floor(remaining / 60_000));
  const seconds = Math.max(0, Math.floor((remaining % 60_000) / 1000));

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="session-timeout-title"
      aria-describedby="session-timeout-desc"
      onCancel={(e) => {
        // Esc — 경고 중이면 계속 쓰겠다는 뜻으로 연장한다. 끝난 뒤에는 닫지 않는다
        e.preventDefault();
        if (phaseRef.current === 'warning') extendSession();
      }}
      style={{
        width: 'min(480px, calc(100vw - 32px))',
        padding: 'var(--krds-space-5)',
        border: '2px solid var(--krds-border-strong)',
        borderRadius: 'var(--krds-radius-lg)',
        color: 'var(--krds-fg)',
        background: 'var(--krds-bg)',
      }}
    >
      {phase === 'expired' ? (
        <>
          <h2 id="session-timeout-title" style={{ marginTop: 0, fontSize: 'var(--krds-text-xl)' }}>
            이용 시간이 끝나 자동으로 종료되었습니다
          </h2>
          <p id="session-timeout-desc">
            {savedAt
              ? `작성하신 내용은 ${formatKstTime(savedAt)}에 저장되었습니다. `
              : '작성하신 원서는 마지막으로 저장된 상태로 보관되어 있습니다. '}
            다시 본인확인하면 이어서 작성할 수 있습니다.
          </p>
          <a data-primary href="/" style={{ color: 'var(--krds-primary)', fontWeight: 700 }}>
            접수 홈에서 다시 본인확인
          </a>
        </>
      ) : (
        <>
          <h2 id="session-timeout-title" style={{ marginTop: 0, fontSize: 'var(--krds-text-xl)' }}>
            곧 자동으로 종료됩니다
          </h2>
          <p id="session-timeout-desc">
            한동안 이용이 없어 {endsAt ? formatTime(new Date(endsAt).toISOString(), { seconds: false }) : '잠시 후'}에 자동으로
            종료됩니다. 작성 중인 내용은 지금 저장합니다. 계속 이용하시려면 &lsquo;계속 이용하기&rsquo;를 누르십시오.
          </p>
          {/* 남은 시간은 매초 바뀐다 — 눈으로만 본다. 스크린리더는 위 끝나는 시각을 읽는다 */}
          <p aria-hidden="true" style={{ fontSize: 'var(--krds-text-lg)', fontWeight: 700 }}>
            남은 시간 {minutes}분 {String(seconds).padStart(2, '0')}초
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--krds-space-3)' }}>
            <Button id="session-extend" onClick={() => extendSession()}>
              계속 이용하기
            </Button>
            <Button variant="secondary" onClick={() => expire()}>
              지금 종료
            </Button>
          </div>
        </>
      )}
    </dialog>
  );
}
