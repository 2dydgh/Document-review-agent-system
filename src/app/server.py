"""문서 비교를 브라우저에서 실행하는 로컬 API 서버.

`--emit-ui`(정적 내보내기)가 "터미널에서 만든 결과를 페이지가 읽는" 방식이라면,
여기서는 페이지가 파일을 올리고 결과를 받아온다. 엔진은 동일한 `review_documents`를
쓰고, 응답 모양도 `to_ui_payload`로 통일해 프론트엔드가 그대로 대입할 수 있게 한다.

사내망 전용이다. 계정(auth.py)은 "누구의 기록인가"를 가르는 최소형이지 방벽이
아니다 — 검토 API 자체는 로그인 없이도 돈다. 공개망에 열지 말 것.
"""
from __future__ import annotations

import functools
import hashlib
import json
import os
import re
import shutil
import tempfile
import time
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import quote

from fastapi import Body, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

from modules.agent_generate import (
    EvalSheetError,
    draft_evaluation,
    read_eval_items,
    sheet_documents,
)
from modules.agent_trace import extract_id_anchors
from modules.doc_parser import (
    CONVERSION_VERSION,
    ConvertUnavailable,
    UnsupportedFormatError,
    load_document,
    normalize,
    to_pdf,
)
from modules.llm_client import build_llm
from modules.preset import (
    ChecklistError,
    ChecklistStore,
    Criterion,
    UnsupportedChecklistFormat,
    build_items,
    compose_review_preset,
    extract_tables,
    find_header,
    guess_columns,
    load_presets,
    to_csv,
)
from modules.report import (
    LOCATION_VERSION,
    annotate,
    evaluation_workbook,
    locate,
    review_workbook,
    rtm_workbook,
    to_ui_payload,
    to_ui_review_payload,
    with_location_context,
)
from modules.shared import suggest_revision

from .auth import SESSION_TTL, AccountStore, AuthError, SessionStore
from .config import apply_criteria_params, load_config
from .history import HistoryError, HistoryStore
from .jobs import JobStore
from .orchestrator import review_documents


def _disposition(filename: str) -> str:
    """다운로드 파일명을 헤더에 안전하게 싣는다.

    HTTP 헤더는 latin-1만 담는다. 한글 파일명을 그대로 넣으면 Starlette이
    인코딩하다 UnicodeEncodeError로 죽고, 화면에는 500이 뜬다 — 실제로 그렇게
    터졌다(운영개념기술서_v2.0.pdf).

    RFC 5987: 옛 브라우저용 ASCII 이름과 filename*(UTF-8 퍼센트 인코딩)을 함께
    보낸다. 요즘 브라우저는 filename*을 쓴다.
    """
    ascii_name = filename.encode("ascii", "ignore").decode() or "review.pdf"
    return (f'attachment; filename="{ascii_name}"; '
            f"filename*=UTF-8''{quote(filename)}")


# 실무 HWPX는 이미지가 많아 쉽게 수 MB를 넘는다 (샘플 상세설계서가 4MB).
MAX_UPLOAD_BYTES = 30 * 1024 * 1024
_CHUNK = 64 * 1024

# src/docreview/web/server.py → 저장소 루트
_REPO_ROOT = Path(__file__).resolve().parents[2]
# 씨앗 프리셋(공통·팀별) 디렉터리. 배포에 씨앗이 없으면 compose 가 업로드만 돌려준다.
_SEED_DIR = _REPO_ROOT / "presets" / "criteria"


def _data_root(history_dir: str | Path | None = None) -> Path:
    """서버가 재시작되어도 남겨야 하는 데이터를 둘 루트를 정한다.

    테스트·임베딩 호출자가 ``history_dir`` 를 직접 주면 그 경로의 부모를 쓴다.
    일반 실행은 배포 환경의 ``DOCSUREE_DATA_DIR`` 를 우선하고, 없으면 기존 위치인
    저장소 루트 ``.docreview`` 로 돌아간다. 컨테이너에서는 이 한 디렉터리만 volume으로
    연결하면 검토 이력·최근 원본·업로드 기준이 함께 보존된다.
    """
    if history_dir is not None:
        return Path(history_dir).parent
    configured = os.environ.get("DOCSUREE_DATA_DIR", "").strip()
    return Path(configured) if configured else _REPO_ROOT / ".docreview"


async def _save_upload(upload: UploadFile, dest_dir: Path) -> Path:
    """업로드를 dest_dir에 저장한다. 경로 탈출과 과대 파일을 막는다."""
    # 브라우저가 보낸 filename은 신뢰할 수 없다. "../../etc/passwd" → "passwd".
    name = Path(upload.filename or "").name
    if not name:
        raise HTTPException(status_code=400, detail="파일 이름이 없습니다.")

    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / name
    size = 0
    with dest.open("wb") as fh:
        while chunk := await upload.read(_CHUNK):
            size += len(chunk)
            if size > MAX_UPLOAD_BYTES:
                raise HTTPException(
                    status_code=413,
                    detail=f"파일이 너무 큽니다 (최대 {MAX_UPLOAD_BYTES // 1024 // 1024}MB).")
            fh.write(chunk)
    if size == 0:
        raise HTTPException(status_code=400, detail=f"'{name}'가 비어 있습니다.")
    return dest


def _rules_only(config):
    """LLM 을 쓰지 않는 설정. 화면의 "규칙만 · 빠름"이 이걸 쓴다.

    텍스트 모델과 비전 모델을 **둘 다** 꺼야 한다. provider 만 echo 로 바꾸면
    vlm_base_url 이 살아남아 "빠름"을 골랐는데도 그림 해석이 돌아 느려진다.
    """
    return replace(config, llm_provider="echo", vlm_base_url="", llm_enabled=False)


#: 임시 폴더를 몇 시간 지나면 남의 것으로 보고 지우는가. 검토 1건은 최대 5분
#: 이므로(CLAUDE.md 성능 스펙) 이보다 한참 짧다 — 24시간이면 도는 검토를 지울
#: 위험은 사실상 없고, 죽은 서버가 남긴 것만 걷힌다.
_TMP_MAX_AGE_S = 24 * 3600


def _sweep_stale_uploads() -> None:
    """죽은 서버가 남긴 업로드 임시 폴더를 걷는다. 서버가 뜰 때 한 번 돈다.

    업로드 원본은 `tempfile.TemporaryDirectory(prefix="docreview…")` 에 풀리고,
    검토 스레드가 끝나면 청소 스레드가 지운다. 그런데 그 청소 스레드는
    daemon 이라 **서버가 죽으면 같이 죽는다** — 지우지 못한 폴더를 그 뒤로
    아무도 다시 보지 않았다.

    실측(2026-08-21): /tmp 에 8/13·8/14 업로드분 세 벌이 남아 있었고, 안에는
    시험의뢰서·성적서 같은 **실무 원본 20MB** 가 그대로 있었다. 권한이 700 이라
    남이 읽지는 못해도, 여러 계정이 붙는 서버에서 오래 둘 물건이 아니다.
    CLAUDE.md 의 "보관 기간 경과 시 자동 삭제" 방침이 임시 폴더에는 없었다.

    **지우다 실패해도 서버는 뜬다.** 남의 계정 것일 수도, /tmp 를 못 읽을 수도
    있다 — 뒷정리 하나가 서버를 못 뜨게 하는 것이 훨씬 나쁘다. 목록 훑기까지
    통째로 감싸는 이유가 그것이다.
    """
    try:
        root = Path(tempfile.gettempdir())
        cutoff = time.time() - _TMP_MAX_AGE_S
        for path in root.glob("docreview*"):
            try:
                if path.is_dir() and path.stat().st_mtime < cutoff:
                    shutil.rmtree(path, ignore_errors=True)
            except OSError:
                continue
    except OSError:
        return


