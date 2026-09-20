"""파이프라인 오케스트레이터 — **검토 한 건 전체**의 지휘자.

문서를 파싱하고, 검사기를 정해진 순서로 돌리고, 결과를 모아 리포트로 넘긴다.
**순서를 코드가 정한다**(workflow) — 모델이 "무엇을 검사할까"를 고르게 두지
않는다. 감사받는 산출물이라 같은 문서는 같은 결과를 내야 하고, "18개 항목 전부"
를 보장해야 하며, 1건 5분 안에 끝나야 하기 때문이다(CLAUDE.md 성능 스펙).

**LLM 이 도구를 부르며 스스로 경로를 정하는 루프를 뜻하는 일반 용법의
"orchestrator" 가 아니다.** 그 루프는 한 층 아래, 검사기 **안**에 있다
(`modules/shared/agent/` 참고). 여기서 모델을 부르는 코드는 없다.
"""
from __future__ import annotations

import re
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from pathlib import Path

from modules.agent_trace import (
    ContentMatchChecker,
    TraceabilityChecker,
    build_rtm,
    excluded_ids,
    rtm_check,
    rtm_verdict,
)
from modules.doc_parser import chunk, load_document, normalize
from modules.llm_client import build_llm, build_vlm
from modules.report import (
    REVIEW_DETAIL,
    collect,
    fmt_chars,
    fmt_chunks,
    fmt_findings,
    fmt_sections,
    merge_duplicates,
    stamp,
)
from modules.shared import (
    Anchor,
    Config,
    Context,
    Document,
    Finding,
    RtmRow,
    Severity,
)

from .images import describe_images


def _read_images(raw, config, emit):
    """그림을 비전 모델로 읽고, 못 읽었으면 그 사실을 지적으로 남긴다.

    조용히 넘기면 그림 안의 내용을 검토한 것처럼 보인다. 실측으로 네트워크 구성도
    한 장에서 시스템 이름과 연결 관계가 나왔다 — 놓치면 추적성 검사가 통째로 못 본다.
    """
    raw = describe_images(raw, build_vlm(config), on_progress=emit,
                          concurrency=config.llm_concurrency)
    images = raw.meta.get("images") or []
    unread = len(images) - raw.meta.get("images_read", 0)
    if not images or unread <= 0:
        return raw, []

    why = ("그림 해석용 모델이 연결되지 않았습니다"
           if raw.meta.get("images_read", 0) == 0 and not config.vlm_base_url
           else "일부 그림을 읽지 못했습니다")
    # label 은 stamp() 가 체커에서 찍지만, 여기는 체커 없이 직접 만드는 지적이라
    # 자리가 없다 — 안 적으면 화면 필터 칩에 checker 키("images")가 영어로 뜬다.
    return raw, [Finding(
        checker="images",
        label="그림 해석",
        severity=Severity.INFO,
        message=(f"그림 {unread}/{len(images)}장을 읽지 않았습니다 — {why}. "
                 f"그림 안의 표·구성도에 적힌 내용은 검토되지 않았습니다."),
        anchor=Anchor(page=None, section=None),
        suggestion=("설정의 vlm_base_url 또는 환경변수 LLM_OCR_URL 로 비전 모델을 "
                    "연결하면 그림 안의 글자까지 읽습니다."),
        unreviewed=True,
    )]


def _parser_warning_findings(raw) -> list[Finding]:
    """로더가 meta["parser_warnings"] 에 남긴 항목을 미검토 INFO 지적으로 편다.

    trkim 파서 경로(3-way 통합, 기본 파서)는 표 셀 글꼴·그림 ZIP part 경로를
    모델 자체에서 못 만든다 — 그래서 TrkimLoader.load 가 같은 파일을 legacy
    로더로 한 번 더 읽어 meta["tables"]/["images"] 를 접붙인다(정상 경로라면
    이 보충이 성공해 표 글꼴 검사·그림 해석이 그대로 동작한다). parser_warnings
    는 그 보충이 실패했을 때(예: legacy 가 못 읽는 스캔 PDF)와 trkim 파서 자체
    경고(model.warnings)일 때만 채워진다 — parser_bridge.TrkimLoader 참고.
    조용히 넘기면 "검사했더니 이상 없음"과 구분되지 않는다(CLAUDE.md "모르면
    모른다고 말한다"). _read_images 와 같은 계약이다.
    """
    # 같은 문장은 한 번만 카드로 만든다. 같은 그림이 머리말과 본문에 함께 들어간
    # 문서에서 똑같은 OCR 경고가 두 장 떴다 — 같은 사실을 두 번 말하면 검토자는
    # 문제가 둘인 줄 안다. 순서는 지킨다(dict.fromkeys).
    return [Finding(
        checker="parser",
        label="문서 읽기",   # _read_images 와 같은 이유 — 체커 없는 직접 생성 지적
        severity=Severity.INFO,
        message=w,
        anchor=Anchor(page=None, section=None),
        unreviewed=True,
    ) for w in _fold_figure_warnings(dict.fromkeys(raw.meta.get("parser_warnings") or []))]


# 그림 경고는 백엔드가 `"{N쪽 그림}을/은/의 …"` 꼴로 낸다(ocr_batch.figure_label).
# 접두를 떼면 같은 사유끼리 문장이 같아진다.
_FIGURE_WARNING = re.compile(r"^(\d+)쪽 그림(?=[을은의이가 ])")
# PDF 백엔드의 쪽별 경고는 `"p{N}: …"` 꼴이다(pdf_backend). 실측(2026-09-15, SYSA RVVR
# Rev05 수정본): 부록 평가표 쪽마다 "pdf-inspector 마크다운 추출 실패 … PyMuPDF 텍스트
# 사용" 이 9장 연달아 떠서 진짜 미검토 카드가 묻혔다. 그림 경고와 같이 접는다.
_PAGE_WARNING = re.compile(r"^p(\d+): ")


