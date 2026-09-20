"""원본 PDF에 지적을 형광펜으로 표시한다.

에너지인프라실이 PDF를 주로 쓴다. hwpx는 브라우저로도 렌더가 안 되고 원본에
표시할 방법도 사실상 없지만(OWPML을 손으로 짜야 한다), PDF는 좌표만 알면
표준 주석으로 얹을 수 있다.

좌표는 pdfplumber가 준다. 예전에는 "검토 엔진에는 좌표가 필요 없다(줄 단위로
대조한다)"며 web extra에만 두고 여기서 지연 임포트했다. 그 전제가 바뀌었다 —
엔진이 표 bbox로 쪽을 밴드로 나누고 글자 좌표로 도면 라벨을 묶는다. pdfplumber는
이제 core라 평범하게 임포트한다.

**공백을 통째로 지우고 대조한다.** 한글 PDF는 자간 때문에 한 낱말이 여러 word로
쪼개지는 일이 흔하다("예측 응답시간" → "예 측 응답시간"). 공백을 남긴 채 맞추면
원문에 분명히 있는 인용을 못 찾는다. verify_quotes는 공백을 한 칸으로 누르는
것으로 충분했지만(추출 텍스트끼리의 대조였다), 여기서는 pypdf가 뽑은 인용과
pdfplumber가 본 낱말을 맞춰야 해서 더 세게 눌러야 한다.

못 찾은 인용은 조용히 버리지 않는다. 표시되지 않은 지적을 돌려주고, 화면이
그것을 말한다 — 안 그러면 "PDF에 표시가 없다 = 문제가 없다"로 읽힌다.
"""
from __future__ import annotations

import copy
import io
import re
from dataclasses import dataclass, field

import pdfplumber
from pypdf import PdfReader, PdfWriter
from pypdf.annotations import Highlight, Text
from pypdf.generic import ArrayObject, FloatObject, NameObject, TextStringObject

from modules.shared import decode_pdf_symbols

from .pdf_summary import FontMissing, find_font, number_overlay, summary_pdf

LOCATION_VERSION = "context-unique-v4-candidate-rects"


def _source_words(page) -> list[dict]:
    words = page.extract_words(use_text_flow=True, extra_attrs=["fontname"])
    for word in words:
        word["text"] = decode_pdf_symbols(word["text"], word.get("fontname", ""))
    return words


def with_location_context(findings: list[dict], sections: list[dict],
                          page_basis: str = "unknown") -> list[dict]:
    """소속 절의 유일한 원문 출현에서 앞뒤 문맥을 보존한다. 인용 자체는 바꾸지 않는다."""
    out = copy.deepcopy(findings)
    by_id = {str(s.get("id")): s for s in sections if isinstance(s, dict)}
    for finding in out:
        for evidence in finding.get("evidence") or []:
            evidence.setdefault("page_basis", page_basis)
            if evidence.get("source") or evidence.get("image_no") or evidence.get("context"):
                continue
            section = by_id.get(str(evidence.get("section") or finding.get("section")))
            if not section:
                continue
            text, quote = _squash(section.get("text") or ""), _squash(evidence.get("quote") or "")
            if not quote or text.count(quote) != 1:
                continue  # 소속 절에서도 여러 번이면 출현 순서로 추측하지 않는다.
            at = text.index(quote)
            evidence["context"] = {"before": text[max(0, at - 60):at],
                                   "after": text[at + len(quote):at + len(quote) + 60],
                                   "section_title": section.get("title") or ""}
    return out


def _unique_hit(evidence: dict, finding: dict, page_count: int, page_data):
    """원문/문맥에 맞는 출현이 하나일 때만 반환. 근사 쪽수·지적 순서는 증거가 아니다.

    (hit, reason, near). 못 짚었을 때 near 는 **그 인용이 실제로 있는 출현들**(hit 과
    같은 꼴)이다 — 형광펜은 못 얹어도 화면이 후보 자리를 점선으로 보여 주고 ‹ › 로
    옮겨 다니게 한다(2026-09-15: 카드를 눌러도 아무 데도 안 갔다). 없으면 빈 목록.
    """
    if evidence.get("source"):
        return None, "본문 밖 근거입니다.", []
    quote = evidence.get("quote") or ""
    context = evidence.get("context") or {}
    before = _squash(context.get("before") or "")
    after = _squash(context.get("after") or "")
    pages = list(range(page_count))
    # PDF에서 추출했더라도 절 시작 쪽은 근거의 실제 쪽을 보증하지 않는다.
    if evidence.get("page_basis") == "pdf" and evidence.get("page_exact") is True:
        page = evidence.get("page") or finding.get("page")
        if isinstance(page, int) and 1 <= page <= page_count:
            pages = [page - 1]
    # 전체 인용을 먼저 문서 전체에서 찾는다. 값만의 폴백이 앞 페이지를 가로채지 않게 한다.
    for candidate in (quote, _label_stripped(quote)):
        needle = _squash(candidate)
        if not needle:
            continue
        hits = []
        exact_hits = []
        occurrences = 0
        for pno in pages:
            words, (text, owner), height = page_data(pno)
            at = text.find(needle)
            while at >= 0:
                occurrences += 1
                hit = (pno, words[owner[at]:owner[at + len(needle) - 1] + 1], height)
                exact_hits.append(hit)
                if ((not before or text[:at].endswith(before))
                        and (not after or text[at + len(needle):].startswith(after))):
                    hits.append(hit)
                at = text.find(needle, at + 1)
        # Context is a disambiguator, not a requirement for a globally unique
        # full quote: parsed context can cross a page or reorder table cells.
        # Never apply this shortcut to the shortened label/value fallback.
        if candidate == quote and len(exact_hits) == 1:
            return exact_hits[0], "", []
        if len(hits) == 1:
            return hits[0], "", []
        # 공백을 지우고 비교하므로(_squash) 띄어쓰기만 다른 자리가 전부 같은 글로
        # 잡힌다 — 실측(2026-09-15): "Library 를구현하여"(문서에 1곳)가 "Library 를
        # 구현하여" 20곳과 함께 후보가 되어 정작 지적한 자리를 못 짚었다. 여럿이면
        # **낱말 경계까지 같은** 자리만 남긴다. 그래도 하나가 아니면 아래로 내려간다.
        if candidate == quote and len(exact_hits) > 1:
            spaced = " ".join(quote.split())
            same = [h for h in exact_hits if " ".join(w["text"] for w in h[1]) == spaced]
            if len(same) == 1:
                return same[0], "", []
            if same:                       # 여럿이어도 띄어쓰기까지 같은 자리만 후보다
                exact_hits = same
                hits = [h for h in hits if h in same] or hits
        if occurrences:
            reason = ("같은 인용이 여러 위치에 있어 원문 위치를 확정하지 못했습니다."
                      if len(hits) > 1
                      else "인용은 있지만 소속 문맥과 일치하는 위치를 확인하지 못했습니다.")
            return None, reason, (hits if len(hits) > 1 else exact_hits)
    return None, "이 인용을 PDF 본문에서 찾지 못했습니다.", []

