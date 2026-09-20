"""자체 최소형 로그인(서버 계정)·검토 기록 소유자 스코프·검토 작업 검사."""
import json

import pytest

fastapi = pytest.importorskip("fastapi")
from fastapi.testclient import TestClient  # noqa: E402

from app.auth import AccountStore, AuthError, SessionStore  # noqa: E402
from app.history import HistoryStore  # noqa: E402
from app.server import create_app  # noqa: E402


@pytest.fixture
def settings(tmp_path):
    (tmp_path / "checklists").mkdir()
    (tmp_path / "checklists" / "cl.yaml").write_text(
        'doc_type: generic\nid_pattern: "SR-\\\\d+"\n', encoding="utf-8")
    p = tmp_path / "settings.toml"
    p.write_text('[llm]\nprovider = "echo"\n\n[chunking]\nmax_chars = 4000\n\n'
                 '[review]\nchecklist = "checklists/cl.yaml"\n', encoding="utf-8")
    return p


@pytest.fixture
def client(settings, tmp_path):
    static = tmp_path / "frontend"
    static.mkdir()
    (static / "index.html").write_text("<html>ui</html>", encoding="utf-8")
    return TestClient(create_app(settings=settings, frontend_dir=static,
                                 history_dir=tmp_path / "history"))


def _signup(client, email="kim@suresoft.io", pw="secret-pw-1"):
    return client.post("/api/auth/signup", data={
        "email": email, "password": pw, "name": "김검토",
        "dept": "AX안전신뢰실", "team": "ai-test-cert-1"})


def test_가입_로그인_세션복원_로그아웃이_한_바퀴_돈다(client):
    assert _signup(client).status_code == 200

    r = client.post("/api/auth/login",
                    data={"email": "kim@suresoft.io", "password": "secret-pw-1"})
    assert r.status_code == 200
    assert r.json()["team"] == "ai-test-cert-1"
    assert "dr_session" in client.cookies          # HttpOnly 세션 쿠키

    me = client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json()["email"] == "kim@suresoft.io"

    assert client.post("/api/auth/logout").status_code == 200
    assert client.get("/api/auth/me").status_code == 401


def test_로그인_상태_유지가_쿠키_수명을_가른다(client):
    """끄면 브라우저를 닫을 때 사라지는 세션 쿠키여야 한다 — 공용 PC.
    예전엔 체크박스가 이메일 칸만 채웠고 세션은 늘 30일이었다."""
    _signup(client)
    creds = {"email": "kim@suresoft.io", "password": "secret-pw-1"}

    off = client.post("/api/auth/login", data=creds)
    assert "max-age" not in off.headers["set-cookie"].lower()

    on = client.post("/api/auth/login", data={**creds, "remember": "1"})
    assert "max-age=" in on.headers["set-cookie"].lower()
    # 어느 쪽이든 로그인 자체는 된다.
    assert client.get("/api/auth/me").status_code == 200


def test_틀린_비밀번호와_없는_계정은_같은_401이다(client):
    _signup(client)
    wrong = client.post("/api/auth/login",
                        data={"email": "kim@suresoft.io", "password": "wrong-pw-1"})
    ghost = client.post("/api/auth/login",
                        data={"email": "none@suresoft.io", "password": "wrong-pw-1"})
    # 가입 여부가 응답 차이로 새면 안 된다.
    assert wrong.status_code == ghost.status_code == 401
    assert wrong.json()["detail"] == ghost.json()["detail"]


def test_중복_가입과_약한_비밀번호는_400으로_거른다(client):
    assert _signup(client).status_code == 200
    assert _signup(client).status_code == 400                  # 중복
    assert _signup(client, email="lee@suresoft.io", pw="short").status_code == 400
    assert client.post("/api/auth/signup", data={
        "email": "not-an-email", "password": "secret-pw-1"}).status_code == 400


def test_프로필_수정은_로그인해야_하고_팀이_바뀐다(client):
    assert client.post("/api/auth/profile", data={"team": "x"}).status_code == 401
    _signup(client)
    client.post("/api/auth/login",
                data={"email": "kim@suresoft.io", "password": "secret-pw-1"})
    r = client.post("/api/auth/profile", data={"team": "ai-test-cert-2"})
    assert r.status_code == 200
    assert r.json()["team"] == "ai-test-cert-2"
    assert client.get("/api/auth/me").json()["team"] == "ai-test-cert-2"