def _fold_figure_warnings(warnings) -> list[str]:
    """같은 사유의 "N쪽 그림 …" 경고를 쪽 목록 하나로 접는다.

    실측(2026-08-25, AX품질팀 상세설계서): 그림 26장 중 18장이 같은 이유로 안 읽혀
    "N쪽 그림을 문서에서 꺼내지 못했습니다" 가 **20장 연달아** INFO 로 떴다. 그 아래
    깔린 진짜 지적(ID 불일치·제목 불일치 3건)이 묻혔다 — 검토자가 스크롤로 20장을
    지나야 본론이 나온다.

    사실은 지우지 않는다. 쪽을 전부 싣고 몇 장인지 센다:
        "그림 18장(1·8·10~25·42~46쪽)을 문서에서 꺼내지 못했습니다. …"
    쪽 하나면 원문 그대로 둔다 — 접을 게 없다. 쪽이 없는 "그림 …" 경고도 그대로
    둔다(figure_label 은 쪽을 모르면 "그림" 이라고만 쓴다).

    문장이 같아야 접는다. 접두 뒤 문장이 한 글자라도 다르면 다른 사유이므로
    따로 남긴다 — "오류가 났습니다 → {e}" 는 e 가 달라 접히지 않는데, 그건 맞다.
    서로 다른 오류를 하나로 뭉치면 무엇이 났는지가 사라진다.
    """
    folded: list[str] = []
    groups: dict[tuple[str, str], list[int]] = {}
    order: list[tuple[str, str]] = []
    for w in warnings:
        m = _FIGURE_WARNING.match(w)
        kind = "figure"
        if not m:
            m, kind = _PAGE_WARNING.match(w), "page"
        if not m:
            folded.append(w)
            continue
        key = (kind, w[m.end():])
        if key not in groups:
            groups[key] = []
            order.append(key)
            folded.append(key)           # 자리만 잡아 두고 아래서 바꿔 끼운다
        groups[key].append(int(m.group(1)))
    for key in order:
        kind, rest = key
        pages = sorted(set(groups[key]))
        idx = folded.index(key)
        if kind == "page":
            folded[idx] = (f"p{pages[0]}: {rest}" if len(pages) == 1
                           else f"p{_page_ranges(pages)} ({len(pages)}쪽): {rest}")
        elif len(pages) == 1:
            folded[idx] = f"{pages[0]}쪽 그림{rest}"
        else:
            folded[idx] = f"그림 {len(pages)}장({_page_ranges(pages)}쪽){rest}"
    return folded


def _page_ranges(pages: list[int]) -> str:
    """[1, 8, 10, 11, 12, 25] → '1·8·10~12·25'. 이어진 쪽은 접는다."""
    out: list[str] = []
    start = prev = pages[0]
    for p in pages[1:] + [None]:
        if p is not None and p == prev + 1:
            prev = p
            continue
        out.append(f"{start}~{prev}" if prev > start else str(start))
        if p is not None:
            start = prev = p
    return "·".join(out)


def _ingestion_detail(raw) -> str:
    """진행 화면 '문서 준비' 줄. meta 에 실제로 있는 것만 띄운다.

    "1.2만자" → "1.2만자 · 236쪽 · 표 194". PDF 가 아닌 입력(docx·hwpx)은
    meta 에 쪽·표가 없으므로 예전 문자열 그대로 나간다 — 없는 수를 지어내지 않는다.
    """
    parts = [fmt_chars(len(raw.text))]
    pages = raw.meta.get("pages")
    if pages:
        parts.append(f"{pages}쪽")
    # meta["tables"] 는 표마다 열·글꼴을 담은 **목록**이다(표 글꼴 검사가 읽는다).
    # 여기서 필요한 건 개수뿐이다. 예전에는 `표 {tables}` 로 그대로 이어붙여,
    # Word 문서를 올리면 진행 화면에 딕셔너리가 통째로 찍혔다.
    tables = len(raw.meta.get("tables") or ())
    if tables:
        parts.append(f"표 {tables}")
    # 읽은 그림 수. 그림에서 나온 지적은 **실행마다 달라진다** — 실측(2026-09-01,
    # PRJX-DS-005): 같은 문서를 두 번 읽히니 23장 중 4장의 설명이 달랐다(온도는
    # 이미 0이다. vLLM 은 배치 때문에 비트 단위로 같지 않다). 그래서 그림 지적이
    # 있었다 없었다 하는데, 화면이 "그림을 몇 장 읽었다"조차 말하지 않으면
    # 검토자는 그것이 도구의 고장인지 문서가 바뀐 건지 알 수 없다.
    read = raw.meta.get("images_read")
    if read:
        parts.append(f"그림 {read}")
    return " · ".join(parts)


@dataclass
class ReviewResult:
    source_path: str
    findings: list[Finding] = field(default_factory=list)
    rtm: list[RtmRow] = field(default_factory=list)
    # 파이프라인 통계 (UI 진행바 표시용)
    section_count: int = 0
    chunk_count: int = 0
    char_count: int = 0
    # 그림의 번호·크기. 화면이 이것을 /api/locate 로 돌려보내면 서버가 뷰어용 PDF
    # 안의 이미지와 짝지어 좌표를 낸다 — 그림 설명에서 나온 지적을 짚기 위해서다.
    images: list[dict] = field(default_factory=list)
    # 정규화된 문서 본문. 미리보기가 이걸 렌더한다 — 업로드 원본은 검토가 끝나면
    # 지워지므로(web/server.py), 여기서 넘겨주지 않으면 본문을 다시 얻을 길이 없다.
    # 비교(review_documents)는 문서가 둘이라 이 자리에 담지 않는다.
    document: Document | None = None
    # 비교 전용: {요건 ID: 서술 블록}. 상위·하위 각각이다. 추적표가 "이 ID 가
    # 무슨 요건인가"를 화면에서 바로 보여주기 위한 것 — ID 만 있는 표는 문서를
    # 열기 전에는 아무 판단도 못 하게 한다(실측: 검토자가 표를 보고도 무엇을
    # 고쳐야 할지 몰랐다). 원본은 검토가 끝나면 지워지므로 여기 실어야 남는다.
    statements: dict[str, str] = field(default_factory=dict)
    child_statements: dict[str, str] = field(default_factory=dict)
    # 하위 서술의 실제 절·쪽. 같은 ID가 목차나 다른 표에도 있을 때 UI 원문
    # 이동이 첫 문자열이 아니라 서술이 나온 위치를 우선하도록 함께 보낸다.
    child_locations: dict[str, dict] = field(default_factory=dict)
    parent_locations: dict[str, dict] = field(default_factory=dict)
    # 비교 전용: 문서 간 검토 기준의 항목별 판정. 단일 검토의 ItemResult 와 같은
    # 모양이라 화면이 같은 부품으로 그린다 — 지적을 평면으로만 내면 검토자가
    # "그래서 이 기준은 만족인가"를 손으로 옮겨 적어야 한다.
    items: list = field(default_factory=list)
    # 비교 전용: 누락 요건마다 하위 문서에서 짚은 후보 자리.
    # {요건 ID: [{section, anchor_section, page, text, score, shared}, …]}
    # "누락"은 ID 문자열이 없다는 말일 뿐이라, 검토자는 설계가 아예 없는 것인지
    # ID 만 안 적힌 것인지 가르려고 하위 문서를 열어 뒤져야 했다(실측 피드백).
    probes: dict = field(default_factory=dict)
    # 비교 전용: 누락 요건마다 AI 가 다른 말로 찾아본 결과 {요건 ID: Judgment.to_dict()}.
    # 라벨은 안 바꾼다 — 화면의 하위 카드가 찾은 문장을 그대로 보여준다.
    judgments: dict = field(default_factory=dict)
    # 비교 전용: 연결된 ID 쌍의 내용 대조 상태. `completed`만 "AI가 봤고 모순
    # 후보를 못 찾음"을 뜻한다. disabled/unavailable/no_pattern을 0건과 섞으면
    # 화면이 실행하지 않은 검사를 통과처럼 보여준다.
    content_match_state: str = "not_applicable"


