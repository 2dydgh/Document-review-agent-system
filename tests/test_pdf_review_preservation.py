"""PDF inferred headings/captions reach both review modes, not just raw output."""
from types import SimpleNamespace

import fitz

from app.parser_bridge import to_rawdoc
from modules.agent_quality import ChunkCriteriaChecker, WholeDocCriteriaChecker
from modules.doc_parser import chunk, normalize
from modules.doc_parser.model import HEADING, PARAGRAPH, Block, DocumentModel
from modules.shared import Context, ReviewConfig


def test_pdf_inferred_headings_survive_bridge_normalize_and_actual_checker_prompts():
    model = DocumentModel("input.pdf", {"pages": 2}, [
        Block(HEADING, 0, text="문서의 본문인데 제목으로 분류된 문장", level=2),
        Block(HEADING, 0, text="< 표 구성 코드 종류 >", level=1),
        Block(PARAGRAPH, 0, text="실제 본문"),
        Block(HEADING, 1, text="< 위험도 예측 기능 화면 구성 >", level=1),
    ])
    raw = to_rawdoc(model, "pdf", "input.pdf")
    doc = normalize(raw)
    chunks = chunk(doc)
    expected = [b.text for b in model.blocks]
    assert all(any(text in c.text for c in chunks) for text in expected)
    assert [s.anchor.page for s in doc.iter_sections()] == [1, 1, 2]

    class Capture:
        def __init__(self):
            self.prompts = []

        def complete(self, prompt):
            self.prompts.append(prompt)
            return SimpleNamespace(text='{"results": [{"no":"test", "verdict":"미판정"}]}')

    criterion = SimpleNamespace(no="test", text="입력 보존 확인", note="")
    for checker in (ChunkCriteriaChecker([criterion]), WholeDocCriteriaChecker([criterion])):
        client = Capture()
        checker.check(doc, Context(ReviewConfig(doc_type=""), client, chunks))
        assert all(any(text in prompt for prompt in client.prompts) for text in expected)


def test_pdf_boundary_word_survives_parser_review_input_and_source_location(tmp_path, monkeypatch):
    from modules.doc_parser import pdf_backend
    from modules.doc_parser.router import parse_document
    from modules.report.annotate_pdf import locate

    source = tmp_path / "boundary.pdf"
    good = "[Rev.04] Satisfied: same evaluation results as Rev.00."
    bad = good.replace("results as", "results")
    with fitz.open() as pdf:
        page = pdf.new_page()
        page.insert_text((72, 100), "[Rev.04] Satisfied: same evaluation results as ")
        page.insert_text((72, 114), "Rev.00. ")
        word = next(w for w in page.get_text("words") if w[4] == "as")
        edge = (word[0] + word[2]) / 2 - 0.1
        height = page.rect.height
        pdf.save(source)
    # Replay a layout engine's slightly cropped text box, without invoking a model.
    struct = {"tables": [{"page": 0, "rows": 1, "cols": 1, "cells": [[good]],
                          "cell_bbox": [[[65, 80, edge, 120]]],
                          "bbox": [60, height-80, edge+15, height-125]}]}
    monkeypatch.setattr(pdf_backend, "DOCLING_HOOK", lambda _: struct)
    monkeypatch.setattr(pdf_backend, "OCR_HOOK", None)
    model = parse_document(source, ocr=False)
    raw = to_rawdoc(model, "pdf", str(source))
    assert good in raw.text
    assert bad not in raw.text
    doc = normalize(raw)
    chunks = chunk(doc)

    class Capture:
        def __init__(self):
            self.prompts = []

        def complete(self, prompt):
            self.prompts.append(prompt)
            return SimpleNamespace(text='{"results": [{"no":"test", "verdict":"통과"}]}')

    criterion = SimpleNamespace(no="test", text="입력 보존 확인", note="")
    for checker in (ChunkCriteriaChecker([criterion]), WholeDocCriteriaChecker([criterion])):
        client = Capture()
        checker.check(doc, Context(ReviewConfig(doc_type=""), client, chunks))
        assert any(good in prompt for prompt in client.prompts)
        assert all(bad not in prompt for prompt in client.prompts)
    # Unique original text is locatable without fuzzy matching or a guessed page.
    found = locate(source.read_bytes(), [{"id": "source", "evidence": [{"quote": good}]}])
    assert not found["unlocated"]
    assert found["items"][0]["marks"][0]["page"] == 1
