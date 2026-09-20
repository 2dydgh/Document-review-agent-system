"""추적성 매트릭스를 xlsx 로 내보낸다.

팀이 보고서 **부록 B** 에 붙이는 산출물이다(양식:
`web/brand/source/reference/추적성matrix.png`). 화면의 추적표와 같은 칸을 쓰되,
기계 관찰(누락·반영됨…)과 검토자 판정을 열로 나눠 담는다 — 둘을 한 칸에 섞으면
"도구가 그렇게 판정했다"로 읽힌다.

CSV 로는 못 끝나는 이유는 셋이다.
* 요건 서술이 여러 줄이다. CSV 는 셀 안 줄바꿈을 엑셀이 제대로 못 여는 일이 잦아,
  지금 화면의 CSV 는 **첫 줄만** 담고 있었다 — 부록에 붙이면 내용이 잘린다.
* 25 행을 내려가면 무슨 칸인지 잊는다. 머리글 고정이 필요하다.
* 열 너비가 없으면 ID 칸이 내용 칸만큼 넓어져 표가 안 읽힌다.

CSV 는 없애지 않는다 — 다른 도구에 밀어 넣을 때 쓴다.
"""
from __future__ import annotations

import io
import re

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

#: 기계 관찰 → 사람이 읽는 말. 화면(views.js RTM_LABEL)과 같은 어휘를 쓴다 —
#: 화면에서 "근거 없음"이라 읽은 것이 엑셀에서 "orphan" 으로 나오면 안 된다.
#: 팀 밖 사람이 읽어도 **무엇을 어디서 찾았는지**가 읽히게 쓴다. "누락"·"근거 없음"은
#: 우리 안의 말이었다 — 보고서 받는 사람이 무슨 뜻인지 물었다(2026-09-08).
_STATUS = {"linked": "설계서에 번호 있음", "missing": "설계서에 번호 없음",
           "out_of_scope": "이 설계서 몫 아님", "rolled_up": "부모 번호로 연결됨",
           "orphan": "명세서에 번호 없음"}

#: 내용 대조의 기계 관찰. `no_conflict`를 "일치"라고 쓰지 않는다 — 모델은
#: 명시적인 모순 후보를 찾았는지만 보며, 충족 여부의 최종 판정은 사람이 한다.
_CONTENT_STATUS = {
    "conflict": "AI: 두 문장이 어긋나 보임 — 확인 필요",
    "no_conflict": "AI: 어긋나는 문장 못 찾음",
    "unreviewed": "대조 실패",
    "not_reviewed": "대조 안 함",
    "not_applicable": "-",
}

#: (머리글, 열 너비). 정·역방향은 팀 보고서 부록 B 요구사항처럼 별도 시트다.
_FORWARD_COLUMNS = (
    ("상위 요건 ID", 20),
    ("상위 요건 내용", 60),
    ("상위 위치", 12),
    ("매핑된 하위 ID", 22),
    ("하위 문서 상세", 60),
    ("번호 대조", 18),
    ("AI 내용 대조", 32),
    ("판정", 14),
    ("비고", 30),
)

_REVERSE_COLUMNS = (
    ("하위 문서 ID", 22),
    ("하위 문서 내용", 60),
    ("매핑된 상위 ID", 20),
    ("상위 요건 내용", 60),
    ("번호 대조", 18),
    ("AI 내용 대조", 32),
    ("판정", 14),
    ("비고", 30),
)

#: "읽는 법" 시트. 열 이름만으로는 안 읽혔다 — 하위 문서 상세가 무엇이고, 번호 대조와
#: AI 내용 대조가 무엇을 근거로 한 말인지, 판정은 누가 하는지.
_HOW_TO_READ = (
    ("상위 요건 ID / 내용",
     "요구사항명세서에서 규칙(요건 번호 형식)으로 자동으로 뽑은 요건과 그 서술."),
    ("상위 위치", "그 요건이 명세서 몇 쪽에 있나. 쪽수를 모르면 절 번호."),
    ("매핑된 하위 ID",
     "설계서에서 같은 요건 번호가 적힌 항목의 ID. 비어 있으면 설계서에 그 번호가 없다."),
    ("하위 문서 상세",
     "그 번호가 적힌 설계서 대목의 원문(표면 칸을 이어 붙였다). "
     "설계서에 번호가 없으면 비어 있다."),
    ("번호 대조",
     "도구가 번호로 맞춘 결과. '설계서에 번호 없음'은 설계가 없다는 뜻이 아니라 "
     "그 번호가 안 적혔다는 뜻이다 — 설계가 다른 말로 있을 수 있다."),
    ("AI 내용 대조",
     "번호가 맞은 쌍에 대해 AI 가 두 문장이 서로 어긋나는지 본 의견. "
     "상위 문장 vs 하위 문장을 인용하고 무엇이 다른지 적는다. 의견이지 판정이 아니다."),
    ("판정 / 비고",
     "검토자가 화면에서 누른 것(만족함·수정필요·해당사항없음)과 적은 근거. "
     "보고서의 결론은 이 두 칸이다."),
)

_HEAD_FILL = PatternFill("solid", fgColor="DCE6F1")
_CONFLICT_FILL = PatternFill("solid", fgColor="FCE4D6")
_THIN = Side(style="thin", color="BFBFBF")
_BORDER = Border(left=_THIN, right=_THIN, top=_THIN, bottom=_THIN)


