"""어시스턴트 — 서버가 사용자마다 DoSuree 를 화면 없이 돌린다(A 안 2판).

설계: docs/superpowers/specs/2026-09-10-docsuree-chat-panel-design.md

브라우저 ↔ 이 모듈 ↔ `dsr --mode rpc`(자식 프로세스). DoSuree 는 표준입출력으로
JSON 한 줄씩 주고받고(DoSuree docs/rpc.md), 브라우저 쪽은 검토 진행에 이미 쓰는
SSE 다. 여기는 프레임을 옮기고 세션 색인을 들 뿐 대화 내용을 해석하지 않는다.

DoSuree 가 DocSuree 를 읽는 길은 1단계의 `/mcp` 다 — 자식 프로세스가 localhost 로
자기 서버를 두드린다. 토큰은 그 사용자의 것이라 범위가 웹과 같다.

대화는 DoSuree 세션 파일(.jsonl)로 **사용자 폴더** 에 남는다. DocSuree 는 그 목록
(색인 JSON)만 든다 — 리포트·판정은 DocSuree DB, 대화는 DoSuree 파일. 30일 뒤 지운다.

# ponytail: 프로세스 수명은 "10분 무응답이면 stdin 닫기" 하나. 색인은 JSON 파일 하나.
# 사용자당 대화 수십 개 규모라 DB 표가 필요 없다.
"""
from __future__ import annotations

import hashlib
import json
import os
import shlex
import subprocess
import threading
import time
import uuid
from collections.abc import Callable, Iterator
from pathlib import Path

from .mcp import TOOLS

#: DocSuree 팀 id → DoSuree 팀 id. 두 제품이 따로 자랐다(DoSuree config/teams.ts).
#: 없는 팀은 지침 없이 돈다 — 지어내지 않는다.
TEAM_IDS = {
    "ax-quality": "ax-quality",
    "ai-reliability-1": "ai-reliability-1", "ai-reliability-2": "ai-reliability-2",
    "ai-test-cert-1": "ai-certification-1", "ai-test-cert-2": "ai-certification-2",
    "EV1": "energy-verification-1", "EV2": "energy-verification-2",
    "EV3": "energy-verification-3",
}
IDLE_SECONDS = 600
MAX_WORKERS = 20
HEARTBEAT_SECONDS = 15.0
CALL_TIMEOUT = 10.0
RETENTION_DAYS = 30
TITLE_CHARS = 40


class ChatError(Exception):
    """화면에 그대로 보여줄 실패 이유."""


def _translate(frame: dict) -> dict | None:
    """DoSuree 이벤트 프레임 → 화면 이벤트. 화면이 안 쓰는 프레임은 None."""
    t = frame.get("type")
    if t == "agent_start":
        return {"event": "turn", "state": "start"}
    if t == "agent_end":
        # isTerminal: false 는 "아직 더 돈다"(DoSuree rpc.md). 끝으로 치지 않는다.
        return None if frame.get("isTerminal") is False else {"event": "turn", "state": "end"}
    if t == "message_update":
        ame = frame.get("assistantMessageEvent") or {}
        if ame.get("type") == "text_delta" and ame.get("delta"):
            return {"event": "text", "delta": str(ame["delta"])}
        return None
    if t == "tool_execution_start":
        return {"event": "tool", "name": str(frame.get("toolName") or ""),
                "args": frame.get("args") if isinstance(frame.get("args"), dict) else {}}
    if t == "tool_execution_end":
        return {"event": "tool_done", "name": str(frame.get("toolName") or ""),
                "ok": not frame.get("isError")}
    return None


