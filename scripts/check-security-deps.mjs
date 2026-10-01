import { spawnSync } from "node:child_process";

const npmExecPath = process.env.npm_execpath;
const command = npmExecPath ? process.execPath : "npm";
const args = npmExecPath
  ? [npmExecPath, "audit", "--omit=dev", "--json"]
  : ["audit", "--omit=dev", "--json"];
const result = spawnSync(command, args, {
  encoding: "utf8",
  maxBuffer: 20 * 1024 * 1024,
});

if (result.error) {
  console.error(`npm audit를 실행하지 못했습니다: ${result.error.message}`);
  process.exit(2);
}

let report;
try {
  report = JSON.parse(result.stdout);
} catch {
  console.error("npm audit 결과를 JSON으로 해석하지 못했습니다.");
  if (result.stderr) console.error(result.stderr.trim());
  process.exit(2);
}

if (report.error) {
  console.error(`npm audit가 실패했습니다: ${report.error.summary ?? report.error.message}`);
  process.exit(2);
}

const counts = report.metadata?.vulnerabilities;
if (!counts) {
  console.error("npm audit 결과에 취약점 집계가 없습니다.");
  process.exit(2);
}

console.log(
  `운영 의존성 취약점: critical ${counts.critical}, high ${counts.high}, ` +
    `moderate ${counts.moderate}, low ${counts.low}, total ${counts.total}`,
);

if (counts.critical > 0) {
  const criticalPackages = Object.entries(report.vulnerabilities ?? {})
    .filter(([, finding]) => finding.severity === "critical")
    .map(([name]) => name)
    .sort();

  if (criticalPackages.length > 0) {
    console.error(`Critical 취약 패키지: ${criticalPackages.join(", ")}`);
  }
  console.error("운영 의존성의 Critical 취약점은 0개여야 합니다.");
  process.exit(1);
}
