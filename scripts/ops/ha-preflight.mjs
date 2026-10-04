// 외부 PostgreSQL HA 사전 점검 — T-M4-06·T-M5-60·61·64
//
// PRIMARY_DATABASE_URL·STANDBY_DATABASE_URL로 각각 읽기 전용 접속한다. 역할·동기 스트리밍·WAL 지연·
// archive 설정·Writer fencing을 확인하지만 zone·원격 백업·실 RTO/RPO를 추정하지 않는다.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

export function evaluateHaSnapshots(primary, standby, options) {
  const checks = [];
  const add = (id, passed, actual, expected) => checks.push({ id, passed: !!passed, actual, expected });

  add('primaryRole', primary.inRecovery === false, primary.inRecovery ? 'standby' : 'primary', 'primary');
  add('standbyRole', standby.inRecovery === true, standby.inRecovery ? 'standby' : 'primary', 'standby');
  add('sameMajorVersion', primary.majorVersion === standby.majorVersion, `${primary.majorVersion}/${standby.majorVersion}`, 'same');
  add('sameClusterLineage', !!primary.systemIdentifier && primary.systemIdentifier === standby.systemIdentifier,
    `${primary.systemIdentifier ?? 'unknown'}/${standby.systemIdentifier ?? 'unknown'}`, 'same system identifier');
  add('differentServerEndpoint', !!primary.serverAddress && !!standby.serverAddress &&
    `${primary.serverAddress}:${primary.serverPort}` !== `${standby.serverAddress}:${standby.serverPort}`,
  `${primary.serverAddress}:${primary.serverPort}/${standby.serverAddress}:${standby.serverPort}`, 'different');
  add('synchronousCommit', ['on', 'remote_write', 'remote_apply'].includes(primary.synchronousCommit), primary.synchronousCommit, 'on/remote_write/remote_apply');
  add('streamingSynchronousStandby', primary.streamingSyncStandbys >= 1, primary.streamingSyncStandbys, '>=1');
  add('replicationLagBytes', primary.maxReplayLagBytes <= options.maxReplayLagBytes, primary.maxReplayLagBytes, `<=${options.maxReplayLagBytes}`);
  add('walReceiverStreaming', standby.walReceiverStatus === 'streaming', standby.walReceiverStatus ?? 'none', 'streaming');
  add('hotStandby', standby.hotStandby === 'on', standby.hotStandby, 'on');
  add('walArchiveEnabled', ['on', 'always'].includes(primary.archiveMode) && primary.archiveCommandConfigured,
    { archiveMode: primary.archiveMode, archiveCommandConfigured: primary.archiveCommandConfigured }, 'archive_mode on/always + command configured');
  add('writerTokenRequired', primary.writerFence?.requireToken === true, primary.writerFence?.requireToken ?? null, true);
  add('writerEpoch', Number(primary.writerFence?.epoch) === options.expectedWriterEpoch,
    Number(primary.writerFence?.epoch), options.expectedWriterEpoch);

  return {
    passed: checks.every((check) => check.passed),
    checks,
    manualRequired: [
      'Primary와 Standby가 서로 다른 가용영역에 있다는 CSP 증적',
      '기본 백업과 WAL이 다른 장애영역·리전에 소산된 증적',
      '해당 백업에서 목표 시각으로 PITR한 복구 검증 결과',
      '부하 중 Failover와 전체 DR 전환의 실제 RTO·RPO',
      '옛 Writer fencing, DNS/Edge 전환, 전환 후 Reconciliation 증적',
    ],
  };
}

