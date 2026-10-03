# 로컬 축소 환경 — kind 2 클러스터 (M4)

대학마다 독립 클러스터(univ-a, univ-b)를 띄워 **대학 간 장애 격리**(T-M4-42)를 확인한다.
수치 시험(3,000 CCU·1,000 RPS·6시간 Soak·DB Failover 실측)은 여기서 하지 않는다 — K-PaaS 환경 몫이다.

```
호스트(Docker Desktop)
├── postgres-univ-a :5432   ← univ-a 클러스터만 쓴다
├── postgres-univ-b :5442   ← univ-b 클러스터만 쓴다
├── postgres-central :5434 · central-api :3000 (컨테이너 ka-central)
├── minio :9000
├── kind: univ-a  → 접수 API NodePort → localhost:18081
└── kind: univ-b  → 접수 API NodePort → localhost:18082
```

## 올리기

도구: kind · helm · kubectl (Windows 는 winget 설치 후 새 터미널). 메모리 여유가 적으면 이미지 빌드와
클러스터를 **동시에 돌리지 않는다** — Docker Desktop(8GB)이 응답을 멈춘 적이 있다.

```bash
npm run dev:infra
docker compose -f infra/compose/docker-compose.dev.yml --profile multi up -d postgres-univ-b
# univ_b 스키마·역할·시드 (UNIV-B 로 바꿔서)
for f in infra/db/migrations/0001_init.sql infra/db/migrations/0002_db_roles.sql infra/db/migrations/0003_field_encryption.sql infra/db/migrations/0004_break_glass.sql infra/db/migrations/0005_outbox_archive.sql infra/db/migrations/0006_writer_fence.sql infra/db/dev-roles.sql; do docker exec -i wonseoro-dev-postgres-univ-b-1 psql -U wonseoro -d univ_b -v ON_ERROR_STOP=1 < $f; done
sed "s/UNIV-A/UNIV-B/g; s/원서로대학교/B대학교/g" infra/db/seed-dev.sql | docker exec -i wonseoro-dev-postgres-univ-b-1 psql -U wonseoro -d univ_b
# 중앙에 UNIV-B 등록
docker exec wonseoro-dev-postgres-central-1 psql -U wonseoro -d central -c "SET search_path TO kadmission_central; INSERT INTO university_registry (id,name,status) VALUES ('UNIV-B','B대학교','ACTIVE') ON CONFLICT DO NOTHING"

# 이미지 (같은 이미지를 두 대학이 쓴다)
for a in admission-api event-relay document-service central-api; do docker build -f deploy/docker/Dockerfile --build-arg APP=$a -t k-admission/$a:dev .; done
docker build -f deploy/docker/pgbouncer/Dockerfile -t k-admission/pgbouncer:dev .

# 중앙 API — 클러스터 밖
docker run -d --name ka-central --read-only --tmpfs /tmp --cap-drop ALL -p 3000:3000 \
  -e NODE_ENV=development -e DATABASE_URL=postgresql://wonseoro:wonseoro@host.docker.internal:5434/central \
  -e SUBJECT_REF_KEYS=k1=dev-dashboard-subject-key k-admission/central-api:dev

# 대학 클러스터
for u in a b; do
  kind create cluster --config deploy/local/kind-univ-$u.yaml
  kind load docker-image k-admission/admission-api:dev k-admission/event-relay:dev k-admission/document-service:dev k-admission/pgbouncer:dev --name univ-$u
  helm upgrade --install univ-$u deploy/charts/k-admission --kube-context kind-univ-$u -n kadmission-app --create-namespace \
    -f deploy/charts/k-admission/values-s.yaml -f deploy/local/values-local.yaml -f deploy/local/values-univ-$u.yaml
done
```

## 격리 시험

```bash
node tests/m4/isolation.mjs
node tests/m4/pgbouncer.mjs
```

A 클러스터 노드를 멈춘 동안 B 의 생성→저장→결제→자동 접수와 중앙 "내 원서" 반영을 확인하고, A 를 되살린다.
결과는 `tests/m4/results/` 에 남는다.

## 장애 시험 (실제 시간·다중 노드)

| 시험 | 명령 | 주의 |
|---|---|---|
| 중앙 2시간 단절 (T-M4-35) | `node tests/m4/central-outage-realtime.mjs` (`--minutes=2 --every=30` 로 사전 점검) | 도는 동안 univ-a 재배포·DB 시험 금지 |
| PG 확정 1~30분 지연 (T-M4-34) | `kubectl --context kind-univ-a -n kadmission-app set env deploy/univ-a-api MOCK_PG_CONFIRM_DELAYS_S=60,300,900,1800` → `node tests/m4/pg-delay-realtime.mjs` → `… MOCK_PG_CONFIRM_DELAYS_S-` | 약 35분. 이미지에 Mock PG 지연 모드가 있어야 한다 |
| 노드 장애 (T-M4-39) | `kind create cluster --config kind-univ-a-multinode.yaml` (또는 판정 시간을 줄인 `kind-univ-a-multinode-tuned.yaml`) → 배포 → `node tests/m4/node-failure-kind.mjs` → `kind delete cluster --name univ-m` | 메모리 때문에 univ-a·univ-b 노드를 멈춘다. 절차는 HANDOFF §4 |

## 로컬 값이 운영과 다른 점

`values-local.yaml` — 개발 비밀을 차트가 Secret 으로 만든다(운영은 거부), Mock PG·Mock 검사 엔진·헤더 인증,
HPA 끔(metrics-server 없음), NetworkPolicy 출구는 호스트 IP 하나(192.168.65.254)의 필요한 포트만.
