"""Small icon backplates share a circle, without rounding text controls."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CSS = (ROOT / "web/index.html").read_text(encoding="utf-8")


def test_small_icon_backplates_are_circular():
    for selector in (".qs-icon", ".qs-arrow", ".home-empty-icon", ".record-kind-icon",
                     ".mi-ico", ".rail-ico", ".progress-status-mark"):
        block = re.search(r"^\s*" + re.escape(selector) + r"\s*\{([^}]+)\}", CSS, re.M)
        assert block, selector
        assert "border-radius: 50%" in block[1], selector


def test_text_controls_and_cards_keep_their_existing_shape():
    for selector in (".btn", ".btn-sm", ".progress-workspace"):
        block = re.search(r"^\s*" + re.escape(selector) + r"\s*\{([^}]+)\}", CSS, re.M)
        assert block, selector
        assert "border-radius: 50%" not in block[1], selector
    glyph = re.search(r"\.home-recent-glyph\s*\{([^}]+)\}", CSS)
    assert "background" not in glyph[1], "Do not add a new background to document artwork"
