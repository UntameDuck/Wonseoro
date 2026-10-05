import argparse
import os
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "output" / "pdf" / "wonseoro-submission-errata.pdf"
FONT_ENV_REGULAR = "WONSEORO_PDF_FONT_REGULAR"
FONT_ENV_BOLD = "WONSEORO_PDF_FONT_BOLD"
FONT_CANDIDATES = (
    (Path("C:/Windows/Fonts/malgun.ttf"), Path("C:/Windows/Fonts/malgunbd.ttf")),
    (Path("/usr/share/fonts/truetype/nanum/NanumGothic.ttf"), Path("/usr/share/fonts/truetype/nanum/NanumGothicBold.ttf")),
    (Path("/usr/share/fonts/opentype/noto/NotoSansCJKkr-Regular.otf"), Path("/usr/share/fonts/opentype/noto/NotoSansCJKkr-Bold.otf")),
    (Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"), Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc")),
    (Path("/Library/Fonts/NanumGothic.ttf"), Path("/Library/Fonts/NanumGothicBold.ttf")),
    (Path("/System/Library/Fonts/AppleSDGothicNeo.ttc"), Path("/System/Library/Fonts/AppleSDGothicNeo.ttc")),
)


def find_fonts(environment=None, exists=None) -> tuple[Path, Path]:
    environment = os.environ if environment is None else environment
    exists = Path.is_file if exists is None else exists
    override_regular = environment.get(FONT_ENV_REGULAR)
    override_bold = environment.get(FONT_ENV_BOLD)

    if bool(override_regular) != bool(override_bold):
        raise ValueError(f"{FONT_ENV_REGULAR}와 {FONT_ENV_BOLD}는 함께 지정해야 합니다.")
    if override_regular and override_bold:
        pair = (Path(override_regular).expanduser(), Path(override_bold).expanduser())
        if all(exists(path) for path in pair):
            return pair
        raise FileNotFoundError(f"지정한 한글 글꼴을 찾지 못했습니다: {pair[0]}, {pair[1]}")

    for pair in FONT_CANDIDATES:
        if all(exists(path) for path in pair):
            return pair

    searched = ", ".join(str(path) for pair in FONT_CANDIDATES for path in pair)
    raise FileNotFoundError(
        "지원하는 한글 글꼴 쌍을 찾지 못했습니다. "
        f"{FONT_ENV_REGULAR}와 {FONT_ENV_BOLD}로 경로를 지정하세요. 검색 경로: {searched}"
    )


def register_fonts() -> tuple[Path, Path]:
    regular, bold = find_fonts()
    pdfmetrics.registerFont(TTFont("WonseoroSans", str(regular)))
    pdfmetrics.registerFont(TTFont("WonseoroSans-Bold", str(bold)))
    return regular, bold


