"""체크리스트 라이브러리 화면.

바닐라 SPA 라 소스 수준에서 막는다. 여기서 지키는 것은 하나 —
**판정은 검토자 몫이고 화면은 제안만 한다.** 화면이 판정한 것처럼 보이거나,
검토를 못 한 항목이 0건 통과로 보이면 안 된다.
"""
from __future__ import annotations

from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
APP_JS = (_ROOT / "web" / "app.js").read_text(encoding="utf-8")
VIEWS_JS = (_ROOT / "web" / "views.js").read_text(encoding="utf-8")
API_JS = (_ROOT / "web" / "api.js").read_text(encoding="utf-8")


def test_레인_카운터는_kind_가_아니라_label_로_담는다() -> None:
    """kind 는 유일하지 않다 — 표현 점검(조각)과 문서 전체 점검이 둘 다
    kind:"chunk" 로 신고한다(agent_quality/consistency.py 의 plan 둘 다).

    kind 로 담으면 두 레인이 카운터 하나를 덮어쓴다: 진행 중엔 서로의 step 이
    섞이고, 완료 때 `done[kind] = total` 을 레인마다 돌리면 마지막 레인의
    total 이 이겨서 표현 점검 바가 완료 순간 엉뚱한 비율로 되돌아간다
    (2026-08-11 실제로 났다). 열쇠는 label — plan·step 이벤트 모두 label 을
    싣고 있고, 레인마다 유일하다.
    """
    assert "r.done[ev.step.label || ev.step.kind]" in API_JS, \
        "step 카운터를 kind 로 담는다 — 같은 kind 레인이 서로를 덮어쓴다"
    assert "state.rev.done[l.label || l.kind]" in API_JS, \
        "완료 채움을 kind 로 담는다 — 마지막 레인의 total 이 이긴다"
    assert "rv.done[l.label || l.kind]" in VIEWS_JS, \
        "화면이 카운터를 kind 로 읽는다 — 담는 쪽과 열쇠가 어긋난다"


def test_첫_응답_전에도_현재_레인을_검사_중으로_표시한다() -> None:
    """LLM 첫 응답 전 done=0인 시간도 대기가 아니라 실제 실행 중이다."""
    assert 'hasOwnProperty.call(ev, "active")' in API_JS
    assert "r.active = ev.active" in API_JS
    assert "rv.active === key" in VIEWS_JS


def test_진행_화면이_세_검사와_범위를_설명한다() -> None:
    assert "표현은 문서 조각별로, 일관성은 문서 전체를 비교하여 확인합니다" in VIEWS_JS
    assert "lane.description" in VIEWS_JS and "lane.scope" in VIEWS_JS
    assert "규칙 자동 검사" in VIEWS_JS
    assert "문서 전체 점검" in VIEWS_JS


def test_진행_중_기준은_선택기가_아니라_읽기전용_설정이다() -> None:
    panel = VIEWS_JS[VIEWS_JS.index("function criteriaPanel(review)"):
                     VIEWS_JS.index("function reviewCriteriaDialog(review)")]
    assert "이번 검토 설정" in panel
    assert "시작할 때 확정된 읽기 전용 설정" in panel
    assert 'data-act="openReviewCriteria"' in panel
    assert "<select" not in panel
    assert "기준을 바꾸려면 검토를 취소하고 시작 화면에서 변경하세요" in panel


def test_진행_시작과_기준_상세가_같은_기준목록을_쓴다() -> None:
    start = _function_body(APP_JS, "startReview: function ()")
    assert "state.clayers = " in start
    assert "actions.loadCriteriaLayers()" in start
    assert "openReviewCriteria" in APP_JS and "closeReviewCriteria" in APP_JS
    assert "state.rev.criteriaOpen) { actions.closeReviewCriteria()" in APP_JS


def test_완료_문구가_지적과_미검토를_구분한다() -> None:
    assert "수정 사항 없음 · 모든 자동 검사 완료" in VIEWS_JS
    assert "수정 사항 없음 · 일부 기준 미검토" in VIEWS_JS
    assert "issueCount" in VIEWS_JS and "unreviewedCount" in VIEWS_JS


def test_진행화면_js는_캐시버전을_함께_갱신한다() -> None:
    html = (_ROOT / "web" / "index.html").read_text(encoding="utf-8")
    version = "20260918-home55"
    for name in ("api.js", "views.js", "app.js"):
        assert f'{name}?v={version}' in html, f"{name}가 이전 캐시로 로드될 수 있다"


def test_review_progress_updates_partially_so_the_cancel_button_survives() -> None:
    """진행 중 step 이벤트는 수백 번 온다. 매번 전체 render 를 하면 '검토 취소'
    버튼 DOM 이 재생성돼 :hover 가 깜빡인다. step/detail 은 레인·퍼센트·경과만
    부분 갱신(repaintProgress)하고 버튼은 그대로 둬야 한다."""
    # 부분 갱신이 걸릴 id 컨테이너가 진행 화면에 있어야 한다.
    for anchor in ('id="pg-lanes"', 'id="pg-note"', 'pctId: "pg-pct"',
                   'elapsedId: "pg-elapsed"'):
        assert anchor in VIEWS_JS, f"진행 화면에 {anchor} 컨테이너가 없다"
    # 조각 빌더가 노출돼야 app.js가 부분 갱신에 쓸 수 있다.
    assert "progressFragments" in VIEWS_JS
    assert "progressFragments" in APP_JS
    # step 이벤트는 부분 갱신을 먼저 시도해야 한다(전체 render 폴백은 그 다음).
    ore = API_JS.index("function onReviewEvent")
    body = API_JS[ore:API_JS.index("if (ev.event === \"done\")", ore)]
    assert "repaintProgress()" in body, "step 처리에서 부분 갱신을 안 쓴다"
    assert "partial" in body, "부분 갱신/전체 render 분기가 없다"
    # 1초 경과 틱도 전체 render 대신 부분 갱신을 써야 한다(버튼 재생성 방지).
    tick = API_JS[API_JS.index("function tickElapsed"):]
    tick = tick[:tick.index("}")]
    assert "repaintProgress()" in tick


