"""누락 요건이 하위 문서에 **번호 없이** 있는지 찾는다 — 떠올리고, 찾고, 확인한다.

`build_rtm` 이 "누락"이라 할 때 아는 것은 하나다: 하위 문서에 그 ID 문자열이
없다. `missing_probe` 는 요건 문장의 낱말이 겹치는 절 몇 개를 짚는다. 둘 다
**요건에 있는 말**로만 본다. 설계자가 같은 것을 다른 말로 썼으면("잠금" ↔
"차단") 여기서 끝난다.

그 자리를 이렇게 메운다.

1. **떠올리기(LLM)** — "설계서가 이 요건을 다른 말로 썼다면 어떤 말이겠나"
   여섯 개. 요건에 이미 있는 말은 버린다(probe 가 본 것이다).
2. **찾기(코드)** — 그 말들을 하위 문서에서 Ctrl+F 한다. 어느 절에 몇 번
   걸렸는지 센다.
3. **확인(LLM)** — 겹친 절(probe)과 걸린 절을 보여주고 "이 요건의 설계인가"
   한 번 묻는다. 설계있음은 하위 원문 인용이 있어야 하고, 그 인용은 문서와
   문자열로 대조한다(verify_quotes). 실패하면 확인못함이다.

예전에는 모델에게 검색 도구를 쥐여 주고 "다음에 뭘 찾을지 골라라"고 했다.
실측(2026-09-08, PRJX, Qwen 27B): 모델이 고른 낱말은 거의 전부 요건 문장의
낱말이었다 — 되돌려 보내도 마찬가지였다. "도구를 고르는" 자리에서는 안전한
말로 돌아가면서, "설계서가 쓸 법한 말을 내라"고 하면 넷 중 넷이 새 말을 냈다.
그래서 모델이 하는 일을 발상과 판단으로만 좁히고, 찾는 것은 코드가 한다.

**판정은 라벨을 바꾸지 않는다.** 누락은 누락이다. 여기서 찾은 것은 화면이
그 요건 옆에 **문장으로** 보여주고, 만족함·수정필요는 검토자가 누른다
(CLAUDE.md "판정은 검토자, 기계 관찰은 근거").

검토자가 힌트를 주면(4단계, "이 말로 다시 찾기") 같은 함수다 — 힌트를 떠올린
말 앞에 둔다.

# ponytail: 행마다 순차 호출(LLM 2회). 누락이 수백 건이면 rescue_round 처럼
# ThreadPoolExecutor 로 감싼다 — vLLM 은 배치라 동시 4면 거의 공짜다.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field

from modules.shared import (
    Anchor,
    DocTools,
    Document,
    Finding,
    Severity,
    _parse,
    verify_quotes,
)

from .missing_probe import MIN_TOKENS, _tokens

#: 판정 어휘. 이 밖의 말은 모델이 지어낸 것이라 쓰지 않는다.
HAS_DESIGN = "설계있음"
NO_DESIGN = "설계없음"
UNKNOWN = "확인못함"

#: 떠올릴 말의 수와, 확인 단계에 보여줄 절의 수.
MAX_WORDS = 6
MAX_READ = 2

_BRAIN = (
    "아래는 요구사항명세서의 요건이다. 상세설계서가 이 요건을 **번호 없이, 다른 "
    "말로** 구현해 두었다면 설계서 본문에 나올 법한 낱말을 {n}개 내라.\n"
    "조건: 요건 문장에 이미 있는 낱말은 안 된다(그 낱말로는 이미 찾아봤다). "
    "설계 문서에서 쓰는 용어 — 모듈·API·함수·화면·테이블 이름에 들어갈 법한 말 — 로. "
    "한 낱말씩. **한국어로** — 설계서가 한국어다(영문 약어는 설계서가 그 표기를 그대로 "
    "쓸 때만, 예: API·JSON).\n"
    'JSON 배열 하나만, 낱말마다 따옴표: ["상태 조회", "로그 수집", ...]\n\n'
    "[요건 {id}]\n{requirement}"
)

_CONFIRM = (
    "상위문서의 요구사항 '{id}' 이 하위문서(설계)에 **ID 가 안 적힌 채로** "
    "구현돼 있는지 판단하라.\n\n"
    "[요구사항 {id}]\n{requirement}\n\n"
    "[하위문서에서 낱말이 겹치는 절]\n{candidates}\n\n"
    "[다른 말로 찾아 걸린 절]\n{found}\n\n"
    "답은 JSON 하나다. 설명을 붙이지 마라.\n"
    '  {{"verdict": "설계있음", "quote": "하위문서 원문을 그대로 복사한 한 문장"}}\n'
    '  {{"verdict": "설계없음"}}\n\n'
    "설계있음: 위 절 중에 이 요구사항을 실현하는 서술이 있다. ID 만 안 적혔다.\n"
    "  quote 는 **하위문서에서 글자 그대로** 복사하라. 요약하거나 고쳐 쓰면 그 "
    "판정은 버려진다.\n"
    "설계없음: 위 절들은 이 요구사항의 구현이 아니다. 같은 주제를 스치듯 언급한 "
    "것은 구현이 아니다 — 요구사항이 **요구하는 동작**이 서술돼 있어야 설계있음이다."
)

_NONE = "(없음)"
_LINE_RX = re.compile(r"^\[(?P<title>[^/\]]*?)\s*/\s*(?P<id>[^\]]+)\]")


@dataclass
class Judgment:
    """누락 하나에 대한 판정과 그 여정. 화면이 여정을 그린다 — 답만 보이면
    에이전트가 일한 과정이 결과에서 사라진다."""

    upper_id: str
    verdict: str                    # 설계있음 | 설계없음 | 확인못함
    section: str = ""               # 설계있음일 때 인용이 있는 절
    page: int | None = None
    quote: str = ""                 # 대조를 통과한 하위문서 원문
    hint: str = ""                  # 검토자가 준 말(4단계)
    words: list[str] = field(default_factory=list)   # 떠올린 새 말(힌트 포함)
    hits: dict = field(default_factory=dict)         # 말 → 걸린 줄 수
    read: list[str] = field(default_factory=list)    # 확인 때 읽힌 절 제목
    reason: str = ""                # 확인못함일 때만. 왜 못 했는지

    def to_dict(self) -> dict:
        return {"verdict": self.verdict, "section": self.section, "page": self.page,
                "quote": self.quote, "hint": self.hint, "words": list(self.words),
                "hits": dict(self.hits), "read": list(self.read), "reason": self.reason}


def already_searched(term: str, requirement: str) -> bool:
    """이 낱말은 probe 가 이미 본 것인가 — 요건 문장에 글자로 있거나, 내용어가
    전부 요건의 내용어 안에 있으면 그렇다."""
    t = (term or "").strip()
    if not t:
        return False
    if t.lower() in (requirement or "").lower():
        return True
    words = _tokens(t)
    return bool(words) and words <= _tokens(requirement)


def _candidate_block(hits) -> str:
    if not hits:
        return _NONE
    out = []
    for h in hits:
        title = h.get("section") or h.get("anchor_section") or "?"
        text = (h.get("text") or "").strip()
        out.append(f"- [{title}] {text[:600]}")
    return "\n".join(out)


def _brainstorm(upper_id: str, requirement: str, llm, n: int) -> tuple[list[str], str]:
    """설계서가 쓸 법한 말 n개. (말들, 실패 사유)."""
    resp = llm.complete(_BRAIN.format(n=n, id=upper_id, requirement=requirement.strip()[:1500]))
    if resp.error:
        return [], f"LLM 호출 실패: {resp.error}"
    # 대괄호 묶음을 전부 훑어 **낱말 배열로 읽히는 첫 것**을 쓴다. 첫 대괄호만
    # 잡으면 모델이 되뇐 "[ID: RQ-…]" 나 "[요건 …]" 에 걸려 배열을 못 본다 —
    # 실측(2026-09-08, PRJX 새 비교): 누락 24건 중 9건이 그렇게 "알아볼 수 없음"이었다.
    raw = None
    for m in re.finditer(r"\[[^\[\]]*\]", resp.text or "", re.S):
        try:
            cand = json.loads(m.group(0))
        except json.JSONDecodeError:
            # 따옴표 없는 배열 `[performance, log, threshold]` — 실측(Qwen 27B)에서
            # 24건 중 9건이 이렇게 왔다. 쉼표로 갈라 읽는다. 되뇐 "[ID: RQ-…]" 는
            # 쉼표가 없어 하나짜리가 되니 둘 미만은 버린다.
            items = [x.strip().strip('"\'') for x in m.group(0)[1:-1].split(",")]
            cand = [x for x in items if x]
            if len(cand) < 2:
                continue
        if isinstance(cand, list) and cand and all(isinstance(x, (str, int, float)) for x in cand):
            raw = cand
            break
    if raw is None:
        return [], "떠올린 말을 알아볼 수 없습니다"
    words = []
    for w in raw if isinstance(raw, list) else []:
        w = str(w).strip() if isinstance(w, (str, int, float)) else ""
        if w and len(w) >= 2 and not already_searched(w, requirement) and w not in words:
            words.append(w)
    return words[:n], ""


def _hint_words(hint: str) -> list[str]:
    """힌트 그대로 + 낱말로 가른 것. 구절이 글자 그대로 없어도 낱말은 걸리게."""
    h = (hint or "").strip()
    if not h:
        return []
    parts = [w for w in re.split(r"\s+", h) if len(w) >= 2 and w != h]
    return [h, *parts]


def _search(tools: DocTools, words: list[str]) -> tuple[dict, dict]:
    """말마다 Ctrl+F. (말→걸린 줄 수, 절 id→(제목, 걸린 말 집합))."""
    counts: dict = {}
    sections: dict = {}
    for w in words:
        out = tools.find_term(w)
        lines = [ln for ln in out.split("\n") if ln.startswith("[")]
        if not lines:
            continue
        counts[w] = len(lines)
        for ln in lines:
            m = _LINE_RX.match(ln)
            if not m:
                continue
            sid = m.group("id").strip()
            title, seen = sections.get(sid, (m.group("title").strip(), set()))
            seen.add(w)
            sections[sid] = (title, seen)
    return counts, sections


def judge_missing(upper_id: str, requirement: str, hits, child: Document,
                  llm, *, hint: str = "", max_words: int = MAX_WORDS) -> Judgment:
    """누락 하나를 판정한다. 예외는 올리지 않는다.

    hits 는 `probe_missing` 이 낸 후보(dict) 목록이다 — 비어 있어도 된다.
    hint 는 검토자가 준 말(4단계). 있으면 떠올린 말 앞에 두고, 요건 서술이
    빈약해 떠올리기를 건너뛸 때도 이것으로는 찾는다.
    """
    thin = len(_tokens(requirement)) < MIN_TOKENS
    hint_words = _hint_words(hint)
    if thin and not hint_words:
        # 요건 서술에 내용어가 거의 없으면 묻지 않는다. 실측(2026-09-02, PRJX):
        # 명세서 앞머리의 **"식별자 사례" 표**에서 정규식이 예시 ID 를 긁어와
        # 요건으로 셌고, 서술은 `| 식별자 사례 | RQ-… |` 뿐이었다. 그대로 물으면
        # 모델은 못 찾고 "설계없음"이라 답한다 — 규칙의 오탐이 확신을 얻는다.
        return Judgment(upper_id, UNKNOWN, hint=hint,
                        reason="요건 서술이 없어 판정할 수 없습니다"
                               "(표 머리글이나 예시 행일 수 있습니다)")
    words = list(hint_words)
    reason = ""
    if not thin:
        more, reason = _brainstorm(upper_id, requirement, llm, max_words)
        words += [w for w in more if w not in words]
    if not words and not hits:
        # 떠올린 말이 다 요건 낱말이었고(모델이 되뇐 것) 겹치는 절도 없다 — 볼 게 없다.
        return Judgment(upper_id, UNKNOWN, hint=hint, reason=reason or "떠올린 말이 없습니다")

    tools = DocTools(child)
    # "알림 발생" 같은 구절은 글자 그대로는 잘 안 걸린다 — 낱말로도 찾는다(힌트와 같은 규칙).
    search_words = list(words)
    for w in words:
        for part in re.split(r"\s+", w):
            if (len(part) >= 2 and part not in search_words
                    and not already_searched(part, requirement)):
                search_words.append(part)
    counts, sections = _search(tools, search_words)
    # 걸린 말이 많은 절부터 둘. 확인 단계가 읽는 자리다.
    top = sorted(sections.items(), key=lambda kv: (-len(kv[1][1]), kv[0]))[:MAX_READ]
    read_titles = [f"{title} / {sid}" for sid, (title, _w) in top]
    found_block = "\n\n".join(tools.read_section(sid)[:1500] for sid, _tw in top) or _NONE

    if not hits and not top:
        # 겹치는 말도 없고 떠올린 말도 안 걸렸다 — 보여줄 절이 없어 모델에게
        # 물을 것도 없다. 이건 "못 찾았다"이고 라벨(누락)은 어차피 그대로다.
        return Judgment(upper_id, NO_DESIGN, hint=hint, words=words, hits=counts)

    resp = llm.complete(_CONFIRM.format(
        id=upper_id, requirement=requirement.strip()[:1500],
        candidates=_candidate_block(hits), found=found_block))
    base = Judgment(upper_id, UNKNOWN, hint=hint, words=words, hits=counts, read=read_titles)
    if resp.error:
        base.reason = f"LLM 호출 실패: {resp.error}"
        return base
    obj = _parse(resp.text or "", keys=("verdict",))
    if not obj:
        base.reason = "응답 형식을 알아볼 수 없습니다"
        return base
    verdict = str(obj.get("verdict", "")).strip()
    if verdict == NO_DESIGN:
        base.verdict = NO_DESIGN
        return base
    if verdict != HAS_DESIGN:
        base.reason = f"알 수 없는 판정입니다: {verdict or '(빈 값)'}"
        return base
    found, _missing = verify_quotes(child, [str(obj.get("quote", "") or "")])
    if not found:
        # "설계가 있다"는 주장인데 근거가 하위 문서에 없다. 설계없음으로 뒤집지
        # 않는다 — 모르는 것이다.
        base.reason = "인용이 하위문서에서 확인되지 않았습니다"
        return base
    ev = found[0]
    base.verdict = HAS_DESIGN
    base.quote = ev.quote
    base.section = ev.anchor.section or ""
    base.page = ev.anchor.page
    return base


#: 한 검토에서 자동 판정할 누락의 상한. 누락이 수백 건인 문서(패턴이 안 맞는
#: 하위 문서 등)에서 호출이 폭주해 "1건 5분"을 깨지 않게 한다. 상한에 걸린
#: 건수는 INFO 로 드러낸다 — 조용히 자르면 "판정했더니 다 누락"으로 읽힌다.
MAX_JUDGMENTS = 40


def judge_missing_rows(rtm, statements: dict, probes: dict, child: Document,
                       llm, *, max_judgments: int = MAX_JUDGMENTS,
                       on_progress=None) -> tuple[dict, int]:
    """누락 행 전부를 판정한다. (id→Judgment, 상한에 걸려 못 본 건수)."""
    rows = [r for r in rtm if r.status == "missing" and r.upper_id]
    todo, skipped = rows[:max_judgments], max(0, len(rows) - max_judgments)
    out: dict = {}
    for seq, row in enumerate(todo, 1):
        if on_progress:
            on_progress(seq, len(todo))
        out[row.upper_id] = judge_missing(
            row.upper_id, statements.get(row.upper_id, ""),
            probes.get(row.upper_id, []), child, llm)
    return out, skipped


def apply_judgments(findings: list[Finding], judgments: dict,
                    skipped: int = 0) -> list[Finding]:
    """판정이 지적 목록에 남기는 것은 **검토 과정 보고**뿐이다.

    등급은 건드리지 않는다. 예전에는 설계있음이면 MAJOR 를 MINOR 로 내렸는데,
    그건 기계가 내린 작은 판정이었다(2026-09-08 결정: 라벨은 규칙만 정하고,
    AI 는 찾은 문장을 보여준다 — 화면의 하위 카드가 Judgment 를 그린다).
    못 본 건수만 INFO 로 묶어 드러낸다 — 행마다 내면 누락 31건이 지적 62건이 된다.
    """
    unknown = [f"{j.upper_id} — {j.reason}" if j.reason else j.upper_id
               for j in judgments.values() if j.verdict == UNKNOWN]
    notices = []
    if unknown:
        notices.append(Finding(
            checker="traceability",
            severity=Severity.INFO,
            message=(f"누락 {len(unknown)}건은 설계 유무를 자동으로 판정하지 "
                     f"못했습니다. 직접 확인하세요 · "
                     + " · ".join(unknown[:10])
                     + (" …" if len(unknown) > 10 else "")),
            anchor=Anchor(page=None, section=None),
            unreviewed=True,
        ))
    if skipped:
        notices.append(Finding(
            checker="traceability",
            severity=Severity.INFO,
            message=(f"누락이 많아 {skipped}건은 설계 유무를 판정하지 "
                     f"않았습니다(상한 {MAX_JUDGMENTS}건). 남은 건은 "
                     f"'누락' 그대로입니다."),
            anchor=Anchor(page=None, section=None),
            unreviewed=True,
        ))
    return list(findings) + notices