def _review_plans(checkers: Sequence, doc: Document, ctx: Context) -> tuple[list[dict], set[int]]:
    """진행 화면용 작업 계획과 자체 진행 단위가 있는 검사기 집합.

    규칙 검사기는 매우 빨라 별도 ``plan``을 구현하지 않는다. 그렇다고 화면에서
    아예 빼면 사용자는 LLM 두 줄만 보고 규칙 검사가 실행되지 않은 것으로 읽는다.
    자체 계획이 없는 검사기들을 하나의 규칙 검사 레인으로 묶어 정직하게 센다.
    """
    plans: list[dict] = []
    planned: set[int] = set()
    rule_count = 0
    for checker in checkers:
        plan_fn = getattr(checker, "plan", None)
        plan = plan_fn(doc, ctx) if plan_fn is not None else None
        if plan is None:
            rule_count += 1
            continue
        planned.add(id(checker))
        plans.append(plan)
    if rule_count:
        plans.insert(0, {
            "kind": "rule",
            "total": rule_count,
            "label": "규칙 검사",
            "description": "필수 항목·서식·목록을 자동 규칙으로 확인",
            "scope": f"{rule_count}개 검사",
        })
    return plans, planned


def review_document(path: str | Path, config: Config,
                    on_progress: Callable[[dict], None] | None = None,
                    criteria: Sequence = (),
                    extra_checkers: Sequence = (),
                    output_key: str = "") -> ReviewResult:
    """평면 결과가 필요한 기존 호출부용 단일 문서 검토 어댑터.

    실제 검사는 ``review_document_by_criteria`` 한 곳에서 한다. CLI·기존 모듈 사용자는
    항목별 결과가 필요 없으므로 같은 결과를 ``ReviewResult`` 모양으로만 접어 받는다.

    output_key 는 이 문서가 어느 산출물(SRS·SDD…)인지다. 안 넘기면 `applies_to`
    가 붙은 기준이 전부 "적용 여부를 판단하지 못했습니다"로 떨어진다 — CLI 가
    이걸 안 넘겨서 같은 문서가 웹과 다른 결과를 냈다(2026-09-10 실측).
    """
    detailed = review_document_by_criteria(
        path, criteria, config, on_progress=on_progress,
        extra_checkers=extra_checkers, output_key=output_key)
    return ReviewResult(
        source_path=detailed.source_path,
        findings=detailed.findings,
        section_count=detailed.section_count,
        chunk_count=detailed.chunk_count,
        char_count=detailed.char_count,
        document=detailed.document,
        images=detailed.images,
    )


