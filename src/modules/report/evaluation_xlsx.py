"""부록 B 평가표 초안을 xlsx 로 내보낸다.

RVVR 부록 B 열 그대로다 — 검토자가 워드 부록에 복사해 붙인다(2026-09-16 결정: 화면
편집 없음). 판정 칸은 "제안:" 으로만 쓰고 ANR No.·Status 는 비운다 — 검토자 몫이다.
"""
from __future__ import annotations

import io
import re

from openpyxl import Workbook

from .rtm_xlsx import _append, _cell_text, _prepare_sheet

_COLUMNS = (
    ("Classification", 24),
    ("Detail Characteristic", 20),
    ("ID", 12),
    ("Evaluation Item", 60),
    ("Evaluation result and Comment", 60),
    ("ANR No.", 10),
    ("Status", 10),
)
_META_COLUMNS = (("항목", 18), ("값", 80))
_REV = re.compile(r"_Rev\.?\s*(\d{1,2})", re.IGNORECASE)
NOT_FOUND = "Not found"
# 초안 payload 의 행 상태 계약(agent_generate.DraftRow.status). 값만 쓰고 모듈을
# 가져오지 않는다 — report 는 혼자 떼어 가도 도는 모듈이다.
DRAFTED, NOT_FOUND_STATUS, UNREVIEWED = "drafted", "not_found", "unreviewed"


def _status_of(row: dict) -> str:
    """행의 상태. 이 변경(2026-09-16) 전에 저장된 payload 에는 status 가 없다 —
    그때는 Not found 가 '못 찾음'과 '못 봄'을 함께 뜻했으므로 못 봄으로 읽는다."""
    return row.get("status") or (
        UNREVIEWED if row.get("verdict_hint", NOT_FOUND) == NOT_FOUND else DRAFTED)


def _rev_of(name: str) -> str:
    m = _REV.search(name or "")
    return f"[Rev.{int(m.group(1)):02d}]" if m else "[Rev.__]"


def _comment(row: dict, rev: str) -> str:
    status = _status_of(row)
    if status == UNREVIEWED:
        reason = _cell_text(row.get("reason") or "").strip()
        return f"{rev} 검토하지 못함" + (f" — {reason}" if reason else "") + " — 검토자 확인 필요"
    if status == NOT_FOUND_STATUS:
        return f"{rev} 근거를 찾지 못함 — 검토자 확인 필요"
    head = f"{rev} 제안: {row['verdict_hint']}"
    # 코드가 확인한 절이다 — 모델이 comment 안에서 든 절 번호가 아니라 이쪽을 싣는다
    # (환각은 코드로 막는다). 화면(web/views.js)이 보여주는 것과 같은 값이다.
    secs = ", ".join(_cell_text(s).strip() for s in row.get("sections") or [] if str(s).strip())
    body = _cell_text(row.get("comment") or "").strip()
    quotes = "\n".join(
        f"“{_cell_text(q.get('quote'))}”" + (f" ({q['page']}쪽)" if q.get("page") else "")
        for q in row.get("quotes") or [] if q.get("quote"))
    return "\n".join(x for x in (head, f"Section: {secs}" if secs else "", body, quotes) if x)


def evaluation_workbook(payload: dict) -> bytes:
    """평가 초안 payload → xlsx 바이트. 첫 시트가 부록 B 표, 둘째가 생성 정보."""
    wb = Workbook()
    ws = wb.active
    ws.title = "평가표 초안"
    _prepare_sheet(ws, _COLUMNS)
    name = (payload.get("doc") or {}).get("name") or ""
    rev = _rev_of(name)
    rows = {r.get("item_id"): r for r in payload.get("rows") or []}
    for it in payload.get("items") or []:
        row = rows.get(it.get("id")) or {"verdict_hint": NOT_FOUND}
        _append(ws, [it.get("characteristic") or "", it.get("detail") or "",
                     it.get("raw_id") or it.get("id") or "", _cell_text(it.get("item")),
                     _comment(row, rev), None, None])

    info = wb.create_sheet("생성 정보")
    _prepare_sheet(info, _META_COLUMNS)
    for k, v in (
        ("문서", name),
        ("체크리스트", payload.get("checklist_name") or ""),
        ("시트", payload.get("sheet") or ""),
        ("문서 종류", payload.get("document_kind") or ""),
        ("근거 없음", f"{int(payload.get('unfound') or 0)}건 — 검토자 확인 필요"),
        ("검토하지 못함", f"{int(payload.get('unreviewed') or 0)}건 — 검토자 확인 필요"),
        ("그중 LLM 호출 실패", f"{int(payload.get('llm_failures') or 0)}건"),
        ("판정", "제안일 뿐이다 — 최종 판정(Satisfied 등)은 검토자가 정한다"),
    ):
        _append(info, [k, v])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
