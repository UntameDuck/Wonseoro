/**
 * Config 변경 Diff — 기술설계서 v1.1 §A14 (T-M3-02)
 *
 * **왜 2인 승인만으로는 부족한가**
 *
 * 구현 검증 중 빈 Config(`{"forms":{}}`)를 절차대로 활성화한 적이 있다.
 * 승인 두 명, 활성화 성공 — 절차는 전부 정상이었다. 그 순간 모든 전형의
 * 추가문항이 사라졌고, 화면은 입력 항목이 없는 원서를 그렸다.
 * **절차를 지켰는데 서비스가 망가졌다.**
 *
 * 승인자가 "무엇이 바뀌는가" 를 보지 못하면 사람이 둘이어도 사고를 막지 못한다.
 * 그래서 §A14 는 2인 승인과 **함께** Diff 를 요구한다.
 *
 * **제거가 추가보다 위험하다**
 *
 * 항목을 더하는 변경은 잘못돼도 대개 화면에 새 칸이 하나 생기는 정도다.
 * 항목을 없애는 변경은 이미 접수 중인 지원자의 입력을 무효로 만들고,
 * 검증을 통과시켜 버린다. 그래서 위험도를 방향으로 나눈다.
 */
export type ChangeKind = 'ADDED' | 'REMOVED' | 'CHANGED';
export type Risk = 'INFO' | 'WARN' | 'DESTRUCTIVE';
export interface ConfigChange {
    /** JSON Pointer 유사 경로. 예: `forms.EARLY.properties.selfIntro` */
    path: string;
    kind: ChangeKind;
    risk: Risk;
    /** 사람이 읽는 한 줄. 승인 화면에 그대로 쓴다. */
    summary: string;
    before?: unknown;
    after?: unknown;
}
export interface ConfigDiff {
    changes: ConfigChange[];
    destructive: ConfigChange[];
    /**
     * 승인자가 본 것과 서버가 지금 보는 것이 같은지 판정하는 값.
     * 기준(현재 ACTIVE)이나 대상이 바뀌면 달라진다.
     */
    digest: string;
    /** 아무것도 바뀌지 않는 Config 를 활성화하는 것은 대개 실수다. */
    identical: boolean;
    /**
     * 설정 검사 경고 (config-lint). 동작은 하지만 의도와 다를 수 있는 것 — 모르는 전형 코드 등.
     * digest 에 넣지 않는다 — 경고는 변경이 아니다.
     */
    warnings?: string[];
}
/**
 * 두 Config 를 비교한다.
 *
 * 깊이 제한을 둔다. 전체를 끝까지 펼치면 변경 하나가 수백 줄로 보이고,
 * 그러면 승인자는 읽지 않는다. 읽히지 않는 Diff 는 없는 Diff 와 같다.
 */
export declare function diffConfig(before: Record<string, unknown>, after: Record<string, unknown>, 
/** 전형 코드 → 이름. 요약을 "학생부종합전형 — '내신 성적' 항목" 처럼 쓰는 데만 쓴다 (T-M5-51). */
typeNames?: Record<string, string>): ConfigDiff;
/**
 * 승인 화면이 보여준 Diff 와 지금의 Diff 가 같은지 확인한다.
 *
 * 승인은 "이 변경에 동의한다" 는 뜻이지 "이 설정 ID 에 동의한다" 가 아니다.
 * 본 뒤에 기준이 바뀌면 같은 승인이 다른 의미가 된다.
 */
export declare function digestOf(changes: readonly ConfigChange[]): string;
