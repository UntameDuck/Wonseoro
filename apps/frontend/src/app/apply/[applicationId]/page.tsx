'use client';

import { use, useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, DescriptionList, ErrorSummary, Field, fieldOf, cycleTitle } from '@wonseoro/krds';
import { PROBLEM_TEXT, problemText } from '@wonseoro/contracts';
import { SchemaForm, type JsonSchema } from '../../../krds/schema-form';
import { DocumentStatusList, FileUpload } from '../../../krds/file-upload';
import { Breadcrumb, STEPS, StepIndicator, type StepNo } from '../../../krds/navigation';
import { DeadlineBanner, FailureNotice, OperatingModeBanner, SaveStatus, SlowNotice } from '../../../krds/status';
import {
  ApiError,
  NetworkError,
  type Application,
  type DocumentSpec,
  type SelfCheck,
  type Submission,
  api,
  newIdempotencyKey,
} from '../../../lib/api';
import { useAutosave } from '../../../lib/use-autosave';
import { formatKst, useDeadline } from '../../../lib/use-deadline';
import { lastSavedHere, loadSession } from '../../../lib/session';
import { useOperatingMode } from '../../../lib/use-operating-mode';

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
  const [failure, setFailure] = useState<{ title: string; detail?: string; traceId?: string } | null>(null);
  /**
   * 오류가 아닌 안내 — 결제 진행 중·환불 안내. 전에는 오류 요약("입력을 확인해 주십시오")에 넣어
   * 빨간 오류처럼 보였다 (T-M5-52, U-25).
   */
  const [notice, setNotice] = useState<{ tone: 'info' | 'warning'; title: string; body?: string } | null>(null);
  const [selfCheck, setSelfCheck] = useState<SelfCheck | null>(null);
  const [payment, setPayment] = useState<{ id: string; amount: number; status: string } | null>(
    null,
  );
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [busy, setBusy] = useState(false);
  /** 서버가 준 추가문항 스키마. 화면은 이걸 보고 필드를 그린다. (v1.1 §A5) */
  const [schema, setSchema] = useState<JsonSchema | null>(null);
  /** 공통원서에서 온 항목(1단계)과 이 전형이 받는 서류(4단계). 둘 다 대학 설정에서 온다. (D-56) */
  const [profileFields, setProfileFields] = useState<string[]>([]);
  const [documents, setDocuments] = useState<DocumentSpec[]>([]);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  /** 결제 전 확인 체크 (U-55) */
  const [payConfirmed, setPayConfirmed] = useState(false);
  /** 검증할 때마다 오류 요약을 새로 그려 포커스를 다시 받게 한다 (T-M5-40) */
  const [validationRun, setValidationRun] = useState(0);
  /**
   * 그린 뒤 포커스할 곳. 단계를 옮기거나 취소 칸을 열고 닫으면 누른 버튼이 사라진다 — 그대로 두면 포커스가
   * 문서 처음으로 떨어져 키보드 사용자가 머리글부터 다시 Tab 해야 한다 (T-M5-40).
   */
  const focusNext = useRef<string | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  const focusAfterRender = useCallback((id: string) => {
    focusNext.current = id;
    setFocusTick((n) => n + 1);
  }, []);
  useEffect(() => {
    const id = focusNext.current;
    if (!id) return;
    focusNext.current = null;
    document.getElementById(id)?.focus();
  }, [focusTick]);
  /** 전형·모집단위·전형료는 대학 설정이 기준이다. 화면에 박지 않는다. (v1.1 §10 §1) */
  const [catalog, setCatalog] = useState<{
    universityName: string;
    cycleName: string;
    typeName: string;
    departmentName: string;
    feeAmount: number;
  } | null>(null);

  // 원서를 불러오기 전에는 전형을 모른다. 그때는 마감을 판단하지 않는다.
  const deadline = useDeadline(app?.cycleId ?? null);
  const operatingMode = useOperatingMode();
  /**
   * 고칠 수 있는 원서인가. 결제를 시작하면(PAYMENT_PENDING) 더 고칠 수 없다 — 결제가 곧 제출이라
   * 결제 전 확인을 통과한 내용 그대로 접수된다. 서버도 거절한다. (D-42 · D-55)
   */
  const editable = app?.status === 'DRAFT' || app?.status === 'READY';
  const frozen = app !== null && !editable;
  /** 결제가 진행 중이거나 확인된 원서 — "결제하기" 대신 "결제 상태 다시 확인" 을 보인다. */
  const paymentStarted = app?.status === 'PAYMENT_PENDING' || app?.status === 'PAID';

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
      const res = await api.getApplication(applicationId, applicantId);
      setApp(res.data);
      setEtag(res.etag);
      setFields(
        Object.fromEntries(
          Object.entries(res.data.fields).map(([k, v]) => [k, v === null ? '' : String(v)]),
        ),
      );
      setFailure(null);
      if (res.data.status === 'FINALIZED') {
        const sub = await api.submission(applicationId, applicantId).catch(() => null);
        if (sub) setSubmission(sub.data);
        setStep(6);
      } else if (res.data.status === 'PAYMENT_PENDING' || res.data.status === 'PAID') {
        // 결제를 시작한 원서다. 새로고침·재접속으로 결제 상태를 잃으면 지원자가 다시 결제한다 —
        // 서버가 아는 결제를 되살린다 (재결제 방지, §B4).
        const check = await api.selfCheck(applicationId, applicantId).catch(() => null);
        if (check) {
          setSelfCheck(check.data);
          const p = check.data.payment;
          if (p.exists && p.paymentId) {
            setPayment({ id: p.paymentId, amount: p.amount ?? 0, status: p.status ?? 'UNKNOWN' });
          }
        }
        setStep(5);
      }
    } catch (err) {
      setFailure({
        title:
          err instanceof NetworkError
            ? '대학 접수 서버에 연결할 수 없습니다'
            : problemText(err instanceof ApiError ? err.problem : null).title,
        // 연결이 끊겨도 요청번호는 화면이 만들어 보냈으니 남아 있다 (U-8)
        ...(err instanceof ApiError
          ? { traceId: err.problem.traceId }
          : err instanceof NetworkError && err.traceId
            ? { traceId: err.traceId }
            : {}),
      });
    }
  }, [applicationId, applicantId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // 단계가 바뀌면 탭 제목도 바뀐다 — "검토·결제 — 원서 작성 | 원서로" (T-M5-55)
  useEffect(() => {
    document.title = `${STEPS[step - 1]!.label} — 원서 작성 | 원서로`;
  }, [step]);

  // 전형·모집단위 정보를 대학 API 에서 읽는다.
  useEffect(() => {
    if (!app) return;
    void (async () => {
      try {
        const [cycle, types, depts] = await Promise.all([
          api.currentCycle(),
          api.admissionTypes(app.cycleId),
          api.departments(app.cycleId),
        ]);
        const t = types.data.find((x) => x.id === app.admissionTypeId);
        const d = depts.data.find((x) => x.id === app.departmentId);
        setCatalog({
          universityName: cycle.data.universityName ?? '대학 정보 확인 중',
          cycleName: cycleTitle(cycle.data.admissionYear, cycle.data.name),
          typeName: t?.name ?? '-',
          departmentName: d?.name ?? '-',
          feeAmount: t?.feeAmount ?? 0,
        });
      } catch {
        setCatalog(null);
      }
    })();
  }, [app]);

  // 스키마는 원서와 별개로 받는다. Config 가 바뀌면 값도 바뀐다.
  useEffect(() => {
    void api
      .formSchema(applicationId, applicantId)
      .then(({ data }) => {
        setSchema(data.schema as JsonSchema);
        setProfileFields(data.profileFields ?? []);
        setDocuments(data.documents ?? []);
      })
      .catch(() => setSchema(null));
  }, [applicationId, applicantId]);

  /**
   * 어떤 필드를 어느 단계에 보여줄지.
   * 공통원서에서 넘어오는 항목(설정의 `x-profile`)은 1단계, 나머지는 3단계다.
   * 스키마에 없는 필드는 어느 단계에도 나타나지 않는다. 필드명을 화면에 박지 않는다.
   */
  const commonCodes = Object.keys(schema?.properties ?? {}).filter((c) => profileFields.includes(c));
  const extraCodes = Object.keys(schema?.properties ?? {}).filter((c) => !profileFields.includes(c));
  /** 칸 옆에 붙일 오류 — 오류 요약과 같은 문장이다. */
  const fieldErrors = Object.fromEntries(
    issues.filter((i) => fieldOf(i.path)).map((i) => [fieldOf(i.path), i.message]),
  );
  const documentLabel = (type: string) => documents.find((d) => d.documentType === type)?.label ?? type;

  /** 서류 검사 상태를 다시 읽는다. self-check 가 상태와 안내문구를 함께 준다. */
  const refreshDocuments = useCallback(async () => {
    const res = await api.selfCheck(applicationId, applicantId).catch(() => null);
    if (res) setSelfCheck(res.data);
  }, [applicationId, applicantId]);

  // 4·5단계에 들어갈 때 서류 검사 상태를 읽는다.
  useEffect(() => {
    if (step === 4 || step === 5) void refreshDocuments();
  }, [step, refreshDocuments]);
  // 검사 중인 서류가 있으면 3초마다 다시 읽는다(최대 2분) — 지원자가 새로고침을 누르지 않아도 "검사 완료" 로 바뀐다 (U-5)
  const scanning = (selfCheck?.documents ?? []).some((d) => d.status === 'QUARANTINED' || d.status === 'UPLOADING');
  useEffect(() => {
    if (step !== 4 || !scanning) return;
    let tries = 0;
    const t = setInterval(() => {
      tries += 1;
      if (tries > 40) clearInterval(t);
      else void refreshDocuments();
    }, 3000);
    return () => clearInterval(t);
  }, [step, scanning, refreshDocuments]);

  const recheck = useCallback(async () => {
    const res = await api.selfCheck(applicationId, applicantId).catch(() => null);
    if (res) setSelfCheck(res.data);
    await reload();
  }, [applicationId, applicantId, reload]);

  /**
   * 단계를 옮긴다. 칸에 매이지 않은 오류와 안내는 그 단계의 것이라 지운다. 칸 오류는 고칠 때까지 남는다 —
   * 오류 요약의 링크가 그 칸으로 데려간다 (T-M5-52, U-2).
   */
  function goTo(next: StepNo, focusId = STEP_TITLE_ID) {
    setStep(next);
    setIssues((prev) => prev.filter((i) => fieldOf(i.path)));
    setNotice(null);
    focusAfterRender(focusId);
  }

  /** 오류 요약에서 누른 칸으로 간다 — 공통원서 항목은 1단계, 나머지는 3단계에 있다. */
  function selectIssue(path: string) {
    const code = fieldOf(path);
    // 단계를 그린 뒤에 그 칸에 포커스한다
    goTo(commonCodes.includes(code) ? 1 : 3, `field-${code}`);
  }

  function update(code: string, value: string) {
    const next = { ...fields, [code]: value };
    setFields(next);
    // 작성 완료 뒤에 고치면 서버가 작성 중(DRAFT)으로 되돌린다 — 화면도 같이 (U-3)
    setApp((prev) => (prev && prev.status === 'READY' ? { ...prev, status: 'DRAFT' } : prev));
    // 고친 칸의 오류는 다음 검증을 기다리지 않고 지운다 (U-2)
    setIssues((prev) => prev.filter((i) => fieldOf(i.path) !== code));
    // 숫자 필드는 서버 스키마가 integer 를 요구한다.
    autosave.schedule(coerce(next, schema));
  }

  async function runValidate() {
    setBusy(true);
    try {
      await autosave.saveNow();
      const res = await api.validate(applicationId, applicantId);
      // 통과하면 서버가 원서를 작성 완료(READY)로 옮기고 버전이 오른다. 새 ETag 로 이어서 저장한다.
      if (res.etag) setEtag(res.etag);
      setIssues(res.data.issues);
      setValidationRun((n) => n + 1);
      // 통과하면 서버가 원서를 작성 완료(READY)로 옮긴다 — 화면이 아는 상태도 맞춘다(단계 표시 ✓, U-3)
      if (res.data.valid) {
        setApp((prev) => (prev && prev.status === 'DRAFT' ? { ...prev, status: 'READY' } : prev));
        setStep(5);
        focusAfterRender(STEP_TITLE_ID);
      }
    } catch (err) {
      handle(err);
    } finally {
      setBusy(false);
    }
  }

  /** 서버가 아는 결제를 다시 읽는다. 새 결제를 만들지 않는다. */
  async function restorePayment() {
    const check = await api.selfCheck(applicationId, applicantId).catch(() => null);
    if (!check) return;
    setSelfCheck(check.data);
    const p = check.data.payment;
    if (p.exists && p.paymentId) setPayment({ id: p.paymentId, amount: p.amount ?? 0, status: p.status ?? 'UNKNOWN' });
  }

  async function pay() {
    setBusy(true);
    try {
      // 이미 시작한 결제가 있으면 **그 결제**를 다시 확인한다. 새 결제창을 열지 않는다 (§B4).
      // 서버도 한 원서에 결제를 하나만 두지만(열린 결제창 재사용·확인 중이면 409), 화면이 먼저 지킨다.
      let current = payment && payment.status !== 'FAILED' && payment.status !== 'CANCELLED' ? payment : null;
      if (!current) {
        const intent = await api.createPaymentIntent(applicationId, applicantId, newIdempotencyKey('payintent'));
        current = { id: intent.data.paymentId, amount: intent.data.amount, status: 'CREATED' };
      }
      const verifyKey = newIdempotencyKey('payverify');
      const verified = await api.verifyPayment(current.id, applicantId, verifyKey);
      setPayment({ ...current, status: verified.data.status });
      if (verified.data.status === 'CONFIRMED') {
        // 결제가 확인되면 서버가 이미 접수했다 (D-42). 같은 제출 경로로 결과만 받는다 —
        // 이미 접수된 원서면 그 접수를 그대로 돌려준다. 서버 쪽 자동 접수가 실패했으면 여기서 다시 시도된다.
        const { data } = await api.finalize(applicationId, applicantId, newIdempotencyKey('finalize'));
        setSubmission(data);
        await reload();
        setStep(6);
        focusAfterRender(STEP_TITLE_ID);
      } else {
        // 결제를 시작했다 — 원서는 이제 고칠 수 없다(PAYMENT_PENDING). 화면을 서버 상태에 맞춘다.
        await reload();
      }
    } catch (err) {
      if (err instanceof ApiError && err.problem.code === 'PAYMENT_IN_PROGRESS') {
        // 이미 확인 중이거나 확인된 결제가 있다. 다시 결제하지 않게 그 결제를 보여 준다.
        await restorePayment();
        const t = problemText(err.problem);
        setNotice({ tone: 'warning', title: t.title, body: t.detail });
      } else {
        handle(err);
      }
    } finally {
      setBusy(false);
    }
  }

  /** 접수 전 취소 (D-7). 결제가 확인된 원서면 대학이 환불을 처리한다 — 자동으로 돈을 움직이지 않는다. */
  async function cancel() {
    setBusy(true);
    try {
      const { data } = await api.cancel(applicationId, cancelReason, applicantId, newIdempotencyKey('cancel'));
      setCancelOpen(false);
      setIssues([]);
      await reload();
      focusAfterRender(CANCELLED_TITLE_ID);
      if (data.refundRequired) {
        setNotice({
          tone: 'info',
          title: '확인된 전형료는 대학이 환불 절차를 안내합니다',
          body: '자동으로 환불되지 않습니다. 입학처의 안내를 확인해 주십시오.',
        });
      }
    } catch (err) {
      handle(err);
    } finally {
      setBusy(false);
    }
  }

  function handle(err: unknown) {
    if (err instanceof NetworkError) {
      setFailure({
        title: '서버에 연결할 수 없습니다',
        detail: '인터넷 연결을 확인한 뒤 현재 상태를 다시 확인해 주십시오.',
        ...(err.traceId ? { traceId: err.traceId } : {}),
      });
      return;
    }
    if (err instanceof ApiError) {
      // 서버 문구를 그대로 보이지 않는다 — 오류 code 의 문구(PROBLEM_TEXT). 업무 오류만 서버 설명을 덧붙인다 (U-26)
      const t = problemText(err.problem);
      // 422·400 은 업무 검증 실패. 오류 요약으로 보여준다.
      if (err.httpStatus === 422 || err.httpStatus === 400) {
        setIssues([{ path: '', message: t.detail }]);
        setValidationRun((n) => n + 1);
        return;
      }
      setFailure({ title: t.title, detail: t.detail, traceId: err.problem.traceId });
      return;
    }
    setFailure({ title: PROBLEM_TEXT.INTERNAL.title, detail: PROBLEM_TEXT.INTERNAL.detail });
  }

  if (failure) {
    return (
      <>
        {/* 화면마다 큰 제목은 하나 — 장애 안내만 남아도 어느 화면인지 말한다 (T-M5-42) */}
        <h1 style={{ fontSize: 'var(--krds-text-2xl)', marginTop: 0 }}>원서 작성</h1>
        <FailureNotice
          title={failure.title}
          {...(failure.detail ? { detail: failure.detail } : {})}
          {...(failure.traceId ? { traceId: failure.traceId } : {})}
          lastSavedAt={app?.lastSavedAt ?? null}
          savedHere={lastSavedHere(applicationId)}
          serverState={selfCheck?.application.summary ?? null}
          onRecheck={() => void recheck()}
        />
      </>
    );
  }

  if (app?.status === 'CANCELLED') {
    return (
      <Card title="취소된 원서입니다" titleId={CANCELLED_TITLE_ID} titleLevel={1}>
        {notice && <Alert tone={notice.tone} title={notice.title}>{notice.body}</Alert>}
        <p style={{ marginTop: 0 }}>
          이 원서는 접수 전에 취소되었습니다. 같은 전형에 다시 지원하려면 접수 홈에서 새 원서를 만드십시오.
        </p>
        <a href="/" style={{ color: 'var(--krds-primary)' }}>
          접수 홈으로
        </a>
      </Card>
    );
  }

  /**
   * ✓ 를 붙일 단계. 서버 검증을 통과한 원서(작성 완료 이후)면 지나간 단계가 모두 끝난 것이고, 작성 중이면
   * 입력할 것이 없는 2단계(대학·전형)만 끝났다고 본다. 접수 완료면 전부 (U-3).
   */
  const verified = app !== null && ['READY', 'PAYMENT_PENDING', 'PAID', 'FINALIZED'].includes(app.status);
  const completedSteps: number[] =
    app?.status === 'FINALIZED'
      ? [1, 2, 3, 4, 5, 6]
      : verified
        ? STEPS.map((s) => s.no).filter((n) => n < step)
        : step > 2
          ? [2]
          : [];

  /** 접수 전이면 취소할 수 있다 (D-7). 접수가 끝난 원서는 입학처로 안내한다. */
  const cancellable = app !== null && ['DRAFT', 'READY', 'PAYMENT_PENDING', 'PAID'].includes(app.status);

  return (
    <>
      <Breadcrumb
        // 와이어프레임 "홈 › 2027 수시 › A대학교" — 어느 모집·대학의 원서인지 늘 보인다 (U-58)
        trail={[
          { label: '홈', href: '/' },
          { label: catalog?.cycleName ?? '원서접수' },
          ...(catalog ? [{ label: catalog.universityName }] : []),
          { label: STEPS[step - 1]!.label },
        ]}
      />
      <h1 style={{ fontSize: 'var(--krds-text-2xl)', marginTop: 0 }}>원서 작성</h1>

      <DeadlineBanner deadline={deadline} />
      <OperatingModeBanner view={operatingMode} />
      <div style={{ margin: 'var(--krds-space-3) 0' }}>
        <SaveStatus state={autosave.state} onRetry={() => void autosave.saveNow()} />
      </div>

      <StepIndicator current={step} completed={completedSteps} />
      <ErrorSummary key={validationRun} issues={issues} onSelect={selectIssue} />
      <SlowNotice busy={busy} />
      {notice && <Alert tone={notice.tone} title={notice.title} focusKey={notice}>{notice.body}</Alert>}

      {step === 1 && (
        <Card title="1. 공통정보" titleId={STEP_TITLE_ID}>
          <p style={{ marginTop: 0, color: 'var(--krds-fg-muted)', fontSize: 'var(--krds-text-sm)' }}>
            공통원서에서 가져온 정보입니다. 동의하신 항목만 이 대학으로 전달됩니다.
          </p>
          <SchemaForm
            schema={schema}
            values={fields}
            onChange={update}
            only={commonCodes}
            errors={fieldErrors}
            readOnly={!editable}
          />
          {commonCodes.length === 0 && (
            <p style={{ color: 'var(--krds-fg-muted)', fontSize: 'var(--krds-text-sm)' }}>
              이 전형은 공통원서에서 가져오는 항목이 없습니다.{' '}
              <a href="/profile" style={{ color: 'var(--krds-primary)' }}>
                공통원서 작성
              </a>
            </p>
          )}
          <Button onClick={() => goTo(2)}>다음 단계</Button>
        </Card>
      )}

      {step === 2 && app && (
        <Card title="2. 대학·전형" titleId={STEP_TITLE_ID}>
          <DescriptionList
            items={[
              ['대학', catalog?.universityName ?? '불러오는 중…'],
              ['전형', catalog?.typeName ?? '불러오는 중…'],
              ['모집단위', catalog?.departmentName ?? '불러오는 중…'],
              [
                '전형료',
                catalog ? `${catalog.feeAmount.toLocaleString('ko-KR')}원` : '불러오는 중…',
              ],
            ]}
          />
          <Alert tone="info" title="전형을 바꾸면 필요한 서류와 전형료가 달라집니다">
            추가로 입력해야 하는 항목도 전형마다 다릅니다.
          </Alert>
          <div style={{ display: 'flex', gap: 'var(--krds-space-3)' }}>
            <Button variant="secondary" onClick={() => goTo(1)}>
              이전
            </Button>
            <Button onClick={() => goTo(3)}>다음 단계</Button>
          </div>
        </Card>
      )}

      {step === 3 && (
        <Card title="3. 추가정보" titleId={STEP_TITLE_ID}>
          <p style={{ marginTop: 0, color: 'var(--krds-fg-muted)', fontSize: 'var(--krds-text-sm)' }}>
            이 대학이 추가로 요구하는 항목입니다. 대학·전형마다 다릅니다.
          </p>
          <SchemaForm
            schema={schema}
            values={fields}
            onChange={update}
            only={extraCodes}
            errors={fieldErrors}
            readOnly={!editable}
          />
          <div style={{ display: 'flex', gap: 'var(--krds-space-3)' }}>
            <Button variant="secondary" onClick={() => goTo(2)}>
              이전
            </Button>
            <Button onClick={() => goTo(4)}>다음 단계</Button>
          </div>
        </Card>
      )}

      {step === 4 && (
        <Card title="4. 서류" titleId={STEP_TITLE_ID}>
          <Alert tone="info" title="서류는 검사를 통과해야 접수에 사용됩니다">
            올리신 파일은 악성코드 검사를 거칩니다. 검사 중에는 접수가 완료되지 않습니다.
          </Alert>

          {/* 올릴 서류는 대학 설정이 정한다. 화면에 서류 종류를 박지 않는다. (§A5, D-56) */}
          {documents.length === 0 && (
            <Alert tone="info" title="이 전형은 제출 서류가 없습니다" />
          )}
          {editable &&
            documents.map((d) => (
              <FileUpload
                key={d.documentType}
                applicationId={applicationId}
                applicantId={applicantId}
                documentType={d.documentType}
                label={`${d.label}${d.required ? ' (필수)' : ' (선택)'}`}
                scan={(selfCheck?.documents ?? []).filter((x) => x.documentType === d.documentType).at(-1)?.status}
                onUploaded={() => void refreshDocuments()}
              />
            ))}

          <h3 style={{ fontSize: 'var(--krds-text-base)' }}>올린 서류</h3>
          <DocumentStatusList
            documents={(selfCheck?.documents ?? []).map((d) => ({ ...d, documentType: documentLabel(d.documentType) }))}
          />

          <div
            style={{ display: 'flex', gap: 'var(--krds-space-3)', marginTop: 'var(--krds-space-4)' }}
          >
            <Button variant="secondary" onClick={() => goTo(3)}>
              이전
            </Button>
            <Button variant="secondary" onClick={() => void refreshDocuments()}>
              검사 상태 새로고침
            </Button>
            {editable ? (
              <Button onClick={() => void runValidate()} disabled={busy}>
                {busy ? '검증 중…' : '검토 단계로'}
              </Button>
            ) : (
              <Button onClick={() => goTo(5)}>검토 단계로</Button>
            )}
          </div>
        </Card>
      )}

      {step === 5 && app && (
        <Card title="5. 검토·결제" titleId={STEP_TITLE_ID}>
          <DescriptionList
            items={[
              ['대학·전형', `${catalog?.universityName ?? '-'} · ${catalog?.typeName ?? '-'}`],
              ['모집단위', catalog?.departmentName ?? '-'],
              [
                '입력 항목',
                issues.length === 0 ? '누락 없음' : `${issues.length}건 확인 필요`,
              ],
              [
                '서류',
                (selfCheck?.documents ?? []).length === 0
                  ? '올린 서류 없음'
                  : (selfCheck?.documents ?? [])
                      .map((d) => `${documentLabel(d.documentType)} ${d.guidance}`)
                      .join(', '),
              ],
              [
                '전형료',
                catalog ? `${catalog.feeAmount.toLocaleString('ko-KR')}원` : '-',
              ],
              ['결제 상태', payment ? (PAYMENT_LABEL[payment.status] ?? '결제 확인 중') : '결제 전'],
              ...(selfCheck?.payment.requestedAt
                ? ([['결제 요청 시각', formatKst(selfCheck.payment.requestedAt)]] as Array<[string, string]>)
                : []),
              ['현재 서버 시각', formatKst(app?.serverTime ?? null)],
              ['마감 시각', formatKst(app?.deadlineAt ?? null)],
              ['결제 후 수정·취소', '불가능합니다'],
            ]}
          />
          {/* 결제가 곧 제출이다 (D-42). 복구 불가능한 동작 직전에 알린다. (§07) */}
          {!payment && (
            <Alert tone="warning" title="결제가 확인되면 바로 접수가 완료됩니다">
              전형료 결제가 확인되는 즉시 원서가 접수되며, 이후에는 원서를 수정하거나 취소할 수
              없습니다. 위 내용을 확인한 뒤 결제해 주십시오.
            </Alert>
          )}
          {payment && payment.status !== 'CONFIRMED' && (
            <Alert tone="warning" title="결제 확인 중입니다">
              다시 결제하지 마십시오. 결제가 확인되면 원서는 자동으로 접수됩니다. 이 화면을 닫아도
              됩니다 — 잠시 후 상태를 확인해 주십시오. 마감 전에 결제를 요청하셨다면 확인이 마감 뒤에
              끝나더라도 대학의 마감 판정 기준에 따라 처리됩니다.
            </Alert>
          )}
          {/* 되돌릴 수 없는 동작 직전의 확인 — 와이어프레임 검토·결제 화면 (U-55) */}
          {!paymentStarted && !payment && (
            <label style={{ display: 'flex', gap: 'var(--krds-space-2)', alignItems: 'flex-start', margin: 'var(--krds-space-4) 0 0' }}>
              <input
                type="checkbox"
                checked={payConfirmed}
                onChange={(e) => setPayConfirmed(e.target.checked)}
                style={{ width: 20, height: 20, marginTop: 2 }}
              />
              <span>결제 후에는 원서를 수정하거나 취소할 수 없다는 것을 확인했습니다.</span>
            </label>
          )}
          <div
            style={{ display: 'flex', gap: 'var(--krds-space-3)', marginTop: 'var(--krds-space-4)' }}
          >
            <Button variant="secondary" onClick={() => goTo(4)}>
              이전
            </Button>
            <Button
              onClick={() => void pay()}
              disabled={busy || (deadline.passed && !paymentStarted) || (!paymentStarted && !payment && !payConfirmed)}
            >
              {busy
                ? '결제·접수 처리 중…'
                : paymentStarted || (payment && payment.status !== 'FAILED' && payment.status !== 'CANCELLED')
                  ? '결제 상태 다시 확인'
                  : '전형료 결제하고 접수'}
            </Button>
          </div>
        </Card>
      )}

      {step === 6 && (
        <Card title={submission ? '접수 완료' : '접수 결과를 불러오지 못했습니다'} titleId={STEP_TITLE_ID}>
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
                ]}
              />
              {/* 중앙 동기화 지연은 접수완료 여부와 분리해 표시한다. (v1.1 §07) */}
              {selfCheck && selfCheck.centralSync.pending > 0 && (
                <Alert tone="info" title="통합 조회 반영이 지연되고 있습니다">
                  {selfCheck.centralSync.guidance}
                </Alert>
              )}
              <div style={{ display: 'flex', gap: 'var(--krds-space-3)', flexWrap: 'wrap' }}>
                <a
                  href={`/receipt/${submission.submissionId}`}
                  style={{ color: 'var(--krds-primary)', alignSelf: 'center' }}
                >
                  접수증 보기·인쇄
                </a>
                <Button variant="secondary" onClick={() => void recheck()}>
                  현재 상태 다시 확인
                </Button>
              </div>
            </>
          ) : (
            <>
              {/*
                결제가 곧 접수다(D-42) — 여기에 오는 길은 "접수는 됐는데 접수 결과를 읽지 못한 경우" 뿐이다.
                전에는 이미 접수된 원서에 '최종 제출' 버튼을 보였다. 다시 제출하게 하지 않고 결과를 다시 읽는다 (U-27)
              */}
              <Alert tone="info" title="접수는 완료되었습니다">
                접수번호를 불러오는 데 실패했습니다. 다시 결제하거나 다시 제출하지 마십시오 — 아래 버튼으로 접수
                결과를 다시 불러올 수 있습니다.
              </Alert>
              <Button onClick={() => void recheck()} disabled={busy}>
                접수 결과 다시 불러오기
              </Button>
            </>
          )}
        </Card>
      )}

      {cancellable && step !== 6 && (
        <Card title="원서 취소">
          {!cancelOpen ? (
            <Button
              id={CANCEL_OPEN_ID}
              variant="secondary"
              onClick={() => {
                setCancelOpen(true);
                focusAfterRender(CANCEL_REASON_ID);
              }}
            >
              이 원서 취소하기
            </Button>
          ) : (
            <>
              <Alert tone="warning" title="취소하면 되돌릴 수 없습니다">
                {paymentStarted
                  ? '결제가 확인된 전형료는 대학이 환불 절차를 안내합니다. 자동으로 환불되지 않습니다.'
                  : '같은 전형에 다시 지원하려면 새 원서를 만들어야 합니다.'}
              </Alert>
              <Field
                id={CANCEL_REASON_ID}
                label="취소 사유"
                value={cancelReason}
                onChange={setCancelReason}
                hint="2~500자. 대학에만 기록되고 통합 조회에는 보내지 않습니다."
                maxLength={500}
                required
              />
              <div style={{ display: 'flex', gap: 'var(--krds-space-3)' }}>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setCancelOpen(false);
                    focusAfterRender(CANCEL_OPEN_ID);
                  }}
                >
                  그만두기
                </Button>
                <Button onClick={() => void cancel()} disabled={busy || cancelReason.trim().length < 2}>
                  {busy ? '취소 처리 중…' : '취소 확정'}
                </Button>
              </div>
            </>
          )}
        </Card>
      )}
    </>
  );
}

