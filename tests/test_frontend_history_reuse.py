"""기록에서 열 때 서버가 가진 원본을 쓰는지 지키는 회귀 테스트.

원본 보관이 생기기 전 설계가 그 뒤에도 남아 있었다 — `/api/render-pdf` 와
`/api/locate` 주석에 "원본을 서버에 보관하지 않는다. 브라우저가 들고 있는
파일을 그때 올린다" 가 그대로 있었고, 코드도 그랬다.

그래서 기록을 하나 열면 이런 일이 벌어졌다(실측, 2.1MB hwpx · 61쪽):

    GET  /original      2.1MB 내려받기      ← 서버 디스크에 있는 그 파일
    POST /render-pdf    2.1MB 도로 올리기   ← LibreOffice 7초
    POST /locate        만든 PDF 또 올리기

같은 파일이 서버→브라우저→서버로 왕복했다. 프론트가 `history_id` 를 보내면
서버가 자기 파일을 쓰고, 변환본은 캐시된다.

빌드도 JS 러너도 없는 바닐라 SPA라 소스 수준에서 막는다.
"""
from __future__ import annotations

import re
from pathlib import Path

APP_JS = (Path(__file__).resolve().parent.parent / "web" / "app.js").read_text(encoding="utf-8")
SERVER_PY = (Path(__file__).resolve().parent.parent / "src" / "app" / "server.py").read_text(
    encoding="utf-8")


def _body(fn_name: str) -> str:
    """`function <이름>(` 부터 다음 `\n  function ` 까지. 중괄호를 세지 않는다."""
    i = APP_JS.index(f"function {fn_name}(")
    j = APP_JS.find("\n  function ", i + 1)
    return APP_JS[i:j if j > 0 else len(APP_JS)]


def test_뷰어_소스가_이력_id_를_들고_다닌다():
    """이게 없으면 아래 두 테스트가 통과해도 실제로는 늘 파일을 올린다."""
    src = _body("viewerSource")
    assert "historyId" in src, "viewerSource 가 historyId 를 안 낸다"
    # 비교는 A·B 두 문서라 자리도 함께 가야 한다 — 안 주면 A 를 B 로 내준다.
    assert "slot" in src, "viewerSource 가 비교의 자리(slot)를 안 낸다"


def test_변환은_이력이_있으면_파일_대신_id_를_보낸다():
    body = _body("maybeConvert")
    assert 'fd.append("history_id"' in body, "render-pdf 에 history_id 를 안 보낸다"
    # 검토 직후에는 아직 저장 전일 수 있으니 파일 경로도 남아 있어야 한다.
    assert 'fd.append("file"' in body, "미저장 검토의 업로드 경로가 사라졌다"


def test_좌표도_이력이_있으면_PDF_를_다시_안_올린다():
    body = _body("loadMarks")
    assert 'fd.append("history_id"' in body, "locate 에 history_id 를 안 보낸다"
    assert 'fd.append("file"' in body, "미저장 검토의 업로드 경로가 사라졌다"


def test_서버가_두_경로를_다_받는다():
    """프론트만 고치고 서버가 안 받으면 400 이 난다."""
    for ep in ("render_pdf", "locate_findings"):
        i = SERVER_PY.index(f"async def {ep}(")
        head = SERVER_PY[i:SERVER_PY.index("->", i)]      # 인자 목록까지만 본다
        assert "history_id" in head, f"{ep} 가 history_id 를 안 받는다"
        assert "UploadFile | None" in head, f"{ep} 의 file 이 여전히 필수다"


def test_낡은_전제가_주석에_남아_있지_않다():
    """"원본을 서버에 보관하지 않는다" 는 이제 사실이 아니다.

    문장 하나가 남으면 다음 사람이 그 전제로 또 왕복을 만든다. 실제로
    history.py·server.py 세 군데에 같은 문장이 흩어져 있었다.
    """
    stale = re.findall(r"원본을 서버에 (?:남기지|보관하지) 않는다", SERVER_PY)
    assert not stale, f"낡은 주석이 {len(stale)}군데 남아 있다"
