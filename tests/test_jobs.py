"""검토 작업 저장소 — 끊었다 다시 붙어도 결과를 받는다."""
import threading
import time

import pytest

from app.jobs import CANCELLED, DONE, ERROR, RUNNING, JobStore


def _drain(store, job_id, owner=None, limit=50):
    """스트림을 끝까지 읽어 이벤트 목록으로. ping 은 버린다."""
    out = []
    for ev in store.stream(job_id, owner):
        if ev.get("event") != "ping":
            out.append(ev)
        if len(out) >= limit:
            break
    return out


def test_끝난_작업에_나중에_붙어도_전부_다시_받는다():
    """새로고침한 사람이 결과를 못 받으면 백그라운드 검토가 아니다."""
    store = JobStore()
    done = threading.Event()

    def work(emit):
        emit({"key": "parse", "label": "글자 읽기"})
        emit({"key": "check", "label": "기준으로 재기"})
        done.set()
        return {"findings": [], "history": {"id": "h-1"}}

    job = store.start("review", "a.md", "me@x.io", work)
    assert done.wait(2)
    time.sleep(0.05)                      # 스레드가 done 이벤트를 넣을 틈

    evs = _drain(store, job.id)
    assert [e["event"] for e in evs] == ["stage", "stage", "done"]
    assert evs[-1]["payload"]["history"]["id"] == "h-1"
    assert store.get(job.id).status == DONE
    assert store.get(job.id).history_id == "h-1"


def test_도중에_붙으면_지나간_단계부터_이어_받는다():
    """3단계까지 흘러간 검토에 붙으면 1~3단계를 다시 받아 화면을 세운다."""
    store = JobStore()
    gate = threading.Event()
    started = threading.Event()

    def work(emit):
        emit({"key": "one", "label": "하나"})
        emit({"key": "two", "label": "둘"})
        started.set()
        gate.wait(2)
        emit({"key": "three", "label": "셋"})
        return {"ok": True}

    job = store.start("review", "a.md", "me@x.io", work)
    assert started.wait(2)

    seen = []
    stream = store.stream(job.id)
    seen.append(next(stream))             # 지나간 것부터
    seen.append(next(stream))
    assert [e["label"] for e in seen] == ["하나", "둘"]

    gate.set()
    rest = []
    for ev in stream:
        if ev.get("event") == "ping":
            continue
        rest.append(ev)
        if ev["event"] == "done":
            break
    assert [e.get("label") or e["event"] for e in rest] == ["셋", "done"]


def test_스레드에서_죽어도_작업이_error_로_닫힌다():
    """예외가 스레드에서 새면 화면이 영영 기다린다."""
    store = JobStore()

    def work(emit):
        emit({"key": "one"})
        raise RuntimeError("파싱 실패")

    job = store.start("review", "a.md", "me@x.io", work)
    for _ in range(100):
        if store.get(job.id).status != RUNNING:
            break
        time.sleep(0.02)

    assert store.get(job.id).status == ERROR
    assert store.get(job.id).error == "파싱 실패"
    assert _drain(store, job.id)[-1] == {"event": "error", "message": "파싱 실패"}


def test_목록은_내_것과_소유자_없는_것만_진행_중_먼저():
    store = JobStore()
    ready = threading.Event()

    def quick(emit):
        return {"ok": True}

    def slow(emit):
        ready.wait(2)
        return {"ok": True}

    mine_done = store.start("review", "내가 끝낸 것", "me@x.io", quick)
    theirs = store.start("review", "남의 것", "other@x.io", quick)
    legacy = store.start("review", "로그인 전", "", quick)
    mine_running = store.start("review", "내가 도는 중", "me@x.io", slow)
    time.sleep(0.1)

    titles = [j.title for j in store.list(owner="me@x.io")]
    assert titles[0] == "내가 도는 중"          # 진행 중이 먼저
    assert "남의 것" not in titles
    assert {"내가 끝낸 것", "로그인 전"} <= set(titles)
    ready.set()
    assert theirs.owner == "other@x.io" and legacy.owner == ""
    assert mine_done.id and mine_running.id


def test_오래_끝난_작업은_알림_목록에서_빠진다():
    store = JobStore()
    job = store.start("review", "어제 것", "me@x.io", lambda emit: {"ok": True})
    for _ in range(100):
        if store.get(job.id).status != RUNNING:
            break
        time.sleep(0.02)

    assert len(store.list(owner="me@x.io")) == 1
    later = time.time() + 25 * 3600            # 하루 지난 시점에서 보면
    assert store.list(owner="me@x.io", now=later) == []


def test_남의_작업은_없는_것으로_보인다():
    store = JobStore()
    job = store.start("review", "남의 것", "other@x.io", lambda emit: {"ok": True})
    assert store.get(job.id, owner="me@x.io") is None
    assert list(store.stream(job.id, owner="me@x.io")) == []
    # 소유자를 안 주면 내부 조회 — 그대로 보인다.
    assert store.get(job.id) is not None


