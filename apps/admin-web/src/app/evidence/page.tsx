'use client';

import { Alert, Button, Card, DescriptionList, Field } from '@wonseoro/krds';
import { useEffect, useState } from 'react';
import { td, th } from '../../components/activation';
import { useConsole } from '../../components/console';
import { adminGet, describe, kst } from '../../lib/api';

interface EvidencePackage {
  applicationId: string;
  generatedAt: string;
  evidenceHash: string;
  application: { status: string; admissionTypeCode: string; departmentCode: string };
  submission: {
    applicationNumber: string;
    requestedAt: string;
    paymentVerifiedAt: string;
    finalizedAt: string;
    deadlinePolicyVersion: string;
    configVersion: string;
    serverClockOffsetMs: number;
  } | null;
  deadlinePolicy: {
    version: string;
    mode: string;
    deadlineAt: string;
    approvedBy: string[];
    signedActivation: {
      kind: string;
      effectiveAt: string;
      operatorId: string;
      decisionRef: string | null;
      keyId: string;
      signature: string;
      matchesPolicy: boolean;
    } | null;
  } | null;
  payments: Array<{ status: string; amount: number; verifiedAt: string | null }>;
  documents: Array<{ documentType: string; status: string; sha256: string }>;
  timeline: Array<{ at: string; action: string; result: string; actorType: string; eventHash: string }>;
  chainVerification: { valid: boolean; checked: number; brokenAt?: string };
}

/**
 * 증적 조회 — T-M3-13, v1.1 §A11·§C6 · §01 E "접수과정을 Evidence Package 로 재구성"
 *
 * **조회 사유가 필수이고, 조회 사실 자체가 기록된다.** (ADMIN_VIEWED_PII, §8.3)
 * 화면에서 그것을 먼저 말한다. 모르고 열었다가 기록에 남는 것과 알고 여는 것은 다르다.
 *
 * 무결성 결과를 표 아래에 두지 않는다. 체인이 끊겼거나 적용 정책의 서명이 맞지 않으면
 * 아래 내용 전부를 증거로 쓸 수 없으므로, 맨 위에서 말한다.
 */
