"""모델이 되돌려준 기준 번호 표기를 진짜 번호로 되돌린다.

무슨 일이 났나 (2026-08-26): `_criterion_line` 이 프롬프트에 `No.C1  오탈자…`
로 싣는다. 모델은 본 대로 `"No.C1"` 을 돌려주는데 판정표의 열쇠는 `"C1"` 이라,
`no not in self.verdicts` 에서 **답이 전부 버려졌다.**

화면에는 "LLM 이 답했지만 이 기준의 판정은 오지 않았습니다" 로 떴다. 원인을
정확히 반대로 가리킨 것이다 — 모델은 매번 전부 답하고 있었고, 버린 쪽이 우리다.

실측(Qwen3.8-27B, PRJX-AN-002 청크 3개): 기준 4개를 물어 세 청크 모두 4개
전부 판정이 왔다. 커버리지 100%, 채택 0%.

이 검사가 지키는 것은 두 가지다.
1. 프롬프트가 붙인 표기를 되돌려 받는다.
2. 그러면서도 **정말 지어낸 번호는 여전히 버린다** — 그게 이 대조의 존재 이유다.
"""
from __future__ import annotations

from dataclasses import dataclass

from modules.agent_quality.consistency import (
    _criterion_line,
    _flatten_no,
    _no_aliases,
)


@dataclass
class _C:
    no: str
    text: str = "기준 본문"
    note: str = ""


CRITERIA = [_C("C1"), _C("SRVR05-01"), _C("F2.3-1"), _C("SRVR03-01~07"),
            _C("칸값-1"), _C("9")]


def test_prompt_really_prefixes_the_number() -> None:
    """이 버그의 출발점을 못박는다 — 프롬프트가 `No.` 를 붙인다.

    누가 `_criterion_line` 에서 접두사를 빼면 이 검사가 깨진다. 그때는 아래
    별칭 검사도 같이 읽고 정리해야 한다(빼도 별칭은 남겨 두는 것이 안전하다 —
    모델이 제 나름의 접두사를 붙이는 것은 못 막는다).
    """
    assert _criterion_line(_C("C1", "오탈자")).startswith("No.C1")


def test_model_echo_maps_back_to_real_number() -> None:
    a = _no_aliases(CRITERIA)
    for real in ("C1", "SRVR05-01", "F2.3-1", "SRVR03-01~07", "칸값-1", "9"):
        echoed = f"No.{real}"
        got = a.get(echoed) or a.get(_flatten_no(echoed))
        assert got == real, f"{echoed} → {got} (기대 {real})"


def test_plain_number_still_matches() -> None:
    """접두사 없이 온 답도 그대로 받는다 — 실제로 둘이 섞여 온다."""
    a = _no_aliases(CRITERIA)
    assert a.get("C1") == "C1"
    assert a.get("SRVR03-01~07") == "SRVR03-01~07"


def test_stray_punctuation_and_case() -> None:
    a = _no_aliases(CRITERIA)
    for echoed in ("no. c1", "C1.", " No.C1 ", "NO: C1"):
        assert a.get(_flatten_no(echoed)) == "C1", echoed


def test_invented_numbers_are_still_dropped() -> None:
    """지어낸 번호는 여전히 안 받는다. 이 대조의 존재 이유다.

    관대하게 만들다 없는 기준의 판정까지 받으면, 검사한 적 없는 항목이 화면에서
    통과로 보인다.
    """
    a = _no_aliases(CRITERIA)
    for bogus in ("No.Z9", "SRVR99-99", "", "No.", "기준 1"):
        assert a.get(bogus) is None
        assert a.get(_flatten_no(bogus)) is None, bogus


def test_empty_numbers_are_not_registered() -> None:
    """번호 없는 기준이 빈 문자열 열쇠를 만들면 모델의 빈 답이 그 기준에 붙는다."""
    a = _no_aliases([_C(""), _C("C1")])
    assert "" not in a


# ── 접어 쓴 범위 ──────────────────────────────────────────────────────
# `SRVR03-01~07` 은 팀 md 의 항목 7개를 문구가 같아 하나로 합친 자리다. 모델은
# 이것을 범위로 읽고 일곱 줄로 펼쳐서 답한다 — 실측 2회 모두 동일했다.

def test_collapsed_range_accepts_expanded_members() -> None:
    a = _no_aliases([_C("SRVR03-01~07")])
    for n in range(1, 8):
        assert a.get(f"SRVR03-{n:02d}") == "SRVR03-01~07", n
        assert a.get(_flatten_no(f"No.SRVR03-{n:02d}")) == "SRVR03-01~07", n


def test_collapsed_range_still_accepts_itself() -> None:
    a = _no_aliases([_C("DVR03-01~07")])
    assert a.get("DVR03-01~07") == "DVR03-01~07"
    assert a.get(_flatten_no("No.DVR03-01~07")) == "DVR03-01~07"


def test_outside_the_range_is_not_accepted() -> None:
    """범위 밖 번호까지 받으면 없는 기준의 판정을 받게 된다."""
    a = _no_aliases([_C("SRVR03-01~07")])
    for bogus in ("SRVR03-08", "SRVR03-00", "SRVR04-01"):
        assert a.get(bogus) is None, bogus


def test_absurd_range_is_ignored() -> None:
    """오타로 들어온 거대 범위가 별칭표를 부풀리지 않는다."""
    a = _no_aliases([_C("X-1~9999")])
    assert a.get("X-5000") is None
    assert a.get("X-1~9999") == "X-1~9999", "자기 자신은 남아야 한다"


def test_plain_numbers_are_not_treated_as_ranges() -> None:
    a = _no_aliases([_C("C1"), _C("F2.3-1"), _C("9")])
    assert a.get("C1") == "C1"
    assert a.get("F2.3-1") == "F2.3-1"
    assert a.get("9") == "9"
