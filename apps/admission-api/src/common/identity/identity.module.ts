import { Global, Module } from '@nestjs/common';
import { Ownership } from './ownership.service';

/**
 * 소유권 확인은 거의 모든 모듈이 쓴다.
 * 모듈마다 provider 를 다시 선언하게 하면 한 곳이 빠졌을 때 그 경로만 조용히 뚫린다.
 */
@Global()
@Module({ providers: [Ownership], exports: [Ownership] })
export class IdentityModule {}
