"""팀 평가 체크리스트 시트(행 목록) → 평가 항목.

열 이름을 못 박지 않는다 — 같은 파일 안에서도 시트마다 `Characteristic`/`Classification`,
`평가 항목`/`평가 아이템` 으로 갈리고 A 계열은 `Documents` 열이 더 있다(2026-09-16 실측).
헤더 행에서 역할 낱말로 찾고, ID·Evaluation Item 둘 중 하나라도 없으면 거절한다 —
조용히 넘기면 엉뚱한 열을 항목으로 읽어 초안이 헛돈다.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass

_MAX_HEADER_SCAN = 10


class EvalSheetError(ValueError):
    """평가 체크리스트로 읽을 수 없는 시트."""


@dataclass
class EvalItem:
    id: str
    item: str                 # Evaluation Item 원문(모델에 준다)
    characteristic: str = ""  # 부록 B Classification
    detail: str = ""          # 부록 B Detail Characteristic
    item_ko: str = ""         # 평가 항목/아이템(한글 풀이)
    viewpoint: str = ""       # 평가 관점
    document: str = ""        # A 계열 Documents 열 값
    raw_id: str = ""          # 원래 ID 가 TBD 였으면 "TBD"

    def to_dict(self) -> dict:
        return asdict(self)


#: 역할 → 헤더 낱말(앞부분 일치, 소문자·공백 정규화 뒤).
_ROLES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("id", ("id",)),
    ("item", ("evaluation item", "evaluation for document composition", "review item")),
    ("characteristic", ("characteristic", "classification", "quality characteristics",
                        "표준/sil")),
    ("detail", ("detail characteristic",)),
    ("item_ko", ("평가 항목", "평가 아이템", "평가아이템")),
    ("viewpoint", ("평가 관점",)),
    ("documents", ("documents",)),
)
_REQUIRED = {"id": "ID", "item": "Evaluation Item"}


def _norm(cell: object) -> str:
    return " ".join(str(cell or "").lower().split())


def _columns(row: list) -> dict[str, int | None]:
    """헤더 한 줄 → {역할: 열 번호}. 한 열은 한 역할만 맡는다.

    `Detail Characteristic (original)` 과 `Detail Characteristic` 이 나란히 있으면
    번역 쪽(original 이 안 붙은 것)을 고른다.
    """
    cols: dict[str, int | None] = {role: None for role, _ in _ROLES}
    taken: set[int] = set()
    for role, words in _ROLES:
        cands = [i for i, c in enumerate(row)
                 if i not in taken and any(_norm(c).startswith(w) for w in words)]
        if role == "characteristic":
            cands = [i for i in cands if not _norm(row[i]).startswith("detail")]
        if role == "detail":
            cands = ([i for i in cands if "original" not in _norm(row[i])] or cands)
        if cands:
            cols[role] = cands[0]
            taken.add(cands[0])
    return cols


def _header(rows: list[list[str]]) -> tuple[int, dict[str, int | None]]:
    best: tuple[int, dict[str, int | None]] | None = None
    for i, row in enumerate(rows[:_MAX_HEADER_SCAN]):
        cols = _columns(list(row))
        if cols["id"] is not None and cols["item"] is not None:
            return i, cols
        if best is None or sum(v is not None for v in cols.values()) > sum(
                v is not None for v in best[1].values()):
            best = (i, cols)
    missing = [label for role, label in _REQUIRED.items()
               if best is None or best[1][role] is None]
    raise EvalSheetError(
        "이 시트는 평가 체크리스트 꼴이 아닙니다: 없는 열 " + " · ".join(missing))


def _cell(row: list, idx: int | None) -> str:
    if idx is None or idx >= len(row):
        return ""
    return str(row[idx] or "").strip()


def sheet_documents(rows: list[list[str]]) -> list[str]:
    """`Documents` 열의 값들(정렬, 중복 제거). 열이 없으면 빈 목록."""
    try:
        head, cols = _header(rows)
    except EvalSheetError:
        return []
    if cols["documents"] is None:
        return []
    seen: list[str] = []
    for row in rows[head + 1:]:
        v = _cell(list(row), cols["documents"])
        if v and v not in seen:
            seen.append(v)
    return sorted(seen)


def read_eval_items(rows: list[list[str]], document: str = "") -> list[EvalItem]:
    """헤더 아래 행 중 ID 가 있는 행이 항목. 병합 셀(빈 칸)은 위 값을 이어받는다.

    `document` 를 주면 `Documents` 열이 그 값인 행만 남긴다(A 계열 시트).
    ID 가 `TBD` 인 행은 시트 안 순번(`TBD-01`)으로 구별하고 원래 값은 raw_id 에 남긴다.
    """
    head, cols = _header(rows)
    items: list[EvalItem] = []
    carry = {"characteristic": "", "detail": "", "documents": ""}
    tbd = 0
    for row in rows[head + 1:]:
        row = list(row)
        for role in carry:
            v = _cell(row, cols[role])
            if v:
                carry[role] = v
        item_id = _cell(row, cols["id"])
        if not item_id:
            continue
        if document and cols["documents"] is not None and carry["documents"] != document:
            continue
        raw_id = ""
        if item_id.upper() == "TBD":
            tbd += 1
            raw_id, item_id = "TBD", f"TBD-{tbd:02d}"
        items.append(EvalItem(
            id=item_id, item=_cell(row, cols["item"]),
            characteristic=carry["characteristic"], detail=carry["detail"],
            item_ko=_cell(row, cols["item_ko"]), viewpoint=_cell(row, cols["viewpoint"]),
            document=carry["documents"], raw_id=raw_id))
    return items
