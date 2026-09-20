"""DoSuree(사내 에이전트 CLI)가 검토 결과를 **도구로 읽는** MCP 서버.

설계: docs/superpowers/specs/2026-09-10-dosuree-mcp-bridge-design.md

검토 파이프라인은 그대로 두고, 그 결과 위에서 검토자와 대화하는 에이전트 자리를
DoSuree 에 둔다. 여기는 DocSuree 가 가진 것(검토 결과·저장된 본문)을 읽기 전용
도구로 내주는 얇은 껍데기다 — 도구 본체는 HistoryStore 와 modules.shared.DocTools
를 그대로 부른다.

MCP(Streamable HTTP)는 JSON-RPC 네 메서드만 구현한다. initialize ·
notifications/initialized · tools/list · tools/call. DoSuree 의 HTTP 전송은
응답이 application/json 이면 그대로 읽고, GET 알림 스트림은 없어도 되고, 세션
헤더는 서버가 안 주면 안 쓴다(저장소 확인, 2026-09-10).

# ponytail: MCP 네 메서드만. DoSuree 가 SSE·세션·리소스를 요구하면 mcp SDK 로
# 껍데기만 교체한다 — 도구 함수는 그대로.

쓰기 도구는 없다. 판정·삭제·기준 수정은 웹에서 한다 — 리포트는 감사 산출물이고
대화는 아니다. "권한 없는 id" 와 "없는 id" 는 갈라 말하지 않는다(존재 여부가 새면
정보다).
"""
from __future__ import annotations

import json
from collections.abc import Callable

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response

from modules.shared import Anchor, DocTools, Document, Section

from .history import HistoryError, HistoryStore

#: MCP 규격 판. 클라이언트가 다른 판을 요청하면 그 값을 그대로 돌려준다 —
#: 우리가 쓰는 네 메서드는 판이 갈려도 같다.
PROTOCOL_VERSION = "2025-06-18"
SERVER_INFO = {"name": "docsuree", "version": "0.1"}

