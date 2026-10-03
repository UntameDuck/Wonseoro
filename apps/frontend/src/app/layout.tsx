import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import '@wonseoro/krds/tokens.css';
import { CycleBadge } from '../krds/cycle-badge';
import { SessionTimeout } from '../krds/session-timeout';
import { ServiceIncidentBanner } from '../krds/service-status';

/**
 * 화면마다 제목이 다르다 — "검토·결제 — 원서 작성 | 원서로". 탭·스크린리더·방문 기록이 화면을 구별한다
 * (KWCAG 2.4.2 페이지 제목, T-M5-55). 경로별 이름은 각 경로의 layout.tsx 에 있다.
 */
export const metadata: Metadata = {
  title: { default: '원서로 — 대학입학 원서접수', template: '%s | 원서로' },
  description: '대학입학 원서를 쓰고, 서류를 올리고, 전형료를 내고 접수하는 곳입니다.',
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
        <a className="krds-skip krds-no-print" href="#main">
          본문 바로가기
        </a>

        <header
          className="krds-no-print"
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
              <CycleBadge />
            </a>
            <nav aria-label="주요 메뉴" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--krds-space-4)' }}>
              <a href="/profile" style={{ color: 'var(--krds-primary)' }}>
                공통원서
              </a>
              <a href="/dashboard" style={{ color: 'var(--krds-primary)' }}>
                내 원서
              </a>
              <a href="/status" style={{ color: 'var(--krds-primary)' }}>
                서비스 상태
              </a>
            </nav>
          </div>
        </header>

        <main
          id="main"
          style={{ maxWidth: 960, margin: '0 auto', padding: 'var(--krds-space-5) var(--krds-space-4)' }}
        >
          <ServiceIncidentBanner />
          {children}
        </main>

        <footer
          className="krds-no-print"
          style={{
            maxWidth: 960,
            margin: '0 auto',
            padding: 'var(--krds-space-6) var(--krds-space-4)',
            fontSize: 'var(--krds-text-sm)',
            color: 'var(--krds-fg-muted)',
          }}
        >
          {/* 설계 설명("원본은 대학 서버")을 두지 않는다. 운영기관·문의처·개인정보처리방침은 대학 설정에 값이
              생기면 여기 둔다 — 지어낸 연락처를 넣지 않는다 (T-M5-50, 08 결정 12) */}
          <p style={{ margin: 0 }}>원서로 · 대학입학 원서접수</p>
        </footer>
        {/* 세션 만료 5분 전 경고·연장 (T-M5-45) */}
        <SessionTimeout />
      </body>
    </html>
  );
}
