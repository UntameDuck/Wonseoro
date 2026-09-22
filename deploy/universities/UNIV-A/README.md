# UNIV-A — 대학별 배포 값

대학 추가 시 이 디렉터리를 복제한다. **코드는 건드리지 않는다.**
대학 차이는 Configuration + JSON Schema + Feature Flag로만 흡수한다. (v1.1 §A5)

- `values.yaml` — Size Profile, replica, 리소스, 도메인, Object Storage
- `config-ref.yaml` — 전형 Schema·마감·전형료 Config 버전 참조
- `policy-ref.yaml` — 보안정책·NetworkPolicy 버전 참조

버전은 `platformVersion` / `schemaVersion` / `configVersion`으로 분리해 관리한다.
