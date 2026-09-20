"""근거가 주장을 반박하면 지적을 내지 않는다 (`_evidence_refutes_swap`).

인용 대조는 인용이 실재하는지만 본다. 실재하는 인용이 틀린 주장을 받칠 수도 있다.
실측(2026-08-25, PRJX-DS-014 상세설계서): "ORGA 와 OGB 의 기관 명칭이 문서 내에서
서로 뒤바뀌어 사용되고 있다" — 근거 셋이 전부 ORGA=중앙해양안전심판원,
OGB=해양경찰청 이었다. 문서는 멀쩡했고 MAJOR 로 나갔다.

**좁게 건다.** 뒤바뀜·혼용 주장에서 근거의 약어↔한글명 짝이 한결같을 때만 버린다.
짝을 못 뽑거나 다른 종류의 모순이면 손대지 않는다 — 넓히면 진짜 모순이 죽는다.
"""
from __future__ import annotations

from modules.agent_quality.consistency import _evidence_refutes_swap

# 실측 근거 그대로
_REAL = [
    "중앙해양안전심판원(ORGA)과 해양경찰청(OGB)의 사고 정보를 통합하여 상세 사고 정보를 생성함",
    "DS-SBD-PR-03-001 | accident_kcg_2023 | 해양경찰청 사고 정보",
    "DS-SBD-PR-03-002 | accident_orga_2023 | 중앙해양안전심판원 사고 정보",
]


def test_실측_ORGA_OGB_지적은_근거가_한결같아_버린다():
    msg = "ORGA와 OGB의 기관 명칭이 문서 내에서 서로 뒤바뀌어 사용되고 있다."
    assert _evidence_refutes_swap(msg, _REAL)


def test_근거가_실제로_엇갈리면_살린다():
    """같은 약어에 두 한글명 — 이건 진짜 뒤바뀜이다."""
    quotes = ["중앙해양안전심판원(ORGA)의 자료", "해양경찰청(ORGA)의 자료", "해양경찰청(OGB)"]
    assert not _evidence_refutes_swap("ORGA와 OGB가 뒤바뀌어 쓰인다", quotes)


def test_뒤바뀜_주장이_아니면_건드리지_않는다():
    assert not _evidence_refutes_swap("식별자가 목록과 상세에서 다르게 표기되어 있다", _REAL)


def test_짝을_못_뽑으면_판단하지_않는다():
    assert not _evidence_refutes_swap("A와 B가 뒤바뀌었다", ["아무 짝도 없는 문장이다"])


def test_짝이_하나뿐이면_서로_뒤바뀜을_잴_수_없다():
    assert not _evidence_refutes_swap("ORGA가 뒤바뀌어 쓰인다", ["중앙해양안전심판원(ORGA)"])
