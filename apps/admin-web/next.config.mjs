/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  // KRDS 공용 패키지는 TSX 원본으로 배포된다. Next 가 직접 변환한다.
  transpilePackages: ['@wonseoro/krds'],
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
