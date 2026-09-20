"""체크리스트 검토(부록 B 초안): 시트 목록 → 작업 → 이력 → xlsx."""
from __future__ import annotations

import io
import json
from urllib.parse import unquote

import pytest

fastapi = pytest.importorskip("fastapi")
openpyxl = pytest.importorskip("openpyxl")
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
    (seeds / "common.yaml").write_text("name: 공통 기준\nitems: []\n", encoding="utf-8")
    return TestClient(create_app(settings=settings, frontend_dir=static,
                                 history_dir=tmp_path / "history", seed_dir=seeds))


def _xlsx() -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "B-1 (요건BTP)"
    ws.append(["Characteristic", "Detail Characteristic", "ID", "Evaluation Item"])
    ws.append(["Functional", "Accuracy", "VR01-01", "Accuracy requirements should be provided."])
    ws.append(["", "", "VR01-02", "Accuracy should be stated numerically."])
    other = wb.create_sheet("NUREG")
    other.append(["Rules", "Guideline"])
    other.append(["2.1", "Avoid goto."])
    wb.create_sheet("Sheet3")   # 통합문서에 흔한 빈 껍데기 — 탭으로 안 나가야 한다
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _events(text: str) -> list[dict]:
    out = []
    for block in text.split("\n\n"):
        for line in block.splitlines():
            if line.startswith("data:"):
                out.append(json.loads(line[5:]))
    return out


def test_시트_목록은_항목_수와_읽을_수_없는_이유를_함께_준다(client) -> None:
    r = client.post("/api/evaluate/sheets",
                    files={"file": ("chk.xlsx", _xlsx(), "application/octet-stream")})
    assert r.status_code == 200
    sheets = r.json()["sheets"]
    b1 = next(s for s in sheets if s["label"].startswith("B-1"))
    assert b1["item_count"] == 2 and b1["error"] == "" and b1["documents"] == []
    # 앞부분 원본 셀 — 화면이 엑셀 격자(열 글자·행 번호)로 그대로 보여 준다.
    assert b1["rows"][0] == ["Characteristic", "Detail Characteristic", "ID", "Evaluation Item"]
    assert b1["rows"][1][2] == "VR01-01" and b1["rows"][2][:3] == ["", "", "VR01-02"]
    bad = next(s for s in sheets if s["label"].startswith("NUREG"))
    assert bad["item_count"] == 0 and "Evaluation Item" in bad["error"]
    # 읽을 수 없는 시트도 원본은 보여 준다 — 왜 못 읽는지 눈으로 알게.
    assert bad["rows"][0] == ["Rules", "Guideline"]
    # 빈 껍데기 시트는 탭으로 안 나간다. index 는 파일 안 위치 그대로다.
    assert [s["label"] for s in sheets] == ["B-1 (요건BTP)", "NUREG"]
    assert [s["index"] for s in sheets] == [0, 1]


def _evaluate(client, sheet_index=0):
    return client.post("/api/evaluate", data={"sheet_index": str(sheet_index), "llm": "on"},
                       files={"document": ("SRS_Rev.01.md", b"# 3.2 Accuracy\n\n"
                                           b"The accuracy shall be within 1 percent.\n",
                                           "text/markdown"),
                              "checklist": ("chk.xlsx", _xlsx(), "application/octet-stream")})


def test_초안_작업은_항목마다_진행을_흘리고_이력에_남는다(client) -> None:
    evs = _events(_evaluate(client).text)
    assert evs[0]["event"] == "job" and evs[0]["kind"] == "evaluation"
    assert any(e.get("key") == "draft" and "항목" in (e.get("detail") or "") for e in evs)
    # 항목이 끝날 때마다 그 행이 실려 온다 — 작성중 종이가 한 줄씩 쓰는 재료.
    rows = [e["row"] for e in evs if e.get("key") == "draft" and e.get("row")]
    assert sorted(r["i"] for r in rows) == [0, 1]
    assert {r["id"] for r in rows} == {"VR01-01", "VR01-02"}
    assert all(r["status"] == "unreviewed" and "item" in r and "comment" in r for r in rows)
    done = next(e for e in evs if e.get("event") == "done")
    p = done["payload"]
    assert [it["id"] for it in p["items"]] == ["VR01-01", "VR01-02"]
    assert len(p["rows"]) == 2 and p["sheet"].startswith("B-1")
    # echo LLM 은 프롬프트를 되돌려 줄 뿐 판정을 한 적이 없다 — 근거를 못 찾은 것이
    # 아니라 **검토를 못 한** 것이다. 두 수를 섞으면 "0건 통과"로 읽힌다.
    assert p["unreviewed"] == 2 and p["unfound"] == 0
    assert all(r["status"] == "unreviewed" for r in p["rows"])
    assert p["doc"]["name"] == "SRS_Rev.01.md" and p["sections"]
    assert p["history"]["saved"] is True
    rec = client.get("/api/history/" + p["history"]["id"]).json()
    assert rec["kind"] == "evaluation" and rec["title"] == "SRS_Rev.01.md"
    listed = client.get("/api/history?kind=evaluation").json()
    summary = listed["entries"][0]["summary"]
    assert listed["total"] == 1 and summary["unreviewed"] == 2 and summary["unfound"] == 0


