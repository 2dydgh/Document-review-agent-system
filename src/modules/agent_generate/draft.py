"""평가 항목마다 문서 근거를 찾아 부록 B 초안을 쓴다 — 떠올리고, 찾고, 확인하고, 대조한다.

비교 검토의 누락 판정(agent_trace/missing_judge.py)과 같은 골격이다. 실측(2026-09-08)
에서 모델에게 검색 도구를 쥐여 주는 것보다 "문서가 쓸 법한 말을 내라"가 잘 됐다.

1. 떠올리기(LLM) — 문서가 이 항목을 만족한다면 본문에 나올 법한 낱말 n개.
2. 찾기(코드)   — 그 낱말을 문서에서 문자열로 찾아 절별로 센다. 모델이 찾지 않는다.
3. 확인(LLM)    — 걸린 절만 보여주고 판정·Comment·절 id·원문 인용을 JSON 으로 받는다.
4. 대조(코드)   — 인용은 verify_quotes 로, 절 id 는 보여준 절 안에서만. 하나라도 비면
                  그 항목은 "Not found" 이고 모델 문장은 버린다(근거 없는 초안을
                  남기면 검토자가 믿는다).

판정은 **제안**이다. 화면·엑셀이 "제안:" 을 붙이고 최종은 검토자가 정한다.
"""
from __future__ import annotations

import json
import re
from collections.abc import Callable, Sequence
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass, field

from modules.shared import DocTools, Document, _parse, verify_quotes

from .eval_sheet import EvalItem

SATISFIED, PARTIAL, NOT_FOUND = "Satisfied", "Partially", "Not found"
VERDICTS = (SATISFIED, PARTIAL, NOT_FOUND)

# 행의 **사실**. verdict_hint 는 모델이 낸 제안이고, 이것은 우리가 무엇을 했는지다.
# "근거가 없다"와 "보지 못했다"를 한 값에 섞지 않는다(CLAUDE.md).
#   drafted    — 근거를 확인해 초안을 썼다.
#   not_found  — 문서를 실제로 찾아봤고 받쳐 주는 것이 없었다.
#   unreviewed — 쓸 만한 일이 아무것도 일어나지 않았다(호출 실패·응답 불명·주장 폐기).
DRAFTED, NOT_FOUND_STATUS, UNREVIEWED = "drafted", "not_found", "unreviewed"

MAX_WORDS = 6
MAX_READ = 3
_READ_CHARS = 1500

_BRAIN = (
    "아래는 소프트웨어 V&V 평가 체크리스트의 항목이다. 검토 대상 문서가 이 항목을 "
    "만족한다면 본문이나 절 제목에 나올 법한 낱말을 {n}개 내라. 문서에 쓰였을 언어 그대로"
    "(영문 문서면 영문). 한 낱말이나 짧은 구절씩.\n"
    'JSON 배열 하나만: ["accuracy", "tolerance", ...]\n\n'
    "[항목 {id}]\n{item}\n{ko}"
)

_CONFIRM = (
    "검토 대상 문서가 아래 평가 항목을 만족하는지 **찾은 절만 보고** 판단하라. "
    "절 밖의 내용을 추측하지 마라.\n\n"
    "[항목 {id}]\n{item}\n{ko}\n\n"
    "[찾은 절]\n{found}\n\n"
    "답은 JSON 하나다. 설명을 붙이지 마라.\n"
    '{{"verdict": "Satisfied" | "Partially" | "Not found", '
    '"comment": "부록 B 의 Evaluation result and Comment 칸에 들어갈 영문 한두 문장. '
    '절 번호를 든다", '
    '"section_ids": ["위 절 머리 [제목 / id] 의 id"], '
    '"quotes": ["문서 원문을 글자 그대로 복사한 문장 1~2개"]}}\n\n'
    "Satisfied: 찾은 절에 항목이 요구하는 내용이 있다. Partially: 일부만 있다. "
    "Not found: 없다 — comment·quotes 는 비워라.\n"
    "quotes 는 문서에서 **글자 그대로** 복사하라. 요약하거나 고쳐 쓰면 그 답은 버려진다."
)

