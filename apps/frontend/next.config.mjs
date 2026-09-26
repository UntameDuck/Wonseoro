/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  // KRDS 공용 패키지는 TSX 원본으로 배포된다. Next 가 직접 변환한다.
  transpilePackages: ['@wonseoro/krds'],
  // 대학별 Data Plane 은 별도 도메인이다. 개발에서는 CORS 로 붙는다.
  // 운영에서는 Edge 라우팅으로 같은 오리진처럼 보이게 한다. (v1.1 §10 §11)
};
