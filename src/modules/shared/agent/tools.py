"""근거 재확인이 쓰는 읽기 전용 문서 검색 도구."""
from __future__ import annotations

import re

from ..models import Document

# 한 번의 도구 결과가 컨텍스트를 다 먹지 않게 하는 상한.
_MAX_CHARS = 2000
_MAX_HITS = 30

# 구절 검색이 0건일 때 낱말별로 재어 알려줄 최대 개수. 넘기면 힌트가 검색
# 결과보다 길어져 모델이 무엇을 보라는 것인지 흐려진다.
_MAX_HINT_WORDS = 8

# 힌트에 실을 낱말의 최소 길이. 한 글자는 조사·기호라 세어도 뜻이 없다.
_MIN_HINT_WORD = 2


def _clip(text: str, limit: int = _MAX_CHARS) -> str:
    if len(text) <= limit:
        return text
    return text[:limit] + f"\n…(생략 — 전체 {len(text)}자)"


def _norm(text: str) -> str:
    """제목 비교용: 공백·§·끝의 점을 지우고 소문자로."""
    return re.sub(r"[\s§]+", "", str(text or "")).rstrip(".").lower()


def _doc_no(title: str) -> str:
    """제목 첫머리의 문서 번호("3.0 References" → "3.0", "부록 B" → "부록b"). 없으면 ""."""
    t = str(title or "").strip()
    m = re.match(r"(\d+(?:\.\d+)*)\.?(?=\s|$)", t)
    if m:
        return m.group(1)
    a = re.match(r"(?:appendix|부록)\s*([A-Za-z0-9]+)", t, re.IGNORECASE)
    return ("부록" + a.group(1).lower()) if a else ""


