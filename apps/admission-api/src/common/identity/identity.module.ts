import { Global, Module } from '@nestjs/common';
import { AUTH_MODE } from '../../config';
import { ApplicantDirectory, OidcAuthenticator } from './oidc-auth';
import { Ownership } from './ownership.service';

/** oidc 모드에서만 토큰 검증기를 만든다 — 다른 모드에서는 발급자 설정이 없다 */
const oidcProviders = AUTH_MODE === 'oidc' ? [ApplicantDirectory, OidcAuthenticator] : [];

/**
 * 소유권 확인은 거의 모든 모듈이 쓴다.
 * 모듈마다 provider 를 다시 선언하게 하면 한 곳이 빠졌을 때 그 경로만 조용히 뚫린다.
 */
@Global()
@Module({ providers: [Ownership, ...oidcProviders], exports: [Ownership, ...oidcProviders] })
export class IdentityModule {}