# 심각도 → 형광펜 색. 화면의 SEV 팔레트와 같은 계열이다.
# major 와 minor 는 **같은 노랑** — 화면이 둘을 "지적" 하나로 보여 주는데(2026-09-14 결정)
# 표시본만 주황·노랑으로 갈리면 "둘의 차이가 뭐냐"가 된다. info 는 화면과 같은 슬레이트.
_COLOR = {
    "major": "ffd43b",
    "minor": "ffd43b",
    "info": "adb5bd",
}


@dataclass
class Marked:
    pdf: bytes
    marked: int = 0
    # 표시하지 못한 지적. [{id, message, reason}]
    unmarked: list[dict] = field(default_factory=list)
    # 요약 페이지를 넣었나. 한글 폰트가 없으면 못 넣는다 — 조용히 빠지면
    # 사용자는 그런 페이지가 있다는 것도 모른다.
    summary: bool = False
    # 표시본 앞에 삽입된 요약 페이지 수. 화면이 지적 page로 점프할 때 이만큼 민다.
    summary_pages: int = 0
    # 지적 id → 지면에 찍힌 번호("1", "1, 2"). 화면이 카드에 같은 번호를 달아
    # "3번 지적"이 표시본과 화면에서 같은 것을 가리키게 한다. 번호는 형광펜에
    # 매달리므로 근거가 없거나 본문에서 못 찾은 지적은 여기 없다.
    numbers: dict[str, str] = field(default_factory=dict)
    note: str = ""


_PUA = re.compile(r"[\ue000-\uf8ff]")


def _squash(text: str) -> str:
    """공백을 전부 지운다. 자간으로 쪼개진 낱말까지 맞추려면 이 수준이어야 한다.

    파이프(|)도 지운다 — 파서가 표 행을 `| 셀 | 셀 |` 로 직렬화해서 표에서 나온
    인용에는 |가 섞이는데, PDF 텍스트 레이어에는 그 글자가 없다. 안 지우면 표
    인용은 전부 unlocated 로 떨어져 "이 인용이 문서 어디인지" 를 영영 못 짚는다
    (실측: `| LIST OF TABLES |`). 색인(_page_index)과 바늘이 같은 함수를 쓰므로
    지우는 쪽도 짝이 맞는다.
    """
    squashed = "".join(str(text or "").split()).replace("|", "")
    # 글머리 기호도 지운다. LibreOffice 가 hwpx 를 PDF 로 바꿀 때 글머리 목록 항목마다
    # Symbol 글꼴의 사각점(U+F06C, Private Use Area)을 텍스트 레이어에 찍는데, 파서가
    # 낸 인용에는 그 글자가 없다 — 실측(PRJX-DS-014 §3.1.1.2): 셀 안에 항목이 셋인
    # 표 행 4건이 전부 그 글자에서 어긋나 번호를 못 받았다. PUA 는 실제 글자가
    # 아니라 글꼴 전용 기호 자리라 지워도 잃는 것이 없다.
    return _PUA.sub("", squashed)


def _page_index(words: list[dict]) -> tuple[str, list[int]]:
    """페이지의 모든 낱말을 공백 없는 한 줄로 잇고, 글자마다 어느 낱말인지 남긴다."""
    chars: list[str] = []
    owner: list[int] = []
    for i, w in enumerate(words):
        for ch in _squash(w.get("text", "")):
            chars.append(ch)
            owner.append(i)
    return "".join(chars), owner


