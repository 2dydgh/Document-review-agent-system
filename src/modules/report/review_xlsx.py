"""단일 검토 결과를 xlsx 로 내보낸다.

품질팀 피드백(2026-09-14): 검토자는 같은 문서를 도구가 이어 주는 것보다,
**날짜 붙은 엑셀을 내려받아 자기 방식으로 관리**하고 싶어 한다. 그때까지 단일
검토는 CSV·HTML 만 있었고 CSV 는 첫 줄만 담는 문제가 그대로였다(rtm_xlsx 참고).

추적성 엑셀과 같은 이유로 서버가 만든다 — 지난 지적에 대한 판정(lineageVerdicts)이
이력에 따로 저장돼 있어, 화면이 든 것을 되돌려 받으면 저장 안 된 판정이 섞인다.
"""
from __future__ import annotations

import io
import re

from openpyxl import Workbook

from .rtm_xlsx import _append, _cell_text, _prepare_sheet

#: 화면(web/views.js SEV)과 같은 말. 확실/확인 필요는 화면에서 가르지 않기로
#: 했다(2026-09-14) — 검토자가 어차피 다시 본다. 내부 sev 는 그대로 남는다.
_KIND = {"major": "지적", "minor": "지적", "info": "검토 상태"}

_FINDING_COLUMNS = (
    ("번호", 6),
    ("구분", 10),
    ("검사", 22),
    ("위치", 12),
    ("내용", 70),
    ("근거 원문", 60),
    ("제안", 40),
)

_LINEAGE_COLUMNS = (
    ("판정", 10),
    ("기계 관찰", 12),
    ("위치", 12),
    ("지난번 지적", 70),
)


def _hidden(payload: dict) -> set:
    """검토자가 뺀 지적의 id — 화면과 같은 규칙(views.js hiddenFindingIds).

    이번 검토에서 직접 뺀 것(`dismissed`)과, 지난 검토의 `해당없음` 판정을 이어받아
    이번 지적에 붙은 것(lineage.items[].match_id) 둘 다다. 검토자가 지운 건
    산출물에도 안 나간다(2026-09-15 결정).
    """
    hidden = set(payload.get("dismissed") or [])
    verdicts = payload.get("lineageVerdicts") or {}
    for i, it in enumerate((payload.get("lineage") or {}).get("items") or []):
        mine = verdicts.get(it.get("key") or "") or verdicts.get(str(i))
        if mine == "해당없음" and it.get("match_id"):
            hidden.add(it["match_id"])
    return hidden


_DOC_NO = re.compile(r"^(\d+(?:\.\d+)*)\.?(?=\s|$)")
_APPENDIX = re.compile(r"^(?:appendix|부록)\s*([A-Za-z0-9]+)", re.IGNORECASE)


def _where(f: dict, titles: dict | None = None) -> str:
    """사람이 읽는 위치: 쪽수 + 제목 첫머리의 문서 번호(`8쪽 · 3.0절`, `24쪽 · 부록 B`).

    절 id 는 파서 내부 순번이라 안 적고, 제목 글자도 안 적는다(화면 locOf 와 같은 규칙).
    """
    title = " ".join(str((titles or {}).get(str(f.get("section") or ""), "")).split())
    num = ""
    m = _DOC_NO.match(title)
    if m:
        num = f"{m.group(1)}절"
    else:
        a = _APPENDIX.match(title)
        if a:
            num = f"부록 {a.group(1).upper()}"
    page = f"{f['page']}쪽" if f.get("page") else ""
    if page and num:
        return f"{page} · {num}"
    return num or page or "문서 전체"


def review_workbook(payload: dict) -> bytes:
    """단일 검토 payload(to_ui_review_payload 결과) → xlsx 바이트.

    첫 시트는 지적 전부, 둘째 시트는 지난 검토 대조(lineage)가 있을 때만 붙는다.
    """
    wb = Workbook()
    ws = wb.active
    ws.title = "검토 결과"
    _prepare_sheet(ws, _FINDING_COLUMNS)
    findings = [f for f in payload.get("findings") or [] if f.get("id") not in _hidden(payload)]
    titles = {str(sec.get("id")): sec.get("title") or "" for sec in payload.get("sections") or []}
    for i, f in enumerate(findings, 1):
        kind = "미검토" if f.get("unreviewed") else _KIND.get(f.get("sev"), f.get("sev") or "")
        check = (" · ".join(x for x in (f.get("label"), f.get("kind")) if x)
                 or (f.get("checker") or ""))
        quotes = "\n".join(_cell_text(e.get("quote")) for e in (f.get("evidence") or [])
                           if e.get("quote"))
        _append(ws, [i, kind, check, _where(f, titles), _cell_text(f.get("message")), quotes,
                     _cell_text(f.get("suggestion"))])

    lineage = payload.get("lineage") or {}
    if lineage.get("items"):
        verdicts = payload.get("lineageVerdicts") or {}
        ls = wb.create_sheet("반영 확인")
        _prepare_sheet(ls, _LINEAGE_COLUMNS)
        for i, it in enumerate(lineage["items"]):
            f = it.get("finding") or {}
            mine = verdicts.get(it.get("key") or "") or verdicts.get(str(i)) or {}
            verdict = mine if isinstance(mine, str) else (mine.get("verdict") or "")
            _append(ls, [verdict, it.get("status") or "", _where(f, titles),
                         _cell_text(f.get("message"))])

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
