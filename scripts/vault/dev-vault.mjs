// 개발 Vault 구성 — 노션 첨부 `deploy/platform/policies/vault-policy.hcl` 을 대학마다 그대로 적용한다 (T-M5-04, docs/13 단계 4)
//
// 사용: docker compose -f infra/compose/docker-compose.dev.yml --profile vault up -d vault
//       node scripts/vault/dev-vault.mjs                  (VAULT_ADDR·VAULT_TOKEN 기본 http://127.0.0.1:8200 · dev-root-token)
// 만드는 것(대학 UNIV-A·UNIV-B 마다):
//   kv/universities/<대학>/apps/{admission,event-relay}  · transit/keys/pii-<대학>(aes256-gcm96)
//   database/roles/admission-api-<대학>(동적 DB 계정 — kadmission_app 역할을 물려받는다)
//   pki/roles/kadmission-<대학 소문자>-<워크로드>(SAN URI 는 그 워크로드 하나만 — D-71)
//   정책·AppRole univ-<대학>-<워크로드> — 대학 API 는 첨부 정책 그대로(PKI 줄만 워크로드 역할로), Relay·서류 워커는 필요한 것만
// 중앙(첨부 밖, 저장소 작성): transit pii-central · pki kadmission-central-service · 정책 central
// 운영 Vault 는 이 스크립트로 만들지 않는다 — 플랫폼 관리자가 같은 경로·정책을 Terraform 등으로 둔다.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const UNIVERSITIES = ['UNIV-A', 'UNIV-B'];
export const WORKLOADS = ['admission-api', 'event-relay', 'document-service'];

