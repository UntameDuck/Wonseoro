'use client';

import { Alert, Card, DescriptionList } from '@wonseoro/krds';
import { useEffect, useState, type ReactNode } from 'react';
import { NeedsCycle } from '../components/console';
import { adminGet, describe, kst } from '../lib/api';

/**
 * 콘솔 첫 화면 — 지금 처리할 일. (T-M5-50)
 *
 * 전에는 "이 콘솔에서 하는 일 / 하지 않는 일" 설명문이었다. 그 원칙(2인 승인·사유 기록·결정 문서번호)은
 * 각 화면이 버튼 옆에 이유로 말하고, 전체 설명은 운영 안내(apps/admin-web/README.md)로 옮겼다.
 * 담당자가 콘솔을 열면 먼저 알아야 하는 것은 기다리는 승인과 풀리지 않은 불일치다 — 기존 조회 API 로 센다.
 */
export default function Home() {
  return (
    <>
      <h1 style={{ fontSize: 'var(--krds-text-2xl)', marginTop: 0 }}>입학처 콘솔</h1>
      <NeedsCycle>{(cycle) => <Today cycleId={cycle.id} />}</NeedsCycle>
      <Card title="메뉴">
        <ul style={{ margin: 0, paddingLeft: '1.2em', lineHeight: 1.8 }}>
          <li>
            <a href="/config">설정 승인</a> — 전형 양식·서류·보존기간 변경 초안 검토·승인·적용
          </li>
          <li>
            <a href="/deadline">마감 · 연장</a> — 입학처 결정에 따른 마감 연장 기록·승인·적용
          </li>
          <li>
            <a href="/reconciliation">대조 · 예외</a> — 결제·접수·통합 조회 반영이 어긋난 건 해소
          </li>
          <li>
            <a href="/status">장애 공지</a> — 이 대학 접수 화면에 보일 공지 발행·해제
          </li>
          <li>
            <a href="/support">상담 조회</a> — 접수번호·상담 확인번호로 접수·결제 상태 확인 (조회마다 증적번호가 남습니다)
          </li>
          <li>
            <a href="/privacy">권리 요청</a> — 지원자의 개인정보 열람·정정·삭제·처리정지 요청을 기한 안에 처리·회신
          </li>
          <li>
            <a href="/refunds">전형료 반환</a> — 전형료 반환·면제 감액 신청 검토·결정
          </li>
          <li>
            <a href="/evidence">증적 조회</a> — 한 원서의 접수 과정 확인 (조회 사실이 기록됩니다)
          </li>
          <li>
            <a href="/access-grants">권한 변경 기록</a> — 담당자 계정의 권한 부여·변경·말소 기록 확인 (보안 감사)
          </li>
          <li>
            <a href="/retention">보존기간</a> — 데이터 종류별 파기 계획 확인
          </li>
        </ul>
      </Card>
    </>
  );
}

interface Summary {
  pendingConfigs: number;
  pendingPolicies: number;
  openExceptions: number;
  /** 개인정보 권리 요청 — 처리 중·기한 지남 (G-10, D-84) */
  privacyOpen: number;
  privacyOverdue: number;
  deadlineAt: string | null;
}

function Today({ cycleId }: { cycleId: string }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [configs, policies, exceptions, privacy] = await Promise.all([
          adminGet<{ versions: Array<{ status: string }> }>('config/versions', { cycleId }),
          adminGet<{ policies: Array<{ activatedAt: string | null; deadlineAt: string }> }>('deadline-policies', { cycleId }),
          adminGet<{ exceptions: unknown[] }>('reconciliation/exceptions', { state: 'OPEN' }),
          adminGet<{ counts: { open: number; overdue: number } }>('privacy-requests', { status: 'OPEN', limit: '1' }),
        ]);
        const now = Date.now();
        const current = policies.policies
          .filter((p) => p.activatedAt && Date.parse(p.activatedAt) <= now)
          .sort((a, b) => Date.parse(b.activatedAt!) - Date.parse(a.activatedAt!))[0];
        setSummary({
          pendingConfigs: configs.versions.filter((v) => v.status === 'DRAFT' || v.status === 'APPROVED').length,
          pendingPolicies: policies.policies.filter((p) => !p.activatedAt).length,
          openExceptions: exceptions.exceptions.length,
          privacyOpen: privacy.counts.open,
          privacyOverdue: privacy.counts.overdue,
          deadlineAt: current?.deadlineAt ?? null,
        });
        setError(null);
      } catch (err) {
        setError(describe(err));
      }
    })();
  }, [cycleId]);

  if (error) return <Alert tone="danger" title={`업무 현황을 불러오지 못했습니다. ${error}`} />;
  if (!summary) {
    return (
      <Card title="지금 처리할 일">
        <p role="status" style={{ margin: 0 }}>
          불러오는 중…
        </p>
      </Card>
    );
  }

  const count = (n: number, href: string, label: string): ReactNode =>
    n === 0 ? (
      <span>없음</span>
    ) : (
      <a href={href}>
        <strong>{n}건</strong> — {label}
      </a>
    );

  return (
    <Card title="지금 처리할 일">
      <DescriptionList
        items={[
          ['승인 대기 설정', count(summary.pendingConfigs, '/config', '검토·승인하기')],
          ['승인 대기 마감 정책', count(summary.pendingPolicies, '/deadline', '검토·승인하기')],
          ['미해결 불일치', count(summary.openExceptions, '/reconciliation', '확인·해소하기')],
          [
            '개인정보 권리 요청',
            count(
              summary.privacyOpen,
              '/privacy',
              summary.privacyOverdue > 0 ? `처리 기한이 지난 요청 ${summary.privacyOverdue}건 포함 — 처리·회신하기` : '처리·회신하기',
            ),
          ],
          ['지금 적용 중인 마감', summary.deadlineAt ? kst(summary.deadlineAt) : '적용된 마감 정책 없음'],
        ]}
      />
    </Card>
  );
}
