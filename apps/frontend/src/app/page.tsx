'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Field, Select } from '../krds/components';
import { ApiError, NetworkError, api } from '../lib/api';
import { loadSession, saveSession } from '../lib/session';
import { useOperatingMode } from '../lib/use-operating-mode';
import { OperatingModeBanner } from '../krds/status';

/**
 * 접수 홈 — 기술설계서 v1.0 §12.1 "① 접수 홈"
 *
 * **전형과 모집단위를 화면에 박아두지 않는다.** 대학 카탈로그 API 에서 읽는다.
 * 박아두면 §A5 의 "새 전형 추가에 code fork 0" 이 화면에서 깨진다 —
 * 대학이 전형을 하나 늘릴 때마다 프론트를 고쳐 다시 배포해야 한다.
 *
 * M5 에서 본인확인이 OIDC 로 바뀐다. (T-M5-02)
 */

interface Cycle {
  id: string;
  name: string;
  admissionYear: number;
  closesAt: string;
}
interface AdmissionType {
  id: string;
  code: string;
  name: string;
  feeAmount: number;
}
interface Department {
  id: string;
  code: string;
  name: string;
  quota: number | null;
}

export default function Home() {
  const router = useRouter();
  const [applicantId, setApplicantId] = useState(loadSession()?.applicantId ?? '');
  const operatingMode = useOperatingMode();

  const [cycle, setCycle] = useState<Cycle | null>(null);
  const [types, setTypes] = useState<AdmissionType[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [typeId, setTypeId] = useState('');
  const [departmentId, setDepartmentId] = useState('');

  const [loading, setLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    setCatalogError(null);
    try {
      const { data: c } = await api.currentCycle();
      const [{ data: t }, { data: d }] = await Promise.all([
        api.admissionTypes(c.id),
        api.departments(c.id),
      ]);
      setCycle(c);
      setTypes(t);
      setDepartments(d);
      setTypeId(t[0]?.id ?? '');
      setDepartmentId(d[0]?.id ?? '');
    } catch (err) {
      setCatalogError(
        err instanceof NetworkError
          ? '대학 접수 서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주십시오.'
          : err instanceof ApiError
            ? (err.problem.detail ?? err.problem.title)
            : '모집 정보를 불러오지 못했습니다.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const selectedType = types.find((t) => t.id === typeId);

  async function start() {
    if (!cycle || !typeId || !departmentId) return;
    setBusy(true);
    setError(null);
    const subjectToken = `subj-${applicantId.slice(0, 8)}`;
    try {
      const { data } = await api.createApplication(
        { cycleId: cycle.id, admissionTypeId: typeId, departmentId },
        { applicantId, subjectToken },
      );
      saveSession({ applicantId, subjectToken, applicationId: data.id });
      router.push(`/apply/${data.id}`);
    } catch (err) {
      if (err instanceof NetworkError) {
        setError('대학 접수 서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주십시오.');
      } else if (err instanceof ApiError) {
        setError(err.problem.detail ?? err.problem.title);
      } else {
        setError('알 수 없는 오류가 발생했습니다.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 style={{ fontSize: 'var(--krds-text-2xl)', marginTop: 0 }}>원서접수</h1>

      <Alert tone="info" title="이 서비스의 구조">
        공통원서·대학검색·내 원서는 중앙에서 제공하지만, 작성·서류·결제·최종접수는{' '}
        <strong>각 대학 서버에서 처리</strong>합니다. 중앙에 장애가 생겨도 이미 시작한 대학 접수는
        계속 진행됩니다.
      </Alert>

      <OperatingModeBanner view={operatingMode} />

      {loading && <Card title="모집 정보를 불러오는 중입니다">잠시만 기다려 주십시오.</Card>}

      {catalogError && (
        <Card title="모집 정보를 불러올 수 없습니다">
          <Alert tone="danger" title="접수를 시작할 수 없습니다">
            {catalogError}
          </Alert>
          <Button onClick={() => void loadCatalog()}>다시 시도</Button>
        </Card>
      )}

      {!loading && !catalogError && cycle && (
        <Card title={`${cycle.admissionYear}학년도 ${cycle.name}`}>
          <Select
            label="전형"
            value={typeId}
            onChange={setTypeId}
            options={types.map((t) => ({ value: t.id, label: `${t.name} (${t.code})` }))}
            hint="전형에 따라 작성할 항목과 전형료가 달라집니다."
            required
          />

          <Select
            label="모집단위"
            value={departmentId}
            onChange={setDepartmentId}
            options={departments.map((d) => ({
              value: d.id,
              label: d.quota === null ? d.name : `${d.name} (모집 ${d.quota}명)`,
            }))}
            required
          />

          {selectedType && (
            <p
              style={{
                margin: '0 0 var(--krds-space-5)',
                fontSize: 'var(--krds-text-sm)',
                color: 'var(--krds-fg-muted)',
              }}
            >
              전형료 <strong>{selectedType.feeAmount.toLocaleString('ko-KR')}원</strong> · 마감{' '}
              {new Date(cycle.closesAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
            </p>
          )}

          <h2 style={{ fontSize: 'var(--krds-text-lg)' }}>본인 확인</h2>
          <p
            style={{ marginTop: 0, color: 'var(--krds-fg-muted)', fontSize: 'var(--krds-text-sm)' }}
          >
            개발 단계에서는 지원자 식별자를 직접 입력합니다. 실제 서비스에서는 본인확인 절차로
            대체됩니다.
          </p>
          <Field
            label="지원자 식별자"
            value={applicantId}
            onChange={setApplicantId}
            hint="대학 DB 에 등록된 지원자 UUID 를 입력하십시오."
            required
          />

          {error && (
            <Alert tone="danger" title="원서를 시작할 수 없습니다">
              {error}
            </Alert>
          )}

          <Button
            onClick={() => void start()}
            disabled={busy || applicantId.length < 8 || !typeId || !departmentId}
          >
            {busy ? '원서를 준비하는 중…' : '원서 작성 시작'}
          </Button>
        </Card>
      )}
    </>
  );
}
