'use client';

import { Alert, LiveRegion } from '@wonseoro/krds';
import { useCallback, useEffect, useState } from 'react';
import { api, type ServiceStatus } from '../lib/api';

/** 모든 지원자 화면에서 보이는 대학별 장애 공지. 실패하면 화면 기능을 막지 않고 상태 페이지에서 재조회한다. */
export function ServiceIncidentBanner() {
  const [view, setView] = useState<ServiceStatus | null>(null);
  const load = useCallback(async () => {
    try {
      setView((await api.serviceStatus()).data);
    } catch {
      // 공지 조회 실패가 접수 실패는 아니다. 전역 배너에서는 단정하지 않는다.
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const item = view?.incidents[0];
  return (
    <LiveRegion assertive={item?.severity === 'OUTAGE'}>
      {item && (
        <Alert
          tone={item.severity === 'OUTAGE' ? 'danger' : item.severity === 'DEGRADED' ? 'warning' : 'info'}
          title={item.title}
        >
          <p style={{ margin: 0 }}>{item.message}</p>
          <p style={{ margin: 'var(--krds-space-2) 0 0' }}>
            <a href="/status" style={{ color: 'inherit', fontWeight: 700 }}>
              서비스 상태 자세히 보기
            </a>
          </p>
        </Alert>
      )}
    </LiveRegion>
  );
}
