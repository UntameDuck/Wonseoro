import { PHASE_DEVELOPMENT_SERVER } from 'next/constants.js';

/**
 * 개발용 본인 확인(지원자 식별자·가명 토큰 직접 입력)은 **개발 서버에서만** 켜진다. (T-M5-53)
 *
 * 본인확인(T-M5-02)이 붙기 전까지 화면을 써 보려면 이 입력이 필요하다. 그러나 운영 빌드에 들어가면
 * 아무 식별자나 넣어 남의 원서를 여는 화면이 된다(서버도 운영에서는 개발 신원 헤더를 거절한다, R8).
 * 그래서 값은 빌드 때 코드에 박는다 — 개발 서버는 켜고(`NEXT_PUBLIC_DEV_IDENTITY=0` 으로 끌 수 있다),
 * 빌드·운영 실행은 끈다. 빌드에 켜라고 하면 조용히 무시하지 않고 빌드를 멈춘다.
 */
export default function config(phase) {
  const devServer = phase === PHASE_DEVELOPMENT_SERVER;
  const requested = process.env.NEXT_PUBLIC_DEV_IDENTITY;
  if (!devServer && requested === '1') {
    throw new Error(
      'NEXT_PUBLIC_DEV_IDENTITY=1 은 개발 서버(next dev)에서만 쓸 수 있습니다. 운영 빌드에 개발용 본인 확인을 넣지 않습니다.',
    );
  }

  /** @type {import('next').NextConfig} */
  return {
    reactStrictMode: true,
    // KRDS 공용 패키지는 TSX 원본으로 배포된다. Next 가 직접 변환한다.
    transpilePackages: ['@wonseoro/krds'],
    // 화면 코드는 이 값만 읽는다. 입력 변수(NEXT_PUBLIC_DEV_IDENTITY)를 직접 읽지 않아 .env 파일로 우회할 수 없다.
    env: { WONSEORO_DEV_IDENTITY: devServer && requested !== '0' ? '1' : '0' },
    // 대학별 Data Plane 은 별도 도메인이다. 개발에서는 CORS 로 붙는다.
    // 운영에서는 Edge 라우팅으로 같은 오리진처럼 보이게 한다. (v1.1 §10 §11)
  };
}
