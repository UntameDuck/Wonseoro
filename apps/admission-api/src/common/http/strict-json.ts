import { ProblemException } from '../problem/problem.exception';

/**
 * JSON 본문 파서 — **UTF-8 이 아니면 받지 않는다.** (D-37)
 *
 * 기본 파서는 잘못된 바이트를 U+FFFD(�)로 바꿔 그대로 받아들인다. 거절하지 않는다.
 * 그러면 한글이 깨진 값이 성공 응답과 함께 저장된다.
 *
 * 실제로 겪었다. Windows 셸에서 CP949 로 보낸 마감 연장 요청의 결정 문서번호가
 * `����ó-2026-117` 로 저장됐고, 그 값이 **서명된 활성화 기록에 영구히 남았다.**
 * 추가만 가능한 기록이라 고칠 수도 없다. 지원자의 이름·주소·자기소개도 같은 경로로
 * 조용히 깨질 수 있고, 지원자는 저장 성공 표시를 보고 넘어간다.
 *
 * 깨진 값을 저장하고 성공이라 말하는 것보다 400 으로 거절하는 쪽이 낫다.
 * 거절하면 보낸 쪽이 알아차리고 다시 보낸다. 500 이면 서버 고장으로 알고 같은 것을 또 보낸다.
 */
const decoder = new TextDecoder('utf-8', { fatal: true });

/** Fastify content-type parser 로 등록한다. parseAs: 'buffer' 여야 한다. */
export function strictJsonParser(
  _req: unknown,
  body: Buffer,
  done: (err: Error | null, value?: unknown) => void,
): void {
  let text: string;
  try {
    text = decoder.decode(body);
  } catch {
    done(
      ProblemException.validationFailed(
        '요청 본문이 UTF-8 이 아닙니다. 한글이 깨진 채 저장되지 않도록 요청을 거절했습니다.',
      ),
    );
    return;
  }
  if (text === '') {
    done(null, {});
    return;
  }
  try {
    done(null, JSON.parse(text));
  } catch {
    done(ProblemException.validationFailed('요청 본문이 올바른 JSON 이 아닙니다.'));
  }
}