#: 도구 목록. 이름·인자는 설계 §4 표와 같아야 한다(테스트가 대조한다).
TOOLS: list[dict] = [
    {
        "name": "list_reviews",
        "description": "내가 볼 수 있는 검토 기록 목록(같은 팀 + 소유자 없는 기록, 관리자는 전부). "
                       "문서 이름으로 검색할 수 있다. 결과의 id 로 get_review 를 부른다.",
        "inputSchema": {"type": "object", "properties": {
            "q": {"type": "string", "description": "문서 이름 검색어(선택)"},
            "kind": {"type": "string",
                     "enum": ["", "review", "compare", "case", "checklist", "evaluation"],
                     "description": "검토 종류(선택). review=단일 · compare=비교 · "
                                    "evaluation=체크리스트 검토(평가표 초안)"},
            "limit": {"type": "integer", "minimum": 1, "maximum": 100}}},
    },
    {
        "name": "get_review",
        "description": "검토 결과 하나. 지적(심각도·절·쪽·메시지·근거 인용)과 **미검토 목록·"
                       "검토 과정 보고를 분리해서** 준다. 지적 0건은 '이상 없음'이 아니다 — "
                       "unreviewed 가 비었는지 같이 봐야 한다. 심각도는 화면 말로 말한다: "
                       "지적(major·minor 를 가르지 않는다). counts 와 목록 개수를 대조한다. "
                       "체크리스트 검토(kind=evaluation)는 지적이 아니라 draft.rows — 항목마다 "
                       "status(drafted=근거 확인해 씀 · not_found=찾아봤는데 없음 · "
                       "unreviewed=모델 주장 폐기)와 판정 제안·인용을 준다.",
        "inputSchema": {"type": "object", "required": ["id"], "properties": {
            "id": {"type": "string", "description": "검토 기록 id (list_reviews 결과)"}}},
    },
    {
        "name": "search_findings",
        "description": "내가 볼 수 있는 **여러 검토 기록의 지적을 한 번에** 찾는다 — "
                       "'지난 검토들에도 같은 지적이 있었나', '이 팀에 자주 나오는 문제'. "
                       "낱말은 지적 문장·검사기·"
                       "종류·문서명에서 찾는다. 얇은 행(기록 id·문서·날짜·검사기·심각도·문장)만 "
                       "주니 자세한 건 get_review 로 연다. 체크리스트 검토의 초안 행은 여기 없다.",
        "inputSchema": {"type": "object", "properties": {
            "q": {"type": "string", "description": "낱말(띄어 쓰면 모두 있어야 함)"},
            "kind": {"type": "string", "enum": ["", "review", "compare", "case"],
                     "description": "검토 종류(선택)"},
            "checker": {"type": "string",
                        "description": "검사기 이름(선택, get_review 의 checker)"},
            "sev": {"type": "string", "enum": ["", "major", "minor", "info"],
                    "description": "내부 심각도(선택). 사용자에게는 '지적'이라고만 말한다"},
            "since": {"type": "string", "description": "이 시각(ISO) 이후 기록만(선택)"},
            "limit": {"type": "integer", "minimum": 1, "maximum": 300}}},
    },
    {
        "name": "find_in_document",
        "description": "검토 때 저장된 문서 본문에서 낱말이 나오는 줄과 위치를 찾는다. "
                       "문서를 인용할 때는 여기서 돌려준 문장을 그대로 쓴다.",
        "inputSchema": {"type": "object", "required": ["id", "term"], "properties": {
            "id": {"type": "string"},
            "term": {"type": "string", "description": "찾을 낱말"},
            "slot": {"type": "string", "enum": ["", "A", "B"],
                     "description": "비교 검토의 상위(A)·하위(B). 단일 검토는 비운다"}}},
    },
    {
        "name": "list_sections",
        "description": "저장된 문서의 목차: 절마다 [id] 제목 (쪽). 어느 절이 어디인지는 "
                       "**먼저 이걸로** 본다. 여기 나온 id 나 제목을 read_section 에 넣는다.",
        "inputSchema": {"type": "object", "required": ["id"], "properties": {
            "id": {"type": "string", "description": "검토 기록 id"},
            "slot": {"type": "string", "enum": ["", "A", "B"],
                     "description": "비교 검토의 상위(A)·하위(B). 단일 검토는 비운다"}}},
    },
    {
        "name": "read_section",
        "description": "저장된 문서 본문에서 절 하나를 통째로 읽는다. section_id 에는 목차의 "
                       "id, 또는 문서의 절 번호·제목('3.0', '3.0 References', '부록 B')을 "
                       "넣는다. 긴 절은 결과 끝의 offset 으로 이어 읽는다.",
        "inputSchema": {"type": "object", "required": ["id", "section_id"], "properties": {
            "id": {"type": "string"},
            "section_id": {"type": "string",
                           "description": "목차의 id, 또는 절 번호·제목"},
            "offset": {"type": "integer", "minimum": 0,
                       "description": "이어 읽을 시작 글자 위치(결과 끝에 안내)"},
            "slot": {"type": "string", "enum": ["", "A", "B"]}}},
    },
]

_INVISIBLE = "볼 수 없는 검토입니다."

#: 심각도의 화면 말. 코드 안 값은 major/minor/info(CLAUDE.md 스키마)지만 검토자는
#: "지적 · 검토 상태"로 본다(web/views.js SEV). 확실/확인 필요 구분은 화면에서 뺐다
#: (2026-09-14 품질팀). 모델이 "Major 4건"이라고 말하면 화면과 어긋난다 — 사용자에게
#: 보이는 말로 낸다.
SEV_LABEL = {"major": "지적", "minor": "지적", "info": "검토 상태"}


class ToolError(Exception):
    """도구가 검토자에게 그대로 보여줄 실패 이유."""


def _doc_from_payload(record: dict, slot: str) -> Document:
    """저장된 payload 의 sections 로 Document 를 복원한다. 파서 없이.

    원본이 30일 뒤 지워진 기록에서도 검색이 되는 이유가 이것이다(웹의 텍스트
    재현본과 같은 원천).
    """
    payload = record.get("payload") or {}
    if slot:
        if record.get("kind") != "compare":
            raise ToolError("slot 은 비교 검토에서만 씁니다.")
        holder = payload.get("docA" if slot == "A" else "docB") or {}
        sections, name = holder.get("sections"), holder.get("name") or slot
    else:
        if record.get("kind") == "compare":
            raise ToolError("비교 검토는 slot(A=상위, B=하위)을 정해야 합니다.")
        sections, name = payload.get("sections"), (payload.get("doc") or {}).get("name")
    if not isinstance(sections, list) or not sections:
        raise ToolError("이 검토에는 문서 본문이 저장돼 있지 않습니다.")
    secs = [Section(id=str(s.get("id") or ""), title=str(s.get("title") or ""),
                    level=int(s.get("level") or 1), text=str(s.get("text") or ""),
                    anchor=Anchor(page=s.get("page"), section=str(s.get("id") or "")))
            for s in sections if isinstance(s, dict)]
    return Document(source_path=str(name or ""), doc_type=None, sections=secs)