_LINE_RX = re.compile(r"^\[(?P<title>[^/\]]*?)\s*/\s*(?P<id>[^\]]+)\]")


@dataclass
class DraftRow:
    item_id: str
    verdict_hint: str
    status: str = DRAFTED                               # drafted | not_found | unreviewed
    comment: str = ""
    sections: list[str] = field(default_factory=list)   # 절 제목("3.2.4 Accuracy")
    quotes: list[dict] = field(default_factory=list)    # {"quote","page","section"}
    reason: str = ""                                    # Not found 일 때 왜
    words: list[str] = field(default_factory=list)      # 떠올린 말

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class EvaluationDraft:
    rows: list[DraftRow]
    unfound: int                                   # status == not_found — 찾아봤고 없었다
    llm_failures: int                              # unreviewed 중 LLM 호출이 실패한 수
    unreviewed: int = 0                            # status == unreviewed — 보지 못했다
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {"rows": [r.to_dict() for r in self.rows], "unfound": self.unfound,
                "llm_failures": self.llm_failures, "unreviewed": self.unreviewed,
                "notes": list(self.notes)}


def _words_of(text: str, n: int) -> list[str]:
    """응답에서 낱말 배열 하나. 따옴표 없는 배열도 쉼표로 갈라 읽는다(missing_judge 실측)."""
    for m in re.finditer(r"\[[^\[\]]*\]", text or "", re.S):
        try:
            cand = json.loads(m.group(0))
        except json.JSONDecodeError:
            cand = [x.strip().strip("\"'") for x in m.group(0)[1:-1].split(",")]
            if len([x for x in cand if x]) < 2:
                continue
        if not isinstance(cand, list):
            continue
        words: list[str] = []
        for w in cand:
            w = str(w).strip()
            if len(w) >= 2 and w not in words:
                words.append(w)
        if words:
            return words[:n]
    return []


def _search(tools: DocTools, words: list[str]) -> dict[str, tuple[str, set[str]]]:
    """말마다 Ctrl+F. 절 id → (제목, 걸린 말 집합)."""
    sections: dict[str, tuple[str, set[str]]] = {}
    terms = list(words)
    for w in words:
        terms += [p for p in re.split(r"\s+", w) if len(p) >= 3 and p not in terms]
    for w in terms:
        for ln in tools.find_term(w).split("\n"):
            m = _LINE_RX.match(ln)
            if not m:
                continue
            sid = m.group("id").strip()
            title, seen = sections.get(sid, (m.group("title").strip(), set()))
            seen.add(w)
            sections[sid] = (title, seen)
    return sections


def _not_found(item: EvalItem, reason: str, words: list[str],
               status: str = NOT_FOUND_STATUS) -> DraftRow:
    return DraftRow(item.id, NOT_FOUND, status=status, reason=reason, words=words)


def _unreviewed(item: EvalItem, reason: str, words: list[str]) -> DraftRow:
    """검토를 못 한 행 — 모델 출력이 쓸모없었다. 문서에 대한 판단이 아니다."""
    return _not_found(item, reason, words, status=UNREVIEWED)


