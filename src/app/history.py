"""검토 이력 저장소 — 결과를 SQLite 에 남긴다.

원본 문서는 뷰어용으로 보관 기한(30일)·용량(2GB) 안에서만 파일로 둔다. 고객
문서가 서버에 무한정 쌓이는 것보다, 결과를 남기고 업로드본은 한도 안에서만 두는
편이 안전하다 (업로드 자체는 지금도 임시 디렉터리에서 처리된다).

**결과(payload)는 DB, 원본 문서는 파일.** 나누는 기준은 크기와 쓰임이다.
payload 는 중앙값 26KB 짜리 JSON 이라 표에 넣어도 가볍고, 목록·검색·보관기간
삭제가 전부 여기서 끝난다. 원본은 중앙값 1.5MB 바이너리고 뷰어가 통째로 받아
가는 것뿐이라 표에 넣을 이유가 없다.

파일(검토 하나 = JSON 하나)에서 옮겨 온 이유는 목록이었다. 제목과 날짜 20개를
보여주려고 파일 수백 개를 열어 결과 전체를 파싱했다 — 계정 필터가 걸리면 남의
기록을 건너뛰느라 더 읽었다. 표에서는 payload 를 안 읽고 20행만 가져온다.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import unicodedata
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path

from . import db

# 이력이 무한정 쌓이면 목록 조회가 느려지고 디스크를 먹는다. 오래된 것부터 지운다.
#
# 200 → 1000 으로 올렸다(2026-09-01). 실측: 이력 하나가 중앙값 26KB(최대 293KB)라
# 1000 건이 약 26MB 다. 200 건은 **계정이 생기면서** 특히 좁아졌다 — 목록은 계정별로
# 갈리는데 이 상한은 전체 공용이라, 한 사람이 200 건을 돌리면 남의 이력이 밀려난다.
# 최대 사용자 50명(CLAUDE.md)이면 1000 건도 1인당 20건이다.
MAX_ENTRIES = 1000

# 원본 문서(뷰어용)는 **용량으로만** 묶는다. 넘겨서 밀려난 이력을 다시 열면 원본이
# 없어 텍스트 재현본으로 degrade 한다.
#
# 개수 상한(MAX_ORIGINALS)이 따로 있었다: 20 → 100(2026-09-01) → 폐지(2026-09-08).
# 두 번 올렸지만 둘 다 일주일 만에 다시 찼다 — 개수는 문서 크기를 모르는 잣대라
# 정할 근거가 없고, 실측(100 건 = 214MB)에서 늘 용량 상한(2GB)보다 한참 먼저 걸려
# 디스크가 10%도 안 찬 채 원문만 사라졌다. 지키려던 것은 처음부터 디스크였으므로
# 디스크로만 잰다. 실측 중앙값 2MB 기준 2GB 는 약 1000 건, 두 달치다.
MAX_ORIGINAL_BYTES = 2 * 1024 * 1024 * 1024

# 보관 기한. CLAUDE.md 의 "보관 기간 경과 시 자동 삭제 (기간은 추후 결정)" 를 30일로
# 정했다(2026-09-08). 용량 상한은 디스크를 지키는 것이고 이쪽은 **고객 문서를 필요
# 이상 들고 있지 않는다**는 약속이라, 둘은 목적이 달라 함께 건다.
#
# 기한은 용량과 달리 **첫 파일도 봐주지 않는다.** 30일 지난 문서는 하나뿐이어도
# 지워야 약속이 지켜진다.
MAX_ORIGINAL_AGE_DAYS = 30

#: 이력 표가 사는 파일. 원본 문서와 같은 디렉터리에 둔다(`root/`).
DB_NAME = "index.db"

# 이력 ID. 원본 문서의 **파일 이름**으로도 쓰므로 형식을 좁게 잡는다 —
# 바깥에서 들어온 ID 를 그대로 경로에 붙이면 "../../etc/passwd" 같은 값으로
# 아무 파일이나 읽거나 지울 수 있다. (표 조회는 파라미터 바인딩이라 안전하지만,
# 원본 경로는 여전히 문자열 조립이다.)
#
# 시각 부분이 마이크로초까지인 이유: 초 단위로 끊으면 같은 초에 저장된 두 건의
# 순서가 뒤의 무작위 해시로 갈려 "최신순"이 뒤집힌다(실제로 뒤집혔다).
_ID_RE = re.compile(r"^\d{8}T\d{12}-[0-9a-f]{8}$")


class HistoryError(Exception):
    """이력을 찾을 수 없거나 ID가 올바르지 않다."""


@dataclass(frozen=True)
class Entry:
    """목록에 보여줄 요약. 결과 전체(payload)는 따로 get()으로 읽는다."""
    id: str
    kind: str          # "compare" | "review" | "checklist" | "evaluation"
    at: str            # ISO8601 (초 단위)
    title: str         # 예: "PRJX-AN-002.hwpx ↔ PRJX-DS-005.hwpx"
    findings: int
    summary: dict | None = None
    owner: str = ""     # 검토를 돌린 계정 이메일. "" 는 소유자 없음

    def as_dict(self) -> dict:
        return {"id": self.id, "kind": self.kind, "at": self.at,
                "title": self.title, "findings": self.findings, "summary": self.summary,
                "owner": self.owner}


def _result_counts(kind: str, payload: dict) -> dict:
    """결함·미검토·과정 보고·사람 미판정을 서로 다른 단위로 센다."""
    rows = payload.get("findings") or []
    unreviewed = sum(1 for f in rows if f.get("unreviewed"))
    info = sum(1 for f in rows if not f.get("unreviewed") and f.get("sev") == "info")
    issues = len(rows) - unreviewed - info
    if kind == "evaluation":
        # 초안은 Finding 을 안 낸다 — 미검토는 행 상태를 센 payload 수에서 온다
        # (지적 수가 아니므로 issues 에는 안 섞는다).
        unreviewed = max(0, int(payload.get("unreviewed") or 0))
    pending = 0
    if kind == "compare":
        # 검토자 판정이 아직 없는 요건 행 — 홈 "할 일"이 "요건 N개 미판정"으로 센다(2026-09-18).
        # 행의 열쇠는 화면(rtmVerdicts)과 같다: 상위 ID, 없으면 첫 하위 ID. 범위 밖 행은 안 센다.
        verdicts = payload.get("rtmVerdicts") or {}
        for r in payload.get("rtm") or []:
            if not isinstance(r, dict) or r.get("status") == "out_of_scope":
                continue
            rid = str(r.get("upper_id") or (r.get("lower_ids") or [""])[0] or "")
            if not (verdicts.get(rid) or {}).get("verdict"):
                pending += 1
    return {"issues": issues, "unreviewed": unreviewed,
            "info": info, "pending": pending,
            "unfound": max(0, int(payload.get("unfound") or 0)) if kind == "evaluation" else 0,
            # 폴더 검토가 본 문서 수 — 목록 글리프의 건수 배지가 쓴다(2026-09-17).
            # 다른 종류는 0(문서 하나·둘은 글리프가 이미 말한다).
            "documents": len(payload.get("outputs") or []) if kind == "case" else 0,
            "unjudged": max(0, int(payload.get("unjudged") or 0))
            if kind == "checklist" else 0}


def _search_text(value: str) -> str:
    return unicodedata.normalize("NFC", value).casefold()


def _new_id(now: datetime) -> str:
    # 시각(마이크로초까지)을 앞에 둬서 ID 만 정렬해도 시간순이 된다.
    # 뒤의 무작위 8자는 정렬용이 아니라 충돌 방지용이다.
    return f"{now:%Y%m%dT%H%M%S%f}-{uuid.uuid4().hex[:8]}"


def _summarize(kind: str, payload: dict) -> tuple[str, int]:
    """목록에 쓸 제목과 지적사항 수를 결과에서 뽑는다."""
    counts = _result_counts(kind, payload)
    findings = counts["issues"]
    if kind == "compare":
        a = (payload.get("docA") or {}).get("name") or "?"
        b = (payload.get("docB") or {}).get("name") or "?"
        return f"{a} ↔ {b}", findings
    if kind == "case":
        # 산출물 세트 검토. 제목은 의뢰번호이고, 세는 것은 "막는 것"이다 —
        # 미검토는 지적이 아니라서 이 수에 넣지 않는다(목록에서 둘이 섞이면
        # "지적 0건" 이 "다 봤고 이상 없다"로 읽힌다).
        return payload.get("caseId") or "?", findings
    if kind == "checklist":
        # 체크리스트 실행은 findings가 아니라 문서 대비 미판정 개수로 본다 —
        # 목록에서 "몇 건 안 봤는지"가 여기서도 드러나야 한다.
        title = payload.get("document_name") or payload.get("checklist_name") or "?"
        return title, int(payload.get("unjudged") or 0)
    if kind == "evaluation":
        # 부록 B 초안. 목록에서 볼 것은 지적 수가 아니라 "근거 못 찾은 항목 수"다.
        # 검토를 못 한 건수는 summary["unreviewed"] 가 따로 진다 — 화면이 그쪽을
        # 먼저 말한다("근거 없음"과 "검토 못 함"을 한 수에 섞지 않는다).
        return (payload.get("doc") or {}).get("name") or "?", counts["unfound"]
    return (payload.get("doc") or {}).get("name") or "?", findings


def _owners_clause(owners: list[str] | None) -> tuple[list[str], list]:
    """소유자 필터 조건(WHERE 조각 목록). None 이면 없음, 아니면 그 계정들 +
    소유자 없는 기록."""
    if owners is None:
        return [], []
    marks = ",".join("?" * (len(owners) + 1))
    return [f"owner IN ({marks})"], ["", *owners]


def _row_entry(row) -> Entry:
    return Entry(id=row["id"], kind=row["kind"], at=row["at"],
                 title=row["title"], findings=int(row["findings"]),
                 summary=json.loads(row["summary"]) if row["summary"] else None,
                 owner=row["owner"] or "")


class HistoryStore:
    def __init__(self, root: str | Path, max_entries: int = MAX_ENTRIES) -> None:
        self.root = Path(root)
        self.max_entries = max_entries
        self._db = db.init(self.root / DB_NAME, db.HISTORY_SCHEMA)
        self._migrate_json()
        self._backfill_summaries()
        self._backfill_findings()

    def _backfill_summaries(self) -> None:
        """기존 payload는 보존하고 목록의 파생 요약만 한 번 보정한다."""
        with db.connect(self._db, immediate=True) as con:
            columns = {r["name"] for r in con.execute("PRAGMA table_info(review)")}
            if "summary" not in columns:
                con.execute("ALTER TABLE review ADD COLUMN summary TEXT")
            if "title_search" not in columns:
                con.execute("ALTER TABLE review ADD COLUMN title_search TEXT NOT NULL DEFAULT ''")
            # 요약이 없는 행 + 폴더 검토인데 문서 수(documents)가 없는 옛 요약. 요약은
            # payload 에서 파생되는 값이라 다시 세도 되고, 안 세면 목록 배지만 비어 있다.
            old_rows = con.execute(
                "SELECT id, kind, title, payload FROM review WHERE summary IS NULL"
                " OR (kind = 'case' AND summary NOT LIKE '%\"documents\"%')"
                " OR (kind = 'compare' AND summary NOT LIKE '%\"pending\"%')").fetchall()
            for row in old_rows:
                try:
                    payload = json.loads(row["payload"])
                    counts = _result_counts(row["kind"], payload)
                    _, findings = _summarize(row["kind"], payload)
                except (ValueError, TypeError, AttributeError):
                    # 깨진 기록을 삭제하거나 0건으로 위장하지 않는다.
                    con.execute("UPDATE review SET summary=?, title_search=? WHERE id=?",
                                ('{"unavailable":true}', _search_text(row["title"]), row["id"]))
                    continue
                con.execute("UPDATE review SET findings=?, summary=?, title_search=? WHERE id=?",
                            (findings, json.dumps(counts), _search_text(row["title"]), row["id"]))

    def _migrate_json(self) -> None:
        """예전 형식(검토 하나 = JSON 파일 하나)을 표로 옮긴다. 표가 비었을 때만.

        옮긴 뒤에도 JSON 은 지우지 않는다 — 되돌릴 자리를 남겨 둔다.
        """
        with db.connect(self._db, immediate=True) as con:
            if con.execute("SELECT 1 FROM review LIMIT 1").fetchone():
                return
            for path in sorted(self.root.glob("*.json")):
                try:
                    rec = json.loads(path.read_text(encoding="utf-8"))
                except (OSError, json.JSONDecodeError):
                    continue        # 깨진 파일 하나 때문에 이사가 멈추면 안 된다
                if not isinstance(rec, dict) or not _ID_RE.match(rec.get("id") or ""):
                    continue
                con.execute(
                    "INSERT OR IGNORE INTO review"
                    " (id, kind, at, title, owner, findings, payload)"
                    " VALUES (?,?,?,?,?,?,?)",
                    (rec["id"], rec.get("kind") or "review", rec.get("at") or "",
                     rec.get("title") or "", rec.get("owner") or "",
                     int(rec.get("findings") or 0),
                     json.dumps(rec.get("payload") or {}, ensure_ascii=False)))

    # ---- 쓰기 ------------------------------------------------------------
    def save(self, kind: str, payload: dict, *, now: datetime | None = None,
             owner: str = "") -> Entry:
        if kind not in ("compare", "review", "checklist", "case", "evaluation"):
            raise HistoryError(f"알 수 없는 검토 종류: {kind}")
        now = now or datetime.now()
        entry_id = _new_id(now)
        title, findings = _summarize(kind, payload)
        entry = Entry(id=entry_id, kind=kind, at=now.isoformat(timespec="seconds"),
                      title=title, findings=findings, summary=_result_counts(kind, payload),
                      owner=owner)
        # owner = 검토를 돌린 계정 이메일. "" 는 소유자 없음(로그인 도입 전 기록,
        # 또는 비로그인 API 호출) — 목록에서 모두에게 보인다.
        with db.connect(self._db) as con:
            con.execute(
                "INSERT INTO review (id, kind, at, title, owner, findings, payload,"
                " summary, title_search)"
                " VALUES (?,?,?,?,?,?,?,?,?)",
                (entry_id, kind, entry.at, title, owner, findings,
                 json.dumps(payload, ensure_ascii=False),
                 json.dumps(entry.summary), _search_text(title)))
            # 같은 트랜잭션 안에서 — 결과만 남고 지적 행이 빠지는 일이 없게.
            _index_findings(con, entry_id, payload)
            self._prune(con)
        return entry

    def _backfill_findings(self) -> None:
        """이미 있는 이력의 지적을 행으로 펼친다. finding 표가 비었을 때만.

        payload 는 진작 저장돼 있는데 지적 행은 나중에 생겼다 — 옛 기록도
        집계·조회에 잡혀야 "지난달 major 몇 건" 이 반쪽이 되지 않는다.

        # ponytail: "표가 비었나" 하나로 판단한다. 이력 전체의 지적이 정말
        # 0건이면 시작할 때마다 다시 훑지만(218건 0.3초), 실제로 그런 저장소는
        # 없다. 어긋나면 표를 비우고 다시 띄우는 것이 복구 절차다.
        """
        with db.connect(self._db, immediate=True) as con:
            if con.execute("SELECT 1 FROM finding LIMIT 1").fetchone():
                return
            for row in con.execute("SELECT id, payload FROM review").fetchall():
                try:
                    payload = json.loads(row["payload"])
                except json.JSONDecodeError:
                    continue
                if isinstance(payload, dict):
                    _index_findings(con, row["id"], payload)

    def _prune(self, con) -> None:
        """상한을 넘긴 오래된 이력을 지운다. id 앞이 시각이라 역순이 최신순이다.

        지적 행은 ON DELETE CASCADE 로 함께 사라진다(외래키는 db.connect 가 켠다).
        """
        con.execute(
            "DELETE FROM review WHERE id NOT IN"
            " (SELECT id FROM review ORDER BY id DESC LIMIT ?)",
            (self.max_entries,))

    # ---- 읽기 ------------------------------------------------------------
    def list(self, limit: int = 20, owners: list[str] | None = None) -> list[Entry]:
        """owners 를 주면 그 계정들의 기록 + 소유자 없는 기록(로그인 도입 전)만.
        None 이면 전부 — 관리자·내부 조회용이다.

        누구를 넣을지는 부르는 쪽이 정한다(같은 팀 = 계정 표를 아는 server). 여기는
        계정을 모른다 — 팀을 행에 박아 두면 사람이 팀을 옮길 때 옛 기록이 옛 팀에
        남고, 그걸 고치는 이관 코드가 또 필요하다(2026-09-09).

        payload 는 안 읽는다. 목록에 필요한 것은 제목·날짜·건수뿐인데 예전에는
        결과 전체를 파싱했다.

        # ponytail: 목록만 소유자로 거른다. 개별 조회(get/delete)는 id 로 연다 —
        # id 뒤 8자가 무작위라 남의 id 를 짚어 맞히긴 어렵다. 계정별 완전 격리가
        # 필요해지면 그때 get/delete 에도 owner 를 건다.
        """
        sql = "SELECT id, kind, at, title, owner, findings, summary FROM review"
        where, args = _owners_clause(owners)
        if where:
            sql += " WHERE " + where[0]
        sql += " ORDER BY id DESC LIMIT ?"
        args.append(limit)
        with db.connect(self._db) as con:
            return [_row_entry(r) for r in con.execute(sql, args)]

    def page(self, limit: int = 20, offset: int = 0, *, q: str = "",
             kind: str = "", owners: list[str] | None = None) -> dict:
        """보관 중인 기록 전체에서 검색한다. 행·합계·유형별 수는 같은 읽기 스냅샷.
        owners 는 list() 와 같다."""
        if kind not in ("", "review", "compare", "case", "checklist", "evaluation"):
            raise HistoryError("알 수 없는 검토 유형입니다")
        limit, offset = max(1, min(int(limit), 100)), max(0, int(offset))
        where, args = _owners_clause(owners)
        owner_where = " WHERE " + " AND ".join(where) if where else ""
        owner_args = list(args)
        for word in _search_text(q).split():
            # 사용자 %·_는 검색 와일드카드가 아니라 제목의 문자다.
            literal = word.replace("!", "!!").replace("%", "!%").replace("_", "!_")
            where.append("title_search LIKE ? ESCAPE '!'")
            args.append("%" + literal + "%")
        query_where = " WHERE " + " AND ".join(where) if where else ""
        with db.connect(self._db) as con:
            con.execute("BEGIN")
            available = con.execute(
                "SELECT COUNT(*) FROM review" + owner_where, owner_args).fetchone()[0]
            counts = {r["kind"]: r["n"] for r in con.execute(
                "SELECT kind, COUNT(*) AS n FROM review" + query_where + " GROUP BY kind", args)}
            counts[""] = sum(counts.values())
            total = counts.get(kind, 0)
            offset = min(offset // limit * limit, max(0, (total - 1) // limit * limit))
            if kind:
                where.append("kind=?")
                args.append(kind)
            filtered = " WHERE " + " AND ".join(where) if where else ""
            rows = con.execute("SELECT id, kind, at, title, owner, findings, summary"
                               " FROM review" + filtered + " ORDER BY id DESC LIMIT ? OFFSET ?",
                               [*args, limit, offset])
            return {"entries": [_row_entry(r).as_dict() for r in rows],
                    "total": total, "available_total": available, "kind_counts": counts,
                    "limit": limit, "offset": offset}

    def search_findings(self, q: str = "", *, kind: str = "", checker: str = "",
                        sev: str = "", since: str = "", owners: list[str] | None = None,
                        limit: int = 100) -> list[dict]:
        """여러 기록의 지적을 한 번에 훑는다(finding 색인표) — 어시스턴트의 "지난 검토들에도
        같은 지적이 있었나"용(2026-09-17). 낱말은 전부 지적 문장·검사기·종류·문서명 중
        하나에 있어야 한다. 얇은 행만 돌려주고 자세한 건 get() 으로 연다.
        초안(evaluation) 행은 색인표에 없어 여기 안 잡힌다."""
        if kind not in ("", "review", "compare", "case", "checklist", "evaluation"):
            raise HistoryError("알 수 없는 검토 유형입니다")
        where, args = _owners_clause(owners)
        where = [w.replace("owner IN", "r.owner IN") for w in where]
        for word in _search_text(q).split():
            literal = word.replace("!", "!!").replace("%", "!%").replace("_", "!_")
            where.append("(f.message LIKE ? ESCAPE '!' OR f.checker LIKE ? ESCAPE '!'"
                         " OR f.kind LIKE ? ESCAPE '!' OR f.document LIKE ? ESCAPE '!'"
                         " OR r.title_search LIKE ? ESCAPE '!')")
            args.extend(["%" + literal + "%"] * 5)
        for col, val in (("r.kind", kind), ("f.checker", checker), ("f.sev", sev)):
            if val:
                where.append(f"{col}=?")
                args.append(val)
        if since:
            where.append("r.at >= ?")
            args.append(since)
        sql = ("SELECT f.review_id, r.kind AS review_kind, r.at, r.title, r.owner, f.seq,"
               " f.finding_id, f.sev, f.kind, f.checker, f.section, f.page, f.document,"
               " f.unreviewed, f.message FROM finding f JOIN review r ON r.id = f.review_id"
               + (" WHERE " + " AND ".join(where) if where else "")
               + " ORDER BY r.id DESC, f.seq LIMIT ?")
        with db.connect(self._db) as con:
            rows = con.execute(sql, [*args, max(1, min(int(limit), 300))]).fetchall()
        return [{"review_id": r["review_id"], "review_kind": r["review_kind"], "at": r["at"],
                 "title": r["title"], "owner": r["owner"] or "", "seq": r["seq"],
                 "finding_id": r["finding_id"], "sev": r["sev"], "kind": r["kind"],
                 "checker": r["checker"], "section": r["section"], "page": r["page"],
                 "document": r["document"], "unreviewed": bool(r["unreviewed"]),
                 "message": r["message"]} for r in rows]

    def get(self, entry_id: str) -> dict:
        """저장된 결과 전체(payload)를 돌려준다."""
        with db.connect(self._db) as con:
            row = self._fetch(con, entry_id)
        return _record(row)

    def _fetch(self, con, entry_id: str):
        if not _ID_RE.match(entry_id or ""):
            # 경로 탈출 시도든 오타든, 여기서 끊는다.
            raise HistoryError(f"올바르지 않은 이력 ID: {entry_id}")
        row = con.execute("SELECT * FROM review WHERE id=?", (entry_id,)).fetchone()
        if row is None:
            raise HistoryError(f"이력을 찾을 수 없습니다: {entry_id}")
        return row

    def update_payload(self, entry_id: str, patch: dict, *,
                       refresh_summary: bool = False) -> dict:
        """저장된 결과의 payload 일부를 갈아끼운다.

        산출물 세트 검토가 "직접 확인 3건을 사람이 눌렀다"를 남기려면 필요하다. 결과는
        이미 저장돼 있는데 확인 표시만 브라우저에 있으면, 나중에 그 기록을 열었을 때
        "이 건은 발급했나" 를 알 수 없다 — 점검의 결론이 통째로 사라진다.

        payload 를 통째로 받지 않고 **일부만** 받는다. 통째로 받으면 브라우저가
        보낸 것이 검사 결과를 덮어쓸 수 있다 — 확인 표시는 사람이 정하지만 지적은
        도구가 정한다.

        읽고-고쳐-쓰기라 쓰기 잠금을 먼저 잡는다(immediate) — 두 사람이 같은
        기록의 확인 표시를 동시에 누르면 하나가 소리 없이 사라지던 자리다.
        """
        with db.connect(self._db, immediate=True) as con:
            row = self._fetch(con, entry_id)
            record = _record(row)
            payload = {**record["payload"], **patch}
            record["payload"] = payload
            if refresh_summary:
                record["title"], record["findings"] = _summarize(record["kind"], payload)
            record["summary"] = _result_counts(record["kind"], payload)
            _, record["findings"] = _summarize(record["kind"], payload)
            con.execute("UPDATE review SET title=?, findings=?, payload=?, summary=?,"
                        " title_search=? WHERE id=?",
                        (record["title"], record["findings"],
                         json.dumps(payload, ensure_ascii=False),
                         json.dumps(record["summary"]), _search_text(record["title"]), entry_id))
            # payload 가 바뀌었으면 지적 행도 다시 쓴다 — 놔두면 표와 원본이
            # 갈라져서, 집계는 옛 지적을 세고 화면은 새 지적을 보여준다.
            con.execute("DELETE FROM finding WHERE review_id=?", (entry_id,))
            _index_findings(con, entry_id, payload)
        return record

    def delete(self, entry_id: str) -> None:
        with db.connect(self._db) as con:
            self._fetch(con, entry_id)
            con.execute("DELETE FROM review WHERE id=?", (entry_id,))
        self._delete_original(entry_id)   # 결과를 지우면 원본도 함께 지운다

    # ---- 원본 문서(뷰어용) ------------------------------------------------
    # 결과만 남기던 정책에서, "이력에서도 원본을 다시 보기" 위해 원본을 함께 보관한다.
    # 파일 이름이 id(=시각)로 시작하므로 이름 역순이 최신순이다.
    def _orig_dir(self) -> Path:
        return self.root / "originals"

    def save_original(self, entry_id: str, filename: str, data: bytes,
                      *, slot: str = "") -> None:
        """원본을 보관한다. slot 은 한 이력에 문서가 둘일 때만 쓴다(비교: A·B).

        비교는 오래 원본을 안 남겼다. 그래서 기록에서 다시 연 비교는 원문 보기가
        아예 안 됐고, 화면은 그 사실도 말하지 않아 기능이 사라진 것처럼 보였다.
        """
        if not _ID_RE.match(entry_id or ""):
            raise HistoryError(f"올바르지 않은 이력 ID: {entry_id}")
        if slot and slot not in ("A", "B"):
            raise HistoryError(f"알 수 없는 문서 자리: {slot}")
        ext = Path(filename or "").suffix.lower()
        if ext not in (".pdf", ".docx", ".hwpx", ".hwp"):
            return          # 뷰어가 못 여는 포맷은 원본을 남길 이유가 없다
        d = self._orig_dir()
        d.mkdir(parents=True, exist_ok=True)
        dest = d / f"{entry_id}{('--' + slot) if slot else ''}{ext}"
        tmp = dest.with_suffix(dest.suffix + ".tmp")
        tmp.write_bytes(data)
        os.replace(tmp, dest)
        self._prune_originals()

    def _prune_originals(self, max_bytes: int = MAX_ORIGINAL_BYTES,
                         max_age_days: int = MAX_ORIGINAL_AGE_DAYS) -> None:
        """최신 것부터 보관 기한·용량 안에서만 남긴다.

        지운 건수는 stderr 로 남긴다 — 조용히 지우면 나중에 "원문이 왜 없지"를
        되짚을 방법이 없다. 실제로 그 질문을 받았다(2026-09-08).
        """
        d = self._orig_dir()
        if not d.is_dir():
            return
        kept = sorted((p for p in d.iterdir()
                       if p.is_file() and not p.name.endswith(".tmp")), reverse=True)
        cutoff = datetime.now() - timedelta(days=max_age_days)
        used = aged = over = 0
        for i, p in enumerate(kept):
            try:
                size = p.stat().st_size
            except OSError:
                size = 0
            # 기한은 첫 파일도 봐주지 않는다 — 30일 지난 문서는 하나뿐이어도 지운다.
            saved = _saved_at(p)
            if saved is not None and saved < cutoff:
                p.unlink(missing_ok=True)
                aged += 1
                continue
            # 용량은 첫 파일을 봐준다 — 방금 저장한 것을 바로 지우면 "저장했다"고
            # 말하고 없는 셈이 된다.
            if i and used + size > max_bytes:
                p.unlink(missing_ok=True)
                over += 1
                continue
            used += size
        if aged or over:
            print(f"원본 보관 정리: 기한({max_age_days}일) 경과 {aged}건 · "
                  f"용량 초과 {over}건 삭제", file=sys.stderr)
        self._prune_rendered()      # 원본이 밀려났으면 그 변환본도 쓸모가 없다

    def original(self, entry_id: str, slot: str = "") -> tuple[str, bytes] | None:
        """보관 중인 원본이 있으면 (파일명, 바이트), 없으면 None.

        slot 은 비교의 상위(A)·하위(B). 안 주면 자리 표시가 없는 파일(단일 검토)이다.
        """
        if not _ID_RE.match(entry_id or ""):
            raise HistoryError(f"올바르지 않은 이력 ID: {entry_id}")
        if slot and slot not in ("A", "B"):
            raise HistoryError(f"알 수 없는 문서 자리: {slot}")
        d = self._orig_dir()
        if not d.is_dir():
            return None
        # 자리 표시가 있는 파일과 없는 파일을 섞지 않는다 — `{id}.*` 로 훑으면
        # 비교의 A 를 단일 검토 원본으로 내주게 된다.
        stem = f"{entry_id}--{slot}" if slot else entry_id
        for p in sorted(d.glob(f"{stem}.*")):
            if p.name.endswith(".tmp") or (not slot and "--" in p.stem):
                continue
            try:
                return p.name, p.read_bytes()
            except OSError:
                return None
        return None

    def _delete_original(self, entry_id: str) -> None:
        """결과를 지우면 그 이력의 원본과 변환본을 전부 지운다(비교는 A·B 둘이다)."""
        for d in (self._orig_dir(), self._render_dir()):
            if not d.is_dir():
                continue
            for p in list(d.glob(f"{entry_id}.*")) + list(d.glob(f"{entry_id}--*")):
                p.unlink(missing_ok=True)

    # ---- 변환본 PDF(뷰어용) ----------------------------------------------
    # hwp·hwpx·docx 는 뷰어에 띄우려면 LibreOffice 로 PDF 를 만들어야 하는데,
    # 실측 **7초**가 걸린다. 예전에는 기록을 열 때마다 매번 새로 변환했다 —
    # 원본은 서버에 있는데도 브라우저로 내려보냈다가 도로 올려받아서.
    #
    # 캐시가 시간만 줄이는 게 아니다. 그 검토는 **늘 같은 PDF** 를 보게 되므로
    # 하이라이트 좌표가 고정된다. 서버 폰트가 바뀌어도 예전 검토의 형광펜이
    # 엉뚱한 쪽으로 옮겨가지 않는다.
    def _render_dir(self) -> Path:
        return self.root / "rendered"

    def rendered(self, entry_id: str, slot: str = "", *,
                 cache_key: str | None = None) -> bytes | None:
        """캐시된 변환본. 없으면 None(부르는 쪽이 변환해서 save_rendered 한다)."""
        path = self._render_path(entry_id, slot)
        try:
            data = path.read_bytes()
            if cache_key is not None:
                meta = json.loads(path.with_suffix(".meta").read_text(encoding="utf-8"))
                if (not isinstance(meta, dict) or meta.get("key") != cache_key
                        or meta.get("sha256") != hashlib.sha256(data).hexdigest()):
                    return None
            return data
        except (OSError, ValueError):
            return None

    def save_rendered(self, entry_id: str, data: bytes, *, slot: str = "",
                      cache_key: str | None = None) -> None:
        dest = self._render_path(entry_id, slot)
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_suffix(".pdf.tmp")
        tmp.write_bytes(data)
        os.replace(tmp, dest)
        if cache_key is not None:
            meta = dest.with_suffix(".meta")
            staged = meta.with_suffix(".meta.tmp")
            staged.write_text(json.dumps({"key": cache_key,
                                          "sha256": hashlib.sha256(data).hexdigest()}),
                              encoding="utf-8")
            os.replace(staged, meta)
        self._prune_rendered()

    def _render_path(self, entry_id: str, slot: str) -> Path:
        if not _ID_RE.match(entry_id or ""):
            raise HistoryError(f"올바르지 않은 이력 ID: {entry_id}")
        if slot and slot not in ("A", "B"):
            raise HistoryError(f"알 수 없는 문서 자리: {slot}")
        return self._render_dir() / f"{entry_id}{('--' + slot) if slot else ''}.pdf"

    # 좌표(형광펜 위치)도 같이 캐시한다. locate 는 61쪽에서 인용문을 다 찾느라
    # 실측 **1.48초**가 걸리는데, 저장된 검토는 지적이 안 바뀌니 답도 안 바뀐다.
    #
    # 다만 `이력 id` 만으로 키를 잡으면 안 된다 — 비교 검토는 화면이 추적표 행에서
    # 지적을 **만들어서** 보내므로 같은 이력이라도 자리·탭에 따라 다르다. 그래서
    # 무엇을 물었는지(key)를 함께 저장하고, 다르면 다시 계산한다.
    def marks(self, entry_id: str, slot: str = "") -> dict | None:
        try:
            got = json.loads(self._marks_path(entry_id, slot).read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None
        return got if isinstance(got, dict) else None

    def save_marks(self, entry_id: str, record: dict, *, slot: str = "") -> None:
        dest = self._marks_path(entry_id, slot)
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(record, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, dest)

    def _marks_path(self, entry_id: str, slot: str) -> Path:
        # 변환본과 같은 이름(확장자만 다름)이라 아래 청소가 둘을 함께 다룬다.
        return self._render_path(entry_id, slot).with_suffix(".json")

    def _prune_rendered(self) -> None:
        """원본이 사라진 변환본을 지운다.

        변환본에 따로 상한을 두지 않는 이유: 원본이 있어야 만들 수 있으니
        원본의 상한(개수·용량)이 그대로 천장이 된다. 규칙이 하나면 둘이 어긋날
        일도 없다.
        # ponytail: 변환본은 원본의 절반 크기다(실측 2.1MB → 1016KB). 그래서
        # 디스크는 원본 상한의 약 1.5배까지 쓴다. 좁아지면 그때 따로 건다.
        """
        d = self._render_dir()
        if not d.is_dir():
            return
        orig = self._orig_dir()
        for p in d.iterdir():
            if not p.is_file() or p.name.endswith(".tmp"):
                continue
            if not any(orig.glob(f"{p.stem}.*")):
                p.unlink(missing_ok=True)


def _saved_at(path: Path) -> datetime | None:
    """원본 파일명 앞의 이력 ID 에서 저장 시각을 읽는다. 못 읽으면 None.

    mtime 이 아니라 이름을 쓴다 — 파일을 복사하거나 옮기면 mtime 은 오늘이 되고,
    그러면 보관 기한이 조용히 늘어난다. 이름은 저장할 때 박힌 값이라 안 변한다.

    못 읽으면 **안 지운다.** 날짜를 모르는 파일을 기한으로 지우는 것은 추측이다.
    """
    try:
        return datetime.strptime(path.name[:15], "%Y%m%dT%H%M%S")
    except ValueError:
        return None


def _index_findings(con, review_id: str, payload: dict) -> None:
    """지적을 finding 표에 펼쳐 넣는다. 찾는 데 쓰는 칸만 옮긴다(원본은 payload).

    kind 는 단일 검토의 `kind`, 비교의 `type` 을 같이 받는다 — 둘 다 "무엇이
    잘못됐나"이고 값이 겹치지 않는다.
    """
    rows = []
    for seq, f in enumerate(payload.get("findings") or []):
        if not isinstance(f, dict):
            continue        # 모양이 다른 것 하나 때문에 저장이 실패하면 안 된다
        page = f.get("page")
        rows.append((
            review_id, seq,
            str(f.get("id") or ""), str(f.get("sev") or ""),
            str(f.get("kind") or f.get("type") or ""),
            str(f.get("checker") or ""), str(f.get("section") or ""),
            page if isinstance(page, int) else None,
            str(f.get("document") or ""),
            1 if f.get("unreviewed") else 0,
            str(f.get("message") or ""),
        ))
    if rows:
        con.executemany(
            "INSERT OR REPLACE INTO finding (review_id, seq, finding_id, sev, kind,"
            " checker, section, page, document, unreviewed, message)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?)", rows)


def _record(row) -> dict:
    """표의 한 행을 예전 JSON 파일과 같은 모양으로 되돌린다(화면이 그 모양을 안다)."""
    return {"id": row["id"], "kind": row["kind"], "at": row["at"],
            "title": row["title"], "findings": int(row["findings"]),
            "owner": row["owner"], "payload": json.loads(row["payload"]),
            "summary": json.loads(row["summary"]) if row["summary"] else None}
