"""그림 읽는 동안 화면이 멈춘 것처럼 보이지 않게 지키는 회귀 테스트.

프론트엔드는 빌드도 JS 테스트 러너도 없는 바닐라 SPA라, 소스 수준에서 막는다.

진행 이벤트 계약이 이렇다(src/app/orchestrator.py · web/api.js):

    key="review"  이면  plan → step 으로 격자를 채운다
    그 밖의 key   이면  done 일 때만 결과로 접어 보여준다

그림 해석은 `key="ingestion"` 으로 `status="running"` 을 보낸다. 한 장에 2~3초라
(실측 1.8~3.4초) 그림이 여럿이면 준비 단계가 수십 초 걸리는데, done 만 보던 옛
코드에서는 그 동안 준비 문구에서 멈춘 것처럼 보였다.
"""
from __future__ import annotations

import re
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
API_JS = (_ROOT / "web" / "api.js").read_text(encoding="utf-8")
VIEWS_JS = (_ROOT / "web" / "views.js").read_text(encoding="utf-8")
IMAGES_PY = (_ROOT / "src" / "app" / "images.py").read_text(encoding="utf-8")


def test_engine_sends_running_progress_while_reading_images():
    """보내는 쪽이 먼저 있어야 화면이 받을 것이 있다."""
    assert '"status": "running"' in IMAGES_PY
    assert '"key": "ingestion"' in IMAGES_PY
    assert "읽는 중" in IMAGES_PY


def test_api_js_shows_running_detail_of_non_review_stages():
    """준비 단계의 running detail 을 버리지 않는다.

    옛 코드는 `if (ev.status === "done")` 만 있어 running 이 조용히 사라졌다.
    """
    # ev.key !== "review" 분기 안에 done 아닌 경우의 처리가 있어야 한다.
    branch = API_JS.split('if (ev.key !== "review") {', 1)[1].split("} else if (ev.plan)", 1)[0]
    assert "ev.status === \"done\"" in branch
    assert "else if (ev.detail)" in branch, "running detail 을 받는 분기가 없다"
    assert "r.note = ev.detail" in branch, "진행 문장을 note 로 흘려야 화면에 뜬다"
    assert "partial = true" in branch, "부분 갱신이어야 '검토 취소' 버튼이 깜빡이지 않는다"


def test_views_js_renders_the_note_before_lanes_exist():
    """레인이 생기기 전(준비 단계)에도 note 가 보여야 한다.

    이게 없으면 api.js 가 note 를 채워도 화면에 나타나지 않는다.
    """
    assert re.search(r"var note = !lanes\s*\?", VIEWS_JS), \
        "레인이 없을 때의 note 렌더가 사라졌다"
    # 준비 중인 일과, 준비 뒤 나타날 내용을 각각 말한다.
    assert "파일을 열어 페이지·표·문단 구조를 정리하고 있습니다" in VIEWS_JS
    assert "문서 준비가 끝나면 실제 검사 단계와 작업량이 여기에 표시됩니다" in VIEWS_JS


def test_상단은_숫자만_남기고_중복_진행바를_두지_않는다():
    """상단 전체 바와 아래 단계 바가 함께 움직이면 기준이 두 개처럼 보인다."""
    body = VIEWS_JS[VIEWS_JS.index("function singleProgress("):]
    body = body[:body.index("\n  }")]
    head = VIEWS_JS[VIEWS_JS.index("function progressHead("):]
    head = head[:head.index("\n  }")]

    assert 'pctId: "pg-pct"' in body and 'elapsedId: "pg-elapsed"' in body, \
        "공통 상태 머리말에서 퍼센트·경과 갱신 자리가 빠졌다"
    assert "progress-overall" not in head, "상단 전체 진행 바가 다시 생겼다"
    assert "fillId" not in head and "pg-overall-fill" not in body
    # 취소 단추만 완료 상태에서 빠지고 퍼센트와 경과 시간은 같은 자리에 남는다.
    assert "!done && opts.cancelAction" in head, "끝나도 취소 단추가 남는다"
    assert 'cancelAction: "cancelReview"' in body


def test_문서_읽기에는_가짜_진행률을_쓰지_않는다():
    """읽기 총량을 모르는 초반에 35% 같은 값을 보이면 실제 측정값으로 오해한다."""
    body = VIEWS_JS[VIEWS_JS.index("function singleProgress("):]
    body = body[:body.index("\n  }")]
    assert "scaleX(.35)" not in body
    assert "문서를 읽고 있습니다" in VIEWS_JS
    assert "아직 기준 검사는 시작되지 않았습니다" in VIEWS_JS
    assert "검토 항목을 준비하고 있습니다" in VIEWS_JS


def test_끝난_화면을_읽을_시간을_준다():
    """800ms 는 "검토 완료" 를 읽기 전에 결과 화면으로 넘어가 버렸다."""
    api = (_ROOT / "web" / "api.js").read_text(encoding="utf-8")
    hold = re.search(r"DONE_HOLD_MS = (\d+)", api)
    assert hold, "완료 화면을 붙잡는 시간이 없다"
    assert int(hold.group(1)) >= 1200, f"너무 짧다: {hold.group(1)}ms"


