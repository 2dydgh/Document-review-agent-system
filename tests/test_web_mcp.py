"""DoSuree 가 검토 결과를 도구로 읽는 /mcp — 설계 §9.

토큰이 관문이고 범위는 웹과 같다(같은 팀 + 소유자 없는 기록, 관리자는 전부).
쓰기 도구는 없다. 지적과 미검토는 갈라서 낸다.
"""
from __future__ import annotations

import json

import pytest

fastapi = pytest.importorskip("fastapi")
from fastapi.testclient import TestClient  # noqa: E402

from app.auth import AccountStore, SessionStore  # noqa: E402
from app.history import HistoryStore  # noqa: E402
from app.mcp import TOOLS  # noqa: E402
from app.server import create_app  # noqa: E402

DESIGN_TOOLS = {"list_reviews": {"q", "kind", "limit"},
                "get_review": {"id"},
                "search_findings": {"q", "kind", "checker", "sev", "since", "limit"},
                "find_in_document": {"id", "term", "slot"},
                "list_sections": {"id", "slot"},
                "read_section": {"id", "section_id", "slot", "offset"}}


@pytest.fixture
def world(tmp_path):
    settings = tmp_path / "settings.toml"
    settings.write_text('[llm]\nprovider = "echo"\n', encoding="utf-8")
    static = tmp_path / "frontend"
    static.mkdir()
    (static / "index.html").write_text("<html>ui</html>", encoding="utf-8")
    client = TestClient(create_app(settings=settings, frontend_dir=static,
                                   history_dir=tmp_path / "history"))
    accounts = AccountStore(tmp_path)
    for email, team in (("kim@x.io", "AX품질"), ("lee@x.io", "AX품질"),
                        ("park@x.io", "다른팀"), ("root@x.io", "")):
        accounts.create(email, "password1", name=email.split("@")[0], team=team)
    accounts.set_role("root@x.io", "admin")
    sessions = SessionStore(tmp_path)
    history = HistoryStore(tmp_path / "history")
    payload = {
        "doc": {"name": "명세서.hwpx"},
        "sections": [
            {"id": "1", "title": "개요", "level": 1, "page": 1, "text": "이 문서는 개요다."},
            {"id": "3.1", "title": "접근 제어", "level": 2, "page": 4,
             "text": "비인가 접근 시 계정을 잠근다.\n5회 실패하면 30분간 차단한다."},
        ],
        "findings": [
            {"id": "f1", "checker": "consistency", "sev": "minor", "kind": "모호",
             "section": "3.1", "page": 4, "message": "'잠근다'의 조건이 없다.",
             "evidence": [{"quote": "비인가 접근 시 계정을 잠근다.", "section": "3.1"}],
             "rescue_trace": {"big": "x"}},
            {"id": "f2", "checker": "completeness", "sev": "info", "unreviewed": True,
             "message": "약어 목록을 읽지 못했습니다."},
        ],
    }
    mine = history.save("review", payload, owner="kim@x.io")
    theirs = history.save("review", {**payload, "doc": {"name": "남의문서.hwpx"}},
                          owner="park@x.io")
    # 비교 검토 하나 — 요건 행·AI 가 찾은 자리·검토자 판정까지 도구가 주는지 본다.
    compare = history.save("compare", {
        "docA": {"name": "요구사항.hwp"}, "docB": {"name": "설계서.hwp"},
        "findings": [{"id": "c1", "type": "missing", "sev": "major", "requirement_id": "RQ-01",
                      "message": "하위문서에 누락된 ID: RQ-01"}],
        "rtm": [{"upper_id": "RQ-01", "lower_ids": [], "status": "missing",
                 "section_title": "인터페이스", "page": 3, "text": "| 제목 | 성능 로그 전달 |"},
                {"upper_id": "RQ-02", "lower_ids": ["DS-02"], "status": "linked",
                 "section_title": "성능", "page": 4, "text": "응답 2초",
                 "child_section_title": "설계 목록", "child_page": 9,
                 "child_text": "응답 2초 이내 설계"}],
        "rtmVerdicts": {"RQ-02": {"verdict": "만족함", "note": "확인"}},
        "rtmSearches": {"RQ-01": {"verdict": "설계있음", "section": "로그 설계", "page": 12,
                                  "quote": "성능 로그를 전달한다", "reason": ""}},
        "rtm_lineage": {"id": "20260901T000000000000-prior00", "title": "요구사항.hwp ↔ 설계서.hwp",
                        "at": "2026-09-01T00:00:00", "by": "kim@x.io"},
    }, owner="kim@x.io")
    client.compare_id = compare.id
    # 체크리스트 검토(부록 B 초안) 하나 — 항목 원문과 초안 행이 ID 로 붙어 오는지 본다.
    draft = history.save("evaluation", {
        "doc": {"name": "설계서.pdf"}, "sections": payload["sections"],
        "checklist_name": "IS22_평가체크리스트.xlsx", "sheet": "C-IS22", "document_kind": "SDS",
        "items": [{"id": "C-01", "item": "Access control shall lock the account.",
                   "item_ko": "접근 제어", "characteristic": "Security"},
                  {"id": "C-02", "item": "Audit log retention.", "item_ko": "감사 로그"}],
        "rows": [{"item_id": "C-01", "status": "drafted", "verdict_hint": "만족",
                  "comment": "5회 실패 시 잠근다.", "sections": ["3.1 접근 제어"],
                  "quotes": [{"quote": "비인가 접근 시 계정을 잠근다.", "page": 4,
                              "section": "3.1"}],
                  "reason": "", "words": ["잠금"]},
                 {"item_id": "C-02", "status": "not_found", "verdict_hint": "",
                  "comment": "",
                  "sections": [], "quotes": [], "reason": "감사 로그 언급 없음",
                  "words": ["감사"]}],
        "unfound": 1, "llm_failures": 0, "unreviewed": 0, "notes": [],
    }, owner="kim@x.io")
    client.draft_id = draft.id
    return client, sessions, mine.id, theirs.id


