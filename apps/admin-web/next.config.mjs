import { PHASE_DEVELOPMENT_SERVER } from 'next/constants.js';

/**
 * 개발용 담당자 지정(담당자 ID 직접 입력)은 **개발 서버에서만** 켜진다. (T-M5-53)
 *
 * 입력한 이름이 그대로 승인·적용 기록에 남는다 — 증명된 신원이 아니다. 운영 빌드에 들어가면 이름만 바꿔
 * 다른 사람으로 승인하는 화면이 된다. 그래서 값은 빌드 때 코드에 박는다 — 개발 서버는 켜고
 * (`ADMIN_DEV_OPERATOR=0` 으로 끌 수 있다), 빌드·운영 실행은 끈다. 빌드에 켜라고 하면 빌드를 멈춘다.
 */
export default function config(phase) {
  const devServer = phase === PHASE_DEVELOPMENT_SERVER;
  const requested = process.env.ADMIN_DEV_OPERATOR;
  if (!devServer && requested === '1') {
    throw new Error(
      'ADMIN_DEV_OPERATOR=1 은 개발 서버(next dev)에서만 쓸 수 있습니다. 운영 빌드에 개발용 담당자 지정을 넣지 않습니다.',
    );
  }

  /** @type {import('next').NextConfig} */
  return {
    reactStrictMode: true,
    // KRDS 공용 패키지는 TSX 원본으로 배포된다. Next 가 직접 변환한다.
    transpilePackages: ['@wonseoro/krds'],
    // 콘솔 서버 코드는 이 값만 읽는다. 실행 때 환경변수로 켤 수 없다 — 빌드 때 박힌다.
    env: { WONSEORO_DEV_OPERATOR: devServer && requested !== '0' ? '1' : '0' },
    // 운영 콘솔이다. 검색엔진·다른 사이트의 iframe 에 들어갈 이유가 없다.
    async headers() {
      return [
        {
          source: '/:path*',
          headers: [
            { key: 'X-Frame-Options', value: 'DENY' },
            { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
            { key: 'Referrer-Policy', value: 'no-referrer' },
          ],
        },
      ];
    },
  };
}