def test_비밀번호는_평문이_아니라_scrypt_해시로_저장된다(tmp_path):
    store = AccountStore(tmp_path)
    store.create("a@b.io", "secret-pw-1")
    raw = (tmp_path / "auth.db").read_bytes()
    assert b"secret-pw-1" not in raw
    assert store.verify("a@b.io", "secret-pw-1")
    assert store.verify("a@b.io", "secret-pw-2") is None


def test_세션_토큰은_해시로_저장되고_폐기하면_죽는다(tmp_path):
    store = SessionStore(tmp_path)
    token = store.issue("a@b.io")
    assert token.encode() not in (tmp_path / "auth.db").read_bytes()
    assert store.resolve(token) == "a@b.io"
    store.revoke(token)
    assert store.resolve(token) is None


def test_기록_목록은_내_것과_소유자_없는_것만_보인다(tmp_path):
    store = HistoryStore(tmp_path)
    store.save("review", {"doc": {"name": "mine.md"}}, owner="me@x.io")
    store.save("review", {"doc": {"name": "theirs.md"}}, owner="other@x.io")
    store.save("review", {"doc": {"name": "legacy.md"}})       # 로그인 도입 전

    titles = [e.title for e in store.list(owners=["me@x.io"])]
    assert titles == ["legacy.md", "mine.md"][::-1] or set(titles) == {"mine.md", "legacy.md"}
    assert "theirs.md" not in titles
    # None 은 내부 조회 — 전부 보인다.
    assert len(store.list()) == 3


def test_로그인한_검토는_기록에_소유자가_남고_목록이_갈린다(client):
    _signup(client)
    client.post("/api/auth/login",
                data={"email": "kim@suresoft.io", "password": "secret-pw-1"})
    r = client.post("/api/review",
                    files={"file": ("doc.md", b"# D\nSR-001 ok", "text/markdown")},
                    data={"llm": "off"})
    assert r.status_code == 200

    mine = client.get("/api/history").json()["entries"]
    assert len(mine) == 1

    fresh = TestClient(client.app)                 # 쿠키 없는 다른 사용자
    assert fresh.get("/api/history").json()["entries"] == []


def test_이메일은_대소문자를_가리지_않는다(tmp_path):
    store = AccountStore(tmp_path)
    store.create("Kim@Suresoft.IO", "secret-pw-1")
    assert store.verify("kim@suresoft.io", "secret-pw-1")
    with pytest.raises(AuthError):
        store.create("KIM@suresoft.io", "secret-pw-1")


# ── docsuree accounts (관리자 화면이 없는 동안의 계정 관리) ──────────────────

def _accounts_cli(tmp_path, *argv):
    from app.cli import main
    return main(["accounts", *argv, "--data-dir", str(tmp_path)])


def test_cli_로_목록을_보고_권한을_올린다(tmp_path, capsys):
    store = AccountStore(tmp_path)
    store.create("kim@suresoft.io", "secret-pw-1", name="김검토", team="t1")

    assert _accounts_cli(tmp_path, "list") == 0
    out = capsys.readouterr().out
    assert "kim@suresoft.io" in out and "user" in out
    assert "secret-pw-1" not in out          # 비밀번호는 어디에도 안 나온다

    assert _accounts_cli(tmp_path, "role", "kim@suresoft.io", "--to", "admin") == 0
    assert store.get("kim@suresoft.io")["role"] == "admin"


def test_cli_삭제는_확인을_요구하고_세션까지_끊는다(tmp_path):
    store = AccountStore(tmp_path)
    store.create("kim@suresoft.io", "secret-pw-1")
    sessions = SessionStore(tmp_path)
    token = sessions.issue("kim@suresoft.io")
    other = sessions.issue("lee@suresoft.io")

    # --yes 없이는 안 지운다.
    assert _accounts_cli(tmp_path, "delete", "kim@suresoft.io") == 2
    assert store.get("kim@suresoft.io")

    assert _accounts_cli(tmp_path, "delete", "kim@suresoft.io", "--yes") == 0
    assert store.get("kim@suresoft.io") is None
    # 계정을 지웠는데 세션이 살아 있으면 그 사람은 계속 들어온다.
    assert sessions.resolve(token) is None
    assert sessions.resolve(other) == "lee@suresoft.io"


