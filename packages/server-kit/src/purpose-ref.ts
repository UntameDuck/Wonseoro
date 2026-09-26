import { createHmac } from 'node:crypto';

/**
 * 목적별 가명 참조 — 기술설계서 v1.1 §01 A12 (T-M3-09)
 *
 * §A12: 목적별 Purpose-scoped Token · 대학 원본 식별자와 중앙 토큰 매핑 분리 ·
 *       Key version/rotation · 중앙에서 원본 PII 검색 금지
 *
 * **왜 sha256(subject_token) 으로는 안 되는가** (D-39)
 *   중앙 Vault 는 subject_token 을 기본키로 갖고 있다. 키 없는 해시는 누구나 다시
 *   계산할 수 있으므로, Vault 를 읽을 수 있으면 모든 토큰을 해시해 요약 테이블과
 *   바로 조인된다. "분리" 가 아니었다.
 *
 * 키를 섞은 HMAC 이면 Vault 접근만으로는 조인이 안 된다 — 목적 키가 함께 있어야 한다.
 * 목적 키는 그 목적의 서비스(대시보드)와 참조를 만드는 대학만 갖는다. Vault 는 갖지 않는다.
 *
 * 목적 이름을 HMAC 입력에 넣는다. 같은 키가 실수로 두 목적에 쓰여도 값이 달라,
 * 목적 사이에 참조가 이어지지 않는다.
 *
 * 형식: `<keyId>.<base64url(HMAC-SHA256)>` — 43자 + 키 ID. 키 ID 를 앞에 두어
 * 키를 바꿔도 옛 참조가 어느 키로 만들어졌는지 안다.
 */

export type RefPurpose =
  /** "내 원서" 통합 조회. 대학이 달라도 같은 사람이면 같은 값이어야 한다. */
  'DASHBOARD';

export interface RefKey {
  id: string;
  secret: string;
}

export function purposeRef(purpose: RefPurpose, key: RefKey, subjectToken: string): string {
  const mac = createHmac('sha256', key.secret).update(`${purpose}|${subjectToken}`).digest('base64url');
  return `${key.id}.${mac}`;
}

/**
 * 키 목록 `k2=비밀,k1=옛비밀` 을 읽는다. **첫 번째가 현재 키**다.
 *
 * 조회하는 쪽은 목록의 모든 키로 참조를 만들어 찾는다. 대학이 새 키로 옮겨 가는 동안
 * 옛 키로 만든 참조도 계속 찾아져야 "내 원서" 가 사라지지 않는다.
 */
export function parseKeyRing(spec: string): RefKey[] {
  const keys = spec
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => {
      const i = pair.indexOf('=');
      if (i <= 0 || i === pair.length - 1) {
        throw new Error('키 목록 형식은 id=비밀,id=비밀 이어야 합니다');
      }
      const id = pair.slice(0, i).trim();
      if (!/^[A-Za-z0-9_-]{1,16}$/.test(id)) {
        throw new Error(`키 ID 는 영문·숫자 16자 이내여야 합니다: ${id}`);
      }
      return { id, secret: pair.slice(i + 1).trim() };
    });
  if (keys.length === 0) throw new Error('키가 하나도 없습니다');
  if (new Set(keys.map((k) => k.id)).size !== keys.length) {
    throw new Error('키 ID 가 겹칩니다');
  }
  return keys;
}