def _message_view(m: dict) -> dict | None:
    """DoSuree 저장 메시지 → 말풍선. 형식은 방어적으로 읽는다 — 글 조각은 이어 붙이고
    toolCall 블록은 이름만 남긴다. 사람·어시스턴트 말이 아니면 None."""
    role = m.get("role")
    if role not in ("user", "assistant"):
        return None
    content = m.get("content")
    texts, tools = [], []
    if isinstance(content, str):
        texts.append(content)
    elif isinstance(content, list):
        for block in content:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "text" and block.get("text"):
                texts.append(str(block["text"]))
            elif block.get("type") in ("toolCall", "tool_call", "toolcall"):
                tools.append({"name": str(block.get("name") or block.get("toolName") or ""),
                              "done": True, "ok": True})
    text = "\n".join(texts).strip()
    if role == "user":
        # 규칙·문맥 머리말은 화면에 안 보인다(say 가 붙인 것). 둘 다 "[…]\n\n" 꼴이라 앞에서
        # 차례로 벗긴다.
        while text.startswith(("[DocSuree 어시스턴트 규칙", "[지금 보고 있는 DocSuree 검토")):
            text = text.split("]\n\n", 1)[-1]
    if not text and not tools:
        return None
    return {"role": role, "text": text, "tools": tools}


#: DoSuree 가 MCP 도구에 붙이는 이름 — 서버 이름 뒤 밑줄 하나(실측 2026-09-17).
KNOWN_TOOLS = frozenset("mcp__docsuree_" + t["name"] for t in TOOLS)

#: 대화마다 한 번 앞에 붙이는 규칙. 시스템 프롬프트 자리가 없어 첫 말에 실린다.
#: 한국어 — 도구가 안 붙은 세션에서 영어로 답하다 "왜 영어로 해"를 들었다(2026-09-17).
RULES = ("[DocSuree 어시스턴트 규칙: 답은 한국어로 쓴다. 도구는 목록에 있는 것만 부르고, "
         "없는 도구 이름을 지어내지 않는다 — 없으면 없다고 말한다. 문서를 인용할 때는 "
         "도구 결과의 문장을 그대로 쓴다. 판정은 바꾸지 않는다.]")


