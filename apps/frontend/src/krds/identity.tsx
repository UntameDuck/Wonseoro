'use client';

import { Button, Field } from '@wonseoro/krds';
import { OIDC_MODE, login, logout } from '../lib/auth';
import { DEMO_APPLICANT, DEV_IDENTITY } from '../lib/dev-identity';
import { OIDC_SESSION, endSession } from '../lib/session';

/**
 * 접수 홈의 본인확인 자리. (T-M5-53)
 *
 * 본인확인(OIDC) 모드(T-M5-02 단계 6) — "본인확인" 이 발급자 화면으로 보내고, 마치면 이 자리가 "본인확인을 마쳤습니다" 와
 * 로그아웃으로 바뀐다. 로그아웃은 발급자 로그인도 끝낸다(공용 PC).
 * 본인확인이 구성되지 않은 운영 빌드는 버튼만 보이고 누를 수 없다 — 아무 식별자나 넣는 입력칸을 운영 화면에 두지 않는다.
 * 개발 서버에서는 지원자 식별자와 대학에 등록된 가명 토큰을 직접 넣는다. 시드 값은 문구에 적지 않고 버튼으로 채운다.
 */
export function IdentitySection({
  applicantId,
  subjectToken,
  onApplicantId,
  onSubjectToken,
}: {
  applicantId: string;
  subjectToken: string;
  onApplicantId: (v: string) => void;
  onSubjectToken: (v: string) => void;
}) {
  if (OIDC_MODE) {
    const signedIn = applicantId === OIDC_SESSION;
    return (
      <>
        <h2 style={{ fontSize: 'var(--krds-text-lg)' }}>본인확인</h2>
        {signedIn ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--krds-space-3)', alignItems: 'center', marginBottom: 'var(--krds-space-5)' }}>
            <p style={{ margin: 0 }}>본인확인을 마쳤습니다.</p>
            <Button
              id="identity-logout"
              variant="secondary"
              onClick={() => {
                endSession();
                void logout(true);
              }}
            >
              로그아웃
            </Button>
          </div>
        ) : (
          <div style={{ marginBottom: 'var(--krds-space-5)' }}>
            <p style={{ marginTop: 0, color: 'var(--krds-fg-muted)', fontSize: 'var(--krds-text-sm)' }}>
              원서를 작성하려면 본인확인이 필요합니다. 본인확인 화면으로 이동했다가 이 화면으로 돌아옵니다.
            </p>
            <Button id="identity-login" onClick={() => void login('/')}>
              본인확인
            </Button>
          </div>
        )}
      </>
    );
  }

  if (!DEV_IDENTITY) {
    return (
      <>
        <h2 style={{ fontSize: 'var(--krds-text-lg)' }}>본인확인</h2>
        <p style={{ marginTop: 0, color: 'var(--krds-fg-muted)', fontSize: 'var(--krds-text-sm)' }}>
          원서를 작성하려면 본인확인이 필요합니다.
        </p>
        <div style={{ marginBottom: 'var(--krds-space-5)' }}>
          <Button variant="secondary" disabled>
            본인확인
          </Button>
          <p style={{ margin: 'var(--krds-space-2) 0 0', fontSize: 'var(--krds-text-sm)', color: 'var(--krds-fg-muted)' }}>
            본인확인 서비스를 준비하고 있습니다. 잠시 후 다시 이용해 주십시오.
          </p>
        </div>
      </>
    );
  }

  return (
    <section
      aria-labelledby="dev-identity-title"
      style={{
        margin: '0 0 var(--krds-space-5)',
        padding: 'var(--krds-space-4)',
        border: '1px dashed var(--krds-border-strong)',
        borderRadius: 'var(--krds-radius)',
      }}
    >
      <h2 id="dev-identity-title" style={{ margin: '0 0 var(--krds-space-2)', fontSize: 'var(--krds-text-lg)' }}>
        본인확인 (개발용)
      </h2>
      <p style={{ marginTop: 0, color: 'var(--krds-fg-muted)', fontSize: 'var(--krds-text-sm)' }}>
        개발 서버에서만 보이는 입력입니다. 운영 화면에는 본인확인 절차가 이 자리에 들어갑니다.
      </p>
      <div style={{ marginBottom: 'var(--krds-space-4)' }}>
        <Button
          variant="secondary"
          onClick={() => {
            onApplicantId(DEMO_APPLICANT.applicantId);
            onSubjectToken(DEMO_APPLICANT.subjectToken);
          }}
        >
          시연 지원자 채우기
        </Button>
      </div>
      <Field label="지원자 식별자" value={applicantId} onChange={onApplicantId} required />
      <Field
        label="공통원서 가명 토큰"
        value={subjectToken}
        onChange={onSubjectToken}
        hint="대학에 등록된 값과 같아야 합니다."
        required
      />
    </section>
  );
}
