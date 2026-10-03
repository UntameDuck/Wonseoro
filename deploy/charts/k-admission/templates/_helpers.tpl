{{/* 이름과 라벨 */}}
{{- define "ka.name" -}}k-admission{{- end -}}

{{- define "ka.fullname" -}}
{{- printf "%s" .Release.Name | trunc 50 | trimSuffix "-" -}}
{{- end -}}

{{- define "ka.labels" -}}
app.kubernetes.io/part-of: k-admission
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
kadmission.kr/university: {{ .Values.global.universityId | quote }}
{{- end -}}

{{/* 이미지: digest 가 있으면 digest 로 고정한다 (§A6). 없으면 태그 — production 은 validate 가 막는다 */}}
{{- define "ka.image" -}}
{{- $root := index . 0 -}}{{- $img := index . 1 -}}
{{- $reg := $root.Values.global.imageRegistry | trimSuffix "/" -}}
{{- if and $img.digest (not (hasPrefix "sha256:REPLACE" $img.digest)) -}}
{{ printf "%s/%s@%s" $reg $img.repository $img.digest }}
{{- else -}}
{{ printf "%s/%s:%s" $reg $img.repository (default $root.Chart.AppVersion $root.Values.global.imageTag) }}
{{- end -}}
{{- end -}}

{{- define "ka.nodeEnv" -}}
{{- if eq .Values.global.environment "production" -}}production{{- else -}}development{{- end -}}
{{- end -}}

{{- define "ka.runtimeSecret" -}}
{{- default (printf "%s-runtime" (include "ka.fullname" .)) .Values.runtimeSecret.name -}}
{{- end -}}

{{/* 중앙 Sync Gateway 주소 — 앱은 기준 URL 을 받는다 (경로는 앱이 붙인다) */}}
{{- define "ka.centralBase" -}}
{{- .Values.centralSync.endpoint | trimSuffix "/" | trimSuffix "/internal/v1/events" -}}
{{- end -}}

{{/* §05 첨부 runtime.yaml 의 Pod 보안 기준 */}}
{{- define "ka.podSecurity" -}}
{{- $sc := .Values.securityContext -}}
automountServiceAccountToken: {{ $sc.automountServiceAccountToken }}
securityContext:
  runAsNonRoot: {{ $sc.runAsNonRoot }}
  runAsUser: {{ $sc.runAsUser }}
  runAsGroup: {{ $sc.runAsGroup }}
  fsGroup: {{ $sc.runAsGroup }}
  seccompProfile:
    type: {{ $sc.seccompProfile }}
{{- end -}}

{{- define "ka.containerSecurity" -}}
{{- $sc := .Values.securityContext -}}
securityContext:
  runAsNonRoot: {{ $sc.runAsNonRoot }}
  runAsUser: {{ $sc.runAsUser }}
  runAsGroup: {{ $sc.runAsGroup }}
  readOnlyRootFilesystem: {{ $sc.readOnlyRootFilesystem }}
  allowPrivilegeEscalation: {{ $sc.allowPrivilegeEscalation }}
  {{- if $sc.dropAllCapabilities }}
  capabilities:
    drop: ["ALL"]
  {{- end }}
{{- end -}}

{{- define "ka.spread" -}}
{{- $root := index . 0 -}}{{- $app := index . 1 -}}
topologySpreadConstraints:
  - maxSkew: {{ $root.Values.nodePlacement.spreadMaxSkew }}
    topologyKey: {{ $root.Values.nodePlacement.topologyKey }}
    whenUnsatisfiable: {{ $root.Values.nodePlacement.whenUnsatisfiable }}
    {{- with $root.Values.nodePlacement.nodeTaintsPolicy }}
    nodeTaintsPolicy: {{ . }}
    {{- end }}
    {{- with $root.Values.nodePlacement.matchLabelKeys }}
    matchLabelKeys: {{ toJson . }}
    {{- end }}
    labelSelector:
      matchLabels:
        app: {{ $app }}
        app.kubernetes.io/instance: {{ $root.Release.Name }}
{{- end -}}

