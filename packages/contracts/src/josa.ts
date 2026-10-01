/**
 * 한국어 조사 — 받침에 맞춰 붙인다. 화면에 "이(가)"·"을(를)" 을 쓰지 않는다. (T-M5-51·52)
 * 마지막 글자가 한글이 아니면(영문·숫자·기호) 두 형태를 함께 쓴다 — 읽는 법을 알 수 없다.
 */
const PAIRS = {
  '이/가': ['이', '가'],
  '을/를': ['을', '를'],
  '은/는': ['은', '는'],
  '과/와': ['과', '와'],
} as const;

export type Josa = keyof typeof PAIRS | '으로/로';

export function josa(word: string, kind: Josa): string {
  const last = word.trim().slice(-1);
  const code = last.charCodeAt(0);
  const hangul = code >= 0xac00 && code <= 0xd7a3;
  if (kind === '으로/로') {
    if (!hangul) return `${word}(으)로`;
    const final = (code - 0xac00) % 28;
    // ㄹ 받침은 "로" (서울로)
    return `${word}${final === 0 || final === 8 ? '로' : '으로'}`;
  }
  const [withFinal, withoutFinal] = PAIRS[kind];
  if (!hangul) return `${word}${withFinal}(${withoutFinal})`;
  return `${word}${(code - 0xac00) % 28 === 0 ? withoutFinal : withFinal}`;
}