class ChatWorker:
    """사용자 한 명의 DoSuree 프로세스 — 이벤트 기록과 명령 응답 대기."""

    def __init__(self, email: str, argv: list[str], home: Path, env: dict[str, str]) -> None:
        self.email = email
        self.home = home
        self.events: list[dict] = []
        self.cond = threading.Condition()
        self.last_active = time.time()
        self.review_id = ""
        self.session_path = ""
        self.rules_path = ""        # 규칙 머리말을 보낸 세션 — 세션당 한 번
        self.tools_missing = False  # DocSuree 도구 없이 뜬 프로세스 — 다음 말에 새로 띄운다
        self.busy = False
        self.closed = False
        self._responses: dict[str, dict] = {}
        self._seq = 0
        self.proc = subprocess.Popen(
            argv, cwd=str(home), env=env, text=True, bufsize=1, encoding="utf-8",
            stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            # stderr 는 사용자 폴더에 남긴다 — DoSuree 가 왜 안 붙었는지 볼 유일한 창이다.
            stderr=open(home / "dsr.stderr.log", "ab"))
        threading.Thread(target=self._read, daemon=True,
                         name=f"chat-{email}").start()

    def _push(self, ev: dict) -> None:
        with self.cond:
            if ev.get("event") == "turn":
                self.busy = ev.get("state") == "start"
            self.events.append(ev)
            self.cond.notify_all()

    def _read(self) -> None:
        assert self.proc.stdout is not None
        for line in self.proc.stdout:
            line = line.strip()
            if not line:
                continue
            try:
                frame = json.loads(line)
            except json.JSONDecodeError:
                continue        # DoSuree 가 낸 것이 아닌 잡음. 화면에 못 보여줄 것이다
            if not isinstance(frame, dict):
                continue
            if frame.get("type") == "extension_ui_request":
                # 화면 없는 호스트다. 물어보는 요청(select·confirm·input·editor)은 취소로
                # 답한다 — 안 답하면 그 도구 호출이 영원히 기다린다(실측: "RPC client
                # disconnected before extension UI response"). 위젯·알림은 답이 필요 없다.
                if frame.get("method") in ("select", "confirm", "input", "editor"):
                    try:
                        self.send({"type": "extension_ui_response",
                                   "id": str(frame.get("id") or ""), "cancelled": True})
                    except ChatError:
                        pass
                continue
            if frame.get("type") == "response":
                rid = str(frame.get("id") or "")
                with self.cond:
                    if rid:
                        self._responses[rid] = frame
                    self.cond.notify_all()
                if frame.get("command") == "prompt" and frame.get("success") is False:
                    self._push({"event": "error", "message": str(
                        frame.get("error") or "DoSuree 가 명령을 거절했습니다.")})
                continue
            if frame.get("type") == "tool_execution_end" and frame.get("isError"):
                # 모델이 우리 도구를 **없는 이름**으로 불렀다(mcp__docsuree__list_documents 처럼) —
                # 도구 목록이 아예 안 붙은 프로세스다(실측 2026-09-17: 영어로 헤매다 멈췄다).
                # 이 프로세스로는 답이 안 나온다. 표시해 두고 다음 말에 새로 띄운다.
                name = str(frame.get("toolName") or "")
                if name.startswith("mcp__docsuree") and name not in KNOWN_TOOLS:
                    self.tools_missing = True
            ev = _translate(frame)
            if ev:
                self._push(ev)
        code = self.proc.wait()
        with self.cond:
            self.closed = True
            self.busy = False
        # 정상 종료(0)는 우리가 stdin 을 닫은 것이다. 아니면 DoSuree 가 죽었다 —
        # 조용히 사라지면 화면이 "답하는 중"에 굳는다.
        self._push({"event": "closed", "code": code})

    def send(self, frame: dict) -> None:
        if self.closed or self.proc.stdin is None:
            raise ChatError("대화 프로세스가 끝났습니다. 다시 보내면 새로 시작합니다.")
        try:
            self.proc.stdin.write(json.dumps(frame, ensure_ascii=False) + "\n")
            self.proc.stdin.flush()
        except (BrokenPipeError, OSError):
            raise ChatError("대화 프로세스가 끝났습니다. 다시 보내면 새로 시작합니다.") from None
        self.last_active = time.time()

    def call(self, frame: dict, timeout: float = CALL_TIMEOUT) -> dict:
        """명령을 보내고 그 id 의 응답을 기다린다. 실패 응답은 ChatError."""
        self._seq += 1
        rid = f"c{self._seq}"
        self.send({**frame, "id": rid})
        deadline = time.time() + timeout
        with self.cond:
            while rid not in self._responses and not self.closed:
                left = deadline - time.time()
                if left <= 0:
                    raise ChatError(f"DoSuree 가 {frame.get('type')} 에 답하지 않습니다.")
                self.cond.wait(timeout=left)
            resp = self._responses.pop(rid, None)
        if resp is None:
            raise ChatError("대화 프로세스가 끝났습니다. 다시 보내면 새로 시작합니다.")
        if resp.get("success") is False:
            raise ChatError(str(resp.get("error") or f"{frame.get('type')} 실패"))
        data = resp.get("data")
        return data if isinstance(data, dict) else {}

    def close(self) -> None:
        try:
            if self.proc.stdin:
                self.proc.stdin.close()     # DoSuree 는 stdin 이 닫히면 정리하고 0 으로 끝난다
            self.proc.wait(timeout=5)
        except (OSError, subprocess.TimeoutExpired):
            self.proc.kill()


