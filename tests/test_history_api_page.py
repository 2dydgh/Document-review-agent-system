"""목록 라우트와 세션 범위의 통합. 실제 보관함·AI·업로드 청소는 실행하지 않는다."""
import pytest

pytest.importorskip("fastapi")
from fastapi import HTTPException  # noqa: E402
from starlette.requests import Request  # noqa: E402

from app.auth import SessionStore  # noqa: E402
from app.history import HistoryStore  # noqa: E402
from app.server import create_app  # noqa: E402


@pytest.fixture
def listing(tmp_path, monkeypatch):
    monkeypatch.setattr("app.server._sweep_stale_uploads", lambda: None)
    monkeypatch.setattr("app.parser_bridge.install_trkim_parser", lambda *args: None)
    criteria = tmp_path / "cl.yaml"
    criteria.write_text('doc_type: generic\nid_pattern: "SR-\\\\d+"\n', encoding="utf-8")
    settings = tmp_path / "settings.toml"
    settings.write_text('[llm]\nprovider = "echo"\n[review]\nchecklist = "cl.yaml"\n',
                        encoding="utf-8")
    app = create_app(settings=settings, history_dir=tmp_path / "history",
                     frontend_dir=tmp_path / "static")
    route = next(r for r in app.routes if r.path == "/api/history")
    return route.endpoint, HistoryStore(tmp_path / "history"), SessionStore(tmp_path)


def request(token=""):
    return Request({"type": "http", "headers": [(b"cookie", f"dr_session={token}".encode())]})


def test_history_route_applies_session_to_entries_and_counts(listing):
    endpoint, store, sessions = listing
    for owner in ("", "me@example.test", "other@example.test"):
        store.save("review", {"doc": {"name": "요건.hwpx"}, "findings": [{"sev": "info"}]},
                   owner=owner)
    own = endpoint(request(sessions.issue("me@example.test")), q="요건", kind="review")
    assert own["available_total"] == own["total"] == own["kind_counts"]["review"] == 2
    assert len(own["entries"]) == 2
    assert own["entries"][0]["summary"]["issues"] == 0
    assert own["entries"][0]["summary"]["info"] == 1
    for token in ("", "invalid"):
        assert endpoint(request(token))["total"] == 1


def test_history_route_pages_and_limits(listing):
    endpoint, store, _ = listing
    for i in range(23):
        store.save("review", {"doc": {"name": f"문서{i}.pdf"}, "findings": []})
    first = endpoint(request())
    second = endpoint(request(), offset=20)
    assert len(first["entries"]) == 20
    assert len(second["entries"]) == 3
    assert first["total"] == second["total"] == 23
    assert endpoint(request(), limit=200)["limit"] == 100
    assert endpoint(request(), limit=0)["limit"] == 1


@pytest.mark.parametrize("params", [{"q": "가" * 201}, {"kind": "unknown"}])
def test_history_route_rejects_invalid_query(listing, params):
    endpoint, _, _ = listing
    with pytest.raises(HTTPException) as exc:
        endpoint(request(), **params)
    assert exc.value.status_code == 400


def test_history_route_shares_records_within_team_and_names_reviewer(listing, tmp_path):
    """기록은 같은 팀끼리 공유(2026-09-09). 관리자는 전부. 행마다 검토자 이름."""
    from app.auth import AccountStore
    endpoint, store, sessions = listing
    accounts = AccountStore(tmp_path)
    accounts.create("kim@x.io", "password1", name="김검토", team="AX품질")
    accounts.create("lee@x.io", "password1", name="", team="AX품질")
    accounts.create("park@x.io", "password1", name="박다른", team="다른팀")
    accounts.create("root@x.io", "password1", name="관리자")
    accounts.set_role("root@x.io", "admin")
    for owner in ("", "kim@x.io", "lee@x.io", "park@x.io"):
        store.save("review", {"doc": {"name": f"{owner or 'nobody'}.hwpx"}}, owner=owner)

    mine = endpoint(request(sessions.issue("kim@x.io")))
    assert mine["total"] == 3
    assert {e["by"] for e in mine["entries"]} == {"김검토", "lee@x.io", ""}
    assert endpoint(request(sessions.issue("park@x.io")))["total"] == 2
    assert endpoint(request(sessions.issue("root@x.io")))["total"] == 4
    assert endpoint(request(""))["total"] == 1
