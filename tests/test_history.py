import json
from datetime import datetime, timedelta

import pytest

from app.history import HistoryError, HistoryStore


def _compare_payload(a="srs.hwpx", b="sdd.hwpx", findings=3):
    return {
        "docA": {"name": a, "type": "HWPX"},
        "docB": {"name": b, "type": "HWPX"},
        "stats": {"requirements": 12, "matched": 9, "missing": 3},
        "findings": [{"id": i, "msg": f"f{i}"} for i in range(findings)],
        "stages": [],
    }


@pytest.fixture
def store(tmp_path):
    return HistoryStore(tmp_path / "history")


def test_save_then_get_returns_the_whole_result(store):
    """목록에서 클릭하면 그때 그 결과가 그대로 복원돼야 한다."""
    payload = _compare_payload()
    entry = store.save("compare", payload)
    assert store.get(entry.id)["payload"] == payload


def test_save_creates_the_directory(tmp_path):
    store = HistoryStore(tmp_path / "nope" / "history")
    store.save("review", {"doc": {"name": "a.md"}, "findings": []})
    assert store.list()


def test_summary_titles_both_kinds(store):
    store.save("compare", _compare_payload("A.hwpx", "B.hwpx", findings=3))
    store.save("review", {"doc": {"name": "solo.md"}, "findings": [{"id": 1}]})
    titles = {e.title: e.findings for e in store.list()}
    assert titles == {"A.hwpx ↔ B.hwpx": 3, "solo.md": 1}


def test_list_is_newest_first(store):
    for i in range(3):
        store.save("compare", _compare_payload(a=f"{i}.hwpx"),
                   now=datetime(2026, 7, 13, 10, i))
    assert [e.title.split(" ")[0] for e in store.list()] == ["2.hwpx", "1.hwpx", "0.hwpx"]


def test_list_respects_limit(store):
    for i in range(5):
        store.save("review", {"doc": {"name": f"{i}.md"}, "findings": []})
    assert len(store.list(limit=2)) == 2


def test_list_on_empty_store_is_empty_not_an_error(store):
    assert store.list() == []


@pytest.mark.parametrize("kind", ["review", "compare", "case"])
def test_summary_separates_issues_unreviewed_and_process_reports(store, kind):
    payload = {"findings": [{"sev": "major"}, {"sev": "minor"}, {"sev": "info"},
                            {"sev": "info", "unreviewed": True}]}
    entry = store.save(kind, payload)
    assert entry.findings == 2
    assert entry.summary == {"issues": 2, "unreviewed": 1, "info": 1, "pending": 0, "unfound": 0,
                             "documents": 0, "unjudged": 0}
    assert store.list()[0].summary == entry.summary
    assert store.get(entry.id)["payload"] == payload


def test_checklist_pending_is_not_an_issue_count(store):
    entry = store.save("checklist", {"document_name": "test.pdf", "unjudged": 4})
    assert entry.summary["issues"] == 0
    assert entry.summary["unjudged"] == 4
    record = store.update_payload(entry.id, {"unjudged": 0})
    assert record["summary"]["unjudged"] == 0
    assert store.list()[0].findings == 0


def test_compare_pending_counts_rows_without_a_verdict(store):
    """홈 "할 일"의 "요건 N개 미판정" — 판정 없는 요건 행만, 범위 밖 행은 빼고 센다."""
    payload = _compare_payload()
    payload["rtm"] = [
        {"upper_id": "RQ-01", "lower_ids": [], "status": "missing"},
        {"upper_id": "RQ-02", "lower_ids": ["DS-02"], "status": "linked"},
        {"upper_id": "", "lower_ids": ["DS-09"], "status": "orphan"},
        {"upper_id": "RQ-99", "lower_ids": [], "status": "out_of_scope"},
    ]
    payload["rtmVerdicts"] = {"RQ-02": {"verdict": "만족함"}, "DS-09": {"note": "메모만"}}
    entry = store.save("compare", payload)
    assert entry.summary["pending"] == 2          # RQ-01 · DS-09(판정 없이 메모만)
    assert store.save("review", {"doc": {"name": "a.pdf"}, "findings": []}).summary["pending"] == 0


def test_evaluation_unfound_is_not_an_issue_count(store):
    entry = store.save("evaluation", {"doc": {"name": "srs.md"}, "unfound": 2})
    assert entry.summary["issues"] == 0
    assert entry.summary["unfound"] == 2
    assert entry.findings == 2
    assert entry.title == "srs.md"


