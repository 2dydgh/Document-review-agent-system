"""장절 한정 검사: 코드가 장절을 고르고, 못 찾으면 추측하지 않는다."""
import json
import re
from types import SimpleNamespace

import pytest

from modules.agent_quality import SectionCriteriaChecker, select_sections
from modules.shared import Anchor, Context, Document, ReviewConfig, Section


def page(no, text):
    return Section(str(no), f"{no}쪽", 0, text, Anchor(no, str(no)))


def head(sid, title, text, level=1, children=()):
    return Section(sid, title, level, text, Anchor(None, sid), list(children))


REVISION = "RECORD OF REVISIONS\nRev No. | Date | Status\n00 | 2019.08.21 | First Issue"
REFS = "[1] IEEE Std 1012-2004 Standard for V&V\n[2] RG 1.168, Rev.02"
APPENDIX = "평가 결과 " * 5000     # 한도를 넘기는 부록


def rvvr():
    """실측 RVVR 모양: 제목 없는 앞쪽 + 번호 장 + 거대한 부록."""
    return Document("rvvr.pdf", "pdf", [
        page(1, "문서번호: SKN-16CP-B03-000\n신고리 5,6호기"),
        page(2, REVISION),
        page(7, "CONTENTS\n1.0 Purpose ..... 1\n2.0 Scope ..... 2\n본문에 References 라는 낱말"),
        head("s1", "1.0 Purpose", "이 문서의 목적."),
        head("s3", "3.0 References", "", children=[head("s31", "3.1 Standards", REFS, 2)]),
        head("s4", "4.0 Definition of Terms", "약어 목록"),
        head("sb", "[Appendix B] Checklist", APPENDIX),
    ])


def test_title_and_first_line_matching():
    doc = rvvr()
    assert [s.title for s in select_sections(doc, [r"(?i)^record of revisions"])] == ["2쪽"]
    # 앞 세 줄 밖의 낱말은 걸리지 않는다(7쪽 넷째 줄).
    got = select_sections(doc, [r"^3(\.0)?\s", r"(?i)references"])
    assert [s.title for s in got] == ["3.0 References"]
    # 통합 xlsx 는 "4.0 Definitions and Abbreviations" 인데 실문서는 "Definition of Terms" —
    # 번호 패턴이 받쳐 준다.
    assert [s.title for s in select_sections(doc, [r"^4(\.0)?\s"])] == ["4.0 Definition of Terms"]
    assert select_sections(doc, [r"^9\.0\s"]) == []
    # 표지는 첫 줄로 못 가린다 — 파서가 붙인 쪽 이름으로 고른다.
    assert [s.title for s in select_sections(doc, [r"^1쪽$"])] == ["1쪽"]
    with pytest.raises(re.error):
        select_sections(doc, ["("])


def criterion(no, sections):
    return SimpleNamespace(no=no, text=f"기준 {no}", note="", sections=sections)


def run(doc, criteria, max_chars=20_000, verdict="통과", quote=None):
    prompts = []

    class Stub:
        def complete(self, prompt):
            prompts.append(prompt)
            no = next(c.no for c in criteria if f"기준 {c.no}" in prompt)
            row = {"no": no, "verdict": verdict}
            if verdict == "위반":
                row.update(issue="Rev 누락", kind="표기", quotes=[quote])
            return SimpleNamespace(text=json.dumps({"results": [row]}, ensure_ascii=False),
                                   error=None)

    ck = SectionCriteriaChecker(criteria, max_chars=max_chars)
    findings = ck.check(doc, Context(review=ReviewConfig("generic"), llm=Stub(), rescue_max=0))
    return ck, findings, prompts


def test_only_the_named_section_goes_to_the_model_even_when_document_is_long():
    ck, findings, prompts = run(rvvr(), [criterion("90", [r"^3(\.0)?\s"])])
    assert len(prompts) == 1
    assert "3.1 Standards" in prompts[0] and REFS in prompts[0]   # 하위 장절 포함
    assert "평가 결과" not in prompts[0] and "RECORD OF REVISIONS" not in prompts[0]
    assert ck.verdicts == {"90": "통과"}
    assert "3.0 References" in ck.notes["90"]
    assert not findings


