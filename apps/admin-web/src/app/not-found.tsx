import type { Metadata } from 'next';

export const metadata: Metadata = { title: '찾을 수 없는 화면' };

/** 없는 주소 — 영문 기본 404 대신 (T-M5-55, U-14) */
export default function NotFound() {
  return (
    <section>
      <h1 style={{ fontSize: 'var(--krds-text-2xl)', marginTop: 0 }}>찾을 수 없는 화면입니다</h1>
      <p>주소가 바뀌었거나 잘못 입력되었습니다.</p>
      <a href="/" style={{ color: 'var(--krds-primary)' }}>
        콘솔 첫 화면으로
      </a>
    </section>
  );
}
