import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { BlockList, isIP } from 'node:net';
import { Logger } from '@nestjs/common';
import { metrics } from '@opentelemetry/api';
import { envList, isProduction } from './env';

/**
 * 출구 허용 목록 — SSRF 방어 (T-M5-07, docs/13 B6)
 *
 * 서버가 부르는 곳은 정해져 있다(중앙·로그인 서버·Object Storage·PG). 그 밖을 부르게 만드는 입력 — 서명 URL·콜백 주소·
 * 설정에 섞인 주소 — 이 클라우드 메타데이터(169.254.169.254)나 내부 관리 포트로 요청을 보내게 하는 것이 SSRF 다.
 *
 *   1. 호스트 허용 목록 — 설정된 의존 서비스 URL 의 호스트(+ EGRESS_ALLOWLIST)만. 그 밖은 요청 전에 거절
 *   2. **연결 순간의 주소 검사** — DNS 가 무엇을 돌려주든(허용된 이름을 메타데이터 주소로 돌려놓는 DNS 재바인딩)
 *      메타데이터·링크 로컬·미지정·멀티캐스트 주소로는 연결하지 않는다. 운영에서는 루프백도
 *   http·https 만. 사설 대역(10/8 등)은 막지 않는다 — 클러스터 안 의존 서비스가 거기 있다. 그 대신 이름 허용 목록이 좁힌다.
 *   네트워크 쪽은 NetworkPolicy 가 같은 것을 막는다(T-M5-01) — 하나만으로는 설정 실수 하나에 뚫린다.
 */

export type EgressDenial = 'scheme' | 'host' | 'address';

export class EgressDenied extends Error {
  constructor(readonly reason: EgressDenial, readonly target: string) {
    super(`허용되지 않은 출구(${reason}): ${target}`);
    this.name = 'EgressDenied';
  }
}

const denials = metrics.getMeter('k-admission.egress').createCounter('egress_denied', {
  description: '출구 허용 목록이 막은 요청 수 (reason=scheme|host|address)',
});

/** 어떤 이름이 돌려주든 연결하지 않는 주소 */
function blockedAddresses(allowLoopback: boolean): BlockList {
  const b = new BlockList();
  b.addSubnet('169.254.0.0', 16, 'ipv4'); // 링크 로컬 — AWS·GCP·Azure·K-PaaS(OpenStack) 메타데이터 169.254.169.254
  b.addAddress('100.100.100.200', 'ipv4'); // Alibaba Cloud 메타데이터
  b.addAddress('192.0.0.192', 'ipv4'); // Oracle Cloud 메타데이터
  b.addSubnet('0.0.0.0', 8, 'ipv4'); // 미지정 — 0.0.0.0 은 로컬로 간다
  b.addSubnet('224.0.0.0', 4, 'ipv4'); // 멀티캐스트
  b.addAddress('255.255.255.255', 'ipv4');
  b.addSubnet('fe80::', 10, 'ipv6'); // 링크 로컬
  b.addAddress('fd00:ec2::254', 'ipv6'); // AWS IPv6 메타데이터
  b.addSubnet('ff00::', 8, 'ipv6');
  b.addAddress('::', 'ipv6');
  if (!allowLoopback) {
    b.addSubnet('127.0.0.0', 8, 'ipv4');
    b.addAddress('::1', 'ipv6');
  }
  return b;
}

/** `host`, `host:port`, `[v6]:port`, `*.suffix` → 호스트·포트 */
function parseEntry(a: string): { host: string; port: string | null } {
  if (a.startsWith('[')) {
    const end = a.indexOf(']');
    return { host: a.slice(1, end), port: a.slice(end + 1).startsWith(':') ? a.slice(end + 2) : null };
  }
  if ((a.match(/:/g) ?? []).length > 1) return { host: a, port: null }; // 괄호 없는 IPv6
  const i = a.lastIndexOf(':');
  return i === -1 ? { host: a, port: null } : { host: a.slice(0, i), port: a.slice(i + 1) };
}

/** IPv4 를 품은 IPv6(::ffff:169.254.169.254)는 IPv4 로 본다 — 감싸서 우회하지 못하게 */
function normalize(ip: string): { address: string; family: 'ipv4' | 'ipv6' } {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return { address: mapped[1] as string, family: 'ipv4' };
  return { address: ip, family: isIP(ip) === 6 ? 'ipv6' : 'ipv4' };
}

export interface EgressPolicyOptions {
  /** 허용 호스트 — `host`, `host:port`, `*.suffix`. 대소문자 무시 */
  allow: readonly string[];
  /** 루프백(127/8, ::1) 허용 — 개발 서버만. 기본은 운영이 아닐 때 허용 */
  allowLoopback?: boolean;
}