def rpc(client, token, method, params=None, rid=1):
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    body = {"jsonrpc": "2.0", "id": rid, "method": method, "params": params or {}}
    return client.post("/mcp", json=body, headers=headers)


def call(client, token, name, **args):
    r = rpc(client, token, "tools/call", {"name": name, "arguments": args})
    assert r.status_code == 200, r.text
    result = r.json()["result"]
    text = result["content"][0]["text"]
    try:
        return result["isError"], json.loads(text)
    except json.JSONDecodeError:      # 도구 결과가 JSON 이 아닌 본문 텍스트일 때
        return result["isError"], text


def test_토큰_없으면_401_이고_GET_은_405다(world):
    client, sessions, mine, _ = world
    assert rpc(client, "", "initialize").status_code == 401
    assert rpc(client, "invalid", "tools/list").status_code == 401
    assert client.get("/mcp").status_code == 405


def test_initialize_와_tools_list_가_설계_표와_같다(world):
    client, sessions, *_ = world
    token = sessions.issue("kim@x.io")
    init = rpc(client, token, "initialize", {"protocolVersion": "2025-03-26"}).json()["result"]
    assert init["protocolVersion"] == "2025-03-26"
    assert init["capabilities"] == {"tools": {}}
    assert rpc(client, token, "notifications/initialized", rid=None).status_code == 202
    tools = rpc(client, token, "tools/list").json()["result"]["tools"]
    assert {t["name"]: set(t["inputSchema"]["properties"]) for t in tools} == DESIGN_TOOLS
    assert tools == TOOLS


