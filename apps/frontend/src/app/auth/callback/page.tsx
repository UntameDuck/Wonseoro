'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card } from '@wonseoro/krds';
import { completeLogin, login } from '../../../lib/auth';
import { OIDC_SESSION, peekSession, saveSession } from '../../../lib/session';

/**
 * 본인확인 콜백 — 발급자가 code 를 들고 돌려보내는 곳(T-M5-02 단계 6).
 * 토큰을 받아 이 탭에 두고, 화면 세션을 시작한 뒤 원래 화면으로 돌아간다. 작성 중이던 원서는 그대로 이어진다.
 */
export default function AuthCallback() {
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    // 개발 모드의 엄격 모드는 효과를 두 번 부른다 — code 는 한 번만 바꿀 수 있다
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        const returnTo = await completeLogin(new URLSearchParams(window.location.search));
        const before = peekSession();
        saveSession({
          applicantId: OIDC_SESSION,
          subjectToken: OIDC_SESSION,
          ...(before?.applicationId ? { applicationId: before.applicationId } : {}),
        });
        router.replace(returnTo);
      } catch {
        setFailed(true);
      }
    })();
  }, [router]);

  if (failed) {
    return (
      <Card title="본인확인을 마치지 못했습니다" titleLevel={1} titleId="auth-failed-title">
        <Alert tone="danger" title="본인확인이 완료되지 않았습니다" focusKey="auth-failed">
          시간이 지났거나 요청을 확인할 수 없습니다. 작성하신 원서는 서버에 보관되어 있습니다. 다시 본인확인해 주십시오.
        </Alert>
        <Button onClick={() => void login('/')}>다시 본인확인</Button>
      </Card>
    );
  }
  return (
    <Card title="본인확인을 마치는 중입니다" titleLevel={1}>
      <p role="status" style={{ margin: 0 }}>
        잠시만 기다려 주십시오.
      </p>
    </Card>
  );
}