/** 포커스를 옮길 자리 (T-M5-40) */
const STEP_TITLE_ID = 'step-title';
const CANCELLED_TITLE_ID = 'cancelled-title';
const CANCEL_OPEN_ID = 'cancel-open';
const CANCEL_REASON_ID = 'cancel-reason';

/** 결제 상태를 지원자가 읽을 말로. 확인되지 않은 결제를 "실패" 로 보이게 하지 않는다 (§B4). */
const PAYMENT_LABEL: Record<string, string> = {
  CREATED: '결제창을 열었습니다 — 결제를 마치셨다면 상태를 다시 확인해 주십시오',
  PENDING: '결제 확인 중',
  UNKNOWN: '결제 확인 중 (결제사 응답 대기)',
  CONFIRMED: '결제 확인됨',
  FAILED: '결제되지 않았습니다 — 다시 결제하실 수 있습니다',
  CANCELLED: '결제가 취소되었습니다 — 다시 결제하실 수 있습니다',
  REFUNDED: '환불되었습니다',
};

/**
 * 서버 스키마가 숫자를 요구하는 필드는 숫자로 바꿔 보낸다.
 * **어느 필드가 숫자인지도 스키마에서 읽는다.** 필드명을 코드에 박지 않는다.
 */
function coerce(
  fields: Record<string, string>,
  schema: JsonSchema | null,
): Record<string, unknown> {
  const props = schema?.properties ?? {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === '') continue;
    const type = props[k]?.type;
    out[k] = type === 'integer' || type === 'number' ? Number(v) : v;
  }
  return out;
}
