"""Native PDF text must survive layout recovery without inventing source content."""
from pathlib import Path

import fitz
import pytest

from modules.doc_parser.model import FIGURE, HEADING, PARAGRAPH, TABLE, Block, TableData
from modules.doc_parser.pdf_backend import (
    _page_words,
    _pymupdf_cell_text,
    _repair_wrapped_words_in_paragraphs,
    _restore_uncovered_native_lines,
)
from modules.shared import decode_pdf_symbols


def test_symbol_decoding_requires_exact_font_evidence():
    assert decode_pdf_symbols("l", "ABCDEF+Wingdings-Regular") == "•"
    for font in ("Helvetica", "Wingdings2", "Wingdings3", "", "OtherWingdings"):
        assert decode_pdf_symbols("local", font) == "local"


@pytest.mark.parametrize("rule_end,expected", [(180, ["Alpha", "Beta"]), (40, ["AlphaBeta"])])
def test_actual_row_rule_blocks_join_but_adjacent_column_does_not(tmp_path, rule_end, expected):
    path = tmp_path / "rows.pdf"
    with fitz.open() as doc:
        page = doc.new_page()
        page.insert_text((70, 100), "Alpha", fontsize=11)
        page.insert_text((70, 118), "Beta", fontsize=11)
        page.draw_line((10, 105), (rule_end, 105))
        doc.save(path)
        assert [w[4] for w in _page_words(page)] == expected
    blocks = [Block(PARAGRAPH, 0, text="Alpha\nBeta")]
    _repair_wrapped_words_in_paragraphs(blocks, str(path), [])
    assert blocks[0].text == ("Alpha\nBeta" if rule_end == 180 else "AlphaBeta")


def test_restore_cover_caption_without_flattening_table_or_copying_footer(tmp_path):
    path = tmp_path / "native.pdf"
    with fitz.open() as doc:
        page = doc.new_page()
        for y, text in [(70, "Document: ABC-005"), (110, "Figure content"),
                        (145, "< Figure caption >"), (200, "Table cell"),
                        (240, "Table detail"), (300, "Footer")]:
            page.insert_text((70, y), text)
        height = page.rect.height
        doc.save(path)
    def bb(y0, y1):
        return [60, height-y0, 250, height-y1]

    blocks = [Block(FIGURE, 0, bbox=bb(90, 125)),
              Block(TABLE, 0, bbox=bb(175, 255),
                    table=TableData(1, 1, [["Table cell Table detail"]])),
              Block(PARAGRAPH, 0, text="Footer", bbox=bb(280, 310), section="footer")]
    assert _restore_uncovered_native_lines(str(path), blocks, []) == 3
    body = [b.text for b in blocks if b.type == PARAGRAPH and b.section == "body"]
    assert body == ["Document: ABC-005", "Figure content", "< Figure caption >"]
    assert blocks.index(next(b for b in blocks if b.text == "< Figure caption >")) < blocks.index(
        next(b for b in blocks if b.type == TABLE))
    assert _restore_uncovered_native_lines(str(path), blocks, []) == 0
    assert _restore_uncovered_native_lines(str(path), [], [0]) == 0


def test_repeated_header_text_does_not_hide_cover_title(tmp_path):
    path = tmp_path / "title.pdf"
    with fitz.open() as doc:
        page = doc.new_page()
        page.insert_text((70, 60), "Design")
        page.insert_text((70, 300), "Design")
        height = page.rect.height
        doc.save(path)
    blocks = [Block(PARAGRAPH, 0, text="Design", bbox=[60, height-40, 150, height-70],
                    section="header")]
    assert _restore_uncovered_native_lines(str(path), blocks, []) == 1
    assert [b.text for b in blocks if b.section == "body"] == ["Design"]


def test_split_heading_is_not_added_again_as_a_native_line(tmp_path):
    path = tmp_path / "split.pdf"
    with fitz.open() as doc:
        page = doc.new_page()
        page.insert_text((70, 100), "Design Specification")
        doc.save(path)
    blocks = [Block(HEADING, 0, text="Design"), Block(HEADING, 0, text="Specification")]
    assert _restore_uncovered_native_lines(str(path), blocks, []) == 0


def test_local_hancom_pdf_row_and_bullets():
    root = Path(__file__).resolve().parents[4] / "data"
    path = next(root.rglob("PRJX-DS-005*v1.0.pdf"), None)
    if path is None:
        pytest.skip("Local Hancom reference PDF is not installed")
    with fitz.open(path) as doc:
        names = [w[4] for w in _page_words(doc[1])]
        assert "조득재" in names and "변성훈" in names
        assert "조득재변성훈" not in names
        text = _pymupdf_cell_text(doc[10], (280, 175, 430, 225), doc[10].rect.height)
        assert text.splitlines() == [
            "• 입력 데이터 파싱", "• 데이터 조회 및 추출", "• 데이터 전처리"]