def test_progress_bars_update_in_place_so_the_shimmer_does_not_flicker() -> None:
    """레인 바를 step 마다 통째로 다시 그리면 shimmer(흰빛)가 처음으로 튀고
    width 트랜지션도 안 먹는다. 폭·카운터만 제자리로 고쳐야 한다 —
    그러려면 바·카운터에 갱신용 훅(data-lane-*)이 있어야 한다."""
    for hook in ("data-lane-idx", "data-lane-status", "data-lane-fill", "data-lane-counter"):
        assert hook in VIEWS_JS, f"레인에 {hook} 훅이 없다 — 제자리 갱신을 못 건다"
    # app.js 는 레인을 통째로 다시 그리지 않고 제자리로 고쳐야 한다.
    assert "updateLanesInPlace" in APP_JS
    # 상태(대기/진행/완료)가 바뀌면 색·shimmer 가 달라지니 그때만 통째로 그린다.
    fn = APP_JS[APP_JS.index("function updateLanesInPlace"):]
    fn = fn[:fn.index("\n  }")]
    assert 'getAttribute("data-lane-status")' in fn and "return false" in fn


def test_app_can_register_list_and_delete() -> None:
    assert "api/checklists" in APP_JS
    assert "deleteChecklist" in APP_JS


def test_a_registered_checklist_can_be_opened_to_see_its_items() -> None:
    """이름과 개수만 보이면 무엇이 등록됐는지 확인할 수 없다 — 잘못 적은 항목도
    열어봐야 알아챈다."""
    assert "openChecklist" in APP_JS
    assert "clibDetail" in VIEWS_JS


# --- 체크 흐름 -------------------------------------------------------------


def test_verdicts_use_the_field_vocabulary_on_screen() -> None:
    """RVVR 부록의 말 그대로 써야 산출물을 다시 옮겨 적지 않는다."""
    for word in ("Satisfied", "Modification Required", "Not Satisfied", "N/A"):
        assert word in VIEWS_JS


def test_screen_counts_the_unjudged_items() -> None:
    """101개 중 3개만 보고 저장했는데 다 본 것처럼 보이면 안 된다."""
    assert "unjudged" in VIEWS_JS


def test_checklist_run_does_not_wait_for_the_automatic_review() -> None:
    """자동 검토는 LLM 왕복이라 몇 분 걸린다. 체크리스트는 라이브러리에서 바로
    독립 화면으로 열려 자동 검토와 무관하게 채울 수 있어야 한다."""
    assert "startChecklistRun" in APP_JS
    assert 'mode = "checklistrun"' in APP_JS   # 자동 검토 화면이 아니라 독립 화면


def test_the_reviewer_starts_a_checklist_from_the_library() -> None:
    """수동 체크리스트는 자동 검토 셋업이 아니라 라이브러리에서 독립 화면으로
    연다 — 자동 검토를 거치지 않고 바로 채울 수 있어야 한다."""
    assert "startChecklistRun" in APP_JS
    # 옛 흐름(셋업 화면의 picker)은 제거됐다. 되살아나면 안 된다.
    assert "runChecklistPicker" not in VIEWS_JS
    assert "pickRunChecklist" not in APP_JS


def test_the_two_kinds_of_criteria_are_labelled_apart() -> None:
    """엔진이 쓰는 '검토 기준'(id_pattern 등)과 사람이 채우는 '체크리스트'가
    같은 화면에 있다. 이름이 겹치면 검토자가 무엇을 고르는지 모른다."""
    assert "직접 확인할 체크리스트" in VIEWS_JS


def test_results_can_be_exported_as_csv() -> None:
    assert "/csv" in APP_JS


def test_results_can_be_saved_to_history() -> None:
    """채운 것을 남기지 못하면 화면을 벗어나는 순간 사라진다."""
    assert "saveChecklistRun" in APP_JS
    assert "/run" in APP_JS


# --- 다음 문서로 넘어갈 때 체크리스트 상태 초기화 ----------------------------


def _function_body(src: str, needle: str) -> str:
    """`needle`로 시작하는 함수 정의부터 그 함수를 닫는 '    },' 까지 잘라온다.

    test_frontend_viewer_assets.py::test_picking_a_checklist_repaints_once 와
    같은 방식 — 소스 문자열에서 함수 하나만 슬라이스해 그 안을 검사한다.
    """
    start = src.index(needle)
    return src[start:src.index("\n    },", start)]