def _cut(text, n: int = 600) -> str:
    t = str(text or "").strip()
    return t if len(t) <= n else t[:n] + "…"


def _rtm_row(r: dict, payload: dict) -> dict:
    rid = str(r.get("upper_id") or (r.get("lower_ids") or [""])[0] or "")
    vd = (payload.get("rtmVerdicts") or {}).get(rid) or {}
    ai = (payload.get("rtmSearches") or {}).get(rid) or {}
    row = {"id": rid, "lower_ids": r.get("lower_ids") or [], "status": r.get("status"),
           "upper": {"section_title": r.get("section_title") or "", "page": r.get("page"),
                     "text": _cut(r.get("text"))},
           "lower": {"section_title": r.get("child_section_title") or "",
                     "page": r.get("child_page"), "text": _cut(r.get("child_text"))},
           "verdict": vd.get("verdict") or "", "note": vd.get("note") or ""}
    if r.get("content_status"):
        row["content_status"] = r.get("content_status")
    if ai:
        row["ai"] = {"verdict": ai.get("verdict"), "section": ai.get("section"),
                     "page": ai.get("page"), "quote": _cut(ai.get("quote"), 300),
                     "reason": ai.get("reason") or ""}
    return row


def _review_view(record: dict) -> dict:
    """지적과 "검토 못 한 것"을 갈라서 낸다. 섞이면 지적 0건이 '깨끗함'으로 읽힌다."""
    payload = record.get("payload") or {}
    findings, unreviewed, notices = [], [], []
    for f in payload.get("findings") or []:
        if not isinstance(f, dict):
            continue
        # 내부값 sev(major/minor)는 빼고 화면 말(severity)만 준다. 둘 다 주니 모델이
        # "major 1 · minor 24" 라고 내부값으로 말했다(2026-09-15 대화). 화면은 그 둘을
        # 가르지 않으므로 어시스턴트가 갈라 말하면 검토자와 어긋난다.
        slim = {k: v for k, v in f.items() if k not in ("rescue_trace", "sev")}
        slim["severity"] = SEV_LABEL.get(str(f.get("sev") or ""), str(f.get("sev") or ""))
        if f.get("unreviewed"):
            unreviewed.append(slim)
        elif f.get("sev") == "info":
            notices.append(slim)
        else:
            findings.append(slim)
    counts = {"지적": len(findings)}
    out = {"id": record.get("id"), "kind": record.get("kind"), "title": record.get("title"),
           "at": record.get("at"), "by": record.get("by", ""),
           # 맨 위에 건수부터 — 모델이 목록을 세다 하나 빠뜨리면(실측: 지적 5건을 4건으로)
           # 여기와 대조할 수 있다. 화면 말(지적·미검토)로 센다.
           "counts": {**counts, "미검토": len(unreviewed)},
           "severity_labels": "findings[].severity 가 화면 말이다: 지적(검토자가 볼 것). "
                              "sev 는 내부값(major/minor)이고 화면은 그 둘을 가르지 않는다. "
                              "사용자에게는 '지적'이라고만 말한다.",
           "summary": record.get("summary"),
           "findings": findings, "unreviewed": unreviewed, "notices": notices,
           "criteria_count": len(payload.get("criteriaResults") or [])}
    if record.get("kind") == "compare":
        out["rtm_rows"] = len(payload.get("rtm") or [])
        out["rtm_verdicts"] = payload.get("rtmVerdicts") or {}
        # 요건 행 하나하나 — 개수와 판정만 주니 "이 요건이 하위 어디에 반영됐어?"에 어시스턴트가
        # 본문을 처음부터 다시 뒤졌다(2026-09-16). 화면이 아는 것(상·하위 서술, AI 가 찾은
        # 자리, 검토자 판정)을 그대로 준다. 서술은 600자에서 자른다.
        out["rtm"] = [_rtm_row(r, payload) for r in (payload.get("rtm") or [])[:300]]
        out["rtm_status_labels"] = {
            "linked": "연결됨", "missing": "누락 — 하위 문서에 이 ID 가 없음",
            "orphan": "근거 없음 — 상위 문서에 이 ID 가 없음",
            "rolled_up": "부모 수준 검증", "out_of_scope": "범위 밖"}
    if record.get("kind") == "evaluation":
        out["draft"] = _draft_view(payload)
        # 지적·미검토 수는 초안 기록에서 늘 0 이라 counts 를 초안 것으로 바꾼다 — 모델이
        # "지적 0건 = 깨끗함"으로 읽지 않게(status 셋을 가른 건수가 화면 말이다).
        out["counts"] = out["draft"]["counts"]
    if payload.get("lineage"):
        out["lineage"] = {"prior": payload.get("lineage_candidate"),
                          "verdicts": payload.get("lineageVerdicts") or {}}
    # 같은 문서의 직전 기록 — "지난 판과 비교해 줘"가 목록을 뒤지지 않고 바로 열게(2026-09-17).
    # 단일은 이력 후보(lineage_candidate), 비교는 rtm_lineage 가 payload 에 이미 있다.
    prev = payload.get("lineage_candidate") or payload.get("rtm_lineage")
    if isinstance(prev, dict) and prev.get("id"):
        out["previous"] = {"id": prev.get("id"), "title": prev.get("title"),
                           "at": prev.get("at"), "by": prev.get("by", "")}
    return out


