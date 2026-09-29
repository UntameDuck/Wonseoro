/**
 * Peak Mode 예약 → GitOps desired state (T-M4-07, D-48)
 *
 * 대학별 `peak-schedule.yaml` 은 용량 예약이다. 마감시각의 원본이 아니다 — 마감 판정은 관리자
 * 콘솔 2인 승인과 서명된 활성화 기록으로만 바뀐다(R9). 여기서 정하는 것은 "언제 미리 늘리고,
 * 언제 비핵심 작업을 멈추고, 언제 되돌리는가" 뿐이다.
 *
 * 출력은 HelmRelease 가 마지막에 얹는 values overlay(`peak-mode.yaml`)다. 같은 입력이면 같은 바이트를
 * 낸다 — 생성 시각을 넣지 않아서 예약이 바뀌지 않으면 커밋도 생기지 않는다.
 */
import { parse, stringify } from 'yaml';

const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const WINDOW_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;
const MINUTE = 60_000;
/** 오타로 수개월간 확장된 채 남지 않게 한 창의 길이를 제한한다. */
export const MAX_WINDOW_MS = 14 * 24 * 60 * MINUTE;
export const DEFAULT_LEAD_MINUTES = 60;

function fail(message) {
  throw new Error(`peak-schedule: ${message}`);
}

function time(value, field) {
  if (typeof value !== 'string' || !RFC3339.test(value)) {
    fail(`${field} 는 시간대가 포함된 RFC3339 시각이어야 한다 (받은 값: ${JSON.stringify(value)})`);
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) fail(`${field} 를 시각으로 해석할 수 없다: ${value}`);
  return ms;
}

function positiveInt(value, field) {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    fail(`${field} 는 1~100 정수여야 한다 (받은 값: ${JSON.stringify(value)})`);
  }
  return value;
}

/** 예약 파일을 검증해 정규화한다. 잘못된 예약은 조용히 무시하지 않고 실패한다. */
export function parseSchedule(text, expectedUniversity) {
  const doc = parse(text) ?? {};
  if (typeof doc !== 'object' || Array.isArray(doc)) fail('최상위는 객체여야 한다');
  const allowed = new Set(['university', 'leadMinutes', 'windows']);
  for (const key of Object.keys(doc)) if (!allowed.has(key)) fail(`알 수 없는 키: ${key}`);

  if (typeof doc.university !== 'string' || !doc.university) fail('university 가 없다');
  if (expectedUniversity && doc.university !== expectedUniversity) {
    fail(`university ${doc.university} 가 경로의 ${expectedUniversity} 와 다르다`);
  }
  const leadMinutes = doc.leadMinutes ?? DEFAULT_LEAD_MINUTES;
  if (!Number.isInteger(leadMinutes) || leadMinutes < 0 || leadMinutes > 24 * 60) {
    fail('leadMinutes 는 0~1440 정수여야 한다');
  }

  const windows = (doc.windows ?? []).map((raw, index) => {
    const at = `windows[${index}]`;
    if (!raw || typeof raw !== 'object') fail(`${at} 는 객체여야 한다`);
    const keys = new Set(['id', 'scaleOutAt', 'suspendJobsAt', 'endsAt', 'apiMinReplicas']);
    for (const key of Object.keys(raw)) if (!keys.has(key)) fail(`${at} 알 수 없는 키: ${key}`);
    if (typeof raw.id !== 'string' || !WINDOW_ID.test(raw.id)) fail(`${at}.id 는 소문자·숫자·- 로 된 식별자여야 한다`);

    const window = {
      id: raw.id,
      scaleOutAt: raw.scaleOutAt,
      suspendJobsAt: raw.suspendJobsAt,
      endsAt: raw.endsAt,
      scaleOutMs: time(raw.scaleOutAt, `${at}.scaleOutAt`),
      suspendJobsMs: time(raw.suspendJobsAt, `${at}.suspendJobsAt`),
      endsMs: time(raw.endsAt, `${at}.endsAt`),
      apiMinReplicas: positiveInt(raw.apiMinReplicas, `${at}.apiMinReplicas`),
    };
    if (!(window.scaleOutMs <= window.suspendJobsMs)) fail(`${at} 사전 확장이 작업 억제보다 늦다`);
    if (!(window.suspendJobsMs < window.endsMs)) fail(`${at} 작업 억제가 종료보다 늦거나 같다`);
    if (window.endsMs - window.scaleOutMs > MAX_WINDOW_MS) fail(`${at} 창이 14일을 넘는다`);
    return window;
  });

  const sorted = [...windows].sort((a, b) => a.scaleOutMs - b.scaleOutMs);
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].id === sorted[i - 1].id) fail(`창 id 중복: ${sorted[i].id}`);
    // 선행 시간까지 겹치지 않아야 한 시각에 한 창만 고른다
    if (sorted[i].scaleOutMs - leadMinutes * MINUTE < sorted[i - 1].endsMs) {
      fail(`창 ${sorted[i - 1].id} 와 ${sorted[i].id} 가 (선행 ${leadMinutes}분 포함) 겹친다`);
    }
  }
  if (new Set(windows.map((w) => w.id)).size !== windows.length) fail('창 id 중복');

  return { university: doc.university, leadMinutes, windows: sorted };
}

