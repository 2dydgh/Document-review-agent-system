"""비교 결과 화면 — 요건 하나 보고, 하위 근거 보고, 버튼 하나.

예전 화면은 띠가 넷(뒤로가기·상태바·묻기·툴바)이고 오른쪽은 안내문이 내용보다
컸으며, 정작 산출물인 판정 버튼은 스크롤 밖이었다(2026-09-08 스크린샷 실측).
다시 짠 규칙:
  · 상단은 한 줄. 남은 판정·누락·근거 없음·지난 회차·내보내기.
  · 목록은 점(상태) + ID + 제목. 라벨 글자 없음. 점 범례가 머리에 있다.
  · 오른쪽은 상위·하위 서술 두 장. 원문은 새 창(openDocWindow).
  · 누락 행의 하위 카드: AI 가 찾은 문장(라벨은 안 바꾼다) · 비슷한 곳 · 다시 찾기.
  · 판정 독은 아래 고정 — 1 2 3 키.
"""
from __future__ import annotations

from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
VIEWS = (_ROOT / "web" / "views.js").read_text(encoding="utf-8")
APP = (_ROOT / "web" / "app.js").read_text(encoding="utf-8")
CSS = (_ROOT / "web" / "index.html").read_text(encoding="utf-8")


def _compare_results() -> str:
    body = VIEWS[VIEWS.index("  function compareResults(v) {"):]
    return body[:body.index("  // 검토 기준 3층.")]


def test_상단은_한_줄이고_판정_독은_아래_고정이다() -> None:
    body = _compare_results()
    assert 'class="results-head cmp-strip"' in body
    assert "cmp-statusbar" not in body and "rtm-toolbar" not in body, "띠가 다시 늘었다"
    assert '<footer class="trace-dock">' in body
    for w in ("만족함", "수정필요", "해당사항없음"):
        assert w in body
    assert "<kbd>" in body, "1 2 3 키 표시가 없다"
    assert ".trace-dock {" in CSS


def test_목록은_점과_ID_와_제목뿐이고_범례가_있다() -> None:
    body = _compare_results()
    assert 'class="tq-dot tq-dot-' in body
    assert 'class="tq-legend"' in body
    # 예전의 "하위 연결 없음 · 미판정" 같은 글자 라벨은 없다.
    assert "하위 연결 없음" not in body and '"미판정"' not in body


def test_원문은_새_창으로_열고_행을_옮기면_따라간다() -> None:
    body = _compare_results()
    assert 'data-act="openDocWindow"' in body
    assert 'data-act="openCompareDoc"' not in body, "제자리 뷰어로 되돌아갔다"
    assert "openDocWindow: function" in APP
    assert 'window.open(' in APP and '"docsuree-doc-" + side' in APP
    assert 'postMessage({ type: "docsuree-focus"' in APP
    # 새 창 쪽은 사이드바·헤더 없이 뷰어만.
    assert "state.popup" in VIEWS and 'qs.get("doc")' in APP


def test_누락_행은_AI_가_찾은_문장을_보여주되_라벨은_안_바꾼다() -> None:
    body = _compare_results()
    assert "rtmSearches" in body
    assert "AI 가 찾은 자리" in body and "AI 가 다른 말로도 찾아봤다" in body
    assert 'class="ai-block' in body
    # 판정 결과가 상태 알약이나 점을 바꾸지 않는다 — 점은 status 로만 정한다.
    assert 'function dotOf(r)' in body and "searches" not in body[body.index("function dotOf"):body.index("function queueHtml")]
    assert 'data-act="searchMissing"' in body and "searchMissing: function" in APP
    assert 'data-hint=' in body


def test_후보는_짧은_문장으로_형광펜을_얹는다() -> None:
    """절 통째로 인용하면 PDF 에서 못 찾아 쪽만 갔다 — 형광펜이 없으니 뭘
    말하는지 몰랐다(2026-09-08 피드백)."""
    at = APP.index('findings.push({ id: "pr" + i + "-" + pi')
    around = APP[at - 900:at]
    assert "slice(0, 160)" in around and "strict_page = true" in around
    assert "shared.filter" in around, "겹친 말이 든 칸을 골라 칠해야 한다"


def test_작업대_갱신과_키보드는_그대로다() -> None:
    body = _compare_results()
    assert 'id="traceWorkbench"' in body and 'class="trace-queue-list"' in body
    assert 'data-scroll="traceDetail"' in body
    assert "repaintCompareTrace" in APP
    assert '"1": "만족함", "2": "수정필요", "3": "해당사항없음"' in APP


def test_단축키는_생성된_뷰_객체를_본다() -> None:
    """window.DR.views 는 공장 함수라 _rtmKeys 가 없다. 거기서 찾으면 늘 빈 목록이라
    1·2·3 이 조용히 안 먹는다 — 처음 넣은 날부터 그랬다(2026-09-08 발견)."""
    assert "window.DR.views._rtmKeys" not in APP and "window.DR.views._rtmVkey" not in APP
    assert "_views._rtmKeys()" in APP and "_views._rtmVkey" in APP
