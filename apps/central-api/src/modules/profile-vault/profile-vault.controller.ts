import { Body, Controller, Get, Header, Headers, HttpCode, HttpException, Post, Put, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { subjectOf } from '../../identity';
import { sameUniversity } from '../../internal-auth';
import { ProfileRejection, ProfileVaultService, SnapshotRequest } from './profile-vault.service';

interface ProfileBody {
  fields?: unknown;
  consents?: unknown;
}

/**
 * Common Profile Vault — 대학용 내부 API (계약: releaseProfileSnapshot, D-17)
 *
 * `/internal/v1/` 아래 둔다. 대학 API 가 상호 TLS 로 부르는 경로다(T-M5-05) — 요청의 대학이 인증서의 대학과 같아야 한다.
 * 다르면 403 — 다른 대학에 동의된 공통원서를 가져가지 못한다(D-69).
 * 지원자가 공통원서를 쓰는 API 는 아래 ApplicantProfileController 다.
 */
@Controller('internal/v1')
export class ProfileVaultController {
  constructor(private readonly vault: ProfileVaultService) {}

  /**
   * Snapshot 발급. 대학이 원서를 만들 때 부른다. (v1.1 §10 §3)
   * 동의하지 않은 필드는 withheldFields 로 명시해 돌려준다.
   */
  @Post('profile-snapshots')
  @HttpCode(200)
  @Header('cache-control', 'no-store')
  async snapshot(@Body() body: SnapshotRequest, @Req() req?: FastifyRequest) {
    sameUniversity(req, body?.universityId, '스냅숏을 요청한 대학');
    return this.vault.release({
      subjectToken: body.subjectToken,
      universityId: body.universityId,
      requestedFields: body.requestedFields ?? [],
      ...(body.applicationRef ? { applicationRef: body.applicationRef } : {}),
    });
  }
}

/**
 * 공통원서 — 지원자용 API (계약: getMyProfile · replaceMyProfile, D-57)
 *
 * 전에는 공통원서를 쓰는 길이 개발용 내부 경로(`POST /internal/v1/profiles`)뿐이었다 — 토큰 검사도
 * 입력 검사도 없이 본문의 토큰으로 누구의 공통원서든 덮어썼고, 화면은 그것을 부르지 않았다.
 * 지원자가 공통원서를 쓸 수 없으면 대학 원서의 "공통원서에서 가져온 정보" 는 늘 비어 있다.
 *
 * 신원은 인증 방식(AUTH_MODE)에 맞는 곳에서만 얻는다(oidc 면 검증된 토큰의 주체). 본문의 토큰은 받지 않는다.
 * 저장은 통째로 바꾸는 PUT 이라 같은 요청을 다시 보내도 결과가 같다 — 멱등키가 필요 없다.
 */
@Controller('api/v1/profile')
export class ApplicantProfileController {
  constructor(private readonly vault: ProfileVaultService) {}

  @Get()
  @Header('cache-control', 'no-store')
  async get(
    @Headers('x-subject-token') devToken?: string,
    @Headers('x-authenticated-subject') gatewayToken?: string,
    @Req() req?: FastifyRequest,
  ) {
    return this.vault.profileOf(subjectOf({ dev: devToken, gateway: gatewayToken, oidc: req?.applicantSubject }));
  }

  @Put()
  @HttpCode(200)
  @Header('cache-control', 'no-store')
  async replace(
    @Body() body: ProfileBody,
    @Headers('x-subject-token') devToken?: string,
    @Headers('x-authenticated-subject') gatewayToken?: string,
    @Req() req?: FastifyRequest,
  ) {
    const subjectToken = subjectOf({ dev: devToken, gateway: gatewayToken, oidc: req?.applicantSubject });
    try {
      return await this.vault.replaceProfile(subjectToken, body?.fields ?? {}, body?.consents);
    } catch (err) {
      if (err instanceof ProfileRejection) {
        throw new HttpException(
          {
            type: 'https://wonseoro.kr/problems/validation-failed',
            title: '공통원서를 저장할 수 없습니다',
            status: 400,
            code: 'VALIDATION_FAILED',
            traceId: '',
            detail: err.detail,
          },
          400,
        );
      }
      throw err;
    }
  }
}
