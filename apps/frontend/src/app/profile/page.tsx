'use client';

import { useCallback, useEffect, useState } from 'react';
import { COMMON_PROFILE_FIELDS, commonProfileProblem, problemText } from '@wonseoro/contracts';
import { Alert, Button, Card, DescriptionList, ErrorSummary, Field } from '@wonseoro/krds';
import { Breadcrumb } from '../../krds/navigation';
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
  const [university, setUniversity] = useState<{ id: string; name: string } | null>(null);
  const [released, setReleased] = useState<Set<string>>(new Set());
  const [issues, setIssues] = useState<Array<{ path: string; message: string }>>([]);
  const [status, setStatus] = useState<{ tone: 'success' | 'danger' | 'warning'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!subjectToken) return;
    // 동의를 받을 대학 — 이 화면을 연 대학 접수 서버의 대학이다.
    try {
      const { data } = await api.currentCycle();
      setUniversity({ id: data.universityId, name: data.universityName ?? data.universityId });
    } catch {
      setUniversity(null);
    }
    try {
      const { data } = await api.profile(subjectToken);
      setProfile(data);
      setValues(Object.fromEntries(Object.entries(data.fields).map(([k, v]) => [k, String(v)])));
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
    setIssues(problems);
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
      const { data } = await api.saveProfile(subjectToken ?? '', { fields, consents });
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

  if (subjectToken === null) return <p role="status">불러오는 중…</p>;
  if (!subjectToken) {
    return (
      <Card title="본인확인이 필요합니다">
        <p style={{ marginTop: 0 }}>공통원서를 작성하려면 접수 홈에서 먼저 본인확인을 해 주십시오.</p>
        <a href="/" style={{ color: 'var(--krds-primary)' }}>
          접수 홈으로
        </a>
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

      {status && <Alert tone={status.tone} title={status.text} />}
      <ErrorSummary issues={issues} />

      <Card title="기본 정보">
        {COMMON_PROFILE_FIELDS.map((f) => (
          <Field
            key={f.code}
            label={f.title}
            value={values[f.code] ?? ''}
            onChange={(v) => setValues((prev) => ({ ...prev, [f.code]: v }))}
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

      <Button onClick={() => void save()} disabled={busy || profile === null}>
        {busy ? '저장 중…' : '저장'}
      </Button>
    </>
  );
}
