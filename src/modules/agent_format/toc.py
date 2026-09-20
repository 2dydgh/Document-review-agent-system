"""규칙기반 체커: 목차 ↔ 본문 대조 (EIS 통합 체크리스트 No.31 · No.86).

실측(PLT56 CPS RVVR Rev09 · SYSA Rev05 · PLT34 SYS-CCS RVVR) 목차는 이렇게 추출된다:

    CONTENTS
    Section   Page   Title
    3.0   References .............................................. 11
    3.1   Regulations ............................................. 11
    5.6   Configuration Management Assessment...................... 20

    APPENDICES
    Appendix A.   Software V&V Checklist for Requirement Phase
    Appendix B.   Software V&V Requirement Phase Checklist for BTP 7-14

본문 장 제목은 파서가 준다(`3.1. Regulations` · `[Appendix B] …` · `Appendix B. …`).

- **목차가 싣는 깊이까지만 본다.** 목차는 3.1 까지, 본문은 7.3.1.1 까지 있다.
- 번호는 `3.1.` 과 `3.1`, `3.0` 과 `3` 을 같게 본다. 제목은 **공백만** 없애고 대조한다.
- 쪽 번호는 PDF 에서만, 표지 등으로 생긴 앞쪽 차이를 빼고 본다 — 대부분의 항목이
  합의하는 차이(최빈값)에서 벗어난 항목만 지적한다. 합의가 없으면 쪽은 대조하지 않는다.
- **목록을 못 읽었으면 지적하지 않는다.** SYSA Rev05 의 부록 목록은 칸이 섞여
  `Appendix A. Appendix B. Appendix C. Appendix D. Requirement Phase …` 로 나온다.
  그 상태로 제목을 대조하면 멀쩡한 부록 넷이 전부 "제목이 다르다"로 뜬다.

목차가 어디 있는지(`toc_sections`)와 부록을 부르는 말(`appendix_words`)은 기준이 준다.
"""
from __future__ import annotations

import re
from collections import Counter

from modules.shared import Anchor, Context, Document, Evidence, Finding, Severity, select_sections

#: `3.1.   Regulations ........ 11` → (3.1, Regulations, 11). 점선이 제목에 붙은 줄도 있다.
_TOC_LINE = re.compile(r"^\s*(\d+(?:\.\d+)*)\.?\s+(.+?)\s*\.{2,}\s*(\d+)\s*$")
_HEADING = re.compile(r"^\s*(\d+(?:\.\d+)*)\.?\s+(.+?)\s*$")

#: 쪽 번호 합의로 볼 최소 항목 수와 비율. 실측 세 문서는 전 항목이 같은 차이(0)였다.
_PAGE_MIN = 3
_PAGE_SHARE = 0.6

#: 한 기준이 낼 지적 수 상한. 넘치면 잘랐다는 사실을 INFO 로 밝힌다.
_MAX_FINDINGS = 30


def _num(raw: str) -> str:
    """`3.1.` → `3.1` · `3.0` → `3` · `5.10` → `5.10`."""
    parts = raw.strip(".").split(".")
    while len(parts) > 1 and parts[-1] == "0":
        parts.pop()
    return ".".join(parts)


def _key(title: str) -> str:
    """공백만 없앤다. 글자·대소문자·문장부호는 그대로 — 바꾸면 틀린 제목이 통과한다."""
    return re.sub(r"\s+", "", title)


def _quote(text: str) -> str:
    return " ".join(text.split())


