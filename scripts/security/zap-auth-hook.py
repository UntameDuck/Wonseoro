# ZAP 시작 훅 — 경로에 맞는 토큰을 Authorization 에 붙인다 (T-M5-02 단계 9, T-M5-27)
#
# zap-api-scan.py --hook=<이 파일> 로 쓴다. 토큰은 환경변수 ZAP_APPLICANT_TOKEN·ZAP_STAFF_TOKEN 으로 받는다
# (scripts/security/dast-issuer.mjs 가 만든다). -z "-config replacer…" 로 넘기면 ZAP 이 값을 공백에서 잘라
# "Bearer" 만 남는다 — 그래서 API 로 규칙을 등록한다.
#   /api/v1/**   지원자 토큰
#   /admin/v1/** 담당자 토큰
import os


def zap_started(zap, target):
    rules = [
        ('applicant', '.*/api/v1/.*', os.environ['ZAP_APPLICANT_TOKEN']),
        ('staff', '.*/admin/v1/.*', os.environ['ZAP_STAFF_TOKEN']),
    ]
    for description, url, token in rules:
        zap.replacer.add_rule(
            description=description,
            enabled='true',
            matchtype='REQ_HEADER',
            matchregex='false',
            matchstring='Authorization',
            replacement='Bearer ' + token.strip(),
            initiators='',
            url=url,
        )
    print('DAST 인증 규칙: ' + ', '.join(r[0] for r in rules))