#: 초안 행 status 의 화면 말(modules/agent_generate README). 셋을 섞지 않는다.
DRAFT_STATUS_LABEL = {"drafted": "작성함 — 근거를 문서에서 확인해 초안을 썼다",
                      "not_found": "근거 없음 — 문서를 찾아봤고 받쳐 주는 것이 없었다",
                      "unreviewed": "폐기함 — 모델 주장의 인용이 문서와 안 맞아 버렸다"
                                    "(문서에 없다는 뜻이 아니다)"}


def _draft_view(payload: dict) -> dict:
    """체크리스트 검토(부록 B 초안) 기록 — 항목 원문과 초안 행을 ID 로 붙여 준다.

    행만 주면 "이 항목이 뭘 묻는 건지"를 모델이 모르고, 항목만 주면 결과가 없다.
    verdict_hint 는 제안이다 — 최종 판정은 검토자가 한다(README 계약).
    """
    items = {str(it.get("id") or ""): it
             for it in payload.get("items") or [] if isinstance(it, dict)}
    rows, counts = [], {"작성함": 0, "근거 없음": 0, "폐기함": 0}
    for r in payload.get("rows") or []:
        if not isinstance(r, dict):
            continue
        rid = str(r.get("item_id") or "")
        it = items.get(rid) or {}
        status = str(r.get("status") or "")
        key = {"drafted": "작성함", "not_found": "근거 없음", "unreviewed": "폐기함"}.get(status)
        if key:
            counts[key] += 1
        rows.append({"id": rid, "status": status,
                     "item": _cut(it.get("item"), 400), "item_ko": _cut(it.get("item_ko"), 200),
                     "characteristic": it.get("characteristic") or "",
                     "verdict_hint": r.get("verdict_hint") or "", "comment": _cut(r.get("comment")),
                     "sections": list(r.get("sections") or []),
                     "quotes": [{"quote": _cut(q.get("quote"), 300), "page": q.get("page"),
                                 "section": q.get("section")}
                                for q in (r.get("quotes") or []) if isinstance(q, dict)],
                     "reason": r.get("reason") or "", "words": list(r.get("words") or [])})
    return {"checklist_name": payload.get("checklist_name") or "",
            "sheet": payload.get("sheet") or "",
            "document_kind": payload.get("document_kind") or "",
            "counts": {"항목": len(rows), **counts}, "status_labels": DRAFT_STATUS_LABEL,
            "verdict_note": "verdict_hint 는 모델의 제안이다. 최종 판정은 검토자가 "
                            "평가표에 적는다.",
            "notes": list(payload.get("notes") or []), "rows": rows[:300]}


