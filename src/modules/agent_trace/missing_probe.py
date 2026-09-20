"""누락 요건이 하위 문서 **어디쯤**에 있을지 짚어 준다.

`build_rtm` 이 "누락"이라고 할 때 그 말의 뜻은 하나다 — **하위 문서에 그 ID
문자열이 없다.** 그런데 검토자가 판정하려면 두 경우를 갈라야 한다.

* 설계 자체가 없다 → 진짜 결함. 설계팀에 넘긴다.
* 설계는 있는데 ID 만 안 적혔다 → 문서 결함. 고칠 사람도 고칠 것도 다르다.

이 둘은 하위 문서를 열어 봐야만 갈린다. 그래서 지금까지 검토자는 한글을 따로
열고 키워드로 뒤졌다 — 누락 31건이면 31번(2026-09-02 실측 피드백:
"화면에 누락됐다고 나오면 그 부분으로 가서 실제 검사를 해야 하나?").

여기서는 요건 서술의 낱말로 하위 문서 절을 훑어 **가장 닮은 절**을 몇 개 짚는다.
찾아 주는 것이 아니라 **어디를 볼지** 좁혀 주는 것이다.

**환각은 구조가 막는다.** 후보는 하위 문서에 실재하는 절 중에서 고른 것이라
지어낼 자리가 없다 — 인용을 문자열로 대조할 필요조차 없다(CLAUDE.md 계약을
더 강하게 지키는 셈이다). 점수도 "몇 개의 낱말이 겹쳤나"라는 관찰이지 판정이
아니다. 판정은 사람이 한다.

LLM 은 쓰지 않는다. 규칙 검사는 LLM 없이 동작해야 하고(CLAUDE.md), 누락 수십
건마다 모델을 부르면 검토 한 건이 5분을 넘긴다. 낱말 겹침만으로도 "여기 있다/
비슷한 게 없다"는 충분히 갈린다.
# ponytail: 낱말 겹침(자카드 유사)만 쓴다. 동의어·표기 흔들림은 못 잡는다 —
# 실측에서 놓치는 것이 눈에 띄면 그때 용어집(팀 기준)을 물려 확장한다.
"""
from __future__ import annotations

import re

from modules.shared import Document

#: 후보로 낼 최대 개수. 셋을 넘기면 "어디를 볼지"가 다시 흐려진다.
MAX_HITS = 3

#: 이 아래로 겹치면 후보로 안 낸다. 낮게 잡으면 아무 절이나 딸려 와서,
#: "비슷한 게 없다"는 진짜 신호가 묻힌다.
MIN_SCORE = 0.12

#: 어느 문서에나 있어 변별력이 없는 말. 이것만 겹치는 절은 후보가 아니다.
#: 도메인 용어가 아니라 **문서 상용어**만 넣는다 — 팀·과제마다 다른 말을 여기
#: 박으면 기준을 코드에 넣는 것이 된다(CLAUDE.md).
_STOP = frozenset("""
그리고 또는 및 등 이 그 저 것 수 때 등의 대한 관한 위한 통해 따라 각 해당
경우 이상 이하 미만 초과 이내 사항 내용 관련 대하여 있는 없는 하는 되는 한다
된다 있다 없다 한 두 세 시스템 기능 요구 요구사항 설계 문서 항목 정의 사용
제공 처리 지원 구성 포함 필요 가능 여부 확인 관리 상태 정보 데이터
결과 기술 작성 정상 방법 설명 제목 출처 이력 검증 확인
""".split())

#: 낱말로 칠 최소 길이. 한 글자는 조사·수식어라 신호가 아니다.
_MIN_TOKEN = 2

#: 짚으려면 요건 쪽에 내용어가 최소 이만큼은 있어야 한다. 한둘로 짚으면
#: 우연히 겹친 절이 올라온다 — 서술을 못 뽑은 요건(ID 만 있는 행)이 그렇다.
MIN_TOKENS = 3

_TOKEN_RX = re.compile(r"[0-9A-Za-z가-힣]+")


def _is_stop(word: str) -> bool:
    """조사가 붙은 꼴도 흔한 말로 본다.

    _STOP 은 기본형("시스템")만 담는데 문서에는 조사가 붙어 나온다("시스템은").
    그대로 비교하면 하나도 안 걸러진다(실측: "시스템은·기능과·데이터를" 셋 다
    통과해 개요 절이 후보로 올라왔다). 형태소 분석기를 들이지 않으려고 **앞부분
    일치**로 본다 — 기본형이 앞에 있고 남는 꼬리가 두 글자 이내면 조사다.
    """
    for k in range(max(_MIN_TOKEN, len(word) - 2), len(word) + 1):
        if word[:k] in _STOP:
            return True
    return False