def create_app(settings: str | Path = "config/settings.toml",
               frontend_dir: str | Path | None = None,
               history_dir: str | Path | None = None,
               seed_dir: str | Path | None = None) -> FastAPI:
    # 설정이 잘못됐으면 요청 때가 아니라 지금 실패하는 편이 낫다.
    config = load_config(str(settings))
    # trkim 파서를 앞순위 로더로 장착 + Qwen-VL OCR 훅 (3-way 통합).
    # 기본 파서다 — 설정 게이트 없이 항상 앞순위. 표 글꼴·그림 메타 부족분은
    # parser_bridge.TrkimLoader.load 가 legacy 파서로 보충한다.
    from .parser_bridge import install_trkim_parser
    install_trkim_parser(config.vlm_base_url, config.vlm_model, config.llm_api_key)
    _sweep_stale_uploads()
    app = FastAPI(title="DocReview")
    # **본문을 압축해서 보낸다.** 없으면 화면 코드 927KB 를 그대로 보낸다 —
    # 실측(2026-09-02): views.js 487KB · app.js 181KB · index.html 164KB 가
    # 압축 없이 나갔고, 차가운 캐시로 홈에 들어오면 그동안 화면이 비어 있다가
    # 한꺼번에 그려져 "버벅이며 뜬다"로 보였다. gzip 이면 279KB(70% 감소)다.
    #
    # minimum_size 를 두는 이유: 작은 응답은 압축해 봐야 CPU 만 쓰고 오히려
    # 커진다. SSE 스트림(/api/review·/api/compare)은 FastAPI 가 알아서 건너뛴다
    # — 압축하면 단계 이벤트가 버퍼에 갇혀 진행 화면이 멎은 것처럼 보인다.
    app.add_middleware(GZipMiddleware, minimum_size=1024)
    # 씨앗 프리셋(공통·팀별) 디렉터리. 주입 없으면 repo 의 presets/criteria.
    seed_root = Path(seed_dir) if seed_dir else _SEED_DIR
    data_root = _data_root(history_dir)
    history = HistoryStore(
        Path(history_dir) if history_dir else data_root / "history")

    # 업로드 기준(3층 중 셋째). 공통·팀별은 repo 의 presets/criteria 에 있고,
    # 이것만 사용자가 올린 것이라 여기 떨어진다 — 자리를 나눠 층이 눈에 보이게 한다.
    checklists = ChecklistStore(data_root / "criteria" / "uploads")

    # 계정·세션 — 자체 최소형 로그인(src/app/auth.py). 검토 기록의 소유자를
    # 가르는 데 쓴다. API 전체를 잠그지는 않는다 — 사내망 PoC 이고, 로그인의
    # 몫은 방벽이 아니라 "누구의 기록인가"다.
    accounts = AccountStore(data_root)
    sessions = SessionStore(data_root)
    # 검토 작업. 브라우저가 스트림을 놓아도(새로고침·탭 닫기) 검사는 계속 돌고,
    # 다시 붙으면 지나간 단계부터 받는다(app.jobs 주석 참고).
    jobs = JobStore()

    def _sse(ev: dict) -> str:
        return f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"

    def _job_stream(job) -> StreamingResponse:
        """작업 하나를 SSE 로 흘린다. 첫 이벤트로 작업 id 를 알려 준다 —
        화면이 그 id 를 쥐고 있어야 끊긴 뒤 다시 붙을 수 있다."""
        def gen():
            yield _sse({"event": "job", "id": job.id, "kind": job.kind,
                        "title": job.title})
            for ev in jobs.stream(job.id):
                yield _sse(ev)
        return StreamingResponse(
            gen(), media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    def _session_email(request: Request) -> str:
        """세션 쿠키 → 계정 이메일. 없거나 만료면 ""(소유자 없음)."""
        return sessions.resolve(request.cookies.get("dr_session", "")) or ""

    def _visible_owners(email: str) -> list[str] | None:
        """이 계정이 볼 수 있는 검토 기록의 소유자들.

        기록은 **같은 팀끼리** 공유한다(2026-09-09 결정) — 검토는 팀의 일이고,
        동료가 지난주에 돌린 결과를 다시 돌리지 않게. 관리자는 전부(None).
        팀이 없는 계정은 제 것만. 로그인 안 한 호출은 소유자 없는 기록만([]).

        팀 소속은 **지금** 계정 표에서 읽는다 — 기록에 팀을 박지 않는다. 사람이
        팀을 옮기면 그 사람 기록도 같이 옮겨 가고, 이관 코드가 필요 없다.
        """
        if not email:
            return []
        people = accounts.list()
        me = next((a for a in people if a["email"] == email), None)
        if me is None:
            return [email]
        if me["role"] == "admin":
            return None
        mates = [a["email"] for a in people if me["team"] and a["team"] == me["team"]]
        return sorted({email, *mates})

    def _with_names(entries: list[dict]) -> list[dict]:
        """목록 행에 검토자 이름(`by`)을 얹는다. 이름이 비면 이메일, 소유자 없으면 ""."""
        names = {a["email"]: a["name"] or a["email"] for a in accounts.list()}
        for e in entries:
            e["by"] = names.get(e.get("owner") or "", e.get("owner") or "")
        return entries

    def _teams() -> list[dict]:
        """고를 수 있는 검토 기준 = 팀 프리셋.

        공통 기준은 목록에 없다 — 고르고 말고 할 것 없이 늘 포함되기 때문이다
        (`resolve_criteria`: 공통 → 팀 → 업로드). 업로드 기준은 별도 API 로
        관리한다(/api/checklists).

        예전에는 이 목록이 `presets/checklists/*.yaml` 이었다. 그 파일들은 검토
        기준이 아니라 **검사 설정**(요건 ID 정규식 등)이었고, 값은 개발 중에
        실제 문서를 보고 거꾸로 뽑은 것이었다 — 문서에서 뽑은 잣대로 그 문서를
        재면 틀릴 수가 없다. 기준은 3층(공통·팀별·업로드)에서만 온다.
        """
        return [{"id": p.id, "name": p.name or p.id, "doc_type": ""}
                for p in load_presets(seed_root) if p.scope == "팀별"]

    def _criteria_for(team: str, uploaded=None):
        """고른 팀 → 이번 검토에 적용할 기준 = 공통 ∪ 팀 ∪ 업로드.

        브라우저가 보낸 문자열을 경로로 그대로 쓰면 서버의 아무 파일이나 읽게
        된다(../../etc/passwd). 그래서 경로를 만들지 않고 열거한 목록에서 찾는다.
        """
        if team and team not in {t["id"] for t in _teams()}:
            raise HTTPException(
                status_code=400, detail=f"그런 팀 기준이 없습니다: {team}")
        return compose_review_preset(seed_root, uploaded, team=team or None)

    def _output_key_for(team: str, filename: str, output_key: str = "") -> str:
        """파일명 → 팀 기준의 산출물 key. 못 가리면 "".

        추측하지 않는다. 못 가린 채 아무 key 나 주면 `applies_to` 를 적은 기준이
        엉뚱하게 해당없음으로 빠져 조용히 검사되지 않는다.
        """
        if not team:
            return ""
        from .case import output_spec_for  # noqa: PLC0415
        spec, _why = output_spec_for(filename, _team_preset(team), output_key)
        return str((spec or {}).get("key", ""))

    def _presence_fields_for(team: str, filename: str, output_key: str = ""):
        """기준이 `check: field_presence` 로 골라 쓸 칸 규격. (규격, 못 낸 이유)."""
        if not team:
            return (), ""
        from .case import presence_fields_for  # noqa: PLC0415
        return presence_fields_for(filename, _team_preset(team), output_key)

    def _supplemental_for(team: str, filename: str, output_key: str = ""):
        """기준 항목 밖의 고정 문구·서명·글꼴 검사기. (검사기, 못 건 이유)."""
        if not team:
            return (), ""
        from .case import supplemental_checkers_for  # noqa: PLC0415
        checkers, why = supplemental_checkers_for(filename, _team_preset(team), output_key)
        return tuple(checkers), why

    def _single_outputs(team: str) -> list[dict]:
        """이 팀이 단일 검토에서 가리는 문서 종류 목록 [{key}]. 없으면 []."""
        if not team:
            return []
        spec = _team_preset(team)
        return [o for o in (spec.get("single_outputs") or spec.get("outputs") or [])
                if o.get("key")]

    def _config_for(team: str):
        """고른 기준이 검사 매개변수를 정한다(id_pattern·필수 절 등).

        기준이 안 적어두면 비어 있는 채로 둔다 — 코드가 지어내지 않는다.
        추적성처럼 매개변수가 있어야 도는 검사는 그때 "기준 없음"으로 남는다.
        """
        base = load_config(str(settings))
        return replace(base, review=apply_criteria_params(
            base.review, _criteria_for(team).items))

    def _with_llm(choice: str, checklist: str = ""):
        """이번 검토에 쓸 설정.

        LLM 은 켜고 끄는 것만 고를 수 있다. provider 를 클라이언트가 고르게 두면
        안 된다 — 여기 올라오는 문서는 밖으로 나가면 안 되는 문서인데, provider 는
        어디로 보낼지를 정하는 값이다. 어떤 모델을 쓸지는 서버 설정(settings.toml)이
        정한다. (외부 API 어댑터는 2026-09-09 에 지웠다. 그래도 이 규칙은 남는다 —
        고를 수 있는 자리를 열어 두는 것 자체가 위험하다.)

        체크리스트는 다르다. 어떤 잣대로 잴지는 검토자가 정하는 게 맞다. 다만
        경로가 아니라 **열거된 목록의 id 로만** 받는다(_criteria_for 참고).
        """
        if choice == "on":
            cfg = config
        elif choice == "off":
            cfg = _rules_only(config)   # 룰만 돈다. 빠르다.
        else:
            raise HTTPException(
                status_code=400,
                detail="llm은 'on' 또는 'off'만 됩니다. 어떤 모델을 쓸지는 서버가 정합니다.")

        if not checklist:
            return cfg
        # 잣대를 바꾸면 id 패턴·필수 섹션이 통째로 달라진다. 설정을 다시 읽어
        # 그 잣대로 세운다(부분만 갈아끼우면 두 기준이 섞인다).
        fresh = _config_for(checklist)
        return fresh if choice == "on" else _rules_only(fresh)

    def _remember(kind: str, payload: dict, *,
                  original: tuple[str, bytes] | None = None,
                  original_a: tuple[str, bytes] | None = None,
                  original_b: tuple[str, bytes] | None = None,
                  owner: str = "") -> dict:
        """결과를 이력에 남기고, 화면이 쓸 id를 payload에 얹어 돌려준다.

        저장에 실패해도 검토 결과는 돌려준다 — 방금 한 검토를 통째로 버리는 것보다
        "이력에 못 남겼다"고 말하는 편이 낫다. original을 주면(단일 검토) 원본 문서도
        최근 몇 건만 함께 보관한다 — 이력에서 다시 열 때 뷰어로 보여주기 위함이다.
        원본 저장 실패는 조용히 넘긴다(결과는 이미 남았다).
        """
        try:
            entry = history.save(kind, payload, owner=owner)
        except (HistoryError, OSError) as exc:
            return {**payload, "history": {"saved": False, "error": str(exc)}}
        # 단일 검토는 자리 표시 없이 하나, 비교는 상위(A)·하위(B) 둘을 남긴다.
        # 원본 저장 실패는 조용히 넘긴다 — 결과는 이미 남았고, 원문 보기가 안 될
        # 뿐이다(그 사실은 화면이 눌렀을 때 말한다).
        for slot, one in (("", original), ("A", original_a), ("B", original_b)):
            if one is None:
                continue
            try:
                history.save_original(entry.id, one[0], one[1], slot=slot)
            except (HistoryError, OSError):
                pass
        return {**payload, "history": {"saved": True, "id": entry.id, "at": entry.at}}

    @app.post("/api/evaluate/sheets")
    async def evaluate_sheets(file: UploadFile = File(...)) -> dict:
        """올린 체크리스트 xlsx 의 시트마다 항목 수 — 검토자가 시트를 고르는 목록.

        읽을 수 없는 시트는 빼지 않고 이유를 붙여 보낸다. 빼면 "왜 내 시트가 없지"가
        되고, 이유가 있으면 헤더가 다르다는 것을 바로 안다.
        """
        out = []
        for i, table in enumerate(await _tables_of(file)):
            # 셀이 하나도 없는 시트(통합문서의 Sheet1~4 껍데기)는 탭으로 안 낸다 — 눌러도
            # "빈 시트"뿐이라 고를 것이 아니다. index 는 그대로 둔다(고른 뒤 서버가 같은
            # 번호로 다시 읽는다).
            if not any(str(c or "").strip() for row in table.rows for c in row):
                continue
            try:
                items = read_eval_items(table.rows)
                out.append({"index": i, "label": table.label, "item_count": len(items),
                            "documents": sheet_documents(table.rows), "error": "",
                            "rows": _peek_rows(table.rows)})
            except EvalSheetError as exc:
                out.append({"index": i, "label": table.label, "item_count": 0,
                            "documents": [], "error": str(exc),
                            "rows": _peek_rows(table.rows)})
        return {"sheets": out}

    #: 시트 미리보기 크기. 엑셀 첫 화면 정도 — 제목 행·헤더·항목 몇 개가 보이면 된다.
    _PEEK_ROWS, _PEEK_COLS, _PEEK_CHARS = 8, 8, 80

    def _peek_rows(rows: list) -> list[list[str]]:
        """시트 앞부분을 **있는 그대로**(정리하지 않고) 잘라 준다.

        화면이 엑셀처럼 열 글자·행 번호를 붙여 그린다(2026-09-17 요청: "내가 올린
        파일에서 고르는 느낌"). 정리한 네 열만 보이면 내 파일 같지 않았다. 셀은
        글자 수만 자르고 내용은 안 바꾼다 — 읽을 수 없는 시트도 그대로 보여 왜
        못 읽는지(헤더가 다르다) 눈으로 알게 한다.
        """
        out = []
        for row in list(rows)[:_PEEK_ROWS]:
            cells = ["" if c is None else " ".join(str(c).split()) for c in list(row)[:_PEEK_COLS]]
            out.append([c[:_PEEK_CHARS] + ("…" if len(c) > _PEEK_CHARS else "") for c in cells])
        return out

    @app.post("/api/evaluate")
    async def evaluate(request: Request,
                       document: UploadFile = File(...),
                       checklist: UploadFile = File(...),
                       sheet_index: int = Form(0),
                       document_kind: str = Form(""),
                       llm: str = Form("on")) -> StreamingResponse:
        """문서 + 팀 평가 체크리스트 시트 → 부록 B 초안. /api/compare 와 같은 SSE 계약.

        입력 검증은 스트림을 열기 전에 400 으로 끝낸다. 시트 파싱은 여기서 하고
        문서 파싱·LLM 은 작업 스레드에서 한다 — 5분 목표는 문서 크기가 정한다.
        """
        cfg = _with_llm(llm)
        tables = await _tables_of(checklist)
        if not 0 <= sheet_index < len(tables):
            raise HTTPException(status_code=400, detail="그런 시트가 없습니다.")
        try:
            items = read_eval_items(tables[sheet_index].rows, document=document_kind)
        except EvalSheetError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        if not items:
            raise HTTPException(status_code=400, detail="이 시트에 평가 항목이 없습니다.")
        sheet_label = tables[sheet_index].label
        checklist_name = checklist.filename or ""
        tmp = tempfile.TemporaryDirectory(prefix="docreview-")
        try:
            path = await _save_upload(document, Path(tmp.name))
        except BaseException:
            tmp.cleanup()
            raise
        owner = _session_email(request)

        def work(emit) -> dict:
            try:
                # 단계마다 걸린 초를 기록에 남긴다 — "6분 걸렸다"가 파싱인지 초안인지
                # 나중에 볼 수 있게(2026-09-17: 사용자 실측 6분, 실측 10분 — 둘 다 파싱이
                # 거의 전부였는데 기록만으로는 가를 수 없었다).
                t0 = time.monotonic()
                emit({"key": "ingestion", "status": "running",
                      "detail": "문서 파싱 중 — 스캔 문서는 OCR 때문에 수 분 걸릴 수 있습니다"})
                raw = load_document(path)
                doc = normalize(raw, doc_type=cfg.review.doc_type)
                n_sec = sum(1 for _ in doc.iter_sections())
                parse_s = round(time.monotonic() - t0)
                emit({"key": "ingestion", "status": "done",
                      "detail": f"{n_sec}개 절 · {parse_s}초"})
                emit({"key": "draft", "status": "running", "detail": f"항목 0/{len(items)}"})
                t1 = time.monotonic()
                total = len(items)
                seq = {"n": 0}

                def _row_done(index: int, item, row) -> None:
                    # 행 하나가 끝날 때마다 그 행을 실어 보낸다 — 화면이 부록 B 가
                    # 한 줄씩 써지는 것을 보여 준다(2026-09-17). 문장은 잘라 보낸다;
                    # 온전한 것은 done 의 payload 에 있다.
                    seq["n"] += 1
                    emit({"key": "draft", "status": "running",
                          "detail": f"항목 {seq['n']}/{total}",
                          "row": {"i": index, "id": item.raw_id or item.id,
                                  "item": item.item[:120], "status": row.status,
                                  "verdict": row.verdict_hint,
                                  "comment": (row.comment or row.reason or "")[:160],
                                  "sections": list(row.sections)[:2]}})

                draft = draft_evaluation(doc, items, build_llm(cfg), on_row=_row_done)
                draft_s = round(time.monotonic() - t1)
                draft_detail = (f"항목 {len(items)}건 · 근거 없음 {draft.unfound}건"
                                f" · 검토 못 함 {draft.unreviewed}건 · {draft_s}초")
                emit({"key": "draft", "status": "done", "detail": draft_detail})
                payload = to_ui_review_payload([], path, document=doc)
                payload.update(draft.to_dict())
                payload.update({"items": [it.to_dict() for it in items],
                                "sheet": sheet_label, "checklist_name": checklist_name,
                                "document_kind": document_kind,
                                # 단일 검토용 단계 표(0 chars·0 findings)가 아니라 이 작업의
                                # 세 단계와 걸린 초. 화면 진행 표시(EVAL_STAGES)와 같은 키다.
                                "stages": [
                                    {"key": "ingestion", "label": "문서 파싱",
                                     "detail": f"{n_sec}개 절 · {parse_s}초",
                                     "seconds": parse_s},
                                    {"key": "draft", "label": "초안 작성",
                                     "detail": draft_detail, "seconds": draft_s},
                                    {"key": "report", "label": "마무리",
                                     "detail": "평가표 초안 준비됨", "seconds": 0},
                                ]})
                try:
                    orig = (path.name, path.read_bytes())
                except OSError:
                    orig = None
                saved = _remember("evaluation", payload, owner=owner, original=orig)
                # 형광펜 좌표를 **지금** 계산해 캐시한다. 원문 창이 열릴 때 처음 계산하면
                # 247쪽 SRS 에서 47초(실측 2026-09-17) 동안 아무 표시 없이 기다렸고, 검토자는
                # "첫 클릭은 열기만 하고 두 번째에 간다"고 느꼈다. 작업이 어차피 분 단위라
                # 여기서 내는 편이 맞다. 못 내도 작업은 성공이다 — 창이 열릴 때 다시 센다.
                hid = (saved.get("history") or {}).get("id")
                findings = _draft_findings(payload)
                if hid and findings:
                    emit({"key": "report", "status": "running", "detail": "형광펜 자리를 찾는 중…"})
                    try:
                        _history_marks(hid, "", findings, [])
                    except Exception:  # noqa: BLE001 — 좌표는 덤이다. 초안이 우선.
                        pass
                emit({"key": "report", "status": "done", "detail": "평가표 초안 준비됨"})
                return saved
            except (UnsupportedFormatError, NotImplementedError) as exc:
                raise RuntimeError(f"검토할 수 없습니다: {exc}") from exc
            except Exception as exc:  # noqa: BLE001 — 메시지를 화면 말로 바꿔 올린다
                raise RuntimeError(f"초안 생성 중 오류: {exc}") from exc
            finally:
                tmp.cleanup()

        return _job_stream(jobs.start("evaluation", f"{path.name} · {sheet_label}", owner, work))

    @app.post("/api/compare")
    async def compare(request: Request,
                      parent: UploadFile = File(...),
                      child: UploadFile = File(...),
                      llm: str = Form("on"),
                      checklist: str = Form(""),
                      checklist_id: str = Form(""),
                      scope: str = Form("")) -> StreamingResponse:
        """비교를 돌리면서 단계 진행을 SSE 로 흘린다 (/api/review 와 같은 계약).

        예전에는 결과를 한 번에 돌려줬고, 화면은 그동안 760ms 간격의 가짜 단계
        애니메이션을 돌렸다 — 실제 진행과 무관한 연출이다. LLM 내용 대조는
        연결된 ID 쌍마다 왕복이라 수 분까지 걸릴 수 있고, 그동안 진행을 흘려야
        화면이 살아 있다. 업로드·인자 검증 실패는 스트림을 열기 전에 HTTP 400
        으로 끝낸다(스트림 연 뒤엔 상태코드를 못 바꾼다).
        """
        cfg = _with_llm(llm, checklist)
        # 과제 층(추가 검토 기준)이 있으면 그 params 로 덮는다. 요건 ID 형식·담당
        # 범위는 과제가 정하는 값이라 팀 기준에 못 박는다 — 단일 검토는 이미
        # 그렇게 도는데(criteria_for_single_review) 비교만 팀 기준까지만 보고 있어,
        # 과제 기준을 등록해도 추적성은 옛 형식으로 쟀다.
        notices: list = []
        picked = None
        if checklist_id:
            try:
                picked = checklists.get(checklist_id)
            except ChecklistError as exc:
                raise HTTPException(status_code=404, detail=str(exc)) from exc
        # 기준은 과제 층이 없어도 필요하다 — 문서 간 항목(X-…)이 팀 기준에 있고,
        # 그 항목들이 이번 비교의 판정을 받아야 한다.
        from .criteria import criteria_for_single_review  # noqa: PLC0415
        criteria_items, notices = criteria_for_single_review(
            seed_root, checklist, uploaded=picked)
        cfg = replace(cfg, review=apply_criteria_params(cfg.review, criteria_items))
        # 하위문서의 담당 요건 범위. 문서쌍마다 달라 기준 파일에 못 넣고 요청이
        # 진다(ax-quality.yaml 헤더). 안 주면 전부 범위 안 — 부분 설계서는 남의
        # 요건까지 전부 '누락'으로 부풀어 검토자가 진짜 누락을 못 가려낸다.
        # 요청은 가장 좁은 층이라 과제 기준의 값도 덮는다.
        if scope:
            try:
                re.compile(scope)
            except re.error as exc:
                raise HTTPException(
                    status_code=400,
                    detail=f"담당 범위 패턴을 읽지 못했습니다: {exc}") from exc
            cfg = replace(cfg, review=replace(cfg.review, scope_pattern=scope))
        # with 블록을 못 쓴다. 비교는 응답이 반환된 뒤에도 스레드에서 계속 돈다 —
        # 여기서 지우면 도중에 원본이 사라진다. 스트림이 끝날 때 지운다.
        tmp = tempfile.TemporaryDirectory(prefix="docreview-")
        try:
            # 같은 이름으로 올라와도 덮어쓰지 않도록 슬롯별 하위 디렉터리에 둔다.
            parent_path = await _save_upload(parent, Path(tmp.name) / "parent")
            child_path = await _save_upload(child, Path(tmp.name) / "child")
        except BaseException:
            tmp.cleanup()
            raise

        owner = _session_email(request)
        visible = _visible_owners(owner)

        def work(emit) -> dict:
            """검토 본체. emit 으로 단계를 흘리고 결과를 돌려준다 — 예외는
            JobStore 가 잡아 작업을 error 로 닫는다(스레드에서 죽지 않게)."""
            try:
                # 하위 문서가 어느 산출물인지 — 문서 간 기준의 단계를 가른다.
                # 파일명으로만 가린다(추측하지 않는다). 못 가리면 빈 문자열이고,
                # 그때는 항목이 "가리지 못해 판단 못 함"으로 뜬다.
                result = review_documents(parent_path, child_path, cfg,
                                          on_progress=emit,
                                          criteria=criteria_items,
                                          child_key=_output_key_for(
                                              checklist, child_path.name))
                # 기준 층이 서로 덮은 사실을 결과에 싣는다 — 요건 ID 형식 하나가
                # 바뀌면 추적성 결과가 통째로 달라진다.
                result.findings.extend(notices)
                # 임시 경로 대신 사용자가 올린 원래 이름을 보여준다.
                payload = to_ui_payload(result.rtm, result.findings,
                                        parent_path.name, child_path.name,
                                        statements=result.statements,
                                        child_statements=result.child_statements,
                                        child_locations=result.child_locations,
                                        parent_locations=result.parent_locations,
                                        items=result.items,
                                        probes=result.probes,
                                        judgments=result.judgments,
                                        content_match_state=result.content_match_state,
                                        workflow={
                                            "parent_kind": _output_key_for(
                                                checklist, parent_path.name),
                                            "child_kind": _output_key_for(
                                                checklist, child_path.name),
                                            "scope": cfg.review.scope_pattern or "",
                                        })
                # 같은 문서쌍의 지난 비교가 있으면 추적표를 잇는다. 판정 저장
                # (rtmVerdicts)은 있었는데 라운드를 못 이어, 2회차는 100행을
                # 처음부터 다시 눌렀다. 단일 검토의 반영 확인과 같은 계약이고
                # 열쇠만 인용문 대신 요건 ID 다(agent_history.carry_rtm).
                from modules.agent_history import (  # noqa: PLC0415
                    carry_rtm,
                    find_prior_pair,
                )
                prior = find_prior_pair(
                    # 내가 볼 수 있는(같은 팀) 이전 비교와 잇는다 — 동료의 판정도
                    # 팀의 판정이다. 다른 팀 것은 섞이지 않는다.
                    _with_names([e.as_dict() for e in history.list(limit=200, owners=visible)]),
                    parent_path.name, child_path.name)
                if prior:
                    before = (history.get(prior["id"]) or {}).get("payload", {})
                    rtm_prior, carried = carry_rtm(before, payload.get("rtm") or [])
                    # by = 그 비교를 돌린 사람. 팀 기록에 이으니 누구 판정을
                    # 물려받았는지 화면이 말해야 한다.
                    payload["rtm_lineage"] = {"id": prior["id"], "title": prior["title"],
                                              "at": prior["at"], "by": prior.get("by", "")}
                    payload["rtmPrior"] = rtm_prior
                    if carried:
                        # 이어받은 것은 판정으로 미리 채우되 **어느 것인지 밝힌다**
                        # (rtmCarried) — 안 밝히면 기계가 정한 판정으로 오해한다.
                        payload["rtmVerdicts"] = dict(carried)
                        payload["rtmCarried"] = dict(carried)
                # 비교도 원본을 남긴다 — 기록에서 다시 열었을 때 원문 보기가
                # 되게. 오래 안 남겨서, 기록의 비교는 형광펜도 원문도 못 봤다.
                try:
                    orig_a = (parent_path.name, parent_path.read_bytes())
                    orig_b = (child_path.name, child_path.read_bytes())
                except OSError:
                    orig_a = orig_b = None
                return _remember("compare", payload, owner=owner,
                                 original_a=orig_a, original_b=orig_b)
            except (UnsupportedFormatError, NotImplementedError) as exc:
                raise RuntimeError(f"검토할 수 없습니다: {exc}") from exc
            except Exception as exc:  # noqa: BLE001 — 메시지를 화면 말로 바꿔 올린다
                raise RuntimeError(f"비교 중 오류: {exc}") from exc
            finally:
                # 업로드본은 작업이 쥐고 있다 — 예전에는 스트림이 끊기면 아직
                # 읽는 중인 파일이 사라져, 뒷정리 스레드를 따로 붙여야 했다.
                tmp.cleanup()

        return _job_stream(jobs.start(
            "compare", f"{parent_path.name} ↔ {child_path.name}", owner, work))

    @app.post("/api/review")
    async def review(request: Request,
                     file: UploadFile = File(...),
                     llm: str = Form("on"),
                     checklist: str = Form(""),
                     checklist_id: str = Form(""),
                     output_key: str = Form("")) -> StreamingResponse:
        """검토를 돌리면서 단계 진행을 SSE로 흘린다.

        업로드 검증 실패는 스트림을 열기 전에 HTTP 400/413으로 끝낸다. 스트림이
        열린 뒤에는 상태코드를 고칠 수 없어서, 그 뒤의 실패는 error 이벤트다.

        output_key 는 검토자가 시작 화면에서 고른 **문서 종류**(팀 기준의
        single_outputs key)다. 파일명으로 종류를 못 가리면 그 종류 전용 검사가
        통째로 빠지는데(2026-09-15 품질팀 "돌리기 전에 형식을 추가"), 작업본
        파일명은 규칙과 다른 일이 흔하다. 비우면 지금처럼 파일명으로 가린다.
        """
        cfg = _with_llm(llm, checklist)
        output_key = output_key.strip()
        if output_key and output_key not in {str(o["key"]) for o in _single_outputs(checklist)}:
            raise HTTPException(status_code=400,
                                detail=f"팀 기준에 없는 문서 종류입니다: {output_key}")
        # checklist_id 가 있으면 등록된 체크리스트를 미리 찾아둔다 — 없는 id 는
        # 스트림을 열기 전에 404로 끝내야 한다(스트림 연 뒤엔 상태코드를 못 바꾼다).
        picked = None
        if checklist_id:
            try:
                picked = checklists.get(checklist_id)
            except ChecklistError as exc:
                raise HTTPException(status_code=404, detail=str(exc)) from exc
        # with 블록을 못 쓴다. 검토는 응답이 반환된 뒤에도 스레드에서 계속 돈다 —
        # 여기서 지우면 검토 도중에 원본이 사라진다. 스트림이 끝날 때 지운다.
        tmp = tempfile.TemporaryDirectory(prefix="docreview-")
        try:
            path = await _save_upload(file, Path(tmp.name))
        except BaseException:
            tmp.cleanup()
            raise

        owner = _session_email(request)
        visible = _visible_owners(owner)

        def work(emit) -> dict:
            """검토 본체. emit 으로 단계를 흘리고 결과를 돌려준다."""
            try:
                # 업로드 여부와 무관하게 한 엔진을 쓴다. 기준은 항상
                # 공통 ∪ 팀 ∪ 선택 업로드이고, 엔진이 항목별 판정과 지적의 연결을
                # 만든다. 업로드 기준은 엔진을 바꾸는 스위치가 아니라 셋째 기준층이다.
                from modules.report import to_ui_criteria_review_payload  # noqa: PLC0415

                from .criteria import criteria_for_single_review  # noqa: PLC0415
                from .orchestrator import review_document_by_criteria  # noqa: PLC0415

                items, notices = criteria_for_single_review(
                    seed_root, checklist, uploaded=picked)
                # 합쳐진 기준의 params가 실제 검사 설정(id 패턴·필수 절 등)을 정한다.
                run_cfg = replace(
                    cfg, review=apply_criteria_params(cfg.review, items))
                specs, spec_why = _presence_fields_for(checklist, path.name, output_key)
                supplemental, supplemental_why = _supplemental_for(
                    checklist, path.name, output_key)
                result = review_document_by_criteria(
                    path, items, run_cfg, on_progress=emit,
                    field_specs=specs,
                    output_key=_output_key_for(checklist, path.name, output_key),
                    extra_checkers=supplemental)
                result.findings.extend(notices)
                structure_why = spec_why or supplemental_why
                if structure_why:
                    from modules.shared import Anchor, Finding, Severity  # noqa: PLC0415

                    from .case import structure_suggestion  # noqa: PLC0415
                    result.findings.append(Finding(
                        checker="completeness", severity=Severity.INFO,
                        message=structure_why,
                        anchor=Anchor(page=None, section=None),
                        suggestion=structure_suggestion(structure_why),
                        unreviewed=True))
                payload = to_ui_criteria_review_payload(
                    result, path.name, as_checklist=picked is not None)

                if picked is None:
                    # 회신본이면(파일명이 이전 검토를 가리키면) 반영 확인을 곁들인다.
                    # 이전 지적과 새 검토를 규칙으로 대조해 닫힘/열림/신규 초안을 낸다.
                    from modules.agent_history import (  # noqa: PLC0415
                        carry_verdicts,
                        find_prior,
                        guess_original_name,
                        incomplete_checkers,
                        match_findings,
                        verdict_key,
                    )
                    prior = find_prior(
                        # 반영 확인은 내가 볼 수 있는(같은 팀) 이전 검토와 잇는다 —
                        # 다른 팀 검토에 회신본을 이으면 판정 이력이 뒤섞인다.
                        _with_names([e.as_dict() for e in history.list(limit=200, owners=visible)]),
                        guess_original_name(path.name))
                    if prior:
                        before = (history.get(prior["id"]) or {}).get("payload", {})
                        prior_findings = before.get("findings", [])
                        # 이번에 제 몫을 다 못 한 검사기가 낸 지적은 "사라졌다"고
                        # 말할 수 없다 — 애초에 안 봤으니까(match_findings 의 blind).
                        lin = match_findings(
                            prior_findings, payload["findings"],
                            blind=incomplete_checkers(payload["findings"]))
                        payload["lineage_candidate"] = {
                            "id": prior["id"], "title": prior["title"], "at": prior["at"],
                            "by": prior.get("by", "")}
                        payload["lineage"] = {
                            "parent_id": prior["id"],
                            # key 는 판정을 어느 지적에 붙였는지다. 순번은 그
                            # 검토 안에서만 뜻이 있어 다음 검토로 못 잇는다.
                            "items": [{"finding": it.finding, "status": it.status,
                                       "key": verdict_key(it.finding),
                                       # 화면이 이걸로 문서의 그 자리를 연다.
                                       "match_id": it.match_id}
                                      for it in lin.items],
                            "new_findings": lin.new_findings}
                        # 지난 검토에서 "해당없음"이라 한 지적은 다시 묻지 않는다.
                        # 검사기는 다음에도 똑같이 내므로, 안 이으면 검토자가 매번
                        # 같은 것을 다시 눌러야 한다.
                        carried = carry_verdicts(
                            before.get("lineageVerdicts") or {}, lin.items)
                        if carried:
                            payload["lineageVerdicts"] = carried
                            # 어느 것을 무슨 값으로 이어받았는지 밝힌다. 안 밝히면
                            # 검토자가 기계가 정한 판정으로 오해한다. **값까지** 담는
                            # 이유는 검토자가 덮어쓰면 더 이상 이어받은 것이 아니어서,
                            # 그때 태그를 떼려면 원래 값을 알아야 하기 때문이다.
                            payload["lineageCarried"] = dict(carried)
                try:
                    orig = (path.name, path.read_bytes())
                except OSError:
                    orig = None
                return _remember("review", payload, original=orig, owner=owner)
            except (UnsupportedFormatError, NotImplementedError) as exc:
                raise RuntimeError(f"검토할 수 없습니다: {exc}") from exc
            except Exception as exc:  # noqa: BLE001 — 메시지를 화면 말로 바꿔 올린다
                raise RuntimeError(f"검토 중 오류: {exc}") from exc
            finally:
                tmp.cleanup()          # 업로드본은 작업이 쥐고 있다

        # 예전에는 스트림이 끝날 때 워커를 join 하고 임시 파일을 지웠다. 무기한
        # join 은 클라이언트가 끊겨도 검토가 끝날 때까지(수 분) Starlette 스레드풀
        # 토큰을 점유해, 새로고침 몇 번에 풀(기본 40)이 고갈됐다. 이제 검사는
        # 작업 스레드가 지고 스트림은 구독일 뿐이라 그 문제 자체가 없다.
        return _job_stream(jobs.start("review", path.name, owner, work))

    def _team_preset(choice: str) -> dict:
        """고른 팀 id → 기준 파일 내용. 목록에 없는 이름은 거절한다.

        브라우저가 보낸 문자열을 경로로 그대로 쓰면 서버의 아무 파일이나 읽게 된다
        (../../etc/passwd). 그래서 경로를 만들지 않고 열거한 목록에서 찾는다 —
        _criteria_for 와 같은 방어다.
        """
        import yaml  # noqa: PLC0415
        for f in sorted((seed_root / "teams").glob("*.y*ml")):
            if f.stem == choice:
                return yaml.safe_load(f.read_text(encoding="utf-8")) or {}
        raise HTTPException(status_code=404, detail=f"그런 팀 기준이 없습니다: {choice}")

    def _team_documents(team: str) -> list[str]:
        """팀 yaml 의 outputs + single_outputs 에 적힌 산출물 key 를 순서대로, 중복 없이."""
        try:
            data = _team_preset(team)
        except HTTPException:
            return []
        out: list[str] = []
        for sec in ("outputs", "single_outputs"):
            for o in data.get(sec) or []:
                key = str((o or {}).get("key") or "").strip()
                if key and key not in out:
                    out.append(key)
        return out

    def _case_spec(team: str) -> dict:
        """폴더 검토용 팀 기준. 산출물 목록이 없으면 그 사실을 말한다.

        `outputs` 는 xlsx 에서 안 나온다 — 사람이 실제 문서를 열어보고 "어느
        산출물의 어느 칸을 어떻게 뽑나"를 채운 절이다(presets/README.md). 그래서
        팀 기준이 있어도 이 절은 없을 수 있고, 지금 7팀 중 하나만 갖고 있다.

        없는 채로 돌리면 모든 파일이 **조용히 "미분류"** 로 떨어진다. 검토자는
        자기가 파일을 잘못 올렸다고 생각하지, 기준이 없다고는 생각하지 않는다.
        """
        spec = _team_preset(team)
        if not spec.get("outputs"):
            raise HTTPException(
                status_code=400,
                detail=f"{spec.get('name', team)}은 폴더 검토 기준(산출물 목록)이 "
                       "아직 없습니다. 단일 검토나 비교 검토를 쓰거나, 팀 기준에 "
                       "산출물 목록을 먼저 채워야 합니다.")
        return spec

    @app.get("/api/teams/{team}/single-outputs")
    def team_single_outputs(team: str, name: str = "") -> dict:
        """단일 검토 시작 화면용: 이 팀의 문서 종류 목록과 파일명으로 가린 결과.

        {outputs: [{key}], detected: key 또는 "", why: 못 가린 이유}. 종류 목록이
        없는 팀은 outputs 가 비고, 화면은 그 줄을 안 그린다.
        """
        try:
            outs = _single_outputs(team)
        except Exception as exc:  # noqa: BLE001 — 모르는 팀·깨진 yaml 은 400
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        detected, why = "", ""
        if outs and name:
            from .case import output_spec_for  # noqa: PLC0415
            spec, why = output_spec_for(name, _team_preset(team))
            detected = str((spec or {}).get("key", ""))
        return {"outputs": [{"key": str(o["key"])} for o in outs],
                "detected": detected, "why": why}

    @app.get("/api/teams/{team}/criteria")
    async def team_criteria(team: str) -> dict:
        """이 팀의 검토 기준. 판정에 쓰이는 그대로 내려준다.

        리포트가 "시험항목명 0/4" 라고만 말하면 검토자는 어느 4곳을 봐야 했는지,
        어느 라벨을 찾다 실패했는지 모른다 — 그 답이 여기 있다.

        읽기 전용이다. 고치기는 미리보기가 함께 있어야 열 수 있다(roadmap 참고) —
        라벨 한 글자만 틀려도 그 필드가 통째로 미검토가 된다.
        """
        from .case import to_ui_criteria_payload  # noqa: PLC0415
        spec = _team_preset(team)
        return to_ui_criteria_payload(spec)

    @app.post("/api/history/{entry_id}/confirm")
    async def confirm_case(request: Request, entry_id: str,
                           body: dict = Body(...)) -> dict:
        """산출물 세트 검토의 "직접 확인" 결과를 이력에 남긴다.

        문서 간 md §4 의 3항목(접수번호 · 접수일↔works · 의뢰기관명↔사업자등록증)은
        문서 대조로 판정할 수 없다. 사람이 외부 원천을 보고 확인한 뒤 눌러야 점검이
        끝난다 — 그 표시가 브라우저에만 있으면 나중에 기록을 열었을 때 "이 건은
        발급했나" 를 알 수 없다.

        payload 를 통째로 받지 않는다. 브라우저가 보낸 것이 검사 결과를 덮어쓰면
        안 된다 — 확인 표시는 사람이 정하지만 지적은 도구가 정한다.
        """
        ids = body.get("checked", [])
        parsed_inputs = body.get("inputs", {})
        if not isinstance(ids, list):
            raise HTTPException(status_code=400, detail="확인 목록이 배열이 아닙니다.")
        if not isinstance(parsed_inputs, dict):
            raise HTTPException(status_code=400, detail="직접 입력값이 객체가 아닙니다.")
        try:
            before = history.get(entry_id)
        except HistoryError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        if before.get("kind") != "case":
            raise HTTPException(status_code=400, detail="폴더 검토 이력이 아닙니다.")
        payload = dict(before.get("payload") or {})
        allowed = {str(m.get("id")) for m in payload.get("manual", [])}
        unknown = ({str(i) for i in ids} | {str(k) for k in parsed_inputs}) - allowed
        if unknown:
            raise HTTPException(status_code=400,
                                detail="알 수 없는 직접 확인 항목입니다: "
                                       f"{', '.join(sorted(unknown))}")
        if any(not isinstance(v, str) or len(v) > 1000 for v in parsed_inputs.values()):
            raise HTTPException(status_code=400,
                                detail="직접 입력값은 1000자 이하 문자열이어야 합니다.")
        from .manual_review import manual_review_patch  # noqa: PLC0415
        patch = manual_review_patch(payload, [str(i) for i in ids], parsed_inputs)
        patch["confirmedAt"] = datetime.now(UTC).isoformat(timespec="seconds")
        # 기록이 팀에 공유되니 "누가 확인했나"도 남긴다 — 발급 여부를 사람이
        # 외부 원천을 보고 눌렀는데, 그게 누구인지 없으면 되물을 데가 없다.
        patch["confirmedBy"] = _session_email(request)
        try:
            record = history.update_payload(entry_id, patch, refresh_summary=True)
        except HistoryError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return record.get("payload", {})

    @app.post("/api/history/{entry_id}/lineage")
    async def confirm_lineage(request: Request, entry_id: str,
                              verdicts: str = Form(...)) -> dict:
        """재검토의 "반영 확인" 판정을 이력에 남긴다.

        지난번 지적마다 붙는 열림·닫힘은 **기계가 규칙으로 본 것**이다(인용문이
        이번 검토에도 나왔나). 검토자가 그것을 보고 실제 판정을 내리는데, 그 값이
        브라우저에만 있으면 새로고침 한 번에 사라진다 — 27건을 하나씩 확인해도
        남는 것이 없다. 화면은 고칠 수 있다고 보여주면서 실제로는 못 고쳤다.

        **기계 판정을 덮지 않고 따로 담는다**(`lineageVerdicts`). 덮으면 판정 근거가
        사라져 검토자가 자동 판정을 믿을지 판단할 수 없고, 다시 검토해 기계 판정이
        새로 계산될 때 사람이 한 일까지 같이 지워진다. confirm_case 가 `manualChecked`
        를 따로 두는 것과 같은 이유다 — 확인 표시는 사람이 정하지만 지적은 도구가
        정한다.

        열쇠는 **지적의 신원**이다(`lineage.items[].key` = agent_history.verdict_key).
        순번은 그 검토 안에서만 뜻이 있어 다음 검토의 3번째는 다른 지적이다 —
        `해당없음` 을 물려주려면 무엇에 대한 판정인지가 남아야 한다. 옛 기록은
        순번으로 저장돼 있고 화면이 그것도 읽는다(views.js 의 `saved[String(i)]`).
        """
        try:
            parsed = json.loads(verdicts) if verdicts else {}
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=400,
                                detail=f"판정을 읽지 못했습니다: {exc}") from exc
        if not isinstance(parsed, dict):
            raise HTTPException(status_code=400, detail="판정은 객체여야 합니다.")

        from modules.agent_history import STATUSES  # noqa: PLC0415
        bad = sorted({v for v in parsed.values() if v not in STATUSES})
        if bad:
            raise HTTPException(
                status_code=400,
                detail=f"모르는 판정입니다: {', '.join(map(str, bad))}")
        try:
            saved = {str(k): str(v) for k, v in parsed.items()}
            # 검토자가 덮어쓴 것은 더 이상 "지난 판정"이 아니다. 안 떼면 이번에
            # 자기가 바꿔놓고도 지난번 것을 물려받은 줄 안다 — 실측으로 그렇게
            # 남아 있었다(이어받은 값 `해당없음`, 저장된 값 `미반영`, 태그는 그대로).
            before = (history.get(entry_id) or {}).get("payload", {})
            carried = {k: v for k, v in (before.get("lineageCarried") or {}).items()
                       if saved.get(k) == v}
            record = history.update_payload(entry_id, {
                "lineageVerdicts": saved,
                "lineageCarried": carried,
                "lineageConfirmedAt":
                    datetime.now(UTC).isoformat(timespec="seconds"),
                "lineageConfirmedBy": _session_email(request),
            })
        except HistoryError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return record.get("payload", {})

    @app.post("/api/history/{entry_id}/dismiss")
    async def dismiss_finding(request: Request, entry_id: str,
                              finding_id: str = Form(...),
                              dismissed: str = Form("1")) -> dict:
        """검토자가 "이건 잘못된 지적"이라고 뺀 것을 이력에 남긴다(2026-09-15 품질팀).

        두 가지를 함께 적는다.
        - `dismissed`: 이번 검토에서 뺀 지적의 id — 화면이 목록에서 내리고 건수로 센다.
        - `lineageVerdicts[열쇠] = 해당없음`: 열쇠는 지적의 신원(verdict_key, 인용문
          기반)이라 **다음에 같은 문서를 검토하면 기존 이어받기(carry_verdicts)가
          그대로 물려받는다.** 순번으로 남기면 다음 검토의 3번째는 다른 지적이다.

        지적 자체는 지우지 않는다 — 검사기가 낸 것은 남고, 검토자가 뺐다는 사실이
        따로 붙는다(confirm_lineage 와 같은 원칙). 되돌리기(dismissed=0)도 같은 길.
        """
        from modules.agent_history import verdict_key  # noqa: PLC0415

        try:
            before = history.get(entry_id)
        except HistoryError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        if before.get("kind") not in ("review", "checklist"):
            raise HTTPException(status_code=400, detail="단일 검토 이력이 아닙니다.")
        payload = before.get("payload") or {}
        finding = next((f for f in payload.get("findings") or []
                        if str(f.get("id")) == finding_id), None)
        if finding is None:
            raise HTTPException(status_code=400, detail=f"그런 지적이 없습니다: {finding_id}")
        on = dismissed not in ("0", "false", "")
        key = verdict_key(finding)
        verdicts = dict(payload.get("lineageVerdicts") or {})
        ids = [i for i in (payload.get("dismissed") or []) if i != finding_id]
        carried = dict(payload.get("lineageCarried") or {})
        if on:
            verdicts[key] = "해당없음"
            ids.append(finding_id)
        elif verdicts.get(key) == "해당없음":
            del verdicts[key]
        carried.pop(key, None)      # 검토자가 직접 정한 것은 더 이상 "지난 판정"이 아니다
        try:
            record = history.update_payload(entry_id, {
                "dismissed": ids, "lineageVerdicts": verdicts, "lineageCarried": carried,
                "dismissedBy": _session_email(request),
                "dismissedAt": datetime.now(UTC).isoformat(timespec="seconds"),
            })
        except HistoryError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return record.get("payload", {})

    @app.post("/api/history/{entry_id}/rtm-verdicts")
    async def confirm_rtm(request: Request, entry_id: str,
                          verdicts: str = Form(...)) -> dict:
        """추적표의 검토자 판정을 이력에 남긴다.

        기계 관찰(누락·반영됨…)은 도구가 계산한 근거고, 판정(만족함·수정필요)은
        검토자의 결론이다. 덮지 않고 따로 담는다(rtmVerdicts) — lineageVerdicts
        와 같은 이유다: 다시 계산돼도 사람이 한 일이 살아야 한다.

        열쇠는 요건 ID 다(orphan 은 하위 ID). 순번은 그 검토 안에서만 뜻이 있어
        다음 라운드의 3번째 행은 다른 요건이다 — lineage 가 순번으로 저장했다가
        겪은 일을 반복하지 않는다.

        부분 저장을 받는다(누른 것만) — 서버가 기존 판정과 합친다. 판정과 비고가
        모두 비면 그 열쇠는 지운다(판정 취소).
        """
        try:
            parsed = json.loads(verdicts) if verdicts else {}
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=400,
                                detail=f"판정을 읽지 못했습니다: {exc}") from exc
        if not isinstance(parsed, dict):
            raise HTTPException(status_code=400, detail="판정은 객체여야 합니다.")
        try:
            before = history.get(entry_id)
        except HistoryError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        if before.get("kind") != "compare":
            raise HTTPException(status_code=400, detail="비교 검토 이력이 아닙니다.")
        from modules.agent_history import RTM_VERDICTS, rtm_key  # noqa: PLC0415
        payload = dict(before.get("payload") or {})
        allowed = {rtm_key(row) for row in payload.get("rtm") or []} - {""}
        unknown = {str(k) for k in parsed} - allowed
        if unknown:
            raise HTTPException(
                status_code=400,
                detail=f"이 검토에 없는 요건입니다: {', '.join(sorted(unknown))}")
        merged = dict(payload.get("rtmVerdicts") or {})
        for k, v in parsed.items():
            if not isinstance(v, dict):
                raise HTTPException(status_code=400, detail="판정 값은 객체여야 합니다.")
            verdict = str(v.get("verdict") or "")
            note = str(v.get("note") or "")
            if verdict and verdict not in RTM_VERDICTS:
                raise HTTPException(status_code=400,
                                    detail=f"모르는 판정입니다: {verdict}")
            if len(note) > 1000:
                raise HTTPException(status_code=400,
                                    detail="비고는 1000자 이하여야 합니다.")
            if not verdict and not note:
                merged.pop(str(k), None)
            else:
                merged[str(k)] = {"verdict": verdict, "note": note}
        # 검토자가 덮어쓴 것은 더 이상 "지난 판정"이 아니다(confirm_lineage 와 같다).
        carried = {k: v for k, v in (payload.get("rtmCarried") or {}).items()
                   if merged.get(k) == v}
        try:
            record = history.update_payload(entry_id, {
                "rtmVerdicts": merged,
                "rtmCarried": carried,
                "rtmConfirmedAt": datetime.now(UTC).isoformat(timespec="seconds"),
                "rtmConfirmedBy": _session_email(request),
            })
        except HistoryError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return record.get("payload", {})

    @functools.lru_cache(maxsize=8)
    def _child_doc(entry_id: str):
        """비교 이력의 하위 문서 원본을 다시 읽는다. HWP 파싱이 수 초라 몇 건은 쥐고 있는다.

        원본은 보관 상한을 넘으면 밀려난다(HistoryStore). 없으면 찾을 문서가
        없는 것이고, 그 사실을 말한다 — 결과표만 보고 답을 지어내면 안 된다.
        """
        one = history.original(entry_id, "B")
        if one is None:
            raise HistoryError("하위 문서 원본이 보관 기간을 지나 없습니다. "
                               "다시 비교하면 찾을 수 있습니다.")
        with tempfile.TemporaryDirectory(prefix="docreview-search-") as tmp:
            path = Path(tmp) / one[0]
            path.write_bytes(one[1])
            return normalize(load_document(path), doc_type=config.review.doc_type)

    @app.post("/api/history/{entry_id}/search")
    async def search_missing(entry_id: str, requirement_id: str = Form(""),
                             hint: str = Form("")) -> dict:
        """누락 요건 하나를 검토자의 말로 다시 찾는다(4단계).

        비교 때 자동으로 돈 것(3단계)과 같은 함수다 — 모델이 설계서가 쓸 법한
        말을 떠올리고, 코드가 찾고, 걸린 절을 모델이 확인한다. 힌트가 있으면
        떠올린 말 앞에 선다. 결과는 이력의 같은 열쇠(rtmSearches)에 덮어써서
        새로고침해도 남는다. 라벨(누락)은 안 바뀐다 — 판정은 검토자가 한다.
        """
        rid = (requirement_id or "").strip()
        hint = (hint or "").strip()
        if not rid or len(hint) > 200:
            raise HTTPException(status_code=400,
                                detail="요건 ID 가 필요하고 힌트는 200자 이내여야 합니다.")
        if not config.llm_enabled or config.llm_provider == "echo":
            raise HTTPException(status_code=400,
                                detail="LLM 이 꺼져 있어 찾을 수 없습니다.")
        try:
            record = history.get(entry_id)
        except HistoryError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        if record.get("kind") != "compare":
            raise HTTPException(status_code=400, detail="비교 검토 이력이 아닙니다.")
        payload = record.get("payload") or {}
        row = next((r for r in payload.get("rtm") or [] if r.get("upper_id") == rid), None)
        if row is None:
            raise HTTPException(status_code=400, detail=f"이 검토에 없는 요건입니다: {rid}")
        from modules.agent_trace import judge_missing  # noqa: PLC0415
        try:
            child = await run_in_threadpool(_child_doc, entry_id)
        except HistoryError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except (UnsupportedFormatError, NotImplementedError, OSError) as exc:
            raise HTTPException(status_code=400,
                                detail=f"하위 문서를 읽지 못했습니다: {exc}") from exc
        judgment = await run_in_threadpool(
            lambda: judge_missing(rid, row.get("text") or "", row.get("probes") or [],
                                  child, build_llm(config), hint=hint))
        found = judgment.to_dict()
        searches = dict(payload.get("rtmSearches") or {})
        searches[rid] = found
        try:
            history.update_payload(entry_id, {"rtmSearches": searches})
        except HistoryError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return {"requirement_id": rid, **found}

    @app.post("/api/classify-case")
    async def classify_case(names: str = Form(...), team: str = Form(...)) -> dict:
        """파일명만으로 산출물을 판별한다. 업로드 전에 확인받기 위한 것이다.

        업로드는 수십 MB 인데 판별 근거는 파일명의 양식번호뿐이다 — 무엇이 무엇인지
        확인받는 데 파일을 다 올릴 이유가 없다.

        확인을 받는 이유: 양식번호가 없는 파일을 추측으로 배정하면 엉뚱한 필드맵으로
        검사해 거짓 지적이 난다. 사람이 지정하거나 제외해야 한다.
        """
        from .case import classify_names  # noqa: PLC0415
        spec = _case_spec(team)
        try:
            parsed = json.loads(names)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=400,
                                detail=f"파일 이름 목록을 읽지 못했습니다: {exc}") from exc
        if not isinstance(parsed, list):
            raise HTTPException(status_code=400, detail="파일 이름 목록이 배열이 아닙니다.")
        return classify_names([str(n) for n in parsed], spec,
                              team_name=spec.get("name", team))

    @app.post("/api/review-case")
    async def review_case_endpoint(request: Request,
                                   files: list[UploadFile] = File(...),
                                   team: str = Form(...)) -> StreamingResponse:
        """산출물 세트를 한 번에 검토하고 진행을 SSE 로 흘린다.

        업로드·팀 검증 실패는 스트림을 열기 전에 끝낸다 — 스트림이 열린 뒤에는
        상태코드를 고칠 수 없다(/api/review 와 같은 사정).
        """
        spec = _case_spec(team)
        if not files:
            raise HTTPException(status_code=400, detail="파일이 없습니다.")

        # 검토는 응답이 반환된 뒤에도 스레드에서 돈다. 여기서 지우면 검토 도중에
        # 원본이 사라진다 — 스트림이 끝날 때 지운다.
        tmp = tempfile.TemporaryDirectory(prefix="docreview-case-")
        try:
            saved = [await _save_upload(f, Path(tmp.name)) for f in files]
        except BaseException:
            tmp.cleanup()
            raise

        owner = _session_email(request)

        def work(emit) -> dict:
            """폴더 검토 본체. emit 으로 단계를 흘리고 결과를 돌려준다."""
            try:
                from .case import review_case, to_ui_case_payload  # noqa: PLC0415
                result = review_case(saved, spec, on_progress=emit)
                payload = to_ui_case_payload(result, spec.get("name", team))
                return _remember("case", payload, owner=owner)
            except Exception as exc:  # noqa: BLE001 — 메시지를 화면 말로 바꿔 올린다
                raise RuntimeError(f"검토 중 오류: {exc}") from exc
            finally:
                tmp.cleanup()          # 업로드본은 작업이 쥐고 있다

        return _job_stream(jobs.start(
            "case", spec.get("name", team) or "산출물 세트", owner, work))

    @app.post("/api/locate")
    async def locate_findings(file: UploadFile | None = File(None),
                              findings: str = Form(...),
                              images: str = Form("[]"),
                              history_id: str = Form(""),
                              slot: str = Form("")) -> dict:
        """지적이 PDF의 어디에 있는지 좌표로 돌려준다(JSON).

        화면 뷰어가 지적 위치로 스크롤하고 형광펜을 얹는 데 쓴다. /api/annotate와
        입력이 같고 출력만 JSON이다 — 굽지 않으므로 훨씬 싸고, 화면은 원본을
        그대로 그린다(요약 페이지 오프셋 보정이 사라진다).

        `history_id` 를 주면 서버가 보관 중인 변환본을 쓴다 — 브라우저가 PDF 를
        올릴 필요가 없다. 검토 직후에는 아직 저장 전일 수 있어 `file` 로 온다.

        images(번호·원본 크기)를 함께 주면 **그림 설명에서 나온 지적**도 짚는다.
        그 설명은 파싱 본문에만 있고 PDF 텍스트 레이어에는 없어서 인용문으로는
        영원히 못 찾는다. 화면은 검토 payload 의 images 를 그대로 되돌려보낸다.
        """
        if not history_id and not (file and (file.filename or "").lower().endswith(".pdf")):
            raise HTTPException(status_code=400, detail="PDF만 좌표를 찾을 수 있습니다.")
        try:
            items = json.loads(findings)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=400,
                                detail=f"findings를 읽지 못했습니다: {exc}") from exc
        if not isinstance(items, list):
            raise HTTPException(status_code=400, detail="findings는 배열이어야 합니다.")

        try:
            image_meta = json.loads(images)
        except json.JSONDecodeError:
            image_meta = []          # 그림 좌표만 못 짚는다. 검토는 그대로 돌아간다.
        if not isinstance(image_meta, list):
            image_meta = []

        if history_id:
            return _history_marks(history_id, slot, items, image_meta)
        with tempfile.TemporaryDirectory(prefix="docreview-") as tmp:
            data = (await _save_upload(file, Path(tmp))).read_bytes()
        return _locate_or_400(data, items, image_meta)

    @app.post("/api/annotate")
    async def annotate_pdf(file: UploadFile = File(...),
                           findings: str = Form(...)) -> Response:
        """원본 PDF에 지적을 형광펜으로 표시해 돌려준다.

        브라우저가 들고 있는 파일을 올려받는다 — 화면에서 "표시본 내려받기" 를
        누를 때만 쓰므로(뷰어 형광펜은 /api/locate 다) 이력 경로는 두지 않았다.
        검토 직후라면 브라우저가 그 파일을 아직
        들고 있으므로 다시 올리면 된다 — 보관 정책을 뒤집지 않고도 같은 일을 한다.

        표시하지 못한 지적은 헤더로 알린다. 응답 본문은 PDF라서 여기 말고는
        말할 자리가 없고, 조용히 넘기면 "형광펜이 없다 = 지적이 없다"가 된다.
        """
        if not (file.filename or "").lower().endswith(".pdf"):
            raise HTTPException(status_code=400,
                                detail="PDF만 표시할 수 있습니다.")
        try:
            items = json.loads(findings)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=400,
                                detail=f"findings를 읽지 못했습니다: {exc}") from exc
        if not isinstance(items, list):
            raise HTTPException(status_code=400, detail="findings는 배열이어야 합니다.")

        with tempfile.TemporaryDirectory(prefix="docreview-") as tmp:
            path = await _save_upload(file, Path(tmp))
            data = path.read_bytes()

        try:
            marked = annotate(data, items, doc_name=file.filename or "",
                              brand="DocSuree · 문서 일관성 검토 Agent")
        except Exception as exc:  # noqa: BLE001 — 깨진 PDF가 서버를 죽이지 않게
            raise HTTPException(
                status_code=400, detail=f"PDF에 표시하지 못했습니다: {exc}") from exc

        stem = Path(file.filename).stem
        return Response(
            content=marked.pdf, media_type="application/pdf",
            headers={
                # 헤더는 ASCII만 안전하다. 개수만 보내고, 무엇이 빠졌는지는
                # 화면이 이미 들고 있는 findings에서 id로 찾는다.
                "X-Marked-Count": str(marked.marked),
                "X-Unmarked-Count": str(len(marked.unmarked)),
                "X-Unmarked-Ids": ",".join(
                    str(u.get("id") or "") for u in marked.unmarked),
                # 요약 페이지는 한글 폰트가 있어야 넣는다. 못 넣었으면 화면이
                # 그 사실을 말한다 — 조용히 빠지면 그런 페이지가 있다는 것도 모른다.
                "X-Summary": "1" if marked.summary else "0",
                # 표시본 앞에 삽입된 요약 페이지 수. 화면이 지적 page로 점프할 때
                # 이만큼 밀어 보정한다(요약을 못 넣었으면 0).
                "X-Summary-Pages": str(marked.summary_pages),
                # 지적 id → 지면에 찍힌 번호. 화면 카드가 같은 번호를 달아야
                # "3번 지적"이 표시본과 화면에서 같은 것을 가리킨다. id도 번호도
                # ASCII라 헤더에 안전하다(한글은 여기 실을 수 없다).
                "X-Numbers": json.dumps(marked.numbers, ensure_ascii=True),
                "Access-Control-Expose-Headers":
                    "X-Marked-Count, X-Unmarked-Count, X-Unmarked-Ids, "
                    "X-Summary, X-Summary-Pages, X-Numbers",
                "Content-Disposition": _disposition(f"{stem}.marked.pdf"),
            })

    @app.post("/api/suggest")
    def suggest(message: str = Form(...), quote: str = Form(""),
                criterion: str = Form(""), llm: str = Form("on"),
                others: str = Form("")) -> dict:
        """지적 하나에 대한 수정안. 검토자가 그 지적을 눌렀을 때만 부른다.

        검토 전체에 걸어두지 않는다 — 지적 대부분은 읽고 넘기는 것이라,
        매번 문장을 새로 짓게 하면 검토가 느려지고 비싸진다.

        문서 본문이 아니라 그 지적의 근거 인용만 보낸다. 고쳐 쓸 대상이
        그 문장이고, 문서 전체를 매번 모델에 넣을 이유가 없다.

        criterion 은 그 지적을 낸 기준의 본문이다. 화면이 역맵에서 꺼내 보낸다 —
        기준을 모르면 어느 방향으로 고칠지 알 수 없다(SI 단위계는 "5kg" 가 아니라
        "5 kg" 가 맞는데, "띄어쓰기 오류"만 주면 반대로 붙여놓을 수 있다).
        기준 없는 일반 검토면 빈 문자열이고, 그때는 기준 절을 만들지 않는다.

        못 만들면 ok=false로 답한다. 여기서 그럴듯한 문장을 지어내면
        검토자가 원문을 안 보고 갈아끼운다.
        """
        cfg = _with_llm(llm)
        # others 는 같은 지적이 함께 든 다른 인용(줄바꿈으로 구분). 모순 지적은
        # 두 곳이 어긋나 나오는데, 한 곳만 주면 모델이 다른 쪽을 정답으로 삼아
        # 이쪽을 거기 맞춰 고쳐 쓴다 — 어느 쪽이 사실인지 아무도 안 봤는데도.
        out = suggest_revision(build_llm(cfg), message, quote, criterion,
                               others=others.splitlines())
        return {"ok": out.ok, "original": out.original,
                "revised": out.revised, "reason": out.reason}

    def _history_pdf(entry_id: str, slot: str = "") -> bytes:
        """이력에 보관된 원본을 뷰어용 PDF 로 준다. 변환본은 캐시한다.

        브라우저가 파일을 올려 줄 필요가 없다 — **서버가 이미 갖고 있다.**
        예전에는 없었고(결과만 남기던 정책), 그때 쓰던 "브라우저가 다시 올린다"
        방식이 원본 보관이 생긴 뒤에도 남아 있었다. 그래서 기록을 열 때마다
        2MB 짜리 원본이 서버→브라우저→서버로 왕복하고 LibreOffice 가 7초를 다시
        썼다.
        """
        got = history.original(entry_id, slot)
        if got is None:
            raise HTTPException(
                status_code=404,
                detail="보관된 원본이 없습니다(개수 제한으로 밀렸거나 미저장).")
        name, data = got
        if name.lower().endswith(".pdf"):
            return data                      # 원본이 PDF 면 변환할 것이 없다
        cache_key = CONVERSION_VERSION + ":" + hashlib.sha256(data).hexdigest()
        cached = history.rendered(entry_id, slot, cache_key=cache_key)
        if cached is not None:
            return cached
        with tempfile.TemporaryDirectory(prefix="docreview-") as tmp:
            src = Path(tmp) / name
            src.write_bytes(data)
            pdf = _to_pdf_or_400(src)
        history.save_rendered(entry_id, pdf, slot=slot, cache_key=cache_key)
        return pdf

    def _draft_findings(payload: dict) -> list:
        """부록 B 초안 → 원문 창이 형광펜 자리로 쓰는 지적 목록.

        **화면(app.js openEvalDoc)과 같은 모양·같은 id("e<항목 순번>")** 여야 한다 — 좌표
        캐시 키가 이 목록으로 만들어지므로, 여기서 만든 것과 화면이 보내는 것이 다르면
        미리 계산한 좌표를 화면이 못 쓴다.
        """
        by_item = {r.get("item_id"): r for r in payload.get("rows") or []}
        out = []
        for i, it in enumerate(payload.get("items") or []):
            r = by_item.get(it.get("id")) or {}
            ev = [{"quote": q["quote"], **({"page": q["page"]} if q.get("page") else {}),
                   **({"section": q["section"]} if q.get("section") else {})}
                  for q in r.get("quotes") or [] if q.get("quote")]
            if not ev:
                continue
            head = f"제안 {r.get('verdict_hint') or ''} · " if r.get("status") == "drafted" else ""
            out.append({"id": f"e{i}", "sev": "info", "message": head + (r.get("comment") or ""),
                        "evidence": ev})
        return out

    def _history_marks(entry_id: str, slot: str, items: list, image_meta: list) -> dict:
        """이력의 지적 좌표. 같은 것을 또 물으면 저장해 둔 답을 준다.

        locate 는 61쪽 문서에서 인용문을 전부 찾느라 실측 1.48초다. 기록을 열
        때마다 같은 계산을 다시 했다.
        """
        data = _history_pdf(entry_id, slot)
        # 과거 단일 검토도 저장된 소속 절 본문으로 문맥을 보충한다. 비교의 다른 문서
        # 본문을 섞지 않으며, 이력 자체는 수정하지 않는다.
        record = history.get(entry_id)
        payload = record.get("payload") or {}
        if not slot:
            items = with_location_context(items, payload.get("sections") or [])
        key = hashlib.sha256(
            json.dumps([LOCATION_VERSION, hashlib.sha256(data).hexdigest(), items, image_meta],
                       ensure_ascii=False,
                       sort_keys=True).encode("utf-8")).hexdigest()
        cached = history.marks(entry_id, slot)
        if cached is not None and cached.get("key") == key:
            return cached.get("marks") or {}
        out = _locate_or_400(data, items, image_meta)
        history.save_marks(entry_id, {"key": key, "marks": out}, slot=slot)
        return out

    def _locate_or_400(data: bytes, items: list, image_meta: list) -> dict:
        try:
            return {**locate(data, items, images=image_meta),
                    "pdf_sha256": hashlib.sha256(data).hexdigest()}
        except Exception as exc:  # noqa: BLE001 — 깨진 PDF가 서버를 죽이지 않게
            raise HTTPException(
                status_code=400, detail=f"좌표를 찾지 못했습니다: {exc}") from exc

    def _to_pdf_or_400(path: Path) -> bytes:
        """변환 실패를 화면이 읽을 수 있는 오류로 바꾼다."""
        try:
            return to_pdf(path)
        except (UnsupportedFormatError, NotImplementedError) as exc:
            raise HTTPException(
                status_code=400, detail=f"이 형식은 변환할 수 없습니다: {exc}") from exc
        except ConvertUnavailable as exc:
            raise HTTPException(status_code=501, detail=str(exc)) from exc
        except Exception as exc:  # noqa: BLE001 — 변환 실패가 서버를 죽이지 않게
            raise HTTPException(
                status_code=400, detail=f"변환하지 못했습니다: {exc}") from exc

    @app.post("/api/render-pdf")
    async def render_pdf(file: UploadFile | None = File(None),
                         history_id: str = Form(""),
                         slot: str = Form("")) -> Response:
        """비-PDF 문서를 PDF로 변환해 돌려준다(뷰어가 PDF만 다루게).

        **두 가지로 부를 수 있다.**
        - `history_id` — 이력에 보관된 원본을 서버가 직접 쓴다. 변환본이 캐시돼
          있으면 변환조차 안 한다(실측 7초 → 0초). 기록에서 열 때 이쪽이다.
        - `file` — 검토 직후. 그때는 결과를 아직 저장 전일 수 있고 브라우저가
          파일을 들고 있으므로 올려받는 편이 빠르다.
        """
        if history_id:
            pdf = _history_pdf(history_id, slot)
            return Response(content=pdf, media_type="application/pdf",
                            headers={"X-DocSuree-PDF-SHA256": hashlib.sha256(pdf).hexdigest()})
        if file is None:
            raise HTTPException(status_code=400,
                                detail="file 또는 history_id 가 필요합니다.")
        with tempfile.TemporaryDirectory(prefix="docreview-") as tmp:
            pdf = _to_pdf_or_400(await _save_upload(file, Path(tmp)))
        return Response(content=pdf, media_type="application/pdf",
                        headers={"X-DocSuree-PDF-SHA256": hashlib.sha256(pdf).hexdigest()})

    @app.post("/api/detect")
    async def detect(file: UploadFile = File(...)) -> dict:
        """업로드 문서를 체크리스트마다 재서 요건 ID가 몇 개 걸리는지 돌려준다.

        **잘못된 체크리스트의 실패는 에러가 아니라 조용한 0건이다.** 패턴이 안
        맞으면 ID를 한 개도 못 찾고, 화면에는 "지적 없음"이 뜬다 — 검토를 통과한
        것처럼 보인다. 실측에서 두 번 겪었다(PLT56 문서에 PLT34 패턴을 쓴 경우,
        실문서에 데모 체크리스트를 쓴 경우). 그래서 고르기 **전에** 재서 알려준다.

        LLM을 부르지 않는다. 정규식 매칭이라 빠르고 결정적이다.

        아무것도 안 맞으면 best 는 None 이다 — 지어낸 추천은 이 기능이 막으려던
        바로 그 사고를 다시 만든다.
        """
        with tempfile.TemporaryDirectory(prefix="docreview-") as tmp:
            path = await _save_upload(file, Path(tmp))
            try:
                # 파싱을 이벤트 루프 위에서 돌리면 그동안 서버 전체가 멈춘다.
                # 실측: 파일을 올리면 이 요청이 곧장 나가는데, 바로 이어 시작한
                # 비교 SSE 가 이 뒤에 3.8초 줄을 서서 진행 화면이 "대기"에 묶였다.
                doc = await run_in_threadpool(
                    lambda: normalize(load_document(path)))
            except (UnsupportedFormatError, NotImplementedError) as exc:
                raise HTTPException(
                    status_code=400, detail=f"읽을 수 없는 형식입니다: {exc}") from exc
            except Exception as exc:  # noqa: BLE001 — 깨진 파일이 서버를 죽이지 않게
                raise HTTPException(
                    status_code=400, detail=f"문서를 읽지 못했습니다: {exc}") from exc

        #: 감지 응답에 실을 요건 ID 상한. 화면은 마디를 세어 후보를 만들 뿐이라
        #: 전부 필요하지 않고, 수천 개짜리 문서에서 응답이 부풀지 않게 한다.
        _DETECT_MAX_IDS = 400

        detected = []
        for meta in _teams():
            review = _config_for(meta["id"]).review
            # 예시로 적힌 ID 까지 세면 담당 범위 후보가 하나 더 생긴다.
            ids = extract_id_anchors(doc, review.id_pattern,
                                     review.id_example_words)
            detected.append({
                **meta,
                # 화면에 정규식을 띄울 수는 없다. 체크리스트가 적어둔 예시를 쓴다.
                "id_example": review.id_example,
                # ID 의 조각 이름. 담당 범위 칸이 "어느 조각을 적나"를 보여준다.
                "id_format": review.id_format,
                # 패턴이 아예 없는 체크리스트와 "패턴은 있는데 0개"는 다른 상태다.
                "has_pattern": bool(review.id_pattern),
                "matches": len(ids),
                # 찾은 ID 자체. 개수만 주면 화면이 "이 문서가 맡은 범위"를 짚어
                # 줄 수 없다 — 검토자는 "공통 앞부분을 적으세요" 라는 말만 보고
                # 어디서 잘라야 하는지 알 길이 없었다. 목록이 있으면 화면이
                # 후보를 만들어 건수와 함께 보여준다(scopeCandidates).
                # 상한: 화면은 마디만 세므로 전부 보낼 필요가 없다.
                "ids": sorted(ids)[:_DETECT_MAX_IDS],
            })
        detected.sort(key=lambda d: -d["matches"])
        best = detected[0]["id"] if detected and detected[0]["matches"] else None
        return {"detected": detected, "best": best}

    # ---- 계정 ----------------------------------------------------------
    # 세션은 HttpOnly 쿠키다 — JS 가 토큰을 못 읽으니 localStorage 토큰 방식의
    # XSS 탈취 경로가 없다. Secure 플래그는 안 건다(사내망 HTTP 배포).

    @app.post("/api/auth/signup")
    def auth_signup(email: str = Form(...), password: str = Form(...),
                    name: str = Form(""), dept: str = Form(""),
                    team: str = Form("")) -> dict:
        try:
            return accounts.create(email, password, name=name, dept=dept, team=team)
        except AuthError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/api/auth/login")
    def auth_login(response: Response, email: str = Form(...),
                   password: str = Form(...), remember: str = Form("")) -> dict:
        acc = accounts.verify(email, password)
        if not acc:
            raise HTTPException(
                status_code=401, detail="이메일 또는 비밀번호가 올바르지 않습니다.")
        # "로그인 상태 유지" 를 끄면 max-age 없는 세션 쿠키다 — 브라우저를 닫으면
        # 사라진다(공용 PC). 서버 쪽 기록은 어느 쪽이든 SESSION_TTL 뒤에 만료된다.
        response.set_cookie("dr_session", sessions.issue(acc["email"]),
                            max_age=SESSION_TTL if remember else None,
                            httponly=True, samesite="lax")
        return acc

    @app.post("/api/auth/logout")
    def auth_logout(request: Request, response: Response) -> dict:
        token = request.cookies.get("dr_session", "")
        if token:
            sessions.revoke(token)
        response.delete_cookie("dr_session")
        return {"ok": True}

    @app.get("/api/auth/me")
    def auth_me(request: Request) -> dict:
        """세션 복원(새로고침·재방문). 401 = 로그인 화면으로."""
        email = _session_email(request)
        acc = accounts.get(email) if email else None
        if not acc:
            raise HTTPException(status_code=401, detail="로그인이 필요합니다.")
        return acc

    @app.post("/api/auth/profile")
    def auth_profile(request: Request, name: str = Form(None),
                     dept: str = Form(None), team: str = Form(None)) -> dict:
        email = _session_email(request)
        if not email:
            raise HTTPException(status_code=401, detail="로그인이 필요합니다.")
        try:
            return accounts.update_profile(email, name=name, dept=dept, team=team)
        except AuthError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    # ---- 검토 작업 --------------------------------------------------------
    # 검토를 걸어두고 다른 화면을 봐도 되게 하는 세 개다. 목록은 알림의 원천이고
    # (그래서 새로고침해도 안 비워진다), events 는 끊긴 뒤 다시 붙는 길이다.

    @app.get("/api/jobs")
    def jobs_list(request: Request) -> dict:
        """내 검토 작업 — 진행 중이 먼저, 그다음 최근에 끝난 것."""
        return {"jobs": [j.as_dict() for j in jobs.list(_session_email(request))]}

    @app.get("/api/jobs/{job_id}/events")
    def job_events(request: Request, job_id: str) -> StreamingResponse:
        """작업에 (다시) 붙는다. 지나간 단계를 먼저 받아 화면을 지금 상태로
        세우고, 그다음 이어서 본다. 없는 작업은 404 — 화면은 그걸 보고
        "검토가 중단되었습니다"라고 말한다(서버가 다시 시작되면 그렇게 된다)."""
        job = jobs.get(job_id, _session_email(request))
        if job is None:
            raise HTTPException(status_code=404, detail="그 검토를 찾을 수 없습니다.")
        return _job_stream(job)

    @app.post("/api/jobs/{job_id}/cancel")
    def job_cancel(request: Request, job_id: str) -> dict:
        """검토를 멈춘다. 예전의 "검토 취소"는 브라우저 쪽 연결만 끊어서, 서버는
        끝까지 돌고 이력에 저장했다 — 취소한 검토가 알림에 "완료"로 떴다.

        즉시 죽이지는 않는다. 검사가 다음 진행을 알릴 때 멈추므로, LLM 한 번
        왕복 안에서는 못 멈춘다(그 호출이 돌아와야 다음 알림이 온다)."""
        if not jobs.cancel(job_id, _session_email(request)):
            raise HTTPException(
                status_code=404, detail="멈출 수 있는 검토가 아닙니다.")
        return {"cancelling": job_id}

    @app.post("/api/jobs/seen")
    def jobs_seen(request: Request, job_id: str = Form("")) -> dict:
        """읽음 처리. job_id 를 주면 그것만, 안 주면 전부."""
        return {"seen": jobs.mark_seen(_session_email(request), job_id)}

    # ---- 계정 관리(관리자) ------------------------------------------------
    # 화면에서 메뉴를 숨기는 것은 권한이 아니다 — API 를 직접 부르면 그만이다.
    # 관문은 여기 하나이고, 화면은 그 위에 얹는 편의다.

    def _require_admin(request: Request) -> str:
        email = _session_email(request)
        acc = accounts.get(email) if email else None
        if not acc:
            raise HTTPException(status_code=401, detail="로그인이 필요합니다.")
        if acc.get("role") != "admin":
            raise HTTPException(status_code=403, detail="관리자만 할 수 있습니다.")
        return acc["email"]

    @app.get("/api/admin/accounts")
    def admin_accounts(request: Request) -> dict:
        _require_admin(request)
        return {"accounts": accounts.list()}

    @app.post("/api/admin/accounts/{email}/role")
    def admin_set_role(request: Request, email: str, role: str = Form(...)) -> dict:
        me = _require_admin(request)
        # 자기 권한을 스스로 내리면 그 순간 이 화면에서 잠긴다. 다른 관리자가
        # 없으면 아무도 못 올려준다 — 서버 CLI 로만 풀 수 있다. 막는다.
        if email.strip().lower() == me and role != "admin":
            raise HTTPException(
                status_code=400,
                detail="자기 권한은 스스로 내릴 수 없습니다. 다른 관리자에게 요청하세요.")
        try:
            return accounts.set_role(email, role)
        except AuthError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.delete("/api/admin/accounts/{email}")
    def admin_delete_account(request: Request, email: str) -> dict:
        me = _require_admin(request)
        if email.strip().lower() == me:
            raise HTTPException(
                status_code=400, detail="자기 계정은 여기서 지울 수 없습니다.")
        try:
            accounts.delete(email)
        except AuthError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        # 계정만 지우면 그 사람의 세션 쿠키로 계속 들어온다.
        sessions.revoke_all(email.strip().lower())
        # 검토 기록은 남긴다 — 사람이 나가도 그 문서를 검토했다는 사실은 남는다.
        # 소유자가 사라져 목록에서는 안 보이지만 파일은 그대로다(보관 기간 정책이
        # 따로 지운다).
        return {"deleted": email.strip().lower()}

    @app.get("/api/history")
    def history_list(request: Request, limit: int = 20, offset: int = 0,
                     q: str = "", kind: str = "") -> dict:
        limit = max(1, min(limit, 100))
        # 같은 팀 기록 + 소유자 없는 기록(로그인 도입 전). 로그인 안 한 호출은
        # 소유자 없는 기록만 본다(_visible_owners).
        if len(q) > 200:
            raise HTTPException(status_code=400, detail="검색어는 200자 이내로 입력하세요")
        try:
            page = history.page(limit, offset, q=q, kind=kind,
                                owners=_visible_owners(_session_email(request)))
        except HistoryError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        _with_names(page["entries"])
        return page

    @app.get("/api/history/{entry_id}")
    def history_get(entry_id: str) -> dict:
        try:
            record = history.get(entry_id)
        except HistoryError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        _with_names([record])
        if record.get("kind") == "checklist":
            # 체크리스트 실행 결과는 payload 로 감싸지 않고 최상위로 펼쳐 준다 —
            # compare/review 화면이 이미 "payload" 한 겹을 벗겨 쓰는 관례가 있어
            # 그대로 따르면 화면마다 다시 감싸는 코드를 새로 짜야 한다.
            return {**record, **record["payload"]}
        return record

    @app.get("/api/history/{entry_id}/original")
    def history_original(entry_id: str, slot: str = "") -> Response:
        """이력에 함께 보관한 원본 문서를 돌려준다(뷰어용). 없으면 404 → 텍스트 폴백.

        slot 은 비교의 상위(A)·하위(B). 단일 검토는 안 준다.
        """
        if slot and slot not in ("A", "B"):
            raise HTTPException(status_code=400,
                                detail=f"알 수 없는 문서 자리: {slot}")
        try:
            got = history.original(entry_id, slot)
        except HistoryError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        if got is None:
            raise HTTPException(
                status_code=404,
                detail="보관된 원본이 없습니다(개수 제한으로 밀렸거나 미저장).")
        fname, data = got
        ctype = {
            ".pdf": "application/pdf",
            ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            ".hwpx": "application/octet-stream",
            ".hwp": "application/octet-stream",
        }.get(Path(fname).suffix.lower(), "application/octet-stream")
        return Response(content=data, media_type=ctype)

    def _export_stem(name: str, entry: dict) -> str:
        """내려받는 파일 이름의 앞부분: `문서명_YYYYMMDD`.

        날짜는 **검토한 날**(이력의 at)이다. 검토자는 파일 이름의 날짜로 회차를
        관리한다(2026-09-14 품질팀) — 내려받은 날을 붙이면 같은 검토가 날마다
        다른 이름이 된다.
        """
        stamp = str(entry.get("at") or "")[:10].replace("-", "")
        stem = Path(name).stem
        return f"{stem}_{stamp}" if stamp else stem

    def _xlsx_response(data: bytes, ascii_stem: str, utf8_stem: str) -> Response:
        # 파일 이름은 ASCII 로 한 번, UTF-8 로 한 번 — 옛 브라우저가 한글 이름을
        # 깨뜨리는 것을 막는 표준 수법(RFC 5987)이다.
        utf8_name = quote(f"{utf8_stem}.xlsx")
        return Response(
            content=data,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition":
                     f"attachment; filename=\"{ascii_stem}.xlsx\"; filename*=UTF-8''{utf8_name}"})

    @app.get("/api/history/{entry_id}/rtm.xlsx")
    def history_rtm_xlsx(entry_id: str) -> Response:
        """추적성 매트릭스를 xlsx 로 내려준다(보고서 부록 B).

        **서버가 만든다.** 프론트가 바닐라 JS 라 xlsx 를 만들 수 없고, 무엇보다
        기계 관찰과 사람 판정이 둘 다 여기 있다 — 판정은 이력에 따로 저장된다
        (rtmVerdicts). 화면이 들고 있는 것을 되돌려 받아 만들면, 저장 안 된
        판정이 섞여 파일과 이력이 갈린다.

        이력에 없으면 못 만든다 — 저장에 실패한 검토는 판정을 남길 수도 없으므로
        화면이 이미 그렇게 말하고 있다.
        """
        try:
            entry = history.get(entry_id)
        except HistoryError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        if entry.get("kind") != "compare":
            raise HTTPException(status_code=400, detail="비교 검토 이력이 아닙니다.")
        payload = entry.get("payload") or {}
        data = rtm_workbook(payload.get("rtm") or [],
                            payload.get("rtmVerdicts") or {})
        name = ((payload.get("docA") or {}).get("name") or "compare")
        return _xlsx_response(data, "traceability-matrix",
                              f"{_export_stem(name, entry)}.추적성매트릭스")

    @app.get("/api/history/{entry_id}/review.xlsx")
    def history_review_xlsx(entry_id: str) -> Response:
        """단일 검토 결과를 xlsx 로 내려준다.

        품질팀 피드백(2026-09-14): 검토자는 날짜 붙은 엑셀을 내려받아 자기 방식으로
        관리한다. 추적성 엑셀과 같은 이유로 서버가 만든다(review_xlsx 머리말).
        """
        try:
            entry = history.get(entry_id)
        except HistoryError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        if entry.get("kind") not in ("review", "checklist"):
            raise HTTPException(status_code=400, detail="단일 검토 이력이 아닙니다.")
        payload = entry.get("payload") or {}
        name = (payload.get("doc") or {}).get("name") or entry.get("title") or "review"
        return _xlsx_response(review_workbook(payload), "review-result",
                              f"{_export_stem(name, entry)}.검토결과")

    @app.get("/api/history/{entry_id}/evaluation.xlsx")
    def history_evaluation_xlsx(entry_id: str) -> Response:
        """부록 B 초안을 xlsx 로 내려준다. 검토자는 이걸 워드 부록에 붙인다."""
        try:
            entry = history.get(entry_id)
        except HistoryError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        if entry.get("kind") != "evaluation":
            raise HTTPException(status_code=400, detail="체크리스트 검토 이력이 아닙니다.")
        payload = entry.get("payload") or {}
        name = (payload.get("doc") or {}).get("name") or entry.get("title") or "evaluation"
        return _xlsx_response(evaluation_workbook(payload), "appendix-b-draft",
                              f"{_export_stem(name, entry)}.평가표초안")

    @app.delete("/api/history/{entry_id}")
    def history_delete(entry_id: str) -> dict:
        try:
            history.delete(entry_id)
        except HistoryError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return {"deleted": entry_id}

    async def _tables_of(file: UploadFile) -> list:
        """업로드에서 표를 뽑는다. 형식 오류는 400 으로 돌린다."""
        with tempfile.TemporaryDirectory(prefix="docreview-") as tmp:
            path = await _save_upload(file, Path(tmp))
            data = path.read_bytes()
        try:
            # 동기 파싱(zip + XML, 1.7MB·29시트면 0.3초)을 이벤트 루프 밖에서 돈다.
            # 루프 안에서 돌리면 검토 작업 스레드가 GIL 을 쥔 동안 루프가 굶어
            # 0.3초짜리가 6~35초로 늘었다(2026-09-17 실측, 시트 목록 API).
            return await run_in_threadpool(extract_tables, file.filename or "", data)
        except UnsupportedChecklistFormat as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:  # noqa: BLE001 — 깨진 파일이 서버를 죽이지 않게
            raise HTTPException(
                status_code=400, detail=f"체크리스트를 읽지 못했습니다: {exc}") from exc

    @app.post("/api/checklists/preview")
    async def checklist_preview(file: UploadFile = File(...)) -> dict:
        """등록 전에 무엇으로 읽었는지 보여준다.

        열 추측이 틀렸는데 조용히 등록되면 엉뚱한 항목으로 검토하게 된다.
        그래서 반드시 사람이 한 번 본다.
        """
        out = []
        for i, table in enumerate(await _tables_of(file)):
            head = find_header(table.rows)
            cols = guess_columns(table.rows[head]) if head is not None else {
                r: None for r in ("no", "text", "group", "note")}
            items = build_items(table.rows, head, cols) if head is not None else []
            out.append({
                "index": i,
                "label": table.label,
                "header": list(table.rows[head]) if head is not None else [],
                "header_row": head,
                "columns": cols,
                "item_count": len(items),
                # 미리보기 몇 줄. 전부 보내면 IS22 는 응답이 수 MB 가 된다.
                "sample": [{"no": it.no, "text": it.text, "group": it.group}
                           for it in items[:5]],
            })
        return {"tables": out}

    @app.post("/api/checklists")
    async def checklist_register(file: UploadFile = File(...),
                                 name: str = Form(""),
                                 table_index: int = Form(0),
                                 columns: str = Form("")) -> dict:
        tables = await _tables_of(file)
        if not 0 <= table_index < len(tables):
            raise HTTPException(status_code=400, detail="그런 표가 없습니다.")
        table = tables[table_index]
        try:
            picked = json.loads(columns) if columns else {}
        except json.JSONDecodeError as exc:
            raise HTTPException(
                status_code=400, detail=f"columns 를 읽지 못했습니다: {exc}") from exc
        if not isinstance(picked, dict) or picked.get("text") is None:
            raise HTTPException(
                status_code=400,
                detail="'항목 내용' 열을 골라야 합니다. 내용 없이는 체크할 것이 없습니다.")

        head = find_header(table.rows)
        # 헤더를 못 찾았어도 사람이 열을 골랐으면 첫 행을 헤더로 보고 진행한다.
        items = build_items(table.rows, head if head is not None else 0, picked)
        try:
            saved = checklists.save(name, file.filename or "", picked, items)
        except ChecklistError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {"id": saved.id, "name": saved.name, "item_count": len(saved.items)}

    #: 수기 기준이 params 로 줄 수 있는 값. 검사 매개변수(_CRITERION_PARAMS)에
    #: 더해, 규칙 검사기가 읽는 값들이다(agent_checklist.RULE_CHECKS 참고).
    #: 여기 없는 키는 거절한다 — 오타 하나가 조용히 무시되면 검토자는 값을
    #: 적어 놓고도 왜 안 걸리는지 알 수 없다.
    _MANUAL_PARAM_KEYS = frozenset({
        "id_pattern", "id_example", "id_example_words", "id_format",
        "id_rollup_separator", "scope_pattern",
        "scope_label", "required_sections", "placeholder_markers",
        "abbrev_sections", "abbrev_ignore", "ref_sections", "fields",
        "filename_pattern", "filename_example", "filename_forbidden",
        "font_sizes", "where", "contains", "pattern", "message",
        "find", "must", "forbid",
    })

    @app.post("/api/criteria/manual")
    async def register_manual_criteria(name: str = Form(""),
                                       items: str = Form(...)) -> dict:
        """추가 검토 기준을 손으로 등록한다(과제 층).

        파일 업로드와 같은 자리(업로드 층)에 저장하지만 출발이 다르다 — 표를
        올려 열을 고르는 대신 항목을 직접 적는다. 기준 두세 개를 얹으려고
        엑셀을 만들어 올리는 것은 배보다 배꼽이고, 무엇보다 **파일 경로로는
        mode·check·params 를 실을 수 없어** 올린 항목이 전부 "사람 확인"으로
        떨어졌다. 여기서는 검사 방식과 매개변수를 함께 받는다.

        과제마다 바뀌는 값(요건 ID 형식·담당 범위)의 제자리이기도 하다 —
        팀 기준은 과제를 모르고, 좁은 층이 넓은 층을 덮는다(config.
        apply_criteria_params).
        """
        from modules.agent_checklist import RULE_CHECKS  # noqa: PLC0415
        from modules.preset import MODES  # noqa: PLC0415

        try:
            rows = json.loads(items) if items else []
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=400,
                                detail=f"항목을 읽지 못했습니다: {exc}") from exc
        if not isinstance(rows, list) or not rows:
            raise HTTPException(status_code=400, detail="항목이 하나도 없습니다.")
        if len(rows) > 200:
            raise HTTPException(status_code=400,
                                detail="한 번에 200개까지 등록할 수 있습니다.")

        built: list = []
        for i, row in enumerate(rows, 1):
            if not isinstance(row, dict):
                raise HTTPException(status_code=400,
                                    detail=f"{i}번째 항목이 객체가 아닙니다.")
            text = str(row.get("text") or "").strip()
            if not text:
                raise HTTPException(
                    status_code=400,
                    detail=f"{i}번째 항목의 내용이 비어 있습니다 — "
                           "내용 없이는 검사할 것이 없습니다.")
            if len(text) > 2000:
                raise HTTPException(status_code=400,
                                    detail=f"{i}번째 항목이 너무 깁니다(2000자 이하).")
            mode = str(row.get("mode") or "").strip()
            if mode and mode not in MODES:
                raise HTTPException(status_code=400,
                                    detail=f"{i}번째 항목의 검사 방식을 모릅니다: {mode}")
            check = str(row.get("check") or "").strip()
            if check and check not in RULE_CHECKS:
                raise HTTPException(
                    status_code=400,
                    detail=f"{i}번째 항목의 규칙 이름을 모릅니다: {check}")
            if check and mode != "규칙":
                # 규칙 이름을 적어 놓고 mode 를 다르게 두면 그 규칙은 안 돈다.
                # 조용히 무시하면 검사되는 줄 알고 넘어간다.
                raise HTTPException(
                    status_code=400,
                    detail=f"{i}번째 항목: 규칙 이름을 적었으면 검사 방식도 '규칙'이어야 합니다.")
            params = row.get("params") or {}
            if not isinstance(params, dict):
                raise HTTPException(status_code=400,
                                    detail=f"{i}번째 항목의 params 가 객체가 아닙니다.")
            unknown = set(params) - _MANUAL_PARAM_KEYS
            if unknown:
                raise HTTPException(
                    status_code=400,
                    detail=f"{i}번째 항목: 모르는 매개변수입니다 — {', '.join(sorted(unknown))}")
            for key, value in params.items():
                if isinstance(value, str) and len(value) > 1000:
                    raise HTTPException(
                        status_code=400, detail=f"{i}번째 항목의 {key} 값이 너무 깁니다.")
                if key in ("id_pattern", "scope_pattern", "pattern", "find"):
                    try:
                        re.compile(str(value))
                    except re.error as exc:
                        raise HTTPException(
                            status_code=400,
                            detail=f"{i}번째 항목의 {key} 를 정규식으로 읽지 못했습니다: {exc}"
                        ) from exc
            built.append(Criterion(
                no=str(row.get("no") or "").strip(),
                text=text,
                group=str(row.get("group") or "").strip(),
                note=str(row.get("note") or "").strip(),
                agent=str(row.get("agent") or "").strip(),
                mode=mode, check=check, params=dict(params),
                source=str(row.get("source") or "").strip() or "수기 작성"))
        try:
            saved = checklists.save(name, "(수기 작성)", {}, built)
        except ChecklistError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {"id": saved.id, "name": saved.name, "item_count": len(saved.items)}

    @app.get("/api/criteria")
    def criteria_layers(team: str = "") -> dict:
        """검토 기준 3층을 층째로. 화면이 "무엇으로 재는지"를 보여주는 자리다.

        `/api/teams/{team}/criteria` 와 다르다. 그쪽은 폴더 검토가 쓰는 **구조
        절**(어느 산출물의 어느 칸을 어떻게 뽑나)을 내고 items 는 개수만 낸다.
        여기서는 items 전문이 목적이다 — 검토자가 "이 기준이 실제로 검사되나"를
        알아야 한다.

        **howChecked 가 이 화면의 값어치다.** 기준은 수십 건인데 검사기가 받는
        것은 그중 일부고, 지금 그 차이가 아무 데도 안 보인다. 팀에 "이건 됩니다 /
        이건 사람이 봐야 합니다"를 이 화면 하나로 말할 수 있어야 한다.
        """
        from modules.agent_checklist import check_name, mode_for  # noqa: PLC0415
        if team and team not in {t["id"] for t in _teams()}:
            raise HTTPException(
                status_code=400, detail=f"그런 팀 기준이 없습니다: {team}")

        def item(c) -> dict:
            mode = mode_for(c)
            check = check_name(c)
            # "규칙"이라고 적혀 있어도 그 기준을 볼 검사기가 없으면 자동이 아니다.
            # 예전에는 mode 만 보고 "규칙 · 자동"이라 적어서, 검사기가 둘뿐인데
            # 규칙 기준 서른 개가 전부 자동으로 검사되는 것처럼 보였다.
            automatic = mode != "사람" and (mode != "규칙" or bool(check))
            return {
                "no": c.no, "text": c.text, "group": c.group, "note": c.note,
                "agent": c.agent, "source": c.source,
                "mode": mode,
                # 어느 검사가 보는지. 비면 아직 그 검사가 없다는 뜻이다.
                "check": check,
                # 어휘를 화면 말로. "LLM-조각"·"LLM-문서"는 한 번에 얼마를 묻는지의
                # 차이라 검토자에게는 같은 뜻이다(둘 다 자동이고 근거를 대야 한다).
                "howChecked": ("규칙 · 자동" if mode == "규칙" and check
                               else "LLM · 자동" if automatic
                               else "사람이 확인"),
            }

        layers = []
        for p in load_presets(seed_root):
            if p.scope == "공통":
                layers.append({"scope": "공통", "id": p.id,
                               "name": p.name or "공통 기준", "editable": False,
                               "items": [item(c) for c in p.items]})
            elif p.scope == "팀별" and team and p.id == team:
                layers.append({"scope": "팀별", "id": p.id, "name": p.name or p.id,
                               "editable": False,
                               # 이 팀이 알아보는 산출물 종류(outputs·single_outputs 의 key) —
                               # 홈 기준 타일이 "무엇을 보는가"를 칩으로 말한다(2026-09-18).
                               "documents": _team_documents(team),
                               "items": [item(c) for c in p.items]})
        for c in checklists.list():
            # list() 는 깨진 파일 하나가 목록을 죽이지 않게 건너뛰지만 get() 은
            # 던진다. 여기서 안 받으면 못 읽는 업로드 하나가 공통·팀 층까지 통째로
            # 500 으로 날린다 — 이 화면은 진입할 때마다 부른다.
            try:
                items = [item(x) for x in checklists.get(c.id).items]
                error = ""
            except ChecklistError as exc:
                items, error = [], str(exc)
            layers.append({"scope": "업로드", "id": c.id, "name": c.name,
                           "editable": True, "error": error, "items": items})
        return {"team": team, "layers": layers}

    @app.get("/api/checklists")
    def checklist_list() -> dict:
        return {"checklists": [
            {"id": c.id, "name": c.name, "source_filename": c.source_filename,
             "registered_at": c.registered_at, "item_count": c.item_count}
            for c in checklists.list()]}

    @app.get("/api/checklists/{checklist_id}")
    def checklist_get(checklist_id: str) -> dict:
        try:
            c = checklists.get(checklist_id)
        except ChecklistError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        # mode·check·params 도 낸다 — 수기로 등록한 기준(과제 층)은 이 값들이
        # 본체다. 안 내면 화면이 "무엇으로 검사되는 항목인지" 를 다시 물을 길이
        # 없고, 고쳐 쓸 수도 없다.
        return {"id": c.id, "name": c.name, "registered_at": c.registered_at,
                "columns": c.columns,
                "items": [{"no": i.no, "text": i.text, "group": i.group,
                           "note": i.note, "agent": i.agent, "mode": i.mode,
                           "check": i.check, "params": dict(i.params or {}),
                           "source": i.source} for i in c.items]}

    @app.delete("/api/checklists/{checklist_id}")
    def checklist_delete(checklist_id: str) -> dict:
        try:
            checklists.delete(checklist_id)
        except ChecklistError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return {"deleted": checklist_id}

    @app.post("/api/checklists/{checklist_id}/run")
    def checklist_run(request: Request, checklist_id: str,
                      document_name: str = Form(""),
                      results: str = Form("")) -> dict:
        """채운 결과를 기록에 남긴다.

        기존 HistoryStore 를 kind="checklist" 로 쓴다 — 기록 화면·목록·삭제가
        그대로 재사용된다. 미판정 항목도 세어서 함께 남긴다: 나중에 기록을
        열었을 때 "몇 개를 안 봤는지"가 사라지면 다 본 것처럼 읽힌다.
        """
        try:
            c = checklists.get(checklist_id)
        except ChecklistError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        try:
            parsed = json.loads(results) if results else {}
        except json.JSONDecodeError as exc:
            raise HTTPException(
                status_code=400, detail=f"results 를 읽지 못했습니다: {exc}") from exc
        if not isinstance(parsed, dict):
            raise HTTPException(status_code=400, detail="results 는 객체여야 합니다.")

        # 결과는 no 가 아니라 위치 인덱스(문자열)로 찾는다 — no 는 등록 시 열을
        # 고르지 않으면 전부 "" 이고, 구간별 1,2,3 재시작이면 겹친다. no 를
        # 키로 쓰면 같은 no 를 가진 다른 항목까지 함께 판정된 것처럼 보인다.
        unjudged = sum(1 for i, it in enumerate(c.items)
                       if not (parsed.get(str(i)) or {}).get("verdict"))
        payload = {
            "checklist_id": c.id, "checklist_name": c.name,
            "document_name": document_name,
            "total": len(c.items), "unjudged": unjudged,
            "results": [{"no": it.no, "text": it.text, "group": it.group,
                         "verdict": (parsed.get(str(i)) or {}).get("verdict"),
                         "reason": (parsed.get(str(i)) or {}).get("reason", "")}
                        for i, it in enumerate(c.items)],
        }
        return _remember("checklist", payload, owner=_session_email(request))

    @app.post("/api/checklists/{checklist_id}/csv")
    def checklist_csv(checklist_id: str, results: str = Form("")) -> Response:
        try:
            c = checklists.get(checklist_id)
        except ChecklistError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        try:
            parsed = json.loads(results) if results else {}
        except json.JSONDecodeError as exc:
            raise HTTPException(
                status_code=400, detail=f"results 를 읽지 못했습니다: {exc}") from exc
        if not isinstance(parsed, dict):
            raise HTTPException(status_code=400, detail="results 는 객체여야 합니다.")
        # BOM 을 붙인다 — 엑셀이 UTF-8 CSV 를 BOM 없이는 깨서 연다(윈도우 한글 mojibake 방지).
        # BOM은 응답 바이트에 "﻿"로 실려 있다. media_type의 charset은 표준 토큰이어야
        # 하므로(IANA/WHATWG) utf-8-sig 코덱 별칭을 쓰면 안 되고, 표준 charset=utf-8을 쓴다.
        body = "﻿" + to_csv(c, parsed)
        # c.name 은 업로드된 파일에서 온 이름이라 신뢰할 수 없다. _disposition은
        # 비-ASCII만 걷어내고 큰따옴표는 그대로 두므로, 이름에 "가 있으면
        # filename="..." 안에서 따옴표가 일찍 닫혀 헤더가 깨진다(제어 문자도 같은
        # 이유로 함께 없앤다). _disposition 자체를 바꾸면 마킹된 PDF 호출부의
        # 동작까지 바뀌므로 여기서만 이름을 다듬는다.
        safe_name = "".join(ch for ch in c.name if ch != '"' and ch.isprintable())
        return Response(content=body.encode("utf-8"),
                        media_type="text/csv",
                        headers={"Content-Disposition":
                                 _disposition(f"{safe_name}.checklist.csv")})

    @app.get("/api/health")
    def health(checklist: str = "") -> dict:
        # 화면이 "지금 무슨 잣대로 재는 중인지"를 말할 수 있어야 한다. 이게 없으면
        # 데모용 체크리스트로 실제 문서를 검토하고도 사용자는 그저 "0건"만 본다.
        # 실제로 그렇게 한나절을 날렸다.
        # 기준을 고를 수 있게 된 뒤로, 기본값의 잣대를 그대로 답하면 안 된다.
        # 화면은 이 값으로 "지금 무슨 잣대로 재는지"를 말하는데, 고른 것과 다른
        # 잣대를 보여주면 이 패널이 막으려던 바로 그 사고가 된다.
        shown = _config_for(checklist) if checklist else config
        review = shown.review
        return {
            "status": "ok",
            "settings": str(settings),
            # 팀 기준 계통으로 잰 경우 읽은 파일이 없다 — 고른 id 를 그대로 답한다.
            "checklist": Path(shown.checklist_path).name or checklist,
            # 고를 수 있는 목록과 지금 서버 기본값. 화면이 임의 목록을 지어내지
            # 않도록 여기서 내려준다 — 예전엔 화면에 실제로 없는 이름(PRD 등)이
            # 박혀 있었고, 골라도 서버에 전달되지 않았다.
            "checklists": _teams(),
            "checklist_id": Path(shown.checklist_path).stem or checklist,
            "doc_type": review.doc_type,
            "id_pattern": review.id_pattern,
            "id_example": review.id_example,
            "id_format": review.id_format,
            "scope_pattern": review.scope_pattern,
            "scope_label": review.scope_label,
            "required_sections": list(review.required_sections),
            "placeholder_markers": list(review.placeholder_markers),
            "llm_provider": config.llm_provider,
            "llm_model": config.llm_model,
            # 화면에 뜨는 이름. 서버가 받는 별칭("qwen")은 사람에게 뜻이 없어
            # 설정의 model_label 을 쓴다. 없으면 별칭을 그대로 보여준다 —
            # 지어내지 않는다.
            "llm_label": config.llm_label or config.llm_model,
            # 그림 해석용 비전 모델은 별도 엔드포인트다. 검토자가 "그림을 읽었는지"를
            # 알아야 결과를 옳게 읽는다 — 안 읽었으면 그림 안의 표·구성도는 검토되지
            # 않은 것이다. 주소는 내려보내지 않는다(사내 주소를 화면에 뿌릴 이유가 없다).
            "vlm_enabled": bool(config.vlm_base_url),
            # 대화창(A 안)이 켜져 있나. 화면은 이것으로 패널을 그릴지 정한다.
            "chat_enabled": bool(config.chat_dsr_bin),
            "vlm_model": config.vlm_model if config.vlm_base_url else "",
        }

    # DoSuree(사내 에이전트 CLI)가 검토 결과를 도구로 읽는 창구. 인증·범위는
    # 웹과 같은 함수를 그대로 넘긴다(app/mcp.py).
    from .mcp import mount_mcp  # noqa: PLC0415
    mount_mcp(app, history=history,
              resolve_token=lambda token: sessions.resolve(token) or "",
              visible_owners=_visible_owners, with_names=_with_names)

    # 결과 화면 옆 대화창(A 안, app/chat.py). 사용자마다 DoSuree 를 화면 없이 띄우고
    # 브라우저와 SSE 로 잇는다. dsr_bin 이 비면 라우트는 있어도 전부 404 다.
    from .chat import ChatError, ChatWorkers  # noqa: PLC0415
    chat = ChatWorkers(
        data_root / "chat", config.chat_dsr_bin, mcp_url=config.chat_mcp_url,
        llm_base_url=config.llm_base_url,
        issue_token=sessions.issue,
        team_of=lambda email: (accounts.get(email) or {}).get("team", ""))

    def _chat_user(request: Request) -> str:
        """어시스턴트는 로그인·켜짐 둘을 요구한다. 대화는 사람에 매인다(검토가 아니라)."""
        if not chat.enabled:
            raise HTTPException(status_code=404,
                                detail="어시스턴트가 꺼져 있습니다(설정 [chat] dsr_bin).")
        email = _session_email(request)
        if not email:
            raise HTTPException(status_code=401, detail="로그인이 필요합니다.")
        if not chat.mcp_url:
            # 서버는 제 주소를 모른다 — 브라우저가 온 주소가 곧 DoSuree 가 두드릴 주소다.
            chat.mcp_url = str(request.base_url).rstrip("/") + "/mcp"
        return email

    def _chat_review(email: str, review_id: str) -> dict:
        """대화에 얹을 검토 — 그 사람이 볼 수 있는 것만."""
        try:
            record = history.get(review_id)
        except HistoryError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        owners = _visible_owners(email)
        if owners is not None and (record.get("owner") or "") not in ("", *owners):
            raise HTTPException(status_code=403, detail="볼 수 없는 검토입니다.")
        return record

    def _chat_call(fn, *args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except ChatError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

    @app.get("/api/chat/stream")
    def chat_stream(request: Request, since: int = 0) -> StreamingResponse:
        """since 번째 이벤트부터 이번 턴이 끝날 때까지. 말 한 번에 한 번 연다."""
        email = _chat_user(request)
        gen = _chat_call(chat.stream, email, since)
        return StreamingResponse(
            (_sse(ev) for ev in gen), media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    @app.post("/api/chat/say")
    def chat_say(request: Request, message: str = Form(...),
                 review_id: str = Form("")) -> dict:
        email = _chat_user(request)
        title = str(_chat_review(email, review_id).get("title") or "") if review_id else ""
        entry, since = _chat_call(chat.say, email, message, review_id=review_id, title=title)
        return {"session": entry, "since": since}

    @app.post("/api/chat/abort")
    def chat_abort(request: Request) -> dict:
        _chat_call(chat.abort, _chat_user(request))
        return {"ok": True}

    @app.get("/api/chat/sessions")
    def chat_sessions(request: Request) -> dict:
        return {"sessions": chat.sessions(_chat_user(request))}

    @app.post("/api/chat/sessions")
    def chat_new_session(request: Request, review_id: str = Form("")) -> dict:
        email = _chat_user(request)
        title = str(_chat_review(email, review_id).get("title") or "") if review_id else ""
        return {"session": _chat_call(chat.new_session, email, review_id=review_id,
                                      review_title=title)}

    @app.post("/api/chat/sessions/{sid}/open")
    def chat_open_session(request: Request, sid: str) -> dict:
        entry, messages = _chat_call(chat.open_session, _chat_user(request), sid)
        return {"session": entry, "messages": messages}

    @app.post("/api/chat/sessions/{sid}/rename")
    def chat_rename_session(request: Request, sid: str, title: str = Form(...)) -> dict:
        return {"session": _chat_call(chat.rename_session, _chat_user(request), sid, title)}

    @app.delete("/api/chat/sessions/{sid}")
    def chat_delete_session(request: Request, sid: str) -> dict:
        _chat_call(chat.delete_session, _chat_user(request), sid)
        return {"ok": True}

    static_dir = Path(frontend_dir) if frontend_dir else _REPO_ROOT / "web"
    if static_dir.is_dir():
        app.mount("/", StaticFiles(directory=static_dir, html=True), name="frontend")
    return app
