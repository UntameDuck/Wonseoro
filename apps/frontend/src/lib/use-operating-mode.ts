'use client';

import { useEffect, useState } from 'react';
import { api, type OperatingModeView } from './api';

/**
 * 자율 운영 여부 — 기술설계서 v1.1 §A1 "Autonomous Mode 운영배너와 Sync Lag 표시"
 *
 * 대학 서버에 묻는다. 중앙에 묻지 않는다 — 중앙이 죽었는지를 중앙에 물을 수는 없다.
 *
 * 대학 서버에도 닿지 않으면 null 이다. 그건 이 배너가 다룰 상황이 아니다.
 * 저장 실패·장애 안내가 따로 그 상황을 다룬다. 모르는 것을 "정상" 으로도,
 * "자율 운영" 으로도 표시하지 않는다.
 */
export function useOperatingMode(pollMs = 30_000): OperatingModeView | null {
  const [view, setView] = useState<OperatingModeView | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const { data } = await api.operatingMode();
        if (!cancelled) setView(data);
      } catch {
        if (!cancelled) setView(null);
      }
    };
    void load();
    const timer = setInterval(() => void load(), pollMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [pollMs]);

  return view;
}
