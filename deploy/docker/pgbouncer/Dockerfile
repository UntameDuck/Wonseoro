# PgBouncer 1.26.0 — 2026-09-23 보안 릴리스(CVE-2026-19888/6668/6669 수정).
# 공식 배포 tarball을 공식 SHA-256으로 검증해 빌드한다.
ARG PGBOUNCER_VERSION=1.26.0
ARG PGBOUNCER_SHA256=afd25dd61ee6775d37b40629b87ce08736b3e6955f3057bb212e410fbf21c71d

FROM alpine:3.23 AS build
ARG PGBOUNCER_VERSION
ARG PGBOUNCER_SHA256
RUN apk add --no-cache build-base autoconf automake libtool pkgconf curl \
      libevent-dev openssl-dev c-ares-dev
WORKDIR /src
RUN curl -fsSLO "https://www.pgbouncer.org/downloads/files/${PGBOUNCER_VERSION}/pgbouncer-${PGBOUNCER_VERSION}.tar.gz" \
 && echo "${PGBOUNCER_SHA256}  pgbouncer-${PGBOUNCER_VERSION}.tar.gz" | sha256sum -c - \
 && tar -xzf "pgbouncer-${PGBOUNCER_VERSION}.tar.gz" \
 && cd "pgbouncer-${PGBOUNCER_VERSION}" \
 && ./configure --prefix=/usr \
 && make -j2 pgbouncer \
 && install -D -m 0755 pgbouncer /out/usr/bin/pgbouncer

FROM node:22-alpine AS runtime
RUN apk add --no-cache libevent openssl c-ares \
 && addgroup -S -g 10001 app \
 && adduser -S -D -H -u 10001 -G app app
COPY --from=build /out/usr/bin/pgbouncer /usr/bin/pgbouncer
COPY deploy/docker/pgbouncer/entrypoint.mjs /opt/k-admission/pgbouncer-entrypoint.mjs
USER 10001:10001
EXPOSE 6432
ENTRYPOINT ["node", "/opt/k-admission/pgbouncer-entrypoint.mjs"]