class DocTools:
    SPECS = [
        {"name": "find_term", "args": {"term": "str"},
         "desc": "그 낱말이 나오는 모든 줄과 위치를 찾는다."},
        {"name": "read_section", "args": {"section_id": "str"},
         "desc": "그 절의 본문을 통째로 읽는다. "
                 "section_id 는 find_term 결과의 [제목 / id] 중 id."},
    ]

    def __init__(self, doc: Document) -> None:
        self._sections = list(doc.iter_sections())

    def find_term(self, term: str) -> str:
        if not term:
            return "term 인자가 필요합니다."
        hits = []
        for s in self._sections:
            for line in (s.text or "").split("\n"):
                line = line.strip()
                if line and term in line:
                    hits.append(f"[{s.title} / {s.id}] {line}")
        if not hits:
            return f"'{term}' 은(는) 문서에 없습니다." + self._word_hint(term)
        shown = hits[:_MAX_HITS]
        out = "\n".join(shown)
        if len(hits) > _MAX_HITS:
            out += f"\n…({len(hits)}곳 중 {_MAX_HITS}곳만 표시)"
        return _clip(out)

    def _count(self, word: str) -> int:
        """그 낱말이 나오는 줄 수. 힌트를 만들 때만 쓴다."""
        return sum(1 for sec in self._sections
                   for line in (sec.text or "").split("\n") if word in line)

    def _word_hint(self, term: str) -> str:
        """구절 검색이 0건일 때, 낱말을 하나씩 재어 알려준다.

        find_term 은 **정확 부분문자열** 매칭이라 여러 낱말을 붙여 넣으면 그
        구절이 글자 그대로 이어져 있어야 걸린다. 실측(2026-09-03, PRJX 문서쌍):
        모델이 요건 표의 라이브러리 이름 다섯 개를 통째로 넣어
        `find_term("Tensorboard FastAPI Uvicorn Pytorch Scikit-learn")` 를
        불렀고 당연히 0건이 나왔다. 2낱말 구절도 절반이 0건이었다
        (`"관할 구역"` vs 본문 `"관할구역"`).

        문제는 0건이라는 **답이 두 가지를 뭉갠다**는 것이다 — 문서에 정말
        없는 것과, 검색어가 잘못된 것. 모델은 그것을 구별하지 못해 "없다"로
        결론짓고, 그 결론이 "설계없음"(MAJOR 결함)까지 간다. 그래서 도구가
        스스로 쪼개 재어 알려준다. 왕복은 안 늘어난다 — 같은 응답에 실어
        보낸다.

        낱말을 원형으로 되돌리지 않는다(어간 추출을 하지 않는다). 모델이 이
        결과를 보고 **그대로 다시 검색해야** 하므로, 여기 적힌 낱말은
        find_term 에 그대로 넣어 통해야 한다.
        """
        words = [w for w in term.split() if len(w) >= _MIN_HINT_WORD]
        # 낱말이 하나뿐이면 쪼갤 것이 없다 — 그때의 0건은 진짜 0건이다.
        if len(words) < 2:
            return ""
        counted = [(w, self._count(w)) for w in words[:_MAX_HINT_WORDS]]
        body = " · ".join(f"'{w}' {n}곳" for w, n in counted)
        if all(n == 0 for _w, n in counted):
            return f"\n낱말을 하나씩 찾아도 없습니다 — {body}"
        return (f"\n낱말을 하나씩 찾으면 — {body}\n"
                f"걸린 낱말로 다시 찾아보세요.")

    def outline(self) -> str:
        """목차: 절마다 `[id] 제목 (N쪽)` 한 줄. 어느 절이 어디인지 한 번에 본다.

        어시스턴트가 "3.0 References 가 §몇인지"를 찾기 도구로 더듬는 데 호출 수십 번을
        썼다(2026-09-15 대화 실측: 참조문서 목록 하나에 찾기 26 · 읽기 12). 이 한 번이면 된다.
        """
        lines = []
        for s in self._sections:
            page = getattr(getattr(s, "anchor", None), "page", None)
            lines.append(f"[{s.id}] {s.title}" + (f" ({page}쪽)" if page else ""))
        return _clip("\n".join(lines) or "(절이 없다)", limit=8000)

    def _resolve(self, query: str) -> list:
        """id · 제목 · 문서 번호 어느 것으로든 절을 찾는다. 후보 목록을 돌려준다."""
        q = str(query or "").strip()
        exact = [s for s in self._sections if s.id == q]
        if exact:
            return exact
        nq, qno = _norm(q), _doc_no(q) or _norm(q)
        by_no = [s for s in self._sections if _doc_no(s.title) and _doc_no(s.title) == qno]
        if by_no:
            return by_no
        return [s for s in self._sections if nq and _norm(s.title).startswith(nq)]

    def read_section(self, section_id: str, offset: int = 0) -> str:
        """절 하나를 통째로. find_term 이 준 줄만으로는 앞뒤를 못 볼 때 쓴다.

        section_id 는 파서 순번(id)뿐 아니라 **문서의 제목이나 번호**("3.0",
        "3.0 References", "부록 B")도 받는다 — 사람은 문서 번호로 말하지 파서 순번을
        모른다(2026-09-15 대화: 라벨을 그대로 넣고 오류를 두 번 받았다). 여럿이면
        후보를 돌려주고 고르게 한다. 긴 절은 offset 으로 이어 읽는다.
        """
        if not section_id:
            return "section_id 인자가 필요합니다."
        found = self._resolve(section_id)
        if not found:
            return (f"'{section_id}' 절이 없습니다. 목차(list_sections)에서 id 나 제목을 "
                    f"확인하세요.")
        if len(found) > 1:
            cands = "\n".join(f"[{s.title} / {s.id}]" for s in found[:12])
            return (f"'{section_id}' 에 맞는 절이 {len(found)}개입니다. id 로 다시 부르세요:\n"
                    f"{cands}")
        s = found[0]
        body = s.text or "(빈 절)"
        start = max(0, int(offset or 0))
        rest = body[start:]
        head = f"[{s.title} / {s.id}]" + (f" (offset {start}부터)" if start else "") + "\n"
        if len(rest) > _MAX_CHARS:
            return (head + rest[:_MAX_CHARS] +
                    f"\n…(계속 — 전체 {len(body)}자, 이어 읽으려면 offset={start + _MAX_CHARS})")
        return head + rest

    def run(self, name: str, args: dict) -> str:
        try:
            if name == "find_term":
                return self.find_term(args["term"])
            if name == "read_section":
                return self.read_section(args["section_id"], int(args.get("offset") or 0))
        except KeyError as exc:
            return f"인자가 빠졌습니다: {exc.args[0]}"
        except Exception as exc:
            # 검색 후보 하나의 잘못된 인자가 재확인 라운드 전체를 죽이지 않게 한다.
            return f"인자가 잘못됐습니다: {exc}"
        return (f"알 수 없는 도구입니다: {name}. "
                f"쓸 수 있는 도구: {', '.join(s['name'] for s in self.SPECS)}")