def test_cli_는_없는_계정과_빈_저장소를_구분해_말한다(tmp_path):
    assert _accounts_cli(tmp_path, "list") == 1          # 저장소가 비어 있다
    AccountStore(tmp_path).create("kim@suresoft.io", "secret-pw-1")
    assert _accounts_cli(tmp_path, "role", "none@x.io", "--to", "admin") == 1
    assert _accounts_cli(tmp_path, "role", "kim@suresoft.io") == 2   # --to 없음


# ── 관리자 계정 관리 API ────────────────────────────────────────────────────
# 화면에서 메뉴를 숨기는 것은 권한이 아니다. 관문은 서버에 있다.

def _as_admin(client, tmp_path, email="boss@suresoft.io"):
    """관리자로 로그인한 클라이언트를 만든다. 첫 관리자는 CLI 몫이라
    저장소를 직접 올린다(서버에는 승격 경로가 관리자에게만 열려 있다).
    data_root 는 history_dir 의 부모다(_data_root) — 픽스처의 tmp_path.""" 
    client.post("/api/auth/signup", data={"email": email, "password": "secret-pw-1",
                                          "name": "관리자"})
    AccountStore(tmp_path).set_role(email, "admin")
    client.post("/api/auth/login", data={"email": email, "password": "secret-pw-1"})
    return client


def test_관리자가_아니면_계정_관리_API_가_닫혀_있다(client):
    assert client.get("/api/admin/accounts").status_code == 401     # 비로그인
    _signup(client)
    client.post("/api/auth/login",
                data={"email": "kim@suresoft.io", "password": "secret-pw-1"})
    r = client.get("/api/admin/accounts")
    assert r.status_code == 403                                     # 일반 계정
    assert client.post("/api/admin/accounts/kim@suresoft.io/role",
                       data={"role": "admin"}).status_code == 403
    assert client.delete("/api/admin/accounts/kim@suresoft.io").status_code == 403


def test_관리자는_목록을_보고_권한을_바꾼다(client, tmp_path):
    _signup(client)                                     # 일반 계정 하나
    _as_admin(client, tmp_path)
    got = client.get("/api/admin/accounts").json()["accounts"]
    assert {a["email"] for a in got} == {"kim@suresoft.io", "boss@suresoft.io"}
    assert all("hash" not in a and "salt" not in a for a in got), "해시가 새어 나간다"

    r = client.post("/api/admin/accounts/kim@suresoft.io/role", data={"role": "admin"})
    assert r.status_code == 200 and r.json()["role"] == "admin"


def test_자기_권한을_스스로_내리거나_자기_계정을_지울_수_없다(client, tmp_path):
    _as_admin(client, tmp_path)
    # 내리면 그 순간 잠긴다 — 다른 관리자가 없으면 아무도 못 풀어준다.
    assert client.post("/api/admin/accounts/boss@suresoft.io/role",
                       data={"role": "user"}).status_code == 400
    assert client.delete("/api/admin/accounts/boss@suresoft.io").status_code == 400
    assert client.get("/api/admin/accounts").status_code == 200     # 여전히 관리자


def test_계정을_지우면_그_사람의_세션도_끊긴다(client, tmp_path):
    _signup(client)
    victim = TestClient(client.app)
    victim.post("/api/auth/login",
                data={"email": "kim@suresoft.io", "password": "secret-pw-1"})
    assert victim.get("/api/auth/me").status_code == 200

    _as_admin(client, tmp_path)
    assert client.delete("/api/admin/accounts/kim@suresoft.io").status_code == 200
    # 쿠키만 들고 계속 들어오면 삭제가 아니다.
    assert victim.get("/api/auth/me").status_code == 401


# ── 검토 작업(백그라운드) ───────────────────────────────────────────────────
# 검토를 걸어두고 다른 화면을 봐도 되려면, 스트림을 놓아도 결과가 남고 다시
# 붙을 수 있어야 한다.

