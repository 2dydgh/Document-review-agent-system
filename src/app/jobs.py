"""검토 작업 — 브라우저가 아니라 서버가 들고 있는 일.

예전에는 검토가 "브라우저가 붙들고 있는 SSE 스트림"이었다. 스트림을 놓으면
(새로고침 · 탭 닫기 · 네트워크 끊김) 그 검토의 결과를 영영 못 받았다. 검사
자체는 서버 스레드에서 계속 돌아 이력에는 남았지만, 화면은 그 사실을 모른다.

여기서는 검토가 **작업**이다. 브라우저는 작업을 시작시키고 구독할 뿐이고,
끊었다 다시 붙을 수 있다(stream 이 이미 지나간 이벤트를 먼저 다시 흘린다).

메모리에 둔다. DB·작업 큐는 미정 영역이라 들이지 않는다(CLAUDE.md). 최대
사용자 50명 · 동시 10명이면 프로세스 안의 dict 하나로 충분하다. 대신 그 한계를
숨기지 않는다: **서버가 다시 시작되면 진행 중이던 작업은 사라진다.** 끝난
작업의 결과는 이력에 저장돼 있으므로 사라지는 것은 "진행 중"뿐이고, 화면은
작업이 없어진 것을 보고 중단되었다고 말한다.
"""
from __future__ import annotations

import threading
import time
import uuid
from dataclasses import dataclass, field

from modules.llm_client import bind_stop

# 프로세스 안에 쌓아 둘 작업 수. 오래된 끝난 작업부터 버린다 — 결과는 이력에
# 있으므로 여기서 사라져도 잃는 것은 "방금 끝났다"는 알림뿐이다.
MAX_JOBS = 200

# 끝난 작업을 알림 목록에 남겨 두는 시간. 지나면 목록에서 빠진다 — 사흘 전에
# 끝난 검토를 "알림"이라 부르면 그건 알림이 아니라 이력이다.
NOTICE_TTL = 24 * 3600

RUNNING, DONE, ERROR, CANCELLED = "running", "done", "error", "cancelled"


class JobCancelled(Exception):
    """사람이 검토를 멈췄다. 오류가 아니라 결정이라 따로 둔다 —
    화면이 "실패"라고 말하면 도구가 잘못한 것처럼 읽힌다."""


@dataclass
class Job:
    id: str
    kind: str                 # "review" | "compare" | "case" | "checklist"
    title: str
    owner: str
    status: str = RUNNING
    started_at: float = field(default_factory=time.time)
    finished_at: float = 0.0
    history_id: str = ""
    error: str = ""
    # 지금까지 흘린 이벤트 전부. 새로 붙는 구독자에게 다시 흘려 준다.
    events: list[dict] = field(default_factory=list)
    # 사람이 결과를 봤는가. 알림의 빨간 점이 이걸 본다.
    seen: bool = False
    # 멈춰 달라는 요청. emit 이 이걸 보고 JobCancelled 를 던져 검사를 끊는다 —
    # 검사 엔진은 진행 상황을 수백 번 알리므로 그 사이 어딘가에서 멈춘다.
    # LLM 왕복 중간에도 선다 — stop 이 켜지면 llm_client 가 진행 중인 호출을
    # 기다리지 않고 "취소됨"으로 돌려보내고, 엔진은 다음 emit 에서 JobCancelled 를 받는다.
    cancelling: bool = False
    stop: threading.Event = field(default_factory=threading.Event)

    def as_dict(self) -> dict:
        return {"id": self.id, "kind": self.kind, "title": self.title,
                "status": self.status, "started_at": self.started_at,
                "finished_at": self.finished_at, "history_id": self.history_id,
                "error": self.error, "seen": self.seen,
                "cancelling": self.cancelling,
                # 마지막 단계 이름 — 목록에서 "지금 뭘 하는 중인지" 한 줄.
                "stage": _last_stage(self.events)}


def _last_stage(events: list[dict]) -> str:
    for ev in reversed(events):
        if ev.get("event") == "stage":
            return str(ev.get("label") or ev.get("key") or "")
    return ""


