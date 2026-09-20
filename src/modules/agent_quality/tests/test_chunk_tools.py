"""조각 밖을 봐야 판정되는 기준 — 모델이 도구를 부를 수 있다.

표현 점검은 조각 하나를 주고 한 번 묻고 끝이었다. 그런데 "앞뒤가 모순인가"의
그 '앞뒤'는 다른 조각에 있을 수 있다. 그래서 조각 경계를 넘는 모순은 구조적으로
못 잡혔다 — 모델이 볼 수단이 없었다.

이제 모델이 "이 조각만으로는 모르겠다"고 말하면 그때만 도구를 쥐어준다.
**기본은 여전히 한 번에 답하는 것이다**(아래 첫 번째 검사) — 매 조각이 도구를
부르면 호출이 조각수×라운드로 불어나 "1건 5분" 스펙을 깬다.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field

from modules.agent_quality import ChunkCriteriaChecker
from modules.shared import Anchor, Chunk, Context, Document, Section

# 조각에 실리는 글(§1)과, 조각 밖에만 있는 글(§2).
IN_CHUNK = "보고서는 검토 후 7일 이내에 제출한다."
OUT_OF_CHUNK = "보고서 제출 기한은 검토 후 14일이다."


@dataclass
class Response:
    text: str
    error: str | None = None


@dataclass
class _Review:
    required_sections: list = field(default_factory=list)
    placeholder_markers: list = field(default_factory=list)
    id_pattern: str = ""


@dataclass
class _Crit:
    no: str
    text: str


def _doc() -> Document:
    return Document(
        source_path="x.md", doc_type="generic",
        sections=[
            Section(id="1", title="제출", level=1, text=IN_CHUNK,
                    anchor=Anchor(None, "1")),
            Section(id="2", title="부록", level=1, text=OUT_OF_CHUNK,
                    anchor=Anchor(None, "2")),
        ])


def _ctx(llm) -> Context:
    # 조각은 §1 뿐이다 — §2 는 모델에게 안 보인다.
    return Context(review=_Review(), llm=llm,
                   chunks=[Chunk(id="1#0", text=IN_CHUNK,
                                 anchor=Anchor(None, "1"), section_id="1")])


class _LLM:
    """정해둔 답을 차례로 준다. 모델이 실제로 받은 메시지를 남긴다."""

    def __init__(self, answers: list[str]):
        self.answers = answers
        self.seen: list[list[dict]] = []

    def chat(self, messages, **opts) -> Response:
        self.seen.append(list(messages))
        i = len(self.seen) - 1
        return Response(text=self.answers[min(i, len(self.answers) - 1)])

    def complete(self, prompt: str, **opts) -> Response:
        return self.chat([{"role": "user", "content": prompt}], **opts)


def _tool_call(term: str) -> str:
    return json.dumps({"tool": "find_term", "args": {"term": term}},
                      ensure_ascii=False)


def _violation(quote: str) -> str:
    return json.dumps({"results": [{
        "no": "3", "verdict": "위반", "kind": "모순",
        "issue": "제출 기한이 7일과 14일로 어긋난다.",
        "quotes": [quote],
    }]}, ensure_ascii=False)


CRIT = _Crit(no="3", text="문서 안의 값이 서로 어긋나지 않아야 한다")


def test_no_tool_means_one_call_as_before():
    # 조각만으로 판정되면 예전과 같다 — 한 번 묻고 끝. 도구를 늘 부르게 두면
    # 호출이 조각수만큼 배로 불어나 "1건 5분"을 깬다.
    llm = _LLM([_violation(IN_CHUNK)])

    findings = ChunkCriteriaChecker(criteria=[CRIT]).check(_doc(), _ctx(llm))

    assert len(llm.seen) == 1
    assert [f.message for f in findings if not f.unreviewed]


def test_model_can_reach_outside_the_chunk():
    # 이 변경의 존재 이유. §2 는 조각에 없으므로 도구 없이는 이 모순을 못 낸다.
    llm = _LLM([_tool_call("보고서"), _violation(OUT_OF_CHUNK)])

    findings = ChunkCriteriaChecker(criteria=[CRIT]).check(_doc(), _ctx(llm))

    # 도구 결과가 실제로 모델에게 갔다.
    assert len(llm.seen) == 2
    assert any("[도구 결과]" in m["content"] for m in llm.seen[1])
    assert OUT_OF_CHUNK in "".join(m["content"] for m in llm.seen[1])

    # 조각 밖에서 찾아온 인용이 근거로 통과하고, 지적은 그 절을 가리킨다.
    real = [f for f in findings if not f.unreviewed]
    assert len(real) == 1
    assert [e.quote for e in real[0].evidence] == [OUT_OF_CHUNK]
    assert real[0].anchor.section == "2"


def test_unknown_tool_does_not_kill_the_chunk():
    # 모델이 없는 도구를 대도 그 조각의 판정이 통째로 날아가면 안 된다 —
    # run() 이 "알 수 없는 도구"를 돌려주고 모델은 다음 턴에 답할 수 있다.
    llm = _LLM([json.dumps({"tool": "grep", "args": {}}),
                _violation(IN_CHUNK)])

    findings = ChunkCriteriaChecker(criteria=[CRIT]).check(_doc(), _ctx(llm))

    assert any("알 수 없는 도구" in m["content"] for m in llm.seen[1])
    assert [f.message for f in findings if not f.unreviewed]


def test_tools_forever_is_reported_not_silently_passed():
    # 상한까지 도구만 부르고 판정을 안 내면 "이상 없음"이 아니다.
    # 조용한 0건은 '검토를 못 했다'를 '0건 통과'로 읽히게 만든다(CLAUDE.md).
    llm = _LLM([_tool_call("보고서")])

    findings = ChunkCriteriaChecker(criteria=[CRIT]).check(_doc(), _ctx(llm))

    assert not [f for f in findings if not f.unreviewed]
    assert [f for f in findings if f.unreviewed], "미검토를 드러내지 않았다"
