'use client';

import { useEffect, useState } from 'react';
import { cycleTitle } from '@wonseoro/krds';
import { api } from '../lib/api';

/**
 * 머리글의 대학·모집 이름 — 와이어프레임 "K-Admission · A대학교 2027 수시" (T-M5-56, U-58).
 * 지원자 웹은 대학마다 따로 뜬다(대학별 Data Plane). 어느 대학의 접수인지 모든 화면에서 보인다.
 * 대학 서버에 닿지 못하면 그리지 않는다 — 장애 안내가 따로 말한다.
 */
export function CycleBadge() {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    void api
      .currentCycle()
      .then(({ data }) => setText(`${data.universityName ?? ''} ${cycleTitle(data.admissionYear, data.name)}`.trim()))
      .catch(() => setText(null));
  }, []);
  if (!text) return null;
  return (
    <span style={{ color: 'var(--krds-fg-muted)', fontWeight: 400, fontSize: 'var(--krds-text-base)' }}>
      {' · '}
      {text}
    </span>
  );
}