def test_new_review_clears_the_previous_documents_checklist_run() -> None:
    """체크리스트 A로 문서1을 40/101 판정하다 문서2로 새 검토를 시작하면,
    state.crun·runChecklistId 를 지우지 않는 한 문서2의 결과 화면에 문서1의
    판정이 그대로(체크리스트 A가 고른 채) 다시 뜬다 — 아무 표시도 없이.

    체크리스트가 독립 화면(checklistrun)으로 분리되며 panelTab(결과 화면 탭
    전환) 자체가 없어졌다 — 그 리셋은 더 이상 대상이 없으므로 여기서 확인하지
    않는다. 대신 별도로 state.panelTab 이 코드베이스 전체에서 사라졌는지를
    확인한다(test_automatic_review_results_no_longer_have_a_checklist_tab)."""
    body = _function_body(APP_JS, "newReview: function (which)")
    assert "state.crun = " in body, (
        "newReview가 state.crun을 지우지 않는다 — 다음 문서 결과 화면에 이전 "
        "문서의 체크리스트 판정이 그대로 다시 뜬다"
    )
    assert "state.runChecklistId = " in body, (
        "newReview가 runChecklistId를 지우지 않는다 — 다음 문서에서도 이전에 "
        "고른 체크리스트가 선택된 채로 남는다"
    )


def test_new_review_reset_lives_alongside_the_other_stale_state_resets() -> None:
    """이 초기화는 newReview 안, viewer·fix·files·selected를 지우는 자리 —
    즉 이 버그를 위해 만든 새 장소가 아니라 기존에 흔적을 지우던 그 자리에
    있어야 한다(체크리스트 화면의 동일 버그를 고친 커밋의 선례를 따른다)."""
    body = _function_body(APP_JS, "newReview: function (which)")
    assert body.index("state.selected = null") < body.index("state.crun = ")
    assert body.index("state.files.single = null") < body.index("state.crun = ")


# --- "이유" 입력 중 렌더로 포커스·한글 조합이 날아가는 것 방지 ---------------


def test_set_reason_still_does_not_rerender() -> None:
    body = _function_body(APP_JS, "setReason: function (idx, text)")
    assert "render()" not in body


def test_render_captures_and_restores_focused_reason_field() -> None:
    """자동 검토의 stage 이벤트(api.js onReviewEvent)는 몇 분간 계속 render()를
    부른다. 체크리스트 "이유" 입력에 포커스가 있는 동안 그 render가 통째로
    건너뛰면, 그 사이 다른 버튼(저장·CSV 내보내기 등)을 눌러도 mousedown이
    먼저 일으키는 blur/focusout이 렌더를 끼워 넣어 클릭 대상 노드를 죽이고
    클릭을 씹어버린다(이전 버전의 확인된 버그). 그래서 render()는 건너뛰지
    않고 그대로 다시 그리되, 포커스된 [data-reason] 입력의 값과 캐럿
    위치(selectionStart/selectionEnd)를 캡처해뒀다가 새 DOM에서 되살려야
    한다."""
    start = APP_JS.index("function render() {")
    body = APP_JS[start:APP_JS.index("\n  function flushReasonRender", start)]
    assert 'getAttribute("data-reason")' in body, (
        "render()가 포커스된 요소가 이유 입력인지 보지 않는다 — 캡처·복원할 "
        "대상을 찾지 못한다"
    )
    assert "selectionStart" in body and "selectionEnd" in body, (
        "render()가 캐럿 위치를 캡처하지 않는다 — 포커스만 되살아나고 커서는 "
        "필드 맨 끝(또는 맨 앞)으로 튄다"
    )
    assert ".focus()" in body, (
        "render()가 새 DOM에서 이유 입력에 포커스를 되살리지 않는다"
    )
    assert "reasonComposing" in body, (
        "render()가 한글 조합 중 여부를 보지 않는다 — 조합 중엔 캡처·복원이 "
        "아니라 건너뛰어야 한다(값이 아직 확정되지 않아 복원할 수 없다)"
    )


def test_composition_events_are_tracked_for_reason_fields() -> None:
    """한글(등 IME) 조합 중엔 render를 건너뛴다 — 조합 중인 글자는 캡처해서
    복원할 방법이 없는 유일한 경우라서다. compositionstart~compositionend 를
    직접 추적해 그 창을 안다."""
    assert "compositionstart" in APP_JS
    assert "compositionend" in APP_JS


def test_a_deferred_render_is_flushed_on_composition_end_or_watchdog_only() -> None:
    """타이핑(조합) 중 미뤄둔 render를 몰아 그리는 시점은 compositionend와
    watchdog 뿐이어야 한다. focusout에서 몰아 그리면(이전 버전의 확인된
    버그) 다른 컨트롤을 누를 때 그 click보다 먼저 발생하는 focusout이
    렌더를 끼워 넣어, 방금 누른 버튼의 DOM 노드가 클릭 델리게이션에 닿기도
    전에 사라진다 — 저장 버튼 등이 조용히 안 눌린다."""
    assert "flushReasonRender" in APP_JS
    assert 'addEventListener("focusout"' not in APP_JS, (
        "focusout 리스너가 되살아났다 — 이 리스너가 몰아서 render를 흘려보내면 "
        "그 focusout을 유발한 클릭(저장·CSV 내보내기 등)이 델리게이션에 닿기 "
        "전에 대상 노드가 사라져 조용히 씹힌다"
    )