def _sse_events(response):
    out = []
    for line in response.text.splitlines():
        if line.startswith("data:"):
            out.append(json.loads(line[5:].strip()))
    return out


def test_검토_스트림이_작업_id를_먼저_알려준다(client):
    """화면이 이 id 를 쥐고 있어야 끊긴 뒤 다시 붙을 수 있다."""
    r = client.post("/api/review",
                    files={"file": ("doc.md", b"# D\nSR-001 ok", "text/markdown")},
                    data={"llm": "off"})
    evs = _sse_events(r)
    assert evs[0]["event"] == "job" and evs[0]["id"]
    assert evs[0]["title"] == "doc.md"
    assert evs[-1]["event"] == "done"


def test_스트림을_놓아도_결과가_남고_다시_붙으면_전부_받는다(client):
    r = client.post("/api/review",
                    files={"file": ("doc.md", b"# D\nSR-001 ok", "text/markdown")},
                    data={"llm": "off"})
    job_id = _sse_events(r)[0]["id"]

    # 새로고침한 사람처럼 다시 붙는다 — 지나간 단계부터 결과까지 다시 받는다.
    again = _sse_events(client.get(f"/api/jobs/{job_id}/events"))
    assert again[0]["event"] == "job"
    assert again[-1]["event"] == "done"
    assert again[-1]["payload"]["history"]["id"]


def test_작업_목록이_알림의_원천이다(client):
    assert client.get("/api/jobs").json()["jobs"] == []
    client.post("/api/review",
                files={"file": ("doc.md", b"# D\nSR-001 ok", "text/markdown")},
                data={"llm": "off"})
    jobs = client.get("/api/jobs").json()["jobs"]
    assert len(jobs) == 1
    assert jobs[0]["kind"] == "review" and jobs[0]["status"] == "done"
    assert jobs[0]["seen"] is False and jobs[0]["history_id"]


def test_읽음_처리하면_다시_안_뜬다(client):
    client.post("/api/review",
                files={"file": ("doc.md", b"# D\nSR-001 ok", "text/markdown")},
                data={"llm": "off"})
    assert client.post("/api/jobs/seen").json()["seen"] == 1
    assert client.get("/api/jobs").json()["jobs"][0]["seen"] is True


def test_없는_작업에_붙으면_404다(client):
    """서버가 다시 시작되면 진행 중이던 작업은 사라진다 — 화면은 이걸 보고
    '중단되었습니다'라고 말한다. 조용히 빈 스트림을 주면 영영 기다린다."""
    assert client.get("/api/jobs/nosuchjob/events").status_code == 404


def test_남의_작업은_목록에도_스트림에도_없다(client, tmp_path):
    _signup(client)
    client.post("/api/auth/login",
                data={"email": "kim@suresoft.io", "password": "secret-pw-1"})
    client.post("/api/review",
                files={"file": ("kim.md", b"# D\nSR-001 ok", "text/markdown")},
                data={"llm": "off"})
    job_id = client.get("/api/jobs").json()["jobs"][0]["id"]

    other = TestClient(client.app)                 # 로그인 안 한 다른 사람
    assert other.get("/api/jobs").json()["jobs"] == []
    assert other.get(f"/api/jobs/{job_id}/events").status_code == 404


def test_검토할_수_없는_파일은_작업이_error_로_닫힌다(client):
    r = client.post("/api/review",
                    files={"file": ("x.zip", b"PK\x03\x04broken", "application/zip")},
                    data={"llm": "off"})
    evs = _sse_events(r)
    assert evs[-1]["event"] == "error"
    job = client.get("/api/jobs").json()["jobs"][0]
    assert job["status"] == "error" and job["error"]


def test_취소한_검토는_완료로_뜨지_않는다(client):
    """예전에는 취소해도 서버가 끝까지 돌아 이력에 저장했다 — 알림이 생기면서
    그 거짓말이 "검토 완료"로 눈에 보이게 됐다."""
    assert client.post("/api/jobs/nosuch/cancel").status_code == 404
    # 이미 끝난 검토는 멈출 것이 없다(완료를 취소로 덮지 않는다).
    client.post("/api/review",
                files={"file": ("doc.md", b"# D\nSR-001 ok", "text/markdown")},
                data={"llm": "off"})
    done_id = client.get("/api/jobs").json()["jobs"][0]["id"]
    assert client.post(f"/api/jobs/{done_id}/cancel").status_code == 404
    assert client.get("/api/jobs").json()["jobs"][0]["status"] == "done"