def test_finding_keeps_verified_quote():
    quote = "[2] RG 1.168, Rev.02"
    ck, findings, _ = run(rvvr(), [criterion("91", [r"^3(\.0)?\s"])],
                          verdict="위반", quote=quote)
    assert ck.verdicts["91"] == "위반"
    assert findings and findings[0].rule_id == "91" and findings[0].evidence[0].quote == quote


def test_not_found_in_long_document_is_unreviewed_not_guessed():
    ck, findings, prompts = run(rvvr(), [criterion("31", [r"^TABLE OF CONTENTS"])])
    assert not prompts
    assert ck.verdicts == {"31": "미판정"}
    assert findings and findings[0].unreviewed and findings[0].rule_id == "31"
    assert "찾아본 패턴: ^TABLE OF CONTENTS" in findings[0].message


def test_not_found_in_short_document_reads_whole_document():
    doc = Document("short.md", "md", [head("s1", "개요", "짧은 문서 본문")])
    ck, findings, prompts = run(doc, [criterion("24", [r"(?i)revision"])])
    assert len(prompts) == 1 and "짧은 문서 본문" in prompts[0]
    assert ck.verdicts == {"24": "통과"}
    assert "문서 전체" in ck.notes["24"] and not findings


def test_sections_that_fit_one_by_one_are_asked_in_several_calls():
    doc = Document("rvvr.pdf", "pdf", [
        head("a", "[Appendix A] 평가표", "가 " * 6000),
        head("b", "[Appendix B] 평가표", "나 " * 6000),
    ])
    ck, findings, prompts = run(doc, [criterion("82", [r"^\[Appendix"])])
    assert len(prompts) == 2
    assert "[Appendix A]" in prompts[0] and "[Appendix B]" not in prompts[0]
    assert ck.verdicts == {"82": "통과"} and "2번 나눠" in ck.notes["82"]


def test_section_over_limit_is_unreviewed():
    ck, findings, prompts = run(rvvr(), [criterion("79", [r"^\[Appendix B\]"])])
    assert not prompts and ck.verdicts == {"79": "미판정"}
    assert findings[0].unreviewed and "한도" in findings[0].message


def test_broken_pattern_is_unreviewed():
    ck, findings, prompts = run(rvvr(), [criterion("x", ["("])])
    assert not prompts and ck.verdicts == {"x": "미판정"}
    assert "패턴" in findings[0].message


def test_truncated_answer_is_reported_per_criterion_with_its_reason():
    """출력 한도에 끊긴 답은 '응답 없음'이 아니라 '잘림'이고, 그 기준만 못 본 것이다."""
    doc = rvvr()
    criteria = [criterion("4", [r"^1\.0\s"]), criterion("90", [r"^3(\.0)?\s"])]

    class Stub:
        def complete(self, prompt):
            if "기준 4" in prompt:
                return SimpleNamespace(text='{"results": [{"no": "4", "verdict": "위',
                                       error=None, truncated=True)
            return SimpleNamespace(text=json.dumps({"results": [{"no": "90", "verdict": "통과"}]}),
                                   error=None, truncated=False)

    ck = SectionCriteriaChecker(criteria, max_chars=20_000)
    findings = ck.check(doc, Context(review=ReviewConfig("generic"), llm=Stub(), rescue_max=0))
    assert ck.verdicts == {"4": "미판정", "90": "통과"}
    assert ck.failures["4"][:2] == (1, 1) and "잘려" in ck.failures["4"][2]
    assert ck.failures["90"] == (0, 1, None)
    notice = next(f for f in findings if f.unreviewed)
    # 부분 실패는 못 본 절을 짚어 보고한다(계보가 그 절만 "판단 못 함"으로 둔다).
    assert notice.message.startswith("장절 점검에서 §7 구간") and "1/2회" in notice.message
    assert "출력 한도" in notice.message
