"""Native HWPX mixed text and caption ownership; no OCR service needed."""

from xml.etree import ElementTree as ET

import pytest
from hwpx.document import HwpxDocument

from modules.doc_parser import hwpx_backend as backend
from modules.doc_parser.model import FIGURE, TABLE

HP = "{http://www.hancom.co.kr/hwpml/2011/paragraph}"


def xml(body):
    return ET.fromstring(f'<hp:p xmlns:hp="{HP[1:-1]}">{body}</hp:p>')


@pytest.mark.parametrize(
    ("body", "expected"),
    [
        ("<hp:run><hp:t>앞<hp:tab/>탭 뒤<hp:lineBreak/>줄 뒤</hp:t></hp:run>", "앞\t탭 뒤\n줄 뒤"),
        (
            '<hp:run><hp:t>가</hp:t><hp:ctrl id="tab"/><hp:t>나</hp:t>'
            '<hp:lineBreak/><hp:t>다</hp:t></hp:run>',
            "가\t나\n다",
        ),
        ("<hp:run><hp:t><hp:tab/>첫 글자<hp:tab/>끝</hp:t></hp:run>", "\t첫 글자\t끝"),
        (
            "<hp:run><hp:t>본문</hp:t><hp:tbl><hp:p><hp:run><hp:t>셀</hp:t></hp:run></hp:p></hp:tbl></hp:run>",
            "본문",
        ),
    ],
)
def test_paragraph_mixed_content(body, expected):
    assert backend._paragraph_text(xml(body)) == expected


def add(parent, local, text=None, **attrs):
    node = parent.makeelement(HP + local, attrs)
    node.text = text
    parent.append(node)
    return node


def caption(owner, text):
    cap = add(owner, "caption", side="BOTTOM")
    p = add(add(cap, "subList"), "p")
    add(add(p, "run"), "t", text)


@pytest.fixture
def source(tmp_path):
    with HwpxDocument.new() as doc:
        p = doc.add_paragraph("앞부분")
        t = p.element.find(f"{HP}run/{HP}t")
        add(t, "tab").tail = "탭 뒤 본문"
        add(t, "lineBreak").tail = "줄 뒤 본문"
        pic = add(p.element.find(f"{HP}run"), "pic")
        # binary id가 없는 손상 그림이어도 원본 캡션은 보존해야 한다.
        caption(pic, "그림의 원본 캡션")
        table = doc.add_table(1, 1)
        caption(table.element, "표의 원본 캡션")
        cell = table.get_cell_map()[0][0].cell
        cell.text = "셀 첫 문단"
        cp = cell.add_paragraph("셀 둘째 문단")
        ct = cp.element.find(f"{HP}run/{HP}t")
        add(ct, "tab").tail = "셀 탭 뒤 문장"
        caption(add(cp.element.find(f"{HP}run"), "pic"), "셀 그림 캡션")
        inner = doc.add_table(1, 1)
        inner.get_cell_map()[0][0].cell.text = "중첩 표 내용"
        caption(inner.element, "중첩 표 캡션")
        cp.element.find(f"{HP}run").append(inner.element)
        header = doc.sections[0].properties.set_header_text("머리말")
        ht = header.element.find(f".//{HP}t")
        add(ht, "tab").tail = "머리말 뒷부분"
        path = tmp_path / "mixed.hwpx"
        doc.save_to_path(path)
    return path


def test_saved_hwpx_preserves_text_and_owner(source, monkeypatch):
    monkeypatch.setattr(backend, "OCR_HOOK", None)
    model = backend.parse_hwpx(source)
    assert "앞부분\t탭 뒤 본문\n줄 뒤 본문" in model.text
    table = next(b.table for b in model.blocks if b.type == TABLE)
    assert table.caption == "표의 원본 캡션"
    assert table.cells == [["셀 첫 문단\n셀 둘째 문단\t셀 탭 뒤 문장"]]
    assert table.images[0]["figure"].caption == "셀 그림 캡션"
    assert table.nested_tables[0]["table"].caption == "중첩 표 캡션"
    assert table.nested_tables[0]["table"].cells == [["중첩 표 내용"]]
    figure = next(b for b in model.blocks if b.type == FIGURE)
    assert figure.caption == "그림의 원본 캡션"
    assert figure.text is None and figure.needs_semantic
    assert any(b.section == "header" and b.text == "머리말\t머리말 뒷부분" for b in model.blocks)
    assert "그림의 원본 캡션" not in model.text  # 본문 문단에 중복하지 않음
    assert (
        next(b for b in model.to_dict()["blocks"] if b["type"] == TABLE)["table"]["caption"]
        == table.caption
    )


def test_shape_caption_is_not_ocr_or_shape_body():
    shape = xml(
        "<hp:subList><hp:p><hp:run><hp:t>도형<hp:tab/>내용</hp:t></hp:run></hp:p></hp:subList>"
        "<hp:caption><hp:subList><hp:p><hp:run><hp:t>도형 설명</hp:t>"
        "</hp:run></hp:p></hp:subList></hp:caption>"
    )
    block = backend._build_shape_block(shape, 0, "body")
    assert block.text == "도형\t내용"
    assert block.caption == "도형 설명"
    assert not block.needs_semantic


def test_parent_does_not_steal_nested_caption():
    parent = xml(
        "<hp:run><hp:tbl><hp:caption><hp:subList><hp:p><hp:run><hp:t>안쪽 표</hp:t>"
        "</hp:run></hp:p></hp:subList></hp:caption></hp:tbl></hp:run>"
    )
    assert backend._caption_text(parent) is None
    assert backend._caption_text(parent.find(f"{HP}run/{HP}tbl")) == "안쪽 표"


def test_note_keeps_paragraph_boundaries_and_tails():
    note = xml(
        "<hp:subList><hp:p><hp:run><hp:t>주석<hp:lineBreak/>뒷부분</hp:t></hp:run></hp:p>"
        "<hp:p><hp:run><hp:t>다음 문단</hp:t></hp:run></hp:p></hp:subList>"
    )
    assert (
        backend._build_note_block(note, "footNote", 0, "body", None).text
        == "주석\n뒷부분\n다음 문단"
    )


def test_ocr_cannot_replace_native_caption(source, monkeypatch):
    monkeypatch.setattr(backend, "_resolve_image_bytes", lambda *args: b"image")
    monkeypatch.setattr(
        backend, "OCR_HOOK", lambda *args: [{"text": "이미지 내부 글자", "bbox": None}]
    )
    model = backend.parse_hwpx(source)
    figure = next(b for b in model.blocks if b.type == FIGURE)
    assert figure.text == "이미지 내부 글자"
    assert figure.caption == "그림의 원본 캡션"


def test_missing_image_warns_without_losing_caption(source, monkeypatch):
    monkeypatch.setattr(
        backend, "OCR_HOOK", lambda *args: pytest.fail("missing image must not reach OCR")
    )
    model = backend.parse_hwpx(source)
    assert model.warnings
    assert next(b for b in model.blocks if b.type == FIGURE).caption == "그림의 원본 캡션"
