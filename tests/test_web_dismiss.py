"""검토자가 잘못된 지적을 빼면(제외) 이력에 남고 다음 검토로 이어진다(2026-09-15 품질팀)."""
import json

import pytest

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
    seeds = tmp_path / "seeds"
    seeds.mkdir()
    (seeds / "common.yaml").write_text(
        "name: 공통 기준\nitems:\n"
        "- 'no': '12'\n  text: 미작성 표시 잔존 확인\n  agent: 형식·완전성\n"
        "  mode: 규칙\n  check: placeholder\n", encoding="utf-8")
    return TestClient(create_app(settings=settings, frontend_dir=static,
                                 history_dir=tmp_path / "history", seed_dir=seeds))


def _review(client, name, text):
    r = client.post("/api/review", files={"file": (name, text.encode(), "text/markdown")},
                    data={"llm": "off"})
    for block in r.text.split("\n\n"):
        for line in block.splitlines():
            if line.startswith("data:"):
                ev = json.loads(line[5:])
                if ev.get("event") == "done":
                    return ev["payload"]
    return None


def _issue(payload):
    return next(f for f in payload["findings"] if not f.get("unreviewed") and f["sev"] != "info")


def test_제외하면_dismissed와_해당없음_열쇠가_함께_남는다(client):
    first = _review(client, "품기문서.md", "# 문서\nTBD\n본문 한 줄")
    hid, fid = first["history"]["id"], _issue(first)["id"]
    got = client.post(f"/api/history/{hid}/dismiss", data={"finding_id": fid})
    assert got.status_code == 200, got.text
    saved = client.get(f"/api/history/{hid}").json()["payload"]
    assert saved["dismissed"] == [fid]
    assert list(saved["lineageVerdicts"].values()) == ["해당없음"]
    # 되돌리기 — 둘 다 걷힌다.
    client.post(f"/api/history/{hid}/dismiss", data={"finding_id": fid, "dismissed": "0"})
    saved = client.get(f"/api/history/{hid}").json()["payload"]
    assert saved["dismissed"] == [] and saved["lineageVerdicts"] == {}


def test_제외한_지적은_다음_검토로_이어진다(client):
    first = _review(client, "품기문서.md", "# 문서\nTBD\n본문 한 줄")
    hid, fid = first["history"]["id"], _issue(first)["id"]
    client.post(f"/api/history/{hid}/dismiss", data={"finding_id": fid})
    # 같은 문서의 회신본: TBD 가 그대로라 검사기는 또 낸다 — 검토자가 뺀 것이 이어져야 한다.
    second = _review(client, "품기문서_수정.md", "# 문서\nTBD\n본문 한 줄")
    assert second.get("lineage"), "이전 검토를 못 이었다"
    carried = second.get("lineageCarried") or {}
    assert carried and set(carried.values()) == {"해당없음"}
    items = second["lineage"]["items"]
    assert any(it["key"] in carried and it["match_id"] for it in items), items


def test_없는_지적과_비교_이력은_거절한다(client):
    first = _review(client, "품기문서.md", "# 문서\nTBD\n본문 한 줄")
    hid = first["history"]["id"]
    bad = client.post(f"/api/history/{hid}/dismiss", data={"finding_id": "nope"})
    assert bad.status_code == 400
    gone = client.post("/api/history/없는이력/dismiss", data={"finding_id": "f0"})
    assert gone.status_code == 404
