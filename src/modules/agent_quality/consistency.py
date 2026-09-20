"""LLM기반 체커: 청크별 모호성/모순 점검. 근거를 대야 지적이 된다.

옛 구현은 모델이 'ISSUE: …'로 시작하기만 하면 그 문장을 그대로 지적으로
채택했다. 실문서(요구사항명세서)에서 58건이 나왔고 내용은 쓸 만했지만 —
식별자 설명과 형식의 불일치, 같은 기능의 제목이 문서마다 다른 것 — 그중
무엇이 진짜이고 무엇이 모델이 지어낸 것인지 구분할 방법이 없었다. 근거가
하나도 없었기 때문이다.

그래서 agent가 쓰는 관문을 여기에도 세운다: 모델은 지적과 함께 원문을
그대로 인용해야 하고(`quotes`), 그 인용이 실제 문서에 있는지 글자 단위로
대조해(`verify_quotes`) 통과한 것만 리포트에 올린다. 통과 못 한 후보는
버리되, 몇 건을 버렸는지는 INFO로 드러낸다 — 조용히 지우면 "지적이 없다"는
거짓말이 된다.

파서(`_parse`)도 agent의 것을 그대로 쓴다. 환각 방지 코드가 두 벌이 되면
한쪽만 고쳐지고 다른 쪽은 뚫린다.
"""
from __future__ import annotations

import re
import threading
from collections.abc import Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

from modules.shared import (
    Anchor,
    Context,
    DocTools,
    Document,
    Finding,
    Severity,
    _is_substantive,
    _norm,
    _parse,
    verify_quotes,
)

from .rescue import RescueCandidate, rescue_round

#: 인용이 **산문**이 아니면 지적으로 내지 않는다.
#:
#: 환각 관문(verify_quotes)은 "이 인용이 문서에 있는가"만 본다. 잔해를 충실히
#: 인용한 지적은 그 관문을 그대로 통과한다 — 지어낸 게 아니기 때문이다.
#: 실측(2026-08-20, PLT56_SYSA_RVVR_Rev05.pdf): 지적 53건 중 20건이 문서가 아니라
#: 추출 결과가 깨진 것이었고, 그중 아래 모양이 절반이다.
#:
#: **좁게 건다.** 표 안의 진짜 오타(`descripted`)까지 죽이면 안 되므로, 문장이라고
#: 볼 수 없는 것만 거른다. 나머지(칸이 공백으로 이어붙은 것)는 여기서 못 가리고
#: 파서가 표를 문장과 안 섞이게 내야 풀린다.
_TOC_DOTS = re.compile(r"\.{6,}")
#: 글자로 된 낱말이 **하나라도** 있는가. 잡으려는 것은 `3.1.1. 3.1.2.` 처럼
#: 글자가 아예 없는 줄이다.
#:
#: 한때 "이런 낱말이 둘 이상"을 요구했는데 한국어를 죽였다 — 한 글자 낱말이
#: 흔해서 `본문 한 줄` 은 `본문` 하나만 잡히고, `표 및 그림` 은 `그림` 하나만
#: 잡힌다. 영어 한 낱말짜리 인용(`descripted`)도 같이 죽었다. 문턱은 "번호뿐인
#: 줄"을 가르는 데 필요한 만큼만 건다 — 이 모듈은 좁게 거는 것이 원칙이다.
_WORD = re.compile(r"[A-Za-z가-힣]{2,}")
#: 표 **여러 행**이 한 인용에 뭉친 모양.
#:
#: 한 행은 칸 수 + 1 이다(`| 항목 | 결과 | 비고 |` = 파이프 넷). 그래서 넷으로
#: 자르면 멀쩡한 세 칸짜리 행이 죽는다 — 표 안의 오타를 봐야 하므로 살려야 한다
#: (CLAUDE.md 공통 C1: "본문뿐 아니라 표·그림 제목·부록·평가표까지 본다").
#: 실측 잔해는 파이프가 일곱 이상이었다.
_MANY_CELLS = 7

#: 빈 칸이 잇달아 나오는 자리(`| |  | |`). 여러 행이 눌려 붙을 때 생긴다 —
#: 사람이 쓴 표 한 행에는 빈 칸이 이렇게 연달아 오지 않는다.
_EMPTY_CELLS = re.compile(r"\|\s*\|")
_MANY_EMPTY = 2


def _is_prose(quote: str) -> bool:
    """이 인용을 문장으로 볼 수 있는가."""
    if _TOC_DOTS.search(quote):
        return False                      # 목차 점선
    if quote.count("|") >= _MANY_CELLS:
        return False                      # 표 여러 행이 뭉침
    if len(_EMPTY_CELLS.findall(quote)) >= _MANY_EMPTY:
        return False                      # 빈 칸이 잇달아 붙음
    if not _WORD.search(quote):
        return False                      # 번호·기호뿐 (`3.1.1. 3.1.2.`)
    return True


#: "A 와 B 가 뒤바뀌었다/혼용됐다" 꼴의 주장. 이런 지적만 아래 필터를 건다.
_SWAP_CLAIM = re.compile(r"뒤바뀌|바뀌어|혼용|섞여|서로 다르게 (?:쓰|사용)|반대로")
#: 근거 안의 `약어(한글명)` 과 `…_약어_… | 한글명` 짝. 둘 다 실측 근거에 있던 꼴이다.
_PAIR_PAREN = re.compile(r"([가-힣][가-힣\s]{1,20}?)\s*\(\s*([A-Z]{2,8})\s*\)")
_PAIR_TABLE = re.compile(r"[a-z]+_([a-z]{2,8})_\d+\s*\|\s*([가-힣][가-힣]{1,20})")
#: 한글명 앞에 붙은 조사·접속어. "중앙해양안전심판원(ORGA)과 해양경찰청(OGB)" 에서
#: 둘째 이름이 "과 해양경찰청" 으로 잡혀 같은 기관이 두 이름이 됐다(실측).
_LEADING_PARTICLE = re.compile(r"^(?:과|와|및|의|또는|그리고)\s+")


def _clean_name(kor: str) -> str:
    return _LEADING_PARTICLE.sub("", kor.strip()).strip()


def _evidence_refutes_swap(message: str, quotes: list[str]) -> bool:
    """뒤바뀜 주장인데 근거가 **한결같으면** 지적은 성립하지 않는다.

    인용 대조(verify_quotes)는 인용이 문서에 실재하는지만 본다. 그런데 인용이 실재해도
    주장이 틀릴 수 있다 — 실측(2026-08-25, PRJX-DS-014): "ORGA 와 OGB 의 기관 명칭이
    뒤바뀌어 사용되고 있다" 는 지적의 근거 셋이 전부 ORGA=중앙해양안전심판원,
    OGB=해양경찰청 으로 **같은 짝**이었다. 모델이 든 근거가 모델의 주장을 반박한다.
    화면에는 MAJOR 로 나갔고 문서는 멀쩡했다.

    모델에게 되묻지 않는다(CLAUDE.md). 근거 문장에서 `약어↔한글명` 짝을 뽑아, 어느
    약어도 두 가지 한글명을 갖지 않으면 "뒤바뀜"은 성립할 수 없다 — 그 사실만 본다.
    짝을 하나도 못 뽑으면 판단하지 않는다(True 를 돌려주지 않는다). 다른 종류의
    모순은 건드리지 않는다 — 이 규칙을 넓히면 진짜 모순까지 죽인다.
    """
    if not _SWAP_CLAIM.search(message):
        return False
    names: dict[str, set[str]] = {}
    for q in quotes:
        for kor, abbr in _PAIR_PAREN.findall(q):
            names.setdefault(abbr.upper(), set()).add(_clean_name(kor))
        for abbr, kor in _PAIR_TABLE.findall(q):
            names.setdefault(abbr.upper(), set()).add(_clean_name(kor))
    if len(names) < 2:
        return False                       # 짝이 둘은 돼야 "서로 뒤바뀜"을 잴 수 있다
    return all(len(v) == 1 for v in names.values())


