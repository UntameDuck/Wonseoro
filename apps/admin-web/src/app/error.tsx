'use client';

import { Alert, Button } from '@wonseoro/krds';

/** 화면을 그리다 문제가 생겼을 때 — 영문 기본 화면 대신 (T-M5-55, U-14). 승인·적용은 서버 기록이 기준이다. */
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  // 화면마다 큰 제목(h1)은 하나 — 없는 화면(404)과 같은 모양 (T-M5-42)
  return (
    <section>
      <h1 style={{ fontSize: 'var(--krds-text-2xl)', marginTop: 0 }}>화면을 보여 드리지 못했습니다</h1>
      <Alert tone="danger" title="방금 한 승인·적용이 기록되었는지 먼저 확인해 주십시오">
        <p style={{ margin: '0 0 var(--krds-space-3)' }}>
          화면을 다시 불러와 확인한 뒤, 필요하면 다시 시도해 주십시오.
        </p>
        <Button onClick={() => reset()}>다시 시도</Button>
      </Alert>
    </section>
  );
}
