"""반복 데이터 목록은 같은 레코드 표 문법을 공유한다."""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIEWS = (ROOT / "web" / "views.js").read_text(encoding="utf-8")
APP = (ROOT / "web" / "app.js").read_text(encoding="utf-8")
API = (ROOT / "web" / "api.js").read_text(encoding="utf-8")
CSS = (ROOT / "web" / "index.html").read_text(encoding="utf-8")


def _between(start: str, end: str) -> str:
    at = VIEWS.index(start)
    return VIEWS[at:VIEWS.index(end, at)]


def test_history_and_criteria_filters_separate_selection_hover_and_focus() -> None:
    selected = re.search(
        r"#historyRecords \.record-filter\.is-on, \.criteria-scope-tabs \.record-filter\.is-on\s*\{([^}]+)\}", CSS
    ).group(1)
    assert "border-color: transparent" in selected
    assert "background: var(--accent-weak)" in selected
    assert "color: var(--accent-ink)" in selected
    base = re.search(r"\.record-filter\s*\{([^}]+)\}", CSS).group(1)
    assert "background: transparent" in base
    assert "color: var(--text-2)" in base
    hover = re.search(r"\.record-filter:hover\s*\{([^}]+)\}", CSS).group(1)
    assert "background: var(--state-hover-neutral)" in hover
    focus = re.search(
        r"#historyRecords \.record-filter:focus-visible, \.criteria-scope-tabs \.record-filter:focus-visible\s*\{([^}]+)\}", CSS
    ).group(1)
    assert "outline: 2px solid var(--accent)" in focus
    # 필터 줄은 가로 스크롤 영역이므로 포커스 링이 바깥에서 잘리지 않아야 한다.
    assert "outline-offset: -2px" in focus


def test_record_lists_share_one_visual_grammar() -> None:
    for selector in (
        ".record-toolbar {",
        ".record-head, .record-row {",
        ".record-primary {",
        ".record-tag {",
        ".record-actions {",
    ):
        assert selector in CSS


def test_selection_uses_surface_and_type_without_left_accent_rails() -> None:
    # 실제 칸·패널 구분선은 허용하지만 한쪽 강조 shadow와 두꺼운 레일은 금지한다.
    for source in (CSS, VIEWS):
        assert not re.search(r"(?:box-shadow:\s*)inset [1-9]\d*px 0(?:px)?(?:\s|;)", source)
        assert not re.search(r"border-left:\s*[2-9]\d*px", source)
    selected = '.criteria-work-table tbody tr.is-selected td'
    assert selected + ' { background: var(--criteria-row-selected); }' in CSS
    assert '.trace-queue-item.is-active { background: var(--accent-weak); }' in CSS
    assert '.trace-queue-item:focus-visible' in CSS
    assert '#issuesPanel .fcard:focus-visible' in CSS


def test_criteria_hover_does_not_compete_with_selection() -> None:
    assert 'tr:not(.is-selected):hover td { background: var(--criteria-row-hover); }' in CSS
    assert 'tr:hover .criteria-title-button' not in CSS
    assert '[data-theme="dark"] .criteria-work-table' in CSS
    assert '--criteria-row-selected: #E7EDF6' in CSS
    assert '--criteria-row-selected: #303C50' in CSS


def test_history_is_filterable_record_table() -> None:
    body = _between("  function historyView(v) {", "  function confirmDialog(")
    assert 'id="historyRecords" class="surface-list record-surface"' in body
    assert 'class="record-head record-history-grid"' in body
    for column in ("문서", "검토 유형", "결과", "검토 일시", "작업"):
        assert f"<span>{column}</span>" in body
    assert 'data-act="setHistoryKind"' in body
    assert "setHistoryKind: function" in APP
    assert "repaintHistoryRecords()" in APP
    # 폴더 검토 건수 배지(2026-09-17) — 요약의 문서 수를 글리프에 넘긴다.
    assert "recordShapeIcon(h.kind, h.title, 34, (h.summary || {}).documents)" in body


