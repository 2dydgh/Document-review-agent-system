"""서술문 추출이 목록 표의 제목 행이 아니라 정의 절의 서술 블록을 잡는지.

실측(PRJX-AN-002): ID 첫 등장은 목록 표 행이라 첫 줄만 잡으면 내용 대조가
"제목 vs 설계 서술"을 비교하게 된다 — 모순이 나올 수 없는 비교였다.
"""
from modules.agent_trace.idref import extract_id_statements
from modules.shared import Anchor, Document, Section

_PAT = r"RQ-[A-Z]{3}-\d{3}"


def _doc() -> Document:
    listing = Section(
        id="s1", level=1, title="요구사항 목록",
        text=("| RQ-SER-001 | 플랫폼 연계 |\n"
              "| RQ-SER-002 | 위험도 예측 |"),
        anchor=Anchor(page=1, section="2.1"))
    detail = Section(
        id="s2", level=1, title="외부 인터페이스 요구사항",
        text=("플랫폼 연계 인터페이스 [ID: RQ-SER-001]\n"
              "응답은 3초 이내여야 한다.\n"
              "전송 형식은 JSON 으로 한다.\n"
              "위험도 예측 [ID: RQ-SER-002]\n"
              "예측 결과는 백분율로 낸다."),
        anchor=Anchor(page=2, section="3.1"))
    return Document(source_path="t", doc_type=None, sections=[listing, detail])


def test_prefers_definition_block_over_listing_row():
    stmts = extract_id_statements(_doc(), _PAT)
    s = stmts["RQ-SER-001"]
    assert "3초 이내" in s.text and "JSON" in s.text
    # 다른 ID 의 서술은 딸려오지 않는다.
    assert "백분율" not in s.text and "RQ-SER-002" not in s.text


def test_listing_only_id_still_single_row():
    doc = Document(source_path="t", doc_type=None, sections=[Section(
        id="s1", level=1, title="목록",
        text="| RQ-SER-001 | 연계 |\n| RQ-SER-002 | 예측 |",
        anchor=Anchor(page=1, section="2.1"))])
    stmts = extract_id_statements(doc, _PAT)
    assert stmts["RQ-SER-001"].text == "| RQ-SER-001 | 연계 |"


def test_block_capped():
    long_tail = "\n".join("긴 서술 줄입니다." * 10 for _ in range(50))
    doc = Document(source_path="t", doc_type=None, sections=[Section(
        id="s1", level=1, title="정의", text=f"[ID: RQ-SER-001]\n{long_tail}",
        anchor=Anchor(page=1, section="1"))])
    s = extract_id_statements(doc, _PAT)["RQ-SER-001"]
    assert len(s.text) < 1200  # 상한 + 줄 경계 여유


def test_다음_요건의_머리줄은_ID_가_pattern_에_안_맞아도_블록을_끊는다() -> None:
    """"… [ID: RQ-ECR-PR-002]" 처럼 자릿수가 다른 다음 요건의 머리줄이 서술 끝에 붙었다
    (실측 2026-09-16). 머리줄의 "[ID:" 표식만으로도 끊는다."""
    from modules.agent_trace.idref import extract_id_statements
    from modules.shared import Anchor, Document, Section
    text = ("하드웨어 요구사항 [ID: RQ-ECR-PR-01-001]\n| 제목 | 알고리즘 하드웨어 사양 |\n"
            "| 설명 | 8Core 이상 |\n"
            "알고리즘 소프트웨어 프레임워크 [ID: RQ-ECR-PR-002]\n| 제목 | 프레임워크 |")
    doc = Document("a.hwp", "hwp", [Section("3", "요구사항", 1, text, Anchor(1, "3"))])
    st = extract_id_statements(doc, r"RQ-[A-Z]{3}-PR-\d{2}-\d{3}")
    assert "RQ-ECR-PR-01-001" in st
    assert "RQ-ECR-PR-002" not in st["RQ-ECR-PR-01-001"].text
    assert st["RQ-ECR-PR-01-001"].text.endswith("| 설명 | 8Core 이상 |")