def test_composition_start_arms_a_watchdog_that_can_flush_without_composition_end() -> None:
    """일부 브라우저/IME는 compositionend를 아예 안 보내는 known issue가
    있다 — 이를 대비한 watchdog(setTimeout)이 없으면 reasonComposing이
    영원히 true로 남아 render()가 앱 전체에서 사실상 멈춘다(새로고침밖에
    방법이 없다)."""
    start = APP_JS.index('addEventListener("compositionstart"')
    body = APP_JS[start:APP_JS.index('addEventListener("compositionend"', start)]
    assert "setTimeout" in body, (
        "compositionstart 리스너에 watchdog(setTimeout)이 없다 — "
        "compositionend가 안 오는 브라우저에서 앱이 영구히 멈춘다"
    )
    assert "flushReasonRender" in body, (
        "watchdog이 밀린 render를 흘려보내지 않는다"
    )


def test_composition_end_does_not_render_when_focus_already_left() -> None:
    """조합 중에 저장·CSV 버튼을 누르면 브라우저가 blur 전에 조합을 끝내므로
    compositionend 가 mousedown 시점에 온다. 거기서 곧바로 그리면 click 이
    델리게이션에 닿기 전에 원래 노드가 사라져 버튼이 조용히 안 눌린다 —
    focusout 에서 그리던 옛 버그와 같은 것이다. 한글 입력에서는 조합 중이
    기본 상태라 자주 난다.
    """
    start = APP_JS.index("function flushReasonRender()")
    body = APP_JS[start:APP_JS.index("\n  }", start)]
    assert "activeElement" in body, (
        "flushReasonRender 가 포커스가 남아 있는지 보지 않는다 — "
        "blur 로 인한 compositionend 에서도 그려 클릭이 씹힌다")


# --- 결과는 no 가 아니라 배열 위치(index)로 키잉한다 -------------------------
#
# 아래는 브라우저에서 실제로 클릭·입력해 확인하는 테스트가 아니라(이 스위트에
# 브라우저 러너가 없다) 소스 문자열을 살펴 "no 를 결과 키로 쓰는 자리가 다시
# 생기지 않았는지"를 잡는 정적 검사다. no 는 등록 시 선택하지 않으면 전부
# "" 이고, 구간별 재시작이면 겹친다 — 그 경우 항목 하나를 판정하면 같은 no 를
# 가진 나머지 전부가 판정된 것처럼 보인다(이번에 고친 버그).


def test_verdict_button_arg_is_built_from_the_loop_index_not_no() -> None:
    """setVerdict 버튼의 data-arg 는 "v|" + 항목의 위치(i) + "|" + 판정값 이어야
    한다. it.no 를 그대로 이어붙이면 no="" 공유·중복·"|" 포함 세 가지 모두에서
    무너진다."""
    start = VIEWS_JS.index("function checklistRunView(v)")
    body = VIEWS_JS[start:VIEWS_JS.index("\n  }", start)]
    assert 'data-arg="v|\' + esc(it.idx) + \'|' in body, (
        "체크 버튼의 data-arg 가 위치 인덱스(it.idx)가 아니라 다른 값(예: "
        "it.no)으로 만들어진다 — no 가 비어있거나 겹치면 다른 항목까지 함께 "
        "판정된 것처럼 보인다"
    )
    assert 'data-arg="v|\' + esc(it.no)' not in body


def test_reason_input_key_is_built_from_the_loop_index_not_no() -> None:
    """이유 입력의 data-reason 도 마찬가지로 위치 인덱스여야 한다."""
    start = VIEWS_JS.index("function checklistRunView(v)")
    body = VIEWS_JS[start:VIEWS_JS.index("\n  }", start)]
    assert "data-reason=\"' + esc(it.idx) + '\"" in body, (
        "이유 입력의 data-reason 이 위치 인덱스(it.idx)가 아니다 — no 를 쓰면 "
        "no=\"\" 를 공유하는 항목들의 이유가 서로 덮어써진다"
    )
    assert "data-reason=\"' + esc(it.no) + '\"" not in body


def test_crun_view_model_looks_up_results_by_index_not_no() -> None:
    """v.crun.items 를 만드는 자리에서 st.crun.results 를 no 가 아니라
    String(i)(위치 인덱스)로 찾아야 한다."""
    start = VIEWS_JS.index("crun: (function ()")
    body = VIEWS_JS[start:VIEWS_JS.index("})()", start)]
    assert "st.crun.results[String(i)]" in body, (
        "결과 조회가 위치 인덱스가 아니라 다른 키(예: it.no)로 되어 있다 — "
        "no 가 비어있거나 겹치는 체크리스트에서 판정이 뒤섞인다"
    )
    assert "st.crun.results[it.no]" not in body


def test_deferred_render_is_flushed_after_the_click_action_ran() -> None:
    """미뤄둔 렌더는 델리게이션이 액션까지 돌린 뒤에 흘려보내야 한다.
    타이머로 미루면 마우스를 오래 누르고 있을 때 click 보다 먼저 발화해
    같은 버그가 그대로 재발한다."""
    start = APP_JS.index('document.addEventListener("click"')
    body = APP_JS[start:APP_JS.index("\n    });", start)]
    assert "reasonRenderPending" in body, (
        "click 리스너가 미뤄둔 렌더를 흘려보내지 않는다")


# --- 체크리스트를 독립 화면으로: 라이브러리에서 시작·기록에서 이어서 --------
#
# 아래는 실제 클릭·화면전환을 브라우저에서 확인하는 테스트가 아니다(이 스위트에
# 브라우저 러너가 없다). 소스 문자열 검사로 "되돌리면 실패하는" 지점만 잡는다 —
# 포커스 이동·실제 렌더 결과 같은 진짜 동작은 이 테스트들이 증명하지 못한다.