#: 라틴 낱말의 최소 길이. 요건 ID 조각(rq · vp · sfr · pr)이 전부 2~3 글자라,
#: 짧은 라틴을 세면 **ID 형식이 같은 절끼리 다 닮아 보인다** — 실측에서
#: "겹친 말: 001 · 01 · rq · vp" 로 엉뚱한 절 셋이 후보로 올라왔다(2026-09-02).
_MIN_LATIN = 5   # 4자도 뺀다 — 과제 코드(prjx)가 절마다 박혀 겹친 말을 채웠다


def _tokens(text: str) -> set[str]:
    """비교에 쓸 낱말. 형태소 분석기를 들이지 않으려고 낱말 **앞부분**만 잘라
    맞춘다(아래 _stem). 완벽하진 않지만 "모니터링을"과 "모니터링" 이 갈리는
    것은 막는다.
    """
    out = set()
    for raw in _TOKEN_RX.findall(text or ""):
        w = raw.lower()
        if len(w) < _MIN_TOKEN or _is_stop(w):
            continue
        # 숫자만인 낱말은 내용이 아니다 — ID 의 일련번호(001)·구성코드(01)가
        # 여기로 새면 번호 체계가 같은 절이 전부 후보가 된다.
        if w.isdigit():
            continue
        # 짧은 라틴도 같은 이유로 뺀다(rq · vp · sfr 는 ID 조각이다).
        if _MIN_TOKEN <= len(w) < _MIN_LATIN and w.isascii():
            continue
        out.add(_stem(w))
    return out


def _stem(word: str) -> str:
    """한글 낱말의 꼬리를 잘라 대충 맞춘다.

    조사·어미가 붙어도 앞부분은 같다는 성질만 쓴다. 네 글자를 넘는 한글
    낱말만 자른다 — 짧은 말을 자르면 서로 다른 낱말이 같아진다("검사"→"검").
    """
    if len(word) > 4 and all("가" <= c <= "힣" for c in word):
        return word[:-1]
    return word


def _score(need: set[str], have: set[str]) -> float:
    """요건 낱말 중 몇 할이 이 절에 있나.

    자카드가 아니라 **요건 쪽 기준**이다. 긴 설계 절이 짧은 요건을 다 담고
    있으면 그건 좋은 후보인데, 자카드로 재면 길이 차이 때문에 점수가 떨어진다.
    """
    if not need:
        return 0.0
    return len(need & have) / len(need)


class ProbeHit:
    """하위 문서에서 짚은 후보 한 자리."""

    __slots__ = ("section", "anchor_section", "page", "page_end", "text", "score", "shared")

    def __init__(self, section: str, anchor_section: str, page: int | None,
                 text: str, score: float, shared: list[str],
                 page_end: int | None = None) -> None:
        self.section = section
        self.anchor_section = anchor_section
        self.page = page
        # 절이 끝나는 쪽(다음 절이 시작하는 쪽). 설계서는 절 하나가 표 열 쪽짜리라,
        # 뷰어가 그 절의 문장을 찾을 때 시작 쪽만 보면 못 찾고 문서 전체를 보면
        # 엉뚱한 쪽의 같은 칸으로 간다. 이 범위 안에서만 찾게 한다.
        self.page_end = page_end
        self.text = text
        self.score = score
        #: 실제로 겹친 낱말. 검토자가 "왜 이 절인가"를 바로 안다 — 점수만
        #: 보여주면 숫자를 믿으라는 말이 된다.
        self.shared = shared

    def to_dict(self) -> dict:
        return {"section": self.section, "anchor_section": self.anchor_section,
                "page": self.page, "page_end": self.page_end, "text": self.text,
                "score": round(self.score, 3), "shared": self.shared}


#: 줄(표 행)의 이만큼 이상에 나오면 "흔한 말". 줄이 적은 문서에선 안 뺀다.
#: 절 단위로 재면 안 된다 — 실측(PRJX 설계서)은 절이 셋뿐이고 각각이 거대한 표라
#: 절 DF 로는 아무것도 안 걸렸다. 표 행이 단위여야 "출처·이력·검증 방법" 칸이 잡힌다.
COMMON_RATIO = 0.2
COMMON_MIN_LINES = 40
#: 표의 **칸 이름**("설명"·"출처"·"이력"·"검증 방법")은 줄 DF 로는 안 걸린다 —
#: 469줄 중 32줄이면 7% 다. 대신 짧은 글이 칸 하나를 통째로 차지하며 이만큼
#: 되풀이되면 칸 이름이다. 실측(PRJX 설계서): 설명 32 · 출처 17 · 이력 17 · 검증 방법 15.
LABEL_MIN_REPEATS = 5
LABEL_MAX_CHARS = 6