@dataclass
class _Unit:
    """검사 단위 하나. 청크와 같은 모양이면 되므로 text·anchor 만 있으면 된다."""
    text: str
    anchor: Anchor


def _criterion_line(c) -> str:
    """기준 한 줄. 본문 아래 세부(note)가 있으면 '확인 방법'으로 함께 싣는다.

    세부를 빼면 "개정바를 **아래 기준으로** 표시했는가?" 처럼 정작 그 기준이
    빠진 문장이 모델에게 간다.
    """
    head = f"No.{getattr(c, 'no', '')}  {getattr(c, 'text', '')}".strip()
    note = (getattr(c, "note", "") or "").strip()
    if not note:
        return head
    body = "\n".join(f"       {ln}" for ln in note.splitlines() if ln.strip())
    return f"{head}\n       확인 방법:\n{body}"


def _no_aliases(criteria) -> dict[str, str]:
    """모델이 되돌려줄 법한 번호 표기 → 진짜 기준 번호.

    **왜 필요한가.** `_criterion_line` 이 프롬프트에 `No.C1  오탈자…` 로 싣는다.
    모델은 본 대로 `"No.C1"` 을 돌려주는데 판정표의 열쇠는 `"C1"` 이라, 대조가
    어긋나 답이 전부 "모델이 지어낸 번호"로 버려졌다. 화면에는 "LLM 이 답했지만
    이 기준의 판정은 오지 않았습니다" 로 떴다 — **원인을 반대로 가리킨 것이다.**

    실측(2026-08-26, Qwen3.8-27B, PRJX-AN-002, 청크 3개): 기준 4개를 물어 매번
    4개 전부 판정이 왔다. 커버리지는 100% 였고 우리가 100% 를 버리고 있었다.

    프롬프트에서 `No.` 를 빼는 것으로는 부족하다 — 모델이 제 나름의 접두사·마침표를
    붙이는 것을 막을 방법이 없다. 그래서 **받는 쪽에서** 눕힌다. 눕힌 값이 실제
    기준과 맞을 때만 받으므로 "지어낸 번호는 버린다"는 성질은 그대로다.
    """
    out: dict[str, str] = {}
    for c in criteria:
        real = str(getattr(c, "no", "") or "")
        if not real:
            continue
        for k in (real, _flatten_no(real), *_expand_range(real)):
            out.setdefault(k, real)
    return out


#: `SRVR03-01~07` 처럼 **우리가** 접어 쓴 범위 표기. 팀 md 의 항목 여럿이 문구가
#: 같아 기준 하나로 합친 자리다(ax-quality.yaml 참고). 접두사는 팀마다 다르므로
#: 문자 종류를 가리지 않는다 — 엔진에 팀 규칙을 박지 않는다(CLAUDE.md).
_RANGE_NO = re.compile(r"^(.*?)(\d+)~(\d+)$")
#: 펼칠 최대 개수. 오타(`1~9999`)가 별칭표를 부풀리는 것만 막는다.
_RANGE_MAX = 50


def _expand_range(real: str) -> list[str]:
    """접어 쓴 범위를 펼친 별칭. 범위가 아니면 빈 목록.

    실측(2026-08-26, Qwen3.8-27B, 2회 모두 동일): `No.SRVR03-01~07` 을 주면
    모델은 `SRVR03-01` ~ `SRVR03-07` **일곱 줄로 펼쳐서** 답한다. 범위 표기를
    범위로 읽는 것이라 나무랄 데가 없다 — 접은 쪽이 우리다. 펼친 번호를 전부
    같은 기준으로 되돌리면, 그중 하나라도 위반이면 위반이 된다(판정 합치기의
    기존 규칙 그대로다).
    """
    m = _RANGE_NO.match(real.strip())
    if not m:
        return []
    head, lo_s, hi_s = m.group(1), m.group(2), m.group(3)
    lo, hi = int(lo_s), int(hi_s)
    if hi < lo or hi - lo + 1 > _RANGE_MAX:
        return []
    out = []
    for n in range(lo, hi + 1):
        one = f"{head}{n:0{len(lo_s)}d}"
        out.extend((one, _flatten_no(one)))
    return out


def _flatten_no(s: str) -> str:
    """번호 표기를 대조용으로 눕힌다: 'No.C1' · 'C1.' · ' c1 ' → 'c1'."""
    s = str(s or "").strip()
    s = re.sub(r"^(?:no|번호)\s*[.:]?\s*", "", s, flags=re.IGNORECASE)
    return s.strip().strip(".").strip().casefold()