def mount_mcp(app: FastAPI, *, history: HistoryStore, resolve_token: Callable[[str], str],
              visible_owners: Callable[[str], list[str] | None],
              with_names: Callable[[list[dict]], list[dict]]) -> None:
    """`/mcp` 를 앱에 얹는다. 인증·범위는 웹과 같은 함수를 받아 쓴다."""

    def _email(request: Request) -> str:
        auth = request.headers.get("authorization", "")
        token = auth[7:].strip() if auth.lower().startswith("bearer ") else ""
        return resolve_token(token) if token else ""

    def _visible_record(email: str, entry_id: str) -> dict:
        try:
            record = history.get(entry_id)
        except HistoryError:
            raise ToolError(_INVISIBLE) from None
        owners = visible_owners(email)
        if owners is not None and (record.get("owner") or "") not in ("", *owners):
            raise ToolError(_INVISIBLE)
        with_names([record])
        return record

    def _call(email: str, name: str, args: dict) -> object:
        if name == "list_reviews":
            page = history.page(int(args.get("limit") or 20), 0, q=str(args.get("q") or ""),
                                kind=str(args.get("kind") or ""), owners=visible_owners(email))
            return {"entries": with_names(page["entries"]), "total": page["total"]}
        if name == "search_findings":
            try:
                rows = history.search_findings(
                    str(args.get("q") or ""), kind=str(args.get("kind") or ""),
                    checker=str(args.get("checker") or ""), sev=str(args.get("sev") or ""),
                    since=str(args.get("since") or ""), owners=visible_owners(email),
                    limit=int(args.get("limit") or 100))
            except HistoryError as exc:
                raise ToolError(str(exc)) from exc
            for r in with_names(rows):
                r.pop("owner", None)
                r["severity"] = SEV_LABEL.get(r["sev"], r["sev"])
            return {"rows": rows, "count": len(rows),
                    "note": "기록별 자세한 내용은 get_review(id=review_id). 300행 상한."}
        entry_id = str(args.get("id") or "")
        if not entry_id:
            raise ToolError("id 인자가 필요합니다.")
        record = _visible_record(email, entry_id)
        if name == "get_review":
            return _review_view(record)
        slot = str(args.get("slot") or "")
        if slot not in ("", "A", "B"):
            raise ToolError("slot 은 A 또는 B 입니다.")
        tools = DocTools(_doc_from_payload(record, slot))
        if name == "find_in_document":
            return tools.find_term(str(args.get("term") or ""))
        if name == "list_sections":
            return tools.outline()
        if name == "read_section":
            return tools.read_section(str(args.get("section_id") or ""),
                                      int(args.get("offset") or 0))
        raise ToolError(f"모르는 도구입니다: {name}")

    def _rpc_error(rid, code: int, message: str, status: int = 200) -> JSONResponse:
        return JSONResponse({"jsonrpc": "2.0", "id": rid,
                             "error": {"code": code, "message": message}}, status_code=status)

    @app.post("/mcp")
    async def mcp_post(request: Request) -> Response:
        email = _email(request)
        if not email:
            # 토큰이 없거나 만료. JSON-RPC 이전 단계라 HTTP 로 말한다 — DoSuree 는
            # 이 상태를 "HTTP 401" 로 보여준다.
            return JSONResponse({"error": "DoSuree 연결 토큰이 없거나 만료됐습니다. "
                                          "DocSuree 설정에서 다시 발급하세요."}, status_code=401)
        try:
            body = await request.json()
        except ValueError:
            return _rpc_error(None, -32700, "JSON 을 읽지 못했습니다.", 400)
        if not isinstance(body, dict) or body.get("jsonrpc") != "2.0":
            return _rpc_error(None, -32600, "JSON-RPC 2.0 요청이 아닙니다.", 400)
        method, rid, params = body.get("method"), body.get("id"), body.get("params") or {}
        if method == "initialize":
            return JSONResponse({"jsonrpc": "2.0", "id": rid, "result": {
                "protocolVersion": str(params.get("protocolVersion") or PROTOCOL_VERSION),
                "capabilities": {"tools": {}}, "serverInfo": SERVER_INFO}})
        if method in ("notifications/initialized", "notifications/cancelled") or rid is None:
            return Response(status_code=202)
        if method == "ping":
            return JSONResponse({"jsonrpc": "2.0", "id": rid, "result": {}})
        if method == "tools/list":
            return JSONResponse({"jsonrpc": "2.0", "id": rid, "result": {"tools": TOOLS}})
        if method == "tools/call":
            name = str(params.get("name") or "")
            args = params.get("arguments") or {}
            if not isinstance(args, dict):
                return _rpc_error(rid, -32602, "arguments 는 객체여야 합니다.")
            try:
                out = _call(email, name, args)
                text = out if isinstance(out, str) else json.dumps(out, ensure_ascii=False)
                result = {"content": [{"type": "text", "text": text}], "isError": False}
            except ToolError as exc:
                result = {"content": [{"type": "text", "text": str(exc)}], "isError": True}
            return JSONResponse({"jsonrpc": "2.0", "id": rid, "result": result})
        return _rpc_error(rid, -32601, f"모르는 메서드입니다: {method}")

    @app.get("/mcp")
    def mcp_get() -> Response:
        # 서버→클라이언트 알림 스트림은 없다. DoSuree 는 405 를 받으면 조용히 접는다.
        return Response(status_code=405)
