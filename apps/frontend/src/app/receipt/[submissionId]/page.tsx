'use client';

import { use, useEffect, useState } from 'react';
import { Alert, Button, Card, DescriptionList, cycleTitle } from '@wonseoro/krds';
import { ApiError, NetworkError, api } from '../../../lib/api';
import { loadSession } from '../../../lib/session';
import { formatKst } from '../../../lib/use-deadline';
import { APPLICATION_STATUS_LABEL, labelOf, problemText } from '@wonseoro/contracts';

/**
 * 접수증 — 인쇄용 (계약 getReceipt)
 *
 * 접수증을 받는 것은 지원자가 "접수가 끝났다" 를 확인한 증거다. 서버는 발급할 때마다
 * RECEIPT_ISSUED 로 기록한다. 전에는 API 만 있고 화면이 부르지 않았다.
 *
 * 접수번호·접수 시각의 원본은 대학 서버다. 이 화면은 대학 서버가 준 값만 보인다.
 */
export default function ReceiptPage({ params }: { params: Promise<{ submissionId: string }> }) {
  const { submissionId } = use(params);
  const applicantId = typeof window !== 'undefined' ? (loadSession()?.applicantId ?? '') : '';
  const [receipt, setReceipt] = useState<{
    applicationNumber: string;
    finalizedAt: string;
    admissionTypeName?: string;
    departmentName?: string;
    status?: string;
  } | null>(null);
  const [university, setUniversity] = useState<string | null>(null);
  const [universityName, setUniversityName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const { data } = await api.receipt(submissionId, applicantId);
        setReceipt(data);
      } catch (err) {
        setError(
          err instanceof NetworkError
            ? '대학 접수 서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주십시오.'
            : err instanceof ApiError
              ? problemText(err.problem).detail
              : '접수증을 불러오지 못했습니다.',
        );
      }
      const cycle = await api.currentCycle().catch(() => null);
      if (cycle?.data.universityName) setUniversityName(cycle.data.universityName);
      if (cycle) setUniversity(`${cycle.data.universityName ?? '대학 정보 확인 중'} · ${cycleTitle(cycle.data.admissionYear, cycle.data.name)}`);
    })();
  }, [submissionId, applicantId]);

  if (error) {
    return (
      <Alert tone="danger" title="접수증을 보여 드릴 수 없습니다">
        {error}
      </Alert>
    );
  }
  if (!receipt) return <p role="status">접수증을 불러오는 중…</p>;

  return (
    <Card title="원서 접수증">
      <DescriptionList
        items={[
          ['대학·모집', university ?? '-'],
          [
            '접수번호',
            <strong key="n" style={{ fontSize: 'var(--krds-text-lg)' }}>
              {receipt.applicationNumber}
            </strong>,
          ],
          ['접수 시각', formatKst(receipt.finalizedAt)],
          // T-M2-11 인수기준 — 제출시각·전형·모집단위·상태 (T-M5-56, U-6)
          ['전형', receipt.admissionTypeName ?? '-'],
          ['모집단위', receipt.departmentName ?? '-'],
          ['상태', labelOf(APPLICATION_STATUS_LABEL, receipt.status ?? 'FINALIZED')],
        ]}
      />
      <p style={{ fontSize: 'var(--krds-text-sm)', color: 'var(--krds-fg-muted)' }}>
        {universityName ? `${universityName} 입학처` : '대학 입학처'}가 발급한 접수증입니다. 접수 내용은 이 입학처에
        문의해 주십시오.
      </p>
      <div className="krds-no-print">
        <Button onClick={() => window.print()}>인쇄</Button>
      </div>
    </Card>
  );
}
