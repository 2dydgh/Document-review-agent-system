"""PDF의 실제 위치는 지적 순서나 HWPX 근사 페이지로 확정할 수 없다."""
from pathlib import Path

import pytest
from fpdf import FPDF

from modules.report import annotate, locate, with_location_context


def pdf_bytes():
    pdf = FPDF(unit="pt", format="A4")
    for lines in [("Glossary", "Not applicable", "End glossary"),
                  ("Database design", "Not applicable", "User interface")]:
        pdf.add_page()
        pdf.set_font("Helvetica", size=12)
        for i, text in enumerate(lines):
            pdf.text(60, 80 + i * 25, text)
    return bytes(pdf.output())


def finding():
    return {"id": "f1", "message": "Check design", "section": "2.2.1", "page": 1,
            "evidence": [{"quote": "Not applicable", "section": "2.2.1", "page": 1}]}


def test_repeated_quote_is_not_assigned_by_finding_order_or_approximate_page():
    items = [finding(), {**finding(), "id": "f2", "section": "3"}]
    result = locate(pdf_bytes(), items)
    assert all(not item["marks"] for item in result["items"])
    assert len(result["unlocated"]) == 2
    assert all("여러 위치" in item["reason"] for item in result["unlocated"])


def test_source_context_selects_correct_page_without_changing_quote():
    source = finding()
    enriched = with_location_context([source], [{"id": "2.2.1", "title": "Design",
        "text": "| Database design |\n| Not applicable |\n| User interface |"}], "approximate")
    assert "context" not in source["evidence"][0]
    assert enriched[0]["evidence"][0]["quote"] == source["evidence"][0]["quote"]
    result = locate(pdf_bytes(), enriched)
    assert result["items"][0]["page"] == 2
    assert not result["unlocated"]
    marked = annotate(pdf_bytes(), enriched)
    assert marked.marked == 1 and not marked.unmarked


def test_mismatched_context_does_not_fall_back_to_first_occurrence():
    item = finding()
    item["evidence"][0]["context"] = {"before": "Not in document"}
    out = locate(pdf_bytes(), [item])
    assert not out["items"][0]["marks"]
    assert "소속 문맥" in out["unlocated"][0]["reason"]


def test_unique_full_quote_survives_context_across_page_boundary():
    item = finding()
    item["evidence"][0].update(quote="Database design", context={
        "before": "End glossary", "after": "Different table reading order"})
    result = locate(pdf_bytes(), [item])
    assert result["items"][0]["page"] == 2
    assert not result["unlocated"]


def test_repeated_quote_within_source_section_is_not_given_invented_context():
    out = with_location_context([finding()], [{"id": "2.2.1",
        "text": "Not applicable\nNot applicable"}])
    assert "context" not in out[0]["evidence"][0]


def test_exact_pdf_page_is_distinct_from_approximate_page():
    item = finding()
    item["evidence"][0].update(page=2, page_basis="pdf", page_exact=True)
    assert locate(pdf_bytes(), [item])["items"][0]["page"] == 2
    item["evidence"][0]["page_basis"] = "approximate"
    assert not locate(pdf_bytes(), [item])["items"][0]["marks"]


def test_pdf_section_start_is_not_treated_as_exact_evidence_page():
    item = finding()
    item["evidence"][0].update(page=1, page_basis="pdf")
    assert not locate(pdf_bytes(), [item])["items"][0]["marks"]


def test_reference_hwpx_design_quote_points_to_page_nine_not_glossary():
    from app.parser_bridge import TrkimLoader
    from modules.doc_parser import normalize

    root = Path(__file__).resolve().parents[1] / "data"
    source = next(root.rglob("PRJX-DS-005*v1.0.hwpx"), None)
    reference = next(root.rglob("PRJX-DS-005*v1.0.pdf"), None)
    if source is None or reference is None:
        pytest.skip("로컬 HWPX·작성자 출력 PDF 쌍 없음")
    doc = normalize(TrkimLoader(ocr=False).load(source))
    assert doc.meta["page_basis"] == "approximate"
    sections = [{"id": s.id, "text": s.text, "title": s.title} for s in doc.iter_sections()]
    item = finding()
    item["evidence"][0]["quote"] = "| 해당 사항 없음 |"
    enriched = with_location_context([item], sections, doc.meta["page_basis"])
    assert enriched[0]["evidence"][0].get("context")
    result = locate(reference.read_bytes(), enriched)
    assert result["pages"] == 35
    assert result["items"][0]["page"] == 9
    assert not result["unlocated"]


def test_hancom_bullet_quote_locates_and_highlights_original_glyphs():
    root = Path(__file__).resolve().parents[1] / "data"
    reference = next(root.rglob("PRJX-DS-005*v1.0.pdf"), None)
    if reference is None:
        pytest.skip("Local Hancom reference PDF is not installed")
    item = {"id": "bullet", "message": "Check list", "sev": "minor", "evidence": [
        {"quote": "• 입력 데이터 파싱\n• 데이터 조회 및 추출\n• 데이터 전처리"}]}
    result = locate(reference.read_bytes(), [item])
    assert result["items"][0]["page"] == 11
    assert result["items"][0]["marks"]
    assert not result["unlocated"]
    marked = annotate(reference.read_bytes(), [item])
    assert marked.marked == 1 and not marked.unmarked