{{/* 쓰기는 /tmp 만 — 읽기 전용 루트 FS */}}
{{- define "ka.tmpVolume" -}}
volumes:
  - name: tmp
    emptyDir:
      sizeLimit: 1Gi
{{- end -}}

{{- define "ka.tmpMount" -}}
volumeMounts:
  - name: tmp
    mountPath: /tmp
{{- end -}}

{{/* 모든 서비스 공통 환경변수 */}}
{{- define "ka.commonEnv" -}}
- name: NODE_ENV
  value: {{ include "ka.nodeEnv" . | quote }}
- name: UNIVERSITY_ID
  value: {{ .Values.global.universityId | quote }}
- name: CENTRAL_SYNC_URL
  value: {{ include "ka.centralBase" . | quote }}
{{- end -}}

{{- /* 관측성 (T-M4-20) — 모든 서비스 공통. 지표는 Prometheus pull, Trace 는 수집기가 있을 때만 */ -}}
{{- define "ka.telemetryEnv" -}}
{{- $o := .Values.observability -}}
- name: OTEL_ENABLED
  value: {{ or $o.metrics.enabled (ne $o.otelEndpoint "") | quote }}
- name: OTEL_METRICS_PORT
  value: {{ $o.metrics.port | quote }}
{{- with $o.otelEndpoint }}
- name: OTEL_EXPORTER_OTLP_ENDPOINT
  value: {{ . | quote }}
{{- end }}
- name: LOG_FORMAT
  value: json
{{- end -}}

{{- define "ka.metricsAnnotations" -}}
{{- if .Values.observability.metrics.enabled }}
annotations:
  prometheus.io/scrape: "true"
  prometheus.io/path: /metrics
  prometheus.io/port: {{ .Values.observability.metrics.port | quote }}
{{- end }}
{{- end -}}

{{- define "ka.metricsPort" -}}
{{- if .Values.observability.metrics.enabled }}
- name: metrics
  containerPort: {{ .Values.observability.metrics.port }}
{{- end }}
{{- end -}}

{{- define "ka.extraEnv" -}}
{{- range $k, $v := . }}
- name: {{ $k }}
  value: {{ $v | toString | quote }}
{{- end }}
{{- end -}}

{{- /*
  서비스 간 상호 TLS (T-M5-05, D-69) — 워크로드마다 인증서 Secret(tls.crt·tls.key·ca.crt)을 붙인다.
  인증서의 SAN URI 가 워크로드 신원이다: spiffe://wonseoro/university/<대학ID>/<admission-api|event-relay|document-service>.
  Secret 은 짧은 TTL 로 바뀐다(Vault PKI, docs/13 단계 4) — 앱이 파일 변경을 보고 다시 읽는다. 운영은 끌 수 없다(validate.yaml)
  사용: include "ka.mtlsEnv" (list . "api")
*/ -}}
{{- define "ka.mtlsSecret" -}}
{{- $root := index . 0 -}}{{- $key := index . 1 -}}
{{- $given := index $root.Values.internalTls.secrets $key -}}
{{- $given | default (printf "%s-%s-mtls" (include "ka.fullname" $root) $key) -}}
{{- end -}}

{{- define "ka.mtlsEnv" -}}
{{- $root := index . 0 -}}{{- $t := $root.Values.internalTls -}}
{{- if $t.enabled }}
- name: INTERNAL_AUTH
  value: mtls
- name: MTLS_CERT_FILE
  value: {{ printf "%s/tls.crt" $t.mountPath | quote }}
- name: MTLS_KEY_FILE
  value: {{ printf "%s/tls.key" $t.mountPath | quote }}
- name: MTLS_CA_FILE
  value: {{ printf "%s/ca.crt" $t.mountPath | quote }}
{{- else }}
- name: INTERNAL_AUTH
  value: none
{{- end }}
{{- include "ka.vaultEnv" . }}
{{- end -}}

