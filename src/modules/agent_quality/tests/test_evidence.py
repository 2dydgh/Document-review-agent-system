import json
from types import SimpleNamespace

import pytest

from modules.agent_quality import EvidenceCriteriaChecker, select_evidence
from modules.shared import Anchor, Context, Document, Section, Severity


def document(texts):
    return Document("synthetic.pdf", "pdf", [
        Section(str(i), "", 1, t, Anchor(i + 1, str(i))) for i, t in enumerate(texts)
    ])


LEFT = "입력 신호 TEMP_VALUE의 설정 범위는 0~100이다."
RIGHT = "입력 신호 TEMP_VALUE의 설정 범위는 0~200이다."


def test_selection_searches_end_of_document_and_stays_in_budget():
    doc = document([LEFT] + ["관련 없는 배경 설명입니다. " * 200] * 80 + [RIGHT])
    units = select_evidence(doc, ["입력"], 300)
    assert len("\n\n".join(c.text for c in units)) <= 300
    assert [c.anchor.page for c in units] == [1, 82]
    assert units[0].text == LEFT and units[1].text == RIGHT


def test_selection_does_not_spend_entire_budget_at_start():
    doc = document([f"signal value {i} " + "x" * 80 for i in range(100)])
    units = select_evidence(doc, ["signal"], 200)
    assert [c.anchor.page for c in units] == [1, 100]


def row(**updates):
    result = {"no": "demo", "verdict": "위반", "kind": "모순",
              "issue": "동일 입력 신호의 설정 범위가 다릅니다.",
              "quotes": [LEFT, RIGHT],
              "conflict": {"subject": "TEMP_VALUE", "left_value": "0~100",
                           "right_value": "0~200"}}
    result.update(updates)
    return result


def run(result, doc=None):
    prompts, events = [], []

    class Stub:
        def complete(self, prompt):
            prompts.append(prompt)
            return SimpleNamespace(text=json.dumps({"results": [result]}, ensure_ascii=False),
                                   error=None)

    criterion = SimpleNamespace(no="demo", text="신호의 범위 일관성", note="",
                                evidence_terms=["입력"])
    ck = EvidenceCriteriaChecker([criterion], max_chars=500)
    ctx = Context(review=None, llm=Stub(), on_progress=events.append)
    doc = doc or document([LEFT, RIGHT])
    plan = ck.plan(doc, ctx)
    findings = ck.check(doc, ctx)
    return ck, findings, prompts, events, plan


def test_real_pair_keeps_both_original_locations_and_partial_notice():
    ck, findings, prompts, events, plan = run(row())
    defects = [f for f in findings if f.severity != Severity.INFO]
    assert len(defects) == 1
    assert [e.anchor.page for e in defects[0].evidence] == [1, 2]
    assert ck.verdicts["demo"] == "위반"
    assert any(f.unreviewed and f.rule_id == "demo" for f in findings)
    assert "문서 전체" in ck.notes["demo"]
    assert "전체 문서가 아님" in prompts[0]
    assert plan["total"] == len(prompts) == events[-1]["step"]["total"] == 1


@pytest.mark.parametrize("result", [
    row(verdict="통과"), row(verdict="해당없음"),
    row(kind="모호", issue="원문 발췌에 설명이 없습니다."),
    row(quotes=[LEFT]), row(quotes=[LEFT, LEFT]),
    row(quotes=[LEFT, "입력 신호 TEMP_VALUE의 설정 범위는 0~999이다."]),
    row(conflict={}),
    row(conflict={"subject": "VALUE", "left_value": "0~100", "right_value": "0~200"}),
    row(conflict={"subject": "TEMP_VALUE", "left_value": "0~100", "right_value": "0~100"}),
    row(conflict={"subject": "TEMP_VALUE", "left_value": "100", "right_value": "2"}),
])
def test_partial_context_cannot_establish_pass_absence_or_invented_pair(result):
    ck, findings, *_ = run(result)
    assert ck.verdicts["demo"] == "미판정"
    assert not [f for f in findings if f.severity != Severity.INFO]
    assert any(f.unreviewed for f in findings)


def test_no_search_hit_never_calls_llm_or_claims_absence():
    ck, findings, prompts, events, plan = run(row(), document(["관련 없는 본문입니다."]))
    assert not prompts and not events
    assert plan["total"] == ck.calls == 0
    assert ck.verdicts["demo"] == "미판정"
    assert "내용이 없다는 뜻이 아닙니다" in findings[0].message


def test_unselected_real_quotes_cannot_be_used_as_evidence():
    # 원문에 있더라도 제공되지 않은 구간의 값을 아는 척할 수 없다.
    ck = EvidenceCriteriaChecker([])
    assert not ck._accept_row(row(), LEFT, document([LEFT, RIGHT]))


def test_llm_failure_is_reported():
    criterion = SimpleNamespace(no="demo", text="신호 일관성", note="", evidence_terms=["입력"])
    llm = SimpleNamespace(complete=lambda prompt: SimpleNamespace(text="", error="test failure"))
    ck = EvidenceCriteriaChecker([criterion])
    findings = ck.check(document([LEFT, RIGHT]), Context(review=None, llm=llm))
    assert ck.calls == ck.unanswered == 1
    assert ck.verdicts["demo"] == "미판정"
    assert any(f.unreviewed for f in findings)


def test_형식이_틀린_답은_한_번_더_묻는다():
    """답은 왔는데 판정 JSON 이 아니면 같은 질문을 딱 한 번 더 한다. 두 번째가 되면
    정상 판정, 두 번째도 아니면 이유를 남기고 미검토."""
    criterion = SimpleNamespace(no="demo", text="신호 일관성", note="", evidence_terms=["입력"])
    answers = ["이 조각에는 문제가 없어 보입니다.",   # 말로 답함 — 형식 실패
               '{"results": []}']
    calls = []

    def complete(prompt):
        calls.append(prompt)
        return SimpleNamespace(text=answers[len(calls) - 1], error=None)
    llm = SimpleNamespace(complete=complete)
    ck = EvidenceCriteriaChecker([criterion])
    findings = ck.check(document([LEFT, RIGHT]), Context(review=None, llm=llm))
    assert len(calls) == 2 and ck.unanswered == 0
    assert not any("응답을 받지 못" in f.message for f in findings)

    calls.clear()
    answers[:] = ["말로만 답함", "또 말로만 답함"]
    ck = EvidenceCriteriaChecker([criterion])
    findings = ck.check(document([LEFT, RIGHT]), Context(review=None, llm=llm))
    assert len(calls) == 2 and ck.unanswered == 1
    assert any("판정 JSON 형식이 아님" in f.message for f in findings)
