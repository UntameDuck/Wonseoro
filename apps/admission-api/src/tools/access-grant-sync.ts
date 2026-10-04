/**
 * 접근 권한 부여·변경·말소 기록 수집 (개인정보의 안전성 확보조치 기준 제5조 ③, G-15·D-91) — 대학 API 와 같은 DB 환경에서 돈다.
 *
 *   node dist/tools/access-grant-sync.js [sync]   로그인 서버 관리 이벤트를 옮기고 실제 권한과 대조한다
 *   node dist/tools/access-grant-sync.js verify   기록의 해시 체인을 처음부터 검증한다
 *
 * 환경: DATABASE_URL, OIDC_STAFF_ISSUER(담당자 렐름 발급자), ACCESS_GRANT_CLIENT_ID·ACCESS_GRANT_CLIENT_SECRET(읽기 전용 수집 클라이언트).
 * 종료 코드: 0 정상 · 1 관리 이벤트가 꺼져 있음·체인 끊김·오류 · 2 잘못된 명령. 차트 CronJob 이 1시간마다 부른다(실패하면 Job 실패 경보).
 * 몇 번을 돌려도 결과가 같다(같은 이벤트는 한 줄).
 */
import { Logger } from '@nestjs/common';
import { configureEgress, Db, envOrDev, secretOrDev } from '@wonseoro/server-kit';
import { AccessGrantCollector } from '../modules/access-grant/access-grant-collector';
import { KeycloakAdmin } from '../modules/access-grant/idp-admin-client';

const logger = new Logger('access-grant-sync');

async function main(cmd: string | undefined): Promise<number> {
  if (cmd && !['sync', 'verify'].includes(cmd)) {
    logger.error('사용: access-grant-sync [sync|verify]');
    return 2;
  }
  const issuer = envOrDev('OIDC_STAFF_ISSUER', 'http://localhost:18080/realms/wonseoro-staff', '담당자 렐름 발급자 — 권한의 원본');
  configureEgress([issuer]);
  const idp = new KeycloakAdmin({
    issuer,
    clientId: envOrDev('ACCESS_GRANT_CLIENT_ID', 'access-grant-collector', '관리 이벤트·계정 권한을 읽는 수집 클라이언트'),
    clientSecret: secretOrDev('ACCESS_GRANT_CLIENT_SECRET', 'access-grant-collector-dev-secret', '수집 클라이언트 비밀'),
  });
  const db = new Db('admission-api');
  try {
    const collector = new AccessGrantCollector(db, idp);
    if (cmd !== 'verify') {
      const result = await collector.sync();
      logger.log(JSON.stringify(result));
      if (!result.adminEventsEnabled) {
        logger.error('로그인 서버의 관리 이벤트(세부 포함)가 꺼져 있다 — 권한을 누가 바꿨는지 남지 않는다. 대조 기록만 남겼다');
        return 1;
      }
    }
    const chain = await collector.verify();
    logger.log(JSON.stringify({ chain }));
    if (chain.brokenSeq !== null) {
      logger.error(`권한 변경 기록의 해시 체인이 순번 ${chain.brokenSeq} 에서 끊겼다`);
      return 1;
    }
    return 0;
  } finally {
    await db.pool.end();
  }
}

// process.exit 대신 종료 코드만 둔다 — 로그인 서버 연결(keep-alive)이 닫히는 중에 끊으면 Windows 의 Node 가 종료 코드 9 로 죽는다
main(process.argv[2]).then(
  (code) => {
    process.exitCode = code;
  },
  (err: Error) => {
    logger.error(`${err.name}: ${err.message}`);
    process.exitCode = 1;
  },
);
