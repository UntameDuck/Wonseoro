import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import '@wonseoro/krds/tokens.css';

export const metadata: Metadata = {
  title: '원서로 — 대학입학 원서접수',
  description: 'K-PaaS 기반 분산형 대학입학 원서접수 표준 플랫폼',
};

/** 사용자가 확대할 수 있어야 한다. maximum-scale 로 막지 않는다. (KWCAG 2.2) */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>
        {/* 키보드 사용자가 반복 내비게이션을 건너뛴다 */}
        <a className="krds-skip" href="#main">
          본문 바로가기
        </a>

        <header
          style={{
            background: 'var(--krds-bg)',
            borderBottom: '1px solid var(--krds-border)',
          }}
        >
          <div
            style={{
              maxWidth: 960,
              margin: '0 auto',
              padding: 'var(--krds-space-4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 'var(--krds-space-4)',
              flexWrap: 'wrap',
            }}
          >
            <a
              href="/"
              style={{
                fontWeight: 700,
                fontSize: 'var(--krds-text-lg)',
                color: 'var(--krds-fg)',
                textDecoration: 'none',
              }}
            >
              원서로
            </a>
            <nav aria-label="주요 메뉴">
              <a href="/dashboard" style={{ color: 'var(--krds-primary)' }}>
                내 원서
              </a>
            </nav>
          </div>
        </header>

        <main
          id="main"
          style={{ maxWidth: 960, margin: '0 auto', padding: 'var(--krds-space-5) var(--krds-space-4)' }}
        >
          {children}
        </main>

        <footer
          style={{
            maxWidth: 960,
            margin: '0 auto',
            padding: 'var(--krds-space-6) var(--krds-space-4)',
            fontSize: 'var(--krds-text-sm)',
            color: 'var(--krds-fg-muted)',
          }}
        >
          <p style={{ margin: 0 }}>
            최종 접수 여부는 각 대학 서버가 원본으로 관리합니다. 통합 조회 화면의 반영이
            지연되어도 접수 자체는 유효합니다.
          </p>
        </footer>
      </body>
    </html>
  );
}
