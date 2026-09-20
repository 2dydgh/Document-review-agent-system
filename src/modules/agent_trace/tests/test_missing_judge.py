"""누락 판정 — 모델이 말을 떠올리고, 코드가 찾고, 모델이 확인한다.

막으려는 사고: 누락 25건을 검토자가 한글 열어 25번 확인하는 것. 그리고 그 반대
— 기계가 "설계 없음"을 확신으로 굳히거나, 지어낸 인용으로 "설계 있음"을 만드는 것.
"""
from __future__ import annotations

import json
from dataclasses import dataclass

from modules.agent_trace import (
    HAS_DESIGN,
    NO_DESIGN,
    UNKNOWN,
    Judgment,
    apply_judgments,
    judge_missing,
)
from modules.agent_trace.missing_judge import already_searched
from modules.shared import Anchor, Document, Finding, Section, Severity

CHILD_TEXT = ("사용자가 비밀번호를 5회 틀리면 해당 계정의 로그인을 30분간 "
              "차단한다.")
REQUIREMENT = "인증 실패가 반복되면 계정을 일정 시간 잠근다."


@dataclass
class Response:
    text: str
    error: str | None = None


def _child() -> Document:
    return Document(
        source_path="dd.md", doc_type="generic",
        sections=[
            Section(id="3.5", title="계정 보호", level=1, text=CHILD_TEXT,
                    anchor=Anchor(7, "3.5")),
            Section(id="4.1", title="로그 기록", level=1,
                    text="모든 접속 시도를 기록한다.", anchor=Anchor(9, "4.1")),
        ])


def _hits(text: str = CHILD_TEXT, section: str = "계정 보호") -> list[dict]:
    return [{"section": section, "anchor_section": "3.5", "page": None,
             "text": text, "score": 0.4, "shared": ["계정"]}]


class _LLM:
    """정해둔 답을 차례로 준다. 모델이 받은 것을 남긴다."""

    def __init__(self, answers: list[str], error: str | None = None):
        self.answers = answers
        self.seen: list[str] = []
        self.error = error

    def complete(self, prompt: str, **opts) -> Response:
        self.seen.append(prompt)
        if self.error:
            return Response(text="", error=self.error)
        i = min(len(self.seen) - 1, len(self.answers) - 1)
        return Response(text=self.answers[i])


def _words(*ws) -> str:
    return json.dumps(list(ws), ensure_ascii=False)


def _has(quote: str = CHILD_TEXT) -> str:
    return json.dumps({"verdict": HAS_DESIGN, "quote": quote}, ensure_ascii=False)


_NO = json.dumps({"verdict": NO_DESIGN})


# ── 떠올리기 → 찾기 → 확인 ────────────────────────────────────────────────


def test_떠올린_말로_코드가_찾고_모델이_확인한다():
    # probe 는 낱말 겹침이라 "잠근다" ↔ "차단한다" 를 못 잇는다. 그 구간이
    # 떠올리기의 존재 이유다. 찾는 건 코드(Ctrl+F)라 모델이 도구를 고를 일이 없다.
    llm = _LLM([_words("차단", "인증", "로그인"), _has()])

    j = judge_missing("SRS-103", REQUIREMENT, [], _child(), llm)

    assert j.verdict == HAS_DESIGN
    assert j.quote == CHILD_TEXT and j.section == "3.5" and j.page == 7
    # 요건에 있는 말("인증")은 버리고, 새 말만 찾았다.
    assert j.words == ["차단", "로그인"]
    assert j.hits == {"차단": 1, "로그인": 1}
    assert j.read == ["계정 보호 / 3.5"]
    # 확인 프롬프트에 걸린 절의 원문이 실려 갔다.
    assert "[다른 말로 찾아 걸린 절]" in llm.seen[1] and CHILD_TEXT in llm.seen[1]
    assert "이미 찾아봤다" in llm.seen[0]


def test_후보만_있어도_확인은_한다():
    llm = _LLM([_words("차단"), _NO])
    j = judge_missing("SRS-103", REQUIREMENT, _hits(), _child(), llm)
    assert j.verdict == NO_DESIGN
    assert "[하위문서에서 낱말이 겹치는 절]" in llm.seen[1] and CHILD_TEXT in llm.seen[1]


def test_아무_데도_안_걸리면_묻지_않고_없음이다():
    llm = _LLM([_words("암호화", "토큰")])
    j = judge_missing("SRS-103", REQUIREMENT, [], _child(), llm)
    assert j.verdict == NO_DESIGN and j.hits == {} and len(llm.seen) == 1


def test_힌트는_떠올린_말_앞에_서고_구절과_낱말로_다_찾는다():
    llm = _LLM([_words("암호화"), _has()])
    j = judge_missing("SRS-103", REQUIREMENT, [], _child(), llm, hint="로그인 차단")
    assert j.hint == "로그인 차단"
    assert j.words[:3] == ["로그인 차단", "로그인", "차단"]
    assert j.hits["로그인"] == 1 and "로그인 차단" not in j.hits
    assert j.verdict == HAS_DESIGN


def test_인용이_원문과_다르면_설계있음이_아니라_확인못함이다():
    llm = _LLM([_words("차단"), _has("계정을 영구히 차단한다.")])
    j = judge_missing("SRS-103", REQUIREMENT, [], _child(), llm)
    assert j.verdict == UNKNOWN and "인용" in j.reason