_PROMPT = (
    "아래 [검토 기준]에 비추어 [문서 조각]을 검사하라.\n\n"
    "[검토 기준]\n{criteria}\n\n"
    # 도구를 프롬프트 **끝**에 덧붙였더니 3천 자 뒤라 모델이 쳐다보지도 않았다.
    # 실측(2026-09-02, Qwen3.8-27B, "§4.2 에 정한 기한" 조각 × 3회):
    #   끝에 덧붙임 0/3 · 최소 프롬프트라도 results 뒤면 0/3 ·
    #   응답 형식 블록 안 (1)번으로 올리면 3/3 (read_section("4.2") 정확)
    # 모델은 **처음 본 스키마에 못 박힌다.** 자리가 곧 값이다 — 이 블록을
    # 아래로 내리면 도구는 다시 없는 것이 된다.
    "답은 둘 중 하나의 JSON 하나다. 설명을 붙이지 마라.\n\n"
    "(1) **이 조각만으로는 알 수 없고 문서의 다른 곳을 봐야** 판정되면 — 도구를 "
    "부른다. 조각이 다른 절을 가리키거나(§4.2 등), 값을 맞춰봐야 하는데 그 짝이 "
    "조각에 없을 때다. 추측하거나 해당없음으로 넘기지 마라.\n"
    '  {{"tool": "find_term", "args": {{"term": "찾을 낱말"}}}}\n'
    "      그 낱말이 나오는 모든 줄과 위치를 **문서 전체**에서 찾는다.\n"
    '  {{"tool": "read_section", "args": {{"section_id": "절 번호"}}}}\n'
    "      그 절의 본문을 통째로 읽는다.\n"
    "  도구 결과를 받으면 그때 (2) 로 판정하라. 도구로 찾은 원문도 quotes 에 "
    "넣을 수 있다 — 글자 그대로 복사하는 규칙은 같다.\n"
    "  **조각만으로 답할 수 있으면 도구를 쓰지 마라.** 확신이 서면 바로 (2) 다.\n\n"
    "(2) 판정할 수 있으면 — 기준마다 하나씩:\n"
    '{{"results": [\n'
    '  {{"no": "기준 번호", "verdict": "위반", "kind": "모순", '
    '"issue": "무엇이 왜 이 기준에 어긋나는지 한두 문장", '
    '"quotes": ["문제가 되는 원문을 그대로 복사한 문장"]}},\n'
    '  {{"no": "기준 번호", "verdict": "통과"}},\n'
    '  {{"no": "기준 번호", "verdict": "해당없음"}}\n'
    "]}}\n"
    "verdict 는 셋 중 하나다.\n"
    "  위반: 이 조각이 이 기준에 어긋난다.\n"
    "  통과: 이 조각을 이 기준으로 봤고 어긋난 곳이 없다.\n"
    "  해당없음: 이 기준이 **이 조각을 대상으로 하지 않는다.** 기준이 다른 종류의\n"
    "    문서를 말하거나, 이 조각에 그 기준이 볼 것이 애초에 없을 때다.\n"
    "    이때는 위반도 통과도 아니다 — 반드시 해당없음이라고 답하라.\n"
    "    '이 조각에는 …에 대한 내용이 없다' 는 위반이 아니라 해당없음이다.\n"
    # 실측(2026-09-02, Qwen3.8-27B): "§4.2 에 정한 기한 안에 제출한다" 라는
    # 조각에 "값이 서로 어긋나지 않아야 한다" 기준을 걸었더니 3회 모두
    # `해당없음` 이었다. 도구는 쳐다보지도 않았다 — 해당없음이 더 싼 출구다.
    "    다만 **'이 조각에 없다'와 '조각 밖을 봐야 안다'는 다르다.** 조각이 다른 "
    "절을 가리키거나(§4.2 등), 값을 맞춰봐야 하는데 그 짝이 조각에 없으면 그것은 "
    "해당없음이 **아니다** — 아래 도구로 짝을 찾아본 뒤에 판정하라.\n"
    "kind 는 셋 중 하나만 쓴다 — 다른 말은 쓰지 마라.\n"
    "  모순: 문서의 두 서술이 서로 어긋나거나, 값·범위·대상이 맞지 않는다.\n"
    "  표기: 오타·문법·띄어쓰기처럼 글자 차원의 잘못이다. 뜻은 알아볼 수 있다.\n"
    "  모호: 뜻이 여러 갈래로 읽히거나 근거가 불분명하다. 어긋난 짝은 없다.\n"
    "quotes 는 조각에서 글자 그대로 복사해야 한다. 요약하거나 고쳐 쓰지 마라 — "
    "원문과 한 글자라도 다르면 그 지적은 버려진다.\n"
    # 실측(2026-08-19): "주어-서술어 수일치 오류" 지적 하나가 같은 표의 18줄을
    # 통째로 인용했다. 정작 오류가 있는 줄은 한둘이고 나머지는 멀쩡한 문장이라,
    # 화면은 멀쩡한 문장 17개에 형광펜을 칠했다. 인용의 **실재**는 코드가
    # 대조하지만(verify_quotes) **해당 여부**는 대조할 방법이 없다 — 여기서 막는다.
    "quotes 에는 그 지적이 실제로 들어맞는 문장만 넣는다. 한 문장이면 하나만 넣어라 — "
    "같은 표·같은 문단에 있다는 이유로 멀쩡한 이웃 문장을 함께 싣지 마라.\n"
    "문장마다 잘못이 다르면 지적을 나눠서 내라(같은 기준 번호로 여러 줄을 내도 된다).\n"
    "고쳐 쓴 문장은 내지 마라. 무엇이 문제인지만 말한다.\n"
    # 실제로 "그러나/하지만/반면" 으로 결론을 네 번 뒤집는 15문장짜리 issue 가
    # 나왔다(2026-08-12). 판단 과정을 issue 칸에 쏟은 것이다. "한두 문장" 이라는
    # 부탁만으로는 안 막혔으므로 무엇을 쓰지 말아야 하는지를 못박는다.
    # **이것은 보장이 아니다** — 모델에게 부탁하는 것은 코드가 아니다. 길이가
    # 실제로 길게 나왔을 때는 화면이 접어서 받는다(index.html .fmsg).
    "issue 에는 **결론만** 쓴다. 판단 과정을 쓰지 마라 — 여러 해석을 늘어놓거나, "
    "'그러나' · '하지만' · '반면' 으로 앞말을 뒤집지 마라. 무엇이 어느 기준에 "
    "어긋나는지 한 문장이면 된다. 확신이 서지 않으면 그 기준은 통과로 답하라 — "
    "**다만 문서의 다른 곳만 보면 확신할 수 있는 경우는 예외다.** 그때는 통과로 "
    "넘기지 말고 아래 도구를 불러라.\n\n"
    # 실측(2026-08-20, PLT56_SYSA_RVVR_Rev05.pdf): 지적 53건 중 20건이 **문서가
    # 아니라 우리 추출 결과**가 깨진 것이었다. 모델은 잘못이 없다 — 저 글자들이
    # 조각에 실재하니 "문장이 깨졌다"는 정확한 관찰이다. 깨뜨린 쪽이 우리다.
    #   원문(표)  [Rev.01] Not applicable: same evaluation results as Rev.00.
    #   조각      [Rev.01] Not applicable: same evaluation results as N/A N/A Rev.00.
    # 환각 관문도 이건 못 막는다. 지어낸 게 아니라 잔해를 충실히 인용한 것이다.
    # **부탁은 코드가 아니다** — 아래 _is_prose 가 실제 방어고, 이 문단은 애초에
    # 덜 나오게 하는 것이다.
    "[문서 조각]은 원본이 아니라 **기계가 뽑아낸 글**이다. 표·목차·쪽 경계에서 "
    "다음이 섞여 들어온다 — 이것은 **문서의 잘못이 아니므로 지적하지 마라.**\n"
    "  · 표의 칸이 이어붙어 문장처럼 보이는 것. `|` 가 있는 줄은 표의 한 행이다.\n"
    "  · 빈 칸이 `N/A` 로 채워져 문장 한가운데 끼어든 것 "
    "(`results as N/A N/A Rev.00`).\n"
    "  · 목차의 점선(`Purpose......6`), 줄바꿈에서 갈라진 낱말(`Shin- Kori`), "
    "참조 절 번호만 늘어선 줄(`3.1.1. 3.1.2.`).\n"
    "  · 조각 경계에서 앞뒤가 잘린 문장. 조각은 문서의 일부다 — 첫 문장이 "
    "주어 없이 시작하거나 끝 문장이 중간에 끊겨도 그것은 잘린 것이지 오류가 아니다.\n"
    # 실측(2026-09-09, OAS 요구사항명세서): 표지 로고 두 장에 `[그림 3]` `[그림 4]`
    # 가 붙었고 모델이 "그림 번호가 1·2 없이 3부터 시작한다"고 확실 등급으로 냈다.
    # 번호는 파서가 뽑은 이미지 순번(형광펜·설명의 연결 열쇠)이지 문서의 캡션이 아니다.
    "  · `[그림 N: …]` 은 **도구가 그림 자리에 끼운 표시**다. N 은 도구가 매긴 순번이고 "
    "뒤의 글은 비전 모델이 그림에서 읽은 것이다. 문서의 그림 번호·캡션이 아니므로 "
    "번호 순서·누락·표기를 이것으로 판정하지 마라. 문서의 진짜 캡션은 표시 밖에 "
    "따로 있다(`그림 3. 시스템 구성도` 처럼).\n"
    "표 안에서는 **낱말의 오타만** 본다(`descripted` → `described`). "
    "표 행을 두고 '문장 구조가 깨졌다' · '주어와 동사가 안 맞는다' 고 하지 마라 — "
    "표의 칸은 애초에 문장이 아니다.\n\n"
    "[문서 조각]\n{text}"
)

#: 조각 하나에 허용하는 도구 호출 횟수. 넘으면 판정 없이 미검토로 돌린다.
#
# 2 인 이유: find_term 으로 위치를 찾고 read_section 으로 그 절을 읽는 것이
# 이 검사가 실제로 필요한 최장 경로다. 더 열어 두면 조각 하나가 라운드를
# 물고 늘어져 "1건 5분"을 깬다.
# ponytail: 고정 2회. 기준별로 달리 주고 싶어지면 Criterion 에 자리를 낸다.
_MAX_TOOL_CALLS = 2

