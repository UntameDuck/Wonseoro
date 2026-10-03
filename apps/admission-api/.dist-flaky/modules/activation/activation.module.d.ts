import { ActivationSigner } from './activation-signer';
/**
 * GET /api/v1/meta/signing-keys — 활성화 기록 검증용 공개키.
 *
 * 누구나 가져갈 수 있다. 공개키로는 서명을 만들 수 없고 확인만 할 수 있다.
 * 중앙이 끊겨도 이 대학이 적용한 마감 정책이 승인된 그대로인지,
 * 이 키와 활성화 기록만으로 대학 밖에서 확인할 수 있다. (§A1)
 *
 * 계약에 없는 경로다. (D-35)
 */
export declare class SigningKeysController {
    private readonly signer;
    constructor(signer: ActivationSigner);
    keys(): {
        keys: {
            keyId: string;
            alg: "Ed25519";
            publicKeyPem: string;
        }[];
    };
}
/** 서명된 활성화 기록. 마감 정책·설정 양쪽이 쓰므로 전역으로 둔다. (T-M3-14·15) */
export declare class ActivationModule {
}
