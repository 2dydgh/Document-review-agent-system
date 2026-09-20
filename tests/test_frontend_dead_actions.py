"""화면의 버튼에는 전부 핸들러가 있어야 한다.

바닐라 SPA 라 `data-act="X"` 와 `actions.X` 가 문자열로만 이어져 있다. 이름을
바꾸거나 만들다 만 버튼은 **눌러도 아무 일이 안 나는데 화면은 멀쩡해 보인다** —
실측(2026-09-01): 기준 라이브러리의 "직접 작성" 카드가 그렇게 오래 놓여 있었다.
사용자는 기능이 있다고 믿고 눌렀다.
"""
from __future__ import annotations

import re
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
APP_JS = (_ROOT / "web" / "app.js").read_text(encoding="utf-8")
VIEWS_JS = (_ROOT / "web" / "views.js").read_text(encoding="utf-8")

#: 화면이 직접 처리하는 이름(액션 객체에 없어도 되는 것). 늘리기 전에
#: 정말 다른 곳에서 처리하는지 확인할 것 — 여기 적는 순간 위 검사가 꺼진다.
_HANDLED_ELSEWHERE: frozenset[str] = frozenset()


def _declared_actions() -> set[str]:
    """app.js 의 actions 객체에 정의된 이름들."""
    return set(re.findall(r"^\s{4}([A-Za-z][A-Za-z0-9_]*): function", APP_JS, re.M))


def _used_actions() -> set[str]:
    """views.js 가 data-act 로 부르는 이름들. 문자열 결합은 못 읽으므로 상수만."""
    return set(re.findall(r'data-act="([A-Za-z][A-Za-z0-9_]*)"', VIEWS_JS))


def test_every_button_has_a_handler():
    missing = sorted(_used_actions() - _declared_actions() - _HANDLED_ELSEWHERE)
    assert not missing, f"눌러도 아무 일이 안 나는 버튼이 있다: {missing}"


def test_write_checklist_is_wired():
    """이 검사를 만들게 한 그 버튼. 카드가 있으면 핸들러도 있어야 한다."""
    assert 'data-act="writeChecklist"' in VIEWS_JS
    assert "writeChecklist: function" in APP_JS
