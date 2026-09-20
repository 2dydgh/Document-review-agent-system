"""누락 요건을 검토자의 말로 다시 찾기 — 결과가 이력에 남고 라벨은 안 바뀐다."""
from __future__ import annotations

import json

import pytest

fastapi = pytest.importorskip("fastapi")
from fastapi.testclient import TestClient  # noqa: E402

from app.server import create_app  # noqa: E402

PARENT = "# A\nRQ-AA-001 인증 실패가 반복되면 계정을 잠근다\n"
CHILD = "# B\n## 3.2 계정 보호\n비밀번호를 5회 틀리면 계정을 차단한다.\n"


@pytest.fixture
def client(tmp_path):
    (tmp_path / "checklists").mkdir()
    (tmp_path / "checklists" / "cl.yaml").write_text(
        'doc_type: generic\nid_pattern: "RQ-[A-Z]{2}-\\\\d{3}"\n', encoding="utf-8")
    settings = tmp_path / "settings.toml"
    settings.write_text('[llm]\nprovider = "local"\nbase_url = "http://127.0.0.1:1"\n\n'
                        '[chunking]\nmax_chars = 4000\n\n'
                        '[review]\nchecklist = "checklists/cl.yaml"\n', encoding="utf-8")
    static = tmp_path / "frontend"
    static.mkdir()
    (static / "index.html").write_text("<html>ui</html>", encoding="utf-8")
    return TestClient(create_app(settings=settings, frontend_dir=static,
                                 history_dir=tmp_path / "history"))


def _events(text: str) -> list[dict]:
    return [json.loads(line[5:].strip()) for block in text.split("\n\n")
            for line in block.split("\n") if line.startswith("data:")]


def _compare(client) -> str:
    r = client.post("/api/compare",
                    files={"parent": ("srs.md", PARENT.encode(), "text/markdown"),
                           "child": ("sdd.md", CHILD.encode(), "text/markdown")},
                    data={"llm": "off"})
    for ev in _events(r.text):
        if ev.get("event") == "done":
            return ev["payload"]["history"]["id"]
    raise AssertionError("done 이벤트가 없다")


class _LLM:
    """떠올리기 → 확인 순서로 답한다."""

    def __init__(self, answers):
        self.answers, self.seen = answers, []

    def complete(self, prompt, **opts):
        from modules.llm_client import Response
        self.seen.append(prompt)
        i = min(len(self.seen) - 1, len(self.answers) - 1)
        return Response(text=self.answers[i])


QUOTE = "비밀번호를 5회 틀리면 계정을 차단한다."


def test_힌트로_다시_찾은_결과가_이력에_남고_라벨은_그대로다(client, monkeypatch, tmp_path):
    llm = _LLM([json.dumps(["차단", "잠금"], ensure_ascii=False),
                json.dumps({"verdict": "설계있음", "quote": QUOTE}, ensure_ascii=False)])
    monkeypatch.setattr("app.server.build_llm", lambda cfg: llm)
    hid = _compare(client)
    # 원본 보관은 뷰어 포맷만 남긴다(save_original) — 시험은 md 라 보관본을 흉내 낸다.
    d = tmp_path / "history" / "originals"
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{hid}--B.md").write_text(CHILD, encoding="utf-8")

    r = client.post(f"/api/history/{hid}/search",
                    data={"requirement_id": "RQ-AA-001", "hint": "로그인 차단"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["verdict"] == "설계있음" and body["hint"] == "로그인 차단"
    assert body["words"][:3] == ["로그인 차단", "로그인", "차단"]
    assert body["quote"] == QUOTE
    assert body["section"]            # md 파서가 매긴 절 번호(제목 순서)
    # 이력에 같은 열쇠로 남는다. 누락 행 자체는 그대로다 — 라벨을 안 바꾼다.
    saved = client.get(f"/api/history/{hid}").json()["payload"]
    assert saved["rtmSearches"]["RQ-AA-001"]["verdict"] == "설계있음"
    row = [x for x in saved["rtm"] if x["upper_id"] == "RQ-AA-001"][0]
    assert row["status"] == "missing"


def test_원본_없음_요건_없음_LLM_꺼짐은_거절한다(client, monkeypatch, tmp_path):
    monkeypatch.setattr("app.server.build_llm", lambda cfg: _LLM(["[]"]))
    hid = _compare(client)
    r = client.post(f"/api/history/{hid}/search", data={"requirement_id": "RQ-AA-001"})
    assert r.status_code == 404 and "원본" in r.json()["detail"]
    r = client.post(f"/api/history/{hid}/search", data={"requirement_id": "RQ-ZZ-999"})
    assert r.status_code == 400
    settings = tmp_path / "off.toml"
    settings.write_text('[llm]\nprovider = "echo"\n\n[chunking]\nmax_chars = 4000\n\n'
                        '[review]\nchecklist = "checklists/cl.yaml"\n', encoding="utf-8")
    off = TestClient(create_app(settings=settings, frontend_dir=tmp_path / "frontend",
                                history_dir=tmp_path / "history"))
    r = off.post(f"/api/history/{hid}/search", data={"requirement_id": "RQ-AA-001"})
    assert r.status_code == 400 and "꺼져" in r.json()["detail"]
