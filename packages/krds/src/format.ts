/**
 * 날짜·시각 표기 — 두 앱(지원자 웹·관리자 콘솔)이 이것 하나만 쓴다. (T-M5-54, docs/08 결정 7)
 *
 * 기준은 노션 첨부 와이어프레임(`docs/spec-assets/krds-wireframe.html`)이다 — 마감 "2026.09.11 18:00",
 * 저장 "저장 완료 17:17:42". 전에는 화면마다 `toLocaleString` 을 따로 불러 표기가 여섯 가지 섞였다
 * ("2026. 12. 31. 오후 6:00:00", "18시 0분 0초", "2026. 09. 30. 23:41" …). 마감 배너는 날짜 없이 시각만 보였다.
 *
 * 저장은 UTC, 표시는 **언제나 한국 시간**이다. 지원자 PC 의 시간대와 무관하다.
 */
const ZONE = 'Asia/Seoul';
const KST_OFFSET = '+09:00';

function parts(iso: string | Date): Record<string, string> {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const out: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat('en-GB', {
    timeZone: ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d)) {
    out[p.type] = p.value;
  }
  return out;
}

const empty = (v: string | Date | null | undefined): v is null | undefined =>
  v === null || v === undefined || (typeof v === 'string' && (v === '' || Number.isNaN(Date.parse(v))));

/** 2026.12.31 */
export function formatDate(iso: string | Date | null | undefined): string {
  if (empty(iso)) return '-';
  const p = parts(iso);
  return `${p.year}.${p.month}.${p.day}`;
}

/** 2026.12.31 18:00 — 마감·접수 시각·기록 시각 */
export function formatDateTime(iso: string | Date | null | undefined): string {
  if (empty(iso)) return '-';
  const p = parts(iso);
  return `${p.year}.${p.month}.${p.day} ${p.hour}:${p.minute}`;
}

/** 17:42:13 — 저장 완료처럼 방금 일어난 일. `seconds: false` 면 17:42 */
export function formatTime(iso: string | Date | null | undefined, opts: { seconds?: boolean } = {}): string {
  if (empty(iso)) return '-';
  const p = parts(iso);
  return opts.seconds === false ? `${p.hour}:${p.minute}` : `${p.hour}:${p.minute}:${p.second}`;
}

/**
 * 모집 제목. 모집 이름에 학년도가 이미 있으면 붙이지 않는다 — "2027학년도 2027 수시" 를 만들지 않는다 (U-18).
 */
export function cycleTitle(admissionYear: number, name: string): string {
  return name.includes(String(admissionYear)) || name.includes('학년도') ? name : `${admissionYear}학년도 ${name}`;
}

/**
 * 한국 시간으로 적은 입력(`<input type="datetime-local">` 값, "2026-12-31T18:00")을 UTC ISO 로.
 * 담당자 PC 의 시간대를 쓰지 않는다 — 해외 출장 중에 연장해도 같은 마감이 된다 (U-47).
 */
export function kstInputToIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) return null;
  const t = Date.parse(`${value.length === 16 ? `${value}:00` : value}${KST_OFFSET}`);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** UTC ISO 를 한국 시간 입력값("2026-12-31T18:00")으로. */
export function isoToKstInput(iso: string): string {
  const p = parts(iso);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
