'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, NetworkError, api, newIdempotencyKey } from './api';

export type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: string }
  | { kind: 'failed'; reason: string; retryable: boolean };

/**
 * 자동저장 — 기술설계서 v1.1 §10 §4
 *
 * 규칙
 *   - 15~30초 Debounce 또는 의미 있는 변경 시 저장
 *   - PATCH + If-Match/ETag
 *   - **동일 값 반복 저장 억제** (마감 피크에 쓸데없는 쓰기를 만들지 않는다)
 *   - 접속이 끊기면 클라이언트 임시 큐 → 재연결 시 **서버 상태부터 조회**
 *   - FINALIZED 이후 Draft API 호출 금지
 *
 * 저장 상태는 화면에 **항상 텍스트로** 보여야 한다. (§07)
 * `저장 중` / `저장 완료 17:42:13` / `저장 실패 — 다시 시도`
 */
export function useAutosave(args: {
  applicationId: string | null;
  applicantId: string;
  /** 서버가 준 현재 ETag. 저장에 성공하면 갱신된다. */
  initialEtag: string | null;
  debounceMs?: number;
  /** FINALIZED 이면 저장을 아예 시도하지 않는다. */
  frozen?: boolean;
}) {
  const { applicationId, applicantId, initialEtag, debounceMs = 15_000, frozen } = args;

  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  const etagRef = useRef<string | null>(initialEtag);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 마지막으로 서버에 보낸 내용. 같으면 다시 보내지 않는다. */
  const lastSentRef = useRef<string>('');
  /** 저장 대기 중인 내용. 연결이 끊겨도 여기 남아 있다. */
  const pendingRef = useRef<Record<string, unknown> | null>(null);
  /**
   * 재시도용 키. **같은 내용을 다시 보낼 때는 같은 키를 쓴다.**
   * 매번 새로 만들면 중복 방지가 무의미해진다.
   */
  const keyRef = useRef<string>(newIdempotencyKey('save'));

  useEffect(() => {
    etagRef.current = initialEtag;
  }, [initialEtag]);

  const flush = useCallback(async (): Promise<void> => {
    const fields = pendingRef.current;
    if (!applicationId || !fields || frozen) return;

    const serialized = JSON.stringify(fields);
    if (serialized === lastSentRef.current) {
      // 동일 값 반복 저장 억제. 서버를 찌르지 않는다.
      return;
    }
    const etag = etagRef.current;
    if (!etag) return;

    setState({ kind: 'saving' });
    try {
      const res = await api.patchApplication(
        applicationId,
        fields,
        etag,
        applicantId,
        keyRef.current,
      );
      etagRef.current = res.etag;
      lastSentRef.current = serialized;
      pendingRef.current = null;
      keyRef.current = newIdempotencyKey('save'); // 다음 저장은 새 행동이다
      setState({ kind: 'saved', at: res.data.lastSavedAt ?? res.data.serverTime });
    } catch (err) {
      if (err instanceof NetworkError) {
        // 연결이 끊겼다. 내용은 pendingRef 에 남아 있다. 재연결 시 다시 보낸다.
        setState({
          kind: 'failed',
          reason: '인터넷 연결이 끊어졌습니다. 작성 내용은 보관되어 있습니다.',
          retryable: true,
        });
        return;
      }
      if (err instanceof ApiError) {
        // 412 = 다른 곳에서 먼저 수정됨. 사용자 입력을 덮어쓰지 않는다.
        const retryable = err.httpStatus === 412 || err.httpStatus >= 500;
        setState({
          kind: 'failed',
          reason:
            err.httpStatus === 412
              ? '다른 창에서 먼저 저장되었습니다. 새로고침 후 다시 시도해 주십시오.'
              : (err.problem.detail ?? err.problem.title),
          retryable,
        });
        return;
      }
      setState({ kind: 'failed', reason: '저장에 실패했습니다.', retryable: true });
    }
  }, [applicationId, applicantId, frozen]);

  /** 입력이 바뀔 때마다 호출. Debounce 후 저장한다. */
  const schedule = useCallback(
    (fields: Record<string, unknown>) => {
      pendingRef.current = fields;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void flush(), debounceMs);
    },
    [debounceMs, flush],
  );

  /** 사용자가 "지금 저장" 을 눌렀을 때. Debounce 를 건너뛴다. */
  const saveNow = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    return flush();
  }, [flush]);

  // 재연결되면 밀린 내용을 보낸다.
  useEffect(() => {
    const onOnline = () => void flush();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [flush]);

  // 탭을 닫기 전에 한 번 더 시도한다.
  useEffect(() => {
    const onHide = () => {
      if (pendingRef.current) void flush();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, [flush]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return { state, schedule, saveNow, etag: etagRef.current };
}