def review_documents(
    parent_path: str | Path, child_path: str | Path, config: Config,
    on_progress: Callable[[dict], None] | None = None,
    criteria: Sequence | None = None,
    child_key: str = "",
) -> ReviewResult:
    """상위·하위 문서 비교. on_progress 는 단계 진행을 dict 로 받는다.

    단계 key 는 화면 씨앗 stages 순서와 짝이다(ingest·align·cross·report,
    ui_export._stages). LLM 내용 대조는 쌍마다 수 초라, 진행을 안 흘리면
    화면이 몇 십 초를 말없이 서 있는다 — 단일 검토(/api/review)와 같은 계약.
    """
    emit = on_progress or (lambda ev: None)
    parent_path = Path(parent_path)
    child_path = Path(child_path)
    emit({"key": "ingest", "status": "running",
          "detail": f"상위 문서 읽는 중 — {parent_path.name}"})
    parent = normalize(load_document(parent_path), doc_type=config.review.doc_type)
    emit({"key": "ingest", "status": "running",
          "detail": f"하위 문서 읽는 중 — {child_path.name}"})
    child = normalize(load_document(child_path), doc_type=config.review.doc_type)
    emit({"key": "ingest", "status": "done", "detail": "문서 2건 적재"})
    llm = build_llm(config)
    ctx = Context(review=config.review, llm=llm, chunks=[], other=child,
                  llm_concurrency=config.llm_concurrency)
    findings: list[Finding] = []
    emit({"key": "align", "status": "running", "detail": "요건 ID 추출·대조 중"})
    tracer = TraceabilityChecker()
    findings.extend(stamp(tracer, tracer.check(parent, ctx)))
    pattern = config.review.id_pattern
    # 문서 앞머리 "식별자 사례" 표의 ID 는 형식 설명이지 요건이 아니다. 안 거르면
    # 예시 하나가 MAJOR "누락"이 됐다(2026-09-14 QA 지적). 낱말은 기준이 정한다.
    exclude = tuple(config.review.id_example_words or ())
    skipped_ids = (excluded_ids(parent, pattern, exclude)
                   | excluded_ids(child, pattern, exclude))
    if skipped_ids:
        # 조용히 빼면 "그런 요건은 없었다"가 된다 — 버린 건수를 드러낸다(CLAUDE.md).
        findings.append(Finding(
            checker=tracer.name,
            label=tracer.label,
            severity=Severity.INFO,
            message=(f"예시 표기 근처의 ID {len(skipped_ids)}건은 요건으로 세지 "
                     f"않았습니다 (제외어: {', '.join(exclude)}) · "
                     + " · ".join(sorted(skipped_ids)[:10])
                     + (" …" if len(skipped_ids) > 10 else "")),
            anchor=Anchor(page=None, section=None),
        ))
    emit({"key": "align", "status": "done"})
    emit({"key": "cross", "status": "running", "detail": "AI 내용 대조 준비 중"})
    matcher = ContentMatchChecker(on_progress=lambda i, n: emit(
        {"key": "cross", "status": "running", "detail": f"AI 내용 대조 {i}/{n}"}))
    findings.extend(stamp(matcher, matcher.check(parent, ctx)))
    emit({"key": "cross", "status": "done"})
    emit({"key": "report", "status": "running", "detail": "추적표 생성 중"})
    rtm = build_rtm(parent, child, pattern,
                    config.review.scope_pattern,
                    config.review.id_rollup_separator, exclude)
    # 추적표가 ID 옆에 실을 요건 서술. 내용 대조가 이미 뽑는 것과 같은 추출이다.
    from modules.agent_trace import extract_id_statements  # noqa: PLC0415
    parent_extracted = extract_id_statements(parent, pattern, exclude) if pattern else {}
    child_extracted = extract_id_statements(child, pattern, exclude) if pattern else {}
    statements = {i: st.text for i, st in parent_extracted.items()}
    child_statements = {i: st.text for i, st in child_extracted.items()}
    # 위치엔 절 **제목**도 싣는다. HWP 는 쪽수가 없고 절 id 는 파서 순번(8.1)이라
    # 보고서 받는 사람이 찾아갈 수 없었다 — 제목("2.3.3 해양사고 다발구역 선정 기술")은
    # 문서에 실재한다(2026-09-08).
    child_locations = {
        i: {"section": st.anchor.section, "page": st.anchor.page, "title": st.section_title}
        for i, st in child_extracted.items()
    }
    parent_locations = {
        i: {"section": st.anchor.section, "page": st.anchor.page, "title": st.section_title}
        for i, st in parent_extracted.items()
    }
    # 누락 행마다 하위 문서에서 "여기쯤 있을 것" 을 짚는다. 규칙만 쓰므로
    # LLM 이 꺼져 있어도 돌고, 후보는 하위 문서에 실재하는 절이라 지어낼 자리가
    # 없다(agent_trace/missing_probe.py). 판정은 사람이 한다 — 도구는 어디를
    # 볼지만 좁혀 준다.
    from modules.agent_trace import probe_missing  # noqa: PLC0415
    probes = {}
    judgments: dict = {}
    for row in rtm:
        if row.status != "missing" or not row.upper_id:
            continue
        text = statements.get(row.upper_id, "")
        hits = probe_missing(text, child)
        if hits:
            probes[row.upper_id] = [h.to_dict() for h in hits]
    # 누락이 "설계가 없다"인지 "번호만 안 적혔다"인지 찾아본다 — 모델이 설계서가
    # 쓸 법한 말을 떠올리고, 코드가 찾고, 걸린 절을 모델이 확인한다
    # (agent_trace/missing_judge.py). 라벨은 안 바꾸고 결과를 행 옆에 싣는다.
    # 규칙 검사는 LLM 없이
    # 동작해야 하므로(CLAUDE.md), LLM 이 꺼져 있으면 예전 그대로 전부 누락이다.
    # provider="echo" 는 **LLM 을 안 쓰겠다는 선택**이지 실패가 아니다(설정
    # 파일이 "빈 응답. LLM 지적이 0건이 된다"고 적어 둔 그대로다). 그때 판정을
    # 시도하면 누락 전건이 "확인못함" INFO 로 쏟아져, 규칙만 돌린 결과가 오히려
    # 시끄러워진다 — content_match 가 세운 규약과 같게 조용히 건너뛴다.
    if config.llm_enabled and config.llm_provider != "echo" and pattern:
        from modules.agent_trace import (  # noqa: PLC0415
            apply_judgments,
            judge_missing_rows,
        )
        judged, skipped = judge_missing_rows(
            rtm, statements, probes, child, llm)
        findings = apply_judgments(findings, judged, skipped)
        judgments = {rid: j.to_dict() for rid, j in judged.items()}
    source = f"{parent_path} ↔ {child_path}"
    merged = collect(findings)
    items = _rtm_item_results(criteria or (), rtm, merged,
                              llm_enabled=bool(config.llm_enabled),
                              child_key=child_key)
    if not pattern:
        content_match_state = "no_pattern"
    elif not config.llm_enabled:
        content_match_state = "disabled"
    elif config.llm_provider == "echo":
        content_match_state = "unavailable"
    else:
        content_match_state = "completed"
    return ReviewResult(source_path=source, findings=merged, rtm=rtm,
                        statements=statements, child_statements=child_statements,
                        child_locations=child_locations,
                        parent_locations=parent_locations,
                        items=items, probes=probes, judgments=judgments,
                        content_match_state=content_match_state)


