import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import '@wonseoro/krds/tokens.css';
import { ConsoleProvider } from '../components/console';

export const metadata: Metadata = {
  title: '원서로 관리자 — 입학처 콘솔',
  description: '설정 승인 · 마감 연장 · 대조 · 증적',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

const NAV: Array<[string, string]> = [
  ['/config', '설정 승인'],
  ['/deadline', '마감 · 연장'],
  ['/reconciliation', '대조 · 예외'],
  ['/evidence', '증적 조회'],
];

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <a className="krds-skip" href="#main">
          본문 바로가기
        </a>
        <header style={{ background: 'var(--krds-bg)', borderBottom: '1px solid var(--krds-border)' }}>
          <div
            style={{
              maxWidth: 1120,
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
              원서로 입학처 콘솔
            </a>
            <nav aria-label="콘솔 메뉴">
              <ul style={{ display: 'flex', gap: 'var(--krds-space-4)', listStyle: 'none', margin: 0, padding: 0, flexWrap: 'wrap' }}>
                {NAV.map(([href, label]) => (
                  <li key={href}>
                    <a href={href} style={{ color: 'var(--krds-primary)' }}>
                      {label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        </header>
        <main
          id="main"
          style={{ maxWidth: 1120, margin: '0 auto', padding: 'var(--krds-space-5) var(--krds-space-4)' }}
        >
          <ConsoleProvider>{children}</ConsoleProvider>
        </main>
      </body>
    </html>
  );
}
