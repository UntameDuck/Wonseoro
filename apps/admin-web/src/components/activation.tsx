'use client';

import { Alert } from '@wonseoro/krds';
import { kst } from '../lib/api';

export interface ActivationView {
  activationId: string;
  subjectType: 'DEADLINE_POLICY' | 'CONFIG_VERSION';
  subjectVersion: string;
  kind: 'ACTIVATE' | 'EXTEND' | 'ROLLBACK';
  effectiveAt: string;
  operatorId: string;
  reason: string | null;
  decisionRef: string | null;
  supersedesVersion: string | null;
  content: Record<string, unknown>;
  keyId: string;
  recordedAt: string;
  signature: 'VALID' | 'INVALID' | 'UNKNOWN_KEY';
}

export interface ActivationList {
  activations: ActivationView[];
  allSignaturesValid: boolean;
  systemChain: { valid: boolean; brokenAt?: string; checked: number };
}

const KIND = { ACTIVATE: '적용', EXTEND: '연장', ROLLBACK: '되돌리기' } as const;
const SIG = {
  VALID: '✓ 서명 확인',
  INVALID: '✕ 서명 불일치',
  UNKNOWN_KEY: '? 모르는 키',
} as const;

export function ActivationBadge({ text }: { text: string }) {
  return (
    <p style={{ fontSize: 'var(--krds-text-sm)', color: 'var(--krds-fg-muted)', margin: 'var(--krds-space-3) 0 0' }}>
      {text}
    </p>
  );
}

/**
 * 서명된 적용 이력 — T-M3-15
 *
 * **검증이 하나라도 실패하면 표보다 먼저 말한다.** 표 안의 한 칸으로 두면 묻힌다.
 * 서명은 "남은 기록이 진짜인가" 를, 체인은 "빠진 기록이 없는가" 를 말한다.
 * 둘 중 하나라도 깨지면 이 이력 전체를 증거로 쓸 수 없다.
 */
export function ActivationTable({ list, filter }: { list: ActivationList; filter?: ActivationView['subjectType'] }) {
  const rows = filter ? list.activations.filter((a) => a.subjectType === filter) : list.activations;
  return (
    <>
      {!list.allSignaturesValid && (
        <Alert tone="danger" title="서명이 맞지 않는 적용 기록이 있습니다">
          아래 표에서 &lsquo;서명 불일치&rsquo; 로 표시된 기록은 적용 뒤에 바뀌었을 수 있습니다.
          이 이력을 증거로 쓰기 전에 보안 담당자에게 알리십시오.
        </Alert>
      )}
      {!list.systemChain.valid && (
        <Alert tone="danger" title="운영자 감사 체인이 끊겨 있습니다">
          빠지거나 고쳐진 기록이 있습니다. 끊긴 지점: {list.systemChain.brokenAt ?? '-'}
        </Alert>
      )}
      {list.allSignaturesValid && list.systemChain.valid && (
        <p style={{ fontSize: 'var(--krds-text-sm)', color: 'var(--krds-fg-muted)', margin: '0 0 var(--krds-space-2)' }}>
          <span aria-hidden="true">✓ </span>모든 서명이 맞고, 운영자 감사 체인 {list.systemChain.checked}건이 끊김 없이 이어집니다.
        </p>
      )}
      {rows.length === 0 ? (
        <p>적용 기록이 없습니다.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--krds-text-sm)' }}>
          <thead>
            <tr>
              {['효력 시각', '종류', '버전', '이전', '담당', '사유 · 결정번호', '서명'].map((h) => (
                <th key={h} scope="col" style={th}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.activationId}>
                <td style={td}>{kst(a.effectiveAt)}</td>
                <td style={td}>{KIND[a.kind]}</td>
                <td style={td}>{a.subjectVersion}</td>
                <td style={td}>{a.supersedesVersion ?? '-'}</td>
                <td style={td}>{a.operatorId}</td>
                <td style={td}>
                  {a.reason ?? '-'}
                  {a.decisionRef && (
                    <>
                      <br />
                      <strong>결정 {a.decisionRef}</strong>
                    </>
                  )}
                </td>
                <td style={{ ...td, fontWeight: a.signature === 'VALID' ? 400 : 700, color: a.signature === 'VALID' ? 'inherit' : 'var(--krds-danger)' }}>
                  {SIG[a.signature]}
                  <br />
                  <span style={{ color: 'var(--krds-fg-muted)', fontWeight: 400 }}>{a.keyId}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

export const th = {
  textAlign: 'left',
  padding: 'var(--krds-space-2)',
  borderBottom: '2px solid var(--krds-border)',
} as const;
export const td = {
  padding: 'var(--krds-space-2)',
  borderBottom: '1px solid var(--krds-border)',
  verticalAlign: 'top',
} as const;
