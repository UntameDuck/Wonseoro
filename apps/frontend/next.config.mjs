/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  // 대학별 Data Plane 은 별도 도메인이다. 개발에서는 CORS 로 붙는다.
  // 운영에서는 Edge 라우팅으로 같은 오리진처럼 보이게 한다. (v1.1 §10 §11)
};
