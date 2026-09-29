# 관측성 플랫폼

## T-M4-08 — RPS 커스텀 지표

접수 API는 Pod의 `:9464/metrics`에서 요청 수·지연 히스토그램·처리 중 요청 수를 노출한다.
Prometheus Adapter는 이를 Kubernetes Custom Metrics API의 다음 Pod 지표로 제공한다.

- `http_requests_per_second`: 2분 요청 rate
- `http_request_duration_p95_seconds`: 2분 창 p95 지연
- `http_active_requests`: 현재 처리 중 요청 수

HPA의 이름·단위와 Adapter 규칙이 일치해야 한다.

로컬 축소 환경 설치 버전은 Prometheus chart `29.35.0`(Prometheus `v3.15.0`),
Prometheus Adapter chart `5.3.0`(adapter `v0.12.0`)으로 고정한다.

```powershell
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update
kubectl --context kind-univ-a create namespace observability
kubectl --context kind-univ-a label namespace observability kadmission-zone=observability
helm upgrade --install prometheus prometheus-community/prometheus --version 29.35.0 `
  --kube-context kind-univ-a --namespace observability `
  -f deploy/platform/observability/prometheus-values.yaml --wait
helm upgrade --install prometheus-adapter prometheus-community/prometheus-adapter --version 5.3.0 `
  --kube-context kind-univ-a --namespace observability `
  -f deploy/platform/observability/prometheus-adapter-values.yaml --wait
```

검증:

```powershell
kubectl --context kind-univ-a get --raw /apis/custom.metrics.k8s.io/v1beta1
kubectl --context kind-univ-a get --raw `
  "/apis/custom.metrics.k8s.io/v1beta1/namespaces/kadmission-app/pods/*/http_requests_per_second"
kubectl --context kind-univ-a get --raw `
  "/apis/custom.metrics.k8s.io/v1beta1/namespaces/kadmission-app/pods/*/http_request_duration_p95_seconds"
kubectl --context kind-univ-a get --raw `
  "/apis/custom.metrics.k8s.io/v1beta1/namespaces/kadmission-app/pods/*/http_active_requests"
```

로컬 값은 보존 1시간·단일 replica·`emptyDir`다. 운영 HA/장기 보존 설정이 아니다.
로컬 kind에는 metrics-server가 없으므로 CPU 지표는 별도 설치 전까지 `<unknown>`이다. HPA 연동 시험에서는
DB 연결 예산 30을 넘지 않도록 `api.autoscaling.maxReplicas=4`로만 낮추고, 시험 뒤 HPA를 다시 끈다.