def test_같은_팀만_보이고_관리자는_전부_본다(world):
    client, sessions, mine, theirs = world
    kim, lee, park, root = (sessions.issue(e) for e in
                            ("kim@x.io", "lee@x.io", "park@x.io", "root@x.io"))
    # kim 의 기록 셋(단일 + 비교 + 초안) — 같은 팀 lee 에게 다 보이고 park 에겐 제 것 하나뿐.
    assert [e["by"] for e in call(client, lee, "list_reviews")[1]["entries"]] == ["kim"] * 3
    assert call(client, park, "list_reviews")[1]["total"] == 1
    assert call(client, root, "list_reviews")[1]["total"] == 4
    # 남의 기록은 "없는 기록"과 같은 말로 막는다.
    err, text = call(client, park, "get_review", id=mine)
    assert err and text == "볼 수 없는 검토입니다."
    err2, text2 = call(client, kim, "get_review", id="20260101T000000000000-deadbeef")
    assert err2 and text2 == text


def test_get_review_는_지적과_미검토를_가른다(world):
    client, sessions, mine, _ = world
    err, view = call(client, sessions.issue("lee@x.io"), "get_review", id=mine)
    assert not err
    assert view["by"] == "kim" and view["title"] == "명세서.hwpx"
    assert [f["id"] for f in view["findings"]] == ["f1"]
    assert view["findings"][0]["severity"] == "지적"          # 화면 말. sev=minor 는 내부값
    assert "sev" not in view["findings"][0], "내부값이 새면 모델이 major/minor 로 말한다"
    assert view["counts"] == {"지적": 1, "미검토": 1}
    assert [f["id"] for f in view["unreviewed"]] == ["f2"]
    assert "rescue_trace" not in view["findings"][0]
    assert view["findings"][0]["evidence"][0]["quote"] == "비인가 접근 시 계정을 잠근다."


def test_문서_검색과_절_읽기는_저장된_본문으로_답한다(world):
    client, sessions, mine, _ = world
    token = sessions.issue("kim@x.io")
    err, hits = call(client, token, "find_in_document", id=mine, term="차단")
    assert not err and "[접근 제어 / 3.1] 5회 실패하면 30분간 차단한다." in hits
    err, body = call(client, token, "read_section", id=mine, section_id="3.1")
    assert not err and "계정을 잠근다" in body
    # 목차 한 번이면 어느 절이 어디인지 안다 — 찾기로 더듬지 않아도 된다.
    err, toc = call(client, token, "list_sections", id=mine)
    assert not err and "[3.1] 접근 제어" in toc
    # 사람처럼 제목으로도 읽는다.
    err, body2 = call(client, token, "read_section", id=mine, section_id="접근 제어")
    assert not err and "계정을 잠근다" in body2
    err, msg = call(client, token, "find_in_document", id=mine, term="차단", slot="A")
    assert err and "비교 검토" in msg


def test_모르는_메서드와_도구는_규약대로_거절한다(world):
    client, sessions, mine, _ = world
    token = sessions.issue("kim@x.io")
    assert rpc(client, token, "resources/list").json()["error"]["code"] == -32601
    err, msg = call(client, token, "delete_review", id=mine)
    assert err and "모르는 도구" in msg


def test_비교_검토는_요건_행과_AI_자리와_판정을_준다(world):
    client, sessions, _mine, _theirs = world
    err, body = call(client, sessions.issue("kim@x.io"), "get_review", id=client.compare_id)
    assert not err and body["kind"] == "compare" and body["rtm_rows"] == 2
    rows = {r["id"]: r for r in body["rtm"]}
    assert rows["RQ-01"]["status"] == "missing"
    assert rows["RQ-01"]["upper"]["section_title"] == "인터페이스"
    assert rows["RQ-01"]["ai"]["section"] == "로그 설계" and rows["RQ-01"]["ai"]["page"] == 12
    assert rows["RQ-02"]["verdict"] == "만족함"
    assert rows["RQ-02"]["lower"]["text"] == "응답 2초 이내 설계"
    assert body["rtm_status_labels"]["missing"].startswith("누락")


