import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { resolve } from 'node:path';

const projectRoot = resolve(process.argv[2] ?? '.');
const port = Number(process.argv[3] ?? 9418);

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const backend = spawn('git', ['http-backend'], {
    env: {
      ...process.env,
      GIT_PROJECT_ROOT: projectRoot,
      GIT_HTTP_EXPORT_ALL: '1',
      PATH_INFO: url.pathname,
      QUERY_STRING: url.searchParams.toString(),
      REQUEST_METHOD: request.method ?? 'GET',
      CONTENT_TYPE: request.headers['content-type'] ?? '',
      CONTENT_LENGTH: request.headers['content-length'] ?? '',
      REMOTE_ADDR: request.socket.remoteAddress ?? '',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  request.pipe(backend.stdin);
  let headersSent = false;
  let buffered = Buffer.alloc(0);

  backend.stdout.on('data', (chunk) => {
    if (headersSent) {
      response.write(chunk);
      return;
    }

    buffered = Buffer.concat([buffered, chunk]);
    const marker = buffered.indexOf('\r\n\r\n');
    if (marker < 0) return;

    const rawHeaders = buffered.subarray(0, marker).toString('utf8').split('\r\n');
    let statusCode = 200;
    for (const header of rawHeaders) {
      const separator = header.indexOf(':');
      if (separator < 0) continue;
      const name = header.slice(0, separator).trim();
      const value = header.slice(separator + 1).trim();
      if (name.toLowerCase() === 'status') statusCode = Number(value.split(' ', 1)[0]);
      else response.setHeader(name, value);
    }
    response.writeHead(statusCode);
    headersSent = true;
    response.write(buffered.subarray(marker + 4));
  });

  backend.stderr.on('data', (chunk) => process.stderr.write(chunk));
  backend.on('close', (code) => {
    if (!headersSent) response.writeHead(code === 0 ? 200 : 500);
    response.end();
  });
  backend.on('error', (error) => {
    if (!response.headersSent) response.writeHead(500);
    response.end(error.message);
  });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Git smart HTTP test server: ${projectRoot} on :${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
