'use client';

import { Alert, Button } from '@wonseoro/krds';

/**
 * 화면을 그리다 문제가 생겼을 때 — 영문 기본 화면 대신 (T-M5-55, U-14).
 * 작성 내용은 서버에 저장되어 있다. 처음부터 다시 쓰라고 하지 않는다(장애 UX 원칙).
 */
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Alert tone="danger" title="화면을 보여 드리지 못했습니다">
      <p style={{ margin: '0 0 var(--krds-space-3)' }}>
        작성하신 내용은 저장되어 있습니다. 다시 시도하거나 내 원서에서 이어서 작성해 주십시오.
      </p>
      <div style={{ display: 'flex', gap: 'var(--krds-space-3)', flexWrap: 'wrap', alignItems: 'center' }}>
        <Button onClick={() => reset()}>다시 시도</Button>
        <a href="/dashboard" style={{ color: 'var(--krds-primary)' }}>
          내 원서로
        </a>
      </div>
    </Alert>
  );
}
