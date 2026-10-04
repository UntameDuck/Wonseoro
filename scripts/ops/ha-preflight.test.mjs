import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateHaSnapshots } from './ha-preflight.mjs';

const primary = () => ({
  inRecovery: false,
  majorVersion: 16,
  systemIdentifier: '123456789',
  serverAddress: '10.0.1.10',
  serverPort: 5432,
  synchronousCommit: 'on',
  streamingSyncStandbys: 1,
  maxReplayLagBytes: 1024,
  archiveMode: 'on',
  archiveCommandConfigured: true,
  writerFence: { epoch: 4, requireToken: true },
});
const standby = () => ({
  inRecovery: true,
  majorVersion: 16,
  systemIdentifier: '123456789',
  serverAddress: '10.0.2.10',
  serverPort: 5432,
  hotStandby: 'on',
  walReceiverStatus: 'streaming',
});

test('동기 HA·WAL·Writer fencing 기준이 맞으면 자동 점검을 통과한다', () => {
  const result = evaluateHaSnapshots(primary(), standby(), { expectedWriterEpoch: 4, maxReplayLagBytes: 4096 });
  assert.equal(result.passed, true, JSON.stringify(result.checks, null, 2));
  assert.equal(result.checks.length, 13);
  assert.equal(result.manualRequired.length, 5);
});

test('비동기 복제·WAL 지연·writer token 해제를 각각 실패로 보고한다', () => {
  const p = primary();
  p.streamingSyncStandbys = 0;
  p.maxReplayLagBytes = 8192;
  p.writerFence.requireToken = false;
  const result = evaluateHaSnapshots(p, standby(), { expectedWriterEpoch: 4, maxReplayLagBytes: 4096 });
  assert.equal(result.passed, false);
  assert.deepEqual(result.checks.filter((check) => !check.passed).map((check) => check.id), [
    'streamingSynchronousStandby', 'replicationLagBytes', 'writerTokenRequired',
  ]);
});

test('같은 주소·다른 계보·잘못된 역할·세대 불일치를 차단한다', () => {
  const p = primary();
  const s = standby();
  p.inRecovery = true;
  s.inRecovery = false;
  s.serverAddress = p.serverAddress;
  s.systemIdentifier = 'other';
  const result = evaluateHaSnapshots(p, s, { expectedWriterEpoch: 5, maxReplayLagBytes: 4096 });
  const failed = result.checks.filter((check) => !check.passed).map((check) => check.id);
  for (const id of ['primaryRole', 'standbyRole', 'sameClusterLineage', 'differentServerEndpoint', 'writerEpoch']) assert(failed.includes(id));
});
