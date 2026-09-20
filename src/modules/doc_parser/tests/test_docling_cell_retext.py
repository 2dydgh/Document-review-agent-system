"""Docling 격자에 PDF 글자를 다시 채우는 보정 (`_retext_docling_cells`, §4-0 이슈㉔).

격자는 Docling 이 맞고 글자는 우리가 맞다 — Docling 셀 텍스트에는 줄 끝 공백 신호가
없어 `Communication` 이 `Communicati on` 으로 갈라지고, 그러면 **문서에 없는 오타가
지적된다**(실측 PLT56 SYSA RVVR 8건).

여기서 지키는 계약 셋:
  1. Docling 칸 좌표로 PDF 글자를 다시 뽑아 채운다.
  2. **좌표 원점은 주석이 아니라 값으로 판별한다.** 실제로 `docling_adapter` 가
     BOTTOMLEFT 라고 적어 둔 값이 top-left 였고, 그 말을 믿고 뒤집었더니 2,033칸이
     통째로 빈 문자열이 됐다(2026-08-24). 두 원점 모두에서 같은 결과가 나와야 한다.
  3. **실패는 조용히 폴백한다.** 어떤 칸/표가 깨져도 예외를 밖으로 내보내지 않는다 —
     내보내면 상위가 Docling 결과를 통째로 버려 표 구조·머리말꼬리말 복원까지 잃는다.
"""
from pathlib import Path

import pytest

fitz = pytest.importorskip("fitz")

from modules.doc_parser.pdf_backend import _retext_docling_cells  # noqa: E402

_TEXT = "Communication"
_AT = (72, 100)          # 글자를 놓을 자리(top-left, PDF pt)


@pytest.fixture
def pdf(tmp_path):
    """`Communication` 한 낱말만 있는 1쪽 PDF."""
    path = tmp_path / "t.pdf"
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text(_AT, _TEXT)
    doc.save(path)
    height = page.rect.height
    doc.close()
    return str(path), height


def _table(cell_bbox, cells=None):
    return [{"page": 0, "cells": cells or [["갈라진 글 자"]], "cell_bbox": [[cell_bbox]]}]


def _topleft_box():
    """글자를 넉넉히 감싸는 칸(top-left 원점)."""
    x, y = _AT
    return [x - 5, y - 15, x + 200, y + 10]


def test_docling_셀_텍스트를_PDF_글자로_바꾼다(pdf):
    path, _ = pdf
    tables = _table(_topleft_box())
    warnings: list[str] = []

    _retext_docling_cells(tables, path, warnings)

    assert tables[0]["cells"][0][0] == _TEXT
    assert warnings == []


def test_bottom_left_좌표로_와도_같은_결과다(pdf):
    """원점을 값으로 판별한다 — 선언을 믿으면 조용히 어긋난다(이 버그로 한 번 당했다)."""
    path, height = pdf
    left, top, right, bottom = _topleft_box()
    flipped = [left, height - top, right, height - bottom]   # t > b 가 되어 bottom-left
    assert flipped[1] > flipped[3], "이 픽스처가 bottom-left 를 만들지 못했다"
    tables = _table(flipped)

    _retext_docling_cells(tables, path, [])

    assert tables[0]["cells"][0][0] == _TEXT


def test_글자가_없는_칸은_Docling_값을_지키다(pdf):
    """스캔 페이지처럼 텍스트 레이어가 없으면 빈 문자열이 온다 — 덮어쓰면 안 된다."""
    path, _ = pdf
    tables = _table([500, 500, 560, 560], cells=[["Docling 이 읽은 값"]])

    _retext_docling_cells(tables, path, [])

    assert tables[0]["cells"][0][0] == "Docling 이 읽은 값"


def test_깨진_표가_있어도_예외를_내보내지_않는다(pdf):
    """상위가 이 예외를 잡으면 Docling 결과를 통째로 버린다 — 표 구조까지 잃는다."""
    path, _ = pdf
    broken = {"page": 0, "cells": [["그대로"]], "cell_bbox": [["좌표가 아님"]]}
    good = _table(_topleft_box())[0]
    tables = [broken, good]
    warnings: list[str] = []

    _retext_docling_cells(tables, path, warnings)   # 예외가 나면 여기서 실패한다

    assert broken["cells"][0][0] == "그대로"          # 깨진 표는 Docling 값 유지
    assert good["cells"][0][0] == _TEXT              # 나머지 표는 정상 보정
    assert len(warnings) == 1 and "1개" in warnings[0]


def test_PDF_를_못_열면_경고만_남기고_넘어간다(tmp_path):
    tables = _table(_topleft_box())
    warnings: list[str] = []

    _retext_docling_cells(tables, str(tmp_path / "없는파일.pdf"), warnings)

    assert tables[0]["cells"][0][0] == "갈라진 글 자"   # 손대지 않았다
    assert len(warnings) == 1


