"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const admin_guard_1 = require("./admin.guard");
const config_1 = require("../../config");
function contextWith(headers) {
    return {
        switchToHttp: () => ({
            getRequest: () => ({ headers, method: 'POST', url: '/admin/v1/x', ip: '127.0.0.1' }),
        }),
    };
}
const status = (fn) => {
    try {
        fn();
        return undefined;
    }
    catch (err) {
        return err.problem?.status;
    }
};
(0, node_test_1.describe)('운영 API 문지기 (v1.1 §06·§09)', () => {
    const guard = new admin_guard_1.AdminGuard();
    (0, node_test_1.it)('토큰이 설정되지 않은 개발 환경에서는 통과시킨다', (t) => {
        if (config_1.ADMIN_API_TOKEN)
            return t.skip('ADMIN_API_TOKEN 이 설정된 환경');
        strict_1.default.equal(guard.canActivate(contextWith({})), true);
    });
    (0, node_test_1.it)('토큰이 설정되어 있으면 Bearer 가 없을 때 거부한다', (t) => {
        if (!config_1.ADMIN_API_TOKEN)
            return t.skip('ADMIN_API_TOKEN 미설정');
        strict_1.default.equal(status(() => guard.canActivate(contextWith({}))), 403);
    });
    (0, node_test_1.it)('토큰이 틀리면 거부한다', (t) => {
        if (!config_1.ADMIN_API_TOKEN)
            return t.skip('ADMIN_API_TOKEN 미설정');
        strict_1.default.equal(status(() => guard.canActivate(contextWith({ authorization: 'Bearer wrong' }))), 403);
    });
    (0, node_test_1.it)('토큰이 맞으면 통과한다', (t) => {
        if (!config_1.ADMIN_API_TOKEN)
            return t.skip('ADMIN_API_TOKEN 미설정');
        strict_1.default.equal(guard.canActivate(contextWith({ authorization: `Bearer ${config_1.ADMIN_API_TOKEN}` })), true);
    });
});
//# sourceMappingURL=admin.guard.test.js.map