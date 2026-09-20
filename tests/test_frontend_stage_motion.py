"""검토 진행 화면의 단계 전환 연출이 1회로 남는지 지키는 회귀 테스트.

빌드도 JS 러너도 없는 바닐라 SPA라 소스 수준에서 막는다.

여기서 지키는 계약은 하나다 — **연출은 상태가 바뀌는 순간에만 한 번 일어난다.**
진행 화면은 최대 5분 동안 폴링마다 다시 그려지므로, 등장 연출을 노드 생성에
걸어 두면 1회 연출이 초당 반복이 된다(업무 화면의 상시 반복 금지, index.html).

재생 방지는 `laneInner(lane, fresh)` 의 두 번째 인자가 진다:

    app.js updateLanesInPlace → laneInner(lane, true)   상태 전환 → 연출 O
    views.js laneMosaic       → laneInner(lane, false)  전체 렌더 → 연출 X

이 인자를 안 받게 되돌리면(예전 `function laneInner(lane)`) 연출이 조용히
사라지거나 매 폴링마다 다시 재생된다. 둘 다 눈으로는 늦게 발견된다.
"""
from __future__ import annotations

from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
INDEX_HTML = (_ROOT / "web" / "index.html").read_text(encoding="utf-8")
VIEWS_JS = (_ROOT / "web" / "views.js").read_text(encoding="utf-8")
APP_JS = (_ROOT / "web" / "app.js").read_text(encoding="utf-8")


def _lane_inner_body() -> str:
    """laneInner 함수 본문."""
    body = VIEWS_JS.split("function laneInner(", 1)[1]
    return body.split("function laneMosaic", 1)[0]


def test_lane_inner_takes_fresh_flag():
    """연출을 켜고 끄는 인자를 실제로 받아야 한다 — app.js 는 이미 넘기고 있었다."""
    assert "function laneInner(lane, fresh)" in VIEWS_JS, "fresh 인자가 사라졌다"
    assert "laneInner(lane, true)" in APP_JS, "부분 갱신이 fresh 를 안 넘긴다"


def test_full_render_path_does_not_animate():
    """전체 렌더(laneMosaic)는 연출 없이 그린다 — 폴링 재생을 막는 쪽."""
    mosaic = VIEWS_JS.split("function laneMosaic", 1)[1].split("\n  }", 1)[0]
    assert "laneInner(lane, false)" in mosaic, "전체 렌더가 연출을 켠 채로 그린다"


def test_motion_classes_are_gated_by_fresh():
    """연출 클래스는 fresh 일 때만 붙는다."""
    body = _lane_inner_body()
    assert 'var freshMark = fresh ? " is-fresh" : "";' in body
    assert "review-lane-check' + freshMark" in body
    assert 'fresh && lane.status === "run" ? " is-opening" : ""' in body, (
        "다음 단계 열림 연출이 fresh 게이트를 벗어났다"
    )


def test_compare_timeline_uses_the_same_draw():
    """비교·케이스 검토의 단계 목록도 같은 체크를 쓴다.

    두 화면의 단계 목록은 같은 `.progress-stage-row` 마크업이라, 한쪽만 체크가
    툭 나타나면 어긋나 보인다. 재생 방지는 `justDone` 이 진다 — renderVals 가
    `st.stageIndex !== prev.stage` 일 때만 세우고 다음 렌더엔 -1 이다.
    """
    item = VIEWS_JS.split("function timelineItem(", 1)[1].split("\n  }", 1)[0]
    assert 's.justDone ? " is-fresh" : ""' in item, "justDone 을 안 쓴다"
    # 값을 만드는 쪽이 살아 있어야 한다. 이 두 줄이 사라지면 연출이 조용히 죽는다.
    assert "doneStage: st.stageIndex !== prev.stage ? st.stageIndex - 1 : -1" in VIEWS_JS
    assert "cdoneStage: st.cstageIndex !== prev.cstage ? st.cstageIndex - 1 : -1" in VIEWS_JS
    assert "justDone: done && i === justDone" in VIEWS_JS


