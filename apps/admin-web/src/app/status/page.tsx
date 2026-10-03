'use client';

import { Alert, Button, Card, Field, Select } from '@wonseoro/krds';
import { useCallback, useEffect, useState } from 'react';
import { useConsole } from '../../components/console';
import { actionKey, adminGet, adminPost, describe, kst } from '../../lib/api';

type Severity = 'NOTICE' | 'DEGRADED' | 'OUTAGE';
interface Incident {
  id: string;
  severity: Severity;
  title: string;
  message: string;
  startsAt: string;
  expectedResolvedAt: string | null;
  status: 'ACTIVE' | 'RESOLVED';
  createdBy: string;
  createdAt: string;
  resolvedBy: string | null;
  resolvedAt: string | null;
}

const SEVERITY = {
  NOTICE: '안내',
  DEGRADED: '일부 기능 지연',
  OUTAGE: '서비스 장애',
} as const;

export default function IncidentPage() {
  const { operator } = useConsole();
  const [filter, setFilter] = useState('ACTIVE');
  const [items, setItems] = useState<Incident[] | null>(null);
  const [severity, setSeverity] = useState<Severity>('DEGRADED');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [expected, setExpected] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  const reload = useCallback(async () => {
    try {
      setItems((await adminGet<{ incidents: Incident[] }>('incidents', { status: filter })).incidents);
    } catch (error) {
      setNotice({ tone: 'danger', text: describe(error) });
    }
  }, [filter]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const invalid = !operator
    ? '담당자를 먼저 지정해 주십시오.'
    : title.trim().length === 0
      ? '제목을 적어 주십시오.'
      : message.trim().length === 0
        ? '지원자 안내를 적어 주십시오.'
        : null;

  const publish = async () => {
    setBusy(true);
    setNotice(null);
    try {
      await adminPost(
        'incidents',
        {
          severity,
          title: title.trim(),
          message: message.trim(),
          expectedResolvedAt: expected ? new Date(expected).toISOString() : null,
        },
        actionKey('incident-publish'),
      );
      setTitle('');
      setMessage('');
      setExpected('');
      setFilter('ACTIVE');
      setNotice({ tone: 'success', text: '장애 공지를 발행했습니다. 지원자 화면과 서비스 상태 페이지에 표시됩니다.' });
      await reload();
    } catch (error) {
      setNotice({ tone: 'danger', text: describe(error) });
    } finally {
      setBusy(false);
    }
  };

  const resolve = async (id: string) => {
    setBusy(true);
    setNotice(null);
    try {
      await adminPost(`incidents/${id}/resolve`, {}, actionKey('incident-resolve'));
      setNotice({ tone: 'success', text: '공지 상태를 정상화로 바꿨습니다. 공개 화면에서 내려갑니다.' });
      await reload();
    } catch (error) {
      setNotice({ tone: 'danger', text: describe(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1 style={{ fontSize: 'var(--krds-text-2xl)', marginTop: 0 }}>장애 공지</h1>
      <p>이 대학 접수 화면에만 표시되는 공지를 발행합니다. 내부 원인, 개인정보, 시스템 주소는 적지 마십시오.</p>

      <Card title="지원자 공지 발행">
        <Select
          label="영향 수준"
          value={severity}
          onChange={(value) => setSeverity(value as Severity)}
          options={[
            { value: 'NOTICE', label: '안내 — 접수 기능 영향 없음' },
            { value: 'DEGRADED', label: '일부 기능 지연' },
            { value: 'OUTAGE', label: '서비스 장애' },
          ]}
          required
        />
        <Field label="제목" value={title} onChange={setTitle} maxLength={120} required />
        <Field
          label="지원자 안내"
          hint="무엇이 영향을 받고, 지원자가 지금 무엇을 해야 하는지 적습니다."
          value={message}
          onChange={setMessage}
          maxLength={1000}
          multiline
          required
        />
        <Field
          label="예상 정상화 시각 (선택)"
          hint="확정할 수 없으면 비워 두십시오. 한국 시각으로 입력합니다."
          type="datetime-local"
          value={expected}
          onChange={setExpected}
        />
        <Button disabled={busy || invalid !== null} onClick={() => void publish()}>
          공지 발행
        </Button>
        {invalid && <p style={{ color: 'var(--krds-fg-muted)', fontSize: 'var(--krds-text-sm)' }}>{invalid}</p>}
      </Card>

      {notice && <Alert tone={notice.tone} title={notice.text} focusKey={notice} />}

      <Card title="공지 원장">
        <div style={{ maxWidth: 280 }}>
          <Select
            label="표시할 상태"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'ACTIVE', label: '현재 표시 중' },
              { value: 'RESOLVED', label: '해제됨' },
              { value: 'ALL', label: '전체' },
            ]}
          />
        </div>
      </Card>

      {items === null ? (
        <p role="status">공지를 불러오는 중…</p>
      ) : items.length === 0 ? (
        <Card><p style={{ margin: 0 }}>해당하는 공지가 없습니다.</p></Card>
      ) : (
        items.map((item) => (
          <Card key={item.id} title={`${SEVERITY[item.severity]} · ${item.title}`}>
            <p style={{ whiteSpace: 'pre-wrap' }}>{item.message}</p>
            <dl style={{ display: 'grid', gap: 'var(--krds-space-2)' }}>
              <div><dt style={{ fontWeight: 700 }}>발행</dt><dd style={{ margin: 0 }}>{kst(item.createdAt)} · {item.createdBy}</dd></div>
              {item.expectedResolvedAt && <div><dt style={{ fontWeight: 700 }}>예상 정상화</dt><dd style={{ margin: 0 }}>{kst(item.expectedResolvedAt)}</dd></div>}
              {item.resolvedAt && <div><dt style={{ fontWeight: 700 }}>해제</dt><dd style={{ margin: 0 }}>{kst(item.resolvedAt)} · {item.resolvedBy}</dd></div>}
            </dl>
            {item.status === 'ACTIVE' && (
              <Button variant="secondary" disabled={busy || !operator} onClick={() => void resolve(item.id)}>
                정상화로 공지 해제
              </Button>
            )}
          </Card>
        ))
      )}
    </>
  );
}
