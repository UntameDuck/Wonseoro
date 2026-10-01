import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

const path = '.github/workflows/security.yml';
const source = readFileSync(path, 'utf8');
const workflow = parse(source);
const job = workflow.jobs?.['signed-images'];

assert.ok(job, 'signed-images 잡이 있어야 합니다.');
assert.equal(job.permissions?.contents, 'read');
assert.equal(job.permissions?.packages, 'write');
assert.equal(job.permissions?.['id-token'], 'write');
assert.deepEqual(
  job.strategy?.matrix?.include?.map(({ image }) => image).sort(),
  ['admission-api', 'central-api', 'document-service', 'event-relay', 'pgbouncer'],
  '운영 런타임 이미지 5종을 모두 서명해야 합니다.',
);

const commands = job.steps?.map((step) => step.run ?? '').join('\n') ?? '';
assert.match(commands, /docker inspect[^\n]+RepoDigests/, '태그가 아니라 registry digest를 얻어야 합니다.');
assert.match(commands, /cosign sign[^\n]+\$REFERENCE/, 'digest 참조를 서명해야 합니다.');
assert.match(commands, /cosign verify[\s\S]+--certificate-identity/, '서명자 신원을 검증해야 합니다.');
assert.match(commands, /https:\/\/token\.actions\.githubusercontent\.com/, 'GitHub OIDC 발급자를 고정해야 합니다.');
assert.match(
  source,
  /sigstore\/cosign-installer@[0-9a-f]{40}/,
  'Cosign 설치 Action은 이동하지 않는 commit SHA로 고정해야 합니다.',
);
assert.match(source, /--new-bundle-format=false/, 'Admission Controller 호환 서명 형식을 명시해야 합니다.');

console.log('image signing workflow: 5 images · digest signing · GitHub OIDC identity verification');