def test_체크리스트_검토는_항목과_초안_행을_status_로_갈라_준다(world):
    """부록 B 초안 기록. 지적이 아니라 행이고, 셋(작성·근거 없음·폐기)을 섞지 않는다."""
    client, sessions, _, _ = world
    tok = sessions.issue("lee@x.io")
    err, listed = call(client, tok, "list_reviews", kind="evaluation")
    assert not err and [e["id"] for e in listed["entries"]] == [client.draft_id]
    err, view = call(client, tok, "get_review", id=client.draft_id)
    assert not err and view["kind"] == "evaluation" and view["title"] == "설계서.pdf"
    d = view["draft"]
    assert d["checklist_name"] == "IS22_평가체크리스트.xlsx" and d["sheet"] == "C-IS22"
    assert view["counts"] == {"항목": 2, "작성함": 1, "근거 없음": 1, "폐기함": 0}
    assert view["counts"] == d["counts"], "지적 0건이 '깨끗함'으로 읽히면 안 된다"
    r1, r2 = d["rows"]
    assert r1["id"] == "C-01" and r1["item"].startswith("Access control")
    assert r1["item_ko"] == "접근 제어"
    assert r1["status"] == "drafted" and r1["verdict_hint"] == "만족"
    assert r1["quotes"][0] == {"quote": "비인가 접근 시 계정을 잠근다.", "page": 4,
                               "section": "3.1"}
    assert r2["status"] == "not_found" and r2["reason"] == "감사 로그 언급 없음"
    assert set(d["status_labels"]) == {"drafted", "not_found", "unreviewed"}
    # 문서 도구도 초안 기록의 저장 본문으로 답한다 — 근거 못 찾은 항목을 다시 찾는 길.
    err, hits = call(client, tok, "find_in_document", id=client.draft_id, term="잠근다")
    assert not err and "잠근다" in json.dumps(hits, ensure_ascii=False)


def test_지적_검색은_보이는_기록을_가로질러_얇은_행을_준다(world):
    """'지난 검토들에도 같은 지적이 있었나' — 기록을 하나씩 열지 않고 한 번에."""
    client, sessions, mine, theirs = world
    lee, park = sessions.issue("lee@x.io"), sessions.issue("park@x.io")
    err, res = call(client, lee, "search_findings", q="잠근다")
    assert not err and res["count"] == 1
    row = res["rows"][0]
    assert row["review_id"] == mine and row["title"] == "명세서.hwpx" and row["by"] == "kim"
    assert row["finding_id"] == "f1" and row["severity"] == "지적" and row["section"] == "3.1"
    assert "owner" not in row, "이메일은 새지 않는다"
    # 낱말은 검사기·종류·문서명도 본다 — 두 낱말이면 둘 다 있어야 한다.
    assert call(client, lee, "search_findings", q="consistency 모호")[1]["count"] == 1
    assert call(client, lee, "search_findings", q="consistency 없는말")[1]["count"] == 0
    # 미검토(unreviewed) 행도 검색되고 표시된다 — 숨기면 "없다"로 읽힌다.
    err, res = call(client, lee, "search_findings", q="약어", sev="info")
    assert not err and res["rows"][0]["unreviewed"] is True
    # 다른 팀은 제 기록(남의문서)만 — 같은 문장이라도 kim 것은 안 보인다.
    err, res = call(client, park, "search_findings", q="잠근다")
    assert not err and [r["review_id"] for r in res["rows"]] == [theirs]
    # 종류 필터 — 비교 기록의 지적만.
    err, res = call(client, lee, "search_findings", kind="compare")
    assert not err and [r["finding_id"] for r in res["rows"]] == ["c1"]
    # 초안(evaluation) 행은 색인표에 없다 — 종류로 걸러도 0 이지 오류가 아니다.
    assert call(client, lee, "search_findings", kind="evaluation")[1]["count"] == 0


def test_get_review_는_직전_기록을_짚어_준다(world):
    """'지난 판과 비교해 줘' — 목록을 뒤지지 않고 previous.id 로 바로 연다."""
    client, sessions, mine, _ = world
    tok = sessions.issue("lee@x.io")
    err, view = call(client, tok, "get_review", id=client.compare_id)
    assert not err and view["previous"]["id"] == "20260901T000000000000-prior00"
    assert view["previous"]["by"] == "kim@x.io"
    err, view = call(client, tok, "get_review", id=mine)
    assert not err and "previous" not in view, "이력이 없으면 안 짚는다"

