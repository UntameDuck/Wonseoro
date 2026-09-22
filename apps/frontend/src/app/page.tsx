'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Button, Card, Field } from '../krds/components';
import { ApiError, NetworkError, api } from '../lib/api';
import { DEMO_CYCLE, DEMO_DEPARTMENT, DEMO_TYPE, loadSession, saveSession } from '../lib/session';

/**
 * 접수 홈 — 기술설계서 v1.0 §12.1 "① 접수 홈"
 *
 * M2 는 인증 연동 전이라 본인확인을 헤더 기반으로 흉내낸다.
 * M5 에서 OIDC 로 교체한다. (T-M5-02)
 */
export default function Home() {
  const router = useRouter();
  const [applicantId, setApplicantId] = useState(loadSession()?.applicantId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    const subjectToken = `subj-${applicantId.slice(0, 8)}`;
    try {
      const { data } = await api.createApplication(
        {
          cycleId: DEMO_CYCLE,
          admissionTypeId: DEMO_TYPE,
          departmentId: DEMO_DEPARTMENT,
        },
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

      <Card title="본인 확인">
        <p style={{ marginTop: 0, color: 'var(--krds-fg-muted)', fontSize: 'var(--krds-text-sm)' }}>
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
        <Button onClick={() => void start()} disabled={busy || applicantId.length < 8}>
          {busy ? '원서를 준비하는 중…' : '원서 작성 시작'}
        </Button>
      </Card>
    </>
  );
}
