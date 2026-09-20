"""가짜 DoSuree — `dsr --mode rpc` 의 표준입출력 규약만 흉내 낸다(tests/test_web_chat.py).

ready 를 내고, prompt 를 받으면 정해진 이벤트를 흘리고, 세션 명령(new_session ·
switch_session · get_state · get_messages · set_session_name)에 응답 프레임을 내고,
stdin 이 닫히면 0 으로 끝난다. 세션 파일은 $HOME/.dsr/agent/sessions/ 아래 .jsonl.
"""
import json
import os
import sys
import uuid
from pathlib import Path


def emit(frame: dict) -> None:
    sys.stdout.write(json.dumps(frame, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def respond(cmd: dict, data: dict | None = None, ok: bool = True, error: str = "") -> None:
    frame = {"id": cmd.get("id"), "type": "response", "command": cmd.get("type"), "success": ok}
    if data is not None:
        frame["data"] = data
    if error:
        frame["error"] = error
    emit(frame)


class Session:
    def __init__(self, sessions_dir: Path) -> None:
        self.path = sessions_dir / f"{uuid.uuid4().hex}.jsonl"
        self.path.write_text("", encoding="utf-8")
        self.name = ""
        self.messages: list[dict] = []

    def save(self) -> None:
        self.path.write_text("\n".join(json.dumps(m, ensure_ascii=False) for m in self.messages),
                             encoding="utf-8")


def main() -> int:
    sessions_dir = Path(os.environ.get("HOME", ".")) / ".dsr" / "agent" / "sessions"
    sessions_dir.mkdir(parents=True, exist_ok=True)
    known: dict[str, Session] = {}
    cur = Session(sessions_dir)
    known[str(cur.path)] = cur
    # 프로세스가 몇 번 떴는지 테스트가 세게 pid 를 남긴다(도구 없는 프로세스 교체 검사).
    with open(sessions_dir.parent / "fake_pids.log", "a", encoding="utf-8") as fh:
        fh.write(f"{os.getpid()}\n")
    emit({"type": "ready", "protocolVersions": [1]})
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        cmd = json.loads(line)
        t = cmd.get("type")
        if t == "prompt":
            msg = cmd.get("message", "")
            if "죽어" in msg:
                return 3
            respond(cmd, {"agentInvoked": True})
            cur.messages.append({"role": "user", "content": [{"type": "text", "text": msg}]})
            emit({"type": "agent_start"})
            if "없는도구" in msg:
                # 도구 목록이 안 붙은 DoSuree 가 하는 짓 — 지어낸 이름을 부르고 not found.
                emit({"type": "tool_execution_start", "toolCallId": "t0",
                      "toolName": "mcp__docsuree__list_documents", "args": {}})
                emit({"type": "tool_execution_end", "toolCallId": "t0",
                      "toolName": "mcp__docsuree__list_documents",
                      "result": "Tool mcp__docsuree__list_documents not found", "isError": True})
            emit({"type": "tool_execution_start", "toolCallId": "t1",
                  "toolName": "mcp__docsuree_get_review", "args": {"id": "r1"}})
            emit({"type": "tool_execution_end", "toolCallId": "t1",
                  "toolName": "mcp__docsuree_get_review", "result": {}, "isError": False})
            reply = "받은 말: " + msg[-20:]
            for delta in ("받은 말: ", msg[-20:]):
                emit({"type": "message_update", "assistantMessageEvent": {
                    "type": "text_delta", "contentIndex": 0, "delta": delta}})
            cur.messages.append({"role": "assistant", "content": [
                {"type": "toolCall", "name": "mcp__docsuree_get_review", "arguments": {"id": "r1"}},
                {"type": "text", "text": reply}]})
            cur.save()
            emit({"type": "agent_end", "messages": [], "isTerminal": True})
        elif t == "abort":
            emit({"type": "agent_end", "messages": []})
        elif t == "new_session":
            cur = Session(sessions_dir)
            known[str(cur.path)] = cur
            respond(cmd, {})
        elif t == "get_state":
            respond(cmd, {"sessionFile": str(cur.path), "sessionId": cur.path.stem,
                          "sessionName": cur.name})
        elif t == "switch_session":
            path = str(cmd.get("sessionPath") or "")
            if path not in known:
                if not Path(path).is_file():
                    respond(cmd, ok=False, error="session not found")
                    continue
                known[path] = Session.__new__(Session)
                known[path].path, known[path].name, known[path].messages = Path(path), "", []
            cur = known[path]
            respond(cmd, {})
        elif t == "set_session_name":
            cur.name = str(cmd.get("name") or "")
            respond(cmd, {})
        elif t == "get_messages":
            respond(cmd, {"messages": list(cur.messages)})
        else:
            respond(cmd, ok=False, error=f"unknown command {t}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