#: 같은 줄로 볼 top 차이(pt). `int(round(top))` 으로 자르면 한 행이 갈린다 —
#: 한글과 영문의 baseline 이 한 행 안에서 1pt 안팎 흔들리기 때문이다. 실측
#: (2026-08-31, PRJX-DS-014 42쪽 표 한 행): top 이 97.5 · 98.4 · 99.0 으로 나와
#: 98/99 두 줄로 갈렸고, `API` 한 낱말만 상자가 따로 생겨 행 바 위에 겹쳤다.
_LINE_TOL = 2.5

#: 낱말 사이가 글자 높이의 이 배수보다 벌어지면 **다른 칸**으로 본다.
#:
#: 표 인용은 한 행의 여러 칸을 잇는다(`| 제목 | … | ID | … |`). 줄의 좌우 끝을
#: 이어 상자 하나로 만들면 **글자가 없는 칸 경계까지 덮어** 행 전체를 가로지르는
#: 바가 된다. 실측(같은 행): 낱말 사이는 2.0~2.2pt 인데 칸 사이는 47~69pt 다.
#: 정렬을 위해 벌어지는 낱말 간격도 1em 을 넘지 않으므로 산문은 안 쪼갠다.
_CELL_GAP_EM = 1.5


def _runs(words: list[dict]) -> list[list[dict]]:
    """낱말들 → 화면에서 **이어 보이는 덩어리**마다 하나씩.

    줄로 묶고(_LINE_TOL), 줄 안에서 가로로 크게 벌어진 자리를 끊는다(_CELL_GAP_EM).
    형광펜은 글자 위에만 얹혀야 한다 — 빈 칸을 덮으면 무엇을 짚은 것인지 안 보인다.
    """
    rows: list[list[dict]] = []
    for w in sorted(words, key=lambda w: (float(w["top"]), float(w["x0"]))):
        # 줄의 **첫 낱말**과 견준다. 직전 낱말과 견주면 조금씩 밀리는 top 이
        # 사슬처럼 이어져 다른 줄까지 한 줄로 삼킨다.
        if rows and abs(float(w["top"]) - float(rows[-1][0]["top"])) <= _LINE_TOL:
            rows[-1].append(w)
        else:
            rows.append([w])

    out: list[list[dict]] = []
    for row in rows:
        row.sort(key=lambda w: float(w["x0"]))
        em = max((float(w["bottom"]) - float(w["top"]) for w in row), default=0.0) or 1.0
        run = [row[0]]
        for prev, w in zip(row, row[1:]):
            if float(w["x0"]) - float(prev["x1"]) > em * _CELL_GAP_EM:
                out.append(run)
                run = [w]
            else:
                run.append(w)
        out.append(run)
    return out


def _run_rect(run: list[dict], page_height: float) -> tuple[float, float, float, float]:
    """덩어리 하나 → PDF 사용자 공간 사각형. pdfplumber 는 위에서, PDF 는 아래에서 잰다."""
    return (min(float(w["x0"]) for w in run),
            page_height - max(float(w["bottom"]) for w in run),
            max(float(w["x1"]) for w in run),
            page_height - min(float(w["top"]) for w in run))


def _quads(words: list[dict], page_height: float) -> tuple[list[float], list[float]]:
    """낱말들의 상자 → (quad_points, 전체 rect).

    이어 보이는 덩어리마다 사각형 하나다(_runs) — 두 줄에 걸친 인용도, 표 한 행을
    가로지르는 인용도 각 덩어리가 제 모양대로 칠해진다.
    """
    quads: list[float] = []
    rects = [_run_rect(r, page_height) for r in _runs(words)]
    for x0, y0, x1, y1 in rects:
        # quad 순서: 좌상, 우상, 좌하, 우하 (PDF 스펙)
        quads += [x0, y1, x1, y1, x0, y0, x1, y0]
    rect = [min(r[0] for r in rects), min(r[1] for r in rects),
            max(r[2] for r in rects), max(r[3] for r in rects)]
    return quads, rect


#: 라벨을 뗀 값만으로 다시 찾을 때 요구하는 최소 길이. 짧은 값(`1.0`)은 문서
#: 아무 데나 있어 엉뚱한 곳에 형광펜을 얹는다 — 그건 형광펜이 없는 것보다 나쁘다.
#: 근거 판정의 문턱(_MIN_QUOTE = 4)보다 높게 잡는다: 저기는 "지적을 살릴지"이고
#: 여기는 "어디에 표시할지"라, 잘못 짚는 대가가 더 크다.
_MIN_VALUE_RETRY = 6


def _label_stripped(quote: str) -> str:
    """`라벨 | 값` 에서 값만. 그 꼴이 아니거나 값이 너무 짧으면 "".

    칸 값 검사와 문서 간 대조는 인용을 `f"{라벨} | {값}"` 으로 만든다
    (agent_trace/field_match.py). **세로 표**(라벨 오른쪽이 값)에서는 PDF 에도 둘이
    나란히 있어 붙여서 찾힌다. 그런데 **가로 표**(라벨 행 / 값 행, 팀 기준의
    `at: below`)에서는 PDF 에서 라벨 다음에 오는 것이 옆 칸 라벨이라 `라벨+값`
    이라는 문자열이 문서에 존재하지 않는다.

    실측(을지, SST-K-TI-03-04): `at: below` 인 필드 4개(의뢰번호·성적서번호·
    시험기간·의뢰기관명)가 **전부** 위치를 못 찾았고, `at: right` 인 2개는 전부
    찾았다. 을지는 주요 필드가 거의 below 라 형광펜이 사실상 하나도 안 떴다.
    """
    if "|" not in quote:
        return ""
    value = quote.rsplit("|", 1)[-1].strip()
    if len(_squash(value)) < _MIN_VALUE_RETRY:
        return ""
    return value


