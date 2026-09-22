/**
 * document-service — 서류 서비스
 *
 * M0 상태: 의존성 0의 헬스체크 전용 부트스트랩.
 * M1에서 NestFactory 기반으로 교체한다. (ADR-0001)
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.PORT ?? 3002);
const SERVICE = 'document-service';

const server = createServer((req, res) => {
  if (req.url === '/healthz' || req.url === '/readyz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ service: SERVICE, status: 'ok', time: new Date().toISOString() }));
    return;
  }
  res.writeHead(404, { 'content-type': 'application/problem+json' });
  res.end(JSON.stringify({ type: 'about:blank', title: 'Not Found', status: 404 }));
});

server.listen(PORT, () => {
  console.log(`[${SERVICE}] listening on :${PORT}`);
});
