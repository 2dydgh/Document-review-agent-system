"""규칙기반 체커: 미완성 표시(TBD 등) 검사.

배포된 문서에 남은 자리표시자를 찾는다. LLM 없이 결정적으로 동작하고,
문자열 대조라 오탐이 없다.

기본 표시는 `TBD` 하나뿐이다. 실제 문서 세 개를 재보니 `미정`·`N/A`·`작성중`은
한 번도 안 나왔고, `추후`는 본문 산문("추후 경량화에 따라 변경될 수 있음")에
섞여 있어 넣으면 오탐이 된다. 필요하면 체크리스트에서 늘린다.
"""
from __future__ import annotations

import re
from collections import Counter

from modules.shared import Context, Document, Evidence, Finding, Severity

DEFAULT_MARKERS = ("TBD",)

_MAX_QUOTE = 80


def _as_pattern(marker: str) -> str:
    """마커 하나를 정규식 조각으로.

    영문 마커에만 단어 경계를 준다("TBDX-1"을 지적하지 않기 위함). 한글에는
    쓸 수 없다 — `\\b`는 \\w 사이에 경계를 만들지 않아 "미정이다"의 "미정"이
    매칭되지 않는다.
    """
    escaped = re.escape(marker)
    if marker.isascii():
        return rf"\b{escaped}\b"
    return escaped


def _compile(markers: list[str]) -> re.Pattern | None:
    if not markers:
        return None
    return re.compile("|".join(_as_pattern(m) for m in markers), re.IGNORECASE)


def _quote(line: str, rx: re.Pattern) -> str:
    """지적에 실을 인용. 표 행이면 **마커가 든 칸을 짚는다.**

    실측(2026-08-25, AX품질팀 상세설계서): TBD 가 든 줄 49개가 전부 표 행이고 마커는
    4번째 칸에 있었다. 행을 통째로 인용하면 80자에서 잘려 정작 TBD 가 든 칸은 화면에
    안 나온다 — 검토자는 "미완성 표시가 있다"는 말과 관계없는 앞 칸 설명만 본다.

    첫 칸을 같이 싣는 이유: 그 행이 무엇인지 알아야 찾아간다. `'API 요청 처리' 행`
    이라고 하면 바로 짚고, 4번째 칸 값만 주면 같은 값이 든 행이 여럿일 때 못 찾는다.
    표가 아니면 예전처럼 줄을 자른다.
    """
    stripped = line.strip()
    if stripped.startswith("|") and stripped.endswith("|"):
        cells = [c.strip() for c in stripped.strip("|").split("|")]
        hit = [(i, c) for i, c in enumerate(cells) if rx.search(c)]
        if hit and len(cells) > 1:
            # 라벨은 **비어 있지 않은 첫 칸**이다. 실측(PRJX-DS-014 §3.1.5.4): 첫 칸이
            # 빈 행(`|  | 사고정보 표출 화면 | … | TBD |`)에서 `'' 행의 5번째 칸` 이
            # 나왔다 — 검토자가 어느 행인지 알 수 없다. 마커 칸 자체는 라벨로 안 쓴다.
            label_src = next((c for i, c in enumerate(cells)
                              if c and i not in {i2 for i2, _ in hit}), "")
            label = label_src[:30] + ("…" if len(label_src) > 30 else "")
            where = "·".join(f"{i + 1}번째 칸" for i, _ in hit)
            values = " / ".join(c[:40] for _, c in hit)
            return f"'{label}' 행의 {where}: {values}"
    return line if len(line) <= _MAX_QUOTE else line[:_MAX_QUOTE] + "…"


def _row_label(line: str, rx: re.Pattern) -> str:
    """절 단위로 묶은 지적에 나열할 **짧은 이름**. 표 행이면 그 행 라벨만.

    `_quote` 는 카드 하나가 한 자리를 말할 때의 인용이라 "…행의 4번째 칸: TBD"
    까지 붙는다. 절에 여섯 자리가 있으면 그 문장을 여섯 번 이으면 안 읽힌다 —
    여기서는 어느 행인지만 댄다. 실제 위치는 evidence 가 지고, 형광펜이 짚는다.
    """
    stripped = line.strip()
    if stripped.startswith("|") and stripped.endswith("|"):
        cells = [c.strip() for c in stripped.strip("|").split("|")]
        marked = {i for i, c in enumerate(cells) if rx.search(c)}
        if marked and len(cells) > 1:
            label = next((c for i, c in enumerate(cells) if c and i not in marked), "")
            if label:
                return label[:30] + ("…" if len(label) > 30 else "")
    short = stripped if len(stripped) <= _LABEL_MAX else stripped[:_LABEL_MAX] + "…"
    return short


