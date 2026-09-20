"""agent_history — 검토 의견·이력 관리. 문서 계보와 반영 확인 (순수 규칙)."""
from __future__ import annotations

from .lineage import (
    CARRIED,
    DEFAULT_VERDICT,
    KEY_SEP,
    LEGACY,
    OBSERVED,
    RTM_CARRIED,
    RTM_VERDICTS,
    STATUSES,
    LineageItem,
    LineageReview,
    carry_rtm,
    carry_verdicts,
    find_prior,
    find_prior_pair,
    guess_original_name,
    incomplete_checkers,
    is_process_report,
    match_findings,
    rtm_key,
    verdict_key,
)

__all__ = [
    "CARRIED",
    "KEY_SEP",
    # 기계가 본 것(OBSERVED)과 사람이 내린 판정(STATUSES)은 다른 축이다.
    "OBSERVED",
    "STATUSES",
    # 추적표(비교 검토) 계보 — 열쇠는 요건 ID.
    "RTM_VERDICTS",
    "RTM_CARRIED",
    "rtm_key",
    "find_prior_pair",
    "carry_rtm",
    "DEFAULT_VERDICT",
    "LEGACY",
    "LineageItem",
    "LineageReview",
    "carry_verdicts",
    "find_prior",
    "guess_original_name",
    "incomplete_checkers",
    "is_process_report",
    "match_findings",
    "verdict_key",
]