# kind → 심각도. **중대성** 축이다 — "이 지적이 남아 있으면 팀이 이 문서를 그대로
# 낼 수 있는가"로 가른다(CLAUDE.md "기능 방침 — 심각도").
#
# 여기 없는 값(빠졌거나 어휘 밖)은 MINOR 로 떨어진다. 반대로 두면(기본 MAJOR)
# 모델이 칸을 빠뜨릴 때마다 거짓 경보가 된다 — 모르는 것을 위로 올리지 않는다.
#
# 이 체커 하나가 전체 지적의 90%대를 낸다. 예전엔 전부 MINOR 하드코딩이라
# "요구사항 모순"과 "'Dose' 는 'Does' 의 오타" 가 같은 칸에 앉아 있었다.
# 실측(기록 974개 표본): 모순·불일치 40% · 표기 20% · 모호 19% · 그 밖 21%.
#
# 실측(2026-08-05, Qwen3.6-27B, 8회 호출): 오타 조각("filed" · "Communicati on" ·
# "를구현하여")을 `표기` 로 정확히 붙여 MINOR 로 내려갔다 — 오타를 MAJOR 로 부풀리지
# 않았다. 다만 8회짜리 표본이라 분포·오분류율은 아직 모른다. 기록 974개로 제대로
# 재는 절차는 roadmap.md "일관성 지적의 kind 실측" 에 있다.
# 프롬프트가 받는 어휘. 이 밖의 말은 모델이 지어낸 것이라 화면에 내보내지 않는다.
#: 그림에서 읽은 글자만으로 표기를 판정한 지적에 덧붙이는 말.
_FROM_IMAGE = (" — 그림에서 읽은 글자입니다. 비전 모델이 옮겨 적은 것이라 "
               "글자를 확정할 수 없습니다. 그림을 직접 확인하세요.")


def _spelling_from_image_only(kind: str, evidence) -> bool:
    """글자 모양을 따지는 지적인데 근거가 **그림에서 읽은 글자뿐**인가.

    그림 설명은 비전 모델이 옮겨 적은 것이다(`app/images.py`). `verify_quotes` 는
    이것을 못 막는다 — 그 글자가 본문에 실재하기 때문이다. 모델이 쓴 줄에.
    대조 상대가 원문이 아니라 **다른 모델의 산출물**이라 환각 관문이 겉으로만
    통과한다.

    실측(2026-08-31, PRJX-DS-005 §3.1.4.2 그림 18): 화면 캡처 속 `매우 높음`·
    `야간` 을 `태우 높음`·`아칸` 으로 읽어, 문서에 없는 오탈자 2건이 `표기`
    지적으로 리포트에 올랐다.

    **버리지는 않는다.** 그림 안의 진짜 오타일 수 있고, 조용히 지우면 "지적이
    없다"는 거짓말이 된다(루트 CLAUDE.md). 등급을 INFO 로 내리고 `unreviewed`
    로 넘긴다 — 기계가 못 하는 판정을 사람에게 넘기되, 넘긴다는 사실을 화면이
    말하게 한다. 그림 한 번 열면 검토자가 5초에 판정한다.

    **좁게 건다.** `표기` 만이다 — 근거가 글자 그 자체인 검사라 글자를 못 믿으면
    판정 자체가 불가능하다. `모순`·`모호` 는 뜻을 따지므로 그림에서 읽어도
    값어치가 있다(구성도의 시스템 이름이 본문에 없는 문서가 실제로 있었다).
    """
    return kind == "표기" and bool(evidence) and all(e.image_no for e in evidence)


_KINDS = ("모순", "표기", "모호")
_KIND_SEVERITY = {"모순": Severity.MAJOR}
_KIND_DEFAULT = Severity.MINOR

# 한 프롬프트에 실을 기준 수의 상한. 목록이 길어지면 모델이 뒤쪽 기준을 소홀히
# 하고, 그러면 "통과" 판정을 믿을 수 없게 된다 — 기준별 화면이 통과 판정 위에
# 서 있으므로 이 상한이 화면의 정직함을 떠받친다.
# 실측(2026-07-30, Qwen3.6-27B): 규칙 7개를 한꺼번에 주면 3/4(하나를 3회 모두
# 조용히 누락), 1개로 좁혀 물으면 4/4. 판정 능력이 아니라 커버리지 문제였다.
# 3~4 는 아직 추정이다. 골든셋이 생기면 묶음 크기별 recall 을 재서 정한다.
_BATCH = 4


