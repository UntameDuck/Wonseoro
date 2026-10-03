'use client';

import { Alert, Button, Card } from '@wonseoro/krds';
import { useCallback, useEffect, useState } from 'react';
import { Breadcrumb } from '../../krds/navigation';
import { api, type ServiceIncident, type ServiceStatus } from '../../lib/api';
import { formatKst } from '../../lib/use-deadline';

const LEVEL = {
  NOTICE: '안내',
  DEGRADED: '일부 기능 지연',
  OUTAGE: '서비스 장애',
} as const;

export default function StatusPage() {
  const [view, setView] = useState<ServiceStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setView((await api.serviceStatus()).data);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <Breadcrumb trail={[{ label: '홈', href: '/' }, { label: '서비스 상태' }]} />
      <h1 style={{ fontSize: 'var(--krds-text-2xl)', marginTop: 0 }}>서비스 상태</h1>
      <p>이 대학 원서접수 서비스의 현재 상태와 지원자 안내입니다.</p>

      {failed ? (
        <Alert tone="danger" title="서비스 상태를 확인할 수 없습니다">
          <p style={{ margin: '0 0 var(--krds-space-3)' }}>
            상태 조회에 연결할 수 없습니다. 작성 중인 원서가 사라졌다는 뜻은 아닙니다.
          </p>
          <Button variant="secondary" disabled={busy} onClick={() => void load()}>
            다시 확인
          </Button>
        </Alert>
      ) : view === null ? (
        <p role="status">상태를 확인하는 중…</p>
      ) : (
        <>
          <Card title={`${view.universityName} · ${view.status === 'OPERATIONAL' ? '정상 운영 중' : '확인할 공지가 있습니다'}`}>
            <p style={{ margin: 0 }}>
              확인 시각 {formatKst(view.checkedAt)}
            </p>
          </Card>
          {view.incidents.length === 0 ? (
            <Alert tone="success" title="현재 안내 중인 장애가 없습니다">
              원서접수 서비스를 정상적으로 이용하실 수 있습니다.
            </Alert>
          ) : (
            view.incidents.map((item) => <IncidentCard key={item.id} item={item} />)
          )}
          <Button variant="secondary" disabled={busy} onClick={() => void load()}>
            현재 상태 다시 확인
          </Button>
        </>
      )}
    </>
  );
}

function IncidentCard({ item }: { item: ServiceIncident }) {
  return (
    <Card title={`${LEVEL[item.severity]} · ${item.title}`}>
      <p style={{ whiteSpace: 'pre-wrap' }}>{item.message}</p>
      <dl style={{ display: 'grid', gap: 'var(--krds-space-2)', marginBottom: 0 }}>
        <div>
          <dt style={{ fontWeight: 700 }}>안내 시작</dt>
          <dd style={{ margin: 0 }}>{formatKst(item.startsAt)}</dd>
        </div>
        {item.expectedResolvedAt && (
          <div>
            <dt style={{ fontWeight: 700 }}>예상 정상화</dt>
            <dd style={{ margin: 0 }}>{formatKst(item.expectedResolvedAt)}</dd>
          </div>
        )}
      </dl>
    </Card>
  );
}