export async function setupDevVault({
  addr = process.env.VAULT_ADDR ?? 'http://127.0.0.1:8200',
  token = process.env.VAULT_TOKEN ?? 'dev-root-token',
  // Vault 컨테이너에서 본 대학 DB(관리자 계정 — 동적 계정을 만들고 지운다)
  dbUrl = process.env.VAULT_DB_URL ?? 'postgresql://{{username}}:{{password}}@host.docker.internal:5432/univ_a?sslmode=disable',
  dbUser = process.env.VAULT_DB_USER ?? 'wonseoro',
  dbPassword = process.env.VAULT_DB_PASSWORD ?? 'wonseoro',
  dbTtl = process.env.VAULT_DB_TTL ?? '1h',
  dbMaxTtl = process.env.VAULT_DB_MAX_TTL ?? '24h',
} = {}) {
  const call = async (method, p, body) => {
    const res = await fetch(`${addr}/v1/${p}`, {
      method,
      headers: { 'x-vault-token': token, 'content-type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    if (!res.ok && !(res.status === 400 && /already in use|existing mount/.test(text))) {
      throw new Error(`${method} ${p} → ${res.status} ${text.slice(0, 300)}`);
    }
    return text ? JSON.parse(text) : {};
  };
  const mount = (path, type, options) => call('POST', `sys/mounts/${path}`, { type, ...(options ? { options } : {}) });
  await mount('kv', 'kv', { version: '2' });
  await mount('transit', 'transit');
  await mount('database', 'database');
  await mount('pki', 'pki');
  await call('POST', 'sys/mounts/pki/tune', { max_lease_ttl: '87600h' });
  await call('POST', 'sys/auth/approle', { type: 'approle' }).catch((e) => {
    if (!/already in use/.test(e.message)) throw e;
  });

  // 플랫폼 CA — 단계 1 의 개발 PKI(openssl) 대신 Vault 가 발급한다
  const ca = await call('GET', 'pki/cert/ca').catch(() => null);
  if (!ca?.data?.certificate) {
    await call('POST', 'pki/root/generate/internal', { common_name: 'wonseoro platform CA (dev)', ttl: '87600h', key_type: 'ec', key_bits: 256 });
  }

  await call('POST', 'database/config/univ-db', {
    plugin_name: 'postgresql-database-plugin',
    connection_url: dbUrl,
    username: dbUser,
    password: dbPassword,
    allowed_roles: UNIVERSITIES.flatMap((u) => [`admission-api-${u}`, `break-glass-${u}`]),
    verify_connection: false,
  });

  const attachment = readFileSync(`${ROOT}deploy/platform/policies/vault-policy.hcl`, 'utf8');
  const out = {};
  for (const u of UNIVERSITIES) {
    const lower = u.toLowerCase();
    await call('POST', `transit/keys/pii-${u}`, { type: 'aes256-gcm96' });
    await call('POST', `kv/data/universities/${u}/apps/admission`, { data: { note: `${u} admission` } });
    await call('POST', `kv/data/universities/${u}/apps/event-relay`, { data: { note: `${u} relay` } });
    await call('POST', `database/roles/admission-api-${u}`, {
      db_name: 'univ-db',
      creation_statements: [
        `CREATE ROLE "{{name}}" WITH LOGIN PASSWORD '{{password}}' VALID UNTIL '{{expiration}}' IN ROLE kadmission_app;`,
      ],
      // 남은 세션을 끊고 지운다 — 수명이 끝난 계정이 연결을 붙들고 있지 않게
      revocation_statements: [
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = '{{name}}';`,
        `DROP ROLE IF EXISTS "{{name}}";`,
      ],
      default_ttl: dbTtl,
      max_ttl: dbMaxTtl,
    });
    // DB 비상 접속(T-M5-03, D-72) — 15분짜리 계정, 만들 때 DB 에 기록·모든 문장 로그. 비상 그룹 정책만 받는다
    await call('POST', `database/roles/break-glass-${u}`, {
      db_name: 'univ-db',
      creation_statements: [
        `CREATE ROLE "{{name}}" WITH LOGIN PASSWORD '{{password}}' VALID UNTIL '{{expiration}}' IN ROLE kadmission_break_glass;`,
        `ALTER ROLE "{{name}}" SET log_statement = 'all';`,
        `INSERT INTO kadmission.break_glass_access (db_user, valid_until) VALUES ('{{name}}', '{{expiration}}');`,
      ],
      revocation_statements: [
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = '{{name}}';`,
        `DROP ROLE IF EXISTS "{{name}}";`,
      ],
      default_ttl: '15m',
      max_ttl: '1h',
    });
    await call('PUT', `sys/policies/acl/univ-${u}-break-glass`, { policy: `path "database/creds/break-glass-${u}" { capabilities = ["read"] }` });
    await call('POST', `auth/approle/role/univ-${u}-break-glass`, { token_policies: [`univ-${u}-break-glass`], token_ttl: '15m', token_max_ttl: '1h' });

    // PKI 역할은 워크로드마다 — 자기 SAN URI 하나만 발급한다(D-71). 첨부의 대학 단위 역할(kadmission-<대학>-service)은
    // 같은 대학의 어느 워크로드든 다른 워크로드 신원을 받게 한다(서류 워커가 Relay 인증서로 이벤트를 위조)
    for (const w of WORKLOADS) {
      await call('POST', `pki/roles/kadmission-${lower}-${w}`, {
        allowed_uri_sans: [`spiffe://wonseoro/university/${u}/${w}`],
        allowed_domains: ['localhost', 'svc', 'svc.cluster.local'],
        allow_subdomains: true,
        allow_localhost: true,
        allow_ip_sans: true,
        enforce_hostnames: true,
        require_cn: false,
        key_type: 'ec',
        key_bits: 256,
        max_ttl: '24h',
        ttl: '24h',
        server_flag: true,
        client_flag: true,
      });
    }
    // 대학 API 정책 = 첨부 정책 그대로(대학 이름만 바꿈), PKI 줄만 워크로드 역할로
    const base = attachment.replaceAll('UNIV-A', u).replaceAll('univ-a', lower);
    const policies = {
      'admission-api': base.replace(`pki/issue/kadmission-${lower}-service`, `pki/issue/kadmission-${lower}-admission-api`),
      // Relay — 첨부의 Relay KV·DB 자격증명·자기 인증서. Transit(개인정보 키)은 없다
      'event-relay': [
        `path "kv/data/universities/${u}/apps/event-relay" { capabilities = ["read"] }`,
        `path "database/creds/admission-api-${u}" { capabilities = ["read"] }`,
        `path "pki/issue/kadmission-${lower}-event-relay" { capabilities = ["create", "update"] }`,
      ].join('\n'),
      // 서류 워커 — 신뢰하지 않는 파일을 다룬다. 자기 인증서만
      'document-service': `path "pki/issue/kadmission-${lower}-document-service" { capabilities = ["create", "update"] }`,
    };
    out[u] = {};
    for (const w of WORKLOADS) {
      await call('PUT', `sys/policies/acl/univ-${u}-${w}`, { policy: policies[w] });
      await call('POST', `auth/approle/role/univ-${u}-${w}`, { token_policies: [`univ-${u}-${w}`], token_ttl: '1h', token_max_ttl: '4h' });
      const roleId = (await call('GET', `auth/approle/role/univ-${u}-${w}/role-id`)).data.role_id;
      const secretId = (await call('POST', `auth/approle/role/univ-${u}-${w}/secret-id`, {})).data.secret_id;
      out[u][w] = { roleId, secretId };
    }
    out[u]['break-glass'] = {
      roleId: (await call('GET', `auth/approle/role/univ-${u}-break-glass/role-id`)).data.role_id,
      secretId: (await call('POST', `auth/approle/role/univ-${u}-break-glass/secret-id`, {})).data.secret_id,
    };
  }

  // 중앙 — 첨부 밖(저장소 작성): 공통원서 금고 KEK·중앙 워크로드 인증서
  await call('POST', 'transit/keys/pii-central', { type: 'aes256-gcm96' });
  await call('POST', 'pki/roles/kadmission-central-service', {
    allowed_uri_sans: ['spiffe://wonseoro/central/*'],
    allowed_domains: ['localhost', 'svc', 'svc.cluster.local'],
    allow_subdomains: true,
    allow_localhost: true,
    allow_ip_sans: true,
    require_cn: false,
    key_type: 'ec',
    key_bits: 256,
    max_ttl: '24h',
    ttl: '24h',
    server_flag: true,
    client_flag: true,
  });
  await call('PUT', 'sys/policies/acl/central', {
    policy: [
      'path "transit/encrypt/pii-central" { capabilities = ["update"] }',
      'path "transit/decrypt/pii-central" { capabilities = ["update"] }',
      'path "pki/issue/kadmission-central-service" { capabilities = ["create", "update"] }',
    ].join('\n'),
  });
  await call('POST', 'auth/approle/role/central-api', { token_policies: ['central'], token_ttl: '1h', token_max_ttl: '4h' });
  out.central = {
    roleId: (await call('GET', 'auth/approle/role/central-api/role-id')).data.role_id,
    secretId: (await call('POST', 'auth/approle/role/central-api/secret-id', {})).data.secret_id,
  };
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = await setupDevVault();
  // AppRole secret_id 는 출력하지 않는다 — 필요하면 Vault 에서 새로 받는다
  console.log(`✔ 개발 Vault 구성 — 대학 ${UNIVERSITIES.join('·')} × 워크로드 ${WORKLOADS.length} + 중앙`);
}