/**
 * 지금 적용해야 할 Peak 상태.
 *
 * 시작은 선행 시간만큼 앞당긴다 — 커밋·Pull·Rollout 이 끝난 뒤에 사전 확장 시각을 맞기 위해서다.
 * 종료는 앞당기지 않는다. 늦게 줄이는 쪽이 안전하다.
 */
export function planPeakMode(schedule, nowMs) {
  const lead = schedule.leadMinutes * MINUTE;
  const window = schedule.windows.find((w) => w.scaleOutMs - lead <= nowMs && nowMs < w.endsMs);
  if (!window) return { active: false, window: null };
  return { active: true, window };
}

/** HelmRelease 의 마지막 values 파일. 같은 계획이면 같은 바이트. */
export function renderOverlay(schedule, plan) {
  const header = [
    `# 자동 생성 — scripts/peak-mode-sync.mjs 가 peak-schedule.yaml 에서 만든다. 손으로 고치지 않는다.`,
    `# ${schedule.university} Peak Mode desired state (T-M4-07, D-48)`,
  ];
  let peakMode;
  if (plan.active) {
    const w = plan.window;
    header.push(`# 창 ${w.id}: 확장 ${w.scaleOutAt} · 작업 억제 ${w.suspendJobsAt} · 종료 ${w.endsAt}`);
    peakMode = {
      enabled: true,
      window: w.id,
      scheduledActivation: w.suspendJobsAt,
      scheduledEnd: w.endsAt,
    };
    if (w.apiMinReplicas !== undefined) peakMode.apiMinReplicas = w.apiMinReplicas;
  } else {
    header.push('# 진행 중인 예약 창 없음 — 평시');
    // 첨부 values-m 의 예시 예약 시각이 운영에서 영구 억제로 남지 않게 명시적으로 비운다
    peakMode = { enabled: false, window: '', scheduledActivation: '', scheduledEnd: '' };
  }
  // 시각을 따옴표로 고정한다 — YAML 1.1 파서가 timestamp 로 바꿔 다시 쓰지 못하게
  return `${header.join('\n')}\n${stringify({ peakMode }, { defaultStringType: 'QUOTE_DOUBLE', defaultKeyType: 'PLAIN' })}`;
}

/**
 * 저장소에 들어 있는 overlay 가 예약과 맞는지 — 평시이거나, 예약된 창 하나를 그대로 옮긴 것이어야 한다.
 * 시각에 따라 달라지는 판정은 하지 않는다(CI 가 시계에 따라 깨지면 안 된다).
 */
export function assertOverlayConsistent(schedule, rawOverlayText) {
  // Windows 체크아웃(autocrlf)의 CRLF 는 내용 차이가 아니다
  const overlayText = rawOverlayText.replace(/\r\n/g, '\n');
  const overlay = parse(overlayText)?.peakMode;
  if (!overlay || typeof overlay !== 'object') fail('overlay 에 peakMode 가 없다');
  if (overlay.enabled === false) {
    if (overlayText !== renderOverlay(schedule, { active: false, window: null })) {
      fail('평시 overlay 가 생성기 출력과 다르다 — 손으로 고쳤는가');
    }
    return null;
  }
  const window = schedule.windows.find((w) => w.id === overlay.window);
  if (!window) fail(`overlay 의 창 ${overlay.window} 가 예약에 없다`);
  if (overlayText !== renderOverlay(schedule, { active: true, window })) {
    fail(`overlay 가 창 ${window.id} 의 생성기 출력과 다르다 — 손으로 고쳤는가`);
  }
  return window.id;
}