def test_criteria_and_history_share_search_filters_and_row_density() -> None:
    criteria = _between("  function criteriaWorkspace() {", "  function checklistsView(")
    history = _between("  function historyView(v) {", "  function confirmDialog(")
    for body in (criteria, history):
        assert 'class="record-tools ' in body
        assert 'class="record-search ' in body
    assert 'class="record-toolbar criteria-workspace-tools"' in criteria
    assert 'class="record-filters criteria-scope-tabs"' in criteria
    assert '.criteria-scope-tabs .record-filter.is-on' in CSS
    assert 'border-bottom: 2px solid transparent' not in CSS.split(
        '.criteria-workspace {', 1)[1].split('.criteria-workspace-body {', 1)[0]
    assert '.criteria-work-table td { height: 58px; padding: 8px 12px;' in CSS
    assert '--criteria-row-hover: var(--state-hover-neutral)' in CSS
    # 툴바의 「기준 목록 N」은 없앴다(2026-09-18) — 범위 탭의 「전체 N」과 표
    # 아래 meta 줄까지 같은 수를 세 번 말하고 있었다. 숫자는 탭이 진다.
    assert 'criteriaCatalogCount' not in APP
    assert '<div class="record-view-name">기준 목록</div>' in criteria


def test_setup_pages_recent_reviews_use_record_table() -> None:
    body = _between("  function recentSection(kind, label) {", "  function singleUpload(v) {")
    assert 'class="surface-list record-surface setup-recent-records"' in body
    assert 'class="record-head record-recent-grid"' in body
    assert 'class="record-row record-recent-grid"' in body
    for column in ("문서", "결과", "검토 일시", "작업"):
        assert f"<span>{column}</span>" in body
    assert ".record-recent-grid {" in CSS
    assert 'recordShapeIcon(kind, h.title, 30)' in body
    assert 'kindShapeIcon(kind, h.title, 30)' not in body

    for call in (
        'recentSection("review", "단일 검토")',
        'recentSection("compare", "비교 검토")',
        'recentSection("case", "폴더 검토")',
        # kind 는 "evaluation" — "checklist"(사람이 직접 채우는 기능)와 다른 기록이다.
        'recentSection("evaluation", "체크리스트 검토")',
    ):
        assert call in VIEWS


def test_home_recent_reviews_use_compact_record_rows() -> None:
    body = _between("  function appHomeView(v) {", "  function caseDropzone(")
    assert 'class="record-row home-recent-grid home-recent-row"' in body
    assert "recordShapeIcon(h.kind, h.title, 30, (h.summary || {}).documents)" in body
    assert 'class="home-recent-glyph"' in body
    assert ".home-recent-glyph {" in CSS
    home_icon_css = CSS[CSS.index(".home-recent-glyph {"):
                        CSS.index(".record-kind-icon {")]
    assert "background:" not in home_icon_css
    assert "historyKindShapeIcon(" not in body
    assert 'function (kind)' in body and 'ICONS.compare' in body and 'ICONS.single' in body
    assert 'class="record-result"' in body
    assert 'class="home-recent-open"' in body
    assert ".home-recent-list .record-row { min-height: 52px;" in CSS


def test_newly_completed_review_is_highlighted_once_on_home() -> None:
    body = _between("  function appHomeView(v) {", "  function caseDropzone(")
    assert 'data-fresh-history="true"' in body
    assert ".home-recent-row.is-fresh { animation: homeFreshRow 1.1s" in CSS
    assert ".home-recent-row.is-fresh .record-result i" in CSS
    # 단일·비교·폴더·체크리스트 완료는 서버가 돌려준 저장 id를 같은 함수로 표시한다.
    assert API.count("markFreshHistory(") == 5  # 정의 1 + 완료 경로 4
    # 실제 행이 그려진 뒤 바로 소비해야 메뉴 여닫기 같은 재렌더에 반복되지 않는다.
    assert "if (freshHomeRow) state.homeFreshHistoryId = null" in APP
    # 독립 체크리스트 판정 저장도 같은 홈 목록에 들어간다.
    assert "state.homeFreshHistoryId = h.id" in APP


