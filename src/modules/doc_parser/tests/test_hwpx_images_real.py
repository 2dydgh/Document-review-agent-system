"""hwpx 그림 인덱스와 WMF 변환 — **실문서**로 건다.

이 둘은 합성 fixture 로는 잡히지 않았다. `_build_bin_data_index` 는 python-hwpx 가
만든 합성 문서(`header.xml` 의 binItem)로만 검증됐고, 한컴오피스가 만든 실제 문서는
목록을 `content.hpf` 에만 둔다 — 그래서 실문서에서 인덱스가 0개였고 그림 26장이
전부 빠졌다(2026-08-25, AX품질팀 상세설계서). 합성 fixture 통과를 실문서 통과로
읽은 것이 원인이라, 여기서는 실문서를 직접 연다. 없는 기계에서는 skip 이다.

WMF 는 한글이 도형·순서도를 저장하는 벡터 포맷이라 상세설계서의 알맹이가 이것으로
온다. 벡터 바이트를 VL 에 그대로 보내면 못 읽으므로 픽셀로 바꿔야 하고, 그 변환이
실물에서 되는지·크롭이 되는지를 본다.
"""
from __future__ import annotations

import io
import shutil
import zipfile
from pathlib import Path

import pytest

from modules.doc_parser import ocr_batch

_ROOT = Path(__file__).resolve().parents[4]
_DATA = _ROOT / "data"
_HWPX = sorted(_DATA.rglob("PRJX-DS-014*.hwpx")) if _DATA.is_dir() else []

pytestmark = pytest.mark.skipif(not _HWPX, reason="AX품질팀 상세설계서(hwpx) 없음")


def _first_wmf() -> bytes:
    z = zipfile.ZipFile(_HWPX[0])
    name = next(n for n in z.namelist() if n.lower().endswith(".wmf"))
    return z.read(name)


def test_실문서의_그림_인덱스는_content_hpf_로_전부_찾힌다():
    """header.xml 에는 binItem 이 0개다. 여기서 0 이 나오면 회귀다."""
    from hwpx.document import HwpxDocument

    from modules.doc_parser.hwpx_backend import _build_bin_data_index, _resolve_image_bytes

    doc = HwpxDocument.open(str(_HWPX[0]))
    index = _build_bin_data_index(doc)
    assert len(index) >= 20, f"인덱스 {len(index)}개 — content.hpf 를 못 읽고 있다"
    unreadable = [k for k in index if _resolve_image_bytes(doc, index, k) is None]
    assert not unreadable, f"인덱스는 있는데 바이트를 못 꺼냄: {unreadable[:5]}"


def test_WMF_는_바이트_머리로_판별한다():
    assert ocr_batch._is_wmf(_first_wmf())
    assert not ocr_batch._is_wmf(b"\x89PNG\r\n\x1a\n")
    assert not ocr_batch._is_wmf(b"")


@pytest.mark.skipif(not shutil.which("soffice"), reason="LibreOffice 없음")
def test_WMF_를_픽셀로_바꾸고_여백을_자른다():
    """A4 캔버스(200dpi 면 1700×2200) 그대로 나오면 크롭이 안 된 것이다."""
    from PIL import Image

    png = ocr_batch.wmf_to_png(_first_wmf())
    assert png is not None and png[:8] == b"\x89PNG\r\n\x1a\n"
    im = Image.open(io.BytesIO(png))
    assert im.width < 1200 and im.height < 1600, f"크롭 안 됨: {im.size}"
    assert im.width >= 40 and im.height >= 40, f"우표만 하다: {im.size}"


def test_변환에_실패한_벡터는_훅에_넘기지_않는다(monkeypatch):
    """벡터를 PNG 라고 보내면 VL 이 쓰레기를 돌려준다 — 넘기지 말고 경고로 남긴다."""
    from modules.doc_parser.model import FIGURE, Block

    monkeypatch.setattr(ocr_batch, "wmf_to_png", lambda data: None)
    sent: list[bytes] = []

    def hook(img: bytes, page: int) -> list[dict]:
        sent.append(img)
        return [{"bbox": None, "text": "읽음"}]

    ocr_batch.begin()
    block = Block(FIGURE, 3, text=None)
    warnings: list[str] = []
    ocr_batch.schedule(block, _first_wmf(), warnings)
    ocr_batch.run(hook)

    assert sent == [], "변환 실패한 벡터가 훅으로 갔다"
    assert block.text is None
    assert len(warnings) == 1 and "WMF" in warnings[0] and "4쪽" in warnings[0]
