"""항목별 초안: 모델은 떠올리고 판단만, 찾기와 인용 대조는 코드가 한다."""
from __future__ import annotations

import json

from modules.agent_generate import (
    DRAFTED,
    NOT_FOUND,
    NOT_FOUND_STATUS,
    SATISFIED,
    UNREVIEWED,
    EvalItem,
    draft_evaluation,
)
from modules.llm_client.base import Response
from modules.shared import Anchor, Document, Section

ACC = "The accuracy of each measured value shall be within plus or minus one percent."
NET = "Signals are exchanged with the network interface every second."


def _doc() -> Document:
    return Document(source_path="SRS.pdf", doc_type=None, sections=[
        Section(id="s1", title="3.2.4 Accuracy", level=2, text=ACC,
                anchor=Anchor(page=12, section="s1")),
        Section(id="s2", title="4.1 Interfaces", level=2, text=NET,
                anchor=Anchor(page=20, section="s2")),
    ])


class _LLM:
    """정해둔 답을 차례로 준다. 받은 프롬프트를 남긴다."""

    def __init__(self, answers: list[str], error: str | None = None):
        self.answers, self.seen, self.error = answers, [], error

    def complete(self, prompt: str, **opts) -> Response:
        self.seen.append(prompt)
        if self.error:
            return Response(text="", error=self.error)
        i = min(len(self.seen) - 1, len(self.answers) - 1)
        return Response(text=self.answers[i])


ITEM = EvalItem(id="VR01-01", item="Accuracy requirements should be provided.",
                item_ko="정확도 요건이 있는가")


def _ok(quote: str = ACC, ids=("s1",), verdict: str = SATISFIED) -> str:
    return json.dumps({"verdict": verdict, "comment": "Section 3.2.4 provides accuracy.",
                       "section_ids": list(ids), "quotes": [quote]})


def test_인용이_문서에_있으면_제안_판정과_절_인용이_실린다() -> None:
    llm = _LLM(['["accuracy", "percent"]', _ok()])
    out = draft_evaluation(_doc(), [ITEM], llm, concurrency=1)
    row = out.rows[0]
    assert row.verdict_hint == SATISFIED
    assert row.sections == ["3.2.4 Accuracy"]
    assert row.quotes[0]["quote"] == ACC and row.quotes[0]["page"] == 12
    assert row.words == ["accuracy", "percent"] and row.status == DRAFTED
    assert out.unfound == 0 and out.llm_failures == 0 and out.unreviewed == 0
    # 확인 프롬프트에는 찾은 절만 들어간다 — 안 걸린 절은 보여주지 않는다.
    assert ACC in llm.seen[1] and NET not in llm.seen[1]


def test_인용이_문서에_없으면_초안을_버리고_미검토로_센다() -> None:
    """대조에 실패한 것은 "문서에 없다"가 아니라 "모델 주장을 버렸다"다 — 근거
    없음으로 세면 검토자가 '문서에 그게 없구나' 로 읽는다."""
    llm = _LLM(['["accuracy"]', _ok(quote="The accuracy shall be within 0.5 percent.")])
    out = draft_evaluation(_doc(), [ITEM], llm, concurrency=1)
    row = out.rows[0]
    assert row.verdict_hint == NOT_FOUND and row.status == UNREVIEWED
    assert row.comment == "" and row.quotes == []
    assert "인용" in row.reason
    assert out.unreviewed == 1 and out.unfound == 0


def test_보여주지_않은_절_번호는_지운다() -> None:
    llm = _LLM(['["accuracy"]', _ok(ids=("s2",))])
    row = draft_evaluation(_doc(), [ITEM], llm, concurrency=1).rows[0]
    assert row.verdict_hint == NOT_FOUND and "절" in row.reason
    assert row.status == UNREVIEWED