class ChunkCriteriaChecker:
    """검토 기준을 문서 조각마다 적용하는 LLM 검사기.

    이름의 ``Criteria`` 는 검사 내용이 클래스에 고정되지 않고 주입된 기준의
    ``text``·``note`` 에서 온다는 뜻이다. 같은 실행기가 맞춤법·표기·모호성 등
    서로 다른 조각 기준을 처리한다.
    """

    name = "consistency"
    label = "표현 점검"

    def __init__(self, criteria: Sequence = ()):
        # 기준 없이 만들면 검사할 것이 없다. 예전처럼 일반 프롬프트로 훑지 않는다 —
        # 기준 없는 지적은 어느 기준에도 붙일 수 없어, 화면이 그 지적을 모든 항목에
        # 똑같이 복사해 보여주게 된다(그게 이 작업이 고치는 문제다).
        #
        # 기준은 no·text 속성으로만 읽는다. preset.Criterion 을 import 하지 않아
        # 이 모듈은 폴더째 떼어가도 돈다(README 의 의존성 목록 참고).
        self.criteria = list(criteria)
        # 기준 번호 → 통과|위반|해당없음|미판정. check() 가 채운다.
        self.verdicts: dict[str, str] = {}
        # 호출 몇 번 중 몇 번이 답을 못 받았나. **미판정의 이유를 가르는 값**이다 —
        # 전부 무응답이면 서버를 살려야 하고, 응답이 왔는데도 어떤 기준이 미판정이면
        # 모델이 그 기준을 빠뜨린 것이다(_BATCH 주석의 커버리지 문제). 검토자가
        # 할 일이 다르므로 조립 계층이 두 경우를 갈라 보여준다.
        self.calls = 0
        self.unanswered = 0
        # 기준 번호 → (판정을 못 돌려받은 호출 수, 물은 호출 수, 첫 이유). check() 가 채운다.
        self.failures: dict[str, tuple[int, int, str | None]] = {}

    def _batches(self) -> list[list]:
        return [self.criteria[i:i + _BATCH]
                for i in range(0, len(self.criteria), _BATCH)]

    def plan(self, doc: Document, ctx: Context) -> dict | None:
        if not self.criteria:
            return None
        return {"kind": "chunk",
                "total": len(ctx.chunks) * len(self._batches()),
                "label": self.label,
                "description": "문장·문단별 맞춤법, 모호성, 표현 오류",
                "scope": f"{len(ctx.chunks)}개 조각"}

    def _units(self, doc: Document, ctx: Context) -> tuple[list, list[Finding]]:
        """검사 단위와, 그에 딸린 알림. 조각은 청크마다 하나씩이다.

        하위 클래스가 이 자리를 갈아끼운다(WholeDocCriteriaChecker 는 문서 하나).
        """
        return list(ctx.chunks), []

    def _prompt(self, listing: str, text: str) -> str:
        return _PROMPT.format(criteria=listing, text=text)

    def _accept_row(self, row: dict, text: str, doc: Document) -> bool:
        return True

    def _jobs(self, doc: Document, ctx: Context) -> tuple[list, list[Finding]]:
        """(검사단위, 기준묶음) 쌍과 알림. 단위 하나를 묶음 수만큼 묻는다.

        기준마다 보는 단위가 다른 검사기(SectionCriteriaChecker)가 이 자리를 갈아끼운다.
        """
        batches = self._batches()
        units, notices = self._units(doc, ctx)
        return [(c, b) for c in units for b in batches], notices

    def check(self, doc: Document, ctx: Context) -> list[Finding]:
        jobs, notices = self._jobs(doc, ctx)
        if not jobs:
            return list(notices)
        total = len(jobs)
        self.verdicts = {str(c.no): "미판정" for c in self.criteria}
        aliases = _no_aliases(self.criteria)
        self.calls, self.unanswered = total, 0

        # 청크끼리는 서로를 보지 않는다(각 조각을 독립으로 판정한다). 그래서 동시에
        # 물어도 결과가 달라지지 않는다. vLLM 은 요청을 배치로 묶어 처리하도록
        # 만들어져 하나씩 보내면 GPU 가 계속 대기한다 — 실측(27B, L40S x2):
        #   순차 4건 145.0초(36.2초/건) · 동시 8건 33.3초(4.2초/건) → 8.7배.
        # 청크 83개 문서가 9분 39초에서 1분 안쪽이 된다.
        workers = max(1, min(int(getattr(ctx, "llm_concurrency", 1) or 1), total))
        # 절 id → 제목. 보고 줄에는 파서가 매긴 §번호가 아니라 **쪽·절 제목**을 적는다 —
        # §번호는 문서 순서대로 붙인 것이라 검토자가 문서에서 찾을 수 없다(2026-09-16).
        titles = {sec.id: (sec.title or "").strip() for sec in doc.iter_sections()} if doc else {}

        done = [0]
        lock = threading.Lock()

        def report() -> None:
            """몇 개 끝났는지 알린다.

            동시에 돌면 완료 순서가 뒤섞이므로 "3번째 청크"가 아니라 "3개 끝남"으로
            센다. 화면 격자는 누적 개수를 받으므로 그대로 맞는다.
            """
            with lock:
                done[0] += 1
                i = done[0]
            ctx.on_progress({"key": "review", "status": "running",
                             "detail": f"{self.label} {i}/{total} 검사 중",
                             "step": {"kind": "chunk", "i": i, "total": total,
                                      "label": self.label}})

        def one(job) -> tuple[list, str | None, str | None, list[RescueCandidate], int]:
            """(청크, 기준묶음) → (판정 목록, 실패종류, 실패이유, 구조후보, 즉시폐기수).
            예외는 안 올린다.

            판정 목록의 한 줄은 (기준번호, 판정, 지적 또는 None) 이다.
            """
            chunk, batch = job
            rescues: list[RescueCandidate] = []
            dropped_outright = 0
            # 근거가 주장을 못 받쳐 뺀 지적들. 건수만 세면 검토자가 할 수 있는 게 없다 —
            # 어느 절의 무슨 지적을 뺐는지 보고에 실어 "잔해가 맞다 / 진짜 지적인데
            # 인용만 틀렸다"를 사람이 가릴 수 있게 한다(2026-09-16).
            dropped_artifact: list[dict] = []
            try:
                listing = "\n".join(_criterion_line(c) for c in batch)
                # 조각 하나로 판정되면 첫 응답에서 끝난다(예전과 같은 1회 호출).
                # 모델이 "이 조각만으로는 모르겠다"고 도구를 부를 때만 라운드가
                # 늘어난다 — 그 조각의 판정이 조각 밖에 있다는 뜻이다.
                messages = [{"role": "user", "content":
                             self._prompt(listing, chunk.text)}]
                obj, resp, why, tools = None, None, None, None
                for i in range(_MAX_TOOL_CALLS + 1):
                    # 첫 턴은 예전 그대로 complete() 다. 도구를 안 부르면 호출도
                    # 동작도 예전과 똑같다 — chat() 은 도구 결과를 **다음 턴에
                    # 실어야 할 때만** 쓴다. 그래서 complete() 만 구현한 클라이언트
                    # (스텁·테스트 더블)가 이 변경으로 깨지지 않는다.
                    resp = (ctx.llm.complete(messages[0]["content"]) if i == 0
                            else ctx.llm.chat(messages))
                    obj = _parse(resp.text or "", keys=("results", "tool"))
                    if not obj or "tool" not in obj:
                        break
                    if not hasattr(ctx.llm, "chat"):
                        # 도구를 부르려면 여러 턴이 필요하다. 못 하는 클라이언트면
                        # 판정을 지어내지 않고 미검토로 올린다.
                        obj, why = None, "이 LLM 클라이언트는 도구를 쓸 수 없습니다"
                        break
                    if i == _MAX_TOOL_CALLS:
                        # 마지막 차례까지 도구만 불렀다 — 판정이 없다. 조용히
                        # 0건으로 두지 않고 미검토로 올린다(CLAUDE.md).
                        obj, why = None, (f"문서를 {_MAX_TOOL_CALLS}번 더 "
                                          f"찾아보고도 판정을 내지 않았습니다")
                        break
                    if tools is None:
                        # 도구를 실제로 부르는 조각에서만 만든다. 미리 만들면
                        # 도구를 안 쓰는 조각(대부분)까지 문서를 통째로 훑는다.
                        tools = DocTools(doc)
                    args = obj.get("args")
                    result = tools.run(str(obj.get("tool") or ""),
                                       args if isinstance(args, dict) else {})
                    messages.append({"role": "assistant",
                                     "content": resp.text or ""})
                    messages.append({"role": "user", "content":
                                     f"[도구 결과]\n{result}\n\n이제 results 로 "
                                     f"판정하라. JSON 하나만."})
                    obj = None
                if (not obj or not isinstance(obj.get("results"), list)) and why is None \
                        and resp is not None and (resp.text or "").strip() and not resp.error \
                        and not getattr(resp, "truncated", False):
                    # 답은 왔는데 판정 JSON 이 아니다(말로 답했거나 JSON 을 깨뜨렸다).
                    # 시간 초과는 클라이언트가 한 번 더 보내는데 이쪽만 재시도가 없어
                    # 35회 중 1회 형식 실패가 조각 하나를 통째로 미검토로 떨어뜨리고,
                    # 계보에서는 그 검사기의 지난 지적 12건을 "판단 못 함"으로 가렸다
                    # (실측 2026-09-15). 같은 질문을 딱 한 번 더 한다 — 온도 0 이라도
                    # 긴 조각에서 가끔 나는 일이라 두 번째는 대개 된다.
                    resp = ctx.llm.complete(messages[0]["content"])
                    obj = _parse(resp.text or "", keys=("results", "tool"))
                    if obj and "tool" in obj:
                        obj = None      # 두 번째는 도구 없이 판정만 받는다
                    if not obj or not isinstance(obj.get("results"), list):
                        why = ("답이 판정 JSON 형식이 아님 — 한 번 더 물어도 같음"
                               if not resp.error else None)
                if not obj or not isinstance(obj.get("results"), list):
                    # 모델이 답을 안 줬거나(빈 응답·연결 실패) 형식을 못 지켰다.
                    # "문제 없음"과 구분해야 한다 — 안 세면 LLM 을 안 붙였을 때도,
                    # 주소를 잘못 넣었을 때도 조용한 0건이 되어 통과한 것처럼 보인다.
                    # 이유도 남긴다: "응답을 받지 못했습니다"만 말하면 주소가 틀린
                    # 것인지 모델명이 틀린 것인지 알 수 없다(실제로 HTTP 404 를 이
                    # 메시지가 가려 한참 헤맸다).
                    # 답은 왔는데 출력 한도에서 끊겨 JSON 을 못 읽은 경우는 이유를 따로
                    # 적는다. 안 적으면 "응답을 받지 못했다"로만 보여 서버를 의심하게 된다.
                    cut = ("답이 출력 한도(max_tokens)에 닿아 중간에 잘려 판정을 읽지 못함"
                           if resp is not None and getattr(resp, "truncated", False) else None)
                    return ([], "unanswered",
                            (resp.error if resp else None) or cut or why, [], 0, 0)

                out = []
                for row in obj["results"]:
                    if not isinstance(row, dict):
                        continue
                    if not self._accept_row(row, chunk.text, doc):
                        if row.get("verdict") == "위반":
                            dropped_outright += 1
                        continue
                    raw_no = str(row.get("no", "")).strip()
                    # 모델 표기를 진짜 기준 번호로 되돌린다(_no_aliases).
                    # 못 되돌리면 아래 판정 합치기에서 버려진다.
                    no = aliases.get(raw_no) or aliases.get(
                        _flatten_no(raw_no), raw_no)
                    verdict = str(row.get("verdict", "")).strip()
                    if verdict in ("통과", "해당없음"):
                        out.append((no, verdict, None))
                        continue
                    if verdict != "위반":
                        continue        # 어휘 밖 판정은 안 본 것으로 둔다
                    raw_issue = row.get("issue")
                    message = raw_issue.strip() if isinstance(raw_issue, str) else ""
                    if not message:
                        continue
                    kind = row.get("kind")
                    kind = kind.strip() if isinstance(kind, str) else ""
                    quotes = row.get("quotes")
                    quotes = ([q for q in quotes if isinstance(q, str)]
                              if isinstance(quotes, list) else [])
                    found, _missing = verify_quotes(doc, quotes)
                    if not found:
                        # 근거가 하나도 원문 대조를 통과하지 못했다. 지어낸 지적일
                        # 수도, 내용은 맞는데 인용만 고쳐 쓴 것일 수도 있다 — 즉시
                        # 버리지 않고 구조 라운드(rescue_round)에 넘긴다. 거기서도
                        # 실재 근거를 못 대면 그때 버린다. 판정은 남기지 않는다:
                        # 근거 없는 위반을 "통과"로 뒤집으면 검사한 척이 되고,
                        # "위반"으로 올리면 환각이 리포트에 오른다.
                        #
                        # 다만 구조는 **고쳐 쓴 인용**을 되살리는 것이다. 애초에
                        # 실질적 근거를 하나도 대지 않은 지적(quotes 없음 ·
                        # _MIN_QUOTE 미만 · 문장부호뿐)은 여기서 그대로 버린다 —
                        # 그 조각을 검색 키로 쓰면 짧아서 거부된 조각이 오히려
                        # 실문장을 찾아주는 열쇠가 된다(문턱 역전).
                        if any(_is_substantive(_norm(q)) for q in quotes):
                            rescues.append(RescueCandidate(
                                no=no, message=message,
                                kind=kind, quotes=quotes,
                                anchor=chunk.anchor))
                        else:
                            dropped_outright += 1
                        continue
                    prose = [e for e in found if _is_prose(e.quote)]
                    if not prose:
                        # 근거가 전부 잔해다. 지적을 내면 검토자가 문서에서 그
                        # 자리를 찾아보고 "이런 문장 없는데" 하게 된다 —
                        # 조용히 버리지 않고 아래에서 INFO 로 무엇을 뺐는지 밝힌다.
                        where = found[0].anchor if found else chunk.anchor
                        dropped_artifact.append({
                            "why": "잔해", "message": message, "no": no,
                            "page": where.page, "title": titles.get(where.section or "", ""),
                            "quote": found[0].quote if found else ""})
                        continue
                    found = prose
                    if _evidence_refutes_swap(message, [e.quote for e in found]):
                        # 근거는 실재하는데 그 근거가 주장을 반박한다(함수 주석).
                        # 잔해와 같은 통에 센다 — 둘 다 "근거가 주장을 못 받친다".
                        where = found[0].anchor
                        dropped_artifact.append({
                            "why": "반박", "message": message, "no": no,
                            "page": where.page, "title": titles.get(where.section or "", ""),
                            "quote": found[0].quote})
                        continue
                    soft = _spelling_from_image_only(kind, found)
                    out.append((no, "위반", Finding(
                        checker=self.name,
                        severity=(Severity.INFO if soft
                                  else _KIND_SEVERITY.get(kind, _KIND_DEFAULT)),
                        message=message + _FROM_IMAGE if soft else message,
                        unreviewed=soft,
                        # **근거가 있는 자리를 가리킨다.** 예전에는 모델이 보던
                        # 조각의 위치(chunk.anchor)를 달았는데, verify_quotes 는
                        # 문서 전체를 뒤지므로 근거가 다른 절에서 나올 수 있다.
                        # 그러면 지적을 눌러도 인용이 없는 절로 간다 — 실측:
                        # "'운영 파일'과 '운영파일'이 다르다" 지적이 §10.3 을
                        # 가리키는데 두 인용은 §10.1·§10.2 에 있었다. 검토자가
                        # 문제를 눈으로 확인할 수 없다.
                        #
                        # models.py 의 Finding.evidence 주석이 정한 계약이기도
                        # 하다 — "anchor 에는 첫 근거의 위치를 넣는다".
                        anchor=found[0].anchor if found else chunk.anchor,
                        evidence=found,
                        rule_id=no,
                        # 등급만 뽑고 버리던 값이다. 화면이 "표현 점검" 한 가지로
                        # 뭉뚱그려 보여주던 것을 이걸로 가른다. 어휘 밖이면 빈 값 —
                        # 지어낸 말을 뱃지에 그대로 내보내지 않는다.
                        kind=kind if kind in _KINDS else "",
                    )))
                return (out, ("dropped" if rescues else None), None, rescues,
                        dropped_outright, dropped_artifact)
            finally:
                report()

        if workers == 1:
            results = [one(j) for j in jobs]
        else:
            # map 은 입력 순서대로 결과를 낸다 — 지적 순서가 실행마다 흔들리면
            # 리포트의 번호가 달라지고 형광펜 짝도 어긋난다.
            with ThreadPoolExecutor(max_workers=workers,
                                    thread_name_prefix="consistency") as pool:
                results = list(pool.map(one, jobs))

        # 한 번이라도 위반이 나온 기준은 위반이다. 청크마다 판정이 나오므로
        # 마지막 값으로 덮으면 앞선 위반이 지워진다.
        findings: list[Finding] = []
        for rows, _kind, _why, _cs, _do, _da in results:
            for no, verdict, finding in rows:
                if no not in self.verdicts:
                    continue          # 모델이 지어낸 번호는 버린다
                if verdict == "위반":
                    self.verdicts[no] = "위반"
                    if finding is not None:
                        findings.append(finding)
                elif verdict == "통과":
                    # 한 조각이라도 실제로 봤으면 통과다 — 해당없음보다 세다.
                    if self.verdicts[no] in ("미판정", "해당없음"):
                        self.verdicts[no] = "통과"
                elif verdict == "해당없음" and self.verdicts[no] == "미판정":
                    # 조각 **전부**가 해당없음일 때만 남는다. 통과로 뒤집으면
                    # "이 기준으로 봤고 문제 없다"는 거짓말이 된다 — 안 본 것이다.
                    self.verdicts[no] = "해당없음"

        # 기준별로 몇 번 물어 몇 번 판정을 못 돌려받았나. 문서 전체·장절 검사는 기준
        # 하나에 호출 하나라, 그 호출이 실패하면 **그 기준만** 못 본 것이다 — 검사기
        # 전체 실패율로는 어느 기준이 왜 비었는지 말할 수 없다.
        self.failures = {}
        # 응답을 못 받은 검사 단위(조각). 어느 구간을 못 봤는지 보고에 싣는다 —
        # 계보(agent_history)가 그 절의 지난 지적만 "판단 못 함"으로 둔다.
        failed_units = []
        for (_unit, batch), (_r, kind, why_, _cs, _do, _da) in zip(jobs, results):
            if kind == "unanswered":
                failed_units.append(_unit)
            for c in batch:
                failed, asked, reason = self.failures.get(str(c.no), (0, 0, None))
                missed = kind == "unanswered"
                self.failures[str(c.no)] = (failed + missed, asked + 1,
                                            reason or (why_ if missed else None))
        unanswered = sum(1 for _r, kind, _w, _cs, _do, _da in results
                         if kind == "unanswered")
        self.unanswered = unanswered
        # 첫 실패 이유. 전부 같은 이유일 때가 많아 하나만 실어도 충분하다.
        why = next((w for _r, kind, w, _cs, _do, _da in results
                    if kind == "unanswered" and w), None)

        # 대조 실패 후보 전량. 즉시 버리지 않고 구조를 시도한다 — 실측으로 검토당
        # 5~7건이 여기서 죽었고, 그중 일부는 지적은 맞는데 인용만 고쳐 쓴 것이었다.
        cands = [c for _r, _k, _w, cs, _do, _da in results for c in cs]
        # 실질적 인용이 애초에 하나도 없었던 후보(구조 대기열에 들어가지도 못함).
        dropped_outright = sum(do for _r, _k, _w, _cs, do, _da in results)
        # 근거가 전부 추출 잔해였던 후보(표 칸 뭉치·목차 점선·번호 나열).
        # 무응답 경로는 이 자리를 0 으로 돌려준다 — 목록이 아니면 빈 것으로 본다.
        artifacts = [a for _r, _k, _w, _cs, _do, da in results
                     for a in (da if isinstance(da, list) else [])]
        dropped_artifact = len(artifacts)
        # 기본값 0(꺼짐): Task 4 가 Context 에 rescue_max 필드를 추가하기 전까지는
        # 이 속성을 아무도 설정하지 않은 호출부(기존 테스트 포함)가 옛 동작
        # 그대로 유지돼야 한다 — 기본을 켜두면 설정 안 한 모든 곳의 동작이
        # 조용히 바뀐다(그 자체가 1차 경로를 건드리는 것이다).
        rescue_max = max(0, int(getattr(ctx, "rescue_max", 0) or 0))
        revived = 0
        errored = 0
        # 1차가 전부 무응답이면 살릴 후보도 없고, LLM 이 죽어 있다 — 건너뛴다.
        if cands and rescue_max and self.unanswered < total:
            outcomes = rescue_round(
                cands, doc, ctx.llm, max_rescues=rescue_max,
                workers=max(1, int(getattr(ctx, "llm_concurrency", 1) or 1)),
                on_progress=ctx.on_progress, label=self.label)
            for cand, outcome in zip(cands, outcomes):
                if outcome.errored:
                    # 근거를 못 댄 것과 다르다 — LLM 이 응답을 안 준 것이다.
                    # "0건 통과"와 "검토를 못 했다"를 섞지 않는다(루트 CLAUDE.md).
                    errored += 1
                    continue
                found = outcome.evidence
                if not found or cand.no not in self.verdicts:
                    # 1차와 같은 규칙 — 실재하는 근거를 다시 댔더라도, 지어낸
                    # 기준 번호로는 지적을 올리지 않는다. 부활로도 세지 않는다
                    # (자연히 아래 "제외" 집계로 흐른다).
                    continue
                revived += 1
                self.verdicts[cand.no] = "위반"
                soft = _spelling_from_image_only(cand.kind, found)
                findings.append(Finding(
                    checker=self.name,
                    severity=(Severity.INFO if soft
                              else _KIND_SEVERITY.get(cand.kind, _KIND_DEFAULT)),
                    message=cand.message + _FROM_IMAGE if soft else cand.message,
                    unreviewed=soft,
                    anchor=found[0].anchor,      # 검증 통과한 실제 근거의 위치
                    evidence=found,
                    rule_id=cand.no,
                    kind=cand.kind if cand.kind in _KINDS else "",
                    # 재질의 끝에 근거를 찾은 지적임을 남긴다 — 화면 뱃지와
                    # 실측(복원 지적만 골라 검수)이 이 표시를 읽는다.
                    rescued=True,
                    # 재확인 여정 — 처음 인용(실패)과 모델이 쓴 검색어. 확정
                    # 근거는 evidence 가 이미 담는다. 화면이 "어떻게 다시
                    # 찾았나"를 보여줄 수 있어야 에이전트가 일한 과정이
                    # 결과에서 사라지지 않는다.
                    rescue_trace={"failed_quotes": list(cand.quotes),
                                  "searched": list(outcome.searched)},
                ))
        else:
            # 구조 라운드를 건너뛴 경우(후보 없음 · 상한 0 · 전부 무응답) INFO
            # 문구가 "재확인했습니다"라 말하지 않도록 옛 문구로 떨어뜨린다.
            rescue_max = 0
        attempted = min(len(cands), rescue_max) if rescue_max else 0
        skipped = len(cands) - attempted
        dropped = len(cands) - revived

        if unanswered:
            everything = unanswered == total
            reason = f" ({why})" if why else ""
            suggestion = ("LLM 이 연결돼 있는지 확인하세요(설정의 provider·base_url). "
                          "연결 없이 쓰려면 규칙 검사 결과만 유효합니다.")
            # 못 본 구간(절)들. 조각은 절 단위라(doc_parser chunker) 조각의 anchor 가 곧
            # 그 절이다. 절을 모르는 단위(문서 전체 한 덩이)는 빈 칸으로 남는다.
            failed_secs = list(dict.fromkeys(
                u.anchor.section for u in failed_units
                if getattr(u, "anchor", None) is not None and u.anchor.section))
            if everything or not failed_secs:
                findings.append(Finding(
                    checker=self.name,
                    severity=Severity.INFO,
                    # 단위는 "청크"가 아니라 호출이다 — 청크 하나를 기준 묶음 수만큼
                    # 묻기 때문에 둘이 다르다(청크 3 × 묶음 2 = 6회).
                    message=(
                        f"{self.label}이 수행되지 않았습니다 — {total}회 호출 전부에서 LLM "
                        f"응답을 받지 못했습니다{reason}. 기준에 비춘 검사가 하나도 "
                        f"수행되지 않았습니다(지적 0건은 '문제 없음'이 아닙니다)."
                        if everything else
                        f"{self.label}에서 {unanswered}/{total}회 호출이 LLM 응답을 받지 "
                        f"못해 검토되지 않았습니다{reason}."),
                    anchor=Anchor(page=None, section=None),
                    suggestion=suggestion,
                    unreviewed=True,
                ))
            else:
                # 부분 실패는 **구간마다** 한 장. 한 장으로 뭉치면 어느 절을 못 봤는지
                # 사라져, 계보가 이 검사기의 지난 지적을 전부 "판단 못 함"으로 가렸다
                # (실측: 1/35 실패에 12건). 절이 붙어 있으면 그 절만 가린다.
                for u in failed_units:
                    if not (getattr(u, "anchor", None) is not None and u.anchor.section):
                        continue
                    if u.anchor.section not in failed_secs:
                        continue
                    failed_secs.remove(u.anchor.section)   # 같은 절은 한 장만
                    findings.append(Finding(
                        checker=self.name,
                        severity=Severity.INFO,
                        message=(f"{self.label}에서 §{u.anchor.section} 구간 호출이 LLM 응답을 "
                                 f"받지 못해 이 구간은 검토되지 않았습니다{reason} "
                                 f"(전체 {unanswered}/{total}회)."),
                        anchor=u.anchor,
                        suggestion=suggestion,
                        unreviewed=True,
                    ))

        if dropped or revived:
            if not rescue_max:
                message = (f"{self.label}에서 지적 후보 {dropped}건이 원문 대조를 "
                           f"통과하지 못해 제외되었습니다 (인용한 문장을 문서에서 "
                           f"찾지 못함).")
            else:
                parts = [(f"{self.label}에서 지적 후보 {len(cands)}건이 원문 대조에 "
                          f"실패해 재확인했습니다")]
                detail = []
                if revived:
                    detail.append(f"{revived}건은 실재 근거를 찾아 복원")
                if errored:
                    # LLM 오류는 "근거를 대지 못함"과 다르다 — 검토를 못 한 것이다.
                    detail.append(f"{errored}건은 재확인 중 LLM 응답을 받지 못해 제외")
                no_evidence = dropped - skipped - errored
                if no_evidence:
                    detail.append(f"{no_evidence}건은 근거를 대지 못해 제외")
                if skipped:
                    detail.append(f"{skipped}건은 재확인 상한({rescue_max}건)에 "
                                  f"걸려 시도하지 못하고 제외")
                message = f"{parts[0]} — {', '.join(detail)}되었습니다."
            findings.append(Finding(
                checker=self.name,
                severity=Severity.INFO,
                message=message,
                anchor=Anchor(page=None, section=None),
                suggestion="제외된 지적은 모델이 실재 근거를 대지 못한 것입니다. "
                           "필요하면 해당 절을 직접 확인하세요.",
            ))

        if dropped_outright:
            # "재확인" 대상이 아니었던 건수다 — 위 절(재확인 결과)과 섞으면
            # 재확인이 실패한 것처럼 보인다. 별도 절로 정직하게 드러낸다.
            findings.append(Finding(
                checker=self.name,
                severity=Severity.INFO,
                message=(f"{self.label}에서 지적 후보 {dropped_outright}건은 실질적 "
                         f"인용이 없어 재확인 없이 제외되었습니다(인용 없음 또는 "
                         f"너무 짧음)."),
                anchor=Anchor(page=None, section=None),
                suggestion="제외된 지적은 원문 인용 없이 나온 것입니다. "
                           "필요하면 해당 절을 직접 확인하세요.",
            ))
        if dropped_artifact:
            # **조용히 지우면 "지적이 없다"는 거짓말이 된다**(CLAUDE.md).
            # 위 절(인용 없음)과 갈라 둔다 — 저쪽은 모델이 근거를 안 댄 것이고
            # 이쪽은 근거를 댔는데 그 근거가 우리 추출 잔해인 것이다. 뭉치면
            # 검토자가 "모델이 헛소리했다"로 읽는다.
            # 무엇을 뺐는지 한 줄씩. 절·지적·인용이 있어야 검토자가 그 절을 펴 볼 수 있다.
            # 한도(10줄)를 넘으면 나머지는 건수로만 — 카드가 벽이 되지 않게.
            def _line(a: dict) -> str:
                # 자리는 쪽 번호와 절 제목으로 — 둘 다 문서에 실제로 있는 것이다.
                place = " ".join(x for x in (
                    f"{a['page']}쪽" if a.get("page") else "",
                    f"'{a['title'][:30]}'" if a.get("title") else "") if x)
                why = "근거가 지적을 반박" if a.get("why") == "반박" else "근거가 추출 잔해"
                quote = (a.get("quote") or "").strip()
                if len(quote) > 60:
                    quote = quote[:60] + "…"
                return f"{place + ' · ' if place else ''}{a['message']} ({why}: “{quote}”)"
            lines = [_line(a) for a in artifacts[:10]]
            if len(artifacts) > 10:
                lines.append(f"… 외 {len(artifacts) - 10}건")
            findings.append(Finding(
                checker=self.name,
                severity=Severity.INFO,
                message=(f"{self.label}에서 지적 {dropped_artifact}건은 근거가 주장을 "
                         f"받치지 못해 제외되었습니다 — 추출 잔해(표 칸 뭉치·목차 "
                         f"점선·번호 나열)이거나, 뒤바뀜 주장인데 든 근거가 전부 "
                         f"같은 짝인 경우입니다.\n" + "\n".join(lines)),
                anchor=Anchor(page=None, section=None),
                suggestion="잔해는 문서가 아니라 파서가 깨뜨린 자리입니다 — 그 절의 표를 "
                           "직접 확인하세요. 지적 자체가 맞다고 보이면 그 절을 검토 "
                           "의견에 직접 적으세요.",
            ))
        return findings + list(notices)


