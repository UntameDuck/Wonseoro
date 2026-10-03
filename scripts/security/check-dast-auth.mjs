// DAST 가 인증 뒤까지 들어갔는지 확인한다 (T-M5-02 단계 9)
//
// 사용: node scripts/security/check-dast-auth.mjs [지표 주소=http://127.0.0.1:9464/metrics] [--min=20]
// ZAP 이 토큰을 붙이지 못하면(설정 실수·토큰 만료) 모든 요청이 401 로 끝나도 보고서는 High 0 으로 "통과" 한다 — 검사가
// 인증 뒤 코드에 닿지 않은 것이다. 대학 API 의 토큰 판정 지표(auth_decisions)에서 지원자·담당자 토큰이 각각 충분히 받아들여졌는지 본다.
const url = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'http://127.0.0.1:9464/metrics';
const min = Number(process.argv.find((a) => a.startsWith('--min='))?.split('=')[1] ?? 20);

const text = await fetch(url).then((r) => r.text());
const count = (audience, result) =>
  text
    .split('\n')
    .filter((l) => l.startsWith('auth_decisions') && l.includes(`audience="${audience}"`) && l.includes(`result="${result}"`))
    .reduce((n, l) => n + Number(l.trim().split(/\s+/).pop()), 0);

const rows = ['applicant', 'staff'].map((audience) => ({
  audience,
  ok: count(audience, 'ok'),
  invalid: count(audience, 'invalid'),
  missing: count(audience, 'missing'),
}));
for (const r of rows) console.log(`DAST 인증: ${r.audience} 토큰 통과 ${r.ok} · 거절 ${r.invalid} · 토큰 없음 ${r.missing}`);
const short = rows.filter((r) => r.ok < min);
if (short.length) {
  console.error(`인증 뒤까지 닿은 요청이 ${min}건보다 적다 — ZAP 이 토큰을 붙이지 못했다: ${short.map((r) => r.audience).join(', ')}`);
  process.exitCode = 1;
}
