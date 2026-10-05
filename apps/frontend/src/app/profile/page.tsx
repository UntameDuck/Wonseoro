'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { COMMON_PROFILE_COLLECTION_CONSENT, COMMON_PROFILE_FIELDS, commonProfileProblem, problemText } from '@wonseoro/contracts';
import { Alert, Button, Card, DescriptionList, ErrorSummary, Field } from '@wonseoro/krds';
import { Breadcrumb } from '../../krds/navigation';
import { SlowNotice } from '../../krds/status';
import { ApiError, NetworkError, api, type CommonProfile } from '../../lib/api';
import { loadSession } from '../../lib/session';
import { formatKst } from '../../lib/use-deadline';

/**
 * 공통원서 — 기술설계서 v1.0 §5 · v1.1 §10 §3 (D-57)
 *
 * 한 번 써 두면 원서를 만들 때 **동의한 항목만** 그 대학 원서에 복사된다(시점 Snapshot).
 * 여기를 고쳐도 이미 만든 원서는 바뀌지 않는다 — 원서는 그 시점의 사본이다.
 *
 * 전에는 이 화면이 없었다. 공통원서를 쓰는 길이 개발용 내부 API 뿐이라, 원서 1단계의
 * "공통원서에서 가져온 정보" 는 늘 비어 있었다.
 *
 * 중앙이 죽어 있어도 원서 작성은 계속된다(D-18). 이 화면만 쓸 수 없다고 알린다.
 */
