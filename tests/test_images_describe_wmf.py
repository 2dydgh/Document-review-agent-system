"""그림 해석이 벡터(WMF) 그림을 픽셀로 바꿔 보내는가 (`images._rasterize`).

실측(AX품질팀 상세설계서): 그림 26장 중 18장이 WMF 였고 `image/wmf` 로 그대로 보내
전부 실패했다 — "그림 18/26장을 읽지 않았습니다". 파서(ocr_batch)는 같은 이유로 이미
변환하지만 이 경로는 legacy meta["images"] 의 바이트를 따로 읽으므로 여기서도 바꿔야
한다. 못 바꾸면 벡터를 보내지 말고 오류로 남긴다.
"""
from __future__ import annotations

import base64
import zipfile
from dataclasses import dataclass, field

import pytest

from app import images as images_mod
from app.images import describe_images
from modules.doc_parser import RawDoc
from modules.llm_client import Response

_WMF = b"\x01\x00\x09\x00" + b"\x00" * 40      # standard WMF 머리 + 껍데기
_PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 8


@dataclass
class _RecordingVLM:
    """보낸 image_url 의 mime 을 기록한다."""
    mimes: list[str] = field(default_factory=list)

    def chat(self, messages, **opts):
        for part in messages[0]["content"]:
            if part.get("type") == "image_url":
                self.mimes.append(part["image_url"]["url"].split(";", 1)[0])
        return Response(text="순서도. 시작 → DB 쿼리 → 종료", error=None)


@pytest.fixture
def doc(tmp_path):
    p = tmp_path / "d.hwpx"
    with zipfile.ZipFile(p, "w") as z:
        z.writestr("BinData/image1.wmf", _WMF)
        z.writestr("BinData/image2.png", _PNG)
    return RawDoc(source_path=str(p), text="[그림 1]\n[그림 2]", meta={
        "format": "hwpx", "images": [
            {"no": 1, "name": "그림 1", "alt": "", "part": "BinData/image1.wmf"},
            {"no": 2, "name": "그림 2", "alt": "", "part": "BinData/image2.png"},
        ]})


def test_WMF_는_PNG_로_바꿔_보내고_PNG_는_그대로_보낸다(doc, monkeypatch):
    monkeypatch.setattr(images_mod, "wmf_to_png", lambda data: _PNG + b"converted")
    vlm = _RecordingVLM()

    out = describe_images(doc, vlm)

    assert vlm.mimes == ["data:image/png", "data:image/png"]
    assert out.meta["images_read"] == 2
    assert "[그림 1: 순서도. 시작 → DB 쿼리 → 종료]" in out.text


def test_변환에_실패하면_벡터를_보내지_않고_오류로_남긴다(doc, monkeypatch):
    monkeypatch.setattr(images_mod, "wmf_to_png", lambda data: None)
    vlm = _RecordingVLM()

    out = describe_images(doc, vlm)

    assert vlm.mimes == ["data:image/png"]           # PNG 한 장만 갔다
    assert out.meta["images_read"] == 1
    first = out.meta["images"][0]
    assert first["description"] == "" and "WMF" in (first["error"] or "")
    assert "[그림 1]" in out.text                     # 자리표시는 그대로


def test_mime_판별은_확장자가_아니라_바이트다(monkeypatch):
    """part 이름이 .png 여도 바이트가 WMF 면 변환한다 — 백엔드마다 이름이 다르게 온다."""
    called = []
    monkeypatch.setattr(images_mod, "wmf_to_png", lambda data: called.append(1) or _PNG)

    mime, data = images_mod._rasterize("BinData/whatever.png", _WMF)

    assert called and mime == "image/png" and data == _PNG
    assert base64.b64encode(data)                     # 인코딩 가능한 바이트