async function snapshot(connectionString, role) {
  const client = new pg.Client({ connectionString, application_name: `wonseoro-ha-preflight-${role}`, statement_timeout: 30_000 });
  await client.connect();
  try {
    await client.query('BEGIN TRANSACTION READ ONLY');
    await client.query(`SET LOCAL search_path TO kadmission, public`);
    const base = (await client.query(`
      SELECT pg_is_in_recovery() AS in_recovery,
             current_setting('server_version_num')::int AS version_num,
             current_setting('synchronous_commit') AS synchronous_commit,
             current_setting('archive_mode') AS archive_mode,
             current_setting('archive_command') NOT IN ('', '(disabled)') AS archive_command_configured,
             current_setting('hot_standby') AS hot_standby,
             inet_server_addr()::text AS server_address,
             inet_server_port() AS server_port
    `)).rows[0];
    let systemIdentifier = null;
    try {
      systemIdentifier = (await client.query(`SELECT system_identifier::text FROM pg_control_system()`)).rows[0]?.system_identifier ?? null;
    } catch {
      // 관리형 DB가 pg_control_system 권한을 막으면 결과에서 unknown으로 남고 통과하지 않는다.
    }
    const result = {
      inRecovery: base.in_recovery,
      majorVersion: Math.floor(Number(base.version_num) / 10000),
      synchronousCommit: base.synchronous_commit,
      archiveMode: base.archive_mode,
      archiveCommandConfigured: base.archive_command_configured,
      hotStandby: base.hot_standby,
      serverAddress: base.server_address,
      serverPort: Number(base.server_port),
      systemIdentifier,
    };
    if (role === 'primary') {
      const replication = (await client.query(`
        SELECT count(*) FILTER (WHERE state='streaming' AND sync_state IN ('sync','quorum'))::int AS streaming_sync,
               COALESCE(max(pg_wal_lsn_diff(sent_lsn,replay_lsn)),0)::bigint::text AS max_replay_lag_bytes
          FROM pg_stat_replication
      `)).rows[0];
      result.streamingSyncStandbys = Number(replication.streaming_sync);
      result.maxReplayLagBytes = Number(replication.max_replay_lag_bytes);
      result.writerFence = (await client.query(`SELECT epoch,require_token FROM writer_fence WHERE singleton`)).rows[0];
      result.writerFence = result.writerFence ? { epoch: Number(result.writerFence.epoch), requireToken: result.writerFence.require_token } : null;
    } else {
      result.walReceiverStatus = (await client.query(`SELECT status FROM pg_stat_wal_receiver LIMIT 1`)).rows[0]?.status ?? null;
    }
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

async function cli() {
  const value = (name) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const environment = value('environment');
  const approval = value('approval');
  const expectedWriterEpoch = Number(value('expected-writer-epoch'));
  const maxReplayLagBytes = Number(value('max-replay-lag-bytes'));
  const primaryUrl = process.env.PRIMARY_DATABASE_URL;
  const standbyUrl = process.env.STANDBY_DATABASE_URL;
  if (!environment || !approval || !primaryUrl || !standbyUrl || !Number.isInteger(expectedWriterEpoch) || expectedWriterEpoch < 1 ||
      !Number.isInteger(maxReplayLagBytes) || maxReplayLagBytes < 0) {
    console.error('사용: PRIMARY_DATABASE_URL=... STANDBY_DATABASE_URL=... node scripts/ops/ha-preflight.mjs --environment=<ID> --approval=<티켓> --expected-writer-epoch=N --max-replay-lag-bytes=N [--no-write]');
    process.exit(2);
  }
  const [primary, standby] = await Promise.all([snapshot(primaryUrl, 'primary'), snapshot(standbyUrl, 'standby')]);
  const evaluation = evaluateHaSnapshots(primary, standby, { expectedWriterEpoch, maxReplayLagBytes });
  const result = {
    test: 'PostgreSQL 외부 HA 사전 점검 (T-M4-06·T-M5-60·61·64)',
    at: new Date().toISOString(),
    environment,
    approval,
    ...evaluation,
    snapshots: { primary, standby },
  };
  console.log(`${result.passed ? '✔' : '✘'} ${environment} — HA DB 자동 점검 ${result.checks.filter((check) => check.passed).length}/${result.checks.length}`);
  for (const check of result.checks.filter((item) => !item.passed)) console.log(`  - ${check.id}: 실제 ${JSON.stringify(check.actual)}, 기대 ${JSON.stringify(check.expected)}`);
  for (const item of result.manualRequired) console.log(`  △ 사람 증적: ${item}`);
  if (!process.argv.includes('--no-write')) {
    const dir = path.join(ROOT, 'tests/ops/results');
    mkdirSync(dir, { recursive: true });
    const slug = environment.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '') || 'environment';
    const out = path.join(dir, `ha-preflight-${slug}-${result.at.replace(/[:.]/g, '-')}.json`);
    writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
    console.log(`  결과: ${path.relative(ROOT, out)}`);
  }
  process.exit(result.passed ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await cli();