export default function ProfilePage() {
  // 세션은 브라우저 저장소에만 있다. 렌더링 중에 읽으면 서버 렌더링(세션 없음)과 화면이 갈라진다 —
  // 마운트 뒤에 읽는다. null 은 "아직 읽지 않음" 이다.
  const [subjectToken, setSubjectToken] = useState<string | null>(null);
  useEffect(() => setSubjectToken(loadSession()?.subjectToken ?? ''), []);

  const [profile, setProfile] = useState<CommonProfile | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [university, setUniversity] = useState<{ id: string; name: string; privacyPolicyUrl?: string } | null>(null);
  /** 공통원서 수집·이용 동의 체크 (G-3, D-82) */
  const [collectionAgreed, setCollectionAgreed] = useState(false);
  const [released, setReleased] = useState<Set<string>>(new Set());
  const [issues, setIssues] = useState<Array<{ path: string; message: string }>>([]);
  /** 저장을 누를 때마다 오류 요약을 새로 그려 포커스를 다시 받게 한다 (T-M5-40) */
  const [saveRun, setSaveRun] = useState(0);
  const [status, setStatus] = useState<{ tone: 'success' | 'danger' | 'warning'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  /** 삭제 확인 칸 — 되돌릴 수 없는 동작은 한 번 더 묻는다 */
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(async () => {
    if (!subjectToken) return;
    // 동의를 받을 대학 — 이 화면을 연 대학 접수 서버의 대학이다.
    try {
      const { data } = await api.currentCycle();
      setUniversity({
        id: data.universityId,
        name: data.universityName ?? data.universityId,
        ...(data.notices?.privacyPolicyUrl ? { privacyPolicyUrl: data.notices.privacyPolicyUrl } : {}),
      });
    } catch {
      setUniversity(null);
    }
    try {
      const { data } = await api.profile(subjectToken);
      setProfile(data);
      setValues(Object.fromEntries(Object.entries(data.fields).map(([k, v]) => [k, String(v)])));
      setCollectionAgreed(data.collectionConsent?.version === COMMON_PROFILE_COLLECTION_CONSENT.version);
      setStatus(null);
    } catch (err) {
      setProfile(null);
      setStatus({
        tone: 'warning',
        text:
          err instanceof NetworkError
            ? '공통원서 서버에 연결할 수 없습니다. 원서는 공통원서 없이 직접 입력해 작성할 수 있습니다.'
            : err instanceof ApiError
              ? problemText(err.problem).detail
              : '공통원서를 불러오지 못했습니다.',
      });
    }
  }, [subjectToken]);

  useEffect(() => {
    void load();
  }, [load]);

  // 이 대학에 이미 준 동의를 체크 상태로 되살린다.
  useEffect(() => {
    if (!profile || !university) return;
    const mine = profile.consents.find((c) => c.universityId === university.id);
    setReleased(new Set(mine?.fieldCodes ?? []));
  }, [profile, university]);

  function toggle(code: string) {
    setReleased((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  async function save() {
    // 표준 형식을 화면에서도 먼저 본다 — 서버와 같은 규칙(@wonseoro/contracts)이다.
    const fields: Record<string, string | number | null> = {};
    const problems: Array<{ path: string; message: string }> = [];
    for (const f of COMMON_PROFILE_FIELDS) {
      const raw = (values[f.code] ?? '').trim();
      const value = raw === '' ? null : f.type === 'integer' ? Number(raw) : raw;
      const problem = commonProfileProblem(f.code, value);
      if (problem) problems.push({ path: f.code, message: problem });
      fields[f.code] = value;
    }
    // 공통원서는 운영기관이 받는 개인정보다 — 수집·이용 동의가 있어야 저장한다 (보호법 제15조, D-82)
    if (!collectionAgreed) problems.unshift({ path: 'collectionConsent', message: '공통원서 개인정보 수집·이용에 동의해 주십시오.' });
    setIssues(problems);
    setSaveRun((n) => n + 1);
    if (problems.length > 0) return;

    const saved = new Set(Object.entries(fields).filter(([, v]) => v !== null).map(([k]) => k));
    // 다른 대학에 준 동의는 그대로 둔다. 이 대학 동의만 바꾼다. 비운 항목의 동의는 뺀다.
    const consents = [
      ...(profile?.consents ?? [])
        .filter((c) => c.universityId !== university?.id)
        .map((c) => ({ universityId: c.universityId, fieldCodes: c.fieldCodes.filter((f) => saved.has(f)) })),
      ...(university && released.size > 0
        ? [{ universityId: university.id, fieldCodes: [...released].filter((f) => saved.has(f)) }]
        : []),
    ].filter((c) => c.fieldCodes.length > 0);

    setBusy(true);
    try {
      const { data } = await api.saveProfile(subjectToken ?? '', {
        fields,
        consents,
        collectionConsentVersion: collectionAgreed ? COMMON_PROFILE_COLLECTION_CONSENT.version : null,
      });
      setProfile(data);
      setStatus({ tone: 'success', text: `저장했습니다 (${formatKst(data.updatedAt)}). 새로 만드는 원서부터 반영됩니다.` });
    } catch (err) {
      setStatus({
        tone: 'danger',
        text:
          err instanceof NetworkError
            ? '공통원서 서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주십시오.'
            : err instanceof ApiError
              ? problemText(err.problem).detail
              : '저장하지 못했습니다.',
      });
    } finally {
      setBusy(false);
    }
  }

  // 확인 칸을 열면 확정 버튼으로 포커스를 옮긴다 — 누른 버튼이 사라진다 (T-M5-41)
  useEffect(() => {
    if (confirmDelete) document.getElementById('profile-delete-confirm')?.focus();
  }, [confirmDelete]);

  /** 공통원서를 지운다 — 보호법 제36조 삭제 요구 (문서 10 G-10, D-82) */
  async function removeProfile() {
    setBusy(true);
    try {
      await api.deleteProfile(subjectToken ?? '');
      setConfirmDelete(false);
      setValues({});
      setReleased(new Set());
      setCollectionAgreed(false);
      setIssues([]);
      setProfile((prev) => (prev ? { ...prev, fields: {}, consents: [], updatedAt: null, collectionConsent: null } : prev));
      setStatus({ tone: 'success', text: '공통원서를 지웠습니다. 이미 만든 원서는 바뀌지 않습니다 — 원서의 삭제는 그 대학에 요청해 주십시오.' });
    } catch (err) {
      setStatus({
        tone: 'danger',
        text:
          err instanceof NetworkError
            ? '공통원서 서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주십시오.'
            : err instanceof ApiError
              ? problemText(err.problem).detail
              : '지우지 못했습니다.',
      });
    } finally {
      setBusy(false);
    }
  }

  if (subjectToken === null) return <p role="status">불러오는 중…</p>;
  if (!subjectToken) {
    return (
      <Card title="본인확인이 필요합니다" titleLevel={1}>
        <p style={{ marginTop: 0 }}>공통원서를 작성하려면 접수 홈에서 먼저 본인확인을 해 주십시오.</p>
        <Link href="/" style={{ color: 'var(--krds-primary)' }}>
          접수 홈으로
        </Link>
      </Card>
    );
  }

  return (
    <>
      <Breadcrumb trail={[{ label: '홈', href: '/' }, { label: '공통원서' }]} />
      <h1 style={{ fontSize: 'var(--krds-text-2xl)', marginTop: 0 }}>공통원서</h1>

      <Alert tone="info" title="한 번 써 두면 여러 대학 원서에 쓸 수 있습니다">
        원서를 만들 때 <strong>동의한 항목만</strong> 그 대학 원서에 복사됩니다. 여기를 고쳐도 이미 만든
        원서는 바뀌지 않습니다.
      </Alert>

      {/* 저장 결과로 포커스를 옮긴다 — 스크린리더가 결과를 읽고, 저장 버튼이 처리 중 비활성이 되며 포커스가 떨어지지 않게 */}
      {status && <Alert tone={status.tone} title={status.text} focusKey={status} />}
      <ErrorSummary key={saveRun} issues={issues} />

      {/* 공통원서 자체의 수집·이용 동의 — 대학 제공 동의와 따로 받는다 (G-3, D-82) */}
      <Card title={COMMON_PROFILE_COLLECTION_CONSENT.title}>
        <div
          role="region"
          aria-label={`${COMMON_PROFILE_COLLECTION_CONSENT.title} 전문`}
          tabIndex={0}
          style={{
            whiteSpace: 'pre-wrap',
            padding: 'var(--krds-space-3)',
            border: '1px solid var(--krds-border)',
            borderRadius: 'var(--krds-radius)',
            fontSize: 'var(--krds-text-sm)',
            maxHeight: '12rem',
            overflowY: 'auto',
          }}
        >
          {COMMON_PROFILE_COLLECTION_CONSENT.text}
        </div>
        <label htmlFor="field-collectionConsent" style={{ display: 'flex', gap: 'var(--krds-space-2)', alignItems: 'flex-start', marginTop: 'var(--krds-space-2)' }}>
          <input
            id="field-collectionConsent"
            type="checkbox"
            checked={collectionAgreed}
            aria-invalid={issues.some((i) => i.path === 'collectionConsent') ? true : undefined}
            aria-describedby={issues.some((i) => i.path === 'collectionConsent') ? 'field-collectionConsent-error' : undefined}
            onChange={(e) => {
              setCollectionAgreed(e.target.checked);
              setIssues((prev) => prev.filter((i) => i.path !== 'collectionConsent'));
            }}
            style={{ width: 24, height: 24, marginTop: 0 }}
          />
          <span>위 내용에 동의합니다 (필수)</span>
        </label>
        {issues.some((i) => i.path === 'collectionConsent') && (
          <p id="field-collectionConsent-error" style={{ margin: 'var(--krds-space-1) 0 0', color: 'var(--krds-danger)', fontSize: 'var(--krds-text-sm)' }}>
            공통원서 개인정보 수집·이용에 동의해 주십시오.
          </p>
        )}
      </Card>

      <Card title="기본 정보">
        {COMMON_PROFILE_FIELDS.map((f) => (
          <Field
            key={f.code}
            // 오류 요약 링크가 이 칸으로 온다 (T-M5-40)
            id={`field-${f.code}`}
            label={f.title}
            value={values[f.code] ?? ''}
            onChange={(v) => {
              setValues((prev) => ({ ...prev, [f.code]: v }));
              // 고친 칸의 오류는 다음 저장을 기다리지 않고 지운다 — 원서 화면과 같다 (U-2)
              setIssues((prev) => prev.filter((i) => i.path !== f.code));
            }}
            // 칸 옆에도 요약과 같은 오류를 붙인다 — 스크린리더가 칸에서 오류를 읽는다 (T-M5-42)
            {...(issues.find((i) => i.path === f.code) ? { error: issues.find((i) => i.path === f.code)!.message } : {})}
            type={f.type === 'integer' ? 'number' : f.format === 'email' ? 'email' : 'text'}
            {...(f.maxLength !== undefined ? { maxLength: f.maxLength } : {})}
          />
        ))}
      </Card>

      {university && (
        <Card title={`${university.name}에 제공`}>
          <fieldset style={{ border: 0, padding: 0, margin: '0 0 var(--krds-space-4)' }}>
            <legend style={{ marginBottom: 'var(--krds-space-3)' }}>
              이 대학 원서를 만들 때 복사해도 되는 항목을 고르십시오. 고르지 않은 항목은 원서에서 직접
              입력합니다.
            </legend>
            {COMMON_PROFILE_FIELDS.map((f) => (
              <label key={f.code} style={{ display: 'block', padding: 'var(--krds-space-1) 0' }}>
                <input
                  type="checkbox"
                  checked={released.has(f.code)}
                  onChange={() => toggle(f.code)}
                  style={{ marginRight: 'var(--krds-space-2)' }}
                />
                {f.title}
              </label>
            ))}
          </fieldset>
          {/* 제3자 제공 고지 — 제공받는 자·목적·항목·보유기간·거부권 (보호법 제17조 ②, G-3, D-82) */}
          <DescriptionList
            items={[
              ['제공받는 자', university.name],
              ['이용 목적', '이 대학 입학전형 원서 작성'],
              ['제공 항목', released.size > 0 ? COMMON_PROFILE_FIELDS.filter((f) => released.has(f.code)).map((f) => f.title).join(', ') : '고른 항목 없음'],
              [
                '보유 기간',
                university.privacyPolicyUrl ? (
                  <span key="keep">
                    이 대학의 원서 보존 기준에 따릅니다 — <a href={university.privacyPolicyUrl}>개인정보 처리방침</a>
                  </span>
                ) : (
                  '이 대학의 원서 보존 기준에 따릅니다'
                ),
              ],
              ['거부할 권리', '동의하지 않아도 됩니다. 고르지 않은 항목은 원서에서 직접 입력합니다.'],
            ]}
          />
        </Card>
      )}

      {profile && profile.consents.some((c) => c.universityId !== university?.id) && (
        <Card title="다른 대학에 준 제공 동의">
          <DescriptionList
            items={profile.consents
              .filter((c) => c.universityId !== university?.id)
              .map((c) => [
                c.universityName ?? '대학 정보 확인 중',
                `${c.fieldCodes
                  .map((code) => COMMON_PROFILE_FIELDS.find((f) => f.code === code)?.title ?? code)
                  .join(', ')} (${formatKst(c.grantedAt)})`,
              ])}
          />
        </Card>
      )}

      <SlowNotice busy={busy} />
      <Button onClick={() => void save()} disabled={busy || profile === null}>
        {busy ? '저장 중…' : '저장'}
      </Button>

      {profile && profile.updatedAt && (
        <Card title="공통원서 삭제">
          <p style={{ marginTop: 0 }}>
            보관한 공통원서와 대학별 제공 동의를 지웁니다. 이미 만든 원서는 바뀌지 않습니다.
          </p>
          {confirmDelete ? (
            <div style={{ display: 'flex', gap: 'var(--krds-space-3)', flexWrap: 'wrap' }}>
              <Button id="profile-delete-confirm" variant="danger" onClick={() => void removeProfile()} disabled={busy}>
                삭제 확정
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setConfirmDelete(false);
                  setTimeout(() => document.getElementById('profile-delete-open')?.focus(), 0);
                }}
              >
                그만두기
              </Button>
            </div>
          ) : (
            <Button id="profile-delete-open" variant="secondary" onClick={() => setConfirmDelete(true)} disabled={busy}>
              공통원서 삭제하기
            </Button>
          )}
        </Card>
      )}
    </>
  );
}