class ChatWorkers:
    """사용자별 프로세스와 대화 색인. 열고, 말 넘기고, 흘리고, 놀면 닫는다."""

    def __init__(self, root: Path, dsr_bin: str, *, mcp_url: str, llm_base_url: str,
                 issue_token: Callable[[str], str], team_of: Callable[[str], str],
                 max_workers: int = MAX_WORKERS, idle_seconds: int = IDLE_SECONDS) -> None:
        self.root = Path(root)
        # 도구를 **명시**하고 승인을 끈다. 실측(2026-09-14, 리눅스 DoSuree v0.0.2):
        #  · rpc 모드는 MCP 도구를 세션 생성 때 붙이고, 그 뒤 작업 유형(V&V) 필터가 이름으로
        #    걸러 DocSuree 도구까지 지웠다 — 모델이 read·glob 으로 서버 파일을 뒤졌다.
        #    --tools 를 주면 그 필터를 건너뛰고 MCP 도구는 그대로 활성이다.
        #  · 남기는 내장 도구는 todo 하나. read·grep·glob 도 빼는 이유는 서버에서 도는
        #    프로세스라 그 도구로 다른 사람 폴더·DB 파일까지 읽을 수 있기 때문이다.
        #    문서 본문은 DocSuree 도구(find_in_document·read_section)가 준다.
        #  · V&V 작업 유형은 도구마다 "Allow tool?" 승인을 호스트에 묻는다. 답이 없으면
        #    영원히 기다린다. 남은 도구가 전부 읽기 전용이라 --yolo 로 승인을 끈다.
        self.dsr_bin = dsr_bin.strip()
        self.argv = [*shlex.split(self.dsr_bin), "--mode", "rpc", "--tools", "todo", "--yolo"]
        self.mcp_url = mcp_url
        self.llm_base_url = llm_base_url
        self.issue_token = issue_token
        self.team_of = team_of
        self.max_workers = max_workers
        self.idle_seconds = idle_seconds
        self._workers: dict[str, ChatWorker] = {}
        self._lock = threading.Lock()

    @property
    def enabled(self) -> bool:
        return bool(self.dsr_bin)

    # ---- 사용자 폴더 ---------------------------------------------------------
    def home_of(self, email: str) -> Path:
        return self.root / hashlib.sha256(email.encode("utf-8")).hexdigest()[:16]

    def _prepare_home(self, email: str) -> Path:
        # 폴더 하나가 곧 격리다 — DoSuree 는 작업 폴더의 .dsr/ 를 사용자 설정보다 먼저
        # 읽고, HOME 도 여기라 세션·캐시가 전부 이 아래에 쌓인다. 토큰은 열 때마다 새로
        # 쓴다(만료 대비).
        home = self.home_of(email)
        mcp = json.dumps({"mcpServers": {"docsuree": {
            "type": "http", "url": self.mcp_url,
            "headers": {"Authorization": f"Bearer {self.issue_token(email)}"}}}},
            ensure_ascii=False, indent=2)
        team = TEAM_IDS.get(self.team_of(email) or "", "")
        cfg = "workType: doc-verification\n" + (f"team: {team}\n" if team else "")
        # 사용자 범위(~/.dsr/agent/)와 프로젝트 범위(<cwd>/.dsr/) 둘 다에 쓴다. 윈도우에서
        # 붙었던 자리는 사용자 범위였고, 작업 유형도 마법사가 거기 저장하는 값이다 —
        # 프로젝트 범위만 썼더니 실서버 실측(2026-09-14)에서 MCP 도 V&V 도 안 먹었다.
        for d in (home / ".dsr" / "agent", home / ".dsr"):
            d.mkdir(parents=True, exist_ok=True)
            (d / "mcp.json").write_text(mcp, encoding="utf-8")
            (d / "config.yml").write_text(cfg, encoding="utf-8")
        return home

    def _spawn(self, email: str) -> ChatWorker:
        self.reap()
        if len(self._workers) >= self.max_workers:
            raise ChatError("지금은 어시스턴트를 열 수 없습니다"
                            f"(동시 사용 상한 {self.max_workers}명). 잠시 뒤 다시 시도하세요.")
        home = self._prepare_home(email)
        env = {"PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
               "HOME": str(home), "DSR_LLM_BASE_URL": self.llm_base_url}
        try:
            worker = ChatWorker(email, self.argv, home, env)
        except OSError as exc:
            raise ChatError(f"DoSuree 를 띄우지 못했습니다: {exc}") from exc
        self._workers[email] = worker
        return worker

    def _alive(self, email: str) -> ChatWorker | None:
        w = self._workers.get(email)
        if w is None or w.closed:
            self._workers.pop(email, None)
            return None
        return w

    def get_or_open(self, email: str) -> ChatWorker:
        with self._lock:
            return self._alive(email) or self._spawn(email)

    # ---- 색인 -----------------------------------------------------------------
    def _index_path(self, email: str) -> Path:
        return self.home_of(email) / "sessions.json"

    def _load_index(self, email: str) -> list[dict]:
        try:
            data = json.loads(self._index_path(email).read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return []
        return [e for e in data if isinstance(e, dict)] if isinstance(data, list) else []

    def _save_index(self, email: str, entries: list[dict]) -> None:
        path = self._index_path(email)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(entries, ensure_ascii=False, indent=1), encoding="utf-8")

    def _entry_for_path(self, email: str, path: str) -> dict | None:
        return next((e for e in self._load_index(email) if e.get("path") == path), None)

    def _touch(self, email: str, path: str, *, title: str = "", review_id: str = "",
               review_title: str = "") -> dict:
        """색인에 path 가 없으면 만들고, 있으면 갱신. 돌려주는 것은 그 항목."""
        entries = self._load_index(email)
        now = time.time()
        entry = next((e for e in entries if e.get("path") == path), None)
        if entry is None:
            entry = {"id": uuid.uuid4().hex[:12], "path": path, "title": "",
                     "review_id": "", "review_title": "", "created": now, "updated": now}
            entries.insert(0, entry)
        if title and not entry.get("title"):
            # 검토를 안고 시작한 대화는 문서 이름이 앞에 선다 — "이 검토에서…"만 여럿 쌓이면
            # 어느 문서 얘기인지 목록에서 구별이 안 됐다(2026-09-15). 문서 이름은 짧게 잘라
            # 말이 들어갈 자리를 남긴다.
            head = review_title or str(entry.get("review_title") or "")
            if head:
                # 비교 검토("A ↔ B")는 두 이름을 각각 줄인다 — 앞 20자만 남기면 두 번째
                # 문서가 통째로 사라진다.
                parts = head.split(" ↔ ")
                head = " ↔ ".join(x[:12] for x in parts) if len(parts) == 2 else head[:20]
                title = head + " · " + title
            entry["title"] = title[:TITLE_CHARS]
        if review_id and not entry.get("review_id"):
            entry["review_id"], entry["review_title"] = review_id, review_title
        entry["updated"] = now
        entries.sort(key=lambda e: e.get("updated", 0), reverse=True)
        self._save_index(email, entries)
        return entry

    def _ensure_session(self, worker: ChatWorker) -> str:
        """지금 세션 파일 경로. 모르면 get_state 로 묻는다(프로세스가 막 떴을 때)."""
        if not worker.session_path:
            state = worker.call({"type": "get_state"})
            worker.session_path = str(state.get("sessionFile") or "")
            if not worker.session_path:
                raise ChatError("DoSuree 가 세션 파일 경로를 주지 않았습니다.")
        return worker.session_path

    def sessions(self, email: str) -> list[dict]:
        """색인 그대로. 파일이 없어진 항목은 missing 으로 표시한다 — 조용히 안 지운다."""
        out = []
        for e in self._load_index(email):
            out.append({**e, "missing": not Path(e.get("path") or "").is_file()})
        return out

    def new_session(self, email: str, *, review_id: str = "", review_title: str = "") -> dict:
        worker = self.get_or_open(email)
        if worker.busy:
            raise ChatError("답하는 중에는 새 대화를 열 수 없습니다. 멈춘 뒤 다시 하세요.")
        worker.call({"type": "new_session"})
        worker.session_path, worker.review_id = "", ""
        path = self._ensure_session(worker)
        return self._touch(email, path, review_id=review_id, review_title=review_title)

    def open_session(self, email: str, sid: str) -> tuple[dict, list[dict]]:
        entry = next((e for e in self._load_index(email) if e.get("id") == sid), None)
        if entry is None:
            raise ChatError("없는 대화입니다.")
        if not Path(entry.get("path") or "").is_file():
            raise ChatError("대화 파일이 지워졌습니다(보관 기간이 지났거나 삭제됨).")
        worker = self.get_or_open(email)
        if worker.busy:
            raise ChatError("답하는 중에는 다른 대화를 열 수 없습니다. 멈춘 뒤 다시 하세요.")
        if worker.session_path != entry["path"]:
            worker.call({"type": "switch_session", "sessionPath": entry["path"]})
            worker.session_path = entry["path"]
            worker.review_id = ""   # 문맥 머리말은 대화당 한 번 — 이어 열면 이미 안에 있다
            if entry.get("review_id"):
                worker.review_id = entry["review_id"]
        data = worker.call({"type": "get_messages"})
        raw = data.get("messages") if isinstance(data.get("messages"), list) else []
        messages = [v for v in (_message_view(m) for m in raw if isinstance(m, dict)) if v]
        return entry, messages

    def rename_session(self, email: str, sid: str, title: str) -> dict:
        title = (title or "").strip()[:TITLE_CHARS]
        if not title:
            raise ChatError("이름이 비어 있습니다.")
        entries = self._load_index(email)
        entry = next((e for e in entries if e.get("id") == sid), None)
        if entry is None:
            raise ChatError("없는 대화입니다.")
        worker = self._alive_locked(email)
        if worker is not None and worker.session_path == entry.get("path"):
            worker.call({"type": "set_session_name", "name": title})
        entry["title"] = title
        self._save_index(email, entries)
        return entry

    def delete_session(self, email: str, sid: str) -> None:
        entries = self._load_index(email)
        entry = next((e for e in entries if e.get("id") == sid), None)
        if entry is None:
            raise ChatError("없는 대화입니다.")
        worker = self._alive_locked(email)
        if worker is not None and worker.session_path == entry.get("path"):
            if worker.busy:
                raise ChatError("답하는 중인 대화는 지울 수 없습니다. 멈춘 뒤 다시 하세요.")
            worker.call({"type": "new_session"})
            worker.session_path, worker.review_id = "", ""
        self._save_index(email, [e for e in entries if e.get("id") != sid])
        try:
            Path(entry.get("path") or "").unlink()
        except OSError:
            pass

    def _alive_locked(self, email: str) -> ChatWorker | None:
        with self._lock:
            return self._alive(email)

    # ---- 말 --------------------------------------------------------------------
    def say(self, email: str, message: str, *, review_id: str = "",
            title: str = "") -> tuple[dict, int]:
        """말을 넘기고 (색인 항목, 이 턴이 시작하는 이벤트 번호)를 돌려준다.

        이벤트 기록은 프로세스(=사람) 단위라 대화를 바꿔도 이어진다. 화면이 0번부터
        읽으면 지난 턴(다른 대화, 다른 창)의 답을 이번 것으로 보여주고 그 턴의 끝에서
        멈춘다 — 실측(2026-09-14): 같은 계정으로 curl 이 물은 답이 브라우저에 떴다.
        """
        message = (message or "").strip()
        if not message:
            raise ChatError("보낼 말이 비어 있습니다.")
        if len(message) > 4000:
            raise ChatError("한 번에 4000자까지 보낼 수 있습니다.")
        worker = self.get_or_open(email)
        if worker.busy:
            raise ChatError("아직 답하는 중입니다. 끝나거나 멈춘 뒤 보내세요.")
        if worker.tools_missing:
            worker = self._respawn(email, worker)
        path = self._ensure_session(worker)
        entry = self._touch(email, path, title=message, review_id=review_id, review_title=title)
        review_id = review_id or str(entry.get("review_id") or "")
        title = title or str(entry.get("review_title") or "")
        shown = message
        # "이 검토"가 무엇인지는 대화당 한 번만 알린다 — 따로 한 턴을 쓰면 모델 호출이
        # 하나 늘고, 매번 붙이면 말이 길어진다.
        if review_id and worker.review_id != review_id:
            worker.review_id = review_id
            message = (f"[지금 보고 있는 DocSuree 검토: id={review_id} · {title}. "
                       "질문에 답할 때 이 검토를 기본으로 본다. 문서를 인용할 때는 "
                       "도구 결과의 문장을 그대로 쓴다. 판정은 웹의 버튼으로만 바뀐다.]\n\n"
                       + message)
        if worker.rules_path != path:
            worker.rules_path = path
            message = RULES + "\n\n" + message
        with worker.cond:
            start = len(worker.events)
        worker.send({"type": "prompt", "message": message})
        worker._push({"event": "user", "text": shown})
        return entry, start

    def _respawn(self, email: str, worker: ChatWorker) -> ChatWorker:
        """도구 없이 뜬 프로세스를 내리고 같은 대화로 새로 띄운다."""
        keep = worker.session_path
        worker.close()
        with self._lock:
            self._workers.pop(email, None)
        fresh = self.get_or_open(email)
        if keep:
            fresh.call({"type": "switch_session", "sessionPath": keep})
            fresh.session_path = keep
        return fresh

    def abort(self, email: str) -> None:
        worker = self._alive_locked(email)
        if worker is not None:
            worker.send({"type": "abort"})

    def stream(self, email: str, since: int = 0) -> Iterator[dict]:
        """since 번째부터 이벤트를 흘리고, **턴이 끝나면 스트림도 끝낸다.**

        끝나지 않는 스트림은 브라우저가 붙들고 있어야 하고 테스트 클라이언트는 아예
        못 읽는다. 말 한 번 = 스트림 한 번이 검토 진행 표시와 같은 꼴이다. 이벤트마다
        번호(i)를 실어, 끊긴 뒤 `since` 로 이어 받는다.
        """
        worker = self.get_or_open(email)
        i = max(0, int(since))
        while True:
            with worker.cond:
                while i >= len(worker.events) and not worker.closed:
                    worker.cond.wait(timeout=HEARTBEAT_SECONDS)
                batch = list(enumerate(worker.events[i:], start=i))
                i = len(worker.events)
                closed = worker.closed
            for n, ev in batch:
                yield {**ev, "i": n}
                if (ev.get("event") == "turn" and ev.get("state") == "end") \
                        or ev.get("event") in ("closed", "error"):
                    return
            if closed and not batch:
                return
            if not batch:
                yield {"event": "ping", "i": i}

    # ---- 청소 -------------------------------------------------------------------
    def reap(self) -> None:
        """놀고 있는 프로세스를 닫는다. 새로 열 때와 주기적으로 부른다."""
        now = time.time()
        for email, w in list(self._workers.items()):
            if w.closed or now - w.last_active > self.idle_seconds:
                w.close()
                self._workers.pop(email, None)

    def purge_old(self, days: int = RETENTION_DAYS) -> int:
        """보관 기간이 지난 대화를 색인·파일에서 지운다. 원본 30일 삭제와 같은 규칙."""
        cutoff = time.time() - days * 86400
        removed = 0
        if not self.root.is_dir():
            return 0
        for home in self.root.iterdir():
            index = home / "sessions.json"
            if not index.is_file():
                continue
            try:
                entries = json.loads(index.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            keep = []
            for e in entries if isinstance(entries, list) else []:
                if isinstance(e, dict) and float(e.get("updated") or 0) < cutoff:
                    try:
                        Path(e.get("path") or "").unlink()
                    except OSError:
                        pass
                    removed += 1
                else:
                    keep.append(e)
            if removed:
                index.write_text(json.dumps(keep, ensure_ascii=False, indent=1), encoding="utf-8")
        return removed

    def close_all(self) -> None:
        with self._lock:
            for w in self._workers.values():
                w.close()
            self._workers.clear()