def _rtm_item_results(criteria: Sequence, rtm, findings, *,
                      llm_enabled: bool, child_key: str = "") -> list[ItemResult]:
    """문서 간 기준 → 항목별 판정. 기준이 `check:` 로 자기 검사를 지명한다.

    지명하지 않은 기준은 여기 안 담는다 — 문서 비교가 판정할 수 없는 항목까지
    줄을 세우면 화면이 "검토했다"고 말하는 셈이 된다. 그 항목들은 지금처럼
    사람 몫으로 남고, 단일 검토 화면이 "다른 문서가 필요합니다"로 말한다.

    `applies_to` 는 **하위 문서**의 산출물 종류다 — 쌍의 아래쪽이 무엇이냐가
    단계를 정한다. 안 가르면 SRS↔SDD 를 비교하는데 요구사항 단계 항목까지
    판정돼 같은 기계 판정이 단계마다 복사된다(실측: 4항목 중 2개가 남의 단계).
    하위 문서를 못 가렸으면(child_key 가 빔) `na` 로 두고 이유를 남긴다 —
    모르는 것을 판정으로 채우지 않는다.
    """
    out: list[ItemResult] = []
    for c in criteria:
        check = rtm_check(c)
        if not check:
            continue
        why_target = _out_of_target(c, child_key)
        if why_target:
            out.append(ItemResult(
                no=getattr(c, "no", "") or "", text=getattr(c, "text", "") or "",
                group=getattr(c, "group", "") or "",
                status="na" if child_key else "manual",
                findings=[], note=(getattr(c, "note", "") or "").strip(),
                mode=getattr(c, "mode", "") or "",
                mode_declared=bool((getattr(c, "mode", "") or "").strip()),
                layer=getattr(c, "layer", "") or "", check=check))
            out[-1].note = f"{out[-1].note}\n\n{why_target}".strip()
            continue
        status, mine, why = rtm_verdict(check, rtm, findings,
                                        llm_enabled=llm_enabled)
        note = getattr(c, "note", "") or ""
        if why:
            note = f"{note}\n\n{why}".strip()
        out.append(ItemResult(
            no=getattr(c, "no", "") or "", text=getattr(c, "text", "") or "",
            group=getattr(c, "group", "") or "", status=status,
            findings=list(mine), note=note,
            mode=getattr(c, "mode", "") or "",
            mode_declared=bool((getattr(c, "mode", "") or "").strip()),
            layer=getattr(c, "layer", "") or "", check=check))
    return out


def _item_status(findings: list[Finding]) -> str:
    """체크리스트 항목 상태. 지적 0건과 "검사 못 함"을 구분한다.

    미검토 보고(Finding.unreviewed)만 있는 항목을 clean 으로 두면 검사하지 않은
    것이 "이상 없음"으로 보이고, flagged 로 두면 "문제 발견"으로 보인다. 둘 다
    거짓이라 상태를 하나 더 둔다.
    """
    if any(not f.unreviewed for f in findings):
        return "flagged"
    if findings:
        return "unreviewed"
    return "clean"


@dataclass
class ItemResult:
    no: str
    text: str
    group: str
    status: str                    # flagged | clean | unreviewed | manual
    findings: list[Finding] = field(default_factory=list)
    # 기준 본문 밖의 것. 화면이 "이 기준이 뭐였는지"를 보여주려면 필요하다 —
    # 원본 엑셀은 사내 파일이라 앱에 없고, 검토자가 "공통3" 을 보고도 무엇을
    # 확인하라는 건지 알 길이 없었다.
    note: str = ""                 # 확인 방법(세부 기준)
    mode: str = ""                 # 규칙 | 조각 | 전체 | 사람 — 왜 그 상태인지
    # mode 를 기준이 직접 적었는가. "사람이 그렇게 정했다"와 "아무도 안 정해서
    # 사람 몫으로 떨어졌다"는 검토자가 할 일이 다르다.
    mode_declared: bool = False
    layer: str = ""                # 공통 | 팀별 | 업로드 — 이 기준이 온 층
    # 비교 화면이 요건별 판정에 이미 포함된 기준과 문서쌍 전체 기준을
    # 번호·문구 추측 없이 가르는 안정 키다.
    check: str = ""


@dataclass
class CriteriaReviewResult:
    source_path: str
    items: list[ItemResult] = field(default_factory=list)
    findings: list[Finding] = field(default_factory=list)
    section_count: int = 0
    chunk_count: int = 0
    char_count: int = 0
    document: Document | None = None
    images: list[dict] = field(default_factory=list)


def _needs_other_doc(criterion) -> str:
    """문서 2개가 있어야 판정되는 기준인가. 아니면 "" (단일 검토로 판정된다).

    `_out_of_target` 과 갈라 둔 이유: 저쪽은 "이 문서가 그 산출물인지 못 가리면
    사람 몫"이라 output_key 에 따라 na/manual 이 갈리는데, 이쪽은 갈릴 것이
    없다. 단일 검토에는 대조 상대가 **없다** — 늘 해당없음이다.
    """
    if (getattr(criterion, "needs", "") or "").strip() != "문서쌍":
        return ""
    return ("이 기준은 문서 2개를 맞대야 판정됩니다 — 단일 문서 검토에서는 "
            "대조 상대가 없습니다 (문서 간 검토로 확인하세요).")


def _out_of_target(criterion, output_key: str) -> str:
    """이 기준이 **이 문서**를 볼 항목이 아닌가. 아니면 "" (적용한다).

    돌려주는 문자열은 왜 아닌지다 — 화면이 그대로 쓴다.

    기준이 `applies_to` 를 안 적었으면 문서를 가리지 않는다(대부분이 그렇다).
    적었는데 이 문서가 어느 산출물인지 **가리지 못했으면**(output_key 가 빈
    문자열) 적용 여부를 모르는 것이다. 모르는 것을 해당없음으로 두면 검사한 적
    없는 기준이 "정상"으로 보인다 — 그건 이 도구가 낼 수 있는 최악의 거짓말이다.
    """
    targets = list(getattr(criterion, "applies_to", None) or ())
    if not targets:
        return ""
    if not output_key:
        return (f"이 기준은 {' · '.join(targets)} 전용인데, 올린 문서가 어느 "
                "산출물인지 파일명으로 가리지 못해 적용 여부를 판단하지 못했습니다.")
    if output_key in targets:
        return ""
    return f"이 기준은 {' · '.join(targets)} 전용입니다 (이 문서는 {output_key})."


