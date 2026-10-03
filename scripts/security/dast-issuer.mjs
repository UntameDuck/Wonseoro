// DAST 용 시험 발급자 — 토큰을 붙여 인증 뒤의 API 까지 검사한다 (T-M5-02 단계 9, T-M5-27)
//
// 사용: node scripts/security/dast-issuer.mjs [--port=18099] [--out=dast-results]
//   지원자·담당자 렐름 두 개의 discovery·공개키(JWKS)를 내고, 각 렐름의 토큰 하나씩을 <out>/applicant.token·staff.token 에 쓴다.
//   대학 API 를 AUTH_MODE=oidc 로, 발급자를 http://127.0.0.1:<port>/realms/{applicant,staff} 로 띄우면 이 토큰을 받는다.
//   ZAP 이 경로에 맞는 토큰을 Authorization 에 붙인다(security.yml dast 잡).
// 왜 Keycloak 이 아닌가
//   검사 대상은 대학 API 다. 토큰 모양(aud·acr·roles·auth_time·preferred_username)은 실제 Keycloak 토큰과 같게 만든다 —
//   같은 모양인지는 test:auth:api(실제 Keycloak)가 본다. CI 에서 750MB 이미지·80초 기동 없이 결정적으로 돈다.
// 토큰
//   지원자 — sub `dast-applicant`, 2시간
//   담당자 — sub `dast-admin`, 역할 admission-admin·security-auditor(운영 API 전 범위), acr=mfa, 방금 인증(재인증 창 안 —
//            검사가 5분을 넘기면 민감 동작은 재인증 요구 401 로 답한다. 그것도 검사 대상이다)
// 비밀 키는 메모리에만 있고 프로세스가 끝나면 사라진다. 시험 전용 — 운영(NODE_ENV=production)의 대학 API 는 http 발급자를 거부한다.
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

const arg = (name, def) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? def;
const PORT = Number(arg('port', '18099'));
const OUT = path.resolve(arg('out', 'dast-results'));
const BASE = `http://127.0.0.1:${PORT}/realms`;

const { privateKey, publicKey } = await generateKeyPair('RS256');
const jwk = { ...(await exportJWK(publicKey)), kid: 'dast-1', alg: 'RS256', use: 'sig' };

const now = Math.floor(Date.now() / 1000);
const sign = (realm, sub, claims) =>
  new SignJWT({ auth_time: now, ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: jwk.kid, typ: 'JWT' })
    .setIssuer(`${BASE}/${realm}`)
    .setAudience('wonseoro-admission-api')
    .setSubject(sub)
    .setIssuedAt(now)
    .setExpirationTime(now + 2 * 60 * 60)
    .sign(privateKey);

mkdirSync(OUT, { recursive: true });
writeFileSync(path.join(OUT, 'applicant.token'), await sign('applicant', 'dast-applicant', { acr: '1' }));
writeFileSync(
  path.join(OUT, 'staff.token'),
  await sign('staff', 'dast-admin', { acr: 'mfa', preferred_username: 'dast-admin', realm_access: { roles: ['admission-admin', 'security-auditor'] } }),
);

createServer((req, res) => {
  const m = /^\/realms\/(applicant|staff)(\/.*)$/.exec(req.url ?? '');
  res.setHeader('content-type', 'application/json');
  if (m?.[2] === '/.well-known/openid-configuration') {
    return res.end(JSON.stringify({ issuer: `${BASE}/${m[1]}`, jwks_uri: `${BASE}/${m[1]}/certs` }));
  }
  if (m?.[2] === '/certs') return res.end(JSON.stringify({ keys: [jwk] }));
  res.writeHead(404).end('{}');
}).listen(PORT, '127.0.0.1', () => {
  console.log(`DAST 시험 발급자 ${BASE}/{applicant,staff} — 토큰 ${path.relative(process.cwd(), OUT)}/applicant.token·staff.token`);
});