def test_library_can_start_a_standalone_checklist_run() -> None:
    """라이브러리 행에 "검토 시작"이 없으면 등록된 체크리스트를 채우러 갈
    방법이 없다 — 자동 검토를 거치는 옛길밖에 남지 않는다."""
    assert "startChecklistRun" in APP_JS
    assert "검토 시작" in VIEWS_JS


def test_review_can_pick_a_checklist_and_return_from_the_library() -> None:
    """단일 검토에 고를 체크리스트가 없어 라이브러리로 갔을 때, 고르는 액션도
    돌아오는 길도 없으면 왕복이 끊긴다. 라이브러리를 "고르기" 모드로 열어
    (goPickChecklist), 행마다 "이걸로 검토"(useChecklistForReview)로 고르고,
    상단 "검토로 돌아가기"(backToReviewFromChecklist)로 빠져나오게 한다."""
    # 검토 화면의 빈 상태 링크는 관리용 setMode 가 아니라 고르기 진입이어야 한다.
    assert "goPickChecklist" in VIEWS_JS and "goPickChecklist" in APP_JS
    # 고른다(선택 표시) / 돌아간다 는 서로 다른 액션이어야 한다 — 고르자마자
    # 화면이 튀면 순간이동처럼 어색하다. 고르기는 머물고, 돌아가기는 배너로.
    assert "selectChecklistForReview" in VIEWS_JS and "selectChecklistForReview" in APP_JS
    assert "backToReviewFromChecklist" in VIEWS_JS and "backToReviewFromChecklist" in APP_JS
    # 고르기 모드 플래그가 뷰모델까지 흘러야 배너·버튼을 조건부로 그린다.
    assert "checklistPickReturn" in VIEWS_JS and "checklistPickReturn" in APP_JS

    # 고르기(select)는 선택만 표시하고 머문다 — 여기서 화면을 옮기면(single 로)
    # 순간이동이 된다. 그래서 select 본문엔 mode 전환이 없어야 한다.
    sel = APP_JS.index("selectChecklistForReview: function")
    selbody = APP_JS[sel:APP_JS.index("\n    },", sel)]
    assert "state.reviewChecklistId = id" in selbody
    assert 'state.mode = "single"' not in selbody, (
        "고르자마자 검토 화면으로 튄다 — 선택 표시만 하고 머물러야 한다"
    )
    # 돌아가기(배너)만 단일 검토 셋업으로 옮긴다. 이때 고른 것은 그대로 남는다.
    back = APP_JS.index("backToReviewFromChecklist: function")
    backbody = APP_JS[back:APP_JS.index("\n    },", back)]
    assert 'state.mode = "single"' in backbody

    # 옆 네비게이션으로 그냥 들어오면(setMode) 고르기 모드가 꺼져야 한다 —
    # 관리하러 온 것이지 검토에서 온 게 아니다.
    sm = APP_JS.index("setMode: function")
    smbody = APP_JS[sm:APP_JS.index("\n    go: function", sm)]
    assert "state.checklistPickReturn = false" in smbody


def test_open_history_restores_the_checklist_item_view() -> None:
    """체크리스트로 검토한 결과를 기록에서 다시 열 때, 라이브 done 핸들러처럼
    window.DOCREVIEW.checklist 를 되살려야 한다. 안 그러면 항목별 뷰(완성도·
    그룹·아이콘)가 사라져 라이브 때와 다르게 보인다(사용자 신고)."""
    # 라이브 경로(api.js)는 payload.checklist 를 window.DOCREVIEW.checklist 에 싣는다.
    assert "window.DOCREVIEW.checklist = p.checklist" in API_JS
    # 기록 복원(openHistory)의 단일 검토 분기도 같은 필드를 되살려야 한다.
    start = APP_JS.index("openHistory: function (id)")
    body = APP_JS[start:APP_JS.index("\n    },", start)]
    assert "window.DOCREVIEW.checklist = p.checklist" in body, (
        "openHistory 가 checklist 를 안 되살린다 — 기록의 항목별 뷰가 사라진다"
    )


def test_checklist_run_has_its_own_screen() -> None:
    """탭이 없어졌으니 채우는 화면 자체가 어딘가엔 있어야 한다 — 뷰
    디스패치가 찾는 v.isChecklistRun 과 그 화면을 그리는 함수 둘 다."""
    assert "isChecklistRun" in VIEWS_JS
    assert "function checklistRunScreen(v)" in VIEWS_JS


def test_open_history_resumes_a_saved_checklist_run() -> None:
    """기록에서 체크리스트 종류를 열었는데 openHistory 가 여전히 compare/그 외
    두 갈래로만 나뉘면, payload.doc 를 찾다 그냥 깨지거나(단일검토로 오인)
    빈 화면이 뜬다. kind==="checklist" 분기가 crun 을 다시 세워야 이어서
    판정할 수 있다."""
    start = APP_JS.index("openHistory: function (id)")
    body = APP_JS[start:APP_JS.index("\n    },", start)]
    assert 'rec.kind === "checklist"' in body, (
        "openHistory 가 checklist 종류의 기록을 따로 다루지 않는다 — "
        "기록에서 체크리스트를 이어서 열 방법이 없다"
    )
    assert "state.crun = " in body, (
        "checklist 기록을 열어도 state.crun 을 다시 세우지 않는다 — "
        "판정을 이어서 하려 해도 채울 화면에 항목이 없다"
    )
    assert 'state.mode = "checklistrun"' in body, (
        "checklist 기록을 열어도 독립 화면(checklistrun)으로 가지 않는다"
    )


