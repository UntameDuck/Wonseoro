"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const instrumentation_1 = require("./instrumentation");
require("reflect-metadata");
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const platform_fastify_1 = require("@nestjs/platform-fastify");
const app_module_1 = require("./app.module");
const app_setup_1 = require("./app.setup");
const config_1 = require("./config");
const server_kit_1 = require("@wonseoro/server-kit");
/**
 * admission-api — 대학 Data Plane 메인 API
 *
 * 이 서비스에서 커밋된 것만 "접수됨"이다. (기술설계서 v1.1 §02)
 * 중앙(central-api)은 이 서비스의 Critical Path 에 들어가지 않는다.
 */
async function bootstrap() {
    /**
     * 설정을 먼저 확인한다. 빠진 것이 있으면 뜨지 않는다.
     * 잘못된 설정으로 뜨는 것보다 안 뜨는 것이 낫다 — 접수 서버는 특히 그렇다.
     */
    (0, server_kit_1.assertConfigured)();
    // Vault 를 쓰면 인증서·KEK 를 먼저 받는다(인증서 파일을 읽기 전에, T-M5-04)
    await (0, server_kit_1.startVaultSecrets)('admission-api');
    const app = await core_1.NestFactory.create(app_module_1.AppModule, 
    // trustProxy: Edge/WAF 뒤에 있으므로 원 IP 판단에 필요하다.
    // 내부 경로가 상호 TLS 면 HTTPS 로 듣는다(앞단 → API 도 TLS) — 클라이언트 인증서는 요청만, 내부 경로만 요구한다 (T-M5-05)
    new platform_fastify_1.FastifyAdapter({ trustProxy: true, bodyLimit: 1_048_576, ...(config_1.INTERNAL.files ? { https: (0, server_kit_1.serverTlsOptions)(config_1.INTERNAL.files) } : {}) }), 
    // 본문 파서는 아래에서 직접 등록한다. Nest 가 자기 JSON 파서를 따로 올리면
    // 깨진 UTF-8 을 받아들이는 기본 동작이 되살아난다. (D-37)
    // 로그는 한 줄 JSON + trace_id, 본문 없이 마스킹을 거친다. (T-M4-20 · T-M4-24)
    { bodyParser: false, logger: new server_kit_1.StructuredLogger('admission-api') });
    // 파서·인증·요청 한도·오류 형식·멱등성·CORS — 시험과 같은 조립 (app.setup.ts)
    (0, app_setup_1.configureHttpApp)(app);
    await app.listen({ port: config_1.PORT, host: '0.0.0.0' });
    // 짧은 인증서를 재기동 없이 교체한다
    if (config_1.INTERNAL.files)
        (0, server_kit_1.watchServerTls)(app.getHttpServer(), config_1.INTERNAL.files);
    const logger = new common_1.Logger('admission-api');
    let shuttingDown = false;
    const shutdown = (signal) => {
        if (shuttingDown)
            return;
        shuttingDown = true;
        logger.log(`${signal} 수신 — HTTP 연결 종료 후 telemetry를 flush합니다.`);
        void app
            .close()
            .then(() => (0, instrumentation_1.shutdownTelemetry)())
            .then(() => process.exit(0))
            .catch((error) => {
            logger.error('정상 종료 중 오류', error);
            process.exit(1);
        });
    };
    process.once('SIGTERM', () => shutdown('SIGTERM'));
    process.once('SIGINT', () => shutdown('SIGINT'));
    logger.log(`listening on :${config_1.PORT} (university=${config_1.UNIVERSITY_ID}, auth=${config_1.AUTH_MODE}, ${config_1.INTERNAL.files ? 'https·내부 경로 상호 TLS' : 'http·내부 경로 인증 없음(개발)'})`);
    if (!(0, server_kit_1.isProduction)() && config_1.AUTH_MODE === 'dev-headers') {
        logger.warn('개발 인증 모드입니다. 헤더만 바꾸면 남의 원서를 열람·수정할 수 있습니다. 운영 배포 금지.');
    }
    if (config_1.AUTH_MODE === 'oidc') {
        logger.log(`OIDC 검증 — 지원자 ${config_1.OIDC.applicantIssuer} · 담당자 ${config_1.OIDC.staffIssuer} (acr=${config_1.OIDC.staffAcr}, 재인증 ${config_1.OIDC.stepUpMaxAgeSec}초)`);
    }
    else if (!config_1.ADMIN_API_TOKEN) {
        logger.warn('ADMIN_API_TOKEN 미설정 — /admin/v1 이 열려 있습니다. 개발 환경에서만 허용됩니다.');
    }
}
void bootstrap();
//# sourceMappingURL=main.js.map