def test_떠올린_말이_하나도_안_걸리면_묻지_않는다() -> None:
    """문서를 실제로 찾아봤고 없었다 — 이것만이 "근거 없음" 이다."""
    llm = _LLM(['["zebra", "quantum"]', _ok()])
    out = draft_evaluation(_doc(), [ITEM], llm, concurrency=1)
    assert out.rows[0].verdict_hint == NOT_FOUND
    assert out.rows[0].status == NOT_FOUND_STATUS
    assert len(llm.seen) == 1
    assert out.unfound == 1 and out.unreviewed == 0


def test_llm_실패는_미검토이지_근거_없음이_아니다() -> None:
    out = draft_evaluation(_doc(), [ITEM], _LLM([], error="timeout"), concurrency=1)
    assert out.rows[0].verdict_hint == NOT_FOUND
    assert out.rows[0].status == UNREVIEWED
    assert out.llm_failures == 1 and out.unreviewed == 1 and out.unfound == 0
    assert "LLM 호출 실패" in out.rows[0].reason
    # 세 수가 각자 제 말을 한다 — 실패는 미검토의 부분집합이다.
    assert out.notes == ["검토하지 못한 항목 1건 — 검토자 확인 필요",
                         "그중 LLM 호출 실패 1건 — 다시 돌리면 나올 수 있습니다"]


def test_알아볼_수_없는_답은_근거_없음에_들어가지_않는다() -> None:
    """모델이 쓰레기를 준 것은 문서에 대한 판단이 아니다 — 아무도 지키지 않던 자리."""
    out = draft_evaluation(_doc(), [ITEM], _LLM(['["accuracy"]', "??? 설명만 한다"]),
                           concurrency=1)
    row = out.rows[0]
    assert row.status == UNREVIEWED and "응답 형식" in row.reason
    assert out.unfound == 0 and out.unreviewed == 1
    assert out.llm_failures == 0   # 호출은 됐다 — 실패로 세면 다시 돌리라는 거짓말이 된다


def test_모델이_Not_found_라고_하면_근거_없음이다() -> None:
    llm = _LLM(['["accuracy"]', _ok(verdict=NOT_FOUND)])
    out = draft_evaluation(_doc(), [ITEM], llm, concurrency=1)
    assert out.rows[0].status == NOT_FOUND_STATUS
    assert out.unfound == 1 and out.unreviewed == 0


def test_진행_콜백은_항목마다_한_번이고_순서는_입력_순이다() -> None:
    items = [ITEM, EvalItem(id="VR02-01", item="Functionality shall be defined.")]
    llm = _LLM(['["accuracy"]', _ok()])
    seen: list[tuple[int, int]] = []
    out = draft_evaluation(_doc(), items, llm, concurrency=2,
                           on_progress=lambda n, t: seen.append((n, t)))
    assert seen == [(1, 2), (2, 2)]
    assert [r.item_id for r in out.rows] == ["VR01-01", "VR02-01"]


def test_on_row_는_끝난_행을_항목_번호와_함께_준다() -> None:
    """화면이 초안이 써지는 것을 행 단위로 보여 주려면 건수만으로는 모자란다."""
    items = [ITEM, EvalItem(id="VR02-01", item="Functionality shall be defined.")]
    llm = _LLM(['["accuracy"]', _ok()])
    seen: list[tuple[int, str, str]] = []
    draft_evaluation(_doc(), items, llm, concurrency=1,
                     on_row=lambda i, it, row: seen.append((i, it.id, row.status)))
    # 둘째 항목은 가짜 모델이 같은 말("accuracy")만 내서 문서에 안 걸린다 → not_found.
    assert sorted(seen) == [(0, "VR01-01", "drafted"), (1, "VR02-01", "not_found")]


def test_to_dict_은_행과_집계를_함께_낸다() -> None:
    d = draft_evaluation(_doc(), [ITEM], _LLM(['["accuracy"]', _ok()]), concurrency=1).to_dict()
    assert set(d) == {"rows", "unfound", "llm_failures", "unreviewed", "notes"}
    assert set(d["rows"][0]) == {"item_id", "verdict_hint", "status", "comment", "sections",
                                 "quotes", "reason", "words"}
