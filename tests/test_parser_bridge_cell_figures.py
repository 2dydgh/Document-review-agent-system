"""표 셀 안 그림이 `| 셀 |` 줄에 `[그림 N]` 으로 실리는가 (`_embed_cell_figures`).

한글 문서는 순서도·구성도를 표 칸에 넣는 것이 관례다. 실측(AX품질팀 상세설계서
PRJX-DS-014): 그림 26장 중 24장이 `TableData.images` 에 있었고, to_rawdoc 이 표를
펼 때 그것을 안 봐서 OCR 까지 마친 순서도가 검토 본문에 한 장도 안 실렸다.

번호는 본문 FIGURE 블록과 한 카운터로 문서 순서대로 매겨야 한다 — describe_images
와 형광펜이 `[그림 N]` 의 N 으로 meta["images"] 의 N 번째를 찾는다.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from app.parser_bridge import _embed_cell_figures, to_rawdoc
from modules.doc_parser.model import FIGURE, PARAGRAPH, TABLE, Block, DocumentModel, TableData


@dataclass
class _Table:
    cells: list[list[str]]
    images: list[dict] = field(default_factory=list)
    nested_tables: list = field(default_factory=list)
    merges: list = field(default_factory=list)


def _counter():
    n = [0]

    def nxt() -> int:
        n[0] += 1
        return n[0]
    return nxt


def test_셀_그림이_그_칸_텍스트_뒤에_붙는다():
    td = _Table(cells=[["순서도", "설명"]],
                images=[{"row": 0, "col": 0, "figure": Block(FIGURE, 0, text="시작 → 종료")}])

    got = _embed_cell_figures(td, td.cells, _counter())

    assert got == [["순서도 [그림 1: 시작 → 종료]", "설명"]]


def test_읽지_못한_그림은_번호만_남긴다():
    td = _Table(cells=[["", ""]],
                images=[{"row": 0, "col": 1, "figure": Block(FIGURE, 0, text=None)}])

    got = _embed_cell_figures(td, td.cells, _counter())

    assert got == [["", "[그림 1]"]]


def test_본문_그림과_셀_그림이_한_카운터로_순서대로_번호를_받는다():
    """본문 [그림 1] → 표 안 [그림 2] → 본문 [그림 3]. 따로 세면 전부 어긋난다."""
    cell_fig = Block(FIGURE, 0, text="칸 안 순서도")
    td = TableData(rows=1, cols=1, cells=[["칸"]],
                   images=[{"row": 0, "col": 0, "figure": cell_fig}])
    model = DocumentModel(source="t.hwpx", blocks=[
        Block(FIGURE, 0, text="첫 그림"),
        Block(TABLE, 0, table=td),
        Block(FIGURE, 0, text="셋째 그림"),
        Block(PARAGRAPH, 0, text="끝"),
    ], meta={"pages": 1})

    raw = to_rawdoc(model, "hwpx")

    assert "[그림 1: 첫 그림]" in raw.text
    assert "| 칸 [그림 2: 칸 안 순서도] |" in raw.text
    assert "[그림 3: 셋째 그림]" in raw.text


def test_그림_설명의_파이프는_표_줄을_깨지_않는다():
    td = TableData(rows=1, cols=2, cells=[["a", "b"]],
                   images=[{"row": 0, "col": 0, "figure": Block(FIGURE, 0, text="x | y")}])
    model = DocumentModel(source="t.hwpx",
                          blocks=[Block(TABLE, 0, table=td)], meta={"pages": 1})

    raw = to_rawdoc(model, "hwpx")

    row = next(ln for ln in raw.text.splitlines() if ln.startswith("|"))
    assert row.count("|") == 3, row      # 시작·구분·끝 — 칸이 늘어나지 않았다
    assert "x / y" in row


def test_머리말_그림도_번호를_소비해_legacy_순서와_맞춘다():
    """describe_images 는 legacy 의 N 번째 설명을 [그림 N] 에 붙인다. legacy 는 문서
    등장 순서로 세므로 머리말 로고가 앞 번호를 차지한다 — 본문에서 건너뛰면 설명이
    전부 밀린다(실측 PRJX-DS-014: 로고 4장만큼 밀렸다)."""
    logo = Block(FIGURE, 0, text="로고", section="header")
    logo_td = TableData(rows=1, cols=1, cells=[["회사"]],
                        images=[{"row": 0, "col": 0, "figure": Block(FIGURE, 0, text="도장")}])
    model = DocumentModel(source="t.hwpx", blocks=[
        logo,                                          # 머리말 그림 → 1번 소비
        Block(TABLE, 0, table=logo_td, section="footer"),   # 꼬리말 표 안 그림 → 2번 소비
        Block(FIGURE, 0, text="본문 첫 순서도"),          # → 3번
    ], meta={"pages": 1})

    raw = to_rawdoc(model, "hwpx")

    assert "[그림 3: 본문 첫 순서도]" in raw.text
    assert "[그림 1" not in raw.text and "[그림 2" not in raw.text   # 머리말은 본문에 없다
    assert raw.meta["headers"] == ["로고"] and raw.meta["footers"] == ["회사"]


def test_표지_그림도_번호만_소비하고_본문에_안_싣는다():
    """서식 표지의 발주처·수행사 로고가 `[그림 1]` 로 본문에 실리면 전체 문서 검사가
    "그림 번호가 3부터 시작한다"를 지적한다(2026-09-14 QA). 머리말과 같은 처리다 —
    번호는 소비하고 자리표시만 뺀다."""
    logo_td = TableData(rows=1, cols=1, cells=[["수행사"]],
                        images=[{"row": 0, "col": 0, "figure": Block(FIGURE, 0, text="로고")}])
    model = DocumentModel(source="t.hwpx", blocks=[
        Block(FIGURE, 0, text="표지 그림"),              # 표지 → 1번 소비
        Block(TABLE, 0, table=logo_td),                   # 표지 표 안 로고 → 2번 소비
        Block(FIGURE, 1, text="본문 첫 순서도"),          # → 3번
    ], meta={"pages": 2})

    raw = to_rawdoc(model, "hwpx")

    assert "[그림 1" not in raw.text and "[그림 2" not in raw.text
    assert "[그림 3: 본문 첫 순서도]" in raw.text
    assert "| 수행사 |" in raw.text        # 표지 표의 글자는 그대로 남는다
    assert raw.meta["figures_seen"] == 3


def test_한_쪽짜리_문서에는_표지가_없다():
    """1쪽을 무조건 표지로 치면 한 쪽짜리 문서의 그림이 통째로 사라진다."""
    model = DocumentModel(source="t.hwpx",
                          blocks=[Block(FIGURE, 0, text="유일한 순서도")], meta={"pages": 1})

    assert "[그림 1: 유일한 순서도]" in to_rawdoc(model, "hwpx").text
