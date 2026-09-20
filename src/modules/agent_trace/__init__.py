"""agent_trace — 정합성·추적성 검사. 추적성·내용일치·RTM."""
from __future__ import annotations

from .content_match import ContentMatchChecker
from .field_match import (
    CaseWideCell,
    CaseWideResult,
    CaseWideRule,
    PairRow,
    PairRule,
    compare_case_wide,
    compare_pair,
)
from .idref import excluded_ids, extract_id_anchors, extract_id_statements
from .missing_judge import (
    HAS_DESIGN,
    NO_DESIGN,
    UNKNOWN,
    Judgment,
    apply_judgments,
    judge_missing,
    judge_missing_rows,
)
from .missing_probe import ProbeHit, probe_missing
from .rtm import build_rtm
from .rtm_items import RTM_CHECKS, rtm_check, rtm_verdict
from .traceability import TraceabilityChecker

__all__ = [
    "TraceabilityChecker",
    "ContentMatchChecker",
    "excluded_ids",
    "extract_id_anchors",
    "extract_id_statements",
    "build_rtm",
    "probe_missing",
    "ProbeHit",
    "judge_missing",
    "judge_missing_rows",
    "apply_judgments",
    "Judgment",
    "HAS_DESIGN",
    "NO_DESIGN",
    "UNKNOWN",
    "RTM_CHECKS",
    "rtm_check",
    "rtm_verdict",
    "PairRow",
    "PairRule",
    "compare_pair",
    "CaseWideRule",
    "CaseWideCell",
    "CaseWideResult",
    "compare_case_wide",
]