def test_automatic_review_results_no_longer_have_a_checklist_tab() -> None:
    """탭 UI(panelTabs)와 그 전환 액션(setPanelTab)이 남아 있으면 결과
    화면에 체크리스트가 다시 얹힌 채로 보인다 — 이번에 떼어내려는 바로
    그것이다."""
    assert "setPanelTab" not in APP_JS, (
        "setPanelTab 액션이 남아 있다 — 자동 검토 결과 화면에 체크리스트 "
        "탭 전환이 아직 붙어 있다는 뜻이다"
    )
    assert "panelTabs" not in VIEWS_JS, (
        "panelTabs(탭 UI를 만들던 변수)가 여전히 있다 — 결과 화면에 "
        "체크리스트 탭이 그대로 남아 있다"
    )
    assert "onChecklistTab" not in VIEWS_JS, (
        "onChecklistTab 이 남아 있다 — issuesPanel 이 아직 체크리스트 "
        "탭과 지적 목록 중 하나를 고르고 있다는 뜻이다"
    )
    assert "state.panelTab" not in APP_JS, (
        "state.panelTab 이 남아 있다 — 체크리스트 탭이 없어졌는데도 "
        "죽은 상태가 남는다"
    )


def test_run_checklist_picker_no_longer_gates_single_review_setup() -> None:
    """단일 검토 셋업에서 체크리스트를 미리 골라야만 자동 검토를 시작할
    수 있던 옛 결합이 되살아나면 안 된다 — 체크리스트는 이제 검토 시작과
    무관하며, 라이브러리에서 독립 화면으로 연다."""
    start = VIEWS_JS.index("function singleUpload(v)")
    body = VIEWS_JS[start:VIEWS_JS.index("\n  }", start)]
    assert "runChecklistPicker(v)" not in body, (
        "singleUpload 가 여전히 runChecklistPicker(v) 를 호출한다 — 체크리스트 "
        "고르기가 자동 검토 셋업에 다시 얹혀 있다"
    )


def test_save_checklist_run_uses_the_screens_own_document_name() -> None:
    """독립 화면은 state.files.single(자동 검토용 업로드 문서)이 아니라
    화면 자체에서 받은 문서명(state.crun.documentName)을 저장해야 한다 —
    자동 검토를 거치지 않고 들어온 경우 state.files.single 은 애초에 비어
    있다."""
    start = APP_JS.index("saveChecklistRun: function ()")
    body = APP_JS[start:APP_JS.index("\n    },", start)]
    assert "crun.documentName" in body, (
        "saveChecklistRun 이 crun.documentName 을 쓰지 않는다 — 독립 화면에서 "
        "적은 문서명이 저장되지 않는다"
    )


# --- 단일 검토를 체크리스트 기준으로: 등록된 체크리스트를 골라 자동 평가한다 --
#
# 아래는 실제 브라우저에서 고르고·검토를 돌려 확인하는 테스트가 아니다(이
# 스위트에 브라우저 러너가 없다). 소스 문자열 검사로 "되돌리면 실패하는" 지점만
# 잡는다 — 화면에 실제로 무엇이 그려지는지, 그룹핑이 눈으로 맞는지는 이 테스트들이
# 증명하지 못한다. 손 확인(브라우저로 실제 검토를 돌려보는 것)이 그 증명을 대신한다.


def test_single_review_can_pick_a_checklist_as_criteria() -> None:
    """단일 검토에서 등록된 체크리스트를 골라 그 기준으로 검토한다(자동 평가)."""
    assert "checklist_id" in APP_JS            # /api/review 에 실어 보낸다


def test_results_group_findings_by_checklist_item() -> None:
    """지적이 어느 항목에서 나왔는지 라벨과 함께 항목별로 묶여 보인다."""
    assert "checklistReview" in VIEWS_JS       # 항목별 렌더 함수/뷰모델


def test_results_show_the_per_item_completeness() -> None:
    """'몇 개 확인됐나'가 보여야 한다 — 사람이 남은 걸 안다."""
    assert "manual" in VIEWS_JS and "사람 확인" in VIEWS_JS


def test_review_checklist_picker_lists_the_library_not_the_yaml_criteria() -> None:
    """'체크리스트로 평가' picker 는 라이브러리에 올린 체크리스트(state.clib.list,
    /api/checklists)를 보여야 한다. 자동 검토 기준(srvChecklists=YAML)을 보여주면
    사용자가 올린 IS16/IS22 가 안 뜨고, YAML id 를 고르면 서버 checklists.get 이
    404 를 낸다 — 실제로 그렇게 났다."""
    start = VIEWS_JS.index("var reviewChecklistCards")
    body = VIEWS_JS[start:start + 200]
    assert "clib.list" in body, "picker 가 라이브러리 목록(clib.list)이 아니라 다른 것을 읽는다"
    assert "srvChecklists.map" not in VIEWS_JS or "reviewChecklistCards = srvChecklists" not in VIEWS_JS


# --- 기본 검토(용어 일관성·미작성 TBD)가 늘 도는 모델로 바뀐 뒤: 단일 검토
# 셋업 화면에서 YAML "자동 검토 기준" picker 가 빠지고, 라이브러리 체크리스트
# picker 만 남는다. 아래도 소스 문자열 검사다 — 실제 브라우저 렌더링을
# 증명하지 못한다. 화면이 실제로 어떻게 보이는지는 손 확인이 대신한다.