class _TocBase:
    name = "completeness"

    def __init__(self, toc_sections: tuple[str, ...] = ()) -> None:
        self.toc_sections = tuple(toc_sections)

    def _toc(self, doc: Document) -> tuple[list, Finding | None]:
        if not self.toc_sections:
            return [], self._unreviewed(
                "목차 위치(toc_sections)가 검토 기준에 없어 목차 대조를 하지 않았습니다.",
                "검토 기준 항목의 params.toc_sections 에 목차 제목 패턴을 적으세요.")
        try:
            toc = select_sections(doc, self.toc_sections)
        except re.error as exc:
            return [], self._unreviewed(f"목차 위치 패턴이 올바르지 않습니다: {exc}",
                                        "검토 기준의 params.toc_sections 를 고치세요.")
        if not toc:
            return [], self._unreviewed(
                "목차를 찾지 못해 목차 대조를 하지 않았습니다 "
                f"(찾아본 패턴: {', '.join(self.toc_sections)}).",
                "문서에 목차가 있는데 못 찾은 것이면 기준의 params.toc_sections 에 "
                "그 제목을 넣으세요.")
        return toc, None

    def _flag(self, message: str, anchor: Anchor, evidence: list[Evidence],
              suggestion: str) -> Finding:
        return Finding(checker=self.name, severity=Severity.MINOR, message=message,
                       anchor=anchor, suggestion=suggestion, evidence=evidence)

    def _unreviewed(self, message: str, suggestion: str) -> Finding:
        return Finding(checker=self.name, severity=Severity.INFO, message=message,
                       anchor=Anchor(page=None, section=None), suggestion=suggestion,
                       unreviewed=True)

    def _capped(self, findings: list[Finding]) -> list[Finding]:
        if len(findings) <= _MAX_FINDINGS:
            return findings
        return [*findings[:_MAX_FINDINGS], self._unreviewed(
            f"목차 지적이 {_MAX_FINDINGS}건을 넘어 나머지 {len(findings) - _MAX_FINDINGS}건은 "
            "싣지 않았습니다.", "목차를 다시 생성(필드 업데이트)한 뒤 다시 검토하세요.")]


class TocChecker(_TocBase):
    """번호 붙은 장·절 목차 ↔ 본문 장 제목."""

    label = "목차 대조"

    def check(self, doc: Document, ctx: Context | None = None) -> list[Finding]:
        toc, why = self._toc(doc)
        if why:
            return [why]
        entries = []           # (번호, 제목, 쪽, 원문 줄, 위치)
        for section in toc:
            for line in (section.text or "").split("\n"):
                m = _TOC_LINE.match(line)
                if m:
                    entries.append((_num(m.group(1)), m.group(2).strip(), int(m.group(3)),
                                    _quote(line), section.anchor))
        if len(entries) < 2:
            return [self._unreviewed(
                f"목차에서 번호·제목·쪽 항목을 {len(entries)}건밖에 읽지 못해 대조하지 않았습니다.",
                "목차가 '번호 제목 …… 쪽' 모양이 아니거나 추출이 깨졌을 수 있습니다.")]

        headings = self._headings(doc)
        if not headings:
            return [self._unreviewed(
                "본문 장 제목에 번호가 없어 목차와 대조하지 못했습니다.",
                "파서가 장 제목을 복원하지 못했을 수 있습니다. 목차는 직접 확인하세요.")]

        depth = max(n.count(".") + 1 for n, *_ in entries)
        findings: list[Finding] = []
        listed = set()
        offsets = []
        for number, title, page, line, anchor in entries:
            listed.add(number)
            ev = [Evidence(anchor=anchor, quote=line)]
            heading = headings.get(number)
            if heading is None:
                findings.append(self._flag(
                    f"목차의 {number} '{title}' 에 해당하는 본문 장이 없습니다", anchor, ev,
                    "목차를 다시 생성하거나 본문 장 번호를 확인하세요."))
                continue
            h_title, h_anchor = heading
            if _key(title) != _key(h_title):
                findings.append(self._flag(
                    f"목차 제목과 본문 제목이 다릅니다 — 목차 '{title}' / 본문 '{h_title}'",
                    anchor, [*ev, Evidence(anchor=h_anchor, quote=h_title)],
                    "목차를 다시 생성하거나 한쪽 제목을 고치세요."))
            if h_anchor.page is not None:
                offsets.append((page - h_anchor.page, number, title, page, line, anchor,
                                h_title, h_anchor))
        for number, (h_title, h_anchor) in headings.items():
            if number not in listed and number.count(".") + 1 <= depth:
                findings.append(self._flag(
                    f"본문 장 {number} '{h_title}' 이(가) 목차에 없습니다", h_anchor,
                    [Evidence(anchor=h_anchor, quote=h_title)],
                    "목차를 다시 생성(필드 업데이트)하세요."))
        return self._capped([*findings, *self._pages(offsets)])

    def _headings(self, doc: Document) -> dict[str, tuple[str, Anchor]]:
        """번호 → (제목, 위치). 부록이 시작되면 멈춘다.

        부록 안에도 `1. Consistency Analysis …` 같은 번호 제목이 있다(실측: SYSA Rev05
        Appendix C). 본문 장이 끝나고 번호 없는 1단계 제목(부록)이 나오면 거기서 멈춘다.
        """
        out: dict[str, tuple[str, Anchor]] = {}
        for s in doc.iter_sections():
            if s.level < 1:
                continue
            m = _HEADING.match(s.title or "")
            if m is None:
                if s.level == 1 and out:
                    break
                continue
            out.setdefault(_num(m.group(1)), (m.group(2), s.anchor))
        return out

    def _pages(self, offsets: list) -> list[Finding]:
        if len(offsets) < _PAGE_MIN:
            return []
        offset, votes = Counter(o[0] for o in offsets).most_common(1)[0]
        if votes < len(offsets) * _PAGE_SHARE:
            return [self._unreviewed(
                "목차 쪽 번호와 본문 위치의 차이가 항목마다 달라 쪽 번호는 대조하지 않았습니다.",
                "쪽 번호가 구역마다 다시 시작하는 문서일 수 있습니다. 직접 확인하세요.")]
        out = []
        for diff, number, title, page, line, anchor, _h_title, h_anchor in offsets:
            if diff != offset:
                out.append(self._flag(
                    f"목차의 쪽 번호가 본문 위치와 다릅니다 — {number} '{title}' 목차 {page}쪽, "
                    f"실제 {h_anchor.page + offset}쪽",
                    anchor, [Evidence(anchor=anchor, quote=line)],
                    "목차를 다시 생성(필드 업데이트)하세요."))
        return out