def review_document_by_criteria(path, criteria: Sequence, config,
                                on_progress: Callable[[dict], None] | None = None,
                                field_specs: Sequence = (), output_key: str = "",
                                extra_checkers: Sequence = ()) -> CriteriaReviewResult:
    """공통·팀·선택 업로드 기준이 이끄는 단일 문서 검토.

    항목을 키워드 맵으로 검사기에 잇는다. 걸린 검사기는 **한 번만** 돌리고(항목마다
    반복하면 같은 LLM 작업을 항목 수만큼 되풀이한다), 그 지적을 걸린 항목 **각각**에
    단다. 안 걸린 항목은 사람 확인 몫이다. ``extra_checkers`` 는 outputs 구조 절에서
    온 검사라 기준 항목에 억지로 귀속하지 않고 평면 지적으로만 남긴다.
    """
    from modules.agent_checklist import (
        checker_key,
        llm_checkers_for,
        missing_value,
        mode_for,
        out_of_scope,
        rule_checkers,
    )

    emit = on_progress or (lambda ev: None)
    path = Path(path)

    # 수정 2026-08-06: 파싱 전에 running 을 먼저 알린다 — 스캔 PDF 는 OCR 로
    # 파싱에만 수 분이 걸리는데, 첫 이벤트가 파싱 뒤에 나가면 화면은 그동안
    # 바이트 하나 못 받아 멈춘 것처럼 보인다(실측 75초+ 무소식).
    emit({"key": "ingestion", "status": "running",
          "detail": "문서 파싱 중 — 스캔 문서는 OCR 때문에 수 분 걸릴 수 있습니다"})
    raw = load_document(path)
    raw, image_findings = _read_images(raw, config, emit)
    parser_findings = _parser_warning_findings(raw)
    emit({"key": "ingestion", "status": "done", "detail": _ingestion_detail(raw)})
    doc = normalize(raw, doc_type=config.review.doc_type)
    sections = list(doc.iter_sections())
    emit({"key": "normalize", "status": "done", "detail": fmt_sections(len(sections))})
    chunks = chunk(doc, max_chars=config.chunk_max_chars)
    emit({"key": "chunking", "status": "done", "detail": fmt_chunks(len(chunks))})

    llm = build_llm(config)
    ctx = Context(review=config.review, llm=llm, chunks=chunks, on_progress=emit,
                  llm_concurrency=config.llm_concurrency, rescue_max=config.llm_rescue_max)

    # 기준 목록 → 검사기. 조각 기준은 하나의 ChunkCriteriaChecker 에 묶이고, 규칙
    # 기준은 agent 라벨이 정한 규칙 검사기를 쓴다(같은 검사기는 한 번만 만든다).
    #
    # 예전에는 여기서 base_checkers(Placeholder·Consistency)를 체크리스트와 무관하게
    # 항상 돌렸다. 그래서 기준 7개 중 0개가 검사되는 팀에서도 "기본 검토" 항목에
    # 지적이 나와 검사된 것처럼 보였다. 지금은 그 자리를 공통 프리셋이 가져간다 —
    # 호출부가 공통 기준을 items 에 합쳐 넘긴다(compose_review_preset).
    items = list(criteria)
    # 이 문서를 볼 항목이 아닌 기준은 **검사기를 만들기 전에** 뺀다. 결과 자리에서만
    # 걸러도 화면은 맞지만, 그때는 이미 그 기준이 LLM 프롬프트에 실려 나간 뒤다 —
    # 갑지 전용 기준을 시험의뢰서와 함께 물으면 돈과 시간이 나가고, 모델이 없는
    # 것을 찾다 지어낼 자리도 생긴다.
    applicable = [c for c in items
                  if not _out_of_target(c, output_key) and not _needs_other_doc(c)]
    # 부분 문서로 전체 누락 여부를 판단하면 다른 조각에 있는 내용을 없다고 할 수
    # 있다. 그런 기준은 YAML에서 명시하고, LLM에 보내기 전에 한도를 확인한다.
    # 길이 계산은 WholeDocCriteriaChecker가 만드는 입력과 동일하다.
    whole_chars = len("\n".join(s.text or "" for s in doc.iter_sections()))
    context_blocked = {
        str(c.no) for c in applicable
        if getattr(c, "requires_full_document", False)
        and mode_for(c) == "LLM-문서" and whole_chars > config.llm_doc_max_chars
        and not getattr(c, "evidence_terms", [])
        and not getattr(c, "sections", [])
    }
    applicable = [c for c in applicable if str(c.no) not in context_blocked]
    # 검사기를 **이름으로** 들고 있는다. 규칙은 기준이 댄 check 이름, LLM 은 mode.
    # 지적을 나눠 줄 때 이 이름이 열쇠다 — 예전처럼 type 으로 묶으면 어느 기준의
    # 것인지 알 수 없어 같은 라벨 기준 전부에 같은 지적을 복사하게 된다.
    rules = rule_checkers(applicable, field_specs)
    # 기준값이 없어 돌 수 없는 규칙 검사는 **만들지 않는다.** 만들어 두면 "검사할
    # 것이 검토 기준에 없어 수행하지 않았습니다" 한 장을 매 검토마다 낸다 — 문서
    # 이야기가 아니라 기준이 비었다는 이야기라 지적 목록에 있을 것이 아니다.
    # 그 사실은 아래에서 **그 기준의 상태**(사람 확인 필요)가 지고, 왜인지는
    # note 가 말한다. 값을 적은 팀에서는 그대로 자동으로 돈다.
    blocked_rules: dict[str, str] = {}
    for c in applicable:
        why = missing_value(c, config.review)
        if not why:
            continue
        key = checker_key(c)
        if key and rules.pop(key, None) is not None:
            blocked_rules[key] = why
    llm_checkers = (llm_checkers_for(applicable, doc_max_chars=config.llm_doc_max_chars,
                                    document_chars=whole_chars)
                    if config.llm_enabled else {})
    extras = {f"_extra:{i}": checker for i, checker in enumerate(extra_checkers)}
    by_key: dict = {**rules, **extras, **llm_checkers}

    # review_document 과 같은 이유로, 체커 루프 전에 작업량(plan)을 한 번에 모아
    # review 이벤트에 실어 보낸다. 이게 있어야 진행 화면이 레인을 그리고 퍼센트가
    # 정직해진다 — 빠른 규칙 체커도 한 레인으로 묶어 실행 여부를 숨기지 않는다.
    checkers = list(by_key.values())
    plans, planned = _review_plans(checkers, doc, ctx)
    # review_document 과 같은 이유 — 규칙 검사가 한 레인으로 묶이므로 실행도
    # 한 덩어리로 먼저 온다. rules·llm dict 병합 순서에 기대지 않는다.
    by_key = dict(sorted(by_key.items(), key=lambda kv: id(kv[1]) in planned))

    first_event = {"key": "review", "status": "running", "detail": REVIEW_DETAIL}
    if plans:
        first_event["plan"] = plans
    emit(first_event)

    findings_by_key: dict = {}
    rules_done = 0
    for key, ck in by_key.items():
        label = getattr(ck, "label", None)
        active = label if id(ck) in planned else "규칙 검사"
        emit({"key": "review", "status": "running",
              "detail": f"{label} 중" if label else f"{ck.name} 검사 중",
              "active": active})
        findings_by_key[key] = collect(stamp(ck, ck.check(doc, ctx)))
        if id(ck) not in planned:
            rules_done += 1
            emit({"key": "review", "status": "running",
                  "detail": f"규칙 검사 {rules_done}/{plans[0]['total']} 완료",
                  "active": "규칙 검사",
                  "step": {"kind": "rule", "i": rules_done,
                           "total": plans[0]["total"], "label": "규칙 검사"}})
    emit({"key": "review", "status": "done", "detail": REVIEW_DETAIL, "active": ""})

    item_results: list[ItemResult] = []
    all_findings: list[Finding] = []
    if not items and not extra_checkers:
        all_findings.append(Finding(
            checker="review",
            severity=Severity.INFO,
            message="적용할 검토 기준이 없어 이 문서를 검사하지 않았습니다.",
            anchor=Anchor(page=None, section=None),
            suggestion="검토 기준(공통·팀별)이 설치되어 있는지 확인하세요.",
            unreviewed=True,
        ))

    def _result(criterion, mode: str, status: str, findings=(),
                note_suffix: str = "") -> ItemResult:
        """항목 결과. 기준 자체(note·mode)도 함께 싣는다 — 화면이 "이 기준이
        뭐였는지"를 보여줄 수 있어야 번호가 의미를 갖는다. 원본 엑셀은 사내
        파일이라 앱에 없고, 검토자가 "공통3" 을 보고도 확인할 길이 없었다.

        note_suffix 는 왜 사람 몫인지를 덧붙인다. "규칙이라 적혀 있는데 왜
        수동인가"에 답이 없으면 데이터가 잘못된 것처럼 보인다."""
        note = getattr(criterion, "note", "") or ""
        if note_suffix:
            note = f"{note}\n\n{note_suffix}".strip()
        return ItemResult(
            no=criterion.no, text=criterion.text, group=criterion.group,
            status=status, findings=list(findings), note=note, mode=mode,
            # 이 mode 를 **기준이 직접 적었나**. 안 적으면 라벨 기본값이고, 라벨도
            # 없으면 "사람" 으로 떨어진다(checklist_map.mode_for). 둘을 못 가르면
            # 화면이 "이 기준은 문서만으로 판정할 수 없다"고 말하게 되는데, 업로드
            # 체크리스트는 mode 칸 자체가 없어 **전부** 그 말을 뒤집어썼다 —
            # "PDF 필드오류 문자열이 있는가" 처럼 기계가 볼 수 있는 항목까지.
            mode_declared=(getattr(criterion, "mode", "") or "").strip() == mode,
            layer=getattr(criterion, "layer", "") or "")

    for it in items:
        mode = mode_for(it)
        no = str(getattr(it, "no", "") or "")
        # 이 문서를 볼 항목인가부터. 아니면 규칙·LLM 갈래를 아예 타지 않는다.
        # 문서를 못 가려 판단이 안 서는 경우는 `na` 가 아니라 사람 몫이다 —
        # 위 _out_of_target 주석 참고.
        why = _needs_other_doc(it)
        if why:
            item_results.append(_result(it, mode, "na", note_suffix=why))
            continue
        why = _out_of_target(it, output_key)
        if why:
            item_results.append(_result(
                it, mode, "na" if output_key else "manual", note_suffix=why))
            continue
        if no in context_blocked:
            item_results.append(_result(
                it, mode, "unreviewed", note_suffix=(
                    f"문서 전체 대조가 필요한 기준인데 입력 길이({whole_chars:,}자)가 "
                    f"전체 검토 한도({config.llm_doc_max_chars:,}자)를 넘어 검사하지 "
                    "못했습니다. 조각만 보고 누락이나 이상 없음을 판정하지 않았습니다. "
                    "이 기준은 원문에서 직접 확인해야 합니다.")))
            continue
        llm_key = ("LLM-장절" if mode == "LLM-문서" and getattr(it, "sections", [])
                   else "LLM-근거" if mode == "LLM-문서"
                   and getattr(it, "requires_full_document", False)
                   and getattr(it, "evidence_terms", [])
                   and whole_chars > config.llm_doc_max_chars else mode)
        if mode in ("LLM-조각", "LLM-문서") and llm_checkers.get(llm_key) is not None:
            # 상태는 검사기가 낸 판정이 정한다. 지적 유무로 정하면 "안 물어본 것"과
            # "물어봤고 통과"가 같아진다.
            #
            # 조각 기준은 한 검사기가 여럿을 본다 — 지적을 낸 기준(rule_id)으로
            # 갈라야 한다. 예전에는 항목마다 그 검사기의 지적 **전부**를 받아,
            # 오탈자 기준 아래에 모호성 지적이 뜨고 같은 라벨 기준 둘의 건수가
            # 늘 똑같았다.
            verdict = llm_checkers[llm_key].verdicts.get(no, "미판정")
            mine = [f for f in findings_by_key.get(llm_key, []) if f.rule_id == no]
            # "해당없음"과 "검사 못 함"을 섞지 않는다. 앞은 정상이고(이 기준이
            # 이 문서를 대상으로 하지 않는다) 뒤는 고쳐야 할 것이다(LLM 이 안
            # 붙었거나 응답이 없었다). 한 말로 뭉치면 검토자가 "검사 안 됨 5" 를
            # 보고 무엇을 해야 하는지 알 수 없다.
            status = {"위반": "flagged", "통과": "clean",
                      "해당없음": "na"}.get(verdict, "unreviewed")
            # 미판정에도 두 가지가 있고 검토자가 할 일이 다르다.
            #   전부 무응답  → 서버가 안 붙었거나 죽었다. 고칠 곳은 설정·장비다.
            #   응답은 왔는데 이 기준만 미판정 → 모델이 그 기준을 빠뜨렸다
            #     (_BATCH 주석의 커버리지 문제). 다시 돌리면 나올 수 있다.
            # 한 말로 뭉치면 검토자가 무엇을 해야 하는지 알 수 없다.
            ck = llm_checkers[llm_key]
            scope_note = getattr(ck, "notes", {}).get(no, "")
            if status == "unreviewed" and ck.calls and ck.unanswered == ck.calls:
                item_results.append(_result(
                    it, mode, "noanswer",
                    note_suffix="LLM 이 답하지 않아 이 기준을 보지 못했습니다. " + scope_note))
                continue
            if status == "unreviewed":
                failed, asked, reason = getattr(ck, "failures", {}).get(no, (0, 0, None))
                why = f" ({reason})" if reason else ""
                if asked and failed == asked:
                    # 이 기준을 물은 호출이 전부 판정을 못 돌려줬다. "답했지만 판정이
                    # 오지 않았다"고 적으면 원인을 반대로 가리킨다(실측 2026-09-15: 출력
                    # 한도에 잘린 호출 하나가 그렇게 떴다).
                    reply = (f"이 기준을 물은 LLM 호출 {asked}회가 판정을 돌려주지 "
                             f"못했습니다{why} — 다시 검토하면 나올 수 있습니다.")
                elif failed:
                    reply = (f"이 기준을 물은 LLM 호출 {asked}회 중 {failed}회가 판정을 "
                             f"돌려주지 못했고{why}, 나머지 호출에서도 판정이 오지 않았습니다.")
                else:
                    reply = ("LLM 이 답했지만 이 기준의 판정은 오지 않았습니다 "
                             "— 다시 검토하면 나올 수 있습니다.")
                item_results.append(_result(
                    it, mode, status, mine,
                    note_suffix=" ".join(x for x in (scope_note, reply) if x)))
                continue
            item_results.append(_result(it, mode, status, mine, note_suffix=scope_note))
            continue
        if mode == "규칙":
            # 기준이 댄 이름의 검사기 것만 받는다. 이름을 안 댔거나 모르는 이름이면
            # 이 기준을 검사하는 규칙이 아직 없다 — 사람 몫이다. 예전에는 agent
            # 라벨로 이어서, 규칙 검사기 둘이 낸 지적이 그 라벨을 단 기준 전부에
            # (EV2 는 15개) 복사됐다. 하나짜리 결함이 열다섯 건으로 보였다.
            key = checker_key(it)
            if not key:
                item_results.append(_result(
                    it, mode, "manual",
                    note_suffix="이 기준을 검사하는 규칙이 아직 없습니다."))
                continue
            if key in blocked_rules:
                # 검사할 규칙은 있는데 **잴 값**을 기준이 안 줬다. 값을 적은 팀에서는
                # 그대로 자동으로 돈다 — 그 차이를 말해야 검토자가 "우리 팀은 왜
                # 사람이 보나"를 알 수 있다.
                item_results.append(_result(
                    it, mode, "manual",
                    note_suffix=f"{blocked_rules[key]}이 검토 기준에 없어 자동으로 "
                                f"검사하지 못합니다 — 사람이 확인합니다. "
                                f"(목록을 기준에 적은 팀에서는 자동으로 검사합니다.)"))
                continue
            fs = findings_by_key.get(key, [])
            item_results.append(_result(it, mode, _item_status(fs), fs))
            continue
        # 문서 검토 항목이 아닌 계열(생성·이력 관리). "사람이 확인" 과 갈라야
        # 한다 — 사람 확인은 이 문서를 사람이 보라는 뜻이고, 이쪽은 이 문서를
        # 볼 항목이 아니라는 뜻이다. 규칙·LLM 갈래를 다 거친 뒤라, 기준이
        # mode·check 를 명시했으면 그쪽이 이미 가져갔다.
        if out_of_scope(it):
            item_results.append(_result(it, mode, "outofscope"))
            continue
        # 전체·사람: 검사기가 없다. 사람 몫으로 둔다.
        item_results.append(_result(it, mode, "manual"))
    # 지적 자체는 검사기당 한 벌만 최종 목록에 담는다(항목마다 중복 담지 않는다).
    for fs in findings_by_key.values():
        all_findings.extend(fs)
    # 그림·파서 경고 보고는 어느 체크리스트 항목에도 속하지 않는다(파이프라인에 대한 보고다).
    all_findings.extend(image_findings)
    all_findings.extend(parser_findings)

    # 같은 근거·같은 종류의 중복 카드 병합. 항목이 버린 지적을 참조하고 있으면
    # 생존 지적으로 갈아끼운다 — 참조를 끊으면 그 기준의 지적이 조용히 사라지고,
    # 갈아끼우면 카드의 "기준: … 외 N건" 이 두 기준을 다 말한다.
    all_findings, _replaced = merge_duplicates(all_findings)
    if _replaced:
        for ir in item_results:
            merged, seen_ids = [], set()
            for f in ir.findings:
                g = _replaced.get(id(f), f)
                if id(g) not in seen_ids:
                    seen_ids.add(id(g))
                    merged.append(g)
            ir.findings = merged

    emit({"key": "report", "status": "done", "detail": fmt_findings(len(all_findings))})
    return CriteriaReviewResult(
        source_path=str(path), items=item_results, findings=all_findings,
        section_count=len(sections), chunk_count=len(chunks),
        char_count=sum(len(s.text) for s in sections), document=doc,
        images=list(raw.meta.get("images") or []))


def review_with_checklist(path, checklist, config,
                          on_progress: Callable[[dict], None] | None = None,
                          field_specs: Sequence = (),
                          output_key: str = "") -> CriteriaReviewResult:
    """구 API 호환 어댑터. 새 코드는 ``review_document_by_criteria``를 사용한다."""
    return review_document_by_criteria(
        path, getattr(checklist, "items", ()), config,
        on_progress=on_progress, field_specs=field_specs, output_key=output_key)


# 결과 타입을 직접 import한 기존 모듈을 위한 호환 이름.
ChecklistReviewResult = CriteriaReviewResult
