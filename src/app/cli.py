"""DocSuree CLI 진입점."""
from __future__ import annotations

import argparse
import sys
from dataclasses import replace
from datetime import datetime
from pathlib import Path

from modules.doc_parser import UnsupportedFormatError
from modules.report import (
    render_json,
    render_markdown,
    render_review_ui_js,
    render_rtm_json,
    render_rtm_markdown,
    render_ui_js,
    to_ui_payload,
    to_ui_review_payload,
)

from .config import apply_criteria_params, load_config
from .criteria import UnknownTeam, for_single_review
from .orchestrator import review_document, review_documents


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="docsuree",
        description="DocSuree — 문서 일관성 검토 Agent",
    )
    sub = parser.add_subparsers(dest="command")

    review = sub.add_parser("review", help="문서를 검토한다")
    review.add_argument("file", help="검토할 문서 경로")
    review.add_argument("--settings", default="config/settings.toml",
                        help="설정 파일 경로 (기본: config/settings.toml)")
    review.add_argument("--team", default="",
                        help="팀 기준 id (presets/criteria/teams/<id>.yaml). "
                             "안 주면 공통 기준만 적용한다")
    review.add_argument("--out", default=None,
                        help="리포트 출력 파일 경로 (없으면 stdout)")
    review.add_argument("--format", choices=["markdown", "json"],
                        default="markdown", help="출력 형식 (기본: markdown)")
    review.add_argument("--emit-ui", default=None, metavar="PATH",
                        help="결과를 웹 UI가 읽는 JS 파일로 내보낸다 "
                             "(예: web/docreview-review-result.js)")

    compare = sub.add_parser("compare", help="상위/하위 문서의 추적성을 비교한다")
    compare.add_argument("--parent", required=True, help="상위문서 경로 (예: SRS)")
    compare.add_argument("--child", required=True, help="하위문서 경로 (예: SDD)")
    compare.add_argument("--settings", default="config/settings.toml",
                         help="설정 파일 경로 (기본: config/settings.toml)")
    compare.add_argument("--out", default=None,
                         help="리포트 출력 파일 경로 (없으면 stdout)")
    compare.add_argument("--format", choices=["markdown", "json"],
                         default="markdown", help="출력 형식 (기본: markdown)")
    compare.add_argument("--emit-ui", default=None, metavar="PATH",
                         help="결과를 웹 UI가 읽는 JS 파일로 내보낸다 "
                              "(예: web/docreview-result.js)")

    serve = sub.add_parser("serve", help="웹 UI를 로컬 서버로 띄운다")
    serve.add_argument("--settings", default="config/settings.toml",
                       help="설정 파일 경로 (기본: config/settings.toml)")
    serve.add_argument("--host", default="127.0.0.1",
                       help="바인드 주소 (기본: 127.0.0.1, 로컬 전용)")
    serve.add_argument("--port", type=int, default=8000, help="포트 (기본: 8000)")

    # 계정 관리. 관리자 화면이 아직 없어 서버에서 바로 보고 고치는 길이다 —
    # DB 를 sqlite3 로 직접 여는 것보다 낫다(서버와 같은 검증을 거친다).
    # 비밀번호는 여기서도 못 본다 — 되돌릴 수 없는 해시로만 있다.
    acc = sub.add_parser("accounts", help="계정을 보거나 고친다")
    acc.add_argument("action", choices=["list", "role", "delete", "token"],
                     help="list=목록 · role=권한 변경 · delete=삭제 · "
                          "token=DoSuree 연결 토큰 발급")
    acc.add_argument("email", nargs="?", help="role·delete·token 이 다룰 계정")
    acc.add_argument("--to", choices=["user", "admin"], default=None,
                     help="role 이 바꿀 등급")
    acc.add_argument("--data-dir", default=None,
                     help="데이터 폴더 (기본: DOCSUREE_DATA_DIR 또는 .docreview)")
    acc.add_argument("--yes", action="store_true", help="delete 를 묻지 않고 지운다")
    return parser


