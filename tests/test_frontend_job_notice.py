"""걸어둔 검토가 알림에 뜬다 — 다른 화면으로 가도, 시작한 그 순간부터.

검토는 서버가 들고 있는 일이고(`src/app/jobs.py`), 알림은 그 목록이다
(`GET /api/jobs`). 목록을 다시 읽는 폴링은 **스스로 이어진다** — `loadJobs()`
가 도는 작업을 보면 5초 뒤를 예약하고, 그게 다시 `loadJobs()` 를 부른다.

그런데 **첫 고리가 없었다.** 검토를 시작해도 `loadJobs()` 를 한 번도 안 불러서
사슬이 시작되지 않았다. 그래서 비교를 걸고 다른 화면으로 가면 알림이 비어
있었다(새로고침하면 뜬다 — boot 가 부르니까). "걸어두고 나가도 된다"가 절반만
사실이었다.

이 회귀는 조용하다 — 화면은 멀쩡하고 검토도 제대로 돈다. 알림만 안 뜬다.
그래서 소스 수준으로 못박는다.
"""
from __future__ import annotations

import re
from pathlib import Path

WEB = Path(__file__).resolve().parents[1] / "web"
API = (WEB / "api.js").read_text(encoding="utf-8")
APP = (WEB / "app.js").read_text(encoding="utf-8")


def test_작업이_생기면_그_자리에서_목록을_읽는다() -> None:
    """네 검토(단일·비교·폴더·체크리스트) 모두 서버가 보내는 첫 `job` 이벤트에서 시작한다.

    그 줄이 폴링 사슬의 첫 고리다. 하나라도 빠지면 그 종류만 조용히 알림에서
    사라진다.
    """
    hits = re.findall(r'ev\.event === "job"\s*\)\s*\{([^}]*)\}', API)
    assert len(hits) == 4, f"job 이벤트를 받는 자리가 넷이 아니다: {len(hits)}"
    missing = [h.strip() for h in hits if "loadJobs()" not in h]
    assert not missing, f"작업이 생겼는데 목록을 안 읽는 자리: {missing}"


def test_알림을_펼치면_새로_읽는다() -> None:
    """목록은 부팅 때 받아 둔 것이라, 그동안 끝났거나 새로 걸린 것이 안 보인다."""
    m = re.search(r"toggleNoti: function \(\) \{(.{0,400})", APP, re.S)
    assert m, "toggleNoti 를 찾지 못했다"
    assert "loadJobs()" in m.group(1), "알림을 펼칠 때 목록을 다시 읽지 않는다"


def test_폴링이_스스로_이어진다() -> None:
    """도는 작업이 있으면 다음 읽기를 예약한다. 이게 없으면 첫 고리만 있고
    사슬이 안 이어져, 진행 표시가 시작 시점에 멈춰 선다."""
    assert "scheduleJobPoll" in API
    m = re.search(r"var running = .{0,400}", API, re.S)
    assert m and "scheduleJobPoll" in m.group(0), "도는 작업을 보고도 다시 안 읽는다"
