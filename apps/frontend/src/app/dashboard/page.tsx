'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Icon } from '@wonseoro/krds';
import { APPLICATION_STATUS_LABEL, labelOf, problemText } from '@wonseoro/contracts';
import { Breadcrumb } from '../../krds/navigation';
import { ApiError, NetworkError, api } from '../../lib/api';
import { loadSession } from '../../lib/session';
import { formatKst } from '../../lib/use-deadline';

interface Row {
  universityId: string;
  universityName?: string;
  universityReachable?: boolean;
  universityLastHeartbeatAt?: string | null;
  applicationNumber: string | null;
  status: string;
  admissionTypeCode: string;
  departmentCode: string;
  admissionTypeName?: string | null;
  departmentName?: string | null;
  lastSyncedAt: string;
}

/**
 * 내 원서 Dashboard — 기술설계서 v1.1 §10 §9
 *
 * 중앙의 **요약**을 읽는다. 대학 DB 를 직접 조회하지 않는다.
 *
 * 두 가지를 반드시 지킨다.
 *   1. **마지막 동기화 시각을 함께 보여준다.** 중앙은 언제나 뒤처질 수 있다
 *   2. 중앙이 죽어도 화면이 "접수 실패"로 보이면 안 된다.
 *      중앙 장애는 조회 제한일 뿐, 접수와 무관하다
 */
