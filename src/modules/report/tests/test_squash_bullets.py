"""형광펜 위치 찾기의 문자열 정규화(`_squash`)가 글머리 기호를 지우는가.

LibreOffice 가 hwpx 를 PDF 로 바꿀 때 글머리 목록 항목마다 Symbol 글꼴의 사각점
(U+F06C, Private Use Area)을 텍스트 레이어에 찍는다. 파서 인용에는 그 글자가 없어
붙여 찾기가 어긋난다 — 실측(PRJX-DS-014 §3.1.1.2): 셀 안 항목이 셋인 표 행 4건이
전부 거기서 끊겨 번호를 못 받았다.
"""
from __future__ import annotations

from modules.report.annotate_pdf import _squash

_PDF = "전달함외부HTTP요청수신요청파라미터유효성검증요청에따른서비스로직분기TBD"
_QUOTE = ("| 전달함 | 외부 HTTP 요청 수신 요청 파라미터 유효성 검증 "
          "요청에 따른 서비스 로직 분기 | TBD |")


def test_글머리_기호가_있어도_인용과_PDF_가_같아진다():
    assert _squash(_QUOTE) == _squash(_PDF)


def test_공백과_파이프는_예전처럼_지운다():
    assert _squash("| a b | c |") == "abc"


def test_일반_글자는_안_건드린다():
    assert _squash("한글English123") == "한글English123"


def test_같은_인용의_N번째_출현을_찾는다():
    """`| 출처 | TBD |` 가 한 쪽에 세 번 — skip 으로 둘째·셋째를 짚는다."""
    from modules.report.annotate_pdf import _count, _find, _squash
    words = [{"text": t, "x0": i, "x1": i + 1, "top": i, "bottom": i + 1}
             for i, t in enumerate(["출처", "TBD", "출처", "TBD", "출처", "TBD"])]
    hay = _squash("".join(w["text"] for w in words))
    owner = []
    for i, w in enumerate(words):
        owner.extend([i] * len(_squash(w["text"])))
    index = (hay, owner)
    assert _count("| 출처 | TBD |", index) == 3
    assert [w["x0"] for w in _find("| 출처 | TBD |", index, words, skip=0)] == [0, 1]
    assert [w["x0"] for w in _find("| 출처 | TBD |", index, words, skip=1)] == [2, 3]
    assert [w["x0"] for w in _find("| 출처 | TBD |", index, words, skip=2)] == [4, 5]
    assert _find("| 출처 | TBD |", index, words, skip=3) is None


def test_같은_인용이_여러_절에_흩어지면_문서_순서대로_배정한다():
    """실측: `| 출처 | TBD |` 가 다섯 절에 30회 — 예전엔 전부 첫 출현 한 자리에 겹쳤다."""
    from modules.report.annotate_pdf import _section_key
    assert _section_key("3.1.3.1") == (3, 1, 3, 1)
    assert _section_key("3.1.1.2") < _section_key("3.1.3.1") < _section_key("3.1.5.4")
    assert _section_key(None) > _section_key("9.9")
    assert _section_key("Appendix A") == (10**6,)
