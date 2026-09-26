"""불일치 대장에서 "노션 반영 ⬜" 항목을 뽑아 노션 문서별로 묶는다.

저장소 루트에서 실행: python scripts/notion-changeset.py
05-m3-exit-m4-readiness.md 부록이 이 출력이다. 대장이 원본이다.
"""
import re
import sys

reg = open(r'E:\Competition\govtech\dev-folder\docs\02-spec-discrepancy-register.md', encoding='utf-8').read()
reg = reg.replace('\r\n', '\n')
reg = reg.split('<!--')[0]

items = []
for block in re.split(r'\n(?=## D-\d+\. )', reg):
    m = re.match(r'## (D-\d+)\. (.+)', block)
    if not m:
        continue
    did, title = m.group(1), m.group(2).strip()
    status = re.search(r'\| \*\*상태\*\* \| (.+?) \|', block)
    status = status.group(1).strip() if status else ''
    if 'CLOSED' in status:
        continue
    todo = re.findall(r'\| \*\*노션 반영\*\* \| ⬜ (.+?) \|\n', block)
    pdf = re.findall(r'\| \*\*PDF 반영\*\* \| ⬜ (.+?) \|\n', block)
    items.append((did, title, status, todo, pdf))

PAGES = [
    ('§01 운영 리스크', r'§01|§A\d|§B\d|§C\d|§E\b|C8|A1\b|A12|A14|A15|B17'),
    ('§02 ERD·DDL', r'§02|DDL|ERD'),
    ('§03 OpenAPI', r'§03|OpenAPI|계약|조회 경로'),
    ('§06 보안정책', r'§06'),
    ('§04 CloudEvents', r'§04'),
    ('§07 KRDS', r'§07'),
    # 절 번호만 적힌 것(§9, §5.6, §6.2)은 v1.0 본문이다. §01·§02 처럼 0 으로 시작하면 v1.1 문서다.
    ('v1.0 본문', r'v1\.0|§[1-9]\d?(?:\.\d+)?(?!\d)'),
]


def page_of(text: str) -> list[str]:
    hits = [name for name, pat in PAGES if re.search(pat, text)]
    return hits or ['기타']


grouped: dict[str, list[str]] = {}
confirm = []
for did, title, status, todo, pdf in items:
    for t in todo:
        # 한 줄에 여러 문서가 · 로 섞여 있다. 조각마다 문서를 판정한다.
        for part in [p.strip() for p in re.split(r' · ', t) if p.strip()]:
            if '결정' in part or '확인' in part:
                grouped.setdefault('먼저 결정·확인이 필요한 것', []).append(f'- **{did}** {part}  \n  <sub>{title}</sub>')
                continue
            for pg in page_of(part):
                grouped.setdefault(pg, []).append(f'- **{did}** {part}  \n  <sub>{title}</sub>')
    for p in pdf:
        grouped.setdefault('제출 PDF 정정', []).append(f'- **{did}** {p}')
    # 상태에 "확인" 이 적힌 항목은 반영보다 결정이 먼저다. (D-29 제약 약화, D-38 하한값 등)
    if '확인' in status and not any(did in x for x in grouped.get('먼저 결정·확인이 필요한 것', [])):
        grouped.setdefault('먼저 결정·확인이 필요한 것', []).append(f'- **{did}** {status}  \n  <sub>{title}</sub>')

order = ['먼저 결정·확인이 필요한 것'] + [p for p, _ in PAGES] + ['제출 PDF 정정', '기타']
out = []
total = sum(len(v) for v in grouped.values())
out.append(f'<!-- 자동 생성: 불일치 대장의 "노션 반영 ⬜" 항목 {len(items)}건에서 {total}개 수정 지점 -->')
for pg in order:
    if pg not in grouped:
        continue
    out.append(f'\n### {pg} — {len(grouped[pg])}건\n')
    out.extend(grouped[pg])
sys.stdout.reconfigure(encoding='utf-8')
print('\n'.join(out))
print(f'\n<!-- items={len(items)} edits={total} -->')
