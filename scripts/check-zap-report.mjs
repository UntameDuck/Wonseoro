import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function summarizeZapReport(report) {
  if (!report || !Array.isArray(report.site) || report.site.length === 0) {
    throw new Error('ZAP 보고서에 스캔 대상 site가 없습니다. API 기동·OpenAPI import 여부를 확인하세요.');
  }

  const alerts = report.site.flatMap((site) => {
    if (!Array.isArray(site.alerts)) {
      throw new Error('ZAP site에 alerts 배열이 없습니다. 보고서 형식이 예상과 다릅니다.');
    }
    return site.alerts.map((alert) => ({
      site: site['@name'] ?? site.name ?? 'unknown',
      pluginId: String(alert.pluginid ?? alert.pluginId ?? 'unknown'),
      name: String(alert.name ?? alert.alert ?? '이름 없음'),
      riskCode: String(alert.riskcode ?? alert.riskCode ?? ''),
      risk: String(alert.riskdesc ?? alert.risk ?? ''),
      instances: Array.isArray(alert.instances) ? alert.instances.length : 0,
    }));
  });

  const high = alerts.filter((alert) => alert.riskCode === '3' || /^High\b/i.test(alert.risk));
  return { sites: report.site.length, alerts: alerts.length, high };
}

function main() {
  const input = process.argv[2];
  if (!input) throw new Error('사용법: node scripts/check-zap-report.mjs <zap-report.json>');

  const path = resolve(input);
  const summary = summarizeZapReport(JSON.parse(readFileSync(path, 'utf8')));
  console.log(`ZAP DAST: site ${summary.sites}, alerts ${summary.alerts}, High ${summary.high.length}`);

  if (summary.high.length > 0) {
    for (const finding of summary.high) {
      console.error(
        `[High] ${finding.pluginId} ${finding.name} (${finding.site}, instances=${finding.instances})`,
      );
    }
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