def test_호출_실패와_모르는_판정어는_확인못함이다():
    assert "LLM 호출 실패" in judge_missing(
        "SRS-103", REQUIREMENT, _hits(), _child(), _LLM([], error="끊김")).reason
    llm = _LLM([_words("차단"), json.dumps({"verdict": "대충통과"})])
    assert judge_missing("SRS-103", REQUIREMENT, [], _child(), llm).verdict == UNKNOWN


def test_요건_서술이_없으면_묻지_않되_힌트가_있으면_찾는다():
    thin = "| 식별자 사례 | RQ-SFR-VP-01-001 |"
    j = judge_missing("RQ-SFR-VP-01-001", thin, [], _child(), _LLM([]))
    assert j.verdict == UNKNOWN and "서술이 없어" in j.reason
    # 힌트가 있으면 떠올리기는 건너뛰고 힌트로만 찾는다.
    llm = _LLM([_has()])
    j = judge_missing("RQ-SFR-VP-01-001", thin, [], _child(), llm, hint="차단")
    assert j.verdict == HAS_DESIGN and j.words == ["차단"] and len(llm.seen) == 1


def test_already_searched_는_글자와_내용어로_본다():
    assert already_searched("잠근다", REQUIREMENT)
    assert already_searched("일정 시간", REQUIREMENT)      # 글자로 들어 있다
    assert already_searched("시간 일정", REQUIREMENT)      # 내용어가 다 요건 안
    assert not already_searched("차단", REQUIREMENT)
    assert not already_searched("", REQUIREMENT)


# ── 판정은 라벨을 안 바꾼다 ───────────────────────────────────────────────


def _missing_finding(_id: str) -> Finding:
    return Finding(checker="traceability", severity=Severity.MAJOR,
                   message=f"하위문서에 누락된 ID: {_id}",
                   anchor=Anchor(None, "1"), rule_id=_id, document="parent")


def test_설계를_찾아도_등급은_그대로다():
    """라벨은 규칙만 정한다. AI 가 찾은 문장은 화면이 Judgment 로 보여준다."""
    f = _missing_finding("SRS-103")
    j = Judgment("SRS-103", HAS_DESIGN, section="3.5", quote=CHILD_TEXT)
    out = apply_judgments([f], {"SRS-103": j})
    assert out == [f]
    assert j.to_dict()["quote"] == CHILD_TEXT


def test_확인못함은_한_번만_INFO_로_드러낸다():
    fs = [_missing_finding("SRS-1"), _missing_finding("SRS-2")]
    js = {"SRS-1": Judgment("SRS-1", UNKNOWN, reason="연결 실패"),
          "SRS-2": Judgment("SRS-2", UNKNOWN, reason="연결 실패")}
    out = apply_judgments(fs, js)
    majors = [f for f in out if f.severity == Severity.MAJOR]
    infos = [f for f in out if f.severity == Severity.INFO]
    assert len(majors) == 2
    assert len(infos) == 1 and infos[0].unreviewed
    assert "SRS-1" in infos[0].message and "SRS-2" in infos[0].message


def test_상한에_걸린_건수는_보인다():
    out = apply_judgments([_missing_finding("SRS-1")], {}, skipped=12)
    infos = [f for f in out if f.severity == Severity.INFO]
    assert len(infos) == 1 and "12건" in infos[0].message and infos[0].unreviewed


def test_떠올린_말은_되뇐_대괄호를_건너뛰고_배열을_찾는다():
    """실측: 모델이 "[ID: RQ-…]" 를 되뇌고 배열을 냈는데 첫 대괄호에 걸려 못 읽었다."""
    llm = _LLM(['요건 [ID: SRS-103] 을 보면\n```json\n["차단", "로그인"]\n```', _has()])
    j = judge_missing("SRS-103", REQUIREMENT, [], _child(), llm)
    assert j.words == ["차단", "로그인"] and j.verdict == HAS_DESIGN


def test_따옴표_없는_배열도_읽는다():
    """실측(Qwen 27B): `[performance, log, threshold]` 처럼 따옴표 없이 온다."""
    llm = _LLM(["[차단, 로그인, 잠근다]", _has()])
    j = judge_missing("SRS-103", REQUIREMENT, [], _child(), llm)
    assert j.words == ["차단", "로그인"] and j.verdict == HAS_DESIGN


def test_떠올린_말이_다_요건_낱말이어도_후보가_있으면_확인은_한다():
    """실측: 모델이 요건 낱말만 되뇌어 새 말이 0개 — 그래도 겹치는 절은 있으니 묻는다."""
    llm = _LLM([_words("인증", "계정"), _NO])
    j = judge_missing("SRS-103", REQUIREMENT, _hits(), _child(), llm)
    assert j.verdict == NO_DESIGN and j.words == [] and len(llm.seen) == 2


def test_구절은_낱말로도_찾는다():
    llm = _LLM([_words("로그인 차단"), _has()])
    j = judge_missing("SRS-103", REQUIREMENT, [], _child(), llm)
    assert j.words == ["로그인 차단"]
    assert j.hits.get("차단") == 1 and j.hits.get("로그인") == 1 and j.verdict == HAS_DESIGN