export class EgressPolicy {
  readonly allow: readonly string[];
  private readonly entries: { host: string; port: string | null }[];
  private readonly blocked: BlockList;
  private readonly logger = new Logger('egress');

  constructor(o: EgressPolicyOptions) {
    this.allow = [...new Set(o.allow.map((a) => a.trim().toLowerCase()).filter(Boolean))];
    this.entries = this.allow.map(parseEntry);
    this.blocked = blockedAddresses(o.allowLoopback ?? !isProduction());
  }

  /** 설정된 URL 들의 호스트와 추가 항목으로 만든다. 비어 있거나 잘못된 URL 은 건너뛴다 */
  static fromUrls(urls: ReadonlyArray<string | null | undefined>, extra: readonly string[] = [], o: Omit<EgressPolicyOptions, 'allow'> = {}): EgressPolicy {
    const hosts: string[] = [];
    for (const u of urls) {
      if (!u) continue;
      try {
        const url = new URL(u);
        hosts.push(url.port ? `${url.hostname}:${url.port}` : url.hostname);
      } catch {
        /* 설정 검사가 따로 잡는다 */
      }
    }
    return new EgressPolicy({ ...o, allow: [...hosts, ...extra] });
  }

  /** 주소가 막힌 대역인가 */
  deniedAddress(ip: string): boolean {
    const n = normalize(ip);
    return this.blocked.check(n.address, n.family);
  }

  private hostAllowed(url: URL): boolean {
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const port = url.port || (url.protocol === 'https:' ? '443' : '80');
    return this.entries.some(
      (e) => (e.port === null || e.port === port) && (e.host.startsWith('*.') ? host.endsWith(e.host.slice(1)) : host === e.host),
    );
  }

  /** 요청 전에 본다 — 통과하면 URL, 아니면 EgressDenied */
  check(target: string | URL): URL {
    let url: URL;
    try {
      url = new URL(String(target));
    } catch {
      return this.deny('scheme', String(target));
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return this.deny('scheme', url.origin);
    if (!this.hostAllowed(url)) return this.deny('host', url.host);
    const literal = url.hostname.replace(/^\[|\]$/g, '');
    if (isIP(literal) && this.deniedAddress(literal)) return this.deny('address', url.host);
    return url;
  }

  /**
   * 연결 직전 DNS 조회 — 막힌 주소를 걸러 낸다. 남는 주소가 없으면 연결하지 않는다.
   * undici `connect.lookup`·`net.connect({ lookup })` 에 그대로 쓴다.
   */
  readonly lookup = (
    hostname: string,
    options: { family?: number; all?: boolean } | number,
    callback: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
  ): void => {
    const opts = typeof options === 'number' ? { family: options } : options ?? {};
    dnsLookup(hostname, { family: opts.family ?? 0, all: true }, (err, addresses) => {
      if (err) return callback(err, '', 0);
      const ok = (addresses as LookupAddress[]).filter((a) => !this.deniedAddress(a.address));
      if (ok.length === 0) {
        denials.add(1, { reason: 'address' });
        this.logger.warn(`출구 거절 — ${hostname} 이(가) 막힌 주소로 풀린다`);
        return callback(Object.assign(new EgressDenied('address', hostname), { code: 'EGRESS_DENIED' }), '', 0);
      }
      if (opts.all) return callback(null, ok);
      const first = ok[0] as LookupAddress;
      return callback(null, first.address, first.family);
    });
  };

  private deny(reason: EgressDenial, target: string): never {
    denials.add(1, { reason });
    this.logger.warn(`출구 거절(${reason}) — ${target}`);
    throw new EgressDenied(reason, target);
  }
}

let configured: EgressPolicy | null = null;

/**
 * 이 프로세스의 출구 정책을 정한다 — 각 서비스 config 가 자기 의존 서비스 URL 로 한 번 부른다.
 * `EGRESS_ALLOWLIST`(쉼표)로 더할 수 있다(운영 PG·기관 연동 등).
 */
export function configureEgress(urls: ReadonlyArray<string | null | undefined>, hosts: ReadonlyArray<string | null | undefined> = []): EgressPolicy {
  const extra = [...hosts.filter((h): h is string => !!h), ...envList('EGRESS_ALLOWLIST', [], '출구 허용 호스트 추가(host, host:port, *.suffix)')];
  // 비밀 저장소(Vault, T-M5-04)는 모든 서비스가 부른다 — 설정돼 있으면 늘 허용
  configured = EgressPolicy.fromUrls([...urls, process.env.VAULT_ADDR], extra);
  return configured;
}

/** 정한 정책. 아직 안 정했으면 허용 호스트가 없는 정책(전부 거절) — 닫힌 실패 */
export function egressPolicy(): EgressPolicy {
  configured ??= new EgressPolicy({ allow: [] });
  return configured;
}
