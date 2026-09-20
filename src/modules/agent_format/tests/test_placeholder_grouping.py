"""미작성 표시 지적은 **절 하나에 카드 하나**다.

무슨 일이 났나 (2026-08-26, PRJX-DS-014 상세설계서): 자리마다 카드를 내니
TBD 지적이 23장 나와 리포트 번호 2~49 를 차지했다. 정작 읽어야 할 일관성 지적
4건(식별자 불일치 등)이 그 아래 묻혔다.

`AbbrevChecker._listed` 가 같은 이유로 이미 묶고 있었다 — "낱개로 내면 실문서
하나에서 174건이 쏟아진다. 그 목록은 아무도 안 읽고 **다른 검사의 지적까지
파묻는다**". placeholder 만 그 처방을 안 받고 있었다.

**묶되 잃지 않아야 한다.** 자리별 위치는 evidence 가 진다 — 뷰어가 그것으로
형광펜을 칠하고 번호를 매기므로, 근거를 줄이면 카드에서 그 자리로 못 간다.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from modules.agent_format.placeholder import (
    PlaceholderChecker,
    _compile,
    _row_label,
)

_RX = _compile(["TBD"])


@dataclass
class _Anchor:
    page: int | None = None
    section: str = "§3.1.3.1"


@dataclass
class _Section:
    text: str
    anchor: _Anchor = field(default_factory=_Anchor)


@dataclass
class _Doc:
    sections: list

    def iter_sections(self):
        return iter(self.sections)


@dataclass
class _Review:
    placeholder_markers: tuple = ("TBD",)


@dataclass
class _Ctx:
    review: _Review = field(default_factory=_Review)


ROWS = "\n".join([
    "| DS-SID-PR-03-001 | 해양사고 목록 조회 API | HTTP | 요청 시 | TBD |",
    "| DS-SID-PR-03-002 | 사고대응정보 조회 API | HTTP | 요청 시 | TBD |",
    "| DS-SID-PR-03-003 | 내부 DB 연계 | SQLAlchemy | 요청 시 | TBD |",
    "| 출처 | TBD |",
    "| 출처 | TBD |",
])


def _run(text: str, section: str = "§3.1.3.1"):
    doc = _Doc([_Section(text, _Anchor(section=section))])
    return PlaceholderChecker().check(doc, _Ctx())


# ── 묶기 ──────────────────────────────────────────────────────────────

def test_one_card_per_section() -> None:
    got = _run(ROWS)
    assert len(got) == 1, f"절 하나에 카드 하나여야 한다: {[f.message for f in got]}"


def test_card_counts_distinct_spots() -> None:
    """되풀이되는 줄은 한 자리로 센다 — `출처 | TBD` 둘은 합쳐 한 곳이다."""
    (f,) = _run(ROWS)
    assert "4곳" in f.message, f.message


def test_card_names_every_row() -> None:
    (f,) = _run(ROWS)
    for name in ("DS-SID-PR-03-001", "DS-SID-PR-03-002", "DS-SID-PR-03-003"):
        assert name in f.message, f"{name} 이 카드에 없다: {f.message}"
    assert "출처(2회)" in f.message, f"되풀이 횟수를 말해야 한다: {f.message}"


def test_sections_do_not_merge() -> None:
    """절이 다르면 카드도 다르다 — 어느 절이 덜 채워졌나가 검토자의 질문이다."""
    doc = _Doc([_Section("| A | TBD |", _Anchor(section="§1")),
                _Section("| B | TBD |", _Anchor(section="§2"))])
    got = PlaceholderChecker().check(doc, _Ctx())
    assert len(got) == 2
    assert {f.anchor.section for f in got} == {"§1", "§2"}


# ── 묶어도 잃지 않는다 ────────────────────────────────────────────────

def test_every_occurrence_keeps_its_evidence() -> None:
    """근거는 자리 수만큼. 줄이면 카드에서 그 자리로 못 간다."""
    (f,) = _run(ROWS)
    assert len(f.evidence) == 5, f"근거 5개여야 한다: {len(f.evidence)}"
    assert sum(1 for e in f.evidence if "출처" in e.quote) == 2


def test_repeated_quotes_are_consecutive() -> None:
    """뷰어는 같은 인용의 N 번째 출현을 찾는다(annotate_pdf._find 의 nth).

    같은 인용이 흩어져 있으면 N 번째 계산이 어긋나 형광펜이 엉뚱한 자리로 간다.
    """
    (f,) = _run(ROWS)
    quotes = [e.quote for e in f.evidence]
    for q in set(quotes):
        idx = [i for i, x in enumerate(quotes) if x == q]
        assert idx == list(range(idx[0], idx[0] + len(idx))), f"흩어졌다: {q}"


def test_many_spots_are_truncated_but_evidence_is_not() -> None:
    """이름은 줄여도 근거는 전부 싣는다 — 형광펜은 다 붙어야 한다."""
    text = "\n".join(f"| 행{i} | TBD |" for i in range(20))
    (f,) = _run(text)
    assert "외 12곳" in f.message, f.message
    assert len(f.evidence) == 20


def test_no_placeholder_no_card() -> None:
    assert _run("| A | 채워짐 |") == []


# ── 이름 붙이기 ───────────────────────────────────────────────────────

def test_row_label_is_the_first_non_marker_cell() -> None:
    row = "| DS-SID-PR-03-001 | 조회 API | HTTP | TBD |"
    assert _row_label(row, _RX) == "DS-SID-PR-03-001"


def test_row_label_skips_empty_leading_cell() -> None:
    """실측(§3.1.5.4): 첫 칸이 빈 행에서 이름이 ''  이 되어 어느 행인지 몰랐다."""
    row = "|  | 사고정보 표출 화면 | DS-SUD-PR-03-002 | 설명 | TBD |"
    assert _row_label(row, _RX) == "사고정보 표출 화면"


def test_row_label_falls_back_to_the_line() -> None:
    assert _row_label("여기는 TBD 입니다", _RX) == "여기는 TBD 입니다"


def test_same_label_on_different_lines_counts_once() -> None:
    """실측(§3.1.1.2): 뒤 칸만 다른 두 줄이 "API 요청 처리, API 요청 처리" 로
    같은 이름을 두 번 늘어놓았다. 읽는 사람에게는 버그로 보인다."""
    text = "\n".join([
        "| API 요청 처리 | 진입점 | 수신 | TBD |",
        "| API 요청 처리 | 진입점 | 분기 | TBD |",
        "| 시스템 관리 | 공통 기능 | 설정 | TBD |",
    ])
    (f,) = _run(text)
    assert f.message.count("API 요청 처리") == 1, f.message
    assert "API 요청 처리(2회)" in f.message, f.message
    assert "2곳" in f.message, f.message
    assert len(f.evidence) == 3, "근거는 줄마다 그대로 남아야 한다"