def _find(quote: str, index: tuple[str, list[int]], words: list[dict],
          skip: int = 0) -> list[dict] | None:
    """인용문의 위치. 못 찾으면 라벨을 떼고 값만으로 한 번 더 본다.

    `skip` 은 이 페이지에서 앞의 몇 번 출현을 건너뛸지다. 같은 인용이 되풀이되는
    지적(실측 PRJX-DS-014 §3.1.4.2: `| 출처 | TBD |` 5회)은 근거를 그 수만큼 싣고,
    호출자가 같은 인용의 몇 번째인지 세어 넘긴다 — 안 그러면 첫 번째에만 형광펜이
    가고 나머지는 위치를 잃는다. 이 페이지에 그만큼 없으면 None 이라 호출자가 다음
    페이지로 넘어간다.

    순서가 중요하다 — 라벨까지 붙은 쪽을 **먼저** 찾는다. 그래야 같은 값이 여러 번
    나오는 문서에서 제 칸을 짚는다(`1.0` 이 날짜 `2026. 01. 02.` 보다 먼저 걸리는
    것을 막으려고 라벨을 붙였다). 재시도는 그 방어가 통하지 않는 가로 표에서만
    실제로 쓰인다.
    """
    haystack, owner = index
    for candidate in (quote, _label_stripped(quote)):
        needle = _squash(candidate)
        if not needle:
            continue
        at = -1
        for _ in range(skip + 1):
            at = haystack.find(needle, at + 1)
            if at < 0:
                break
        if at < 0:
            continue
        first, last = owner[at], owner[at + len(needle) - 1]
        return words[first:last + 1]
    return None


def _section_key(section) -> tuple:
    """절 번호를 정렬 가능한 튜플로. "3.1.3.1" → (3,1,3,1). 없으면 맨 뒤."""
    if not section:
        return (10**6,)
    parts = []
    for tok in str(section).split("."):
        tok = tok.strip()
        if not tok.isdigit():
            break
        parts.append(int(tok))
    return tuple(parts) if parts else (10**6,)


def _count(quote: str, index: tuple[str, list[int]]) -> int:
    """이 페이지에 인용이 몇 번 나오는가(라벨 뗀 것은 안 센다 — 되풀이 판정에만 쓴다)."""
    needle = _squash(quote)
    if not needle:
        return 0
    haystack = index[0]
    n, at = 0, -1
    while True:
        at = haystack.find(needle, at + 1)
        if at < 0:
            return n
        n += 1


def _boxes(words: list[dict], page_height: float) -> list[tuple[float, float, float, float]]:
    """낱말들 → 이어 보이는 덩어리마다 사각형 하나. PDF 사용자 공간(왼쪽 아래 원점).

    화면 오버레이도 표시본 PDF(_quads)와 **같은 모양**이어야 한다 — 예전에는 두
    함수가 줄 묶기를 각자 복사해 갖고 있었다. 덩어리 나누기는 _runs 가 한다.
    """
    return [_run_rect(r, page_height) for r in _runs(words)]


# 원본 크기와 PDF 안 크기가 정확히 같지 않다. LibreOffice 가 리샘플하면서 한두 픽셀이
# 어긋난다 — 실측: 515→514, 388→387, 1410→1397(0~1%). 2% 면 그 흔들림을 담는다.
_SIZE_TOLERANCE = 0.02
# 균일 축소도 한다 — 실측: 1563x925 → 1438x851(배율 0.920/0.920),
# 2091x302 → 1772x256(0.848/0.848). 크기는 크게 달라지지만 **종횡비는 남는다.**
_RATIO_TOLERANCE = 0.01


#: 같은 크기가 이 쪽수 이상에 나오면 머릿말 로고·아이콘 같은 **되풀이 장식**으로 본다.
#: 실측(PRJX-DS-005): 로고 813×118 과 아이콘 셋이 44쪽 전부에 있었다. 진짜 그림이
#: 같은 크기로 세 쪽에 되풀이되는 일은 사실상 없다.
_FURNITURE_PAGES = 3


def _slot_pos(slot: dict) -> tuple[int, float]:
    """문서 순서로 정렬할 열쇠. rect 는 아래에서 재므로 위쪽일수록 y1 이 크다."""
    return (slot["page"], -slot["rect"][3])


def _slot_pos_of(hit: dict) -> tuple[int, float]:
    """`out` 에 담긴 확정 짝(page·rect)의 같은 열쇠."""
    return (hit["page"], -hit["rect"][3])


