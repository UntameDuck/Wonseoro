'use client';

import { Alert, Button, Card, Field, LiveRegion, TableScroll } from '@wonseoro/krds';
import { useCallback, useEffect, useState } from 'react';
import { ACCESS_GRANT_ACTION_LABEL, ACCESS_GRANT_KIND_LABEL, STAFF_ROLE_LABEL, labelOf } from '@wonseoro/contracts';
import { td, th } from '../../components/activation';
import { adminGet, describe, kst } from '../../lib/api';

interface Entry {
  seq: number;
  occurredAt: string;
  action: keyof typeof ACCESS_GRANT_ACTION_LABEL;
  changeKind: string;
  subject: string;
  username: string | null;
  roles: string[];
  actor: string | null;
  enabled: boolean | null;
  added: string[];
  removed: string[];
  missing: boolean;
}

interface Page {
  items: Entry[];
  nextBefore: number | null;
  chain: { checked: number; brokenSeq: number | null };
}

const TITLE_ID = 'grants-title';
const PAGE_SIZE = 50;

/** 역할 이름 — 아는 업무 역할은 사람 말로, 그 밖(로그인 서버 관리 권한·그룹)은 원래 이름 그대로(감사에 필요하다) */
const roleText = (roles: string[]) => (roles.length ? roles.map((r) => labelOf(STAFF_ROLE_LABEL, r, r)).join(', ') : '없음');

/**
 * 권한 변경 기록 — 개인정보의 안전성 확보조치 기준 제5조 ③ (문서 10 G-15, 대장 D-91). 보안 감사자 읽기 전용.
 *
 * 수집 도구가 로그인 서버 관리 이벤트를 옮기고 실제 권한과 대조한 기록이다. 이 화면은 아무것도 바꾸지 않는다.
 * 체인 검증 결과를 맨 위에 둔다 — 끊겼으면 아래 기록 전부를 그대로 믿을 수 없다(증적 조회와 같은 원칙).
 * "더 보기" 가 마지막 쪽에서 사라지면 포커스를 기록 제목으로 옮긴다(T-M5-41).
 */