#: 한 카드에 이름을 몇 개까지 늘어놓을까. 넘치면 "외 N곳" 으로 줄인다 —
#: 근거는 전부 실으므로 형광펜은 다 붙는다(AbbrevChecker._MAX_LISTED 와 같은 처방).
_MAX_LISTED = 8
#: 표가 아닌 줄을 이름으로 쓸 때의 길이.
_LABEL_MAX = 30


class PlaceholderChecker:
    name = "completeness"
    label = "미작성 표시 검사"

    def __init__(self, document: str | None = None) -> None:
        # 2문서 비교에서 어느 쪽 문서의 문제인지 표시할 때 쓴다.
        self.document = document

    def check(self, doc: Document, ctx: Context) -> list[Finding]:
        markers = list(getattr(ctx.review, "placeholder_markers", DEFAULT_MARKERS))
        rx = _compile(markers)
        if rx is None:
            return []

        findings: list[Finding] = []
        for section in doc.iter_sections():
            # 같은 절에 똑같은 줄이 여러 번 나온다(표에 빈 행이 반복되는 경우).
            # 그대로 두면 collect()가 중복으로 합쳐 개수가 조용히 줄어든다.
            # 하나로 묶되 몇 번인지 밝힌다.
            hits = Counter(
                line.strip() for line in section.text.splitlines()
                if line.strip() and rx.search(line))
            if not hits:
                continue
            # **절 하나에 카드 하나.** 자리마다 내면 실측(PRJX-DS-014)에서 23장이
            # 나와 번호 2~49 를 차지했고, 정작 읽어야 할 일관성 지적 4건이 그
            # 아래 묻혔다. AbbrevChecker._listed 가 같은 이유로 이미 묶는다 —
            # "낱개로 내면 아무도 안 읽고 다른 검사의 지적까지 파묻는다".
            # 자리별 위치는 evidence 가 그대로 지므로 형광펜·번호는 안 잃는다.
            # 줄이 달라도 **행 이름이 같으면 한 자리로 센다.** 실측(PRJX-DS-014
            # §3.1.1.2): 뒤 칸만 다른 두 줄이 있어 "API 요청 처리, API 요청 처리"
            # 로 같은 이름이 두 번 늘어섰다 — 읽는 사람에게는 그냥 버그로 보인다.
            # 되풀이 횟수는 (N회) 가 지므로 세는 것을 잃지 않는다.
            by_label: dict[str, int] = {}
            for line, count in hits.items():
                lab = _row_label(line, rx)
                by_label[lab] = by_label.get(lab, 0) + count
            labels = [f"{lab}({n}회)" if n > 1 else lab
                      for lab, n in by_label.items()]
            shown = ", ".join(labels[:_MAX_LISTED])
            if len(labels) > _MAX_LISTED:
                shown += f" 외 {len(labels) - _MAX_LISTED}곳"
            findings.append(Finding(
                checker=self.name,
                severity=Severity.MAJOR,
                message=f"미완성 표시가 {len(by_label)}곳 남아 있습니다 — {shown}",
                anchor=section.anchor,
                suggestion="내용을 채우거나, 확정 전이면 언제까지 정할지 명시하세요.",
                document=self.document,
                # 원문 줄을 근거로 싣는다. 뷰어(/api/locate)가 이 인용을 원본에서
                # 찾아 형광펜을 칠하고 **번호**를 매긴다 — 근거가 없으면 카드에
                # 번호도 "그 자리로 가기"도 없다(실측: 규칙 지적만 번호가 빠져
                # 있었다). 이 줄은 문서에서 그대로 뽑은 것이라 대조를 통과한다.
                #
                # 같은 줄이 N 번이면 근거도 N 개 싣는다. 실측(PRJX-DS-014 §3.1.4.2):
                # `| 출처 | TBD |` 가 5회인데 근거 하나만 실어 형광펜이 첫 번째에만
                # 갔다 — 나머지 넷은 위치를 잃는다. 뷰어는 같은 인용이 되풀이되면
                # N 번째 출현을 찾는다(annotate_pdf._find 의 nth).
                evidence=[Evidence(anchor=section.anchor, quote=line)
                          for line, count in hits.items()
                          for _ in range(count)],
            ))
        return findings