def test_evaluation_unreviewed_is_counted_apart_from_unfound(store):
    """"근거를 못 찾았다"와 "검토를 못 했다"를 한 수에 섞지 않는다 — 목록이
    "근거 없음 0건"이라고 말하면 검토자는 다 봤다고 읽는다."""
    entry = store.save("evaluation",
                       {"doc": {"name": "srs.md"}, "unfound": 0, "documents": 0, "unreviewed": 3})
    assert entry.summary["unfound"] == 0
    assert entry.summary["unreviewed"] == 3
    assert entry.summary["issues"] == 0
    assert store.list()[0].summary["unreviewed"] == 3


def test_existing_sqlite_summary_is_backfilled_without_modifying_payload(store):
    from app import db
    payload = {"doc": {"name": "old.pdf"}, "findings": [{"sev": "info", "unreviewed": True}]}
    entry = store.save("review", payload)
    with db.connect(store._db) as con:
        original = con.execute("SELECT payload FROM review WHERE id=?", (entry.id,)).fetchone()[0]
        con.execute("UPDATE review SET summary=NULL, findings=99 WHERE id=?", (entry.id,))
    reopened = HistoryStore(store.root)
    assert reopened.list()[0].findings == 0
    assert reopened.list()[0].summary["unreviewed"] == 1
    with db.connect(store._db) as con:
        saved = con.execute("SELECT payload FROM review WHERE id=?", (entry.id,)).fetchone()[0]
        assert saved == original


def test_migration_handles_database_without_new_columns(tmp_path):
    import sqlite3
    root = tmp_path / "legacy"
    root.mkdir()
    with sqlite3.connect(root / "index.db") as con:
        con.execute("CREATE TABLE review(id TEXT PRIMARY KEY, kind TEXT, at TEXT, title TEXT,"
                    " owner TEXT, findings INTEGER, payload TEXT)")
        con.execute("INSERT INTO review VALUES(?,?,?,?,?,?,?)",
                    ("20260713T100000000000-aaaaaaaa", "review", "", "옛 문서", "", 1,
                     json.dumps({"findings": [{"sev": "info"}]})))
    migrated = HistoryStore(root)
    assert migrated.list()[0].summary["info"] == 1
    assert migrated.page(q="옛")["total"] == 1
    assert HistoryStore(root).list()[0].findings == 0


def test_search_reaches_records_beyond_first_hundred(store):
    for i in range(125):
        store.save("review", {"doc": {"name": f"문서-{i:03}.pdf"}, "findings": []},
                   now=datetime(2026, 7, 13, microsecond=i))
    result = store.page(q="문서-000", limit=20)
    assert result["total"] == 1 and result["available_total"] == 125
    assert result["entries"][0]["title"] == "문서-000.pdf"
    pages = [store.page(offset=i)["entries"] for i in range(0, 125, 20)]
    ids = [row["id"] for page in pages for row in page]
    assert len(ids) == len(set(ids)) == 125


def test_search_is_unicode_case_insensitive_literal_and_all_words(store):
    import unicodedata
    store.save("review", {"doc": {"name": "요건 100%_Done.HWPX"}})
    store.save("review", {"doc": {"name": "요건 100xxDone.HWPX"}})
    assert store.page(q=unicodedata.normalize("NFD", "요건") + " done hwpx")["total"] == 2
    assert store.page(q="%_")["total"] == 1
    assert store.page(q="' OR 1=1 --")["total"] == 0


def test_owner_scope_applies_to_search_results_and_all_counts(store):
    for kind, owner in [("review", "me"), ("compare", "other"), ("case", "")]:
        store.save(kind, {"doc": {"name": "match"}, "caseId": "match"}, owner=owner)
    result = store.page(q="match", owners=["me"])
    assert result["available_total"] == result["total"] == 2
    assert result["kind_counts"] == {"review": 1, "case": 1, "": 2}
    assert [e["owner"] for e in result["entries"]] == ["", "me"]
    assert store.page(q="match", kind="compare", owners=["me"])["total"] == 0
    assert store.page(owners=[])["total"] == 1
    # 같은 팀 = 소유자 여럿. 목록·검색 둘 다 같은 필터.
    assert store.page(owners=["me", "other"])["total"] == 3
    assert [e.owner for e in store.list(owners=["me", "other"])] == ["", "other", "me"]


