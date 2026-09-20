"""과제 층 — 추가 검토 기준 수기 등록과 매개변수 우선순위.

파일 업로드로는 mode·check·params 를 실을 수 없어 올린 항목이 전부 "사람
확인"으로 떨어졌다. 과제마다 바뀌는 값(요건 ID 형식·담당 범위)의 제자리이기도
하다 — 팀 기준은 과제를 모르고, **좁은 층이 넓은 층을 덮는다**.
"""
from __future__ import annotations

import json

import pytest

from app.config import apply_criteria_params, param_overrides
from modules.preset import Criterion
from modules.shared import ReviewConfig

fastapi = pytest.importorskip("fastapi")
from fastapi.testclient import TestClient  # noqa: E402

from app.server import create_app  # noqa: E402


@pytest.fixture
def client(tmp_path):
    settings = tmp_path / "settings.toml"
    settings.write_text('[llm]\nprovider = "echo"\n\n[chunking]\nmax_chars = 4000\n',
                        encoding="utf-8")
    static = tmp_path / "frontend"
    static.mkdir()
    (static / "index.html").write_text("<html>ui</html>", encoding="utf-8")
    return TestClient(create_app(settings=settings, frontend_dir=static,
                                 history_dir=tmp_path / "history"))


def _post(client, rows, name="PRJX 과제 기준"):
    return client.post("/api/criteria/manual",
                       data={"name": name, "items": json.dumps(rows)})


def test_manual_criterion_keeps_mode_and_params(client):
    """수기 항목은 검사 방식과 매개변수를 그대로 싣는다 — 이게 업로드와의 차이다."""
    r = _post(client, [{"text": "요건 ID 형식", "mode": "사람",
                        "params": {"id_pattern": "RQ-[A-Z]{2}-\\d{3}"}}])
    assert r.status_code == 200, r.text
    cid = r.json()["id"]
    got = client.get(f"/api/checklists/{cid}").json()
    item = got["items"][0]
    assert item["mode"] == "사람"
    assert item["params"]["id_pattern"] == "RQ-[A-Z]{2}-\\d{3}"


def test_llm_mode_survives_so_it_is_actually_checked(client):
    """LLM-조각 으로 적은 항목은 자동 검사 몫이 된다(업로드 층은 전부 사람이었다)."""
    r = _post(client, [{"text": "날짜 표기가 문서 전체에서 통일되었는가",
                        "mode": "LLM-조각"}])
    cid = r.json()["id"]
    layers = client.get("/api/criteria").json()["layers"]
    mine = [x for lay in layers for x in lay["items"] if lay["id"] == cid]
    assert mine and mine[0]["howChecked"] == "LLM · 자동"


def test_unknown_mode_check_and_param_are_rejected(client):
    assert _post(client, [{"text": "x", "mode": "대충"}]).status_code == 400
    assert _post(client, [{"text": "x", "mode": "규칙", "check": "없는규칙"}]).status_code == 400
    assert _post(client, [{"text": "x", "params": {"오타키": "1"}}]).status_code == 400
    # 규칙 이름만 적고 mode 를 안 맞추면 그 규칙은 안 돈다 — 조용히 넘기지 않는다.
    assert _post(client, [{"text": "x", "check": "placeholder"}]).status_code == 400
    # 정규식이 깨졌으면 등록 때 막는다(검토 때 조용한 0건이 되지 않게).
    assert _post(client, [{"text": "x", "params": {"id_pattern": "["}}]).status_code == 400
    assert _post(client, [{"text": "  "}]).status_code == 400


def test_narrow_layer_wins_and_is_reported():
    """과제 층이 팀 기본값을 덮고, 덮은 사실이 드러난다."""
    team = Criterion(no="X-1", text="추적성", params={"id_pattern": "PRJX-\\d+"})
    team.layer = "팀별"
    project = Criterion(no="P-1", text="이번 과제 ID", params={"id_pattern": "KRISO-\\d+"})
    project.layer = "업로드"
    review = apply_criteria_params(ReviewConfig(doc_type="generic"), [team, project])
    assert review.id_pattern == "KRISO-\\d+"

    overs = param_overrides([team, project])
    assert len(overs) == 1
    assert overs[0]["key"] == "id_pattern"
    assert overs[0]["winner_layer"] == "업로드" and overs[0]["loser_layer"] == "팀별"


def test_same_value_twice_is_not_an_override():
    """값이 같으면 덮은 것이 아니다 — 없는 경고를 띄우지 않는다."""
    a = Criterion(no="1", text="a", params={"id_pattern": "RQ-\\d+"})
    b = Criterion(no="2", text="b", params={"id_pattern": "RQ-\\d+"})
    assert param_overrides([a, b]) == []


def test_compare_uses_project_layer_pattern(client):
    """비교 검토도 과제 층의 요건 ID 형식·담당 범위로 잰다.

    단일 검토는 이미 그렇게 돌았는데 비교만 팀 기준까지만 봐서, 과제 기준을
    등록해도 추적성은 옛 형식으로 쟀다(실물 확인에서 드러났다).
    """
    r = _post(client, [{"text": "이 과제의 요건 ID", "mode": "사람",
                        "params": {"id_pattern": "KR-[A-Z]{3}-\\d{3}",
                                   "scope_pattern": "-AAA-"}}])
    cid = r.json()["id"]
    res = client.post("/api/compare",
                      files={"parent": ("a.md", b"# A\nKR-AAA-001 x\nKR-BBB-001 y",
                                        "text/markdown"),
                             "child": ("b.md", b"# B\nKR-AAA-001 x", "text/markdown")},
                      data={"llm": "off", "checklist_id": cid})
    payload = None
    for block in res.text.split("\n\n"):
        for line in block.split("\n"):
            if line.startswith("data:"):
                ev = json.loads(line[5:].strip())
                if ev.get("event") == "done":
                    payload = ev["payload"]
    assert payload is not None, res.text
    ids = {row["upper_id"] for row in payload["rtm"]}
    assert "KR-AAA-001" in ids, "과제 층 id_pattern 이 안 걸렸다"
    # 담당 범위 밖(BBB)은 누락이 아니라 범위 밖이다.
    by_id = {row["upper_id"]: row["status"] for row in payload["rtm"]}
    assert by_id["KR-AAA-001"] == "linked"
    assert by_id["KR-BBB-001"] == "out_of_scope"
