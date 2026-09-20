"""추출 잔해를 문서 결함으로 내지 않는다.

환각 관문(verify_quotes)은 "이 인용이 문서에 있는가"만 본다. 파서가 깨뜨린 글을
모델이 충실히 인용하면 그 관문을 그대로 통과한다 — 지어낸 게 아니기 때문이다.

실측(2026-08-20, PLT56_SYSA_RVVR_Rev05.pdf): 지적 53건 중 20건이 문서가 아니라
추출 결과가 깨진 것이었다.

    원문(표)  [Rev.01] Not applicable: same evaluation results as Rev.00.
    조각      [Rev.01] Not applicable: same evaluation results as N/A N/A Rev.00.

**좁게 건다.** 표 안의 진짜 오타까지 죽이면 검사가 무의미해지므로, 문장이라고
볼 수 없는 것만 거른다.
"""
from __future__ import annotations

import pytest

from modules.agent_quality.consistency import _is_prose


@pytest.mark.parametrize("quote", [
    # 목차 점선
    "1.0 Purpose.......................................................... 6",
    # 표 여러 칸이 한 인용에 뭉침
    "| Communication | Communication |  | IPS | IPS |  | Monitoring | Monitoring |",
    "SYSA Server (Main) | SYSA Communication | 자기진단정보 | 제공 |  |  | 그림 4 |",
    # 참조 절 번호만 늘어선 줄
    "3.1.1. 3.1.2.",
    "3.3.1. 3.3.2. 3.3.3. 3.3.4. 3.3.5.",
])
def test_잔해는_지적_근거로_안_쓴다(quote: str) -> None:
    assert not _is_prose(quote)


@pytest.mark.parametrize("quote", [
    # 진짜 오타 — 표 안에 있어도 살아야 한다
    "Definitions, Acronyms, and Abbreviations are descripted in section 3.0.",
    "Dose the documentation defines all acronyms, mnemonics, abbreviations?",
    "Among the above tasks, Task 5 are not dealt with in this report.",
    "The evaluation result is written in Appendix B..",
    # 표 **한 행**은 살린다. 칸 안의 오타를 봐야 하기 때문이다(CLAUDE.md 공통 C1:
    # "본문뿐 아니라 표·그림 제목·부록·평가표까지 본다").
    "| 의뢰번호 | SST-26-999 |",
    "| 항목 | 결과 | 비고 |",
])
def test_진짜_지적은_그대로_통과한다(quote: str) -> None:
    assert _is_prose(quote), f"멀쩡한 인용을 잔해로 봤다 — {quote!r}"


def test_한_행과_여러_행을_가른다() -> None:
    """한 행은 칸 수 + 1 이다. 넷으로 자르면 세 칸짜리 멀쩡한 행이 죽는다."""
    assert _is_prose("| 시험 항목 | 시험 결과 | 비고 사항 |")          # 파이프 넷
    assert not _is_prose("| 가나 | 다라 | 마바 | 사아 | 자차 | 카타 |")  # 일곱


@pytest.mark.parametrize("quote", [
    "본문 한 줄",        # 한 글자 낱말 둘 + 두 글자 낱말 하나
    "표 및 그림",        # 두 글자 낱말이 `그림` 하나뿐
    "descripted",        # 영어 한 낱말
])
def test_한_글자_낱말이_많은_한국어를_안_죽인다(quote: str) -> None:
    """한때 "두 글자 이상 낱말이 둘 이상"을 요구해 이런 인용이 전부 죽었다.
    한국어는 한 글자 낱말이 흔하다 — 잡으려던 것은 글자가 **아예 없는** 줄이다."""
    assert _is_prose(quote), f"멀쩡한 인용을 잔해로 봤다 — {quote!r}"


def test_빈_칸이_잇달으면_여러_행이_눌린_것이다() -> None:
    """사람이 쓴 표 한 행에는 빈 칸이 이렇게 연달아 오지 않는다."""
    assert not _is_prose("자기진단정보 | 운영 파일 | | | 그림 4 | | |")


def test_잔해로_뺀_지적은_무엇을_뺐는지_보고에_적는다() -> None:
    """건수만 적으면 검토자가 할 수 있는 게 없다(2026-09-16 지적). 절·지적 문장·인용을
    한 줄씩 실어 "잔해가 맞다 / 진짜 지적인데 인용만 틀렸다"를 사람이 가릴 수 있게 한다."""
    import json
    from types import SimpleNamespace

    from modules.agent_quality.consistency import ChunkCriteriaChecker
    from modules.shared import Anchor, Context, Document, Section

    junk = "| 가나 | 다라 | 마바 | 사아 | 자차 | 카타 |"
    doc = Document("t.pdf", "pdf",
                   [Section("3.2", "표", 1, "본문입니다. " + junk, Anchor(4, "3.2"))])
    criterion = SimpleNamespace(no="7", text="표기 일관성", note="")
    answer = {"results": [{"no": "7", "verdict": "위반", "kind": "표기",
                           "issue": "표 머리글 표기가 흔들린다.", "quotes": [junk]}]}
    llm = SimpleNamespace(complete=lambda prompt: SimpleNamespace(
        text=json.dumps(answer, ensure_ascii=False), error=None))
    ck = ChunkCriteriaChecker([criterion])
    ctx = Context(review=None, llm=llm, rescue_max=0)
    ctx.chunks = [SimpleNamespace(id="3.2#0", text=doc.sections[0].text,
                                  anchor=Anchor(4, "3.2"), section_id="3.2")]
    findings = ck.check(doc, ctx)
    assert not [f for f in findings if f.severity.value != "info"], "잔해 근거가 결함으로 나갔다"
    notice = next(f for f in findings if "근거가 주장을 받치지 못해" in f.message)
    lines = notice.message.split("\n")
    assert len(lines) == 2, notice.message
    # 파서가 매긴 §번호가 아니라 쪽과 절 제목 — 검토자가 문서에서 찾을 수 있는 것만 적는다.
    assert lines[1].startswith("4쪽 '표' · 표 머리글 표기가 흔들린다.")
    assert "가나 | 다라" in lines[1]
    assert "§" not in lines[1]
