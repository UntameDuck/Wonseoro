'use client';

import Link from 'next/link';
import { type ReactNode, use, useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, DescriptionList, Field } from '@wonseoro/krds';
import {
  PRIVACY_REQUEST_DETAIL_MAX,
  PRIVACY_REQUEST_KIND,
  PRIVACY_REQUEST_KIND_HELP,
  PRIVACY_REQUEST_KIND_LABEL,
  PRIVACY_REQUEST_STATUS_LABEL,
  problemText,
  type PrivacyRequestKind,
  type PrivacyRequestView,
} from '@wonseoro/contracts';
import { Breadcrumb } from '../../../krds/navigation';
import { ApiError, NetworkError, api, newIdempotencyKey } from '../../../lib/api';
import { loadSession } from '../../../lib/session';
import { formatKst } from '../../../lib/use-deadline';

/**
 * 개인정보 열람·정정·삭제·처리정지 요청 — 보호법 제35~37조 (문서 10 G-10, D-84)
 *
 * 원서는 대학이 처리자다 — 요청은 그 대학 서버에 남고 입학처가 받은 날부터 10일 안에 회신한다(콘솔 처리 큐).
 * 동의 철회(원서 1단계)·공통원서 삭제(공통원서 화면)처럼 바로 되는 것은 거기서 하고, 여기는 대학 판단이 필요한 요청이다.
 * 같은 종류의 처리 중 요청을 다시 보내면 서버가 앞 요청을 돌려준다 — 화면은 "이미 처리 중" 으로 알린다.
 */
