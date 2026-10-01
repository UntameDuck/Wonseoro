import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const input = process.argv[2];
if (!input) {
  console.error("사용법: node scripts/check-codeql-sarif.mjs <SARIF 파일 또는 디렉터리>");
  process.exit(2);
}

function collectSarifFiles(path) {
  const absolute = resolve(path);
  const stat = statSync(absolute);
  if (stat.isFile()) return [absolute];

  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const child = resolve(absolute, entry.name);
    if (entry.isDirectory()) return collectSarifFiles(child);
    return /\.sarif(?:\.json)?$/i.test(entry.name) ? [child] : [];
  });
}

let files;
try {
  files = collectSarifFiles(input);
} catch (error) {
  console.error(`SARIF 경로를 읽지 못했습니다: ${error.message}`);
  process.exit(2);
}

if (files.length === 0) {
  console.error("CodeQL SARIF 파일을 찾지 못했습니다.");
  process.exit(2);
}

const critical = [];
let resultCount = 0;

for (const file of files) {
  let sarif;
  try {
    sarif = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    console.error(`SARIF 파일을 해석하지 못했습니다(${file}): ${error.message}`);
    process.exit(2);
  }

  for (const run of sarif.runs ?? []) {
    const rules = run.tool?.driver?.rules ?? [];
    const rulesById = new Map(rules.map((rule) => [rule.id, rule]));

    for (const result of run.results ?? []) {
      resultCount += 1;
      const rule =
        rulesById.get(result.ruleId) ??
        (Number.isInteger(result.ruleIndex) ? rules[result.ruleIndex] : undefined);
      const rawScore =
        result.properties?.["security-severity"] ??
        rule?.properties?.["security-severity"];
      const score = Number.parseFloat(rawScore);

      if (Number.isFinite(score) && score >= 9) {
        critical.push({
          ruleId: result.ruleId ?? rule?.id ?? "unknown-rule",
          score,
        });
      }
    }
  }
}

console.log(
  `CodeQL 결과 ${resultCount}건 검사: Critical ${critical.length}건 ` +
    `(security-severity 9.0 이상)`,
);

if (critical.length > 0) {
  for (const finding of critical) {
    console.error(`- ${finding.ruleId}: security-severity ${finding.score}`);
  }
  process.exit(1);
}