{{- /*
  Vault (T-M5-04, docs/13 단계 4) — 켜면 워크로드가 기동 때 Vault 에서 받는다:
  Kubernetes 인증(ServiceAccount 토큰, audience vault) · PKI 워크로드 인증서(SAN URI, 수명 2/3 마다 다시) ·
  DB 동적 계정(API·Relay) · Transit KEK(API). 경로 이름은 노션 첨부 vault-policy.hcl 과 같다.
*/ -}}
{{- define "ka.workloadName" -}}
{{- $key := . -}}{{- ternary "admission-api" $key (eq $key "api") -}}
{{- end -}}

{{- define "ka.vaultEnv" -}}
{{- $root := index . 0 -}}{{- $key := index . 1 -}}{{- $vault := $root.Values.vault -}}
{{- if $vault.enabled }}
{{- $u := $root.Values.global.universityId -}}{{- $w := include "ka.workloadName" $key }}
- name: VAULT_ADDR
  value: {{ $vault.addr | quote }}
- name: VAULT_K8S_ROLE
  value: {{ printf "%s-%s" ($u | lower) $w | quote }}
- name: VAULT_K8S_JWT_FILE
  value: /var/run/secrets/vault/token
{{- if $root.Values.internalTls.enabled }}
- name: MTLS_ISSUER
  value: vault
- name: VAULT_PKI_ROLE
  value: {{ printf "kadmission-%s-%s" ($u | lower) $w | quote }}
- name: WORKLOAD_URI
  value: {{ printf "spiffe://wonseoro/university/%s/%s" $u $w | quote }}
- name: VAULT_PKI_ALT_NAMES
  value: {{ printf "%s-%s,%s-%s.%s.svc" (include "ka.fullname" $root) $key (include "ka.fullname" $root) $key $root.Release.Namespace | quote }}
{{- end }}
{{- if or (eq $key "api") (eq $key "event-relay") }}
- name: DATABASE_CREDENTIALS
  value: vault
- name: VAULT_DB_ROLE
  value: {{ printf "admission-api-%s" $u | quote }}
{{- end }}
{{- if eq $key "api" }}
- name: FIELD_KEK_PROVIDER
  value: vault
- name: VAULT_TRANSIT_KEY
  value: {{ printf "pii-%s" $u | quote }}
{{- end }}
{{- end }}
{{- end -}}

{{- /* 쓰기 영역(/tmp)과 인증서 — 읽기 전용 루트 FS */ -}}
{{- define "ka.workloadMounts" -}}
{{- $root := index . 0 -}}{{- $t := $root.Values.internalTls -}}
volumeMounts:
  - name: tmp
    mountPath: /tmp
  {{- if $t.enabled }}
  - name: mtls
    mountPath: {{ $t.mountPath }}
    {{- /* Vault 가 발급하면 워크로드가 인증서를 직접 써 넣는다 */}}
    readOnly: {{ not $root.Values.vault.enabled }}
  {{- end }}
  {{- if $root.Values.vault.enabled }}
  - name: vault-token
    mountPath: /var/run/secrets/vault
    readOnly: true
  {{- end }}
{{- end -}}

{{- define "ka.workloadVolumes" -}}
{{- $root := index . 0 -}}{{- $t := $root.Values.internalTls -}}
volumes:
  - name: tmp
    emptyDir:
      sizeLimit: 1Gi
  {{- if and $t.enabled $root.Values.vault.enabled }}
  - name: mtls
    emptyDir:
      medium: Memory
      sizeLimit: 1Mi
  {{- else if $t.enabled }}
  - name: mtls
    secret:
      secretName: {{ include "ka.mtlsSecret" . }}
      defaultMode: 0440
  {{- end }}
  {{- if $root.Values.vault.enabled }}
  - name: vault-token
    projected:
      sources:
        - serviceAccountToken:
            path: token
            audience: vault
            expirationSeconds: 600
  {{- end }}
{{- end -}}