def test_checklist_evaluate_screen_also_draws():
    """체크리스트 검토 화면도 같은 체크를 쓴다.

    이 화면은 단계가 인덱스가 아니라 키별 상태(`stage[key] === "done"`)라
    doneStage 를 못 쓴다. 지난 렌더의 완료 집합과 비교해 justDone 을 세운다.
    집합을 매 렌더 갱신하지 않으면 폴링마다 체크가 다시 그어진다.
    """
    body = VIEWS_JS.split("function evalPipeline(", 1)[1].split("\n  }", 1)[0]
    assert "justDone: done && seen && !prevEvalDone[s[0]]" in body, "justDone 을 안 세운다"
    assert "prevEvalRun = runKey;" in body, "같은 검토를 전에 그렸는지 기억하지 않는다"
    assert "prevEvalDone = nowDone;" in body, "완료 집합을 갱신하지 않아 매번 재생된다"
    assert "if (done) nowDone[s[0]] = true;" in body


def test_all_three_screens_open_the_next_stage():
    """③ 다음 단계 열림도 세 화면이 같이 쓴다.

    앞 단계가 방금 닫혔을 때만 선다 — 그냥 `active` 에 걸면 진행 중인 단계가
    폴링마다 다시 올라온다(최대 5분이면 수백 번).
    """
    item = VIEWS_JS.split("function timelineItem(", 1)[1].split("\n  }", 1)[0]
    assert 's.justOpened ? " is-opening" : ""' in item
    # ② 도 같은 게이트를 탄다 — done 인 동안 내내가 아니라 닫히는 그 렌더에만.
    assert 's.justDone ? " is-settling" : ""' in item

    # 인덱스형(단일·비교·케이스)과 키형(체크리스트) 둘 다 값을 세운다.
    assert "justOpened: active && justDone >= 0" in VIEWS_JS
    ev = VIEWS_JS.split("function evalPipeline(", 1)[1].split("\n  }", 1)[0]
    assert "r.justDone" in ev and "r.justOpened = true" in ev
    assert "r.active" in ev, "진행 중인 단계에만 걸어야 한다"


def test_css_rules_exist_for_all_three():
    """CSS 가 있어야 클래스가 일을 한다. 셋 다 건다."""
    # 마커 쪽에 걸어야 레인(review-lane-check)과 timelineItem 둘 다 걸린다.
    assert ".progress-stage-marker.is-fresh svg polyline" in INDEX_HTML, "① 체크 그리기"
    assert '.progress-stage-row[data-lane-status="finishing"]' in INDEX_HTML, "② 단일 검토"
    assert ".progress-stage-row.is-settling" in INDEX_HTML, "② 비교·체크리스트"
    assert "@keyframes stageSettle" in INDEX_HTML
    assert ".progress-stage-copy.is-opening" in INDEX_HTML, "③ 다음 단계 열림"
    assert "@keyframes laneCheckDraw" in INDEX_HTML


def test_check_draws_from_the_short_arm():
    """음수 dashoffset 이어야 체크를 긋는 방향이 된다.

    polyline 은 "20 6 9 17 4 12" — 긴 팔에서 짧은 팔로 적혀 있다. 양수 offset 은
    적힌 순서대로 드러나 긴 팔부터 그어지고, 체크가 아니라 사선으로 읽힌다.
    """
    rule = INDEX_HTML.split(".progress-stage-marker.is-fresh svg polyline", 1)[1].split("}", 1)[0]
    assert "stroke-dashoffset: -24" in rule, "양수 offset 은 반대 방향으로 그린다"
    assert "stroke-dasharray: 24" in rule


def test_reduced_motion_still_covered_globally():
    """전역 @media 가 duration 을 누르므로 개별 예외를 두지 않는다.

    여기 예외가 생기면(!important 로 되살리는 등) 움직임 줄이기가 뚫린다.
    """
    block = INDEX_HTML.split("@media (prefers-reduced-motion: reduce)", 1)[1].split("\n    }", 1)[0]
    assert "animation-duration: .01ms !important" in block
    for cls in ("laneCheckDraw", "is-opening", "is-fresh"):
        assert cls not in block, f"{cls} 가 움직임 줄이기에서 예외로 빠져 있다"