@pytest.mark.parametrize("edge", ["left", "right", "top", "bottom"])
def test_predicted_text_box_does_not_drop_boundary_word(tmp_path, edge):
    """A predicted text box is not an exact cell border; don't lose 'as'."""
    path = tmp_path / "boundary.pdf"
    with fitz.open() as doc:
        page = doc.new_page()
        page.insert_text((72, 100), "same evaluation results as ")
        page.insert_text((72, 114), "Rev.00. ")
        word = next(w for w in page.get_text("words") if w[4] == "as")
        x0, y0, x1, y1 = word[:4]
        box = [65, 80, 350, 120]
        if edge == "right":
            box[2] = (x0 + x1) / 2 - 0.1
        elif edge == "left":
            box[0] = (x0 + x1) / 2 + 0.1
        elif edge == "top":
            box[1] = (y0 + y1) / 2 + 0.1
        else:
            box[3] = (y0 + y1) / 2 - 0.1
        doc.save(path)
    tables = _table(box, cells=[["same evaluation results as Rev.00."]])
    _retext_docling_cells(tables, str(path), [])
    assert "as" in tables[0]["cells"][0][0].split()
    if edge == "right":
        assert tables[0]["cells"][0][0] == "same evaluation results as Rev.00."


def test_shared_boundary_assigns_whole_word_only_once(tmp_path):
    path = tmp_path / "ownership.pdf"
    with fitz.open() as doc:
        page = doc.new_page()
        page.insert_text((72, 100), "Alpha detail Omega ")
        page.insert_text((72, 145), "Outside ")
        w = next(w for w in page.get_text("words") if w[4] == "detail")
        mid = (w[0] + w[2]) / 2 - 0.1
        doc.save(path)
    tables = [{"page": 0, "cells": [["left", "right"]],
               "cell_bbox": [[[60, 80, mid, 110], [mid, 80, 250, 110]]]}]
    _retext_docling_cells(tables, str(path), [])
    cells = tables[0]["cells"][0]
    assert cells == ["Alpha", "detail Omega"]
    assert " ".join(cells).split().count("detail") == 1
    assert "Outside" not in " ".join(cells)


def test_ambiguous_overlapping_boxes_keep_original_table(tmp_path):
    path = tmp_path / "ambiguous.pdf"
    with fitz.open() as doc:
        page = doc.new_page()
        page.insert_text((72, 100), "Alpha ")
        doc.save(path)
    box = [60, 80, 250, 110]
    tables = [{"page": 0, "cells": [["original left", "original right"]],
               "cell_bbox": [[box, box]]}]
    warnings = []
    _retext_docling_cells(tables, str(path), warnings)
    assert tables[0]["cells"] == [["original left", "original right"]]
    assert len(warnings) == 1


def test_touching_neighbour_word_is_not_added_without_cell_text_support(tmp_path):
    path = tmp_path / "neighbour.pdf"
    with fitz.open() as doc:
        page = doc.new_page()
        page.insert_text((72, 90), "user ")
        page.insert_text((72, 110), "Satisfied ")
        word = next(w for w in page.get_text("words") if w[4] == "user")
        top = (word[1] + word[3]) / 2 + 0.1
        doc.save(path)
    tables = _table([65, top, 250, 120], cells=[["Satisfied"]])
    _retext_docling_cells(tables, str(path), [])
    assert tables[0]["cells"] == [["Satisfied"]]


def test_hairline_overlap_does_not_copy_a_misassigned_docling_word(tmp_path):
    path = tmp_path / "hairline.pdf"
    with fitz.open() as doc:
        page = doc.new_page()
        page.insert_text((72, 90), "user ")
        page.insert_text((72, 110), "Satisfied ")
        word = next(w for w in page.get_text("words") if w[4] == "user")
        top = word[3] - 0.1
        doc.save(path)
    tables = _table([65, top, 250, 120], cells=[["user Satisfied"]])
    _retext_docling_cells(tables, str(path), [])
    assert tables[0]["cells"] == [["Satisfied"]]


def test_local_sysa_revision_cell_preserves_as():
    source = (Path(__file__).resolve().parents[4] / "data" / "에너지인프라시스템실"
              / "PLT56_SYSA_RVVR_Rev05.pdf")
    if not source.is_file():
        pytest.skip("local source PDF is not distributed with tests")
    expected = "[Rev.04] Satisfied: same evaluation results as Rev.00."
    # Keep the previous row as in the actual table: its descenders touch the
    # final text box, but those words already have a centre owner above.
    tables = [{"page": 45, "cells": [[expected.replace("04", "05")], [expected]],
               "cell_bbox": [[[271.84394, 719.38685, 455.04585, 744.00345]],
                             [[271.29258, 743.45419, 452.51792, 766.67594]]]}]
    warnings = []
    _retext_docling_cells(tables, str(source), warnings)
    assert tables[0]["cells"][1] == [expected]
    assert warnings == []


