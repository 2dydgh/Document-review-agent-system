"""번호 열과 글 열이 찢어진 페이지 복구(_numbering_torn · _rebuild_torn_page, 2026-09-16).

실측(PLT56 SYSA RVVR 8쪽): 워드 번호 매기기 목록이 PDF 에서 번호 덩어리와 글 덩어리로
갈라지고, pdf-inspector 는 번호만 있는 줄들 뒤에 글 전부를 한 문단으로 냈다. 그 결과
참조문서 검사기가 목록을 0건으로 읽고 LLM 이 항목을 한 줄 어긋나게 읽었다.
"""
import pytest

fitz = pytest.importorskip("fitz")
from modules.doc_parser.pdf_backend import (  # noqa: E402
    _markdown_to_blocks,
    _numbering_torn,
    _promote_numbered_paragraphs,
    _rebuild_torn_page,
)

_TORN_MD = """**3.0**
## 3.1.

3.1.1.
3.1.2.
# References

Unless otherwise noted. **Regulations** USNRC Reg. Guide 1.168-2004, "V&V"
USNRC Reg. Guide 1.172-1997
"""


def test_번호만_있는_줄이_셋_이상이면_찢어진_페이지다():
    assert _numbering_torn(_TORN_MD)
    assert not _numbering_torn("# 3.0 References\n\n3.1.1 NUREG-0800, BTP 7-14\n")
    assert not _numbering_torn("")


@pytest.fixture
def torn_pdf(tmp_path):
    """번호는 x=85, 글은 x=142 — 워드 번호 매기기가 PDF 에 들어가는 꼴. 항목 하나는 두 줄."""
    path = tmp_path / "torn.pdf"
    doc = fitz.open()
    page = doc.new_page()
    rows = [("3.0", "References"), ("3.1.", "Regulations"),
            ("3.1.1.", "USNRC Reg. Guide 1.168-2004, \"Verification, Validation\""),
            (None, "for Digital Computer Software"),          # 앞 항목이 꺾인 둘째 줄
            ("3.1.2.", "USNRC Reg. Guide 1.172-1997, \"Software Requirements\"")]
    y = 80
    for num, text in rows:
        if num:
            page.insert_text((85, y), num)
        page.insert_text((142, y), text)
        y += 18
    doc.save(path)
    doc.close()
    return str(path)


def test_같은_줄의_번호와_글을_다시_붙여_절로_낸다(torn_pdf):
    with fitz.open(torn_pdf) as doc:
        md = _rebuild_torn_page(doc[0])
    assert "# 3.0 References" in md
    assert "## 3.1. Regulations" in md or "## 3.1 Regulations" in md
    assert "### 3.1.1 USNRC" in md and "1.168-2004" in md
    blocks = _markdown_to_blocks(md, 0)
    heads = [b.text for b in blocks if b.type == "heading"]
    assert heads[0].startswith("3.0 References")
    # 꺾인 둘째 줄은 앞 항목에 이어 붙는다 — 새 절이 되지 않는다.
    assert not any(h.startswith("for Digital") for h in heads)
    joined = " ".join(b.text or "" for b in blocks)
    assert "for Digital Computer Software" in joined


def test_번호로_시작하는_문단이_둘_이상이면_절로_올린다():
    """9쪽: pdf-inspector 가 `3.3.6. X11008…` 항목을 문단으로 냈다 — 8쪽 항목(절)과 같은
    모양이어야 참조문서 검사기가 목록 전체를 읽는다."""
    md = ("3.3.6. X11008-617SR-001C, Rev.08, \"SRS for Server\"\n"
          "Common Cause Failure, VENDOR\n\n"
          "3.3.7. X11008-617GM-702C, \"Cyber Security Plan\"\n\n"
          "## SKN-22CM-B03-100 Rev.05 Page 9 of 21\n")
    blocks = _promote_numbered_paragraphs(_markdown_to_blocks(md, 8))
    heads = [(b.level, b.text) for b in blocks if b.type == "heading"]
    assert heads[0] == (3, "3.3.6 X11008-617SR-001C, Rev.08, \"SRS for Server\" "
                           "Common Cause Failure, VENDOR")
    assert heads[1][1].startswith("3.3.7 X11008-617GM-702C")


def test_번호_문단이_하나뿐이면_그대로_둔다():
    md = "3.1.1. 이 문장은 번호로 시작하는 보통 문장일 수 있다.\n\n다음 문단.\n"
    blocks = _promote_numbered_paragraphs(_markdown_to_blocks(md, 0))
    assert all(b.type != "heading" for b in blocks)
