"""Application reading roles must not drift back to tiny metadata styling."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CSS = (ROOT / "web/index.html").read_text(encoding="utf-8")


def rule(selector: str) -> str:
    matches = re.findall(re.escape(selector) + r"\s*\{([^}]+)\}", CSS)
    assert matches, selector
    return " ".join(matches)


def test_decision_text_has_body_size_and_color():
    for selector in (".trace-queue-title", ".trace-source-body", ".trace-candidate-text",
                     ".record-primary strong", ".criteria-method", ".criteria-preparation",
                     ".single-evidence-quote"):
        body = rule(selector)
        assert "font-size: 14px" in body, selector
        assert "color: var(--text)" in body, selector


def test_actions_are_not_styled_as_metadata():
    for selector in (".btn", ".btn-sm", ".result-filter", ".result-control",
                     ".record-filter", ".criteria-scope-tabs button",
                     ".trace-detail-nav button", ".trace-note textarea"):
        assert "font-size: 14px" in rule(selector), selector


def test_supporting_copy_is_readable_but_metadata_stays_secondary():
    # .flow-desc 는 홈 흐름 카드와 함께 사라졌다(2026-09-18 기준 타일 재작업).
    for selector in (".tile-sub", ".setup-section-sub",
                     ".trace-verdict small", ".progress-stage-desc"):
        body = rule(selector)
        assert "font-size: 13px" in body, selector
        assert "color: var(--text-2)" in body, selector
    for selector in (".record-primary small", ".single-evidence-label"):
        body = rule(selector)
        assert "font-size: 12px" in body, selector
        assert "color: var(--text-3)" in body, selector


def test_layout_can_accommodate_readable_controls():
    assert "flex-wrap: wrap" in rule(".single-result-toolbar")
    assert "flex-wrap: nowrap" in rule(".result-filter-group")
    assert "flex-wrap: wrap" in rule(".settings-row")
    assert "flex-wrap: wrap" in rule(".case-manual-entry")
    assert "-webkit-line-clamp: 2" in rule(".trace-queue-title")
    assert "min-width: 0" in rule(".case-manual-entry input")


def test_required_warning_is_not_muted_metadata():
    """미검토 경고는 회색 메타데이터로 묻히면 안 된다. 띠(.single-result-warning)를 빼고
    검토 상태 탭의 표식으로 옮겼으니(2026-09-16) 그 표식이 경고색인지를 본다."""
    assert "color: var(--sev-min-fg)" in rule(".single-result-tab-warn")
    assert "color: var(--sev-min-fg)" in rule(".single-result-tab.has-warn b")


def test_comparison_panels_share_typography_and_neutral_advisories():
    for selector in (".trace-source-title", ".trace-statement", ".trace-candidate-text"):
        assert "font-size: 14px" in rule(selector)
    for selector in (".trace-candidate-note", ".cmp-scope-warning summary",
                     ".cmp-summary-tags span.is-alert", ".rtm-status-neutral"):
        body = rule(selector)
        assert "var(--bg)" in body
        assert "sev-min" not in body
    src = (ROOT / "web/views.js").read_text(encoding="utf-8")
    statement = src.split("function statementHtml(", 1)[1]
    statement = statement.split("function compareDocView", 1)[0]
    assert "font-size:" not in statement
    # 홀수 칸(값만 있는 줄)은 라벨 없이 값으로 그린다.
    assert 'if (value === undefined) { main += row("", label); continue; }' in statement
    assert "mark.sev-minor" in CSS, "Original document highlights must remain intact"


def test_progress_filename_is_readable_without_extra_surface():
    body = rule(".progress-document-file")
    for declaration in ("font-size: 14px", "font-weight: 500", "text-align: left",
                        "color: var(--text)"):
        assert declaration in body
    assert "background" not in body and "border" not in body
    assert "overflow-wrap: anywhere" in rule(".progress-document-name")
    assert "text-overflow" not in rule(".progress-document-name")
