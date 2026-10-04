'use client';

import { useEffect, useState } from 'react';
import type { UniversityNotices } from '@wonseoro/contracts';
import { api } from '../lib/api';

/**
 * 모든 화면 바닥글의 대학 고지 — 개인정보 처리방침·위탁 공개·보호책임자·문의처 (문서 10 G-6, D-80).
 * 값은 대학이 2인 승인으로 적용한 설정에서 온다. 없는 값은 그리지 않는다 — 지어낸 연락처를 넣지 않는다(08 결정 12).
 */
export function UniversityFooterNotices() {
  const [notices, setNotices] = useState<UniversityNotices | null>(null);
  useEffect(() => {
    void api
      .currentCycle()
      .then(({ data }) => setNotices(data.notices ?? null))
      .catch(() => setNotices(null));
  }, []);
  if (!notices) return null;
  const links: Array<[string, string]> = [];
  if (notices.privacyPolicyUrl) links.push([notices.privacyPolicyUrl, '개인정보 처리방침']);
  if (notices.processorsUrl && notices.processorsUrl !== notices.privacyPolicyUrl) {
    links.push([notices.processorsUrl, '개인정보 처리 위탁']);
  }
  if (links.length === 0 && !notices.privacyOfficer && !notices.contact) return null;
  return (
    <div style={{ marginTop: 'var(--krds-space-2)', display: 'grid', gap: 'var(--krds-space-1)' }}>
      {links.length > 0 && (
        <ul style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--krds-space-4)', listStyle: 'none', margin: 0, padding: 0 }}>
          {links.map(([href, label]) => (
            <li key={href}>
              {/* 처리방침은 굵게 — 개인정보 보호위원회 작성지침 (다른 고지와 구별되게) */}
              <a href={href} style={{ color: 'var(--krds-primary)', fontWeight: label === '개인정보 처리방침' ? 700 : 400 }}>
                {label}
              </a>
            </li>
          ))}
        </ul>
      )}
      {notices.privacyOfficer && <p style={{ margin: 0 }}>개인정보 보호책임자: {notices.privacyOfficer}</p>}
      {notices.contact && <p style={{ margin: 0 }}>문의: {notices.contact}</p>}
    </div>
  );
}

/** 전형료 반환 안내 — 결제 전·접수증에 그대로 (고등교육법 시행령 제42조의3, 문서 10 G-4). 값이 없으면 그리지 않는다 */
export function FeeRefundNotice({ text, level = 3 }: { text: string | undefined; /** 제목 단계 — 둘러싼 카드 제목의 바로 아래 */ level?: 2 | 3 }) {
  if (!text) return null;
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <section
      aria-labelledby="fee-refund-title"
      style={{
        margin: 'var(--krds-space-4) 0 0',
        padding: 'var(--krds-space-4)',
        border: '1px solid var(--krds-border)',
        borderRadius: 'var(--krds-radius)',
        background: 'var(--krds-bg)',
      }}
    >
      <Heading id="fee-refund-title" style={{ margin: '0 0 var(--krds-space-2)', fontSize: 'var(--krds-text-base)' }}>
        전형료 반환 안내
      </Heading>
      <p style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 'var(--krds-text-sm)' }}>{text}</p>
    </section>
  );
}
