'use client';

/**
 * 2인 승인 현황 — 기술설계서 v1.1 §A14, §01 E "단독 운영자 1명으로 마감시간 변경 불가"
 *
 * **막는 것은 서버다. 화면은 왜 안 되는지를 먼저 보여준다.**
 * 버튼을 눌러 403 을 받고 나서야 "작성자는 승인할 수 없다" 를 알게 하면, 운영자는
 * 규칙을 장애로 받아들인다. 그래서 할 수 없는 행동은 이유와 함께 미리 비활성화한다.
 * 그래도 서버 검사는 그대로다 — 화면을 우회해 API 를 불러도 같은 규칙에 걸린다.
 */
export interface ApprovalState {
  createdBy: string;
  approvedBy: string[];
}

export type ApprovalBlock = null | string;

/** 이 담당자가 지금 승인할 수 있는가. 안 되면 이유. */
export function approveBlock(s: ApprovalState, operator: string | null): ApprovalBlock {
  if (!operator) return '담당자를 먼저 지정해 주십시오.';
  if (s.approvedBy.length >= 2) return '승인이 모두 끝났습니다.';
  if (operator === s.createdBy) return '작성자 본인은 승인할 수 없습니다. 다른 담당자 두 명이 승인해야 합니다.';
  if (s.approvedBy.includes(operator)) return '이미 승인하셨습니다. 다른 담당자의 승인이 필요합니다.';
  return null;
}

/** 적용할 수 있는가. 승인 두 명이 채워져야 한다. */
export function activateBlock(s: ApprovalState, operator: string | null): ApprovalBlock {
  if (!operator) return '담당자를 먼저 지정해 주십시오.';
  const remaining = 2 - s.approvedBy.length;
  if (remaining > 0) return `승인이 ${remaining}명 더 필요합니다. 한 사람이 혼자 적용할 수 없습니다.`;
  return null;
}

export function ApprovalProgress({ state }: { state: ApprovalState }) {
  const slots = [state.approvedBy[0] ?? null, state.approvedBy[1] ?? null];
  return (
    <ol
      aria-label="승인 현황"
      style={{
        display: 'flex',
        gap: 'var(--krds-space-3)',
        listStyle: 'none',
        padding: 0,
        margin: 'var(--krds-space-3) 0',
        flexWrap: 'wrap',
        fontSize: 'var(--krds-text-sm)',
      }}
    >
      <li style={chip('var(--krds-bg-muted)')}>
        작성 <strong>{state.createdBy || '-'}</strong>
      </li>
      {slots.map((who, i) => (
        <li key={i} style={chip(who ? 'var(--krds-success-weak)' : 'var(--krds-bg)')}>
          {/* 색만으로 구분하지 않는다. 표시 문자와 글로 함께 말한다. (§07) */}
          <span aria-hidden="true">{who ? '✓ ' : '○ '}</span>
          승인 {i + 1} <strong>{who ?? '대기'}</strong>
        </li>
      ))}
    </ol>
  );
}

function chip(background: string) {
  return {
    padding: 'var(--krds-space-2) var(--krds-space-3)',
    border: '1px solid var(--krds-border)',
    borderRadius: 'var(--krds-radius)',
    background,
  } as const;
}

/** 비활성화된 버튼 옆에 이유를 글로 둔다. 툴팁만으로는 키보드·스크린리더 사용자가 못 본다. */
export function BlockReason({ reason, id }: { reason: ApprovalBlock; id: string }) {
  if (!reason) return null;
  return (
    <p id={id} style={{ margin: 'var(--krds-space-2) 0 0', fontSize: 'var(--krds-text-sm)', color: 'var(--krds-fg-muted)' }}>
      {reason}
    </p>
  );
}