export default function EvidencePage() {
  const { operator } = useConsole();
  const [applicationId, setApplicationId] = useState('');
  const [reason, setReason] = useState('');
  const [pkg, setPkg] = useState<EvidencePackage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 대조 화면에서 넘어오면 원서 번호를 채워 둔다. 사유는 채우지 않는다 — 사람이 적어야 한다.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('applicationId');
    if (id) setApplicationId(id);
  }, []);

  const block = !operator
    ? '담당자를 먼저 지정해 주십시오. 누가 열람했는지 기록에 남습니다.'
    : !/^[0-9a-f-]{36}$/i.test(applicationId.trim())
      ? '원서 ID(UUID)를 입력해 주십시오.'
      : reason.trim().length < 5
        ? '조회 사유를 구체적으로 입력해 주십시오.'
        : null;

  const load = async () => {
    setBusy(true);
    setPkg(null);
    try {
      setPkg(await adminGet<EvidencePackage>(`evidence/applications/${applicationId.trim()}`, { reason }));
      setError(null);
    } catch (err) {
      setError(describe(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1 style={{ fontSize: 'var(--krds-text-2xl)', marginTop: 0 }}>증적 조회</h1>
      <Card>
        <Alert tone="info" title="이 조회는 기록됩니다">
          누가 언제 어떤 사유로 이 원서의 증적을 열람했는지 감사 체인에 남습니다.
        </Alert>
        <Field label="원서 ID" value={applicationId} onChange={setApplicationId} required />
        <Field label="조회 사유" value={reason} onChange={setReason} required multiline maxLength={300} hint="예: 지원자 문의 — 마감 직전 제출 여부 확인 (민원번호 …)" />
        <Button disabled={busy || block !== null} onClick={() => void load()}>
          증적 열기
        </Button>
        {block && (
          <p style={{ margin: 'var(--krds-space-2) 0 0', fontSize: 'var(--krds-text-sm)', color: 'var(--krds-fg-muted)' }}>{block}</p>
        )}
      </Card>
      {error && <Alert tone="danger" title={error} />}
      {pkg && <EvidenceView pkg={pkg} />}
    </>
  );
}

function EvidenceView({ pkg }: { pkg: EvidencePackage }) {
  const signed = pkg.deadlinePolicy?.signedActivation ?? null;
  const policyTrusted = signed ? signed.signature === 'VALID' && signed.matchesPolicy : false;
  return (
    <>
      {pkg.chainVerification.valid ? (
        <Alert tone="success" title={`감사 체인 ${pkg.chainVerification.checked}건이 끊김 없이 이어집니다`} />
      ) : (
        <Alert tone="danger" title="감사 체인이 끊겨 있습니다 — 이 증적을 그대로 쓸 수 없습니다">
          끊긴 지점: {pkg.chainVerification.brokenAt}
        </Alert>
      )}
      {pkg.submission && !pkg.deadlinePolicy && (
        <Alert tone="danger" title="마감 판정에 쓰인 정책을 찾을 수 없습니다">
          접수 기록의 정책 버전({pkg.submission.deadlinePolicyVersion})이 마감 정책 이력에 없습니다.
          개발용 환경변수 정책으로 판정된 접수로 보입니다. &ldquo;어떤 마감으로 판정했는가&rdquo; 에
          답할 수 없으므로 분쟁 증거로 쓸 수 없습니다.
        </Alert>
      )}
      {pkg.deadlinePolicy && !signed && (
        <Alert tone="warning" title="적용된 마감 정책의 서명 기록이 없습니다">
          서명 기록이 도입되기 전에 적용된 정책이거나 개발용 정책입니다. 승인자는 있지만 &ldquo;누가 적용했는가&rdquo;
          와 &ldquo;그 뒤로 바뀌지 않았는가&rdquo; 는 증명하지 못합니다.
        </Alert>
      )}
      {signed && !policyTrusted && (
        <Alert tone="danger" title="적용된 마감 정책이 서명된 기록과 다릅니다">
          정책 행이 적용 뒤에 바뀌었거나 서명이 맞지 않습니다.
        </Alert>
      )}

      <Card title="접수">
        {pkg.submission ? (
          <DescriptionList
            items={[
              ['접수번호', <strong key="n">{pkg.submission.applicationNumber}</strong>],
              ['제출 요청', kst(pkg.submission.requestedAt)],
              ['결제 확인', kst(pkg.submission.paymentVerifiedAt)],
              ['접수 확정', kst(pkg.submission.finalizedAt)],
              ['서버 시계 오차', `${pkg.submission.serverClockOffsetMs} ms`],
              ['적용 설정', pkg.submission.configVersion],
            ]}
          />
        ) : (
          <p style={{ margin: 0 }}>접수가 확정되지 않은 원서입니다. (상태 {pkg.application.status})</p>
        )}
      </Card>

      {pkg.deadlinePolicy && (
        <Card title="판정에 쓰인 마감 정책">
          <DescriptionList
            items={[
              ['정책', `${pkg.deadlinePolicy.version} · ${pkg.deadlinePolicy.mode}`],
              ['마감', kst(pkg.deadlinePolicy.deadlineAt)],
              ['승인', pkg.deadlinePolicy.approvedBy.join(', ') || '-'],
              [
                '적용 기록',
                signed
                  ? `${signed.kind} · ${kst(signed.effectiveAt)} · ${signed.operatorId}${signed.decisionRef ? ` · 결정 ${signed.decisionRef}` : ''} · ${policyTrusted ? '✓ 서명 확인' : '✕ 불일치'}`
                  : '없음',
              ],
            ]}
          />
        </Card>
      )}

      <Card title={`Timeline (${pkg.timeline.length}건)`}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--krds-text-sm)' }}>
          <thead>
            <tr>
              {['시각', '행위', '결과', '주체', '해시'].map((h) => (
                <th key={h} scope="col" style={th}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pkg.timeline.map((t) => (
              <tr key={t.eventHash}>
                <td style={td}>{kst(t.at)}</td>
                <td style={td}>{t.action}</td>
                <td style={td}>{t.result}</td>
                <td style={td}>{t.actorType}</td>
                <td style={td}>
                  <code>{t.eventHash.slice(0, 10)}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="결제 · 서류">
        <DescriptionList
          items={[
            ...pkg.payments.map((p, i): [string, string] => [`결제 ${i + 1}`, `${p.status} · ${p.amount.toLocaleString('ko-KR')}원 · 확인 ${kst(p.verifiedAt)}`]),
            ...pkg.documents.map((d): [string, string] => [d.documentType, `${d.status} · sha256 ${d.sha256.slice(0, 12)}…`]),
          ]}
        />
        <p style={{ fontSize: 'var(--krds-text-sm)', color: 'var(--krds-fg-muted)', marginBottom: 0 }}>
          이름·연락처·원서 본문·첨부 원본은 담지 않습니다. 해시로 동일성만 보입니다. 증적 해시 {pkg.evidenceHash.slice(0, 16)}…
        </p>
      </Card>
    </>
  );
}