def test_single_upload_no_longer_offers_the_yaml_automatic_criteria() -> None:
    """단일 검토는 이제 기본 검토(늘 실행)와 라이브러리 체크리스트(선택) 두
    갈래뿐이다. YAML 기준("자동 검토 기준" picker)은 2문서 비교 전용으로
    옮겨갔으니 단일 검토 셋업(singleUpload)에는 그 h3/설명/카드가 없어야 한다."""
    start = VIEWS_JS.index("function singleUpload(v)")
    body = VIEWS_JS[start:VIEWS_JS.index("\n  }", start)]
    assert '>자동 검토 기준</h3>' not in body, (
        "singleUpload 가 여전히 '자동 검토 기준' 제목(h3)을 그린다 — YAML "
        "picker 가 단일 검토 셋업에 남아 있다"
    )
    assert "detectBanner(v)" not in body, (
        "singleUpload 가 여전히 detectBanner(v) 를 부른다 — YAML 기준 전용 "
        "배너가 단일 검토에 남아 있다(비교 화면에서만 써야 한다)"
    )


def test_single_upload_still_has_the_start_button() -> None:
    """자동 검토 기준 picker 를 지우면서 '분석 시작하기' 버튼까지 같이
    지워지면 안 된다 — 지우는 블록과 버튼이 같은 카드 안에 있었다."""
    start = VIEWS_JS.index("function singleUpload(v)")
    body = VIEWS_JS[start:VIEWS_JS.index("\n  }", start)]
    assert 'data-act="startReview"' in body


def test_single_upload_notes_that_base_checks_always_run() -> None:
    """체크리스트를 안 골라도 기본 검토(용어 일관성·미작성 TBD)는 늘 돈다는
    사실을, picker 를 지운 자리에 짧게라도 알려야 한다 — 안 그러면 picker가
    사라진 걸 보고 '아무 검사도 없이 시작하나' 하고 오해할 수 있다."""
    start = VIEWS_JS.index("function singleUpload(v)")
    body = VIEWS_JS[start:VIEWS_JS.index("\n  }", start)]
    assert "기본 검토" in body and "용어 일관성" in body and "TBD" in body


def test_single_upload_description_drops_the_wrong_domain_legal_wording() -> None:
    """예전 설명 문구("법적 누락, 모순, 모호성")는 법률 문서 전용처럼 읽혀
    실제 사용 도메인과 안 맞았다. 새 모델(기본 검토 + 체크리스트)에 맞는
    설명으로 바뀌어야 한다."""
    start = VIEWS_JS.index("function singleUpload(v)")
    body = VIEWS_JS[start:VIEWS_JS.index("\n  }", start)]
    assert "법적" not in body


# ── 기준이 무엇이었는지 화면이 보여준다 ────────────────────────────────────
# 원본 엑셀은 사내 파일이라 앱에 없다. 화면이 안 보여주면 검토자가 "공통3" 을
# 보고도 무엇을 확인하라는 건지 알 길이 없다 — 산출물 세트가 "기준" 탭으로
# 같은 문제를 푼 것과 같은 이유다(/api/teams/{team}/criteria).

def test_item_shows_the_how_to_check_note():
    assert "it.note" in VIEWS_JS, "확인 방법을 안 실으면 끊긴 본문만 남는다"


def test_item_explains_why_it_is_manual():
    # 도구가 검사한 것과 애초에 검사할 수 없는 것은 다른 말인데 상태는 같다.
    assert "사람이 확인합니다" in VIEWS_JS


def test_finding_cards_are_grouped_under_their_criterion_without_a_rail():
    # 소속은 들여쓰기·그룹 사이 간격으로 유지하고 사용자가 원하지 않는 레일은 뺀다.
    body = VIEWS_JS[VIEWS_JS.index("function checklistItemGroup("):]
    body = body[:body.index("\n  }")]
    assert "border-left" not in body and "padding-left" in body


def test_invented_numbers_are_hidden():
    # 번호는 원본과 대조하는 길이다. 우리가 지어낸 C- 번호는 대조할 원본이 없다.
    body = VIEWS_JS[VIEWS_JS.index("function checklistItemGroup("):]
    body = body[:body.index("\n  }")]
    assert 'indexOf("C-")' in body


def _plain_function_body(src: str, needle: str) -> str:
    """`_function_body` 의 모듈 수준 함수판 — 닫는 괄호가 '\n  }' 다."""
    start = src.index(needle)
    return src[start:src.index("\n  }", start)]


def test_초안은_단일검토와_아무것도_나눠_쓰지_않는다() -> None:
    """2026-09-16 재설계. 초안 화면은 `window.DOCREVIEW` 도 뷰어도 `state.screen`
    도 안 건드리고, 원문은 새 창이 연다.

    여기 있던 앞선 규칙(서로의 결과 화면을 되돌린다·뒤에서 끝난 작업이 남의 화면을
    빼앗지 않는다)은 **결합이 있을 때만 필요한 것**이었다. 결합을 없앴으므로
    가드가 아니라 닿지 않음이 그 자리를 지킨다 — 그것을 여기서 확인한다.
    """
    # 초안 이벤트 처리·초안 기록 열기가 뷰어 전역을 안 쓴다.
    draft = API_JS[API_JS.index("function onEvaluateEvent"):API_JS.index("function streamEvaluate")]
    draft = "\n".join(line for line in draft.split("\n") if not line.strip().startswith("//"))
    assert "window.DOCREVIEW" not in draft
    assert "putDraft" not in API_JS and "evaluationFindings" not in API_JS, \
        "전역을 채우던 함수가 남아 있다"
    assert "otherResultOnScreen" not in API_JS, "결합을 막던 가드가 남아 있다"

    # 초안을 시작해도 단일 검토의 파일·화면을 안 가져간다.
    start = _function_body(APP_JS, "startEvaluate: function ()")
    assert "state.files.single" not in start
    assert "state.screen" not in start and "state.reviewed" not in start

    # 초안은 제 이력 id 를 들고 있는다 — 엑셀·원문 버튼이 그것을 읽는다.
    assert "historyId" in _function_body(APP_JS, "exportEvaluationXlsx: function ()")
    assert "state.evalv.historyId" in APP_JS