class JobStore:
    def __init__(self, max_jobs: int = MAX_JOBS) -> None:
        self._jobs: dict[str, Job] = {}
        self._cond = threading.Condition()
        self._max = max_jobs

    # ---- 시작 ------------------------------------------------------------
    def start(self, kind: str, title: str, owner: str, work) -> Job:
        """work(emit) 를 스레드에서 돌린다.

        work 는 진행 상황을 emit(dict) 로 흘리고, 끝나면 payload(dict)를
        돌려준다. 예외는 여기서 잡아 작업을 error 로 닫는다 — 스레드에서 죽으면
        화면이 영영 기다린다.
        """
        job = Job(id=uuid.uuid4().hex[:16], kind=kind, title=title, owner=owner)
        with self._cond:
            self._jobs[job.id] = job
            self._prune()

        def emit(ev: dict) -> None:
            # 멈춰 달라고 했으면 여기서 끊는다. 검사 엔진 안까지 취소를 들고
            # 들어가지 않는다 — 엔진은 진행을 알릴 뿐이고, 그 통로가 이미 있다.
            if job.cancelling:
                raise JobCancelled
            if "event" not in ev:
                ev = {"event": "stage", **ev}
            with self._cond:
                job.events.append(ev)
                self._cond.notify_all()

        def run() -> None:
            # 이 스레드에서 만드는 LLM 클라이언트가 멈춤 신호를 물려받는다(레인 스레드로도
            # 인스턴스째 따라간다). 작업 큐가 GPU 경합·중단을 관리한다는 원칙 그대로다.
            bind_stop(job.stop)
            try:
                payload = work(emit)
                with self._cond:
                    job.status = DONE
                    job.finished_at = time.time()
                    job.history_id = ((payload or {}).get("history") or {}).get("id", "")
                    job.events.append({"event": "done", "payload": payload})
                    self._cond.notify_all()
            except JobCancelled:
                with self._cond:
                    job.status = CANCELLED
                    job.finished_at = time.time()
                    job.events.append({"event": "cancelled"})
                    self._cond.notify_all()
            except BaseException as exc:  # noqa: BLE001 — 죽으면 화면이 영영 기다린다
                with self._cond:
                    # 취소 요청 뒤에 난 예외는 취소로 본다. 검사 엔진이 emit 의
                    # JobCancelled 를 자기 예외로 감싸 올릴 수 있는데, 그걸
                    # "검토 실패"라고 말하면 사람이 멈춘 일이 도구 잘못이 된다.
                    if job.cancelling:
                        job.status = CANCELLED
                        job.finished_at = time.time()
                        job.events.append({"event": "cancelled"})
                    else:
                        job.status = ERROR
                        job.finished_at = time.time()
                        job.error = str(exc) or exc.__class__.__name__
                        job.events.append({"event": "error", "message": job.error})
                    self._cond.notify_all()

        threading.Thread(target=run, daemon=True).start()
        return job

    def _prune(self) -> None:
        if len(self._jobs) <= self._max:
            return
        finished = sorted((j for j in self._jobs.values() if j.status != RUNNING),
                          key=lambda j: j.finished_at)
        for job in finished[:len(self._jobs) - self._max]:
            self._jobs.pop(job.id, None)

    # ---- 읽기 ------------------------------------------------------------
    def get(self, job_id: str, owner: str | None = None) -> Job | None:
        job = self._jobs.get(job_id or "")
        if job is None:
            return None
        # 소유자를 주면 남의 작업은 없는 것으로 본다. 목록과 같은 규칙이다
        # (소유자 없는 작업 = 로그인 전에 시작한 것 → 누구에게나 보인다).
        if owner is not None and job.owner not in ("", owner):
            return None
        return job

    def list(self, owner: str | None = None, now: float | None = None) -> list[Job]:
        """진행 중인 것 먼저, 그다음 최근에 끝난 것. 오래된 완료는 뺀다."""
        now = now if now is not None else time.time()
        out = []
        for job in self._jobs.values():
            if owner is not None and job.owner not in ("", owner):
                continue
            if job.status != RUNNING and now - job.finished_at > NOTICE_TTL:
                continue
            out.append(job)
        out.sort(key=lambda j: (j.status != RUNNING, -(j.finished_at or j.started_at)))
        return out

    def cancel(self, job_id: str, owner: str | None = None) -> bool:
        """멈춰 달라고 표시한다. 실제로 멈추는 것은 검사가 다음 진행을 알릴
        때다 — 즉시 죽이지 않는다(스레드를 밖에서 죽이면 임시 파일과 반쯤 쓴
        이력이 남는다). 이미 끝난 작업에는 아무 일도 안 한다."""
        job = self.get(job_id, owner)
        if job is None or job.status != RUNNING:
            return False
        with self._cond:
            job.cancelling = True
            job.stop.set()
            self._cond.notify_all()
        return True

    def mark_seen(self, owner: str | None = None, job_id: str = "") -> int:
        """읽음 처리. job_id 를 주면 그것만, 안 주면 그 사람의 끝난 작업 전부."""
        n = 0
        with self._cond:
            for job in self._jobs.values():
                if owner is not None and job.owner not in ("", owner):
                    continue
                if job_id and job.id != job_id:
                    continue
                if not job.seen:
                    job.seen = True
                    n += 1
        return n

    # ---- 구독 ------------------------------------------------------------
    def stream(self, job_id: str, owner: str | None = None):
        """이미 지나간 이벤트를 먼저 흘리고, 그다음 새 것을 기다린다.

        **재접속이 이 함수의 존재 이유다.** 새로고침한 사람이 3단계까지 흘러간
        검토에 다시 붙으면, 1~3단계를 다시 받아 화면을 지금 상태로 세운 뒤
        이어서 본다. 끝난 작업이면 전부 흘리고 닫는다.
        """
        job = self.get(job_id, owner)
        if job is None:
            return
        i = 0
        while True:
            with self._cond:
                while i >= len(job.events) and job.status == RUNNING:
                    # 타임아웃을 둔다 — 클라이언트가 끊긴 것을 제너레이터가
                    # 알아채려면 한 번씩 깨어나 yield 를 시도해야 한다.
                    self._cond.wait(timeout=15.0)
                batch = job.events[i:]
                i = len(job.events)
                ended = job.status != RUNNING and not batch
            for ev in batch:
                yield ev
            if ended:
                return
            if not batch:
                # 15초 동안 아무 일도 없었다 — 살아 있음을 알린다(프록시가
                # 조용한 연결을 끊는 것도 막는다).
                yield {"event": "ping"}
