from modules.agent_trace import (
    excluded_ids,
    extract_id_anchors,
    extract_id_statements,
)
from modules.shared import Anchor, Document, Section


def _sec(sid, title, text):
    return Section(id=sid, title=title, level=1, text=text,
                   anchor=Anchor(page=None, section=sid), children=[])


def _doc(sections):
    return Document(source_path="d.md", doc_type=None, sections=sections)


def test_extracts_ids_with_anchor():
    doc = _doc([_sec("1", "요구사항", "본 항목 SR-001 및 SR-002 를 정의한다.")])
    ids = extract_id_anchors(doc, r"SR-\d+")
    assert set(ids) == {"SR-001", "SR-002"}
    assert ids["SR-001"].section == "1"


def test_id_in_title_is_found():
    doc = _doc([_sec("2", "SR-003 로그인", "설명")])
    ids = extract_id_anchors(doc, r"SR-\d+")
    assert "SR-003" in ids


def test_first_occurrence_anchor_wins():
    doc = _doc([_sec("1", "a", "SR-001"), _sec("2", "b", "SR-001 다시")])
    ids = extract_id_anchors(doc, r"SR-\d+")
    assert ids["SR-001"].section == "1"


def test_empty_pattern_returns_empty():
    doc = _doc([_sec("1", "a", "SR-001")])
    assert extract_id_anchors(doc, "") == {}


# --- PDF 줄바꿈으로 쪼개진 ID ---------------------------------------------
# PDF 표 셀 안에서는 ID가 하이픈 뒤에서 줄바꿈된다. 실측(PLT34 RVVR):
# 'FR-\nESCM_08' 형태가 358회. 이걸 못 붙이면 하위문서에 **실재하는** ID를
# 못 찾아 상위문서의 그 요건이 '누락'으로 보고된다 — 오탐이다.

WRAP_PATTERN = r"FR-[A-Z]{2,4}_\d+"


def test_id_wrapped_across_lines_is_found():
    doc = _doc([_sec("1", "a", "Behaviors in the System Display (FR-\nESCM_08) In")])
    assert "FR-ESCM_08" in extract_id_anchors(doc, WRAP_PATTERN)


def test_statement_of_wrapped_id_is_found():
    doc = _doc([_sec("1", "a", "Trend Display (FR-\nMTP_18) In")])
    stmts = extract_id_statements(doc, WRAP_PATTERN)
    assert "FR-MTP_18" in stmts
    # 서술은 두 줄이 이어 붙은 한 줄이어야 한다 — 반쪽만 남으면 내용 대조가 무너진다.
    assert "Trend Display" in stmts["FR-MTP_18"].text


def test_hyphen_wrap_does_not_merge_unrelated_lines():
    """하이픈 없이 끝난 줄까지 붙이면 안 된다. 표의 다른 행이 한 줄이 된다."""
    doc = _doc([_sec("1", "a", "FR-AA_01 첫 행\nFR-BB_02 다음 행")])
    stmts = extract_id_statements(doc, WRAP_PATTERN)
    assert stmts["FR-AA_01"].text == "FR-AA_01 첫 행"


# --- "식별자 사례" 표의 예시 ID ---------------------------------------------
# 요구사항 명세서 앞머리에는 ID 형식을 설명하는 표가 있다
# ("| 식별자 사례 | SRS-RQ-001 |"). 정규식은 그것도 잡아 하위문서에 없다며
# MAJOR "누락"을 냈다(2026-09-14 QA 지적). 제외어는 기준이 정한다.
_EX = ("식별자 사례", "식별자 예시")


def test_example_row_is_skipped_and_counted():
    doc = _doc([_sec("1", "문서 개요", "| 식별자 사례 | SR-001 |\n본문 SR-002.")])
    ids = extract_id_anchors(doc, r"SR-\d+", _EX)
    assert set(ids) == {"SR-002"}
    assert excluded_ids(doc, r"SR-\d+", _EX) == {"SR-001"}


def test_same_id_in_normal_paragraph_still_extracted():
    doc = _doc([_sec("1", "개요", "| 식별자 사례 | SR-001 |"),
                _sec("2", "요구사항", "SR-001 은 로그인을 제공한다.")])
    ids = extract_id_anchors(doc, r"SR-\d+", _EX)
    assert "SR-001" in ids and ids["SR-001"].section == "2"
    # 본문에 실재하는 요건이므로 "안 셌다"고 보고하지 않는다.
    assert excluded_ids(doc, r"SR-\d+", _EX) == set()


def test_no_exclude_words_is_old_behaviour():
    doc = _doc([_sec("1", "개요", "| 식별자 사례 | SR-001 |\n본문 SR-002.")])
    assert set(extract_id_anchors(doc, r"SR-\d+")) == {"SR-001", "SR-002"}
    assert excluded_ids(doc, r"SR-\d+", ()) == set()


def test_statements_skip_example_row():
    doc = _doc([_sec("1", "개요", "| 식별자 사례 | SR-001 |"),
                _sec("2", "요구사항", "SR-002 는 조회를 제공한다.")])
    stmts = extract_id_statements(doc, r"SR-\d+", _EX)
    assert set(stmts) == {"SR-002"}
