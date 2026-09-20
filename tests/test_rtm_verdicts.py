"""추적표 판정 저장 — 검토자의 결론이 이력에 남는지.

기계 관찰은 도구가, 판정은 검토자가 정한다. 판정이 브라우저에만 있으면
새로고침 한 번에 사라진다(lineageVerdicts 와 같은 이유). 열쇠는 요건 ID.
"""
from __future__ import annotations

import json

import pytest

fastapi = pytest.importorskip("fastapi")
from fastapi.testclient import TestClient  # noqa: E402

from app.server import create_app  # noqa: E402


@pytest.fixture
def client(tmp_path):
    # id_pattern 이 있어야 RTM 이 만들어진다 — test_web_server 와 같은 방식.
    (tmp_path / "checklists").mkdir()
    (tmp_path / "checklists" / "cl.yaml").write_text(
        'doc_type: generic\nid_pattern: "RQ-[A-Z]{2}-\\\\d{3}"\n', encoding="utf-8")
    settings = tmp_path / "settings.toml"
    settings.write_text('[llm]\nprovider = "echo"\n\n[chunking]\nmax_chars = 4000\n\n'
                        '[review]\nchecklist = "checklists/cl.yaml"\n',
                        encoding="utf-8")
    static = tmp_path / "frontend"
    static.mkdir()
    (static / "index.html").write_text("<html>ui</html>", encoding="utf-8")
    return TestClient(create_app(settings=settings, frontend_dir=static,
                                 history_dir=tmp_path / "history"))


def _run_compare(client, parent="a.md", child="b.md") -> dict:
    r = client.post("/api/compare",
                    files={"parent": (parent, b"# A\nRQ-AA-001 x\nRQ-BB-001 y",
                                      "text/markdown"),
                           "child": (child, b"# B\nRQ-AA-001 x\nRQ-CC-001 z",
                                     "text/markdown")},
                    data={"llm": "off"})
    for block in r.text.split("\n\n"):
        for line in block.split("\n"):
            if line.startswith("data:"):
                ev = json.loads(line[5:].strip())
                if ev.get("event") == "done":
                    return ev["payload"]
    raise AssertionError("done 이벤트가 없다")


def test_verdicts_saved_and_merged(client):
    payload = _run_compare(client)
    hid = payload["history"]["id"]
    r = client.post(f"/api/history/{hid}/rtm-verdicts",
                    data={"verdicts": json.dumps(
                        {"RQ-AA-001": {"verdict": "만족함", "note": ""}})})
    assert r.status_code == 200
    # 부분 저장이 합쳐진다 — 두 번째 저장이 첫 판정을 지우지 않는다.
    r = client.post(f"/api/history/{hid}/rtm-verdicts",
                    data={"verdicts": json.dumps(
                        {"RQ-BB-001": {"verdict": "수정필요", "note": "설계 누락"}})})
    body = r.json()
    assert body["rtmVerdicts"]["RQ-AA-001"]["verdict"] == "만족함"
    assert body["rtmVerdicts"]["RQ-BB-001"]["note"] == "설계 누락"
    # 이력을 다시 열어도 남아 있다.
    saved = client.get(f"/api/history/{hid}").json()
    assert saved["payload"]["rtmVerdicts"]["RQ-BB-001"]["verdict"] == "수정필요"


def test_unknown_id_and_verdict_rejected(client):
    payload = _run_compare(client)
    hid = payload["history"]["id"]
    r = client.post(f"/api/history/{hid}/rtm-verdicts",
                    data={"verdicts": json.dumps(
                        {"RQ-ZZ-999": {"verdict": "만족함", "note": ""}})})
    assert r.status_code == 400 and "없는 요건" in r.json()["detail"]
    r = client.post(f"/api/history/{hid}/rtm-verdicts",
                    data={"verdicts": json.dumps(
                        {"RQ-AA-001": {"verdict": "대충통과", "note": ""}})})
    assert r.status_code == 400 and "모르는 판정" in r.json()["detail"]


def test_empty_verdict_clears(client):
    payload = _run_compare(client)
    hid = payload["history"]["id"]
    client.post(f"/api/history/{hid}/rtm-verdicts",
                data={"verdicts": json.dumps(
                    {"RQ-AA-001": {"verdict": "만족함", "note": ""}})})
    r = client.post(f"/api/history/{hid}/rtm-verdicts",
                    data={"verdicts": json.dumps(
                        {"RQ-AA-001": {"verdict": "", "note": ""}})})
    assert "RQ-AA-001" not in r.json()["rtmVerdicts"]


def test_재검토는_같은_문서쌍의_지난_판정을_잇는다(client):
    """2회차는 처음부터 다시 누르지 않는다 — 해당사항없음은 이어받고, 나머지는
    지난 회차로 옆에 남는다(단일 검토의 반영 확인과 같은 계약)."""
    first = _run_compare(client)
    hid = first["history"]["id"]
    client.post(f"/api/history/{hid}/rtm-verdicts",
                data={"verdicts": json.dumps(
                    {"RQ-BB-001": {"verdict": "해당사항없음", "note": "타 팀 몫"},
                     "RQ-AA-001": {"verdict": "수정필요", "note": ""}})})
    second = _run_compare(client, "a_수정.md", "b_v2.md")
    assert second["rtm_lineage"]["id"] == hid
    assert second["rtmVerdicts"] == {
        "RQ-BB-001": {"verdict": "해당사항없음", "note": "타 팀 몫"}}
    assert second["rtmCarried"] == second["rtmVerdicts"]
    assert second["rtmPrior"]["RQ-AA-001"]["verdict"] == "수정필요"
    assert second["rtmPrior"]["RQ-BB-001"]["status"] == "missing"
    # 검토자가 덮어쓰면 더 이상 이어받은 것이 아니다.
    hid2 = second["history"]["id"]
    r = client.post(f"/api/history/{hid2}/rtm-verdicts",
                    data={"verdicts": json.dumps(
                        {"RQ-BB-001": {"verdict": "수정필요", "note": ""}})})
    assert r.json()["rtmCarried"] == {}
    # 다른 쌍은 안 잇는다.
    other = _run_compare(client, "a.md", "zzz.md")
    assert "rtm_lineage" not in other
