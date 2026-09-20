"""원본 XML → DocumentModel → 실제 앱 로더 → 검토 청크의 텍스트 보존 계약."""

import re
import socket
import zipfile
from pathlib import Path
from types import SimpleNamespace
from xml.etree import ElementTree as ET

import pytest
from hwpx.document import HwpxDocument

from app import images as image_reader
from app.parser_bridge import TrkimLoader, to_rawdoc
from modules.doc_parser import chunk, normalize
from modules.doc_parser.model import Block, DocumentModel, TableData
from modules.doc_parser.router import parse_document

HP = "{http://www.hancom.co.kr/hwpml/2011/paragraph}"


def compact(text):
    return re.sub(r"\s+", "", text)


def table_captions(table):
    if table.caption:
        yield table.caption
    for image in table.images:
        if image["figure"].caption:
            yield image["figure"].caption
    for nested in table.nested_tables:
        yield from table_captions(nested["table"])


def model_captions(model):
    for block in model.blocks:
        if block.caption:
            yield block.caption
        if block.table:
            yield from table_captions(block.table)


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    def denied(*args, **kwargs):
        pytest.fail("Parser preservation tests must not access a network/OCR service")

    monkeypatch.setattr(socket.socket, "connect", denied)
    monkeypatch.setattr(socket, "create_connection", denied)


def test_captions_stay_beside_owners_through_review_chunks(monkeypatch):
    inner = TableData(1, 1, [["안쪽 셀"]], caption="안쪽 표 캡션")
    table = TableData(
        1,
        2,
        [["첫 셀", "둘째 셀"]],
        caption="바깥 표 설명",
        nested_tables=[{"row": 0, "col": 0, "table": inner}],
        images=[
            {
                "row": 0,
                "col": 1,
                "figure": Block("figure", 0, caption="셀 그림 캡션", needs_semantic=True),
            }
        ],
    )
    model = DocumentModel(
        "test.hwpx",
        blocks=[
            Block("table", 0, table=table),
            Block("figure", 0, text="OCR 내용", caption="독립 그림 캡션"),
            Block("paragraph", 0, text="뒤쪽 본문"),
        ],
    )
    raw = to_rawdoc(model, "hwpx")
    assert (
        "바깥 표 설명\n| 첫 셀 안쪽 표 캡션 안쪽 셀 | 둘째 셀 [그림 1] 셀 그림 캡션 |" in raw.text
    )
    assert "[그림 2: OCR 내용]\n독립 그림 캡션\n뒤쪽 본문" in raw.text
    # 그림 설명 치환 영역 밖에 있으므로 OCR/비전 결과 갱신에도 원본 캡션이 남는다.
    image = {"no": 1, "part": "image.png", "alt": ""}
    raw.meta["images"] = [image]
    monkeypatch.setattr(image_reader, "iter_images", lambda raw: [(image, b"fake image")])
    vlm = SimpleNamespace(chat=lambda *args: SimpleNamespace(text="새 그림 설명", error=None))
    raw = image_reader.describe_images(raw, vlm)
    assert "[그림 1: 새 그림 설명]" in raw.text
    review = "".join(c.text for c in chunk(normalize(raw)))
    for caption in model_captions(model):
        assert review.count(caption) == 1


def test_header_caption_is_metadata_not_body():
    table = TableData(
        1,
        1,
        [["머리말 셀"]],
        caption="머리말 표 캡션",
        images=[{"row": 0, "col": 0, "figure": Block("figure", 0, caption="로고 캡션")}],
    )
    raw = to_rawdoc(
        DocumentModel(
            "test.hwpx",
            blocks=[
                Block("table", 0, table=table, section="header"),
                Block("figure", 0, caption="본문 그림"),
            ],
        ),
        "hwpx",
    )
    assert raw.meta["headers"] == ["머리말 표 캡션 머리말 셀 로고 캡션"]
    assert "머리말" not in raw.text
    assert "[그림 2]\n본문 그림" in raw.text
    assert normalize(raw).meta["headers"] == raw.meta["headers"]


def test_saved_xml_to_app_loader_to_chunks(tmp_path):
    def add(parent, tag, text=None):
        node = parent.makeelement(HP + tag, {})
        node.text = text
        parent.append(node)
        return node

    with HwpxDocument.new() as doc:
        p = doc.add_paragraph("본문 시작")
        t = p.element.find(f"{HP}run/{HP}t")
        add(t, "tab").tail = "탭 뒤 문장"
        add(t, "lineBreak").tail = "줄바꿈 뒤 문장"
        table = doc.add_table(1, 1)
        table.get_cell_map()[0][0].cell.text = "표 내용"
        cap = add(table.element, "caption")
        add(add(add(add(cap, "subList"), "p"), "run"), "t", "표 설명 문장")
        path = tmp_path / "input.hwpx"
        doc.save_to_path(path)
    model = parse_document(path, ocr=False, docling=False)
    raw = TrkimLoader(ocr=False).load(path)
    assert raw.meta["parser"] == "trkim"  # fallback 통과를 성공으로 오인하지 않는다.
    assert raw.text == to_rawdoc(model, "hwpx").text
    review = compact("".join(c.text for c in chunk(normalize(raw))))
    assert compact("본문 시작 탭 뒤 문장 줄바꿈 뒤 문장") in review
    assert compact("표 설명 문장|표 내용|") in review


def test_design_sample_native_text_reaches_review_input():
    data = Path(__file__).resolve().parents[1] / "data"
    source = next(data.rglob("PRJX-DS-005*v1.0.hwpx"), None)
    if source is None:
        pytest.skip("로컬 상세설계서 샘플 없음 — 합성 테스트와 별도로 실문서 확인")
    model = parse_document(source, ocr=False, docling=False)
    raw = TrkimLoader(ocr=False).load(source)
    assert raw.meta["parser"] == "trkim"
    assert raw.text == to_rawdoc(model, "hwpx").text
    review = compact("".join(c.text for c in chunk(normalize(raw))))
    all_input = review + compact("".join(raw.meta["headers"] + raw.meta["footers"]))
    source_texts, source_captions = [], []
    with zipfile.ZipFile(source) as archive:
        for name in archive.namelist():
            if not re.fullmatch(r"Contents/section\d+\.xml", name):
                continue
            root = ET.fromstring(archive.read(name))
            # 파서 helper와 독립된 원본 대조. 각 문단의 직접 t만 읽어 중복을 피한다.
            for p in root.iter(HP + "p"):
                text = "".join("".join(t.itertext()) for t in p.findall(f"{HP}run/{HP}t"))
                if len(compact(text)) >= 8:
                    source_texts.append(compact(text))
            for cap in root.iter(HP + "caption"):
                source_captions.append(
                    compact("".join("".join(t.itertext()) for t in cap.iter(HP + "t")))
                )
    assert source_texts and len(source_captions) == 6
    missing = [i for i, text in enumerate(source_texts) if text not in all_input]
    assert not missing, f"검토 입력에 보존되지 않은 XML 문단 인덱스: {missing}"
    owned = [compact(c) for c in model_captions(model)]
    assert sorted(owned) == sorted(source_captions)
    assert all(c in review for c in source_captions)
    assert len(model.tables) == 31
    assert sum(len(b.table.merges) for b in model.tables) == 379
