"""문서 간 검토 기준 → 항목별 판정.

비교 검토는 지적을 평면으로만 냈다. 그런데 팀 기준에는 그 지적이 답해야 할
**항목**이 있다(AX품질팀 X-SRVR14-01 등, IEEE 1012 추적성분석). 항목과 결과가
이어지지 않으면 검토자가 "그래서 이 기준은 만족인가"를 손으로 옮겨 적어야 하고,
보고서 부록 A 의 문서 간 칸이 비어 있게 된다.

**기준이 자기를 검사할 이름을 댄다** — 단일 검토의 `check:` 와 같은 계약이다.
코드에 기준 번호를 박지 않는다: 팀마다 번호가 다르고, 번호를 박는 순간 그 팀
전용 코드가 된다.

    check: rtm_forward   상위 요건이 하위 문서에 전부 나타나는가 (누락)
    check: rtm_reverse   하위 문서의 ID 가 상위에 근거를 두는가 (근거 없음)
    check: rtm_content   연결된 것의 서술이 서로 맞는가 (내용 대조)

앞의 둘은 규칙(문자열 대조)이라 LLM 없이 판정된다. 셋째는 LLM 이 봐야 하므로
AI 를 끄면 **판정하지 않고 그 사실을 말한다** — 조용히 "이상 없음"으로 두면
검사하지 않은 것이 통과로 읽힌다(루트 CLAUDE.md).
"""
from __future__ import annotations

from collections.abc import Sequence

from modules.shared import Finding

#: 이 모듈이 아는 검사 이름. 기준의 `check:` 가 이 중 하나면 문서 비교가 판정한다.
RTM_CHECKS = ("rtm_forward", "rtm_reverse", "rtm_content")

#: 판정이 읽는 것 — (지적을 낸 검사기, 그 지적이 가리키는 문서, RTM 행 상태).
#: document 는 traceability 가 찍는다: 누락은 상위 문서 몫("parent"),
#: 근거 없음은 하위 문서 몫("child").
_READS = {
    "rtm_forward": ("traceability", "parent", "missing"),
    "rtm_reverse": ("traceability", "child", "orphan"),
    "rtm_content": ("consistency", None, "linked"),
}


def rtm_check(criterion) -> str:
    """이 기준을 문서 비교가 판정하는가. 아니면 "".

    모르는 이름을 조용히 넘기지 않는다 — 오타 하나가 "검사되지 않았는데 검사된
    것처럼" 보이게 한다(agent_checklist.check_name 과 같은 처방).
    """
    name = (getattr(criterion, "check", "") or "").strip()
    return name if name in RTM_CHECKS else ""


def rtm_verdict(check: str, rows: Sequence, findings: Sequence[Finding],
                llm_enabled: bool = True) -> tuple[str, list[Finding], str]:
    """(상태, 근거 지적, 왜 그 상태인지). 상태 어휘는 단일 검토와 같다.

    - flagged    지적이 있다
    - clean      검사했고 걸린 것이 없다
    - unreviewed 검사하지 못했다 (요건 ID 형식이 없거나 AI 를 껐다)

    **"0건 통과"와 "검사를 못 했다"를 섞지 않는다.** 요건 ID 형식이 없으면 RTM
    자체가 비는데, 그때 clean 을 내면 추적성을 검사하지도 않고 만족했다고 말하는
    셈이다 — 이 저장소가 계속 막아 온 조용한 0건이다.
    """
    checker, document, row_status = _READS[check]
    if not rows:
        return ("unreviewed", [],
                "요건 ID 형식이 검토 기준에 없어 추적 대조를 하지 못했습니다.")
    if check == "rtm_content" and not llm_enabled:
        return ("unreviewed", [],
                "AI 검토를 꺼서 연결된 항목의 내용 대조를 하지 못했습니다.")

    mine = [f for f in findings
            if f.checker == checker and not f.unreviewed
            and (document is None or (f.document or "") == document)]
    if mine:
        return ("flagged", mine, "")
    # 걸린 것이 없다. 그런데 **볼 것이 있었는지**를 함께 말한다 — 연결된 항목이
    # 하나도 없는데 "내용 대조 이상 없음"이라고 하면 검사한 척이 된다.
    looked = sum(1 for r in rows if getattr(r, "status", "") == row_status)
    if check == "rtm_content" and not looked:
        return ("unreviewed", [],
                "상·하위에 함께 나타난 요건이 없어 내용을 대조할 것이 없었습니다.")
    return ("clean", [], "")