# ── 저장소가 DB 인 이유 ─────────────────────────────────────────────────────

def test_여러_프로세스가_동시에_가입해도_계정이_사라지지_않는다(tmp_path):
    """서버를 워커 여러 개로 띄웠을 때 가입이 조용히 없어지면 안 된다.

    JSON 파일 시절의 실패 모양: 워커 둘이 accounts.json 을 각자 통째로 읽고
    각자 통째로 다시 쓴다 → 나중에 쓴 쪽이 앞의 가입을 덮는다. 프로세스 안
    Lock 은 프로세스 밖으로 못 나가서 못 막았고, 에러도 로그도 안 남았다.

    스레드가 아니라 **진짜 별도 프로세스**를 띄우는 이유가 그것이다 —
    스레드였다면 예전 코드도 통과했다.
    """
    import subprocess
    import sys as _sys
    from pathlib import Path

    src = str(Path(__file__).resolve().parents[1] / "src")
    code = (
        "import sys\n"
        f"sys.path.insert(0, {src!r})\n"
        "from app.auth import AccountStore\n"
        f"store = AccountStore({str(tmp_path)!r})\n"
        "for i in range(5):\n"
        "    store.create(f'{sys.argv[1]}{i}@suresoft.io', 'secret-pw-1')\n"
    )
    AccountStore(tmp_path)          # 스키마를 먼저 만들어 둔다
    running = [subprocess.Popen([_sys.executable, "-c", code, f"w{w}-"])
               for w in range(4)]   # 넷을 다 띄운 뒤에 기다린다 — 겹쳐 돌아야 한다
    assert [p.wait(timeout=120) for p in running] == [0, 0, 0, 0]

    emails = {a["email"] for a in AccountStore(tmp_path).list()}
    assert len(emails) == 20, f"가입 20건 중 {len(emails)}건만 남았다"


def test_예전_JSON_계정과_세션을_읽어_옮긴다(tmp_path):
    """파일로 쓰던 계정이 업그레이드 후에도 그대로 로그인돼야 한다."""
    import time

    old = AccountStore(tmp_path)                    # 해시를 만들려고 한 번 쓴다
    old.create("kim@suresoft.io", "secret-pw-1", name="김검토", team="t1")
    row = old.list()[0]
    with __import__("sqlite3").connect(tmp_path / "auth.db") as con:
        acc = dict(zip([c[0] for c in con.execute(
            "SELECT * FROM account").description],
            con.execute("SELECT * FROM account").fetchone()))
    (tmp_path / "auth.db").unlink()                 # DB 를 치우고 JSON 만 남긴다
    for suffix in ("-wal", "-shm"):
        (tmp_path / f"auth.db{suffix}").unlink(missing_ok=True)
    (tmp_path / "accounts.json").write_text(json.dumps(
        {"kim@suresoft.io": {"salt": acc["salt"], "hash": acc["hash"],
                             "name": "김검토", "dept": "", "team": "t1",
                             "role": "admin", "created_at": row["created_at"]}},
        ensure_ascii=False), encoding="utf-8")
    (tmp_path / "sessions.json").write_text(json.dumps(
        {"deadbeef": {"email": "kim@suresoft.io", "expires": time.time() + 999}},
        ensure_ascii=False), encoding="utf-8")

    moved = AccountStore(tmp_path)                  # 여기서 이사가 일어난다
    assert moved.verify("kim@suresoft.io", "secret-pw-1")["role"] == "admin"
    assert moved.get("kim@suresoft.io")["team"] == "t1"
    # 세션도 함께 옮겨야 로그인한 사람이 업그레이드에 튕기지 않는다.
    with __import__("sqlite3").connect(tmp_path / "auth.db") as con:
        assert con.execute("SELECT COUNT(*) FROM session").fetchone()[0] == 1
    # 두 번째 실행은 아무 일도 안 한다(표에 이미 있다).
    AccountStore(tmp_path)
    assert len(AccountStore(tmp_path).list()) == 1