def match_images(pdf, images: list[dict]) -> dict[int, dict]:
    """{그림 번호: {"page": 1-based, "rect": [x0,y0,x1,y1]}}. 못 짝지으면 빼놓는다.

    문서의 그림 N 이 뷰어용 PDF 의 어느 이미지인지 알아야 형광펜을 얹을 수 있다.
    **순서만으로는 못 짝짓는다** — LibreOffice 가 도형을 이미지로 렌더해 개수가
    어긋나는 문서가 있다(실측: 파싱 6장 vs PDF 7장). 그 여분이 중간에 끼면 뒤쪽
    그림이 한 칸씩 밀린다.

    두 단계로 짝짓는다.

    1) **크기**(2% 안). 강한 신호다. 대부분 여기서 붙는다.
    2) 남은 것을 **종횡비**(1% 안)로. LibreOffice 가 균일 축소한 경우다 — 크기는
       8~15% 줄어도 비율은 남는다. 실측으로 이 단계가 3장을 더 붙였고, 그중 하나는
       눈으로 확인했다(같은 SURESOFT 로고가 30% 크기로 들어가 있었다).

    같은 값이 여럿이면 쪽·위 순서로 앞것부터 쓴다. 짝이 없으면 **빼놓는다** —
    엉뚱한 곳에 형광펜을 얹는 것보다 안 얹는 편이 낫다.
    """
    slots: list[dict] = []
    for pno, page in enumerate(pdf.pages, 1):
        height = float(page.height)
        for im in sorted(page.images, key=lambda i: (i.get("top") or 0)):
            size = im.get("srcsize")
            if not size or not (size[0] and size[1]):
                continue
            slots.append({
                "page": pno,
                # pdfplumber 의 top 은 위에서 재고, PDF 좌표는 아래에서 잰다.
                "rect": [float(im["x0"]), height - float(im["bottom"]),
                         float(im["x1"]), height - float(im["top"])],
                "w": int(size[0]), "h": int(size[1]), "used": False,
            })

    sized = [(int(m["no"]), int(m.get("width") or 0), int(m.get("height") or 0))
             for m in images]
    sized = [(no, w, h) for no, w, h in sized if w and h]
    out: dict[int, dict] = {}

    def take(no: int, slot: dict) -> None:
        slot["used"] = True
        out[no] = {"page": slot["page"], "rect": slot["rect"]}

    # 1단계 — 크기
    for no, w, h in sized:
        for slot in slots:
            if slot["used"]:
                continue
            if (abs(slot["w"] - w) / w <= _SIZE_TOLERANCE
                    and abs(slot["h"] - h) / h <= _SIZE_TOLERANCE):
                take(no, slot)
                break

    # 2단계 — 종횡비(균일 축소)
    for no, w, h in sized:
        if no in out:
            continue
        want = w / h
        for slot in slots:
            if slot["used"]:
                continue
            if abs(slot["w"] / slot["h"] - want) / want <= _RATIO_TOLERANCE:
                take(no, slot)
                break

    # 3단계 — **문서 순서. 단, 앞뒤로 확정된 짝 사이에 갇힌 것만.**
    #
    # 크기도 종횡비도 어긋나는 그림이 남는다 — LibreOffice 가 변환하며 잘라내기
    # 때문이다. 실측(2026-08-31, PRJX-DS-005 그림 18): 945×509 가 945×474 로
    # 나와 높이 6.9%·종횡비 7.4% 차이로 두 단계를 모두 통과 못 했다. 그 결과
    # 그림 18 에서 나온 지적은 번호도 "그 자리로 가기"도 없었다.
    #
    # **순서만으로는 여전히 못 붙인다**(위 주석 그대로 — 개수가 어긋나는 문서가
    # 있다). 그러나 1·2단계에서 붙은 짝들이 이미 문서 순서의 **말뚝**이다. 남은
    # 그림은 앞 말뚝보다 뒤, 뒤 말뚝보다 앞에 있을 수밖에 없으므로 그 구간만
    # 본다. 구간이 비어 있으면 그대로 빼놓는다 — 엉뚱한 곳에 얹지 않는다.
    #
    # 머릿말 로고·아이콘 같은 **되풀이 슬롯은 이 단계에서 뺀다.** 쪽마다 있어서
    # 어느 구간에나 걸리는데, 남은 그림 자리를 먼저 채워버린다(실측: 로고가 44쪽
    # 전부에 있다). 1·2단계는 그대로 전체를 본다 — 로고 자체가 문서의 그림 1 인
    # 문서가 있어서다.
    pages_of: dict[tuple[int, int], set] = {}
    for slot in slots:
        pages_of.setdefault((slot["w"], slot["h"]), set()).add(slot["page"])
    ordered = sorted((s for s in slots if len(pages_of[(s["w"], s["h"])]) < _FURNITURE_PAGES),
                     key=_slot_pos)

    nos = [no for no, _w, _h in sized]
    pinned = {no: _slot_pos_of(out[no]) for no in nos if no in out}
    for i, no in enumerate(nos):
        if no in out:
            continue
        lo = max((pinned[n] for n in nos[:i] if n in pinned), default=None)
        hi = min((pinned[n] for n in nos[i + 1:] if n in pinned), default=None)
        if lo is None and hi is None:
            # 말뚝이 하나도 없다 = 순서를 믿을 근거가 없다. 빼놓는다 — 이 단계는
            # 확정된 짝 사이를 메우는 것이지, 아무 슬롯이나 집는 것이 아니다.
            continue
        for slot in ordered:
            if slot["used"]:
                continue
            at = _slot_pos(slot)
            if (lo is None or at > lo) and (hi is None or at < hi):
                take(no, slot)
                pinned[no] = at
                break
    return out