def _emit(findings, source_path, args) -> int:
    if args.format == "json":
        report = render_json(findings, source_path)
    else:
        report = render_markdown(findings, source_path)
    if args.out:
        Path(args.out).write_text(report, encoding="utf-8")
    else:
        print(report)
    return 0


_SEED_DIR = Path(__file__).resolve().parents[2] / "presets" / "criteria"


def _run_review(args) -> int:
    config = load_config(args.settings)
    from .parser_bridge import install_trkim_parser
    install_trkim_parser(config.vlm_base_url, config.vlm_model, config.llm_api_key)
    # 기준 조립은 웹과 같은 함수가 한다(app.criteria). 전에는 여기서 team=None 을
    # 박아 CLI 가 팀 기준을 영영 못 받았고, 같은 문서가 경로마다 다른 결과를 냈다.
    # 배포판에 presets/ 가 없으면(도메인 데이터) 빈 목록이 되고 규칙 검사만 남는다.
    try:
        items, extra, notices = for_single_review(
            _SEED_DIR, args.team, Path(args.file).name)
    except UnknownTeam as exc:
        print(f"{exc}", file=sys.stderr)
        return 2
    # 기준이 검사 매개변수(요건 ID 형식 등)를 정한다 — 서버도 같이 한다.
    config = replace(config, review=apply_criteria_params(config.review, items))
    # 파일명으로 산출물(SRS·SDD…)을 가린다 — 서버의 _output_key_for 와 같은 길.
    # 안 가리면 applies_to 기준이 전부 판단 보류로 빠져 웹과 결과가 달랐다.
    output_key = ""
    if args.team:
        from .case import output_spec_for
        from .criteria import team_spec
        spec, _why = output_spec_for(Path(args.file).name, team_spec(_SEED_DIR, args.team))
        output_key = str((spec or {}).get("key", ""))
    try:
        result = review_document(args.file, config, criteria=items,
                                 extra_checkers=extra, output_key=output_key)
    except (UnsupportedFormatError, NotImplementedError) as exc:
        print(f"검토할 수 없습니다: {exc}", file=sys.stderr)
        return 2
    result.findings.extend(notices)
    rc = _emit(result.findings, result.source_path, args)
    if args.emit_ui:
        payload = to_ui_review_payload(
            result.findings, result.source_path, images=result.images,
            sections=result.section_count, chunks=result.chunk_count,
            chars=result.char_count, document=result.document)
        Path(args.emit_ui).write_text(render_review_ui_js(payload), encoding="utf-8")
        print(f"UI 데이터를 {args.emit_ui} 에 썼습니다.", file=sys.stderr)
    return rc


def _run_compare(args) -> int:
    config = load_config(args.settings)
    from .parser_bridge import install_trkim_parser
    install_trkim_parser(config.vlm_base_url, config.vlm_model, config.llm_api_key)
    try:
        result = review_documents(args.parent, args.child, config)
    except (UnsupportedFormatError, NotImplementedError) as exc:
        print(f"검토할 수 없습니다: {exc}", file=sys.stderr)
        return 2
    if args.format == "json":
        report = render_rtm_json(result.rtm, result.findings, result.source_path)
    else:
        report = render_rtm_markdown(result.rtm, result.findings, result.source_path)
    if args.out:
        Path(args.out).write_text(report, encoding="utf-8")
    else:
        print(report)
    if args.emit_ui:
        payload = to_ui_payload(
            result.rtm, result.findings, args.parent, args.child,
            statements=result.statements,
            child_statements=result.child_statements,
            child_locations=result.child_locations,
            probes=result.probes,
            content_match_state=result.content_match_state)
        Path(args.emit_ui).write_text(render_ui_js(payload), encoding="utf-8")
        print(f"UI 데이터를 {args.emit_ui} 에 썼습니다.", file=sys.stderr)
    return 0