def test_초안_원문은_새_창으로_연다() -> None:
    """화면에 뷰어를 박으면 단일 검토와 상태를 나눠 쓰게 된다 — 비교 검토의
    원문 보기와 같이 새 창으로 띄운다. 창은 하나뿐이고, 팝업이 막히면 말한다."""
    # 원문은 비교 검토와 같은 자체 뷰어 창(?doc=)이다 — 브라우저 내장 PDF 뷰어(/original
    # 직접 열기)는 쪽 이동·형광펜이 안 되고 docx·hwpx 는 다운로드로 떨어졌다(2026-09-17).
    body = _function_body(APP_JS, "openEvalOriginal: function (arg)")
    assert "window.open(" in body and "?doc=" in body and "docsuree-focus" in body
    assert "/original" not in body, "브라우저 내장 뷰어로 되돌아갔다"
    assert "state.docWins" in body, "창을 기억 안 하면 행마다 새 창이 열린다"
    assert "팝업이 막혀" in body, "팝업 차단을 조용히 넘긴다"
    # 결과 화면에는 문서 뷰어가 없다.
    assert 'data-act="openEvalOriginal"' in VIEWS_JS
    results = VIEWS_JS[VIEWS_JS.index("function evaluateResults(v)"):]
    results = results[:results.index("\n  }\n")]
    for gone in ("viewerPane", "pdf-mount", "doc-scroll", "issuesShell"):
        assert gone not in results, f"초안 결과에 {gone} 가 남아 있다"


def test_초안_진행화면의_경과는_타이머가_민다() -> None:
    """서버는 `ingestion` running 을 한 번 흘리고 파싱이 끝날 때까지 조용하다
    (실측 600초). 렌더가 안 오므로 렌더 시점 계산만으로는 숫자가 굳는다 —
    비교 검토(tickCompareElapsed)와 같은 1초 타이머가 글자만 갈아끼워야 한다.
    """
    assert "function tickEvaluateElapsed()" in API_JS
    tick = _plain_function_body(API_JS, "function tickEvaluateElapsed()")
    assert 'getElementById("eval-elapsed")' in tick, "갈아끼울 자리를 안 찾는다"
    assert "render()" not in tick, "전체 render 는 pdf-mount 를 새로 만든다"
    # 진행 머리말은 단일·비교와 같은 progressHead 가 그리고, 그 자리는 elapsedId 로 준다.
    assert 'elapsedId: "eval-elapsed"' in VIEWS_JS, "진행 화면에 그 자리가 없다"
    start = _function_body(APP_JS, "startEvaluate: function ()")
    assert "tickEvaluateElapsed()" in start, "초안을 시작하며 타이머를 안 건다"
    assert "clearTimers()" in start, "앞 검토의 타이머를 안 끊는다"
    # 완료·실패는 타이머를 비우지 않는다 — timers 는 네 틱이 함께 쓰는 한 벌이라
    # 여기서 비우면 같은 순간 단일 검토를 보고 있던 사람의 경과까지 멈춘다.
    # 초안 틱은 estep 가드(위 tick 첫 줄)로 스스로 끝난다.
    ev = API_JS[API_JS.index("function onEvaluateEvent") : API_JS.index("function streamEvaluate")]
    ev = "\n".join(line for line in ev.split("\n") if not line.lstrip().startswith("//"))
    assert "clearTimers()" not in ev, "초안 이벤트 처리가 남의 경과 타이머까지 끊는다"


def test_검토_기준_화면에_엑셀_업로드_진입이_없다() -> None:
    """추가 검토 기준은 수기 등록만 남긴다(2026-09-16). 체크리스트 xlsx 는 체크리스트
    검토(부록 B 초안)로 간다 — 두 화면이 같은 파일을 받으면 어느 쪽이 맞는지 헷갈린다."""
    assert "uploadChecklistForReview" not in VIEWS_JS
    assert "registerChecklist" not in VIEWS_JS
    assert 'data-act="writeChecklist"' in VIEWS_JS, "직접 작성 진입까지 사라지면 안 된다"


def test_초안_행의_쪽수는_창을_새로_띄우지_않는다() -> None:
    """창을 여는 길은 머리의 원문 ↗ 하나다. 쪽수는 열린 창 안에서 자리만 옮긴다 — 둘이 같은
    일을 하면 검토자가 "뭐가 다르지" 한다(2026-09-17)."""
    body = _function_body(APP_JS, "evalRowOriginal: function (arg)")
    assert "window.open(" not in body and "openEvalOriginal(" not in body
    assert "postMessage" in body and "docsuree-focus" in body
