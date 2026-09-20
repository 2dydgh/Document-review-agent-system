"""어시스턴트 — 서버가 사용자마다 DoSuree 를 돌린다(설계 2판 §9).

진짜 DoSuree 대신 tests/fake_dsr.py 를 쓴다. 프로토콜 매핑·세션 색인·수명 관리는
그걸로 검사되고, 진짜 DoSuree 는 설계 §10 의 수동 확인이다.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

fastapi = pytest.importorskip("fastapi")
from fastapi.testclient import TestClient  # noqa: E402

from app.auth import AccountStore, SessionStore  # noqa: E402
from app.history import HistoryStore  # noqa: E402
from app.server import create_app  # noqa: E402

FAKE = Path(__file__).with_name("fake_dsr.py")


def _app(tmp_path, dsr_bin: str | None = None):
    settings = tmp_path / "settings.toml"
    bin_line = f'[chat]\ndsr_bin = "{sys.executable} {FAKE}"\n' if dsr_bin is None else dsr_bin
    settings.write_text('[llm]\nprovider = "echo"\n\n' + bin_line, encoding="utf-8")
    static = tmp_path / "frontend"
    static.mkdir()
    (static / "index.html").write_text("<html>ui</html>", encoding="utf-8")
    return create_app(settings=settings, frontend_dir=static, history_dir=tmp_path / "history")


@pytest.fixture
def world(tmp_path):
    client = TestClient(_app(tmp_path))
    accounts = AccountStore(tmp_path)
    accounts.create("kim@x.io", "password1", name="김", team="ax-quality")
    accounts.create("park@x.io", "password1", name="박", team="다른팀")
    sessions = SessionStore(tmp_path)
    history = HistoryStore(tmp_path / "history")
    rec = history.save("review", {"doc": {"name": "명세서.hwpx"}, "sections": [], "findings": []},
                       owner="kim@x.io")
    return client, sessions, rec.id, tmp_path


def _cookie(sessions, email):
    return {"dr_session": sessions.issue(email)}


def _events(client, cookies, since: int = 0) -> list[dict]:
    """스트림 하나(= 턴 하나)를 끝까지 읽는다. ping 은 뺀다."""
    r = client.get("/api/chat/stream", params={"since": since}, cookies=cookies)
    assert r.status_code == 200, r.text
    out = [json.loads(line[6:]) for line in r.text.splitlines() if line.startswith("data: ")]
    return [e for e in out if e.get("event") != "ping"]


def _say(client, cookies, message, review_id=""):
    r = client.post("/api/chat/say", data={"message": message, "review_id": review_id},
                    cookies=cookies)
    return r


def test_꺼져_있으면_404_이고_health_가_말한다(tmp_path):
    client = TestClient(_app(tmp_path, dsr_bin=""))
    assert client.get("/api/health").json()["chat_enabled"] is False
    assert client.get("/api/chat/sessions").status_code == 404


def test_로그인이_관문이고_남의_검토는_못_얹는다(world):
    client, sessions, rid, _ = world
    assert client.get("/api/health").json()["chat_enabled"] is True
    assert _say(client, {}, "안녕").status_code == 401
    assert _say(client, _cookie(sessions, "park@x.io"), "안녕", rid).status_code == 403


def test_말을_넘기면_DoSuree_이벤트가_SSE_로_오고_색인이_생긴다(world):
    client, sessions, rid, tmp_path = world
    cookies = _cookie(sessions, "kim@x.io")
    r = _say(client, cookies, "major 근거 보여줘", rid)
    assert r.status_code == 200, r.text
    entry = r.json()["session"]
    assert r.json()["since"] == 0
    assert entry["title"] == "명세서.hwpx · major 근거 보여줘" and entry["review_id"] == rid   # 문서 이름이 앞에
    assert entry["review_title"] == "명세서.hwpx"
    evs = _events(client, cookies)
    kinds = [e["event"] for e in evs]
    assert kinds[0] == "user"
    assert evs[0]["text"] == "major 근거 보여줘"          # 문맥 머리말은 안 보인다
    assert "turn" in kinds and "tool" in kinds and "tool_done" in kinds and "text" in kinds
    assert "".join(e["delta"] for e in evs if e["event"] == "text").startswith("받은 말: ")
    assert kinds[-1] == "turn" and evs[-1]["state"] == "end"
    # 격리 폴더: 그 사람 토큰·팀·HOME. 세션 파일도 그 아래.
    homes = [h for h in (tmp_path / "chat").iterdir() if h.is_dir()]
    assert len(homes) == 1
    mcp = json.loads((homes[0] / ".dsr" / "mcp.json").read_text(encoding="utf-8"))
    token = mcp["mcpServers"]["docsuree"]["headers"]["Authorization"].split(" ", 1)[1]
    assert sessions.resolve(token) == "kim@x.io"
    for d in (homes[0] / ".dsr", homes[0] / ".dsr" / "agent"):      # 프로젝트·사용자 범위 둘 다
        cfg = (d / "config.yml").read_text(encoding="utf-8")
        assert "workType: doc-verification" in cfg and "team: ax-quality" in cfg
        assert (d / "mcp.json").is_file()
    assert Path(entry["path"]).is_relative_to(homes[0])
    listed = client.get("/api/chat/sessions", cookies=cookies).json()["sessions"]
    assert [s["id"] for s in listed] == [entry["id"]] and listed[0]["missing"] is False


def test_새_대화_이어_열기_이름_삭제가_색인과_파일을_같이_움직인다(world):
    client, sessions, rid, _ = world
    cookies = _cookie(sessions, "kim@x.io")
    first = _say(client, cookies, "첫 대화", rid).json()["session"]
    _events(client, cookies)
    # 두 번째 말은 첫 턴 **뒤**에서 시작한다 — 그 번호부터 읽으면 첫 턴이 안 섞인다.
    r2 = _say(client, cookies, "둘째 말")
    assert r2.json()["since"] > 0
    evs2 = _events(client, cookies, since=r2.json()["since"])
    assert evs2[0]["event"] == "user" and evs2[0]["text"] == "둘째 말"
    assert all(e.get("text") != "첫 대화" for e in evs2)
    second = client.post("/api/chat/sessions", data={"review_id": ""},
                         cookies=cookies).json()["session"]
    assert second["id"] != first["id"] and second["review_id"] == ""
    _say(client, cookies, "둘째 대화")
    _events(client, cookies)
    def ids():
        listed = client.get("/api/chat/sessions", cookies=cookies).json()["sessions"]
        return [s["id"] for s in listed]
    assert ids() == [second["id"], first["id"]]           # 최근 것이 위
    # 첫 대화를 다시 열면 지난 말풍선이 온다(도구 호출은 이름만).
    r = client.post(f"/api/chat/sessions/{first['id']}/open", cookies=cookies)
    assert r.status_code == 200, r.text
    msgs = r.json()["messages"]
    assert [m["role"] for m in msgs] == ["user", "assistant", "user", "assistant"]   # 첫 대화 + 둘째 말
    assert msgs[0]["text"] == "첫 대화"                  # 머리말은 벗겨서
    assert msgs[1]["tools"][0]["name"] == "mcp__docsuree_get_review"
    assert msgs[1]["text"].startswith("받은 말: ")
    # 이름 바꾸기
    r = client.post(f"/api/chat/sessions/{first['id']}/rename", data={"title": "참조번호 확인"},
                    cookies=cookies)
    assert r.json()["session"]["title"] == "참조번호 확인"
    # 삭제 → 색인에서 빠지고 파일도 없다
    path = Path(first["path"])
    assert client.delete(f"/api/chat/sessions/{first['id']}", cookies=cookies).status_code == 200
    assert not path.exists()
    assert ids() == [second["id"]]
    # 파일이 밖에서 지워진 항목은 missing 으로 보인다
    Path(second["path"]).unlink()
    listed = client.get("/api/chat/sessions", cookies=cookies).json()["sessions"]
    assert listed[0]["missing"] is True
    r = client.post(f"/api/chat/sessions/{second['id']}/open", cookies=cookies)
    assert r.status_code == 409


def test_두_사용자의_대화는_섞이지_않는다(world):
    client, sessions, rid, tmp_path = world
    kim, park = _cookie(sessions, "kim@x.io"), _cookie(sessions, "park@x.io")
    for cookies, text in ((kim, "김의 말"), (park, "박의 말")):
        _say(client, cookies, text)
        _events(client, cookies)
    for cookies, text in ((kim, "김의 말"), (park, "박의 말")):
        listed = client.get("/api/chat/sessions", cookies=cookies).json()["sessions"]
        assert [s["title"] for s in listed] == [text]
    assert len([h for h in (tmp_path / "chat").iterdir() if h.is_dir()]) == 2


def test_프로세스가_죽으면_closed_가_오고_다음_말이_새로_띄운다(world):
    client, sessions, rid, _ = world
    cookies = _cookie(sessions, "kim@x.io")
    _say(client, cookies, "죽어")
    evs = _events(client, cookies)
    assert evs[-1]["event"] == "closed" and evs[-1]["code"] == 3
    assert _say(client, cookies, "다시").status_code == 200
    evs = _events(client, cookies)
    assert evs[0]["event"] == "user" and evs[-1]["event"] == "turn" and evs[-1]["state"] == "end"
    tail = _events(client, cookies, since=evs[-2]["i"] + 1)
    assert [e["event"] for e in tail] == ["turn"]


def test_빈_말과_너무_긴_말은_거절한다(world):
    client, sessions, rid, _ = world
    cookies = _cookie(sessions, "kim@x.io")
    for bad in ("  ", "가" * 4001):
        assert _say(client, cookies, bad).status_code == 409


def test_보관_기간_지난_대화는_지워진다(world, tmp_path):
    from app.chat import ChatWorkers
    client, sessions, rid, _ = world
    cookies = _cookie(sessions, "kim@x.io")
    entry = _say(client, cookies, "옛날 대화").json()["session"]
    _events(client, cookies)
    index = Path(entry["path"]).parents[3] / "sessions.json"     # <home>/.dsr/agent/sessions/x
    assert index.is_file(), index
    data = json.loads(index.read_text(encoding="utf-8"))
    data[0]["updated"] = 0
    index.write_text(json.dumps(data), encoding="utf-8")
    workers = ChatWorkers(tmp_path / "chat", "", mcp_url="", llm_base_url="",
                          issue_token=lambda e: "", team_of=lambda e: "")
    assert workers.purge_old() == 1
    assert not Path(entry["path"]).exists()
    assert client.get("/api/chat/sessions", cookies=cookies).json()["sessions"] == []


def test_규칙_머리말은_대화당_한_번_한국어로_붙는다(world):
    """시스템 프롬프트 자리가 없어 첫 말 앞에 싣는다 — 두 번째 말에는 안 붙는다."""
    client, sessions, rid, _ = world
    cookies = _cookie(sessions, "kim@x.io")
    r = _say(client, cookies, "안녕", rid)
    assert r.status_code == 200, r.text
    _events(client, cookies)
    path = Path(r.json()["session"]["path"])
    assert path.read_text(encoding="utf-8").count("답은 한국어로 쓴다") == 1
    evs = _events(client, cookies, since=0)
    assert evs[0]["text"] == "안녕"                       # 화면엔 규칙도 머리말도 안 보인다
    r = _say(client, cookies, "또 물어봐", rid)
    _events(client, cookies, since=r.json()["since"])
    assert path.read_text(encoding="utf-8").count("답은 한국어로 쓴다") == 1


def test_도구_없이_뜬_DoSuree_는_다음_말에_같은_대화로_새로_띄운다(world):
    """모델이 없는 도구 이름을 불렀다 = 도구 목록이 안 붙은 프로세스. 그대로 두면 계속 헤맨다."""
    client, sessions, rid, tmp_path = world
    cookies = _cookie(sessions, "kim@x.io")
    r = _say(client, cookies, "없는도구 불러", rid)
    _events(client, cookies, since=r.json()["since"])
    first = r.json()["session"]
    r = _say(client, cookies, "다시", rid)
    assert r.status_code == 200, r.text
    evs = _events(client, cookies, since=r.json()["since"])
    assert evs[-1]["event"] == "turn" and evs[-1]["state"] == "end"
    assert r.json()["session"]["id"] == first["id"], "대화는 그대로, 프로세스만 새것"
    home = next(h for h in (tmp_path / "chat").iterdir() if h.is_dir())
    pids = (home / ".dsr" / "agent" / "fake_pids.log").read_text().split()
    assert len(pids) == 2 and pids[0] != pids[1]