class WholeDocCriteriaChecker(ChunkCriteriaChecker):
    """문서를 **통째로** 한 프롬프트에 넣고 기준마다 묻는다.

    조각으로 자르면 멀리 떨어진 두 곳을 못 맞댄다 — 3쪽 표 제목과 40쪽 본문 참조,
    앞쪽 약어 목록과 뒤쪽 사용처, 개정기록 표와 본문 개정바 위치. 각 조각만 보는
    모델은 둘이 다른 조각에 들어가면 영원히 못 맞춘다.

    실측(2026-07-30, 사내 vLLM Qwen3.6-27B): 기준 1개 × 문서 통째가 4/4 로 가장
    정확했다(기준 7개를 한 프롬프트에 몰아 준 조각 방식은 3/4 — 하나를 3회 모두
    조용히 놓쳤다).

    문서가 창을 넘으면 조각으로 내려가되 **그 사실을 밝힌다.** 전체를 봐야 하는
    기준을 조각으로 훑고 "이상 없음"이라 하면 거짓말이 된다.
    """
    name = "consistency_doc"
    label = "문서 전체 점검"

    def __init__(self, criteria: Sequence = (), max_chars: int = 120_000):
        super().__init__(criteria)
        # 창 크기는 서버 설정(vLLM max_model_len)이 정한다 — 모델 고유 상수가
        # 아니라 배포 설정이라, 코드에 박지 않고 주입받는다(Config.llm_doc_max_chars).
        self.max_chars = max_chars

    def _batches(self) -> list[list]:
        """전체 기준은 하나씩 물어 진행률과 판정 누락을 기준별로 가른다.

        일반 표현 점검은 청크가 많아 기준을 최대 4개씩 묶지만, 전체 점검은 문서가
        한 단위라 같은 방식을 쓰면 공통+팀 기준 3개가 호출 한 번에 합쳐져 진행바가
        0%에서 100%로만 뛴다. 기준별 호출은 현재 최대 3개이고 병렬 실행되므로
        지연을 거의 늘리지 않으면서 실제 완료 기준 수(1/3, 2/3, 3/3)를 보여준다.
        기준 하나 × 문서 전체가 가장 정확했던 실측과도 맞는다.
        """
        return [[criterion] for criterion in self.criteria]

    def plan(self, doc: Document, ctx: Context) -> dict | None:
        """작업량은 **실제 호출 수**다. 청크 수로 신고하면 문서가 창에 들어갈 때
        1회만 부르고도 진행바가 절반에서 멈춘다."""
        if not self.criteria:
            return None
        units, _ = self._units(doc, ctx)
        text = "\n".join(s.text or "" for s in doc.iter_sections()) if doc else ""
        whole = bool(text.strip()) and len(text) <= self.max_chars
        return {"kind": "chunk", "total": len(units) * len(self._batches()),
                "label": self.label,
                "description": "용어·참조·수치·동일 ID의 문서 내 일관성",
                "scope": "문서 전체 입력" if whole else "분할 검사 · 전체 비교 제한",
                "limited": not whole}

    def _units(self, doc: Document, ctx: Context) -> tuple[list, list[Finding]]:
        text = "\n".join(s.text or "" for s in doc.iter_sections()) if doc else ""
        if not text.strip():
            return [], []
        if len(text) <= self.max_chars:
            first = next(doc.iter_sections(), None)
            anchor = first.anchor if first is not None else Anchor(page=None, section=None)
            return [_Unit(text=text, anchor=anchor)], []

        # 창을 넘었다. 조각으로 내려가고 알린다 — 이 기준들은 부분만 본 것이다.
        return list(ctx.chunks), [Finding(
            checker=self.name,
            severity=Severity.INFO,
            message=(f"문서가 커서({len(text):,}자, 한도 {self.max_chars:,}자) 문서 전체를 "
                     f"한 번에 보지 못하고 조각으로 나눠 검사했습니다. 멀리 떨어진 두 곳을 "
                     f"맞대야 하는 기준(표·그림 참조, 약어 목록과 사용처 등)은 "
                     f"부분만 본 결과입니다."),
            anchor=Anchor(page=None, section=None),
            suggestion=("설정의 llm_doc_max_chars 를 올리거나(서버 창이 허용하는 만큼), "
                        "해당 기준은 직접 확인하세요."),
            unreviewed=True,
        )]

    def check(self, doc: Document, ctx: Context) -> list[Finding]:
        findings = super().check(doc, ctx)
        # 부분만 봤으면 '통과'를 확정하지 않는다 — 못 본 곳에 위반이 있을 수 있다.
        if any(f.unreviewed and "문서가 커서" in f.message for f in findings):
            self.verdicts = {no: ("미판정" if v == "통과" else v)
                             for no, v in self.verdicts.items()}
        return findings


# 공개 이름을 바꿔도 기존 모듈 사용자와 저장된 확장 코드가 한 번에 깨지지 않게
# 구 이름을 호환 별칭으로 남긴다. 새 코드는 위의 직관적인 이름을 사용한다.
ConsistencyChecker = ChunkCriteriaChecker
WholeDocChecker = WholeDocCriteriaChecker