def test_deleting_last_page_record_returns_last_valid_page(store):
    for i in range(21):
        store.save("review", {"doc": {"name": str(i)}})
    last = store.page(offset=20)
    store.delete(last["entries"][0]["id"])
    result = store.page(offset=20)
    assert result["offset"] == 0 and result["total"] == 20
    assert len(result["entries"]) == 20
    assert store.page(q="no result", offset=999)["offset"] == 0
    with pytest.raises(HistoryError):
        store.page(kind="invalid")


def test_same_second_saves_do_not_collide(store):
    """같은 초에 두 건이 들어와도 덮어쓰면 안 된다."""
    now = datetime(2026, 7, 13, 10, 0, 0)
    a = store.save("review", {"doc": {"name": "a.md"}, "findings": []}, now=now)
    b = store.save("review", {"doc": {"name": "b.md"}, "findings": []}, now=now)
    assert a.id != b.id
    assert len(store.list()) == 2


def test_same_second_saves_keep_their_order(store):
    """실제로 겪은 버그: 비교와 단일 검토를 같은 초에 저장했더니 목록에서 순서가
    뒤집혔다. ID의 시각이 초 단위라, 같은 초 안에서는 뒤의 무작위 해시로 정렬됐다.
    """
    for i in range(6):
        store.save("review", {"doc": {"name": f"{i}.md"}, "findings": []},
                   now=datetime(2026, 7, 13, 10, 0, 0, microsecond=i))
    assert [e.title for e in store.list()] == ["5.md", "4.md", "3.md",
                                               "2.md", "1.md", "0.md"]


def test_delete_removes_only_that_entry(store):
    a = store.save("review", {"doc": {"name": "a.md"}, "findings": []})
    b = store.save("review", {"doc": {"name": "b.md"}, "findings": []})
    store.delete(a.id)
    assert [e.id for e in store.list()] == [b.id]
    with pytest.raises(HistoryError):
        store.get(a.id)


@pytest.mark.parametrize("bad", [
    "../../../etc/passwd",
    "../settings",
    "..%2F..%2Fsecret",
    "20260713T100000000000-deadbeef/../../x",
    "",
    "not-an-id",
])
def test_malicious_ids_are_refused_not_resolved(store, tmp_path, bad):
    """ID는 파일 이름이 된다. 그대로 갖다 붙이면 아무 파일이나 읽거나 지울 수 있다."""
    (tmp_path / "secret.json").write_text('{"x": 1}', encoding="utf-8")
    with pytest.raises(HistoryError):
        store.get(bad)
    with pytest.raises(HistoryError):
        store.delete(bad)
    assert (tmp_path / "secret.json").is_file()


def test_stray_json_file_is_not_listed(store):
    """예전 형식(JSON 파일)이 디렉터리에 남아 있어도 목록은 표만 본다.

    이사 뒤에도 원본 JSON 을 지우지 않기 때문에(되돌릴 자리), 그 파일들이
    목록에 두 번 나오거나 깨진 파일이 목록을 죽이면 안 된다.
    """
    good = store.save("review", {"doc": {"name": "good.md"}, "findings": []})
    (store.root / "20260713T100000000000-badbadba.json").write_text("{ truncated",
                                                              encoding="utf-8")
    assert [e.id for e in store.list()] == [good.id]


def test_old_entries_are_pruned(tmp_path):
    store = HistoryStore(tmp_path / "h", max_entries=3)
    for i in range(5):
        store.save("review", {"doc": {"name": f"{i}.md"}, "findings": []},
                   now=datetime(2026, 7, 13, 10, i))
    assert [e.title for e in store.list()] == ["4.md", "3.md", "2.md"]
    assert len(store.list(limit=99)) == 3          # 넘긴 것은 표에서도 지워졌다


def test_no_partial_file_is_left_behind(store):
    store.save("review", {"doc": {"name": "a.md"}, "findings": []})
    assert not list(store.root.glob("*.tmp"))


def test_unknown_kind_is_refused(store):
    with pytest.raises(HistoryError):
        store.save("nonsense", {})


def test_record_is_readable_json_in_db(store):
    """저장된 payload 를 사람이 열어볼 수 있어야 한다 — 한글이 \\uXXXX로 깨지지 않게.

    sqlite3 로 열어 눈으로 확인하는 일이 실제로 있다(장애 조사). ensure_ascii
    기본값으로 쓰면 그때 한 글자도 못 읽는다.
    """
    from app import db
    entry = store.save("compare", _compare_payload("요구사항.hwpx", "설계.hwpx"))
    with db.connect(store.root / "index.db") as con:
        row = con.execute("SELECT title, payload FROM review WHERE id=?",
                          (entry.id,)).fetchone()
    assert "요구사항.hwpx" in row["payload"]
    assert row["title"] == "요구사항.hwpx ↔ 설계.hwpx"
    assert json.loads(row["payload"])["docA"]["name"] == "요구사항.hwpx"


