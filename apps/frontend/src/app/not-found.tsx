import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: '찾을 수 없는 화면' };

/** 없는 주소 — 영문 기본 404 대신 (T-M5-55, U-14). 작성하던 원서는 내 원서에서 다시 찾을 수 있다. */
export default function NotFound() {
  return (
    <section>
      <h1 style={{ fontSize: 'var(--krds-text-2xl)', marginTop: 0 }}>찾을 수 없는 화면입니다</h1>
      <p>주소가 바뀌었거나 잘못 입력되었습니다. 작성하던 원서는 내 원서에서 다시 찾을 수 있습니다.</p>
      <p style={{ display: 'flex', gap: 'var(--krds-space-4)', flexWrap: 'wrap' }}>
        <Link href="/" style={{ color: 'var(--krds-primary)' }}>
          접수 홈으로
        </Link>
        <Link href="/dashboard" style={{ color: 'var(--krds-primary)' }}>
          내 원서로
        </Link>
      </p>
    </section>
  );
}
