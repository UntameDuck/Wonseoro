"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.IdempotencyModule = void 0;
const common_1 = require("@nestjs/common");
const server_kit_1 = require("@wonseoro/server-kit");
const config_1 = require("../../config");
const peak_mode_1 = require("../scheduling/peak-mode");
const idempotency_purge_scheduler_1 = require("./idempotency-purge.scheduler");
const idempotency_store_1 = require("./idempotency.store");
const postgres_idempotency_store_1 = require("./postgres-idempotency.store");
let IdempotencyModule = class IdempotencyModule {
};
exports.IdempotencyModule = IdempotencyModule;
exports.IdempotencyModule = IdempotencyModule = __decorate([
    (0, common_1.Global)(),
    (0, common_1.Module)({
        providers: [
            {
                provide: idempotency_store_1.IdempotencyStore,
                useFactory: (db) => new postgres_idempotency_store_1.PostgresIdempotencyStore(db),
                inject: [server_kit_1.Db],
            },
            { provide: peak_mode_1.PEAK_MODE_POLICY, useValue: config_1.PEAK_MODE },
            idempotency_purge_scheduler_1.IdempotencyPurgeScheduler,
        ],
        exports: [idempotency_store_1.IdempotencyStore],
    })
], IdempotencyModule);
//# sourceMappingURL=idempotency.module.js.map