def build() -> Path:
    register_fonts()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    page_width, _ = A4
    doc = SimpleDocTemplate(
        str(OUTPUT), pagesize=A4,
        leftMargin=18 * mm, rightMargin=18 * mm, topMargin=17 * mm, bottomMargin=16 * mm,
        title="원서로 개발보고서 정오표", author="원서로 팀",
    )
    styles = getSampleStyleSheet()
    title = ParagraphStyle(
        "TitleKo", parent=styles["Title"], fontName="WonseoroSans-Bold", fontSize=22,
        leading=29, textColor=colors.HexColor("#123B63"), alignment=TA_CENTER, spaceAfter=4 * mm,
    )
    subtitle = ParagraphStyle(
        "SubtitleKo", parent=styles["Normal"], fontName="WonseoroSans", fontSize=9.5,
        leading=15, textColor=colors.HexColor("#4B5563"), alignment=TA_CENTER, spaceAfter=7 * mm,
    )
    heading = ParagraphStyle(
        "HeadingKo", parent=styles["Heading2"], fontName="WonseoroSans-Bold", fontSize=13,
        leading=18, textColor=colors.HexColor("#123B63"), spaceBefore=2 * mm, spaceAfter=2.5 * mm,
    )
    body = ParagraphStyle(
        "BodyKo", parent=styles["BodyText"], fontName="WonseoroSans", fontSize=9.2,
        leading=15, textColor=colors.HexColor("#1F2937"), alignment=TA_LEFT,
    )
    small = ParagraphStyle(
        "SmallKo", parent=body, fontSize=8, leading=12, textColor=colors.HexColor("#4B5563"),
    )
    cell = ParagraphStyle("CellKo", parent=body, fontSize=8.2, leading=12.4)
    cell_bold = ParagraphStyle("CellBoldKo", parent=cell, fontName="WonseoroSans-Bold", textColor=colors.HexColor("#123B63"))
    cell_header = ParagraphStyle("CellHeaderKo", parent=cell, fontName="WonseoroSans-Bold", textColor=colors.white, alignment=TA_CENTER)

    story = [
        Paragraph("개발보고서 정오표", title),
        Paragraph("프로젝트: 원서로 / K-Admission &nbsp;&nbsp;|&nbsp;&nbsp; 정정일: 2026-10-04", subtitle),
        Table(
            [[Paragraph("정정 목적", cell_bold), Paragraph("제출된 개발보고서의 기술 스택과 지원자 흐름 표기를 현재 구현·승인 설계와 일치시킵니다.", cell)]],
            colWidths=[28 * mm, page_width - 36 * mm - 28 * mm],
            style=TableStyle([
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#EEF5FB")),
                ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#A8C4DE")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ]),
        ),
        Spacer(1, 6 * mm),
        Paragraph("정정 사항", heading),
    ]

    corrections = [
        ("1", "백엔드 기술 스택", "Java LTS + Spring Boot 계열", "NestJS + TypeScript (Node.js LTS), PostgreSQL", "ACID 트랜잭션, Transactional Outbox, 관측성, 장기지원 런타임 요건은 동일하게 충족합니다."),
        ("2", "지원자 접수 흐름", "5단계", "6단계: 공통정보 → 대학·전형 → 추가정보 → 서류 → 검토·결제 → 최종제출(→ 완료)", "현재 제품 화면과 승인 설계의 단계 구성을 반영합니다."),
        ("3", "결제 후 접수 설명", "결제 후 최종제출을 별도로 수행", "결제가 확인되면 서버가 즉시 접수 처리", "원문에 해당 서술이 있을 때만 적용합니다. 결제창은 접수 가능한 원서에만 열리고, 결제 뒤 수정·취소 불가를 결제 전에 알립니다."),
    ]
    table_data = [[
        Paragraph("번호", cell_header), Paragraph("항목", cell_header), Paragraph("기존 표기", cell_header),
        Paragraph("정정 표기", cell_header), Paragraph("설명", cell_header),
    ]]
    for number, item, old, new, note in corrections:
        table_data.append([
            Paragraph(number, cell), Paragraph(item, cell_bold), Paragraph(old, cell), Paragraph(new, cell), Paragraph(note, cell),
        ])
    table = Table(table_data, colWidths=[10 * mm, 27 * mm, 34 * mm, 52 * mm, 48 * mm], repeatRows=1)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#123B63")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("GRID", (0, 0), (-1, -1), 0.45, colors.HexColor("#B8C3CC")),
        ("BACKGROUND", (0, 1), (-1, -1), colors.white),
        ("BACKGROUND", (0, 2), (-1, 2), colors.HexColor("#F7FAFC")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ALIGN", (0, 0), (0, -1), "CENTER"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5), ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.extend([
        table,
        Spacer(1, 6 * mm),
        KeepTogether([
            Paragraph("정정 사유", heading),
            Paragraph("초기 문서의 기술 선택과 화면 단계 표기를 실제 구현 및 이후 확정된 설계에 맞춰 바로잡는 정정입니다. 서비스 범위나 주요 품질 요건을 축소하는 변경이 아닙니다.", body),
        ]),
        Spacer(1, 3 * mm),
        KeepTogether([
            Paragraph("근거 문서", heading),
            Paragraph("ADR-0001 백엔드 스택 결정 · 설계 불일치 대장 D-2, D-3, D-42 · 저장소 docs/07-submission-errata.md", small),
        ]),
        Spacer(1, 5 * mm),
        Table(
            [[Paragraph("제출·확인", cell_bold), Paragraph("제출처의 정정본 또는 정오표 접수 절차에 따라 반영한 뒤, 접수 일자와 확인 증적을 기록합니다.", cell)]],
            colWidths=[28 * mm, page_width - 36 * mm - 28 * mm],
            style=TableStyle([
                ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#A8C4DE")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ]),
        ),
        Spacer(1, 7 * mm),
        Paragraph("원서로 팀", ParagraphStyle("SignKo", parent=body, fontName="WonseoroSans-Bold", alignment=TA_CENTER, fontSize=10.5)),
    ])

    def footer(canvas, _doc):
        canvas.saveState()
        canvas.setFont("WonseoroSans", 7.5)
        canvas.setFillColor(colors.HexColor("#6B7280"))
        canvas.drawCentredString(page_width / 2, 8 * mm, "원서로 개발보고서 정오표 · 2026-10-04")
        canvas.restoreState()

    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return OUTPUT


def main() -> None:
    parser = argparse.ArgumentParser(description="제출용 개발보고서 정오표 PDF를 생성합니다.")
    parser.add_argument("--print-fonts", action="store_true", help="선택할 글꼴 경로만 출력합니다.")
    args = parser.parse_args()
    if args.print_fonts:
        regular, bold = find_fonts()
        print(f"regular={regular}")
        print(f"bold={bold}")
        return
    print(build())


if __name__ == "__main__":
    main()
