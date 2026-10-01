import { readFileSync } from "node:fs";

const path = process.argv[2];
if (!path) {
  console.error("사용법: node scripts/check-sbom.mjs <SPDX JSON 파일>");
  process.exit(2);
}

let sbom;
try {
  sbom = JSON.parse(readFileSync(path, "utf8"));
} catch (error) {
  console.error(`SBOM을 읽지 못했습니다: ${error.message}`);
  process.exit(2);
}

const errors = [];
if (!/^SPDX-2\./.test(sbom.spdxVersion ?? "")) {
  errors.push("SPDX 2.x 문서가 아닙니다.");
}
if (typeof sbom.documentNamespace !== "string" || sbom.documentNamespace.length === 0) {
  errors.push("documentNamespace가 없습니다.");
}
if (!sbom.creationInfo?.created || !Array.isArray(sbom.creationInfo?.creators)) {
  errors.push("creationInfo가 완전하지 않습니다.");
}
if (!Array.isArray(sbom.packages) || sbom.packages.length === 0) {
  errors.push("패키지 목록이 비어 있습니다.");
}
if (!Array.isArray(sbom.relationships) || sbom.relationships.length === 0) {
  errors.push("의존 관계 목록이 비어 있습니다.");
}

if (errors.length > 0) {
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `SBOM 검증: ${sbom.spdxVersion}, 패키지 ${sbom.packages.length}개, ` +
    `관계 ${sbom.relationships.length}개`,
);
