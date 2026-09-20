"""장절 고르기 — 기준이 준 제목 패턴으로 문서의 한 부분을 코드가 고른다.

LLM 장절 검사(agent_quality)와 목차 대조 규칙(agent_format)이 함께 쓴다. 장절 이름은
모른다 — 패턴은 기준 데이터가 준다.
"""
from __future__ import annotations

import re
from collections.abc import Sequence

from .models import Document, Section

#: 제목 없는 쪽(level 0, 제목은 "N쪽")은 앞 몇 줄로 대조한다. 앞만 보는 이유:
#: 본문 중간에 우연히 나온 "References" 가 그 쪽을 참조문서 장으로 만들면 안 된다.
#: 한 줄이 아닌 이유: 쪽마다 머리글(문서번호)이 먼저 나오는 문서가 있다(실측: PLT34
#: RVVR 은 2쪽 첫 줄이 "X11056-940VD-111C", 둘째 줄이 "RECORD OF REVISIONS").
_HEAD_LINES = 3
_LINE_CHARS = 200


def select_sections(doc: Document, patterns: Sequence[str]) -> list[Section]:
    """패턴에 맞는 장절 목록(하위 장절 포함, 문서 순서). 패턴이 깨졌으면 re.error.

    - 제목이 있는 장절(level ≥ 1)은 제목과 대조한다.
    - 제목 없는 쪽(level 0)은 앞 세 줄과 대조한다(표지 뒤 "RECORD OF REVISIONS" 등).
      파서가 붙인 쪽 이름("1쪽")과도 대조한다 — 표지는 첫 줄로 가려낼 수 없다.
    - 맞은 장절은 하위 장절까지 통째로 가져간다(실측: 4.0 자체 본문은 짧고 내용은 4.1 에 있다).
    """
    compiled = [re.compile(p) for p in patterns]
    picked: list = []

    def hit(section) -> bool:
        targets = [section.title or ""]
        if section.level < 1:
            lines = [ln.strip() for ln in (section.text or "").split("\n") if ln.strip()]
            targets += [ln[:_LINE_CHARS] for ln in lines[:_HEAD_LINES]]
        return any(p.search(t) for p in compiled for t in targets)

    def walk(sections) -> None:
        for s in sections:
            if hit(s):
                picked.append(s)      # 하위는 section_text 가 싣는다 — 두 번 넣지 않는다
            else:
                walk(s.children)

    walk(doc.sections)
    return picked


def section_text(section: Section) -> str:
    """장절과 하위 장절의 본문. 장 제목 줄을 앞에 붙여 모델이 경계를 본다."""
    head = [section.title] if section.level >= 1 and section.title else []
    body = [section.text] if section.text else []
    return "\n".join([*head, *body, *(section_text(c) for c in section.children)])
