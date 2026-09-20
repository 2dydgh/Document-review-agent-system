"""ID 참조 추출: 문서 텍스트에서 정규식으로 ID를 스캔한다.

포맷 독립적이다. pattern은 체크리스트 설정값으로 주입된다.
"""
from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass

from modules.shared import Anchor, Document


@dataclass(frozen=True)
class Statement:
    """ID 하나가 서술된 한 줄과 그 위치."""

    id: str
    text: str
    section_title: str
    anchor: Anchor


# PDF 표 셀 안에서는 ID가 하이픈 뒤에서 줄바꿈된다("FR-\nESCM_08"). 실측
# (PLT34 RVVR)으로 358회. 붙이지 않으면 하위문서에 **실재하는** ID를 못 찾아
# 상위문서의 그 요건이 '누락'으로 보고된다 — 없는 결함을 만들어내는 것이다.
#
# 하이픈으로 끝난 줄만 잇는다. 아무 줄이나 이으면 표의 다음 행이 앞 행에
# 달라붙어 서술이 뒤섞인다.
_WRAP = re.compile(r"-[ \t]*\n[ \t]*")


def _unwrap(text: str | None) -> str:
    return _WRAP.sub("-", text or "")


def _excluded(line: str, words: Sequence[str]) -> bool:
    """이 줄이 스스로 "예시"라고 말하고 있는가.

    문서 앞머리의 "식별자 사례" 표에 적힌 ID(`| 식별자 사례 | SRS-RQ-001 |`)는
    형식 설명이지 요건이 아니다. 그런데 정규식은 그것도 잡아, 하위문서에 없다며
    MAJOR "누락"을 내고 추적표에 행까지 만들었다(2026-09-14 QA 지적).

    표 한 행은 한 줄로 들어오므로(doc_parser/ingestion/docx.py 의 `| a | b |`,
    pdf_tables 도 같다) 줄만 봐도 같은 행의 라벨이 보인다. 낱말 목록은 문서
    서식마다 달라 코드가 아니라 기준이 정한다(params.id_example_words).
    """
    return any(w in line for w in words)


def extract_id_anchors(doc: Document, pattern: str,
                       exclude_words: Sequence[str] = ()) -> dict[str, Anchor]:
    """pattern에 매칭되는 ID를 {id: 최초 등장 Anchor}로 반환한다.

    exclude_words 중 하나가 있는 줄의 ID는 세지 않는다. 버린 건수는
    `excluded_ids` 가 돌려준다 — 조용히 지우지 않는다(루트 CLAUDE.md).
    """
    if not pattern:
        return {}
    rx = re.compile(pattern)
    found: dict[str, Anchor] = {}
    for sec in doc.iter_sections():
        for text in (_unwrap(sec.title), _unwrap(sec.text)):
            # 제외어가 없으면 통째로 훑는다 — 예전 동작 그대로다.
            for line in (text.splitlines() if exclude_words else [text]):
                if _excluded(line, exclude_words):
                    continue
                for m in rx.finditer(line):
                    _id = m.group(0)
                    if _id not in found:
                        found[_id] = sec.anchor
    return found


def excluded_ids(doc: Document, pattern: str,
                 exclude_words: Sequence[str]) -> set[str]:
    """제외어 줄에서만 나온 ID. 본문에도 나오는 ID는 뺀다 — 그건 실재하는 요건이다.

    "예시라서 안 셌다"를 화면에 드러내려고 있다. 두 번 훑지만 제외어를 쓰는
    문서쌍에서만 돌고, 대조를 한 번 더 하는 것보다 판정이 갈릴 자리가 없다.
    """
    if not pattern or not exclude_words:
        return set()
    return set(extract_id_anchors(doc, pattern)) - set(
        extract_id_anchors(doc, pattern, exclude_words))


#: 서술 블록 상한. 프롬프트에 문서 반 쪽이 통째로 실리지 않게 막는다.
_STMT_MAX_CHARS = 800

#: 요건 머리줄의 ID 표식 — "제목 [ID: RQ-…]". 다음 요건이 시작되는 신호로 쓴다.
_ID_MARK = re.compile(r"\[\s*ID\s*[:：]")


def extract_id_statements(doc: Document, pattern: str,
                          exclude_words: Sequence[str] = ()) -> dict[str, Statement]:
    """pattern에 매칭되는 ID를 {id: 그 ID의 서술 블록}으로 반환한다.

    섹션 단위로 자르면 안 된다. 요구사항은 보통 한 섹션에 여러 개가 나열되므로
    (예: "- SR-001 ...", "- SR-002 ..."), 섹션 전체를 넘기면 어느 요건에 대한
    판단인지 흐려지고 같은 텍스트를 ID 수만큼 반복 전송하게 된다.

    **한 줄이 아니라 블록이고, 등장 위치마다 후보를 만들어 가장 긴 것을 남긴다.**
    실측(PRJX-AN-002): ID 의 첫 등장은 요구사항 목록 표의 제목 행이라
    ("| RQ-… | 융복합 데이터 플랫폼 연계 | |") 첫 줄만 잡으면 내용 대조가
    "제목 vs 설계 서술"을 비교하게 된다 — 모순이 나올 수 없는 비교다. 정의 절의
    서술은 ID 가 적힌 제목 줄 **아래**에 이어지므로, 다른 ID 가 나오기 전까지의
    줄들을 블록으로 잇는다. 목록 표에서는 다음 행이 곧 다른 ID 라 지금처럼 한
    줄로 끝나고, 정의 절에서만 서술이 따라온다.
    """
    if not pattern:
        return {}
    rx = re.compile(pattern)
    found: dict[str, Statement] = {}
    for sec in doc.iter_sections():
        lines = [_unwrap(sec.title)] + _unwrap(sec.text).splitlines()
        for i, line in enumerate(lines):
            if _excluded(line, exclude_words):
                continue  # 예시로 적힌 ID — 요건이 아니다
            ids_here = {m.group(0) for m in rx.finditer(line)}
            for _id in ids_here:
                # ponytail: 등장 줄마다 앞으로 훑어 O(줄²)이지만 섹션은 짧고
                # 블록 상한이 걸음을 끊는다. 실측 병목이 되면 그때 인덱싱.
                block = [line.strip()]
                size = len(line)
                for nxt in lines[i + 1:]:
                    if {m.group(0) for m in rx.finditer(nxt)} - {_id}:
                        break  # 다른 ID 의 서술이 시작된다
                    if _ID_MARK.search(nxt) and _id not in nxt:
                        # "… [ID: RQ-ECR-PR-002]" 같은 다음 요건의 머리줄. 그 ID 가 pattern 에
                        # 안 맞으면(자릿수가 다른 옛 ID) 위 조건이 못 잡아 다음 요건 제목이
                        # 이 요건 서술 끝에 붙었다(실측 2026-09-16, PRJX-AN-002).
                        break
                    if size + len(nxt) > _STMT_MAX_CHARS:
                        break
                    block.append(nxt.strip())
                    size += len(nxt)
                text = "\n".join(x for x in block if x).strip()
                prev = found.get(_id)
                if prev is None or len(text) > len(prev.text):
                    found[_id] = Statement(
                        id=_id, text=text, section_title=sec.title,
                        anchor=sec.anchor)
    return found
