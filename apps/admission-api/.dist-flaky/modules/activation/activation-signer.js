"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var ActivationSigner_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ActivationSigner = void 0;
exports.canonicalJson = canonicalJson;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const config_1 = require("../../config");
/**
 * 활성화 기록 서명기 — Ed25519. (v1.1 §B17 · §A1, T-M3-15)
 *
 * 왜 HMAC 이 아니라 공개키 서명인가
 *   HMAC 은 검증하는 쪽도 같은 비밀을 가져야 한다. 그러면 검증할 수 있는 사람은
 *   위조도 할 수 있다. 분쟁에서 "이 대학이 이 마감을 승인된 그대로 적용했다" 를
 *   대학 밖(중앙·감사인·법원)이 확인하려면 비밀 없이 검증할 수 있어야 한다.
 *
 * 무엇을 서명하나
 *   정규화한 JSON. 키를 정렬하고 공백 없이 직렬화한다. jsonb 로 저장하면 키 순서가
 *   바뀌지만, 검증할 때 같은 규칙으로 다시 정규화하므로 같은 바이트가 나온다.
 */
let ActivationSigner = ActivationSigner_1 = class ActivationSigner {
    logger = new common_1.Logger(ActivationSigner_1.name);
    keyId = config_1.POLICY_SIGNING_KEY_ID;
    privateKey;
    publicKey;
    constructor() {
        this.privateKey = config_1.POLICY_SIGNING_KEY
            ? (0, node_crypto_1.createPrivateKey)(config_1.POLICY_SIGNING_KEY)
            : devKey();
        if (this.privateKey.asymmetricKeyType !== 'ed25519') {
            throw new Error('POLICY_SIGNING_KEY 는 Ed25519 개인키여야 합니다');
        }
        this.publicKey = (0, node_crypto_1.createPublicKey)(this.privateKey);
        if (!config_1.POLICY_SIGNING_KEY) {
            this.logger.warn('개발용 서명 키 사용 중 — 이 키로 서명한 기록은 아무것도 증명하지 못한다');
        }
    }
    sign(payload) {
        const bytes = Buffer.from(canonicalJson(payload), 'utf8');
        return {
            payloadHash: (0, node_crypto_1.createHash)('sha256').update(bytes).digest('hex'),
            signature: (0, node_crypto_1.sign)(null, bytes, this.privateKey).toString('base64'),
            keyId: this.keyId,
        };
    }
    /**
     * 해시와 서명을 둘 다 본다. 해시만 맞으면 누군가 payload 와 해시를 함께 바꾼 것이고,
     * 서명만 보면 payload_hash 컬럼이 거짓이어도 모른다.
     */
    verify(record) {
        // 키를 교체하면 옛 기록은 옛 공개키로 검증해야 한다. 지금은 현재 키 하나만 안다.
        // 모른다고 INVALID 로 말하면 위조로 오해한다. (D-35 — 키 교체 시 검증 키 목록 필요)
        if (record.keyId !== this.keyId)
            return 'UNKNOWN_KEY';
        const bytes = Buffer.from(canonicalJson(record.payload), 'utf8');
        const hash = (0, node_crypto_1.createHash)('sha256').update(bytes).digest('hex');
        if (hash !== record.payloadHash)
            return 'INVALID';
        try {
            const ok = (0, node_crypto_1.verify)(null, bytes, this.publicKey, Buffer.from(record.signature, 'base64'));
            return ok ? 'VALID' : 'INVALID';
        }
        catch {
            return 'INVALID';
        }
    }
    /** 공개 검증 키. 누구나 가져가 서명을 확인할 수 있다. */
    publicKeys() {
        return [
            {
                keyId: this.keyId,
                alg: 'Ed25519',
                publicKeyPem: this.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
            },
        ];
    }
};
exports.ActivationSigner = ActivationSigner;
exports.ActivationSigner = ActivationSigner = ActivationSigner_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], ActivationSigner);
/** 키를 정렬해 공백 없이 직렬화한다. 같은 내용이면 항상 같은 문자열이 나온다. */
function canonicalJson(value) {
    return JSON.stringify(sortKeys(value));
}
function sortKeys(value) {
    if (value === null || typeof value !== 'object')
        return value;
    if (Array.isArray(value))
        return value.map(sortKeys);
    return Object.keys(value)
        .sort()
        .reduce((acc, k) => {
        const v = value[k];
        // undefined 는 JSON 에 없다. 저장 전후가 달라지지 않게 미리 뺀다.
        if (v !== undefined)
            acc[k] = sortKeys(v);
        return acc;
    }, {});
}
/**
 * 개발용 고정 키. 재기동해도 같은 키라 개발 DB 의 기존 기록을 계속 검증할 수 있다.
 * 시드가 코드에 있으므로 **아무나 같은 서명을 만들 수 있다.** 운영에서는 기동이 막힌다.
 */
function devKey() {
    const seed = (0, node_crypto_1.createHash)('sha256').update('wonseoro-dev-activation-signing-key').digest();
    // Ed25519 PKCS#8 DER 머리. 32바이트 시드를 붙이면 개인키가 된다. (RFC 8410)
    const der = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]);
    return (0, node_crypto_1.createPrivateKey)({ key: der, format: 'der', type: 'pkcs8' });
}
//# sourceMappingURL=activation-signer.js.map