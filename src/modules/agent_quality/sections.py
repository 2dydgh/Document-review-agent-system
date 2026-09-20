"""장절 한정 LLM 검사. 기준이 적은 장절만 모델에 보낸다.

개정기록·목차·3.0 참조문서처럼 문서의 한 부분만 보는 기준을 문서 전체로 물으면,
문서가 입력 한도를 넘는 순간 검사 자체를 못 한다(실측: RVVR 19.5만 자 — 한도를
넘기는 것은 부록 평가표이고, 앞부분 기준들이 보는 곳은 2.5만 자다).

장절은 **코드가 문자열로 고른다** — 모델에게 어디를 볼지 묻지 않는다.
패턴은 기준 데이터(`sections`)가 준다. 엔진은 장절 이름을 모른다.
"""
from __future__ import annotations

import re
from collections.abc import Sequence

from modules.shared import (
    Anchor,
    Context,
    Document,
    Finding,
    Severity,
    section_text,
    select_sections,
)

from .consistency import ChunkCriteriaChecker, _Unit


def _pack(picked: list, max_chars: int) -> list[_Unit]:
    """장절을 자르지 않고 순서대로 한도 안에 묶는다. 각 장절은 이미 한도 안이다.

    부록 평가표가 그렇다(실측: B 5.9만·C 4.2만·E 3.9만 자 — 하나씩은 들어가고 합치면
    넘는다). 기준이 장절 **안**을 보는 것이라(판정 칸의 이유·결론) 묶음을 나눠도 된다.
    """
    units: list[_Unit] = []
    texts: list[str] = []
    anchor = None
    for s in picked:
        t = section_text(s)
        if texts and len("\n\n".join([*texts, t])) > max_chars:
            units.append(_Unit(text="\n\n".join(texts), anchor=anchor))
            texts, anchor = [], None
        texts.append(t)
        anchor = anchor or s.anchor
    if texts:
        units.append(_Unit(text="\n\n".join(texts), anchor=anchor))
    return units


class SectionCriteriaChecker(ChunkCriteriaChecker):
    """기준마다 자기 장절만 한 번 묻는다."""

    name = "consistency_section"
    label = "장절 점검"

    def __init__(self, criteria: Sequence = (), max_chars: int = 120_000):
        super().__init__(criteria)
        self.max_chars = max_chars
        # 기준 번호 → 무엇을 보고 판정했나. 조립 계층이 항목 설명에 붙인다.
        self.notes: dict[str, str] = {}

    def _batches(self) -> list[list]:
        return [[criterion] for criterion in self.criteria]

    def _jobs(self, doc: Document, ctx: Context) -> tuple[list, list[Finding]]:
        whole = "\n".join(s.text or "" for s in doc.iter_sections())
        jobs, notices = [], []
        self.notes = {}
        for c in self.criteria:
            no = str(c.no)
            patterns = list(getattr(c, "sections", []) or [])
            tried = ", ".join(patterns)
            try:
                picked = select_sections(doc, patterns)
            except re.error as exc:
                self._skip(no, f"장절 패턴이 올바르지 않아 검사하지 못했습니다({exc}). "
                               "검토 기준의 sections 를 고치세요.", notices)
                continue
            if picked:
                titles = ", ".join(s.title for s in picked)
                big = [s.title for s in picked if len(section_text(s)) > self.max_chars]
                if big:
                    # 장절 하나를 가운데서 자르면 그 장절을 다 봤다고 말할 수 없다.
                    self._skip(no, f"찾은 장절({', '.join(big)})이 검토 한도"
                                   f"({self.max_chars:,}자)를 넘어 검사하지 못했습니다. "
                                   "원문에서 직접 확인해야 합니다.", notices)
                    continue
                units = _pack(picked, self.max_chars)
                self.notes[no] = (f"지정 장절({titles})만 보고 판정했습니다"
                                  + (f" — 장절 단위로 {len(units)}번 나눠 물었고, 서로 다른 "
                                     "묶음에 든 장절끼리는 대조하지 않았습니다."
                                     if len(units) > 1 else "."))
                jobs.extend((unit, [c]) for unit in units)
            elif whole.strip() and len(whole) <= self.max_chars:
                # 못 찾았어도 문서 전체가 한도 안이면 전부 본다 — 거짓이 아니다.
                first = next(doc.iter_sections())
                self.notes[no] = (f"지정 장절을 찾지 못해(찾아본 패턴: {tried}) "
                                  "문서 전체를 보고 판정했습니다.")
                jobs.append((_Unit(text=whole, anchor=first.anchor), [c]))
            else:
                self._skip(no, f"지정 장절을 찾지 못했고(찾아본 패턴: {tried}) 문서가 검토 "
                               f"한도({self.max_chars:,}자)를 넘어 검사하지 못했습니다. "
                               "문서에 그 장절이 없다는 뜻이 아닙니다 — 파서가 장 제목을 "
                               "복원하지 못했을 수 있습니다. 원문에서 직접 확인해야 합니다.",
                           notices)
        return jobs, notices

    def _skip(self, no: str, reason: str, notices: list[Finding]) -> None:
        self.notes[no] = reason
        notices.append(Finding(checker=self.name, severity=Severity.INFO, message=reason,
                               anchor=Anchor(page=None, section=None), rule_id=no,
                               unreviewed=True))

    def check(self, doc: Document, ctx: Context) -> list[Finding]:
        # 부모 check 는 작업이 없으면 판정표를 만들지 않는다. 전부 건너뛴 경우에도
        # 기준별 판정이 "미판정" 으로 남아야 조립 계층이 통과로 오해하지 않는다.
        self.verdicts = {str(c.no): "미판정" for c in self.criteria}
        return super().check(doc, ctx)

    def plan(self, doc: Document, ctx: Context) -> dict | None:
        if not self.criteria:
            return None
        jobs, _ = self._jobs(doc, ctx)
        return {"kind": "chunk", "total": len(jobs), "label": self.label,
                "description": "기준이 지정한 장절만 대조",
                "scope": f"장절 한정 {len(jobs)}건"}