# ── 예측 상자 밖으로 떨어진 낱말(2026-09-15) ──────────────────────────────────
# Docling 상자가 좁거나 어긋나면 낱말이 어느 칸에도 못 들어간다. 옆 칸에 붙이는
# 규칙은 문서에 없는 글("of the the")을 만들어 뺐다 — 빠진 낱말은 경고로 말한다.

def _two_line_pdf(tmp_path):
    """칸 A 에 두 줄("same evaluation results as" / "Rev.00."), 오른쪽에 칸 B("N/A")."""
    path = tmp_path / "t2.pdf"
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 100), "same evaluation results as ")   # 줄 끝 공백 = 낱말이 끝났다
    page.insert_text((72, 112), "Rev.00.")
    page.insert_text((260, 100), "N/A")
    doc.save(path)
    words = {w[4]: w for w in page.get_text("words")}
    doc.close()
    return str(path), words


def test_상자_밖_낱말은_지어내지_않고_경고한다(tmp_path):
    path, w = _two_line_pdf(tmp_path)
    as_x0 = w["as"][0]
    box_a = [67, 88, as_x0 - 3, 116]                      # "as" 를 안 덮는다(선도 없다)
    box_b = [w["N/A"][0] - 3, 88, w["N/A"][2] + 3, 116]
    tables = [{"page": 0, "cells": [["same evaluation results Rev.00.", "N/A"]],
               "cell_bbox": [[box_a, box_b]]}]
    warnings: list[str] = []

    _retext_docling_cells(tables, path, warnings)

    assert "as" not in tables[0]["cells"][0][0].split()
    assert tables[0]["cells"][0][1] == "N/A"
    assert any("as" in x and "칸" in x for x in warnings), warnings


# ── 선이 있는 표는 선이 칸이다(2026-09-15) ──────────────────────────────────
# Docling 상자는 글자 범위지 칸이 아니다. 실측(PLT56 RVVR 46쪽): 상자 268~457,
# 괘선 269.7~475.3 — 줄 끝 "as"(x1 456.7)는 칸 안인데 상자 밖이었다.

def _ruled_pdf(tmp_path):
    """칸 A("same evaluation results as") 와 칸 B("N/A") 를 실제 선으로 그린 표."""
    path = tmp_path / "t3.pdf"
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 100), "same evaluation results as ")
    page.insert_text((260, 100), "N/A")
    for x in (65, 245, 300):            # 세로 괘선 — 칸 A 는 글자보다 약 40pt 넓다
        page.draw_line((x, 85), (x, 120), width=0.5)
    for y in (85, 120):                 # 가로 괘선
        page.draw_line((65, y), (300, y), width=0.5)
    doc.save(path)
    words = {w[4]: w for w in page.get_text("words")}
    doc.close()
    return str(path), words


def test_괘선이_있으면_예측_상자를_선까지_넓힌다(tmp_path):
    path, w = _ruled_pdf(tmp_path)
    # Docling 상자가 "as" 앞에서 끝난다(겹침 0) — 괘선(x=250)까지 넓히면 "as"는 칸 안이다.
    box_a = [70, 90, w["as"][0] - 3, 114]
    box_b = [w["N/A"][0] - 2, 90, w["N/A"][2] + 2, 114]
    tables = [{"page": 0, "cells": [["same evaluation results", "N/A"]],
               "cell_bbox": [[box_a, box_b]]}]
    warnings: list[str] = []

    _retext_docling_cells(tables, path, warnings)

    assert tables[0]["cells"][0] == ["same evaluation results as", "N/A"]
    assert warnings == []


def test_괘선_맞추기는_상자_변을_지나는_선만_쓴다():
    from modules.doc_parser.pdf_backend import _snap_boxes_to_rules
    boxes = {(0, 0): (100.0, 100.0, 200.0, 120.0)}
    # x=210 선은 y 100~120 을 지나지만, x=205 선은 다른 행(y 300~400)의 선이다.
    vs = [(210.0, 90.0, 130.0), (205.0, 300.0, 400.0), (95.0, 90.0, 130.0), (60.0, 90.0, 130.0)]
    snapped = _snap_boxes_to_rules(boxes, vs, [])
    assert snapped[(0, 0)] == (95.0, 100.0, 210.0, 120.0)


def test_넓힌_상자가_겹치면_예측_상자로_되돌린다():
    """병합 칸 옆에서 먼 선을 잡아 옆 칸을 덮으면, 낱말 소속이 둘이 되어 표 전체가
    되돌아간다. 겹치는 쌍은 예측 상자를 그대로 둔다."""
    from modules.doc_parser.pdf_backend import _snap_boxes_to_rules
    boxes = {(0, 0): (100.0, 100.0, 200.0, 120.0), (0, 1): (215.0, 100.0, 300.0, 120.0)}
    vs = [(240.0, 90.0, 130.0)]   # (0,0) 오른쪽 변이 잡을 선이 (0,1) 안을 지난다
    snapped = _snap_boxes_to_rules(boxes, vs, [])
    assert snapped == boxes
