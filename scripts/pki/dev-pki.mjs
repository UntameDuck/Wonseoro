// 개발·시험용 플랫폼 CA 와 워크로드 인증서 (T-M5-05, docs/13 B2·B5)
//
// 사용: node scripts/pki/dev-pki.mjs [--out=.cache/pki] [--hours=24]
//   <out>/ca.crt·ca.key                         플랫폼 CA(시험용 — 운영은 Vault PKI, 단계 4)
//   <out>/<이름>.crt·<이름>.key                  워크로드 인증서 — SAN URI 가 신원, DNS·IP 는 서버로 쓸 때
//   <out>/rogue-ca.crt·rogue-univ-a-relay.*     플랫폼 CA 가 아닌 곳이 서명한 인증서(거절 시험용)
// 인증서는 짧게(기본 24시간) — 운영과 같은 교체 주기를 시험에서도 쓴다. 개인키는 저장소 밖(.cache, git 제외)에만 둔다.
// openssl 이 PATH 에 있어야 한다(Git for Windows·Ubuntu 에 있다).
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** 기본 워크로드 — 이름 · SAN URI · 서버 DNS 이름 */
export const WORKLOADS = [
  { name: 'central-api', uri: 'spiffe://wonseoro/central/central-api', dns: ['localhost', 'central-api', 'host.docker.internal'] },
  { name: 'univ-a-admission-api', uri: 'spiffe://wonseoro/university/UNIV-A/admission-api', dns: ['localhost', 'admission-api'] },
  { name: 'univ-a-event-relay', uri: 'spiffe://wonseoro/university/UNIV-A/event-relay', dns: [] },
  { name: 'univ-a-document-service', uri: 'spiffe://wonseoro/university/UNIV-A/document-service', dns: [] },
  { name: 'univ-b-event-relay', uri: 'spiffe://wonseoro/university/UNIV-B/event-relay', dns: [] },
  { name: 'univ-b-admission-api', uri: 'spiffe://wonseoro/university/UNIV-B/admission-api', dns: ['localhost', 'admission-api'] },
];

function openssl(args, input) {
  return execFileSync('openssl', args, { input, stdio: ['pipe', 'pipe', 'pipe'] });
}

function newCa(out, name, cn) {
  const key = path.join(out, `${name}.key`);
  const crt = path.join(out, `${name}.crt`);
  openssl(['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', key]);
  openssl(['req', '-x509', '-new', '-key', key, '-sha256', '-days', '30', '-subj', `/CN=${cn}`, '-out', crt,
    '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign']);
  return { key, crt };
}

function issue(out, ca, w, hours) {
  const key = path.join(out, `${w.name}.key`);
  const csr = path.join(out, `${w.name}.csr`);
  const crt = path.join(out, `${w.name}.crt`);
  const ext = path.join(out, `${w.name}.ext`);
  const san = [`URI:${w.uri}`, ...w.dns.map((d) => `DNS:${d}`), ...(w.dns.includes('localhost') ? ['IP:127.0.0.1'] : [])].join(',');
  writeFileSync(ext, [
    'basicConstraints=critical,CA:FALSE',
    'keyUsage=critical,digitalSignature',
    'extendedKeyUsage=serverAuth,clientAuth',
    `subjectAltName=${san}`,
  ].join('\n'));
  openssl(['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', key]);
  openssl(['req', '-new', '-key', key, '-subj', `/CN=${w.name}`, '-out', csr]);
  // openssl x509 -days 는 일 단위 — 시간 단위는 -not_after 대신 시작·끝을 직접 준다
  const start = new Date(Date.now() - 5 * 60_000);
  const end = new Date(Date.now() + hours * 3600_000);
  const fmt = (d) => d.toISOString().replace(/[-:T]/g, '').slice(0, 14) + 'Z';
  openssl(['x509', '-req', '-in', csr, '-CA', ca.crt, '-CAkey', ca.key, '-CAcreateserial', '-sha256',
    '-not_before', fmt(start), '-not_after', fmt(end), '-extfile', ext, '-out', crt]);
  return { cert: crt, key };
}

/** 개발 PKI 를 만든다. 이미 있으면 덮어쓴다 */
export function createDevPki({ out = path.join(ROOT, '.cache/pki'), hours = 24, workloads = WORKLOADS } = {}) {
  mkdirSync(out, { recursive: true });
  const ca = newCa(out, 'ca', 'Wonseoro Platform Dev CA');
  const files = { ca: ca.crt };
  for (const w of workloads) files[w.name] = issue(out, ca, w, hours);
  const rogue = newCa(out, 'rogue-ca', 'Not The Platform CA');
  files['rogue-univ-a-relay'] = issue(out, rogue, { name: 'rogue-univ-a-relay', uri: 'spiffe://wonseoro/university/UNIV-A/event-relay', dns: [] }, hours);
  return files;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = path.resolve(process.argv.find((a) => a.startsWith('--out='))?.split('=')[1] ?? path.join(ROOT, '.cache/pki'));
  const hours = Number(process.argv.find((a) => a.startsWith('--hours='))?.split('=')[1] ?? 24);
  const files = createDevPki({ out, hours });
  console.log(`개발 PKI → ${path.relative(process.cwd(), out)} (워크로드 ${Object.keys(files).length - 1}개, ${hours}시간)`);
}