export default function PrivacyRequestPage({ params }: { params: Promise<{ applicationId: string }> }) {
  const { applicationId } = use(params);
  const [applicantId, setApplicantId] = useState<string | null>(null);
  const [noSession, setNoSession] = useState(false);
  const [requests, setRequests] = useState<PrivacyRequestView[] | null>(null);
  const [dueDays, setDueDays] = useState(10);
  const [loadError, setLoadError] = useState<{ title: string; detail: string } | null>(null);
  const [universityName, setUniversityName] = useState<string | null>(null);

  const [kind, setKind] = useState<PrivacyRequestKind | ''>('');
  const [detail, setDetail] = useState('');
  const [errors, setErrors] = useState<{ kind?: string; detail?: string }>({});
  const [busy, setBusy] = useState(false);
  /** 같은 내용을 다시 보낼 때 같은 키 — 응답을 못 받아 다시 눌러도 요청이 둘이 되지 않는다 */
  const [key, setKey] = useState(() => newIdempotencyKey('privacy'));
  const [result, setResult] = useState<{ tone: 'success' | 'info' | 'danger'; title: string; body: string } | null>(null);

  const load = useCallback(async (who: string) => {
    setLoadError(null);
    try {
      const { data } = await api.privacyRequests(applicationId, who);
      setRequests(data.requests);
      setDueDays(data.dueDays);
    } catch (err) {
      setLoadError(
        err instanceof NetworkError
          ? { title: '대학 접수 서버에 연결할 수 없습니다', detail: '잠시 후 다시 시도해 주십시오. 보낸 요청이 사라진 것은 아닙니다.' }
          : problemText(err instanceof ApiError ? err.problem : null),
      );
    }
  }, [applicationId]);

  useEffect(() => {
    const session = loadSession();
    if (!session) {
      setNoSession(true);
      return;
    }
    setApplicantId(session.applicantId);
    void load(session.applicantId);
    void api.currentCycle().then((c) => setUniversityName(c.data.universityName ?? null), () => undefined);
  }, [load]);

  async function submit() {
    if (!applicantId) return;
    const next: { kind?: string; detail?: string } = {};
    if (!kind) next.kind = '요청 종류를 골라 주십시오.';
    if (kind === 'CORRECTION' && detail.trim() === '') next.detail = '무엇을 어떻게 바로잡을지 적어 주십시오.';
    setErrors(next);
    if (next.kind || next.detail || !kind) {
      document.getElementById(next.kind ? `kind-${PRIVACY_REQUEST_KIND[0]}` : 'privacy-detail')?.focus();
      return;
    }
    setBusy(true);
    try {
      const res = await api.createPrivacyRequest(applicationId, kind, detail.trim(), applicantId, key);
      const label = PRIVACY_REQUEST_KIND_LABEL[res.data.kind];
      setResult(
        res.status === 201
          ? {
              tone: 'success',
              title: `${label} 요청을 보냈습니다`,
              body: `요청번호 ${res.data.requestNumber}. 입학처가 ${formatKst(res.data.dueAt)}까지 결과를 알려 드립니다. 결과는 이 화면에서 확인하실 수 있습니다.`,
            }
          : {
              tone: 'info',
              title: `이미 처리 중인 ${label} 요청이 있습니다`,
              body: `요청번호 ${res.data.requestNumber}. 같은 요청을 다시 보내지 않아도 됩니다. 처리 기한은 ${formatKst(res.data.dueAt)}입니다.`,
            },
      );
      setKind('');
      setDetail('');
      setKey(newIdempotencyKey('privacy'));
      await load(applicantId);
    } catch (err) {
      const text =
        err instanceof NetworkError
          ? { title: '요청을 보내지 못했습니다', detail: '대학 접수 서버에 연결할 수 없습니다. 잠시 후 같은 내용으로 다시 보내 주십시오.' }
          : problemText(err instanceof ApiError ? err.problem : null);
      setResult({ tone: 'danger', title: text.title, body: text.detail });
    } finally {
      setBusy(false);
    }
  }

  const office = universityName ? `${universityName} 입학처` : '대학 입학처';

  return (
    <>
      <Breadcrumb
        trail={[
          { label: '홈', href: '/' },
          { label: '원서 작성', href: `/apply/${applicationId}` },
          { label: '개인정보 권리 요청' },
        ]}
      />
      <h1 style={{ fontSize: 'var(--krds-text-2xl)', marginTop: 0 }}>개인정보 열람·정정·삭제 요청</h1>

      {noSession ? (
        <Card title="본인확인이 필요합니다">
          <p style={{ marginTop: 0 }}>요청하려면 접수 홈에서 먼저 본인확인을 해 주십시오.</p>
          <Link href="/" style={{ color: 'var(--krds-primary)' }}>
            접수 홈으로
          </Link>
        </Card>
      ) : (
        <>
          <p>
            이 원서로 {office}가 처리하는 내 개인정보를 보여 달라고 하거나, 바로잡거나 지우거나 처리를 멈춰 달라고 요청할 수
            있습니다. 입학처는 받은 날부터 {dueDays}일 안에 결과를 알려 드립니다.
          </p>
          <p style={{ fontSize: 'var(--krds-text-sm)', color: 'var(--krds-fg-muted)' }}>
            동의 철회는 원서 작성 1단계의 동의 칸에서, 공통원서 삭제는 공통원서 화면에서 바로 하실 수 있습니다.
          </p>

          {result && (
            <Alert tone={result.tone} title={result.title} focusKey={result}>
              {result.body}
            </Alert>
          )}

          <Card title="새 요청">
            <fieldset style={{ border: 0, padding: 0, margin: '0 0 var(--krds-space-5)' }}>
              <legend style={{ fontWeight: 700, fontSize: 'var(--krds-text-sm)', marginBottom: 'var(--krds-space-2)' }}>요청 종류</legend>
              {/* 이름은 종류만, 설명은 설명으로 — 라벨이 설명까지 감싸면 스크린리더가 설명을 두 번 읽는다 (T-M5-42).
                  묶음은 Tab 자리 하나, 안에서는 화살표로 옮긴다(브라우저 기본 라디오 그룹) */}
              {PRIVACY_REQUEST_KIND.map((k) => (
                <div key={k} style={{ display: 'flex', gap: 'var(--krds-space-2)', alignItems: 'flex-start', marginBottom: 'var(--krds-space-3)' }}>
                  <input
                    id={`kind-${k}`}
                    type="radio"
                    name="privacy-kind"
                    value={k}
                    checked={kind === k}
                    aria-describedby={errors.kind ? `kind-${k}-help kind-error` : `kind-${k}-help`}
                    onChange={() => setKind(k)}
                    style={{ width: 24, height: 24, marginTop: 0, flex: 'none' }}
                  />
                  <div>
                    <label htmlFor={`kind-${k}`} style={{ fontWeight: 700 }}>
                      {PRIVACY_REQUEST_KIND_LABEL[k]}
                    </label>
                    <span id={`kind-${k}-help`} style={{ display: 'block', fontSize: 'var(--krds-text-sm)', color: 'var(--krds-fg-muted)' }}>
                      {PRIVACY_REQUEST_KIND_HELP[k]}
                    </span>
                  </div>
                </div>
              ))}
              {errors.kind && (
                <p id="kind-error" style={{ margin: 0, color: 'var(--krds-danger)', fontSize: 'var(--krds-text-sm)', fontWeight: 700 }}>
                  {errors.kind}
                </p>
              )}
            </fieldset>
            <Field
              id="privacy-detail"
              label="요청 내용"
              value={detail}
              onChange={setDetail}
              hint="정정은 무엇을 어떻게 바로잡을지 꼭 적어 주십시오. 다른 요청은 필요한 것만 적으셔도 됩니다. 입학처 담당자만 봅니다."
              maxLength={PRIVACY_REQUEST_DETAIL_MAX}
              multiline
              required={kind === 'CORRECTION'}
              {...(errors.detail ? { error: errors.detail } : {})}
            />
            <Button onClick={() => void submit()} disabled={busy || !applicantId}>
              {busy ? '보내는 중…' : '요청 보내기'}
            </Button>
          </Card>

          <Card title="보낸 요청과 처리 결과">
            {loadError ? (
              <Alert tone="danger" title={loadError.title}>
                <p style={{ margin: '0 0 var(--krds-space-3)' }}>{loadError.detail}</p>
                <Button variant="secondary" onClick={() => applicantId && void load(applicantId)}>
                  다시 불러오기
                </Button>
              </Alert>
            ) : requests === null ? (
              <p role="status">불러오는 중…</p>
            ) : requests.length === 0 ? (
              <p style={{ margin: 0 }}>아직 보낸 요청이 없습니다.</p>
            ) : (
              requests.map((r) => (
                <section key={r.requestNumber} style={{ borderTop: '1px solid var(--krds-border)', paddingTop: 'var(--krds-space-4)', marginTop: 'var(--krds-space-4)' }}>
                  <h3 style={{ margin: '0 0 var(--krds-space-2)', fontSize: 'var(--krds-text-lg)' }}>
                    {PRIVACY_REQUEST_KIND_LABEL[r.kind]} 요청 · {PRIVACY_REQUEST_STATUS_LABEL[r.status]}
                  </h3>
                  <DescriptionList
                    items={[
                      ['요청번호', r.requestNumber],
                      ['받은 시각', formatKst(r.receivedAt)],
                      [r.status === 'RECEIVED' ? '처리 기한' : '회신 시각', formatKst(r.status === 'RECEIVED' ? r.dueAt : r.decidedAt)],
                      ...(r.detail ? ([['요청 내용', <span key="d" style={{ whiteSpace: 'pre-wrap' }}>{r.detail}</span>]] as Array<[string, ReactNode]>) : []),
                      ...(r.resultNote
                        ? ([['입학처 안내', <span key="n" style={{ whiteSpace: 'pre-wrap' }}>{r.resultNote}</span>]] as Array<[string, ReactNode]>)
                        : []),
                    ]}
                  />
                </section>
              ))
            )}
          </Card>
        </>
      )}
    </>
  );
}