def test_originals_prune_by_bytes(tmp_path):
    """보관 한도는 용량 하나다 — 개수 상한은 폐지했다(2026-09-08).

    개수는 문서 크기를 모르는 잣대라, 디스크가 10%도 안 찬 채 원문만 사라졌다.
    """
    store = HistoryStore(tmp_path / "h")
    big = b"x" * 4096
    ids = []
    for i in range(5):
        entry = store.save("review", {"doc": {"name": f"d{i}.pdf"}})
        ids.append(entry.id)
        # 3개 분량만 허용.
        store.save_original(entry.id, "d.pdf", big)
        store._prune_originals(max_bytes=len(big) * 3)

    kept = [i for i in ids if store.original(i) is not None]
    assert len(kept) == 3, kept
    # 남는 것은 **최신** 셋이다. 오래된 것부터 지운다.
    assert kept == ids[-3:]


def test_originals_expire_after_the_retention_window(tmp_path):
    """보관 기한(30일)이 지난 원본은 용량이 남아도 사라진다.

    용량 상한은 디스크를 지키는 것이고 기한은 "고객 문서를 필요 이상 들고 있지
    않는다"는 약속이라 목적이 다르다. 기한은 첫 파일도 봐주지 않는다 — 하나뿐
    이어도 지나면 지운다.
    """
    store = HistoryStore(tmp_path / "h")
    entry = store.save("review", {"doc": {"name": "old.pdf"}})
    store.save_original(entry.id, "old.pdf", b"x")
    assert store.original(entry.id) is not None

    # 파일 이름 앞의 이력 ID 가 저장 시각이다(mtime 이 아니다 — 복사하면 늘어난다).
    old_id = (datetime.now() - timedelta(days=31)).strftime("%Y%m%dT%H%M%S000000")
    old_id += "-" + entry.id.split("-")[1]
    d = store.root / "originals"
    next(d.glob(f"{entry.id}.*")).rename(d / f"{old_id}.pdf")

    store._prune_originals()
    assert list(d.glob("*.pdf")) == [], "기한이 지난 원본이 남았다"


def test_undatable_original_is_not_expired(tmp_path):
    """날짜를 못 읽는 파일을 기한으로 지우는 것은 추측이다."""
    store = HistoryStore(tmp_path / "h")
    d = store.root / "originals"
    d.mkdir(parents=True, exist_ok=True)
    stray = d / "unknown.pdf"
    stray.write_bytes(b"x")
    store._prune_originals()
    assert stray.exists()


def test_newest_original_survives_even_if_over_the_cap(tmp_path):
    """방금 저장한 것을 바로 지우면 '저장했다'고 말하고 없는 셈이 된다."""
    store = HistoryStore(tmp_path / "h")
    entry = store.save("review", {"doc": {"name": "big.pdf"}})
    store.save_original(entry.id, "big.pdf", b"y" * 8192)
    store._prune_originals(max_bytes=10)   # 한도보다 큰 파일 하나
    assert store.original(entry.id) is not None


def test_compare_originals_are_kept_per_slot(tmp_path):
    """비교는 문서가 둘이라 자리(A·B)로 나눠 보관한다.

    오래 원본을 안 남겨서, 기록에서 다시 연 비교는 원문 보기가 아예 안 됐다.
    """
    store = HistoryStore(tmp_path / "h")
    entry = store.save("compare", {"docA": {"name": "srs.pdf"}})
    store.save_original(entry.id, "srs.pdf", b"AAA", slot="A")
    store.save_original(entry.id, "sdd.pdf", b"BBB", slot="B")

    assert store.original(entry.id, "A")[1] == b"AAA"
    assert store.original(entry.id, "B")[1] == b"BBB"
    # 자리 없는 조회는 단일 검토의 것이다 — 비교의 A 를 내주면 안 된다.
    assert store.original(entry.id) is None
    # 결과를 지우면 두 원본이 함께 사라진다.
    store.delete(entry.id)
    assert store.original(entry.id, "A") is None
    assert store.original(entry.id, "B") is None


def test_unknown_slot_is_rejected(tmp_path):
    store = HistoryStore(tmp_path / "h")
    entry = store.save("compare", {})
    with pytest.raises(HistoryError):
        store.save_original(entry.id, "x.pdf", b"x", slot="Z")
    with pytest.raises(HistoryError):
        store.original(entry.id, "Z")


