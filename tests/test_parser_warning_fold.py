"""같은 사유의 "N쪽 그림 …" 경고를 한 카드로 접는가 (`_fold_figure_warnings`).

실측(AX품질팀 상세설계서): 그림 18장이 같은 이유로 안 읽혀 같은 문장이 20장 연달아
INFO 로 떴고, 그 아래 진짜 지적 3건이 묻혔다. 사실은 하나도 지우지 않는다 — 쪽을
전부 싣고 몇 장인지 센다. 문장이 한 글자라도 다르면 다른 사유라 따로 남긴다.
"""
from __future__ import annotations

from app.orchestrator import _fold_figure_warnings, _page_ranges

_MSG = "을 문서에서 꺼내지 못했습니다. 이 그림 안의 글자는 검토하지 않았습니다."


def test_같은_사유는_쪽_목록_하나로_접는다():
    got = _fold_figure_warnings([f"{p}쪽 그림{_MSG}" for p in (1, 8, 10, 11, 12, 25)])

    assert got == [f"그림 6장(1·8·10~12·25쪽){_MSG}"]


def test_쪽이_하나면_원문_그대로_둔다():
    got = _fold_figure_warnings([f"3쪽 그림{_MSG}"])

    assert got == [f"3쪽 그림{_MSG}"]


def test_사유가_다르면_따로_남긴다():
    """오류 메시지가 다른 두 그림을 하나로 뭉치면 무엇이 났는지가 사라진다."""
    a = "2쪽 그림을 읽다가 오류가 났습니다 → timeout. 이 그림 안의 글자는 검토하지 않았습니다."
    b = "5쪽 그림을 읽다가 오류가 났습니다 → 404. 이 그림 안의 글자는 검토하지 않았습니다."

    got = _fold_figure_warnings([a, b])

    assert got == [a, b]


def test_그림_경고가_아닌_것은_손대지_않고_순서를_지킨다():
    other = "본문의 [그림 N] 표시 2개와 문서에서 뽑은 그림 26개의 수가 다릅니다."
    got = _fold_figure_warnings([f"4쪽 그림{_MSG}", other, f"6쪽 그림{_MSG}"])

    assert got == [f"그림 2장(4·6쪽){_MSG}", other]


def test_쪽이_없는_그림_경고는_그대로_둔다():
    """figure_label 은 쪽을 모르면 "그림" 이라고만 쓴다 — 접을 근거가 없다.

    똑같은 문장의 중복 제거는 이 함수 몫이 아니라 호출부의 dict.fromkeys 몫이다."""
    w = f"그림{_MSG}"

    assert _fold_figure_warnings([w]) == [w]


def test_쪽_범위_표기():
    assert _page_ranges([1]) == "1"
    assert _page_ranges([1, 2, 3]) == "1~3"
    assert _page_ranges([1, 3, 4, 5, 9]) == "1·3~5·9"


_PAGE = ("pdf-inspector 마크다운 추출 실패(needs_ocr 사유=suspected_garbled_text)이지만 "
         "원문 텍스트는 정상 추출됨 — 스캔이 아니라 추출 실패로 보고 OCR 대신 PyMuPDF 텍스트 사용")


def test_쪽별_파서_경고도_쪽_목록_하나로_접는다():
    """실측(2026-09-15, SYSA RVVR Rev05 수정본): 부록 쪽마다 같은 경고가 9장 떴다."""
    other = "표 1개는 셀 텍스트를 다시 뽑지 못했습니다"
    got = _fold_figure_warnings([f"p{p}: {_PAGE}" for p in (34, 36, 37, 38)] + [other])

    assert got == [f"p34·36~38 (4쪽): {_PAGE}", other]


def test_쪽별_경고가_하나면_원문_그대로다():
    assert _fold_figure_warnings([f"p5: {_PAGE}"]) == [f"p5: {_PAGE}"]