def _cell_text(value: object) -> str:
    """엑셀 셀에 넣을 글. 표 행(`| 셀 | 셀 |`)은 파이프를 공백으로 편다.

    원문 글자는 안 바꾼다 — 파이프만 구분자로 쓰고 버린다(화면 statementHtml 과
    같은 규칙). 셀 안에서 줄바꿈은 살린다.
    """
    text = "" if value is None else str(value)
    return "\n".join(
        " ".join(part.strip() for part in line.split("|") if part.strip())
        if "|" in line else line.strip()
        for line in text.splitlines()
    ).strip()


def _prepare_sheet(ws, columns) -> None:
    """부록 B 표 한 장의 공통 서식."""
    for i, (head, width) in enumerate(columns, start=1):
        cell = ws.cell(row=1, column=i, value=head)
        cell.font = Font(bold=True)
        cell.fill = _HEAD_FILL
        cell.border = _BORDER
        cell.alignment = Alignment(vertical="center", horizontal="center")
        ws.column_dimensions[get_column_letter(i)].width = width
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = f"A1:{get_column_letter(len(columns))}1"


def _append(ws, values) -> int:
    ws.append(values)
    for i in range(1, len(values) + 1):
        cell = ws.cell(row=ws.max_row, column=i)
        cell.border = _BORDER
        cell.alignment = Alignment(wrap_text=True, vertical="top")
    return ws.max_row


def _content_text(row: dict) -> str:
    """내용 대조 상태와 확인 근거를 한 셀에 보존한다."""
    status = row.get("content_status") or "not_applicable"
    lines = [_CONTENT_STATUS.get(status, status)]
    for finding in row.get("content_findings") or []:
        message = re.sub(r"^\[[^]]+\]\s*", "", str(finding.get("message") or ""))
        if message and message not in lines:
            lines.append(message)
    return "\n".join(lines)


def _mark_conflict(ws, row: int, column: int) -> None:
    """팀 요구사항의 '불일치 빨강 표시'를 내용 대조 셀에만 적용한다."""
    cell = ws.cell(row=row, column=column)
    cell.fill = _CONFLICT_FILL
    cell.font = Font(color="C00000", bold=True)


def rtm_workbook(rows: list[dict], verdicts: dict | None = None) -> bytes:
    """추적표 행 + 검토자 판정 → xlsx 바이트.

    rows 는 UI payload 의 `rtm` 그대로다(to_ui_payload._row). verdicts 는
    {요건 ID: {verdict, note}} — 이력에 따로 저장된 사람의 판정이다.
    """
    judged = verdicts or {}
    wb = Workbook()
    forward = wb.active
    forward.title = "정방향 추적"
    reverse = wb.create_sheet("역방향 추적")
    guide = wb.create_sheet("읽는 법")
    guide.column_dimensions["A"].width = 22
    guide.column_dimensions["B"].width = 100
    for i, (name, what) in enumerate(_HOW_TO_READ, 1):
        guide.cell(row=i, column=1, value=name).font = Font(bold=True)
        cell = guide.cell(row=i, column=2, value=what)
        cell.alignment = Alignment(wrap_text=True, vertical="top")
    _prepare_sheet(forward, _FORWARD_COLUMNS)
    _prepare_sheet(reverse, _REVERSE_COLUMNS)

    for r in rows:
        rid = r.get("upper_id") or (r.get("lower_ids") or [None])[0] or ""
        vd = judged.get(str(rid)) or {}
        # "상위 위치"는 보고서 받는 사람이 **찾아갈 수 있는** 값이어야 한다. 쪽수가
        # 있으면 쪽수 — 절 번호는 제목에 번호가 없는 문서(HWP 실측)에선 파서가 매긴
        # 순번(§8.1)이라 문서에 없다. 쪽수를 모를 때만 절 번호를 적는다.
        section = r.get("section")
        page = r.get("page")
        title = (r.get("section_title") or "").strip()
        loc = (f"{page}쪽" if page else title[:40] if title else (f"§{section}" if section else ""))
        status = r.get("status") or ""
        content = _content_text(r)
        # 정방향은 상위 목록을 출발점으로 한다. 상위가 없는 orphan은 역방향에서만
        # 다룬다 — 두 표에 똑같이 넣으면 방향을 나눈 의미가 없다.
        if r.get("upper_id"):
            row_no = _append(forward, [
                r.get("upper_id") or "",
                _cell_text(r.get("text")),
                loc,
                " ".join(r.get("lower_ids") or []),
                _cell_text(r.get("child_text")),
                _STATUS.get(status, status),
                content,
                vd.get("verdict") or "",
                vd.get("note") or "",
            ])
            if r.get("content_status") == "conflict":
                _mark_conflict(forward, row_no, 7)

        # 역방향은 하위 목록을 출발점으로 한다. 누락처럼 하위 ID가 없는 행은
        # 들어가지 않고, 근거 없는 하위 ID(orphan)는 여기서 분명히 드러난다.
        for lower_id in r.get("lower_ids") or []:
            row_no = _append(reverse, [
                lower_id,
                _cell_text(r.get("child_text")),
                r.get("upper_id") or "",
                _cell_text(r.get("text")) if r.get("upper_id") else "",
                _STATUS.get(status, status),
                content,
                vd.get("verdict") or "",
                vd.get("note") or "",
            ])
            if r.get("content_status") == "conflict":
                _mark_conflict(reverse, row_no, 6)

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