def test_예전_JSON_이력을_읽어_옮긴다(tmp_path):
    """파일로 쓰던 검토 이력이 업그레이드 후에도 목록·조회에 그대로 나와야 한다."""
    root = tmp_path / "h"
    root.mkdir(parents=True)
    (root / "20260713T100000000000-aaaaaaaa.json").write_text(json.dumps({
        "id": "20260713T100000000000-aaaaaaaa", "kind": "review",
        "at": "2026-07-13T10:00:00", "title": "옛날.md", "findings": 2,
        "owner": "kim@x.io",
        "payload": {"doc": {"name": "옛날.md"}, "findings": [{"a": 1}, {"b": 2}]},
    }, ensure_ascii=False), encoding="utf-8")
    (root / "20260713T100001000000-bbbbbbbb.json").write_text("{ truncated",
                                                              encoding="utf-8")

    store = HistoryStore(root)
    assert [e.title for e in store.list()] == ["옛날.md"]   # 깨진 것은 건너뛴다
    assert store.get("20260713T100000000000-aaaaaaaa")["payload"]["doc"]["name"] \
        == "옛날.md"
    assert [e.title for e in store.list(owners=["kim@x.io"])] == ["옛날.md"]
    # 옮긴 뒤에도 JSON 은 남긴다 — 되돌릴 자리.
    assert (root / "20260713T100000000000-aaaaaaaa.json").is_file()


# ── 지적을 행으로도 남긴다(finding 표) ──────────────────────────────────────

def _findings(*sevs):
    return {"doc": {"name": "a.md"},
            "findings": [{"id": f"f{i}", "sev": s, "checker": "consistency",
                          "kind": "표기", "section": "3.1", "page": i,
                          "message": f"지적{i}", "unreviewed": s == "info"}
                         for i, s in enumerate(sevs)]}


def _rows(store, sql, args=()):
    from app import db
    with db.connect(store.root / "index.db") as con:
        return con.execute(sql, args).fetchall()


def test_지적이_행으로_펼쳐져_SQL_로_집계된다(store):
    """payload 한 칸에 JSON 으로 있으면 SQL 이 세지도 찾지도 못한다."""
    store.save("review", _findings("major", "minor", "major", "info"))
    got = {r["sev"]: r["n"] for r in
           _rows(store, "SELECT sev, COUNT(*) n FROM finding GROUP BY sev")}
    assert got == {"major": 2, "minor": 1, "info": 1}
    # 검사기별·미검토도 같은 표에서 나온다.
    assert _rows(store, "SELECT COUNT(*) n FROM finding WHERE checker='consistency'"
                 )[0]["n"] == 4
    assert _rows(store, "SELECT COUNT(*) n FROM finding WHERE unreviewed=1")[0]["n"] == 1
    # seq 로 payload 원본을 되짚어 갈 수 있어야 한다.
    row = _rows(store, "SELECT review_id, seq FROM finding WHERE sev='minor'")[0]
    payload = store.get(row["review_id"])["payload"]
    assert payload["findings"][row["seq"]]["sev"] == "minor"


def test_비교의_type_도_같은_kind_칸에_들어간다(store):
    """단일은 kind(표기·모순), 비교는 type(missing·extra) — 둘 다 '무엇이 잘못됐나'다."""
    store.save("compare", {"docA": {"name": "a"}, "docB": {"name": "b"},
                           "findings": [{"id": "f0", "sev": "major", "type": "missing"},
                                        {"id": "f1", "sev": "info", "type": "extra"}]})
    assert sorted(r["kind"] for r in _rows(store, "SELECT kind FROM finding")) \
        == ["extra", "missing"]


def test_이력을_지우면_지적_행도_함께_사라진다(store):
    """외래키 CASCADE. 안 켜면 SQLite 가 조용히 무시해서 고아 행이 쌓인다."""
    entry = store.save("review", _findings("major", "minor"))
    assert len(_rows(store, "SELECT 1 FROM finding")) == 2
    store.delete(entry.id)
    assert _rows(store, "SELECT 1 FROM finding") == []


def test_상한을_넘겨_밀려난_이력의_지적도_사라진다(tmp_path):
    store = HistoryStore(tmp_path / "h", max_entries=2)
    for _ in range(3):
        store.save("review", _findings("major"))
    assert len(_rows(store, "SELECT 1 FROM review")) == 2
    assert len(_rows(store, "SELECT 1 FROM finding")) == 2      # 고아가 안 남는다


