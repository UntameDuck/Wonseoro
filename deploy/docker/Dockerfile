# 대학 Data Plane · 중앙 서비스 공통 이미지 (T-M4-01·02)
#
#   docker build -f deploy/docker/Dockerfile --build-arg APP=admission-api -t k-admission/admission-api:dev .
#
# APP: admission-api | event-relay | document-service | central-api
#
# 대학마다 이미지를 따로 만들지 않는다 — 같은 이미지를 대학별 values 로 띄운다 (code fork 0, §A5).
# 런타임 기준은 §05 첨부 runtime.yaml: 루트 아님(UID 10001) · 읽기 전용 루트 FS · 쓰기는 /tmp 만.

ARG NODE_VERSION=22

# ── build ─────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS build
ARG APP
WORKDIR /repo

# 의존성 층을 소스와 나눠 캐시를 살린다.
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/server-kit/package.json packages/server-kit/
COPY packages/krds/package.json packages/krds/
COPY apps/admission-api/package.json apps/admission-api/
COPY apps/event-relay/package.json apps/event-relay/
COPY apps/document-service/package.json apps/document-service/
COPY apps/central-api/package.json apps/central-api/
COPY apps/frontend/package.json apps/frontend/
COPY apps/admin-web/package.json apps/admin-web/
RUN npm ci --ignore-scripts --no-audit --no-fund

COPY packages/contracts packages/contracts
COPY packages/server-kit packages/server-kit
COPY apps/${APP} apps/${APP}
RUN npm run build -w @wonseoro/contracts \
 && npm run build -w @wonseoro/server-kit \
 && npm run build -w @wonseoro/${APP}

# 운영 의존성만. 워크스페이스 패키지는 심볼릭 링크로 걸린다.
RUN rm -rf node_modules \
 && npm ci --omit=dev --ignore-scripts --no-audit --no-fund -w @wonseoro/${APP} --include-workspace-root=false

# ── runtime ───────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS runtime
ARG APP
ENV NODE_ENV=production \
    NODE_OPTIONS=--enable-source-maps
WORKDIR /app

COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/package.json ./package.json
COPY --from=build /repo/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build /repo/packages/contracts/dist ./packages/contracts/dist
COPY --from=build /repo/packages/server-kit/package.json ./packages/server-kit/package.json
COPY --from=build /repo/packages/server-kit/dist ./packages/server-kit/dist
COPY --from=build /repo/apps/${APP}/package.json ./apps/${APP}/package.json
COPY --from=build /repo/apps/${APP}/dist ./apps/${APP}/dist

# 시험 파일은 이미지에 싣지 않는다.
RUN find /app/apps /app/packages -name '*.test.js*' -delete \
 && addgroup -S -g 10001 app && adduser -S -D -H -u 10001 -G app app
USER 10001:10001

WORKDIR /app/apps/${APP}
EXPOSE 3000 3001 3002 3003 9464
CMD ["node", "dist/main.js"]