def locate(pdf_bytes: bytes, findings: list[dict],
           images: list[dict] | None = None) -> dict:
    """인용문이 PDF 어디에 있는지 좌표로 돌려준다. PDF를 만들지 않는다.

    화면 뷰어가 지적 위치로 스크롤하고 형광펜을 얹는 데 쓴다. annotate가 좌표를
    알고도 PDF 안에만 남겨서, 화면은 체커가 주장한 쪽으로 점프했다 — 실측 39건 중
    5건이 그래서 엉뚱한 쪽으로 갔다. 여기서는 실제로 찾아낸 쪽·좌표를 밖으로 낸다.

    반환(모든 쪽 번호 1-based, rect 는 PDF 사용자 공간 줄 단위 상자):
      {pages, items:[{id, no, page, sev, marks:[{page, rect:[x0,y0,x1,y1]}]}], unlocated:[...]}

    images(번호·원본 크기)를 주면 **그림 설명에서 나온 근거**도 짚는다. 그 설명은
    파싱 본문에만 있고 PDF 텍스트 레이어에는 없어서(거기엔 이미지가 있다) 인용문으로는
    영원히 못 찾는다 — 근거의 image_no 를 보고 그림 자체에 사각형을 얹는다.
    """
    items: list[dict] = []
    unlocated: list[dict] = []
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        image_marks = match_images(pdf, images or [])
        cache: dict[int, tuple[list[dict], tuple[str, list[int]], float]] = {}

        def page_data(pno: int):
            if pno not in cache:
                page = pdf.pages[pno]
                words = _source_words(page)
                cache[pno] = (words, _page_index(words), float(page.height))
            return cache[pno]

        # 인용 → 좌표. **번호가 아니라 위치만** 공유한다(같은 글자를 두 번 뒤지지
        # 않으려는 캐시다).
        #
        # 예전에는 번호까지 공유했다. 한 낱말을 여러 지적이 각각 근거로 대는 일이
        # 흔해서다 — 실측(PLT56 RVVR): `운영파일` 하나를 세 지적이 물었다(용어 혼용
        # ·띄어쓰기·표기 불일치). 그러면 카드 번호가 `36, 29` 처럼 겹쳐 보이고,
        # 형광펜을 눌렀을 때 어느 카드로 갈지가 안 정해지며, 반영 확인에서 하나를
        # 정리해도 그 자리가 안 지워진다. 지적마다 제 번호를 준다.
        next_no = 1
        # 지적의 순서로 원문 출현을 배정하지 않는다. 같은 글자가 여러 곳이면
        # 소속 문맥으로 좁히고, 유일하지 않으면 위치 미확인으로 남긴다.
        for f in findings:
            marks: list[dict] = []
            nums: list[int] = []
            # 인용별 번호(evidence 와 같은 순서, 못 찾은 인용은 None). 카드가
            # "이 인용이 몇 번 형광펜인가"를 달 수 있게 — 같은 절의 인용이 둘이면
            # (실측: '운영권 조정'/'운영권조정' 모순) 번호 없이는 둘째를 못 찾는다.
            quote_nos: list[int | None] = []
            for e in (f.get("evidence") or []):
                quote = e.get("quote") or ""
                # 본문 밖에서 나온 근거(머릿말·꼬리말)는 **찾지 않는다.** 파서가
                # 본문에서 빼고 meta 로 옮긴 글이라, 본문을 뒤지면 우연히 같은
                # 글자가 있는 곳을 짚는다 — 실측(제출물 확인증)에서 머릿말의
                # `제출물 확인증` 이 본문 표의 같은 글자에 형광펜을 얹어 문서
                # 제목이 지적받은 것처럼 보였다.
                if e.get("source"):
                    unlocated.append({
                        "id": f.get("id"), "message": f.get("message"),
                        "quote": quote,
                        "reason": f"이 근거는 {e['source']}에서 나왔습니다 — "
                                  "본문이 아니라 뷰어에서 짚을 자리가 없습니다.",
                    })
                    quote_nos.append(None)
                    continue
                hit, location_reason, near = _unique_hit(e, f, len(pdf.pages), page_data)
                if hit is None:
                    # 그림 설명에서 나온 근거면 그림 자체를 짚는다. 짝을 못 지었으면
                    # (크기로도 종횡비로도 못 찾았으면) 아래로 떨어져 unlocated 가
                    # 된다 — 엉뚱한 곳에 얹지 않는다.
                    at = image_marks.get(e.get("image_no")) if e.get("image_no") else None
                    if at:
                        no = next_no
                        next_no += 1
                        boxes = [{"page": at["page"], "rect": list(at["rect"])}]
                        these = [{**b, "no": no} for b in boxes]
                        nums.append(no)
                        quote_nos.append(no)
                        marks.extend(these)
                        continue
                    unlocated.append({
                        "id": f.get("id"), "message": f.get("message"),
                        "quote": quote,
                        "reason": ("이 근거는 그림 설명에서 나왔지만 뷰어 PDF 에서 그 "
                                   "그림을 찾지 못했습니다." if e.get("image_no")
                                   else location_reason),
                        # 인용이 있는 자리들. 확정은 못 해도 화면이 거기로는 간다 —
                        # 후보마다 줄 상자 **전부**(rects)와 이동용 첫 상자(rect). 첫 줄만
                        # 실었더니 표 칸에서 두 줄로 꺾인 인용의 앞 줄만 점선이 쳐져,
                        # 정작 문제인 뒷 줄("Library 를구현하여")은 표시가 안 됐다(2026-09-15).
                        "pages": sorted({h[0] + 1 for h in near}),
                        "candidates": [
                            {"page": h[0] + 1, "rect": list(b[0]), "rects": [list(r) for r in b]}
                            for h in near for b in [_boxes(h[1], h[2])] if b
                        ][:20],
                    })
                    quote_nos.append(None)
                    continue
                pno, found, height = hit
                no = next_no
                next_no += 1
                # 마크마다 **자기 번호**를 단다. 예전에는 지적에만 `"1, 2, 3"` 을
                # 달아, 뷰어가 첫 형광펜에만 `1` 을 그리고 나머지 둘은 번호 없이
                # 칠해졌다 — 카드는 셋이라는데 문서엔 하나만 보였다.
                boxes = [{"page": pno + 1, "rect": list(b)}
                         for b in _boxes(found, height)]
                these = [{**b, "no": no} for b in boxes]
                nums.append(no)
                quote_nos.append(no)
                marks.extend(these)
            items.append({
                "id": f.get("id"),
                "no": ", ".join(str(n) for n in dict.fromkeys(nums)) or None,
                # 실제로 찾아낸 쪽(첫 마크). 체커가 주장한 쪽이 아니다.
                "page": marks[0]["page"] if marks else None,
                "sev": f.get("sev", "info"),
                "marks": marks,
                "quote_nos": quote_nos,
            })
        return {"pages": len(pdf.pages), "items": items, "unlocated": unlocated}