def test_읽을_수_없는_시트를_고르면_400(client) -> None:
    r = _evaluate(client, sheet_index=1)
    assert r.status_code == 400 and "Evaluation Item" in r.json()["detail"]
    assert _evaluate(client, sheet_index=9).status_code == 400


def test_xlsx_는_부록_b_양식이고_파일명에_검토일이_붙는다(client) -> None:
    p = next(e for e in _events(_evaluate(client).text) if e.get("event") == "done")["payload"]
    r = client.get(f"/api/history/{p['history']['id']}/evaluation.xlsx")
    assert r.status_code == 200
    ws = openpyxl.load_workbook(io.BytesIO(r.content))["평가표 초안"]
    assert ws.cell(1, 5).value == "Evaluation result and Comment"
    assert ws.cell(2, 3).value == "VR01-01"
    disp = unquote(r.headers["content-disposition"])
    assert "SRS_Rev.01_" in disp
    assert "평가표초안" in disp
    review = client.get(f"/api/history/{p['history']['id']}/review.xlsx")
    assert review.status_code == 400


def test_초안_기록의_형광펜_좌표는_원문_창_모양으로_한_번만_센다(client, tmp_path) -> None:
    """원문 창은 초안 행을 지적("e<항목 순번>", 인용)으로 보내 좌표를 청한다. 서버는 그
    좌표를 이력에 캐시해 두 번째부터는 다시 안 센다 — 작업 끝의 미리 계산(_draft_findings)이
    같은 모양으로 채워 두면 창이 열릴 때 바로 쓴다(2026-09-17: 247쪽 SRS 실측 47초)."""
    FPDF = pytest.importorskip("fpdf").FPDF
    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Helvetica", size=12)
    pdf.cell(0, 10, "The accuracy shall be within one percent of full scale.")
    data = pdf.output()
    # 이력 저장소는 앱 안의 클로저다 — 같은 디렉터리를 여는 두 번째 HistoryStore 로 기록을
    # 심고, 좌표 캐시도 그것으로 읽는다(둘 다 같은 SQLite·같은 marks 폴더를 본다).
    payload = {"doc": {"name": "srs.pdf", "type": "PDF"}, "sections": [], "findings": [],
               "images": [],
               "items": [{"id": "VR01-01", "raw_id": "", "item": "Accuracy", "characteristic": "",
                          "detail": "", "item_ko": "", "viewpoint": "", "document": ""}],
               "rows": [{"item_id": "VR01-01", "verdict_hint": "Satisfied", "status": "drafted",
                         "comment": "ok", "sections": ["3.2"], "reason": "", "words": [],
                         "quotes": [{"quote": "The accuracy shall be within one percent", "page": 1,
                                     "section": "s1"}]}],
               "unfound": 0, "unreviewed": 0, "llm_failures": 0, "notes": [], "sheet": "B-1",
               "checklist_name": "chk.xlsx", "document_kind": ""}
    from app.history import HistoryStore  # noqa: PLC0415
    store = HistoryStore(tmp_path / "history")
    entry = store.save("evaluation", payload)
    store.save_original(entry.id, "srs.pdf", bytes(data), slot="")
    findings = [{"id": "e0", "sev": "info", "message": "제안 Satisfied · ok",
                 "evidence": [{"quote": "The accuracy shall be within one percent", "page": 1,
                               "section": "s1"}]}]
    r = client.post("/api/locate", data={"history_id": entry.id, "slot": "", "images": "[]",
                                          "findings": json.dumps(findings)})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["items"] and body["items"][0]["id"] == "e0" and body["items"][0]["marks"]
    cached = store.marks(entry.id, "")
    assert cached and cached.get("marks", {}).get("items"), "좌표가 이력에 캐시돼야 한다"
    again = client.post("/api/locate", data={"history_id": entry.id, "slot": "", "images": "[]",
                                              "findings": json.dumps(findings)})
    assert again.json() == body
