"""형광펜은 글자 위에만 얹힌다 — 표 칸 사이 빈 자리를 덮지 않는다.

무슨 일이 났나 (2026-08-31, PRJX-DS-014 42쪽). 표 한 행을 인용하면
`| 제목 | 해양사고 목록 조회 API | ID | DS-SID-PR-03-002 |` 처럼 여러 칸이
한 인용에 들어온다. 예전에는 줄의 좌우 끝을 이어 사각형 하나를 만들어서,
글자가 없는 칸 경계(47~69pt)까지 덮은 **행 전체를 가로지르는 바**가 됐다.

겸해서 한 행이 두 줄로 갈렸다. `int(round(top))` 으로 묶는데 실측 top 이
97.5 · 98.4 · 99.0 이라(한글/영문 baseline 차이) 98 과 99 로 나뉘어,
`API` 한 낱말만 상자가 따로 생겨 그 바 위에 겹쳤다.
"""
from __future__ import annotations

from modules.report.annotate_pdf import _boxes

_H = 800.0          # 쪽 높이. 상자는 아래에서 재므로 x 만 보면 된다.


def _w(text: str, x0: float, x1: float, top: float, height: float = 11.0) -> dict:
    return {"text": text, "x0": x0, "x1": x1, "top": top, "bottom": top + height}


def _xs(boxes) -> list[tuple[int, int]]:
    return [(round(b[0]), round(b[2])) for b in boxes]


def test_표_칸_사이_빈_자리를_안_덮는다():
    """실측값 그대로. 칸마다 상자 하나, 경계는 비워 둔다."""
    row = [_w("제목", 118.3, 136.6, 98.4),
           _w("해양사고", 184.0, 220.5, 98.4),
           _w("목록", 222.5, 240.8, 98.4),
           _w("조회", 242.9, 261.2, 98.4),
           _w("API", 263.4, 279.0, 99.0),
           _w("ID", 347.6, 359.5, 97.5),
           _w("DS-SID-PR-03-002", 423.2, 511.6, 97.5)]
    assert _xs(_boxes(row, _H)) == [(118, 137), (184, 279), (348, 360), (423, 512)]


def test_한_행이_baseline_차이로_안_갈린다():
    """top 이 1pt 안팎 흔들려도 한 줄이다 — 갈리면 같은 자리에 상자가 겹친다."""
    row = [_w("가나다", 100.0, 130.0, 97.5), _w("API", 132.0, 148.0, 99.0)]
    assert len(_boxes(row, _H)) == 1


def test_산문은_한_덩어리다():
    """낱말 사이는 글자 높이의 1.5배를 안 넘는다 — 쪼개지면 안 된다."""
    row = [_w("외부", 100.0, 118.0, 200.0),
           _w("클라이언트가", 120.2, 175.0, 200.0),
           _w("API", 177.1, 193.0, 200.0),
           _w("서비스에", 195.3, 231.0, 200.0)]
    assert _xs(_boxes(row, _H)) == [(100, 231)]


def test_두_줄에_걸치면_줄마다_하나다():
    """한 사각형으로 감싸면 첫 줄 끝과 둘째 줄 시작 사이 여백까지 덮는다."""
    words = [_w("첫줄", 100.0, 140.0, 200.0), _w("끝", 142.0, 160.0, 200.0),
             _w("둘째줄", 100.0, 150.0, 214.0)]
    assert _xs(_boxes(words, _H)) == [(100, 160), (100, 150)]


def test_기울어져도_사슬로_이어붙지_않는다():
    """줄의 **첫 낱말**과 견준다. 직전 낱말과 견주면 조금씩 밀리는 top 이
    사슬처럼 이어져 아래 줄까지 한 줄로 삼킨다."""
    words = [_w("a", 100.0, 110.0, 200.0), _w("b", 112.0, 122.0, 202.0),
             _w("c", 124.0, 134.0, 204.0), _w("d", 136.0, 146.0, 206.0)]
    # 200 기준 ±2.5 안은 202 까지. 204·206 은 다음 줄로 떨어진다.
    assert len(_boxes(words, _H)) > 1


def test_strict_page_는_그_쪽_근처만_본다() -> None:
    """비슷한 곳 후보는 표마다 되풀이되는 칸이라 문서 전체에서 찾으면 엉뚱한 쪽의
    첫 출현으로 간다 — 카드는 21쪽, 뷰어는 12쪽(2026-09-08 실측)."""
    from modules.report.annotate_pdf import _candidate_pages
    assert _candidate_pages({"page": 21, "strict_page": True}, {}, 54) == [20, 21, 19]
    assert _candidate_pages({"page": 1, "strict_page": True}, {}, 54) == [0, 1]
    # 절의 쪽 범위를 알면 그 범위(시작 쪽부터 다음 절 시작 쪽까지)만 본다.
    ranged = _candidate_pages({"page": 11, "page_end": 14, "strict_page": True}, {}, 54)
    assert ranged == [10, 11, 12, 13]
    # 힌트만 있고 strict 가 아니면 거기부터 전부 본다(옛 동작 그대로).
    pages = _candidate_pages({"page": 21}, {}, 54)
    assert pages[0] == 20 and len(pages) == 54
