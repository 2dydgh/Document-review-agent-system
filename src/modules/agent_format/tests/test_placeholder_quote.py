"""미완성 표시 지적의 인용이 **어느 칸인지** 짚는가 (`placeholder._quote`).

실측(AX품질팀 상세설계서): TBD 가 든 줄 49개가 전부 표 행이고 마커는 4번째 칸에
있었다. 행을 통째로 80자로 자르면 TBD 가 든 칸이 화면에 안 나온다 — 검토자는 관계없는
앞 칸 설명만 보고 무엇이 미완성인지 모른다.
"""
from __future__ import annotations

from modules.agent_format.placeholder import _compile, _quote

_RX = _compile(["TBD"])


def test_표_행이면_라벨과_마커_칸만_인용한다():
    row = ("| API 요청 처리 | API 서버의 진입점으로, 외부 시스템의 HTTP 요청을 수신하고 "
           "유효성을 검증하여 내부 로직으로 전달함 | 외부 HTTP 요청 수신 | TBD |")

    assert _quote(row, _RX) == "'API 요청 처리' 행의 4번째 칸: TBD"


def test_마커가_여러_칸이면_전부_짚는다():
    row = "| 출처 | TBD | 비고 | TBD |"

    assert _quote(row, _RX) == "'출처' 행의 2번째 칸·4번째 칸: TBD / TBD"


def test_표가_아니면_예전처럼_줄을_자른다():
    long = "본문 " * 40 + "TBD"

    got = _quote(long, _RX)

    assert got.endswith("…") and len(got) == 81


def test_짧은_본문은_그대로():
    assert _quote("여기는 TBD 입니다", _RX) == "여기는 TBD 입니다"


def test_칸이_하나뿐인_표는_통째로():
    """라벨과 마커 칸이 같은 칸이면 짚을 게 없다 — 자르기만 한다."""
    assert _quote("| TBD |", _RX) == "| TBD |"


def test_첫_칸이_비면_다음_칸을_라벨로_쓴다():
    """실측 §3.1.5.4: `|  | 사고정보 표출 화면 | DS-SUD-PR-03-002 | 설명 | TBD |`."""
    row = "|  | 사고정보 표출 화면 | DS-SUD-PR-03-002 | 사용자가 조회하는 화면 | TBD |"

    assert _quote(row, _RX) == "'사고정보 표출 화면' 행의 5번째 칸: TBD"


def test_같은_줄이_여러_번이면_근거도_그만큼_싣는다():
    """실측 §3.1.4.2: `| 출처 | TBD |` 5회 — 근거 하나면 형광펜이 첫 번째에만 간다."""
    from types import SimpleNamespace

    from modules.agent_format.placeholder import PlaceholderChecker
    from modules.shared import Anchor
    sec = SimpleNamespace(text="| 출처 | TBD |\n| 출처 | TBD |\n| 출처 | TBD |",
                          anchor=Anchor(page=1, section="3.1.4.2"))
    doc = SimpleNamespace(iter_sections=lambda: [sec])
    ctx = SimpleNamespace(review=SimpleNamespace(placeholder_markers=("TBD",)))
    got = PlaceholderChecker().check(doc, ctx)
    assert len(got) == 1 and "3회" in got[0].message
    assert [e.quote for e in got[0].evidence] == ["| 출처 | TBD |"] * 3