def test_payload_를_고치면_지적_행도_다시_쓰인다(store):
    """놔두면 집계는 옛 지적을 세고 화면은 새 지적을 보여준다."""
    entry = store.save("review", _findings("major", "major"))
    store.update_payload(entry.id, {"findings": [{"id": "f0", "sev": "info"}]},
                         refresh_summary=True)
    assert [(r["sev"], r["seq"]) for r in
            _rows(store, "SELECT sev, seq FROM finding ORDER BY seq")] == [("info", 0)]


def test_이미_저장된_이력의_지적도_열_때_펼쳐진다(tmp_path):
    """지적 행은 payload 보다 나중에 생겼다 — 옛 기록도 집계에 잡혀야 한다."""
    from app import db
    root = tmp_path / "h"
    store = HistoryStore(root)
    entry = store.save("review", _findings("major", "minor"))
    with db.connect(root / "index.db") as con:      # 행만 지우고 payload 는 둔다
        con.execute("DELETE FROM finding")

    reopened = HistoryStore(root)                    # 여기서 backfill 이 돈다
    assert [r["sev"] for r in
            _rows(reopened, "SELECT sev FROM finding WHERE review_id=? ORDER BY seq",
                  (entry.id,))] == ["major", "minor"]


def test_남의_DB_표가_비어_있으면_치운다(tmp_path):
    """예전에 스키마를 한 덩어리로 실행해 이력 DB 에도 계정 표가 생겼다.

    비어 있어 동작엔 영향이 없지만, 계정 표가 두 군데 있는 것처럼 보여
    나중에 누가 빈 쪽을 열고 "계정이 없다"고 판단한다.
    """
    from app import db
    root = tmp_path / "h"
    HistoryStore(root)
    path = root / "index.db"
    with db.connect(path) as con:
        con.executescript(db.AUTH_SCHEMA)            # 옛 상태를 만든다
    assert _tables(path) >= {"account", "session", "review", "finding"}

    HistoryStore(root)                               # 다시 열면 치워진다
    assert _tables(path) == {"review", "finding"}


def test_행이_있는_표는_치우지_않는다(tmp_path):
    """청소가 데이터를 지우면 안 된다 — 그때는 사람이 봐야 하는 상황이다."""
    from app import db
    root = tmp_path / "h"
    HistoryStore(root)
    path = root / "index.db"
    with db.connect(path) as con:
        con.executescript(db.AUTH_SCHEMA)
        con.execute("INSERT INTO account (email, salt, hash) VALUES ('a@b.io','s','h')")

    HistoryStore(root)
    assert "account" in _tables(path)


def _tables(path):
    from app import db
    with db.connect(path) as con:
        return {r[0] for r in
                con.execute("SELECT name FROM sqlite_master WHERE type='table'")}


def test_case_summary_carries_document_count_for_the_list_badge(tmp_path) -> None:
    """폴더 검토 목록 글리프의 건수 배지 — 요약에 문서 수가 있어야 목록이 그린다(2026-09-17)."""
    store = HistoryStore(tmp_path)
    entry = store.save("case", {"caseId": "SST-1",
                                "outputs": [{"name": "a.pdf"}, {"name": "b.pdf"}],
                                "findings": []})
    assert entry.summary["documents"] == 2
    single = store.save("review", {"doc": {"name": "x.pdf"}, "findings": []})
    assert single.summary["documents"] == 0


def test_old_case_summary_gains_document_count_on_next_open(tmp_path) -> None:
    """documents 가 생기기 전 저장된 폴더 검토 요약은 다음 열기에서 payload 로 다시 센다 —
    안 그러면 옛 기록의 목록 배지만 영영 비어 있다(2026-09-17)."""
    store = HistoryStore(tmp_path)
    outputs = [{"name": "a"}, {"name": "b"}, {"name": "c"}]
    entry = store.save("case", {"caseId": "SST-2", "outputs": outputs, "findings": []})
    import sqlite3
    con = sqlite3.connect(tmp_path / "index.db")
    old_summary = '{"issues": 0, "unreviewed": 0, "info": 0, "unfound": 0, "unjudged": 0}'
    con.execute("UPDATE review SET summary=? WHERE id=?", (old_summary, entry.id))
    con.commit()
    con.close()
    reopened = HistoryStore(tmp_path)
    assert reopened.list()[0].summary["documents"] == 3