def test_uploaded_checklists_use_the_same_record_table() -> None:
    body = _between("  function criteriaCatalogModel() {", "  function scopeCalc(v) {")
    assert 'class="criteria-work-table"' in body
    assert 'L.editable ? "추가"' in body
    assert 'data-act="selectChecklistForReview"' in body
    assert 'data-act="startChecklistRun"' in body
    assert 'data-act="askDeleteChecklist"' in body
    assert "criteriaWorkspace()" in body


def test_accounts_use_the_same_record_table() -> None:
    body = _between("  function adminSection(v) {", "  function appHomeView(v) {")
    assert 'class="record-row record-account-grid"' in body
    assert 'class="record-head record-account-grid"' in body
    for column in ("계정", "소속", "권한", "작업"):
        assert f"<span>{column}</span>" in body


def test_hierarchical_criteria_remain_expandable() -> None:
    body = _between(
        "  function criteriaLayerCard(L, open, how) {",
        "  function checklistsView(v) {",
    )
    assert 'class="criteria-layer clay-card' in body
    assert 'data-act="toggleCriteriaLayer"' in body
    assert 'class="criteria-browser"' in body
    assert 'class="criteria-tools"' in body
    assert 'class="criteria-catalog"' in body
    assert 'class="criteria-layer-headings"' in body
    for column in ("범위", "기준 세트", "항목", "검토 분담"):
        assert f"<span>{column}</span>" in body
    assert 'class="criteria-layer-coverage"' in body
    assert "자동 " in body and "직접 " in body
    assert 'class="clay-bar"' not in body


def test_open_criteria_details_use_columns_and_full_width_disclosure() -> None:
    row = _between("  function criteriaItemRow(it, key, open) {", "  function criteriaLayerCard(")
    items = _between("  function itemsHtml(L, items) {", "  function criteriaLayerCard(")
    assert 'class="record-row record-criteria-grid clay-row criteria-record-row' in row
    assert 'class="record-criterion-no mono"' in row
    assert "criteria-record-check" in row
    assert 'class="criteria-record-how"' in row
    assert 'class="record-head record-criteria-grid criteria-record-head"' in items
    for column in ("기준", "검증 대상", "검사 항목", "확인 방식"):
        assert f"<span>{column}</span>" in items
    assert ".criteria-record-head { background: var(--panel); }" in CSS
    assert ".clay-note { grid-column: 1 / -1;" in CSS


def test_uploaded_checklist_detail_uses_the_same_record_columns() -> None:
    body = _between("  function clibDetailCard(v) {", "  var VERDICT_CHOICES")
    assert 'class="surface-list record-surface criteria-detail-surface"' in body
    assert 'class="record-row record-criteria-grid criteria-record-row"' in body
    assert 'class="record-head record-criteria-grid criteria-record-head"' in body
    assert "직접 판정" in body and 'howChip("사람이 확인")' in body


def test_criteria_disclosure_repaints_only_its_record_area() -> None:
    body = _between("  function criteriaWorkspace() {", "  function scopeCalc(v) {")
    assert 'id="criteriaCatalogRecords"' in body
    assert 'id="criteriaInspector"' in body
    assert "function repaintCriteriaLayers()" in APP
    assert 'document.getElementById("criteriaCatalogRecords")' in APP

    for action in ("toggleCriteriaItem", "toggleCriteriaLayer", "setCriteriaHow"):
        start = APP.index(f"    {action}: function")
        block = APP[start:APP.index("    },", start)]
        assert "if (!repaintCriteriaLayers()) render();" in block

    search = APP[APP.index("    // 기준 검색."):APP.index("    // 추가 기준 작성 폼.")]
    assert "if (!repaintCriteriaLayers()) render();" in search
