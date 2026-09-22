import { Body, Controller, Header, HttpCode, Post } from '@nestjs/common';
import { ProfileVaultService, SnapshotRequest } from './profile-vault.service';

interface ProfileBody {
  subjectToken?: string;
  fields?: Record<string, unknown>;
  consents?: Array<{ universityId: string; fieldCodes: string[] }>;
}

/**
 * Common Profile Vault API
 *
 * ⚠️ canonical OpenAPI 에 없다. 계약 추가 대기. (불일치 대장 D-17)
 *
 * `/internal/v1/` 아래 둔다. 대학 Data Plane 이 mTLS 로 부르는 경로다. (M5 T-M5-05)
 * 지원자가 직접 부르는 공통원서 화면 API 는 M2 프론트 작업에서 별도로 연다.
 */
@Controller('internal/v1')
export class ProfileVaultController {
  constructor(private readonly vault: ProfileVaultService) {}

  /** 공통원서 저장 + 대학별 공개 동의. M2 개발 편의용 통합 엔드포인트. */
  @Post('profiles')
  @HttpCode(200)
  @Header('cache-control', 'no-store')
  async upsert(@Body() body: ProfileBody) {
    const subjectToken = body.subjectToken ?? '';
    await this.vault.upsertProfile(subjectToken, body.fields ?? {});
    for (const c of body.consents ?? []) {
      await this.vault.grantConsent(subjectToken, c.universityId, c.fieldCodes);
    }
    return { subjectToken, ok: true };
  }

  /**
   * Snapshot 발급. 대학이 원서를 만들 때 부른다. (v1.1 §10 §3)
   * 동의하지 않은 필드는 withheldFields 로 명시해 돌려준다.
   */
  @Post('profile-snapshots')
  @HttpCode(200)
  @Header('cache-control', 'no-store')
  async snapshot(@Body() body: SnapshotRequest) {
    return this.vault.release({
      subjectToken: body.subjectToken,
      universityId: body.universityId,
      requestedFields: body.requestedFields ?? [],
      ...(body.applicationRef ? { applicationRef: body.applicationRef } : {}),
    });
  }
}