def annotate(pdf_bytes: bytes, findings: list[dict],
             doc_name: str = "", brand: str = "문서 검토") -> Marked:
    """PDF 원본 + 지적 → 형광펜·번호·요약 페이지가 얹힌 PDF.

    findings는 to_ui_review_payload가 낸 모양 그대로다
    ({id, sev, message, section, page, evidence: [{quote, page}]}).
    """
    reader = PdfReader(io.BytesIO(pdf_bytes))
    writer = PdfWriter(clone_from=reader)

    result = Marked(pdf=b"", marked=0)
    items: list[dict] = []

    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        # 페이지별 낱말 색인은 비싸다. 필요한 페이지만, 한 번만 만든다.
        cache: dict[int, tuple[list[dict], tuple[str, list[int]], float]] = {}

        def page_data(pno: int):
            if pno not in cache:
                page = pdf.pages[pno]
                words = _source_words(page)
                cache[pno] = (words, _page_index(words), float(page.height))
            return cache[pno]

        # 같은 문장을 두 번 칠하지 않는다. 표현 점검(consistency)과 일관성 agent가
        # 같은 불일치를 각각 찾아 같은 근거를 대는 일이 흔하다 — 그대로 얹으면
        # 형광펜이 겹쳐 색만 진해지고, 뷰어에서 주석 두 개가 포개진다.
        #
        # 다만 번호는 인용에 매단다. 두 지적이 같은 인용을 근거로 들면 요약에서
        # 둘 다 같은 번호를 가리킨다 — 뒤에 온 지적이 번호 없는 고아가 되지 않는다.
        # 인용 → (번호, 쪽). 쪽도 함께 기억한다 — 뒤에 온 지적이 같은 인용을
        # 근거로 들면 번호뿐 아니라 위치도 물려받아야 요약에 쪽이 뜬다.
        numbers: dict[tuple, tuple[int, int]] = {}
        labels: dict[int, list[tuple[int, float, float, str]]] = {}
        next_no = 1

        for f in findings:
            evidence = f.get("evidence") or []
            mine: list[int] = []
            # 지적이 실제로 앉은 쪽. PDF의 절 id는 쪽 기반이라 §0처럼 쓸모없이
            # 나온다 — 형광펜이 찍힌 쪽을 그대로 쓰는 편이 검토자에게 유용하다.
            first_page: int | None = None

            for e in evidence:
                quote = e.get("quote") or ""
                context = e.get("context") or {}
                key = (_squash(quote), str(e.get("section") or f.get("section") or ""),
                       context.get("before"), context.get("after"), e.get("source"),
                       e.get("page") if e.get("page_exact") is True else None)
                if key[0] and key in numbers:
                    no, pg = numbers[key]
                    mine.append(no)
                    if first_page is None:
                        first_page = pg
                    continue
                hit, location_reason, _near = _unique_hit(e, f, len(pdf.pages), page_data)

                if hit is None:
                    result.unmarked.append({
                        "id": f.get("id"), "message": f.get("message"),
                        "quote": quote,
                        "reason": location_reason,
                    })
                    continue

                pno, found, height = hit
                quads, rect = _quads(found, height)
                sev = f.get("sev", "info")
                annot = Highlight(
                    rect=tuple(rect),
                    quad_points=ArrayObject([FloatObject(v) for v in quads]),
                    highlight_color=_COLOR.get(sev, "ffd43b"),
                    printing=True,
                )
                # Acrobat·한컴에서 형광펜을 누르면 지적이 뜬다. 다만 크롬 기본
                # 뷰어는 이 팝업의 한글을 못 찍는다 — 그래서 요약 페이지를 따로
                # 그린다(pdf_summary). 팝업은 그것대로 쓰는 사람이 있으니 남긴다.
                annot[NameObject("/Contents")] = TextStringObject(
                    f"[{sev}] {f.get('message', '')}")
                annot[NameObject("/T")] = TextStringObject(brand)
                writer.add_annotation(page_number=pno, annotation=annot)

                no = next_no
                next_no += 1
                numbers[key] = (no, pno + 1)
                mine.append(no)
                if first_page is None:
                    first_page = pno + 1
                # 번호표는 형광펜 왼쪽에. rect는 아래에서 잰 좌표라 위에서 잰 값으로 돌린다.
                labels.setdefault(pno, []).append((no, rect[0], height - rect[3], sev))
                result.marked += 1

            # 근거가 여럿이면 번호도 여럿이다("1, 2"). 하나만 보여주면
            # 나머지 형광펜은 요약에서 짝을 잃는다.
            no = ", ".join(str(n) for n in dict.fromkeys(mine)) or None
            # 화면 카드도 같은 번호를 달 수 있게 id로 되짚을 표를 남긴다.
            fid = f.get("id")
            if no and fid:
                result.numbers[str(fid)] = no

            items.append({
                "no": no,
                "sev": f.get("sev", "info"),
                "page": first_page or f.get("page"),
                "section": f.get("section"),
                "message": f.get("message", ""),
                "quotes": [e.get("quote", "") for e in evidence],
                "suggestion": f.get("suggestion", ""),
            })

        _draw(writer, labels)

    # 요약 페이지를 맨 앞에 붙인다. 크롬 기본 뷰어는 주석 팝업의 한글을 못 찍고,
    # 인쇄하면 팝업은 아예 사라진다 — 지적 내용을 뷰어에 맡기면 안 된다.
    # 지면에 그린 글자는 어디서 열든, 인쇄해도 똑같이 보인다.
    if items:
        try:
            font = find_font()
        except FontMissing as exc:
            result.note = str(exc)
        else:
            size = _page_size(writer.pages[0])
            data = summary_pdf(doc_name or "문서", items, size, font, result.unmarked, brand)
            inserted = 0
            for i, page in enumerate(PdfReader(io.BytesIO(data)).pages):
                writer.insert_page(page, i)
                inserted += 1
            result.summary = True
            result.summary_pages = inserted

    # 요약을 못 넣었을 때만 옛 방식(1쪽 메모)으로 알린다. 조용히 넘기면
    # "표시가 없다 = 이상 없다"로 읽힌다.
    if result.unmarked and not result.summary and len(writer.pages) > 0:
        lines = "\n".join(f"- {u['message']}" for u in result.unmarked[:20])
        more = "" if len(result.unmarked) <= 20 else f"\n… 외 {len(result.unmarked) - 20}건"
        note = Text(
            rect=(10, 10, 30, 30),
            text=(f"{brand} — 아래 수정 사항은 본문에서 위치를 찾지 못해 표시하지 못했습니다. "
                  "이 PDF에 형광펜이 없다고 해서 수정 사항이 없는 것이 아닙니다.\n\n"
                  f"{lines}{more}"),
            open=False,
        )
        note[NameObject("/T")] = TextStringObject(f"{brand} — 표시하지 못한 수정 사항")
        writer.add_annotation(page_number=0, annotation=note)

    out = io.BytesIO()
    writer.write(out)
    result.pdf = out.getvalue()
    return result