export default function AccessGrantsPage() {
  const [query, setQuery] = useState('');
  const [applied, setApplied] = useState('');
  // 바꾼 사람을 모르는 변경(대조 기록)만 — 감사가 먼저 볼 것. 찾기를 눌러야 적용한다(칸을 바꿀 때마다 목록이 바뀌지 않게)
  const [unexplained, setUnexplained] = useState(false);
  const [appliedUnexplained, setAppliedUnexplained] = useState(false);
  const [page, setPage] = useState<Page | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const load = useCallback(async (subject: string, onlyUnexplained: boolean, before?: number) => {
    setBusy(true);
    try {
      const next = await adminGet<Page>('access-grants', {
        limit: String(PAGE_SIZE),
        ...(subject ? { subject } : {}),
        ...(onlyUnexplained ? { unexplained: 'true' } : {}),
        ...(before ? { before: String(before) } : {}),
      });
      setPage((prev) => (before && prev ? { ...next, items: [...prev.items, ...next.items] } : next));
      setError(null);
      setNotice(before ? `${next.items.length}건을 더 불러왔습니다.` : `${next.items.length}건을 불러왔습니다.`);
      if (before && next.nextBefore === null) document.getElementById(TITLE_ID)?.focus();
    } catch (err) {
      setError(describe(err));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load('', false);
  }, [load]);

  const search = (subject: string, onlyUnexplained: boolean) => {
    setApplied(subject);
    setAppliedUnexplained(onlyUnexplained);
    void load(subject, onlyUnexplained);
  };
  const filtered = applied !== '' || appliedUnexplained;
  const listTitle = `기록 — ${[applied, appliedUnexplained ? '바꾼 사람을 모르는 변경만' : ''].filter(Boolean).join(' · ') || '최신순'}`;

  return (
    <>
      <h1 style={{ fontSize: 'var(--krds-text-2xl)', marginTop: 0 }}>권한 변경 기록</h1>
      <Alert tone="info" title="담당자 계정의 권한 부여·변경·말소 기록입니다">
        로그인 서버에서 바뀐 역할·계정을 바꾼 관리자와 함께 1시간마다 옮기고, 실제 권한과 맞춰 봅니다. 기록은 고치거나 지울 수 없고 3년 넘게 보관합니다.
      </Alert>
      {page &&
        (page.chain.brokenSeq === null ? (
          <Alert tone="success" title={`기록 ${page.chain.checked}건이 끊김 없이 이어집니다`} />
        ) : (
          <Alert tone="danger" title="기록이 중간에 바뀌었거나 빠졌습니다 — 그대로 증거로 쓸 수 없습니다">
            처음으로 맞지 않는 기록 순번: {page.chain.brokenSeq}. 보안 담당과 데이터베이스 관리자에게 바로 알려 주십시오.
          </Alert>
        ))}
      <Card title="계정으로 찾기">
        <Field label="계정 ID 또는 로그인 이름" hint="비우고 찾으면 모든 계정의 기록을 최신순으로 봅니다." value={query} onChange={setQuery} maxLength={200} />
        <label style={{ display: 'flex', gap: 'var(--krds-space-2)', alignItems: 'flex-start', margin: '0 0 var(--krds-space-4)' }}>
          <input type="checkbox" checked={unexplained} onChange={(e) => setUnexplained(e.target.checked)} style={{ width: 24, height: 24, marginTop: 0, flex: '0 0 auto' }} />
          <span>바꾼 사람을 모르는 변경만 보기 — 로그인 서버 기록 없이 실제 권한이 달라져 맞춘 것</span>
        </label>
        <div style={{ display: 'flex', gap: 'var(--krds-space-3)', flexWrap: 'wrap' }}>
          <Button onClick={() => !busy && search(query.trim(), unexplained)}>찾기</Button>
          {filtered && (
            <Button
              variant="secondary"
              onClick={() => {
                setQuery('');
                setUnexplained(false);
                search('', false);
                document.getElementById(TITLE_ID)?.focus();
              }}
            >
              전체 보기
            </Button>
          )}
        </div>
      </Card>
      {error && <Alert tone="danger" title={error} focusKey={error} />}
      <LiveRegion>
        {notice && <p style={{ margin: '0 0 var(--krds-space-3)', fontSize: 'var(--krds-text-sm)', color: 'var(--krds-fg-muted)' }}>{notice}</p>}
      </LiveRegion>
      {!page && !error && <p role="status">불러오는 중…</p>}
      {page && (
        <Card title={listTitle} titleId={TITLE_ID}>
          {page.items.length === 0 ? (
            <p style={{ margin: 0 }}>{filtered ? '조건에 맞는 기록이 없습니다.' : '아직 옮긴 기록이 없습니다.'}</p>
          ) : (
            <TableScroll label="권한 변경 기록">
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--krds-text-sm)' }}>
                <thead>
                  <tr>
                    {['순번', '시각', '구분', '대상 계정', '권한', '바꾼 사람'].map((h) => (
                      <th key={h} scope="col" style={{ ...th, whiteSpace: 'nowrap' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {page.items.map((e) => (
                    <tr key={e.seq}>
                      <td style={td}>{e.seq}</td>
                      <td style={td}>{kst(e.occurredAt)}</td>
                      <td style={td}>
                        <strong>{labelOf(ACCESS_GRANT_ACTION_LABEL, e.action)}</strong>
                        <br />
                        {labelOf(ACCESS_GRANT_KIND_LABEL, e.changeKind, e.changeKind)}
                        {e.enabled === false && ' · 사용 중지 상태'}
                      </td>
                      <td style={{ ...td, wordBreak: 'break-all' }}>
                        {e.username ?? e.subject}
                        {e.username && (
                          <>
                            <br />
                            <span style={{ color: 'var(--krds-fg-muted)' }}>{e.subject}</span>
                          </>
                        )}
                      </td>
                      <td style={{ ...td, wordBreak: 'break-word' }}>
                        {e.missing ? '계정이 로그인 서버에 없음 — 권한 없음' : roleText(e.roles)}
                        {(e.added.length > 0 || e.removed.length > 0) && (
                          <>
                            <br />
                            <span style={{ color: 'var(--krds-fg-muted)' }}>
                              {e.added.length > 0 && `더해짐: ${roleText(e.added)}`}
                              {e.added.length > 0 && e.removed.length > 0 && ' · '}
                              {e.removed.length > 0 && `빠짐: ${roleText(e.removed)}`}
                            </span>
                          </>
                        )}
                      </td>
                      <td style={{ ...td, wordBreak: 'break-all' }}>
                        {e.actor ?? (e.changeKind === 'RECONCILED' ? '모름 — 실제 권한과 맞춰 본 기록' : '-')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          )}
          {page.nextBefore !== null && (
            <div style={{ marginTop: 'var(--krds-space-4)' }}>
              <Button variant="secondary" onClick={() => !busy && void load(applied, appliedUnexplained, page.nextBefore ?? undefined)}>
                더 보기
              </Button>
            </div>
          )}
        </Card>
      )}
    </>
  );
}