export default function DashboardPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [centralDown, setCentralDown] = useState(false);
  /** 본인확인을 하지 않았다 — "원서가 없습니다" 와 다르다 (T-M5-55, U-34) */
  const [noSession, setNoSession] = useState(false);
  /** 중앙 장애가 아닌 오류(신원 불일치 등). 장애 안내로 보이지 않는다 (U-35) */
  const [failed, setFailed] = useState<{ title: string; detail: string } | null>(null);
  const [serverTime, setServerTime] = useState<string | null>(null);

  const load = useCallback(async () => {
    const session = loadSession();
    if (!session) {
      setNoSession(true);
      return;
    }
    setNoSession(false);
    setFailed(null);
    try {
      const { data } = await api.dashboard(session.subjectToken);
      setRows(data.applications);
      setServerTime(data.serverTime);
      setCentralDown(false);
    } catch (err) {
      // 연결 자체가 안 될 때만 "통합 조회 일시 중단" 이다. 나머지는 그 오류를 말한다 — 전에는 신원 불일치(403)도
      // 중앙 장애로 보여, 지원자가 기다리기만 했다 (U-35)
      if (err instanceof NetworkError) {
        setCentralDown(true);
        return;
      }
      setCentralDown(false);
      setFailed(problemText(err instanceof ApiError ? err.problem : null));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <Breadcrumb trail={[{ label: '홈', href: '/' }, { label: '내 원서' }]} />
      <h1 style={{ fontSize: 'var(--krds-text-2xl)', marginTop: 0 }}>내 원서</h1>

      {noSession ? (
        <Card title="본인확인이 필요합니다">
          <p style={{ marginTop: 0 }}>내 원서를 보려면 접수 홈에서 먼저 본인확인을 해 주십시오.</p>
          <Link href="/" style={{ color: 'var(--krds-primary)' }}>
            접수 홈으로
          </Link>
        </Card>
      ) : failed ? (
        <Alert tone="danger" title={failed.title}>
          <p style={{ margin: '0 0 var(--krds-space-3)' }}>{failed.detail}</p>
          <Button variant="secondary" onClick={() => void load()}>
            다시 시도
          </Button>
        </Alert>
      ) : centralDown ? (
        /**
         * 중앙 장애. **접수가 안 됐다고 말하지 않는다.**
         * 여기서 "조회 실패"를 "접수 실패"처럼 보이게 하면
         * 사용자가 중복 제출을 시도한다.
         */
        <Alert tone="warning" title="통합 조회를 일시적으로 사용할 수 없습니다">
          <p style={{ margin: '0 0 var(--krds-space-3)' }}>
            <strong>이미 접수하신 원서는 영향을 받지 않습니다.</strong> 각 대학 서버가 접수
            내역을 보관하고 있으며, 통합 조회만 잠시 제한됩니다.
          </p>
          <p style={{ margin: '0 0 var(--krds-space-3)' }}>
            급하시면 해당 대학 접수 페이지에서 직접 상태를 확인하실 수 있습니다.
          </p>
          <Button variant="secondary" onClick={() => void load()}>
            다시 시도
          </Button>
        </Alert>
      ) : rows === null ? (
        <p role="status">불러오는 중…</p>
      ) : rows.length === 0 ? (
        <Card>
          <p style={{ margin: 0 }}>아직 접수한 원서가 없습니다.</p>
        </Card>
      ) : (
        <>
          <p style={{ fontSize: 'var(--krds-text-sm)', color: 'var(--krds-fg-muted)' }}>
            조회 시각: {formatKst(serverTime)}
          </p>
          {rows.map((r) => (
            <Card key={`${r.universityId}-${r.applicationNumber}`}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 'var(--krds-space-4)',
                  flexWrap: 'wrap',
                }}
              >
                <div>
                  <h2 style={{ margin: 0, fontSize: 'var(--krds-text-lg)' }}>
                    {r.universityName ?? '대학 정보 확인 중'}
                  </h2>
                  {/* 코드(EARLY · CSE)는 보이지 않는다. 이름 없이 동기화된 옛 행은 줄을 비운다 (T-M5-51) */}
                  {(r.admissionTypeName || r.departmentName) && (
                    <p style={{ margin: 'var(--krds-space-1) 0', color: 'var(--krds-fg-muted)' }}>
                      {[r.admissionTypeName, r.departmentName].filter(Boolean).join(' · ')}
                    </p>
                  )}
                  {r.applicationNumber && (
                    <p style={{ margin: 0 }}>
                      접수번호 <strong>{r.applicationNumber}</strong>
                    </p>
                  )}
                  {/* 그 대학 서버 신호가 끊겼다. 이 카드만 "확인 불가" 다 — 다른 대학 원서는 평소대로다.
                      접수 실패로 보이게 하지 않는다 (T-M4-42 · D-60) */}
                  {r.universityReachable === false && (
                    <p role="status" style={{ margin: 'var(--krds-space-2) 0 0', color: 'var(--krds-warning)', fontSize: 'var(--krds-text-sm)' }}>
                      <Icon name="warning" />
                      지금 이 대학 서버 상태를 확인할 수 없습니다
                      {r.universityLastHeartbeatAt ? ` (마지막 확인 ${formatKst(r.universityLastHeartbeatAt)})` : ''}. 접수가
                      취소된 것은 아닙니다 — 대학 접수 페이지에서 확인하실 수 있습니다.
                    </p>
                  )}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span
                    style={{
                      display: 'inline-block',
                      padding: 'var(--krds-space-1) var(--krds-space-3)',
                      borderRadius: 999,
                      background:
                        r.status === 'FINALIZED'
                          ? 'var(--krds-success-weak)'
                          : 'var(--krds-bg-muted)',
                      color:
                        r.status === 'FINALIZED' ? 'var(--krds-success)' : 'var(--krds-fg-muted)',
                      fontWeight: 700,
                      fontSize: 'var(--krds-text-sm)',
                    }}
                  >
                    <Icon name={r.status === 'FINALIZED' ? 'check' : 'circle'} />
                    {labelOf(APPLICATION_STATUS_LABEL, r.status, '확인 중')}
                  </span>
                  {/* 중앙은 언제나 뒤처질 수 있다. 그 사실을 숨기지 않는다. */}
                  <p
                    style={{
                      margin: 'var(--krds-space-2) 0 0',
                      fontSize: 'var(--krds-text-xs)',
                      color: 'var(--krds-fg-subtle)',
                    }}
                  >
                    {formatKst(r.lastSyncedAt)} 기준
                  </p>
                </div>
              </div>
            </Card>
          ))}
        </>
      )}
    </>
  );
}
