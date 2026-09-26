import { Injectable, Logger } from '@nestjs/common';
import { CircuitOpenError, describeFailure, httpServerError } from '@wonseoro/server-kit';
import { DependencyBreakers } from '../../common/resilience/dependency-breakers';
import { CENTRAL_SYNC_URL, VAULT_TIMEOUT_MS } from '../../config';

export interface ProfileSnapshot {
  fields: Record<string, unknown>;
  releasedFields: string[];
  withheldFields: string[];
  /** 중앙에서 실제로 받아왔는가. false 면 빈 원서로 시작한다. */
  available: boolean;
}

/**
 * Common Profile Vault 클라이언트 — 기술설계서 v1.1 §10 §3
 *
 * **Snapshot 은 best-effort 다.** (불일치 대장 D-18)
 *
 * §10 §1 은 "Snapshot 생성 후 작성·제출은 중앙과 무관"이라고 적는다.
 * 생성 시점에는 중앙이 필요하다는 뜻인데, 같은 표가 "중앙 검색 장애여도
 * 대학 직접 URL 접수 가능"이라고도 적는다. 둘을 모두 만족하려면
 * **중앙이 없을 때 빈 원서로라도 만들 수 있어야 한다.**
 *
 * 중앙은 편의 계층이다. 편의가 없다고 접수 기회를 잃으면 이 제품의 전제가 무너진다.
 * 그래서 여기서는 실패를 삼키고 빈 Snapshot 을 돌려준다. 예외를 올리지 않는다.
 *
 * **Circuit Breaker 는 이 성질을 바꾸지 않는다.** (v1.1 §01 C8)
 * 바꾸는 것은 대기 시간뿐이다. 중앙이 죽은 것이 확인되면 매 원서 생성이
 * VAULT_TIMEOUT_MS 를 기다렸다 빈 원서로 가는 대신, 바로 빈 원서로 간다.
 */
@Injectable()
export class ProfileVaultClient {
  private readonly logger = new Logger(ProfileVaultClient.name);

  constructor(private readonly breakers: DependencyBreakers) {}

  /** 대학이 필요로 하는 공통 필드. 전형 Config 로 옮기는 것이 M3 과제다. */
  private static readonly REQUESTED_FIELDS = [
    'highSchool',
    'graduationYear',
    'contactEmail',
  ] as const;

  async fetchSnapshot(args: {
    subjectToken: string;
    universityId: string;
    applicationRef: string;
  }): Promise<ProfileSnapshot> {
    const empty: ProfileSnapshot = {
      fields: {},
      releasedFields: [],
      withheldFields: [],
      available: false,
    };

    const url = CENTRAL_SYNC_URL;
    if (!url) return empty;

    try {
      const res = await this.breakers.centralVault.run(
        () =>
          fetch(`${url}/internal/v1/profile-snapshots`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              subjectToken: args.subjectToken,
              universityId: args.universityId,
              requestedFields: [...ProfileVaultClient.REQUESTED_FIELDS],
              applicationRef: args.applicationRef,
            }),
            // 짧게 끊는다. 중앙이 느리다고 원서 생성이 느려지면 안 된다.
            signal: AbortSignal.timeout(VAULT_TIMEOUT_MS),
          }),
        // 4xx 는 중앙이 살아서 거절한 것이다. 5xx·연결 실패만 장애로 센다.
        { isFailure: httpServerError },
      );

      if (!res.ok) {
        this.logger.warn(`profile snapshot unavailable (${res.status}) — 빈 원서로 진행`);
        return empty;
      }

      const body = (await res.json()) as {
        fields?: Record<string, unknown>;
        releasedFields?: string[];
        withheldFields?: string[];
      };
      return {
        fields: body.fields ?? {},
        releasedFields: body.releasedFields ?? [],
        withheldFields: body.withheldFields ?? [],
        available: true,
      };
    } catch (err) {
      // 이미 끊긴 것을 아는 상태다. 원서마다 같은 경고를 남기면 로그가 묻힌다.
      // 열림·닫힘은 DependencyBreakers 가 한 번씩 남긴다.
      if (err instanceof CircuitOpenError) return empty;
      // 중앙이 꺼져 있다. 정상 상황이다. 사용자는 직접 입력하면 된다.
      this.logger.warn(`profile snapshot failed (${describeFailure(err)}) — 빈 원서로 진행`);
      return empty;
    }
  }
}