def test_읽음_처리는_내_것만(monkeypatch):
    store = JobStore()
    mine = store.start("review", "내 것", "me@x.io", lambda emit: {"ok": True})
    theirs = store.start("review", "남의 것", "other@x.io", lambda emit: {"ok": True})
    time.sleep(0.1)

    assert store.mark_seen(owner="me@x.io") == 1
    assert store.get(mine.id).seen is True
    assert store.get(theirs.id).seen is False


def test_상한을_넘으면_오래_끝난_것부터_버린다():
    store = JobStore(max_jobs=3)
    ids = []
    for i in range(5):
        j = store.start("review", f"j{i}", "me@x.io", lambda emit: {"ok": True})
        ids.append(j.id)
        time.sleep(0.03)
    time.sleep(0.1)
    left = [j.title for j in store.list()]
    assert len(left) <= 3
    assert "j4" in left and "j0" not in left


@pytest.mark.parametrize("kind", ["review", "compare", "case"])
def test_종류가_그대로_실린다(kind):
    store = JobStore()
    job = store.start(kind, "t", "me@x.io", lambda emit: {"ok": True})
    assert store.get(job.id).as_dict()["kind"] == kind


# ── 취소 ────────────────────────────────────────────────────────────────────
# 예전 "검토 취소"는 브라우저 쪽 연결만 끊었다. 서버는 끝까지 돌아 이력에
# 저장했고, 알림이 생기면서 취소한 검토가 "검토 완료"로 뜨게 됐다.

def test_취소하면_검사가_실제로_멈추고_결과를_안_남긴다():
    store = JobStore()
    stopped = threading.Event()
    reached_end = threading.Event()

    def work(emit):
        for i in range(200):
            emit({"key": "step", "label": f"{i}"})   # 엔진은 진행을 수백 번 알린다
            time.sleep(0.005)
        reached_end.set()
        return {"history": {"id": "h-1"}}            # 여기까지 오면 안 된다

    job = store.start("review", "a.md", "me@x.io", work)
    time.sleep(0.08)                                  # 몇 단계 흘려보내고
    assert store.cancel(job.id) is True
    for _ in range(200):
        if store.get(job.id).status != RUNNING:
            stopped.set(); break
        time.sleep(0.02)

    assert stopped.is_set(), "취소했는데 안 멈춘다"
    assert store.get(job.id).status == CANCELLED
    assert not reached_end.is_set(), "취소했는데 끝까지 돌았다"
    assert store.get(job.id).history_id == "", "취소한 검토가 이력에 남았다"
    assert store.get(job.id).error == "", "취소는 오류가 아니다"


def test_취소는_실패가_아니다():
    """엔진이 emit 의 취소를 자기 예외로 감싸 올려도 '검토 실패'가 되면 안 된다 —
    사람이 멈춘 일이 도구 잘못으로 읽힌다."""
    store = JobStore()

    def work(emit):
        try:
            for _ in range(200):
                emit({"key": "step"})
                time.sleep(0.005)
        except Exception as exc:                      # 엔진이 감싸는 상황을 흉내
            raise RuntimeError(f"검토 중 오류: {exc}") from exc
        return {"ok": True}

    job = store.start("review", "a.md", "me@x.io", work)
    time.sleep(0.08)
    store.cancel(job.id)
    for _ in range(200):
        if store.get(job.id).status != RUNNING:
            break
        time.sleep(0.02)
    assert store.get(job.id).status == CANCELLED
    assert store.get(job.id).error == ""


def test_이미_끝난_작업은_취소할_것이_없다():
    store = JobStore()
    job = store.start("review", "a.md", "me@x.io", lambda emit: {"ok": True})
    for _ in range(100):
        if store.get(job.id).status != RUNNING:
            break
        time.sleep(0.02)
    assert store.cancel(job.id) is False
    assert store.get(job.id).status == DONE       # 끝난 것을 취소로 덮지 않는다


def test_남의_작업은_취소할_수_없다():
    store = JobStore()
    gate = threading.Event()

    def work(emit):
        for _ in range(200):
            emit({"key": "s"})
            time.sleep(0.005)
        return {"ok": True}

    job = store.start("review", "남의 것", "other@x.io", work)
    time.sleep(0.05)
    assert store.cancel(job.id, owner="me@x.io") is False
    assert store.get(job.id).status == RUNNING
    gate.set()
    store.cancel(job.id)                          # 뒷정리


def test_취소하면_멈춤_신호가_켜지고_작업_스레드의_LLM_클라이언트가_그것을_문다():
    from modules.llm_client import current_stop
    seen = {}
    started = threading.Event()

    def work(emit):
        seen["stop"] = current_stop()          # bind_stop 이 run() 첫머리에서 건 것
        started.set()
        while not seen["stop"].is_set():
            time.sleep(0.02)
        emit({"key": "review", "status": "running"})   # 여기서 JobCancelled
        return {}

    store = JobStore()
    job = store.start("review", "doc", "me", work)
    assert started.wait(2)
    assert seen["stop"] is job.stop and not job.stop.is_set()
    assert store.cancel(job.id, "me")
    assert job.stop.is_set()
    for _ in range(100):
        if job.status == CANCELLED:
            break
        time.sleep(0.02)
    assert job.status == CANCELLED
