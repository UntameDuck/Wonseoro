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

{{- define "ka.extraEnv" -}}
{{- range $k, $v := . }}
- name: {{ $k }}
  value: {{ $v | toString | quote }}
{{- end }}
{{- end -}}
