'use client';

import { use, useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, DescriptionList, ErrorSummary, Field } from '../../../krds/components';
import { Breadcrumb, STEPS, StepIndicator, type StepNo } from '../../../krds/navigation';
import { DeadlineBanner, FailureNotice, SaveStatus } from '../../../krds/status';
import {
  ApiError,
  NetworkError,
  type Application,
  type SelfCheck,
  type Submission,
  api,
  newIdempotencyKey,
} from '../../../lib/api';
import { useAutosave } from '../../../lib/use-autosave';
import { formatKst, useDeadline } from '../../../lib/use-deadline';
import { DEMO_CYCLE, loadSession } from '../../../lib/session';

/**
 * 원서 작성 6단계 — 기술설계서 v1.1 §07
 *
 * 단계를 별도 라우트로 쪼개지 않는다.
 * 작성 중 상태(저장 상태·마감 카운트다운·오류)가 단계 이동으로 끊기면
 * 사용자가 "지금 저장됐나"를 다시 불안해한다.
 */
export default function ApplyPage({
  params,
}: {
  params: Promise<{ applicationId: string }>;
}) {
  const { applicationId } = use(params);
  const session = typeof window !== 'undefined' ? loadSession() : null;
  const applicantId = session?.applicantId ?? '';

  const [step, setStep] = useState<StepNo>(1);
  const [app, setApp] = useState<Application | null>(null);
  const [etag, setEtag] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [issues, setIssues] = useState<Array<{ path: string; message: string }>>([]);
  const [failure, setFailure] = useState<{ title: string; traceId?: string } | null>(null);
  const [selfCheck, setSelfCheck] = useState<SelfCheck | null>(null);
  const [payment, setPayment] = useState<{ id: string; amount: number; status: string } | null>(
    null,
  );
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [busy, setBusy] = useState(false);

  const deadline = useDeadline(app?.cycleId ?? DEMO_CYCLE);
  const frozen = app?.status === 'FINALIZED';

  const autosave = useAutosave({
    applicationId,
    applicantId,
    initialEtag: etag,
    debounceMs: 15_000,
    ...(frozen ? { frozen: true } : {}),
  });

  /** 서버 상태부터 읽는다. 재연결 후에도 항상 서버가 기준이다. (v1.1 §10 §4) */
  const reload = useCallback(async () => {
    try {
      const res = await api.getApplication(applicationId);
      setApp(res.data);
      setEtag(res.etag);
      setFields(
        Object.fromEntries(
          Object.entries(res.data.fields).map(([k, v]) => [k, v === null ? '' : String(v)]),
        ),
      );
      setFailure(null);
      if (res.data.status === 'FINALIZED') {
        const sub = await api.submission(applicationId).catch(() => null);
        if (sub) setSubmission(sub.data);
        setStep(6);
      }
    } catch (err) {
      setFailure({
        title:
          err instanceof NetworkError
            ? '대학 접수 서버에 연결할 수 없습니다'
            : '원서를 불러오지 못했습니다',
        ...(err instanceof ApiError ? { traceId: err.problem.traceId } : {}),
      });
    }
  }, [applicationId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const recheck = useCallback(async () => {
    const res = await api.selfCheck(applicationId).catch(() => null);
    if (res) setSelfCheck(res.data);
    await reload();
  }, [applicationId, reload]);

  function update(code: string, value: string) {
    const next = { ...fields, [code]: value };
    setFields(next);
    // 숫자 필드는 서버 스키마가 integer 를 요구한다.
    autosave.schedule(coerce(next));
  }

  async function runValidate() {
    setBusy(true);
    try {
      await autosave.saveNow();
      const { data } = await api.validate(applicationId, applicantId);
      setIssues(data.issues);
      if (data.valid) setStep(5);
    } catch (err) {
      handle(err);
    } finally {
      setBusy(false);
    }
  }

  async function pay() {
    setBusy(true);
    try {
      const intentKey = newIdempotencyKey('payintent');
      const intent = await api.createPaymentIntent(applicationId, applicantId, intentKey);
      const verifyKey = newIdempotencyKey('payverify');
      const verified = await api.verifyPayment(intent.data.paymentId, applicantId, verifyKey);
      setPayment({
        id: intent.data.paymentId,
        amount: intent.data.amount,
        status: verified.data.status,
      });
      if (verified.data.status === 'CONFIRMED') setStep(6);
    } catch (err) {
      handle(err);
    } finally {
      setBusy(false);
    }
  }

  async function finalize() {
    setBusy(true);
    try {
      // 같은 행동에는 같은 키. 재시도해도 중복 접수가 되지 않는다.
      const key = newIdempotencyKey('finalize');
      const { data } = await api.finalize(applicationId, applicantId, key);
      setSubmission(data);
      await reload();
    } catch (err) {
      handle(err);
    } finally {
      setBusy(false);
    }
  }

  function handle(err: unknown) {
    if (err instanceof NetworkError) {
      setFailure({ title: '서버에 연결할 수 없습니다' });
      return;
    }
    if (err instanceof ApiError) {
      // 422 는 업무 검증 실패. 오류 요약으로 보여준다.
      if (err.httpStatus === 422 || err.httpStatus === 400) {
        setIssues([{ path: '', message: err.problem.detail ?? err.problem.title }]);
        return;
      }
      setFailure({ title: err.problem.title, traceId: err.problem.traceId });
      return;
    }
    setFailure({ title: '알 수 없는 오류가 발생했습니다' });
  }

  if (failure) {
    return (
      <FailureNotice
        title={failure.title}
        {...(failure.traceId ? { traceId: failure.traceId } : {})}
        lastSavedAt={app?.lastSavedAt ?? null}
        onRecheck={() => void recheck()}
      >
        {selfCheck && (
          <Alert tone="info" title="서버가 확인한 현재 상태">
            {selfCheck.application.summary}
          </Alert>
        )}
      </FailureNotice>
    );
  }

  return (
    <>
      <Breadcrumb
        trail={[
          { label: '홈', href: '/' },
          { label: '원서접수' },
          { label: STEPS[step - 1]!.label },
        ]}
      />
      <h1 style={{ fontSize: 'var(--krds-text-2xl)', marginTop: 0 }}>원서 작성</h1>

      <DeadlineBanner deadline={deadline} />
      <div style={{ margin: 'var(--krds-space-3) 0' }}>
        <SaveStatus state={autosave.state} onRetry={() => void autosave.saveNow()} />
      </div>

      <StepIndicator current={step} />
      <ErrorSummary issues={issues} />

      {step === 1 && (
        <Card title="1. 공통정보">
          <p style={{ marginTop: 0, color: 'var(--krds-fg-muted)', fontSize: 'var(--krds-text-sm)' }}>
            공통원서에서 가져온 정보입니다. 동의하신 항목만 이 대학으로 전달됩니다.
          </p>
          <Field
            label="출신 고등학교"
            value={fields.highSchool ?? ''}
            onChange={(v) => update('highSchool', v)}
            hint="학력 확인을 위해 수집합니다."
            required
            maxLength={100}
          />
          <Field
            label="졸업(예정) 연도"
            value={fields.graduationYear ?? ''}
            onChange={(v) => update('graduationYear', v)}
            hint="지원 자격 확인을 위해 수집합니다. 예: 2027"
            type="number"
            required
          />
          <Button onClick={() => setStep(2)}>다음 단계</Button>
        </Card>
      )}

      {step === 2 && app && (
        <Card title="2. 대학·전형">
          <DescriptionList
            items={[
              ['대학', '원서로대학교'],
              ['전형', '학생부종합전형'],
              ['모집단위', '컴퓨터공학과'],
              ['전형료', '55,000원'],
            ]}
          />
          <Alert tone="info" title="전형을 바꾸면 필요한 서류와 전형료가 달라집니다">
            이미 작성한 추가정보는 전형에 따라 다시 입력해야 할 수 있습니다.
          </Alert>
          <div style={{ display: 'flex', gap: 'var(--krds-space-3)' }}>
            <Button variant="secondary" onClick={() => setStep(1)}>
              이전
            </Button>
            <Button onClick={() => setStep(3)}>다음 단계</Button>
          </div>
        </Card>
      )}

      {step === 3 && (
        <Card title="3. 추가정보">
          <p style={{ marginTop: 0, color: 'var(--krds-fg-muted)', fontSize: 'var(--krds-text-sm)' }}>
            이 대학이 추가로 요구하는 항목입니다. 대학마다 다릅니다.
          </p>
          <Field
            label="자기소개"
            value={fields.selfIntro ?? ''}
            onChange={(v) => update('selfIntro', v)}
            hint="지원 동기와 학업 계획을 작성해 주십시오. 10자 이상."
            required
            multiline
            maxLength={1500}
          />
          <Field
            label="내신 성적 (선택)"
            value={fields.gpa ?? ''}
            onChange={(v) => update('gpa', v)}
            hint="0 이상 5 이하"
            type="number"
          />
          <div style={{ display: 'flex', gap: 'var(--krds-space-3)' }}>
            <Button variant="secondary" onClick={() => setStep(2)}>
              이전
            </Button>
            <Button onClick={() => setStep(4)}>다음 단계</Button>
          </div>
        </Card>
      )}

      {step === 4 && (
        <Card title="4. 서류">
          <Alert tone="info" title="서류는 검사를 통과해야 접수에 사용됩니다">
            업로드 후 악성코드 검사가 진행됩니다. 검사 완료 전에는 접수가 완료되지 않습니다.
          </Alert>
          <p style={{ fontSize: 'var(--krds-text-sm)', color: 'var(--krds-fg-muted)' }}>
            M2 데모에서는 서류 업로드 화면을 생략합니다. 업로드 API 는 구현되어 있으며
            <code> POST /api/v1/applications/{'{id}'}/documents/upload-intents </code>
            로 호출합니다.
          </p>
          <div style={{ display: 'flex', gap: 'var(--krds-space-3)' }}>
            <Button variant="secondary" onClick={() => setStep(3)}>
              이전
            </Button>
            <Button onClick={() => void runValidate()} disabled={busy}>
              {busy ? '검증 중…' : '검토 단계로'}
            </Button>
          </div>
        </Card>
      )}

      {step === 5 && app && (
        <Card title="5. 검토·결제">
          <DescriptionList
            items={[
              ['출신 고등학교', fields.highSchool || '-'],
              ['졸업 연도', fields.graduationYear || '-'],
              ['자기소개', (fields.selfIntro || '-').slice(0, 40) + '…'],
              ['전형료', '55,000원'],
              ['결제 상태', payment?.status ?? '결제 전'],
            ]}
          />
          {payment && payment.status !== 'CONFIRMED' && (
            <Alert tone="warning" title="결제 확인 중입니다">
              다시 결제하지 마시고 잠시 후 상태를 확인해 주십시오.
            </Alert>
          )}
          <div style={{ display: 'flex', gap: 'var(--krds-space-3)', marginTop: 'var(--krds-space-4)' }}>
            <Button variant="secondary" onClick={() => setStep(4)}>
              이전
            </Button>
            <Button onClick={() => void pay()} disabled={busy}>
              {busy ? '결제 처리 중…' : '전형료 결제'}
            </Button>
          </div>
        </Card>
      )}

      {step === 6 && (
        <Card title={submission ? '접수 완료' : '6. 최종제출'}>
          {submission ? (
            <>
              <Alert tone="success" title="접수가 완료되었습니다">
                추가로 하실 일은 없습니다.
              </Alert>
              <DescriptionList
                items={[
                  [
                    '접수번호',
                    <strong key="n" style={{ fontSize: 'var(--krds-text-lg)' }}>
                      {submission.applicationNumber}
                    </strong>,
                  ],
                  ['접수 시각', formatKst(submission.finalizedAt)],
                  ['적용 마감정책', submission.deadlinePolicyVersion],
                ]}
              />
              {/* 중앙 동기화 지연은 접수완료 여부와 분리해 표시한다. (v1.1 §07) */}
              {selfCheck && selfCheck.centralSync.pending > 0 && (
                <Alert tone="info" title="통합 조회 반영이 지연되고 있습니다">
                  {selfCheck.centralSync.guidance}
                </Alert>
              )}
              <Button variant="secondary" onClick={() => void recheck()}>
                현재 상태 다시 확인
              </Button>
            </>
          ) : (
            <>
              {/* 복구 불가능한 동작 직전에 필요한 정보를 전부 보여준다. (§07) */}
              <DescriptionList
                items={[
                  ['현재 서버 시각', formatKst(app?.serverTime ?? null)],
                  ['마감 시각', formatKst(app?.deadlineAt ?? null)],
                  ['결제 검증 상태', payment?.status ?? '확인 필요'],
                  ['제출 후 수정', '불가능합니다'],
                  ['환불', '대학 환불 규정에 따릅니다'],
                ]}
              />
              <Alert tone="warning" title="제출하면 되돌릴 수 없습니다">
                제출 후에는 원서를 수정할 수 없습니다. 위 내용을 확인해 주십시오.
              </Alert>
              <div style={{ display: 'flex', gap: 'var(--krds-space-3)' }}>
                <Button variant="secondary" onClick={() => setStep(5)}>
                  이전
                </Button>
                <Button onClick={() => void finalize()} disabled={busy || deadline.passed}>
                  {busy ? '접수 처리 중…' : '최종 제출'}
                </Button>
              </div>
            </>
          )}
        </Card>
      )}
    </>
  );
}

/** 서버 스키마가 숫자를 요구하는 필드는 숫자로 바꿔 보낸다. */
function coerce(fields: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === '') continue;
    out[k] = k === 'graduationYear' || k === 'gpa' ? Number(v) : v;
  }
  return out;
}
