import { envInt, envList, parseKeyRing, secretOrDev } from '@wonseoro/server-kit';

/** central-api 설정. */
export const PORT = envInt('PORT', 3000, { min: 1, max: 65535 });

export const CORS_ORIGINS = envList(
  'CORS_ORIGINS',
  ['http://localhost:4000'],
  '지원자 웹의 오리진',
);

/**
 * "내 원서" 조회용 지원자 참조 키 목록. `k2=비밀,k1=옛비밀` — 첫 번째가 현재 키. (§A12)
 *
 * 대학이 보내는 참조와 같은 키여야 찾아진다. 키를 바꾸는 동안 옛 키도 목록에 두면
 * 옛 키로 만든 참조도 계속 찾아진다. **Vault 서비스에는 주지 않는다** — 둘을 함께 가지면
 * 지원자 참조가 다시 Vault 와 조인된다.
 */
export const SUBJECT_REF_KEYS = parseKeyRing(
  secretOrDev(
    'SUBJECT_REF_KEYS',
    'k1=dev-dashboard-subject-key',
    '"내 원서" 조회용 지원자 참조 키 목록',
  ) || 'k0=unset',
);
