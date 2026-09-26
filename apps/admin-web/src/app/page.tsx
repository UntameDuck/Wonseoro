import { Card } from '@wonseoro/krds';

/**
 * 콘솔 첫 화면. 무엇을 하는 곳인지와 **하지 않는 것**을 먼저 말한다.
 * 운영자가 이 콘솔로 할 수 없는 일을 할 수 있다고 믿으면, 그 믿음이 사고가 된다.
 */
export default function Home() {
  return (
    <>
      <h1 style={{ fontSize: 'var(--krds-text-2xl)', marginTop: 0 }}>입학처 콘솔</h1>
      <Card title="이 콘솔에서 하는 일">
        <ul style={{ margin: 0, paddingLeft: '1.2em', lineHeight: 1.8 }}>
          <li>
            <a href="/config">설정 승인</a> — 전형 양식·전형료·보존정책 변경을{' '}
            <strong>무엇이 바뀌는지 확인하고</strong> 두 명이 승인합니다
          </li>
          <li>
            <a href="/deadline">마감 · 연장</a> — 입학처 결정에 따른 마감 연장을 기록하고 적용합니다.
            적용 기록은 서명되어 고칠 수 없습니다
          </li>
          <li>
            <a href="/reconciliation">대조 · 예외</a> — 결제·접수·중앙 반영이 어긋난 건만 모아 보고,
            사유와 함께 해소합니다
          </li>
          <li>
            <a href="/evidence">증적 조회</a> — 한 원서의 접수 과정을 재구성합니다. 조회 사실이 기록됩니다
          </li>
        </ul>
      </Card>
      <Card title="이 콘솔이 하지 않는 일">
        <ul style={{ margin: 0, paddingLeft: '1.2em', lineHeight: 1.8 }}>
          <li>혼자서 마감시각·설정을 바꾸는 것 — 작성자가 아닌 두 명의 승인이 필요합니다</li>
          <li>데이터를 직접 고치는 것 — 모든 보정은 사유와 함께 기록됩니다</li>
          <li>마감 연장을 결정하는 것 — 입학처 결정 문서번호 없이는 연장을 만들 수 없습니다</li>
        </ul>
      </Card>
    </>
  );
}
