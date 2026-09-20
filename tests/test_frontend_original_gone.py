"""보관 한도로 사라진 원본에는 "다시 불러오기"를 달지 않는다.

몇 번을 눌러도 404 다. 버튼이 있으면 "고칠 수 있는 오류"로 읽힌다 — 실제로는
원문이 서버에서 사라진 것이고 되돌릴 수 없다.

app.js 쪽 동작(404·503 둘 다 말하되 404 만 originalGone)은
`web/tests/ux_reliability.test.js` 가 진다. 여기서는 그 플래그가 화면에서
실제로 쓰이는지만 본다 — 바닐라 SPA 라 소스 수준에서 막는다.
"""
from __future__ import annotations

from pathlib import Path

VIEWS_JS = (Path(__file__).resolve().parents[1] / "web" / "views.js").read_text(
    encoding="utf-8")


def test_없어진_원본에는_다시_불러오기를_권하지_않는다():
    start = VIEWS_JS.index("if (v.originalError) viewerHead +=")
    banner = VIEWS_JS[start:VIEWS_JS.index("var docViewer =", start)]
    assert "retryOriginal" in banner, "통신 실패에는 재시도가 있어야 한다"
    assert "v.originalGone ? ''" in banner, (
        f"없어진 원본에도 재시도 버튼을 단다:\n{banner}")