def test_완료_머리말은_한_번만_등장한다():
    """이력 응답과 완료 타이머가 같은 등장 애니메이션을 거듭 시작하면 안 된다."""
    hold = API_JS[API_JS.index("function holdDone("):]
    hold = hold[:hold.index("\n  function errMessage")]
    reveal = hold[hold.index("function revealDone()") :]
    assert "markDone();" not in hold[:hold.index("function revealDone()")], \
        "완료 공개 전에 상태를 바꿔 다른 render가 먼저 완료 화면을 그린다"
    assert reveal.index("markDone();") < reveal.index("render();"), \
        "최종 render 한 번에서 완료 상태를 공개하지 않는다"
    assert "loadHistory(true)" in API_JS, \
        "백그라운드 이력 동기화가 완료 애니메이션을 다시 시작한다"


def test_마지막_진행바는_끝까지_찬_뒤_완료로_바뀐다():
    """run 노드를 바로 교체하면 마지막 몇 %의 transform 전환이 잘려 점프한다."""
    app = (_ROOT / "web" / "app.js").read_text(encoding="utf-8")
    update = app[app.index("function updateLanesInPlace"):]
    update = update[:update.index("\n  }")]
    assert 'before === "run" && m.status === "done"' in update
    assert 'setAttribute("data-lane-status", "finishing")' in update
    assert 'lastFill.style.transform = "scaleX(1)"' in update
    assert 'reduceMotion() ? 0 : 250' in update
    # 진행량 전환과 기존 전체 완료 표시가 끝날 여유를 유지한다.
    settle = re.search(r"function \(\) \{ if \(state\.screen.*?\},\s*.*?(\d+)\);", API_JS, re.S)
    assert settle and int(settle.group(1)) >= 700


def test_진행_화면에_떠다니는_배경_장식이_없다():
    """검토는 최대 5분이고, 그동안 사용자는 이 화면을 본다.

    예전엔 600·500px 짜리 흐린 원(floatOrb1/2)이 15초·12초 주기로 떠다녔다.
    3초 스치는 로그인 화면과 달리 여기서는 5분을 본다 — 느린 전면 반복은
    설정으로 줄일 게 아니라 애초에 없어야 한다.

    가로 스크롤을 막던 `overflow-x:hidden` 도 같이 없앴다. 오른쪽으로
    삐져나가 스크롤을 만들던 것이 바로 그 원들이었기 때문이다 — 원인이 사라진
    가드를 남겨 두면 진짜 넘침이 생겼을 때 조용히 잘려 안 보인다.
    """
    frame = VIEWS_JS[VIEWS_JS.index("function progressFrame("):]
    frame = frame[:frame.index("function laneMetrics(")]
    assert "floatOrb" not in frame
    assert 'class="page-shell page-shell-primary page-shell-progress"' in frame
    assert 'class="progress-workspace"' in frame
    assert "backdrop-filter" not in frame
    for key in ("progress", "cmp-progress", "case-progress"):
        assert f'scroll: "{key}"' in VIEWS_JS, f"{key} 가 공용 진행 프레임을 안 쓴다"


def test_네_검토_진행_화면은_상태_문법을_공유하고_장식_모션은_없다():
    css = (_ROOT / "web" / "index.html").read_text(encoding="utf-8")
    # 단일·비교·체크리스트·폴더 넷이 같은 틀을 쓴다.
    assert VIEWS_JS.count("return progressFrame({") == 4
    for token in ("progress-summary", "progress-grid", "progress-stage-row",
                  "progress-settings"):
        assert f".{token} {{" in css
    for old in ("review-hourglass", "review-document-scan", "cmp-scene", "cmp-beam"):
        assert old not in VIEWS_JS and old not in css, f"장식 모션 {old}가 남아 있다"
    active = css[css.index('.progress-stage-track {'):css.index('@media (max-width: 900px)')]
    assert "transition: transform 250ms var(--ease-out)" in active
    assert "shimmer" not in active and "infinite" not in active
    assert "var(--accent) 65%, var(--panel)" in active
    assert "reviewLaneComplete" not in css and "reviewLaneCheck" not in css


def test_진행과_완료_상태_아이콘은_같은_원형_배경을_쓴다():
    css = (_ROOT / "web" / "index.html").read_text(encoding="utf-8")
    mark = css.split(".progress-status-mark {", 1)[1].split("}", 1)[0]
    assert "width: 40px; height: 40px;" in mark
    assert "border-radius: 50%;" in mark
    assert "background: var(--accent-weak);" in mark
    for state in ("is-loading", "is-done"):
        rule = css.split(f".progress-status-mark.{state} {{", 1)[1].split("}", 1)[0]
        assert "border-radius" not in rule
    assert "animation: hourglassTurn 2.8s ease-in-out infinite" in css


def test_검토_진행_바는_구분선과_구별되는_두께를_쓴다():
    css = (_ROOT / "web" / "index.html").read_text(encoding="utf-8")
    track = css.split(".progress-stage-track {", 1)[1].split("}", 1)[0]
    assert "height: 6px;" in track


def test_진행_화면은_내용보다_큰_고정_높이를_강제하지_않는다():
    css = (_ROOT / "web" / "index.html").read_text(encoding="utf-8")
    block = css[css.index(".progress-workspace {"):css.index("@media (max-width: 900px)")]
    assert "min-height: 390px" not in block
    assert "min-height: 216px" not in block
    assert "grid-template-columns: minmax(0, 1fr); order: 3" in block
    assert 'class="progress-settings-disclosure"' in VIEWS_JS
    assert "min-height: 64px" in block
