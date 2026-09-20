"""Font-evidenced PDF symbol decoding shared by extraction and source location."""
from __future__ import annotations


def decode_pdf_symbols(text: str, font_name: str) -> str:
    """Decode the known Wingdings filled-circle glyph, never a normal Latin l.

    Some Hancom PDFs encode that glyph as U+006C rather than U+2022. The
    embedded font name (including optional PDF subset prefix) is required
    evidence. Other symbol fonts and Wingdings 2/3 are deliberately untouched.
    """
    font = font_name.rsplit("+", 1)[-1].lower()
    if font in {"wingdings", "wingdings-regular"}:
        return text.replace("l", "•")
    return text
