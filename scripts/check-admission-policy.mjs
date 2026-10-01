import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

const policy = parse(readFileSync('deploy/platform/policies/image-signature-policy.yaml', 'utf8'));
assert.equal(policy.apiVersion, 'policy.sigstore.dev/v1beta1');
assert.equal(policy.kind, 'ClusterImagePolicy');
assert.equal(policy.spec?.mode, 'enforce');
assert.deepEqual(policy.spec?.images, [{ glob: 'ghcr.io/untameduck/wonseoro-**' }]);

const identities = policy.spec?.authorities?.flatMap((authority) => authority.keyless?.identities ?? []) ?? [];
assert.deepEqual(identities, [
  {
    issuer: 'https://token.actions.githubusercontent.com',
    subjectRegExp:
      '^https://github\\.com/UntameDuck/Wonseoro/\\.github/workflows/security\\.yml@refs/tags/[^/]+$',
  },
]);

const source = readFileSync('.github/workflows/security.yml', 'utf8');
const workflow = parse(source);
const job = workflow.jobs?.['admission-policy'];
assert.ok(job, 'admission-policy 잡이 있어야 합니다.');
assert.deepEqual(job.needs, ['signed-images']);
assert.match(source, /policy-controller[\s\S]+--version 0\.10\.8/);
assert.match(source, /policy\.sigstore\.dev\/include=true/);
// 띄어 쓴 `--dry-run server` 는 client dry-run 이 되어 webhook 을 거치지 않는다
assert.doesNotMatch(source, /--dry-run(?!=)/);
assert.match(source, /run unsigned-proof[\s\S]+--dry-run=server[\s\S]+policy\.sigstore\.dev[\s\S]+run signed-proof[\s\S]+--dry-run=server/);
assert.match(source, /if \[\[ \$denied -ne 1 \]\]/);
assert.match(source, /unsigned-control\.Dockerfile/);

console.log('admission policy: release identity only · enforce · signed allow / unsigned deny proof');
