'use client';

import { useEffect, useRef, useState } from 'react';
import { formatDateTime, formatTime } from '@wonseoro/krds';
import { NetworkError, api } from './api';

export interface DeadlineView {
  /** 서버 시각 기준 남은 밀리초. */
  remainingMs: number;
  deadlineAt: string | null;
  policyVersion: string | null;
  passed: boolean;
  /** 30 / 10 / 5 / 1 분 경고 중 현재 해당하는 값. */
  warningMinutes: number | null;
  /** 서버와 통신이 안 되는 상태. 화면은 남은 시간을 단정하지 않는다. */
  stale: boolean;
}

/**
 * 마감 카운트다운 — 기술설계서 v1.1 §A2
 *
 * **브라우저 시계를 쓰지 않는다.**
 * 사용자 PC 시간이 5분 빠르면 5분 일찍 포기하게 되고,
 * 5분 느리면 마감된 줄 모르고 계속 입력한다. 둘 다 실제로 일어난 일이다.
 *
 * 방식
 *   1. 서버에서 serverTime·deadlineAt·policyVersion 을 받는다
 *   2. 받은 순간의 브라우저 시각을 offset 으로 저장한다
 *   3. 화면 갱신은 **offset 기준 경과시간**으로 계산한다
 *   4. 주기적으로 서버와 다시 맞춘다 (drift 보정)
 *
 * 서버와 통신이 끊기면 `stale` 을 세운다.
 * 이때 화면은 남은 시간을 단정하지 말고 "확인 중"으로 표시해야 한다.
 */
/**
 * `cycleId` 를 아직 모르면 null 을 넘긴다.
 * 임의의 전형으로 대신 물어보지 않는다 — 남의 마감시각을 보여주는 셈이고,
 * 그 값으로 화면이 "마감됨" 을 그리면 사용자는 접수를 포기한다.
 */
export function useDeadline(cycleId: string | null, resyncMs = 60_000): DeadlineView {
  const [view, setView] = useState<DeadlineView>({
    remainingMs: 0,
    deadlineAt: null,
    policyVersion: null,
    passed: false,
    warningMinutes: null,
    stale: true,
  });

  /** 서버 남은시간을 받은 시점의 브라우저 시각. */
  const anchorRef = useRef<{ browserAt: number; remainingMs: number } | null>(null);

  useEffect(() => {
    if (!cycleId) return;
    let cancelled = false;

    const sync = async () => {
      try {
        const { data } = await api.serverTime(cycleId);
        if (cancelled) return;
        anchorRef.current = { browserAt: Date.now(), remainingMs: data.remainingMs };
        setView({
          remainingMs: data.remainingMs,
          deadlineAt: data.deadlineAt,
          policyVersion: data.deadlinePolicyVersion,
          passed: data.passed,
          warningMinutes: data.warningMinutes,
          stale: false,
        });
      } catch (err) {
        if (cancelled) return;
        // 서버가 안 되면 남은 시간을 단정하지 않는다.
        setView((v) => ({ ...v, stale: true }));
        if (!(err instanceof NetworkError)) throw err;
      }
    };

    void sync();
    const resync = setInterval(() => void sync(), resyncMs);

    // 화면 갱신은 anchor 기준 경과시간으로만 한다.
    const tick = setInterval(() => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const elapsed = Date.now() - anchor.browserAt;
      const remaining = anchor.remainingMs - elapsed;
      setView((v) => ({
        ...v,
        remainingMs: remaining,
        passed: remaining <= 0,
        warningMinutes: warningFor(remaining),
      }));
    }, 1000);

    return () => {
      cancelled = true;
      clearInterval(resync);
      clearInterval(tick);
    };
  }, [cycleId, resyncMs]);

  return view;
}

/** 가장 촘촘한 경고 단계. 남은 시간이 7분이면 10분 경고다. */
function warningFor(remainingMs: number): number | null {
  if (remainingMs <= 0) return null;
  const minutes = remainingMs / 60_000;
  for (const m of [1, 5, 10, 30]) {
    if (minutes <= m) return m;
  }
  return null;
}

export function formatRemaining(ms: number): string {
  if (ms <= 0) return '마감되었습니다';
  const total = Math.floor(ms / 1000);
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (d > 0) return `${d}일 ${h}시간 남음`;
  if (h > 0) return `${h}시간 ${m}분 남음`;
  if (m > 0) return `${m}분 ${s}초 남음`;
  return `${s}초 남음`;
}

/** 서버가 준 ISO 시각을 한국 시간 "2026.12.31 18:00" 으로. 표기 규칙은 KRDS 한 곳에 있다 (T-M5-54). */
export function formatKst(iso: string | null): string {
  return formatDateTime(iso);
}

/** 방금 일어난 일의 시각 "17:42:13" (저장 완료 등). */
export function formatKstTime(iso: string | null): string {
  return formatTime(iso);
}