def _common_tokens(child: Document) -> set[str]:
    """하위 문서에서 뜻 없이 되풀이되는 낱말 — 줄의 COMMON_RATIO 이상에 나오거나,
    표의 칸 이름으로 LABEL_MIN_REPEATS 번 이상 나오는 것."""
    lines = [ln for sec in child.iter_sections()
             for ln in (sec.text or "").split("\n") if ln.strip()]
    if len(lines) < COMMON_MIN_LINES:
        return set()
    df: dict[str, int] = {}
    cells: dict[str, int] = {}
    for ln in lines:
        for t in _tokens(ln):
            df[t] = df.get(t, 0) + 1
        for c in ln.split("|"):
            c = c.strip()
            if c and len(c) <= LABEL_MAX_CHARS:
                cells[c] = cells.get(c, 0) + 1
    limit = len(lines) * COMMON_RATIO
    common = {t for t, n in df.items() if n >= limit}
    for c, n in cells.items():
        if n >= LABEL_MIN_REPEATS:
            common |= _tokens(c)
    return common


def _surface_words(text: str) -> dict[str, str]:
    """어간 → 문장에 실제로 나온 낱말. 화면엔 이것을 보여준다 — 어간("인터페이")은
    맞추기용이지 읽으라고 있는 게 아니다(2026-09-08, "겹친 말: 인터페이 · 정상적으")."""
    out: dict[str, str] = {}
    for raw in _TOKEN_RX.findall(text or ""):
        w = raw.lower()
        st = _stem(w)
        if st not in out:
            out[st] = raw
    return out


#: 절 제목이 이만큼 되풀이되면 절이 아니라 **머릿말·꼬리말**이다(HWP 파서가 쪽마다
#: "상세설계서"·문서 제목을 절로 만든다). 후보에서 뺀다 — 그 절엔 온갖 말이 다 들어
#: 있어 점수만 높고 가면 아무것도 없다.
HEADER_TITLE_REPEATS = 3


def probe_missing(requirement_text: str, child: Document,
                  max_hits: int = MAX_HITS,
                  min_score: float = MIN_SCORE) -> list[ProbeHit]:
    """요건 서술과 가장 닮은 하위 문서 절을 짚는다.

    후보가 하나도 없으면 빈 목록이다 — 그 자체가 답이다("비슷한 내용이
    없습니다"). 억지로 하나 채우면 검토자가 그 절을 열어 보고 헛걸음한다.
    """
    need = _tokens(requirement_text)
    # 하위 문서 절 대부분에 나오는 낱말은 겹쳐도 뜻이 없다 — 실측(PRJX 설계서):
    # 컴포넌트 표마다 "설명·이력·출처·검증" 칸이 있고 과제 코드 "prjx" 가 절마다
    # 박혀 있어, 후보의 "겹친 말"이 그 낱말들로 채워졌다. 손으로 불용어를 늘리는
    # 대신 이 문서에서 흔한 말을 재서 뺀다 — 문서마다 흔한 말이 다르다.
    common = _common_tokens(child)
    need = need - common
    # 내용어가 거의 없으면 짚지 않는다. 요건 서술을 못 뽑은 행(ID 만 있거나
    # 표 머리글만 잡힌 행)이 여기 걸린다 — 그 상태로 짚으면 ID 번호 체계가
    # 같은 절이 우연히 올라와서, 검토자가 엉뚱한 곳을 열어 본다(실측).
    if len(need) < MIN_TOKENS:
        return []
    hits: list[ProbeHit] = []
    sections = list(child.iter_sections())
    surface = _surface_words(requirement_text)
    title_count: dict[str, int] = {}
    for sec in sections:
        t = (sec.title or "").strip()
        title_count[t] = title_count.get(t, 0) + 1
    for i, sec in enumerate(sections):
        if title_count.get((sec.title or "").strip(), 0) >= HEADER_TITLE_REPEATS:
            continue
        body = f"{sec.title or ''}\n{sec.text or ''}"
        have = _tokens(body) - common
        score = _score(need, have)
        if score < min_score:
            continue
        shared = sorted(surface.get(t, t) for t in (need & have))
        # 다음 절이 시작하는 쪽이 이 절의 끝 쪽.
        nxt = next((s2.anchor.page for s2 in sections[i + 1:] if s2.anchor.page), None)
        hits.append(ProbeHit(
            section=sec.title or "", anchor_section=sec.anchor.section,
            page=sec.anchor.page, text=(sec.text or "").strip(),
            score=score, shared=shared,
            page_end=nxt if (nxt and sec.anchor.page and nxt >= sec.anchor.page) else None))
    hits.sort(key=lambda h: (-h.score, h.anchor_section or ""))
    return hits[:max_hits]
