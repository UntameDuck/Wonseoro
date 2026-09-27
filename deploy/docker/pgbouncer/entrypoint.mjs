import { appendFileSync, chmodSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name}이 필요합니다`);
  return value;
};
const integer = (name, fallback, min, max) => {
  const raw = process.env[name] ?? String(fallback);
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name}은 ${min}~${max}의 정수여야 합니다: ${raw}`);
  }
  return value;
};
const choice = (name, fallback, allowed) => {
  const value = process.env[name] ?? fallback;
  if (!allowed.includes(value)) throw new Error(`${name}은 ${allowed.join(' | ')} 중 하나여야 합니다: ${value}`);
  return value;
};
const connQuote = (value) => `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
const authQuote = (value) => `"${value.replaceAll('"', '""')}"`;

const databaseUrl = new URL(required('DATABASE_URL'));
if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol)) {
  throw new Error('DATABASE_URL은 PostgreSQL URL이어야 합니다');
}
const username = decodeURIComponent(databaseUrl.username);
const password = decodeURIComponent(databaseUrl.password);
const database = decodeURIComponent(databaseUrl.pathname.replace(/^\//, ''));
if (!username || !password || !database) {
  throw new Error('DATABASE_URL에 user·password·database가 모두 필요합니다');
}

const listenPort = integer('PGBOUNCER_PORT', 6432, 1, 65_535);
const defaultPoolSize = integer('PGBOUNCER_DEFAULT_POOL_SIZE', 20, 1, 5000);
const reservePoolSize = integer('PGBOUNCER_RESERVE_POOL_SIZE', 5, 0, 5000);
const maxClientConnections = integer('PGBOUNCER_MAX_CLIENT_CONNECTIONS', 1000, 1, 100_000);
const queryWaitTimeout = integer('PGBOUNCER_QUERY_WAIT_TIMEOUT_SECONDS', 15, 1, 3600);
const poolMode = choice('PGBOUNCER_POOL_MODE', 'transaction', ['session', 'transaction']);
const clientTlsSslMode = choice(
  'PGBOUNCER_CLIENT_TLS_SSLMODE',
  'require',
  ['disable', 'allow', 'prefer', 'require', 'verify-ca', 'verify-full'],
);
const clientTlsCertFile = process.env.PGBOUNCER_CLIENT_TLS_CERT_FILE;
const clientTlsKeyFile = process.env.PGBOUNCER_CLIENT_TLS_KEY_FILE;
if (clientTlsSslMode !== 'disable' && (!clientTlsCertFile || !clientTlsKeyFile)) {
  throw new Error(`${clientTlsSslMode}에는 PGBOUNCER_CLIENT_TLS_CERT_FILE·KEY_FILE이 필요합니다`);
}
const sslMode = choice(
  'PGBOUNCER_SERVER_TLS_SSLMODE',
  databaseUrl.searchParams.get('sslmode') ?? 'prefer',
  ['disable', 'allow', 'prefer', 'require', 'verify-ca', 'verify-full'],
);
const caFile = process.env.PGBOUNCER_SERVER_TLS_CA_FILE;
if ((sslMode === 'verify-ca' || sslMode === 'verify-full') && !caFile) {
  throw new Error(`${sslMode}에는 PGBOUNCER_SERVER_TLS_CA_FILE이 필요합니다`);
}

const authFile = '/tmp/pgbouncer-users.txt';
const configFile = '/tmp/pgbouncer.ini';
writeFileSync(authFile, `${authQuote(username)} ${authQuote(password)}\n`, { mode: 0o600 });
writeFileSync(
  configFile,
  `[databases]\n${database} = host=${connQuote(databaseUrl.hostname)} port=${databaseUrl.port || '5432'} dbname=${connQuote(database)} user=${connQuote(username)} password=${connQuote(password)} pool_size=${defaultPoolSize} reserve_pool_size=${reservePoolSize} max_db_connections=${defaultPoolSize + reservePoolSize}\n\n[pgbouncer]\nlisten_addr = 0.0.0.0\nlisten_port = ${listenPort}\nunix_socket_dir = /tmp\npidfile = /tmp/pgbouncer.pid\nlogfile = /dev/stderr\nauth_type = scram-sha-256\nauth_file = ${authFile}\npool_mode = ${poolMode}\nmax_client_conn = ${maxClientConnections}\ndefault_pool_size = ${defaultPoolSize}\nreserve_pool_size = ${reservePoolSize}\nreserve_pool_timeout = 3\nquery_wait_timeout = ${queryWaitTimeout}\nserver_login_retry = 1\nserver_tls_sslmode = ${sslMode}\n${caFile ? `server_tls_ca_file = ${caFile}\n` : ''}max_prepared_statements = 100\ntrack_extra_parameters = search_path,default_transaction_read_only\n`,
  { mode: 0o600 },
);
appendFileSync(
  configFile,
  `logfile =\nclient_tls_sslmode = ${clientTlsSslMode}\n${clientTlsCertFile ? `client_tls_cert_file = ${clientTlsCertFile}\nclient_tls_key_file = ${clientTlsKeyFile}\n` : ''}`,
  { mode: 0o600 },
);
chmodSync(configFile, 0o600);

const child = spawn('/usr/bin/pgbouncer', [configFile], { stdio: 'inherit' });
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