class TocAppendixChecker(_TocBase):
    """목차의 부록 목록 ↔ 본문 부록 제목. 부록을 다른 말(Annex 등)로 부르면 지적한다."""

    label = "부록 목차 대조"

    def __init__(self, toc_sections: tuple[str, ...] = (), words: tuple[str, ...] = (),
                 forbidden: tuple[str, ...] = ()) -> None:
        super().__init__(toc_sections)
        self.words = tuple(words)
        self.forbidden = tuple(forbidden)

    def _label(self, words: tuple[str, ...]) -> re.Pattern:
        alt = "|".join(re.escape(w) for w in words)
        # `[Appendix B]` · `Appendix B.` · `Appendix. A` · `부록 A`
        return re.compile(rf"(?i)\[?\s*(?:{alt})\s*\.?\s*([A-Z])\b\s*[\].:]?")

    def check(self, doc: Document, ctx: Context | None = None) -> list[Finding]:
        if not self.words:
            return [self._unreviewed(
                "부록을 부르는 말(appendix_words)이 검토 기준에 없어 "
                "부록 목차 대조를 하지 않았습니다.",
                "검토 기준 항목의 params.appendix_words 에 적으세요(예: Appendix, 부록).")]
        toc, why = self._toc(doc)
        if why:
            return [why]
        label = self._label(self.words)
        listed: dict[str, tuple[str, str, Anchor]] = {}   # 글자 → (제목, 원문, 위치)
        for section in toc:
            for line in (section.text or "").split("\n"):
                hits = list(label.finditer(line))
                for i, m in enumerate(hits):
                    end = hits[i + 1].start() if i + 1 < len(hits) else len(line)
                    title = re.sub(r"\s*\.{2,}\s*\d*\s*$", "", line[m.end():end]).strip()
                    listed.setdefault(m.group(1).upper(),
                                      (title, _quote(line[m.start():end]), section.anchor))

        heads: dict[str, tuple[str, Anchor]] = {}
        head_re = re.compile(label.pattern + r"\s*(.*)$")
        findings: list[Finding] = []
        for s in doc.iter_sections():
            if s.level < 1:
                continue
            m = head_re.match(s.title or "")
            if m:
                heads.setdefault(m.group(1).upper(), (m.group(2).strip(), s.anchor))
        findings += self._forbidden(doc, toc)

        if not listed:
            if heads:
                return [*findings, self._unreviewed(
                    f"본문에 부록 {len(heads)}개가 있는데 목차에서 부록 목록을 찾지 못했습니다.",
                    "목차에 부록 목록이 없으면 추가하고, 있는데 못 읽은 것이면 직접 확인하세요.")]
            return findings

        for letter, (title, line, anchor) in sorted(listed.items()):
            if letter not in heads:
                findings.append(self._flag(
                    f"목차의 부록 {letter} '{title}' 에 해당하는 본문 부록이 없습니다", anchor,
                    [Evidence(anchor=anchor, quote=line)], "목차의 부록 목록을 고치세요."))
        for letter, (h_title, h_anchor) in sorted(heads.items()):
            if letter not in listed:
                findings.append(self._flag(
                    f"본문 부록 {letter} '{h_title}' 이(가) 목차의 부록 목록에 없습니다", h_anchor,
                    [Evidence(anchor=h_anchor, quote=h_title)], "목차의 부록 목록에 추가하세요."))

        if any(not title for title, _l, _a in listed.values()):
            return self._capped([*findings, self._unreviewed(
                "목차의 부록 목록이 칸이 섞인 채 추출돼 부록 제목은 대조하지 않았습니다 "
                "(번호 누락만 확인했습니다).", "부록 제목은 목차와 본문을 직접 비교하세요.")])
        for letter, (title, line, anchor) in sorted(listed.items()):
            if letter not in heads:
                continue
            h_title, h_anchor = heads[letter]
            if _key(title) == _key(h_title) or self._layout_gap(title, h_title):
                continue
            case_only = _key(title).casefold() == _key(h_title).casefold()
            findings.append(self._flag(
                f"부록 {letter} 제목이 목차와 본문에서 {'대소문자만 ' if case_only else ''}"
                f"다릅니다 — 목차 '{title}' / 본문 '{h_title}'",
                anchor, [Evidence(anchor=anchor, quote=line),
                         Evidence(anchor=h_anchor, quote=h_title)],
                "목차의 부록 목록과 본문 부록 제목을 같게 고치세요."))
        return self._capped(findings)

    @staticmethod
    def _layout_gap(toc_title: str, heading: str) -> bool:
        """추출이 줄바꿈 칸을 섞은 제목인가.

        실측(PLT34 Appendix J): 목차 `between NSSS   and SRS Design Specification`,
        본문 `between NSSS Design Specification and SRS`. 목차 제목 안에 공백 세 칸 이상의
        틈이 있고 낱말 구성이 같으면 줄바꿈 칸이 섞인 것으로 보고 지적하지 않는다.
        """
        return (re.search(r"\S\s{3,}\S", toc_title) is not None
                and Counter(toc_title.split()) == Counter(heading.split()))

    def _forbidden(self, doc: Document, toc: list) -> list[Finding]:
        if not self.forbidden:
            return []
        pattern = self._label(self.forbidden)
        out = []
        toc_ids = {id(s) for s in toc}
        for s in doc.iter_sections():
            texts = ([s.title] if s.level >= 1 else []) + (
                (s.text or "").split("\n") if id(s) in toc_ids else [])
            for text in texts:
                m = pattern.match(text or "")
                if m:
                    out.append(self._flag(
                        f"부록 표기를 {self.words[0]} 로 통일하세요 — '{_quote(text)}'",
                        s.anchor, [Evidence(anchor=s.anchor, quote=_quote(text))],
                        f"{', '.join(self.forbidden)} 대신 {self.words[0]} 를 씁니다."))
        return out
