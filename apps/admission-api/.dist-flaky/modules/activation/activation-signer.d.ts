export type SignatureStatus = 'VALID' | 'INVALID' | 'UNKNOWN_KEY';
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
export declare class ActivationSigner {
    private readonly logger;
    readonly keyId: string;
    private readonly privateKey;
    private readonly publicKey;
    constructor();
    sign(payload: Record<string, unknown>): {
        payloadHash: string;
        signature: string;
        keyId: string;
    };
    /**
     * 해시와 서명을 둘 다 본다. 해시만 맞으면 누군가 payload 와 해시를 함께 바꾼 것이고,
     * 서명만 보면 payload_hash 컬럼이 거짓이어도 모른다.
     */
    verify(record: {
        payload: Record<string, unknown>;
        payloadHash: string;
        signature: string;
        keyId: string;
    }): SignatureStatus;
    /** 공개 검증 키. 누구나 가져가 서명을 확인할 수 있다. */
    publicKeys(): Array<{
        keyId: string;
        alg: 'Ed25519';
        publicKeyPem: string;
    }>;
}
/** 키를 정렬해 공백 없이 직렬화한다. 같은 내용이면 항상 같은 문자열이 나온다. */
export declare function canonicalJson(value: unknown): string;