def _draft_one(tools: DocTools, doc: Document, item: EvalItem, llm) -> DraftRow:
    ko = "\n".join(x for x in (item.item_ko, item.viewpoint) if x)
    resp = llm.complete(_BRAIN.format(n=MAX_WORDS, id=item.id, item=item.item[:1500], ko=ko))
    if resp.error:
        return _unreviewed(item, f"LLM 호출 실패: {resp.error}", [])
    words = _words_of(resp.text or "", MAX_WORDS)
    if not words:
        return _unreviewed(item, "떠올린 말을 알아볼 수 없습니다", [])
    hits = _search(tools, words)
    top = sorted(hits.items(), key=lambda kv: (-len(kv[1][1]), kv[0]))[:MAX_READ]
    if not top:
        return _not_found(item, "떠올린 말이 문서에 없습니다", words)
    shown = {sid: title for sid, (title, _w) in top}
    found = "\n\n".join(tools.read_section(sid)[:_READ_CHARS] for sid in shown)
    resp = llm.complete(_CONFIRM.format(id=item.id, item=item.item[:1500], ko=ko, found=found))
    if resp.error:
        return _unreviewed(item, f"LLM 호출 실패: {resp.error}", words)
    obj = _parse(resp.text or "", keys=("verdict",))
    if not obj:
        return _unreviewed(item, "응답 형식을 알아볼 수 없습니다", words)
    verdict = str(obj.get("verdict", "")).strip()
    if verdict not in VERDICTS:
        return _unreviewed(item, f"알 수 없는 판정입니다: {verdict or '(빈 값)'}", words)
    if verdict == NOT_FOUND:
        return _not_found(item, "찾은 절에 근거가 없다고 판단", words)
    ids = [str(s).strip() for s in (obj.get("section_ids") or []) if str(s).strip() in shown]
    if not ids:
        return _unreviewed(item, "절 id 가 보여준 절이 아닙니다", words)
    quotes = [str(q) for q in (obj.get("quotes") or []) if str(q).strip()]
    evidence, _missing = verify_quotes(doc, quotes)
    if not evidence:
        return _unreviewed(item, "인용이 문서에서 확인되지 않았습니다", words)
    return DraftRow(
        item.id, verdict, DRAFTED, comment=str(obj.get("comment") or "").strip(),
        sections=[shown[i] for i in ids],
        quotes=[{"quote": e.quote, "page": e.anchor.page, "section": e.anchor.section}
                for e in evidence],
        words=words)


def draft_evaluation(doc: Document, items: Sequence[EvalItem], llm, *,
                     on_progress: Callable[[int, int], None] | None = None,
                     on_row: Callable[[int, EvalItem, DraftRow], None] | None = None,
                     concurrency: int = 4) -> EvaluationDraft:
    """항목 전부의 초안. 예외는 올리지 않는다 — 한 항목의 오류는 그 행의 reason 이 된다.

    ``on_progress(done, total)`` 은 건수만, ``on_row(index, item, row)`` 는 방금 끝난
    행 자체를 준다 — 화면이 초안이 써지는 것을 행 단위로 보여 줄 때 쓴다. 끝나는
    순서는 입력 순이 아니다(동시 실행).

    # ponytail: 스레드 풀 동시 4 — vLLM 은 배치라 거의 공짜다(rescue_round 와 같다).
    """
    tools = DocTools(doc)
    rows: list[DraftRow | None] = [None] * len(items)
    done = 0
    with ThreadPoolExecutor(max_workers=max(1, int(concurrency))) as pool:
        futs = {pool.submit(_draft_one, tools, doc, it, llm): i for i, it in enumerate(items)}
        for fut in as_completed(futs):
            i = futs[fut]
            try:
                rows[i] = fut.result()
            except Exception as exc:  # noqa: BLE001 — 한 항목이 전체를 죽이지 않게
                rows[i] = _unreviewed(items[i], f"오류: {exc}", [])
            done += 1
            if on_row:
                on_row(i, items[i], rows[i])
            if on_progress:
                on_progress(done, len(items))
    out = [r for r in rows if r is not None]
    unfound = sum(1 for r in out if r.status == NOT_FOUND_STATUS)
    unreviewed = sum(1 for r in out if r.status == UNREVIEWED)
    # reason 접두 검사는 이 모듈 안에서만 쓴다 — 문구는 여기가 짓는다. 밖으로
    # 나가는 것은 status 와 이 수들이다(밖에서 한국어를 다시 읽으면 조용히 깨진다).
    failures = sum(1 for r in out if r.reason.startswith("LLM 호출 실패"))
    notes = []
    if unfound:
        notes.append(f"근거를 찾지 못한 항목 {unfound}건 — 검토자 확인 필요")
    if unreviewed:
        notes.append(f"검토하지 못한 항목 {unreviewed}건 — 검토자 확인 필요")
    if failures:
        notes.append(f"그중 LLM 호출 실패 {failures}건 — 다시 돌리면 나올 수 있습니다")
    return EvaluationDraft(rows=out, unfound=unfound, llm_failures=failures,
                           unreviewed=unreviewed, notes=notes)