def _run_serve(args) -> int:
    # 웹 의존성은 core 라 정상 설치면 항상 있다. 그래도 트레이스백 대신 설치법을
    # 알려준다 — 여기 걸린다는 건 설치가 덜 됐거나 다른 venv 를 보고 있다는 뜻이다.
    try:
        import uvicorn

        from .server import create_app
    except ImportError as exc:
        print(f"웹 서버 의존성이 없습니다 ({exc.name}). "
              "설치: uv sync", file=sys.stderr)
        return 2
    app = create_app(settings=args.settings)
    print(f"http://{args.host}:{args.port} 에서 실행 중 (Ctrl+C로 종료)", file=sys.stderr)
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")
    return 0


def _run_accounts(args) -> int:
    """계정 목록·권한·삭제. 서버와 같은 저장소를 본다(app.auth).

    예전에는 accounts.json 을 직접 열어 고치고 sessions.json 도 따로 손봤다.
    저장소가 DB 로 바뀌면서 그 코드는 필요가 없어졌다 — 서버가 쓰는 것과 **같은
    메서드**를 부른다. 두 벌로 유지하다 어긋날 자리가 사라진다.
    """
    from .auth import AccountStore, AuthError, SessionStore
    from .server import _data_root

    root = Path(args.data_dir) if args.data_dir else _data_root()
    accounts = AccountStore(root)
    rows = accounts.list()

    if args.action == "list":
        if not rows:
            print(f"계정이 없습니다 ({root}). 웹에서 회원가입하면 만들어집니다.",
                  file=sys.stderr)
            return 1
        print(f"{root}  ({len(rows)}명)\n")
        width = max(len(a["email"]) for a in rows)
        for a in rows:
            at = (datetime.fromtimestamp(a["created_at"]).strftime("%Y-%m-%d %H:%M")
                  if a["created_at"] else "-")
            print(f"{a['email']:<{width}}  {a['role']:<5} "
                  f"{a['name']:<8} {a['dept']:<14} {a['team']:<18} {at}")
        return 0

    if not args.email:
        print(f"{args.action} 은 이메일이 필요합니다.", file=sys.stderr)
        return 2
    email = args.email.strip().lower()
    if accounts.get(email) is None:
        print(f"그런 계정이 없습니다: {email}", file=sys.stderr)
        return 1

    if args.action == "token":
        # DoSuree 가 /mcp 에 Bearer 로 보낼 토큰. 웹 세션과 같은 표·같은 만료(30일).
        # 한 번만 보여준다 — 저장은 해시뿐이라 다시 꺼낼 수 없다.
        if accounts.get(email) is None:
            print(f"계정이 없습니다: {email}", file=sys.stderr)
            return 1
        token = SessionStore(root).issue(email)
        print(token)
        print(f"~/.dsr/agent/mcp.json 의 headers.Authorization 에 'Bearer {token[:6]}…' "
              "로 넣으세요. 30일 뒤 만료됩니다.", file=sys.stderr)
        return 0

    if args.action == "role":
        if not args.to:
            print("--to user|admin 을 주세요.", file=sys.stderr)
            return 2
        # 관리자를 0명으로 만들 수는 있다 — 이 명령이 유일한 승급 수단이라
        # 되돌릴 길이 늘 남는다. 막으면 오히려 잠긴다.
        try:
            accounts.set_role(email, args.to)
        except AuthError as exc:
            print(str(exc), file=sys.stderr)
            return 2
        print(f"{email} → {args.to}")
        return 0

    if not args.yes:
        print(f"정말 지웁니까? {email} — 되돌릴 수 없습니다. "
              "확인하려면 --yes 를 붙이세요.", file=sys.stderr)
        return 2
    accounts.delete(email)
    # 삭제해도 그 사람의 세션 쿠키는 살아 있다 — 세션도 걷어낸다.
    SessionStore(root).revoke_all(email)
    print("삭제했습니다: " + email)
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.command == "review":
        return _run_review(args)
    if args.command == "compare":
        return _run_compare(args)
    if args.command == "serve":
        return _run_serve(args)
    if args.command == "accounts":
        return _run_accounts(args)
    parser.print_help()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
