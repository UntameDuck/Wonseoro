// TOTP(RFC 6238) — 로컬 발급자의 시험 계정 OTP 를 계산한다. 비밀은 infra/auth/*.realm.json 의 시험값이다.
// Keycloak 은 secretData.value 의 글자 바이트를 HMAC 키로 쓴다(인증 앱에는 그 base32 를 보여준다).
import { createHmac } from 'node:crypto';

const used = new Map();

/**
 * 아직 쓰지 않은 OTP. 발급자는 같은 30초 창의 같은 코드를 두 번 받지 않는다(재사용 방지) — 사람이 다음 코드를
 * 기다리듯, 직전에 쓴 코드와 같으면 다음 창까지 기다린다.
 */
export async function freshTotp(secret, { period = 30 } = {}) {
  let code = totp(secret, { period });
  if (used.get(secret) === code) {
    const wait = period * 1000 - (Date.now() % (period * 1000)) + 500;
    await new Promise((r) => setTimeout(r, wait));
    code = totp(secret, { period });
  }
  used.set(secret, code);
  return code;
}

export function totp(secret, { now = Date.now(), period = 30, digits = 6 } = {}) {
  const counter = Math.floor(now / 1000 / period);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', Buffer.from(secret, 'utf8')).update(msg).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const code = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return String(code).padStart(digits, '0');
}
