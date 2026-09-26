import { Controller, Get, Global, Header, Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ActivationRecorder } from './activation-recorder';
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
@Controller('api/v1/meta')
export class SigningKeysController {
  constructor(private readonly signer: ActivationSigner) {}

  @Get('signing-keys')
  @Header('cache-control', 'public, max-age=300')
  keys() {
    return { keys: this.signer.publicKeys() };
  }
}

/** 서명된 활성화 기록. 마감 정책·설정 양쪽이 쓰므로 전역으로 둔다. (T-M3-14·15) */
@Global()
@Module({
  imports: [AuditModule],
  controllers: [SigningKeysController],
  providers: [ActivationSigner, ActivationRecorder],
  exports: [ActivationSigner, ActivationRecorder],
})
export class ActivationModule {}