def _page_size(page) -> tuple[float, float]:
    box = page.mediabox
    return (float(box.width), float(box.height))


def _draw(writer: PdfWriter, labels: dict[int, list[tuple[int, float, float, str]]]) -> None:
    """형광펜 옆 번호표를 지면에 그린다.

    주석이 아니라 페이지 내용이다 — 뷰어가 주석을 안 그려도, 인쇄를 해도 남는다.
    번호는 숫자라 한글 폰트가 없어도 찍힌다.
    """
    for pno, marks in labels.items():
        page = writer.pages[pno]
        overlay = number_overlay(_page_size(page), marks)
        page.merge_page(PdfReader(io.BytesIO(overlay)).pages[0])


def _candidate_pages(evidence: dict, finding: dict, total: int) -> list[int]:
    """어느 쪽을 뒤질까. 쪽 번호가 있으면 거기부터, 없으면 전부.

    `strict_page` 가 참이면 그 쪽과 앞뒤 한 쪽만 본다. 비슷한 곳 후보가 그렇다 —
    설계서 표마다 되풀이되는 칸("에러 발생시 로그 생성")을 문서 전체에서 찾으면
    엉뚱한 쪽의 첫 출현으로 가서, 카드는 21쪽이라는데 뷰어는 12쪽에 선다
    (2026-09-08 실측). 그 쪽에 없으면 못 찾은 것으로 두고 쪽으로만 옮긴다.
    """
    page = evidence.get("page") or finding.get("page")
    if isinstance(page, int) and 1 <= page <= total:
        if evidence.get("strict_page"):
            end = evidence.get("page_end")
            if isinstance(end, int) and end >= page:
                return list(range(page - 1, min(end, total)))
            return [p for p in (page - 1, page, page - 2) if 0 <= p < total]
        # 그 쪽에서 못 찾으면 나머지도 본다 — 추출 단계의 쪽 계산이 어긋날 수 있다.
        rest = [p for p in range(total) if p != page - 1]
        return [page - 1] + rest
    return list(range(total))
