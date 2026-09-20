"""검사기를 가르는 것은 기준 번호가 아니라 **매개변수 내용**이다.

무슨 일이 났나 (2026-08-26): `checker_key` 가 `f"{name}#{criterion.no}"` 였다.
매개변수가 한 글자도 다르지 않은 기준 둘(AX품질팀 `F2.3-3` · `SRVR05-02`, 둘 다
`abbrev_sections: ['약어 정의','약어','abbrevia']`)이 서로 다른 열쇠를 받아
**같은 검사가 두 벌** 만들어졌다. 같은 문서를 두 번 훑고, 똑같은 지적이 평면
목록에 두 장 떴다("약어 목록 장절을 찾지 못했습니다").

그러면서도 갈라야 할 것은 여전히 갈라야 한다 — 보는 칸이 다른 칸 값 검사가
한 벌을 나눠 가지면 표지 항목과 개정기록 항목의 지적이 똑같아진다.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from modules.agent_checklist import checker_key, rule_checkers


@dataclass
class _C:
    no: str
    check: str = "abbrev"
    mode: str = "규칙"
    agent: str = "형식·완전성"
    params: dict = field(default_factory=dict)


SECTIONS = ["약어 정의", "약어", "abbrevia"]


def test_same_params_share_one_checker() -> None:
    a = _C("F2.3-3", params={"abbrev_sections": list(SECTIONS)})
    b = _C("SRVR05-02", params={"abbrev_sections": list(SECTIONS)})
    assert checker_key(a) == checker_key(b), "매개변수가 같으면 한 벌이어야 한다"
    assert len(rule_checkers([a, b])) == 1


def test_different_params_stay_separate() -> None:
    """이 대조의 존재 이유 — 보는 것이 다르면 갈라야 한다."""
    a = _C("F1", params={"abbrev_sections": ["약어"]})
    b = _C("F2", params={"abbrev_sections": ["용어 정의"]})
    assert checker_key(a) != checker_key(b)
    assert len(rule_checkers([a, b])) == 2


def test_no_params_shares_the_bare_name() -> None:
    """매개변수 없는 검사는 여러 기준이 대도 한 벌이면 된다 (전부터 그랬다)."""
    a, b = _C("C2", params={}), _C("X9", params={})
    assert checker_key(a) == checker_key(b) == "abbrev"


def test_params_key_is_order_insensitive() -> None:
    """기준값은 손으로 적는 YAML 이라 키 순서가 파일마다 다르다."""
    a = _C("A", params={"abbrev_sections": ["약어"], "strict": True})
    b = _C("B", params={"strict": True, "abbrev_sections": ["약어"]})
    assert checker_key(a) == checker_key(b)


def test_list_order_still_matters() -> None:
    """목록 **안**의 순서는 검사 결과를 바꾼다 — 눕히면 안 된다.

    abbrev_sections 는 앞에서부터 찾아 먼저 걸린 절을 약어 목록으로 삼는다.
    '약어 정의' 가 먼저인지 '약어' 가 먼저인지에 따라 다른 절을 짚는다.
    """
    a = _C("A", params={"abbrev_sections": ["약어 정의", "약어"]})
    b = _C("B", params={"abbrev_sections": ["약어", "약어 정의"]})
    assert checker_key(a) != checker_key(b)


def test_unnamed_check_has_no_key() -> None:
    """`check:` 를 안 댄 기준은 검사기가 없다 — 사람 몫으로 떨어진다."""
    assert checker_key(_C("A", check="")) == ""
