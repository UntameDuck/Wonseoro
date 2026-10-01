import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

const checker = fileURLToPath(new URL("./check-codeql-sarif.mjs", import.meta.url));
const workdir = mkdtempSync(join(tmpdir(), "wonseoro-codeql-sarif-"));

after(() => rmSync(workdir, { recursive: true, force: true }));

function writeSarif(name, securitySeverity) {
  const path = join(workdir, name);
  writeFileSync(
    path,
    JSON.stringify({
      version: "2.1.0",
      runs: [
        {
          tool: {
            driver: {
              name: "CodeQL",
              rules: [
                {
                  id: "js/example",
                  properties: { "security-severity": String(securitySeverity) },
                },
              ],
            },
          },
          results: [{ ruleId: "js/example", ruleIndex: 0 }],
        },
      ],
    }),
  );
  return path;
}

test("security-severity 9.0 미만이면 통과한다", () => {
  const result = spawnSync(process.execPath, [checker, writeSarif("high.sarif", 8.9)], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Critical 0건/);
});

test("security-severity 9.0 이상이면 실패한다", () => {
  const result = spawnSync(process.execPath, [checker, writeSarif("critical.sarif", 9.0)], {
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /js\/example/);
});
