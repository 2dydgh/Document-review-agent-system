"""trkim doc_parser 장착 어댑터 (조립 계층).
3-way 통합으로 trkim 백엔드는 modules/doc_parser 안(router.parse_document)에 병합돼 있다.

**trkim 은 기본 파서다** — 설정 게이트 없이 항상 EXTRA_LOADERS 앞순위로 장착된다
(install_trkim_parser, cli.py·server.py 가 무조건 호출). 스캔 OCR·HWP 파싱이
legacy 보다 강하다.

세 갈래 통합의 이음새: trkim `DocumentModel`(blocks) → yhlee2 `RawDoc`(마크다운 text).
근거 명세: 메인 레포 doc/3way_통합분석_20260806.md §4. 핵심 규약:

- 표는 `| 셀 | 셀 |` 한 행=한 줄 (fields/extract._cells 의 startswith/endswith 요구).
  셀 안 개행→공백, 파이프→`/`. 중첩 표는 호스트 셀에 평탄화.
  **가로 병합은 한 칸으로 접는다**(_collapse_hmerge) — legacy 로더가 원본 XML 의
  `tc` 를 세어 그렇게 내고, 추출기(fields/extract.py)의 "라벨 오른쪽 칸이 값" 이
  그 규약 위에 쓰여 있다. 격자를 그대로 내면 값이 한 칸 밀려 거짓 지적이 난다.
  세로 병합의 이어짐 행은 legacy 와 같이 빈 칸으로 남긴다.
- 페이지 경계는 단독 줄 "\f" (normalize 규약). trkim 0-idx → normalize 가 1부터 세므로
  자동 +1. 빈 페이지도 자리를 유지해 번호가 밀리지 않게 한다.
- figure 는 `[그림 N]`/`[그림 N: 텍스트]` 자리표시 — describe_images 치환·verify 의
  그림 하이라이트 정규식과 물리는 형식. **머릿말·꼬리말과 표지(1쪽)의 그림은 번호만
  소비하고 자리표시를 본문에 안 싣는다**(to_rawdoc).
- header/footer 블록은 **본문에서 빼되 meta 로 옮긴다** (`meta["headers"]`·`["footers"]`).
  본문에 섞으면 쪽마다 반복돼 일관성·중복 검사를 오염시킨다 — 그래서 뺐는데, 그러면
  "머릿말에 의뢰번호가 있는가" 같은 기준을 볼 데이터가 아예 없어진다(AI시험인증1팀
  서식-2·3, AX품질팀 §2.1). 본문에서 빼는 것과 통째로 버리는 것은 다르다.

**meta["tables"]/["images"] 는 legacy 로더로 보충한다** (`TrkimLoader.load`).
trkim 모델 자체에는 표 셀 글꼴(fontSizes)도 그림 ZIP part 경로도 없어 만들 수
없다 — 그런데 이 둘이 없으면 FontSizeChecker(표 글꼴 검사)와 그림 해석
(describe_images)이 조용히 죽는다(parser-impact-report.md 확정 결론 1·2).
같은 파일을 legacy 로더로 한 번 더 읽어 그 meta만 접붙인다: trkim 의 본문
text·구조는 그대로 두고 tables/images 만 옮긴다. 보충이 실패하면(예: legacy가
못 읽는 스캔 PDF) trkim 결과는 버리지 않고 meta["parser_warnings"]에 실패
사실만 남긴다 — 조용히 죽이지 않는다(CLAUDE.md "모르면 모른다고 말한다").

OCR 은 Qwen-VL(9002, OpenAI 호환)을 trkim 훅 계약
`(img_bytes, page_idx) -> [{"bbox": None, "text": 줄}]` 로 감싼다. bbox 는 VL 이
신뢰성 있게 못 주므로 None — pdf_backend 는 bbox 없는 줄도 그대로 처리한다.
PaddleOCR 로 교체할 땐 이 훅만 ocr_paddle.make_ocr_lines_hook() 으로 바꾸면 된다.
"""
from __future__ import annotations

import base64
import json
import urllib.request
from pathlib import Path

from modules.doc_parser.ingestion import base as ingestion_base
from modules.doc_parser.ingestion.base import RawDoc

# ---------------------------------------------------------------------------
# Qwen-VL OCR 훅
# ---------------------------------------------------------------------------

_OCR_PROMPT = (
    "이 이미지에 보이는 모든 텍스트를 읽어 원문 그대로 출력하라. "
    "설명·요약·번역 금지. 읽기 순서(왼쪽 위→오른쪽 아래)대로 줄 단위로만 출력한다. "
    "표는 각 행을 '| 셀 | 셀 |' 형식 한 줄로 쓴다."
)


def make_vl_ocr_hook(base_url: str, model: str = "ocr", api_key: str = "",
                     timeout: float = 180.0):
    """trkim register_ocr 계약에 맞는 Qwen-VL 훅을 만든다."""
    url = base_url.rstrip("/") + "/chat/completions"

    def hook(img_bytes: bytes, page_idx: int) -> list[dict]:
        b64 = base64.b64encode(img_bytes).decode("ascii")
        payload = {
            "model": model,
            "temperature": 0,
            "max_tokens": 4096,
            # **반복 붕괴를 끊는다.** 로고처럼 글자가 몇 개뿐인 그림에서 모델이
            # 같은 낱말을 멈추지 못하고 되풀이해 상한(max_tokens)까지 채우는 일이
            # 있다 — 실측(시험의뢰서 44KB 로고): `SURESOFT` 를 9,216자까지 뱉으며
            # **93초**를 썼고, 그 글자가 그대로 검토 본문에 실렸다.
            # frequency_penalty=1.0 을 주면 모델이 스스로 멈춘다(finish=stop):
            #   penalty 없음  93.3초 · 9,216자      penalty 1.0  1.9초 · 186자
            # 내용이 실제로 있는 그림은 결과가 **한 글자도 안 바뀐다**(실측: 시험
            # 설계서 77KB 구성도, 두 설정 모두 1.2초 · 83자 · 같은 문장).
            # `repetition_penalty` 는 이 서버가 무시했다(93.6초 · 9,216자).
            "frequency_penalty": 1.0,
            "messages": [{
                "role": "user",
                "content": [
                    {"type": "image_url",
                     "image_url": {"url": f"data:image/png;base64,{b64}"}},
                    {"type": "text", "text": _OCR_PROMPT},
                ],
            }],
        }
        headers = {"Content-Type": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        req = urllib.request.Request(url, json.dumps(payload).encode("utf-8"),
                                     headers=headers)
        # 사내 vLLM 직결 — 프록시 환경변수에 낚이지 않게 빈 ProxyHandler 로 연다
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        text = (data.get("choices") or [{}])[0].get("message", {}).get("content") or ""
        return [{"bbox": None, "text": ln.strip()}
                for ln in text.splitlines() if ln.strip()]

    return hook


# ---------------------------------------------------------------------------
# DocumentModel → RawDoc
# ---------------------------------------------------------------------------

def _cell(c: str) -> str:
    return " ".join((c or "").split()).replace("|", "/")


def _flatten_nested(td) -> list[list[str]]:
    """중첩 표를 호스트 셀 텍스트에 평탄화한 격자 사본을 돌려준다 (yhlee2 관례)."""
    cells = [list(row) for row in (td.cells or [])]
    for nt in (td.nested_tables or []):
        r, c = nt.get("row"), nt.get("col")
        inner = nt.get("table")
        if inner is None or r is None or c is None:
            continue
        flat = " ".join(_cell(x) for row in _flatten_nested(inner) for x in row if x)
        caption = getattr(inner, "caption", None)
        if caption:
            flat = (_cell(caption) + " " + flat).strip()
        # 중첩 표는 기존 평문 변환 계약을 유지하되, 그 안 그림의 원본 캡션도 보존한다.
        for im in (getattr(inner, "images", None) or []):
            caption = getattr(im.get("figure"), "caption", None)
            if caption:
                flat = (flat + " " + _cell(caption)).strip()
        if 0 <= r < len(cells) and 0 <= c < len(cells[r]):
            cells[r][c] = (cells[r][c] + " " + flat).strip()
    return cells


def _embed_cell_figures(td, cells: list[list[str]], next_no) -> list[list[str]]:
    """표 셀 안 그림을 그 칸 텍스트에 `[그림 N: 설명]` 으로 접붙인다.

    **한글 문서는 순서도·구성도를 표 칸에 넣는 것이 관례다.** 실측(2026-08-25,
    AX품질팀 상세설계서 PRJX-DS-014): 그림 26장 중 **24장이 `TableData.images`** 에
    있었고 본문 FIGURE 블록은 2장뿐이었다. 파서는 제대로 담았는데 여기서 표를
    `| 셀 | 셀 |` 로 펼 때 images 를 한 번도 안 봐서, OCR 까지 마친 순서도 24장이
    검토 본문에 실리지 않았다 — "[그림 N] 표시 2개와 뽑은 그림 26개의 수가 다르다"
    는 경고가 그 증상이다.

    `_flatten_nested` 가 중첩 표를 호스트 셀에 접붙이는 것과 같은 관례로 접붙인다.
    번호는 본문 FIGURE 블록과 **같은 카운터**(next_no)로 문서 순서대로 매긴다 —
    `describe_images` 가 `[그림 N]` 을 meta["images"] 의 N 번째와 짝짓고, 형광펜이
    그 번호로 그림을 찾으므로 따로 세면 전부 어긋난다.

    셀 안에 넣어도 표 줄이 안 깨진다 — `_cell()` 이 `|` 를 `/` 로 바꾸고 개행을
    공백으로 접는다. 자리표시를 소비하는 쪽(`describe_images`·verify 하이라이트)은
    문자열 치환이라 줄 안 어디에 있든 무관하다.
    """
    out = [list(row) for row in cells]
    for im in (getattr(td, "images", None) or []):
        r, c, fig = im.get("row"), im.get("col"), im.get("figure")
        if fig is None or r is None or c is None:
            continue
        no = next_no()
        t = " ".join((getattr(fig, "text", None) or "").split())
        mark = f"[그림 {no}: {t}]" if t else f"[그림 {no}]"
        caption = getattr(fig, "caption", None)
        if caption:
            # OCR/그림 설명의 자리표시 치환으로 원본 캡션까지 지워지지 않게 밖에 둔다.
            mark += " " + _cell(caption)
        if 0 <= r < len(out) and 0 <= c < len(out[r]):
            out[r][c] = (out[r][c] + " " + mark).strip()
        # 격자 밖 앵커는 버리지 않는다 — 번호는 이미 소비됐으니 자리라도 남긴다.
        elif out:
            out[-1][-1] = (out[-1][-1] + " " + mark).strip()
    return out


def _collapse_hmerge(td, cells: list[list[str]]) -> list[list[str]]:
    """가로 병합의 **이어짐 칸을 걷어낸다.** legacy 로더와 같은 격자로 맞추는 일이다.

    로더가 표를 `| 셀 | 셀 |` 로 낼 때 병합을 어떻게 푸느냐는 취향이 아니라 **계약**
    이다. `fields/extract.py` 는 "라벨 오른쪽 칸이 값" 으로 값을 꺼내는데, 격자를
    그대로 내면 라벨이 두 칸을 먹는 순간 오른쪽 칸이 이어짐(빈 칸)이 되어 값이
    한 칸 더 밀린다. legacy 로더(ingestion/docx.py·hwpx.py)는 원본 XML 의 `tc` 를
    세므로 가로 병합이 애초에 한 칸이고, 그 규약 위에서 추출기가 쓰여 있다.

    실측(SST-K-TP-7-01-01 시험 의뢰 검토 기록서, 접수번호 칸이 2열 병합):

        trkim 격자   | 접수번호 |  | RN-26-999 | 접수일 |  | 2026. 01. 01. |
        legacy·여기 | 접수번호 | RN-26-999 | 접수일 | 2026. 01. 01. |

    걷어내지 않으면 문서에 값이 멀쩡히 있는데 `'접수번호' 이(가) 비어 있습니다` 가
    major 로 나갔다 — 검토자가 고칠 것이 없는 지적이고, 근거로 다는 인용이 값이
    아니라 라벨이라 인용 대조도 이걸 못 잡는다.

    **세로 병합의 이어짐 행은 그대로 둔다** — legacy 도 그 자리를 빈 칸으로 남긴다
    (원본 XML 에 `tc` 가 있다). 여기서 같이 걷어내면 행마다 칸 수가 달라져
    `_table_rows` 의 열 맞춤이 무너진다.
    """
    drop = {
        (r, c)
        for m in (getattr(td, "merges", None) or [])
        if (m.get("col_span") or 1) > 1
        for r in range(m.get("row", 0), m.get("row", 0) + (m.get("row_span") or 1))
        for c in range(m.get("col", 0) + 1, m.get("col", 0) + (m.get("col_span") or 1))
    }
    if not drop:
        return cells
    return [[c for j, c in enumerate(row) if (i, j) not in drop]
            for i, row in enumerate(cells)]


def to_rawdoc(model, fmt: str, source_path: str | None = None) -> RawDoc:
    """trkim DocumentModel 을 yhlee2 RawDoc(마크다운 + \f 페이지 경계)으로 변환.

    source_path 는 실제 파일 경로를 준다 — model.source 는 파일명뿐이라(경로 없음,
    docx_backend 등 `Path(path).name`), 그대로 쓰면 그림 바이트를 다시 열 때
    (doc_parser.ingestion.images._archive) cwd 기준으로 찾다 못 찾는다. 안 주면
    model.source 로 돌아간다(직접 호출하는 테스트용 하위호환).
    """
    pages: dict[int, list[str]] = {}
    # 머릿말·꼬리말. 본문에는 안 싣지만 버리지도 않는다 — 파일 상단 docstring 참고.
    # 같은 글이 쪽마다 반복되므로 중복을 접는다(순서는 지킨다).
    heads: dict[str, list[str]] = {"headers": [], "footers": []}
    # 그림 번호는 본문 FIGURE 와 표 셀 안 그림이 **한 카운터**를 나눠 쓴다
    # (_embed_cell_figures 주석). 리스트로 감싼 것은 클로저에서 증가시키기 위함.
    fig_no = [0]
    # 표지 판정에 쓸 쪽수. **한 쪽짜리 문서에는 표지가 없다** — 그 한 쪽이 본문이라
    # 거기 그림까지 빼면 문서의 그림이 통째로 사라진다.
    n_doc_pages = max(int(model.meta.get("pages") or 0),
                      max((b.page or 0) for b in model.blocks) + 1 if model.blocks else 0)

    def next_fig_no() -> int:
        fig_no[0] += 1
        return fig_no[0]

    for b in model.blocks:
        if b.section != "body":
            slot = "headers" if b.section.startswith("header") else "footers"
            # **표 안에 있는 머릿말을 놓치지 않는다.** 실측(AI시험인증1팀 산출물
            # 11종): 의뢰서·동의서·계획서의 `의뢰번호 : SST-26-999` 가 전부 표
            # 셀 안에 있었고, b.text 만 보면 그 셋이 통째로 안 잡힌다.
            line = " ".join((b.text or "").split())
            if not line and b.table is not None and b.table.cells:
                line = " ".join(" ".join(c.split()) for row in _flatten_nested(b.table)
                                for c in row if c and c.strip())
            caption = getattr(b.table if b.table is not None else b, "caption", None)
            if caption:
                line = (_cell(caption) + " " + line).strip()
            if b.table is not None:
                for im in (b.table.images or []):
                    caption = getattr(im.get("figure"), "caption", None)
                    if caption:
                        line = (line + " " + _cell(caption)).strip()
            if line and line not in heads[slot]:
                heads[slot].append(line)
            # **머리말·꼬리말 그림도 번호는 소비한다 — 본문에 싣지 않을 뿐이다.**
            # describe_images 는 legacy meta["images"] 의 N 번째 설명을 `[그림 N]`
            # 에 붙이는데, legacy 는 문서 등장 순서로 세므로 머리말 로고가 1~4번이다.
            # 여기서 번호를 건너뛰면 본문 첫 순서도가 `[그림 1]` 이 되어 로고 설명을
            # 받는다 — 실측(2026-08-25, PRJX-DS-014): 머리말/꼬리말 표 안 로고 4장
            # 때문에 **모든 그림 설명이 4칸씩 밀려** 엉뚱한 그림에 붙었다.
            if b.type == "figure":
                next_fig_no()
            elif b.table is not None:
                for _ in (b.table.images or []):
                    next_fig_no()
            continue
        page = b.page or 0
        # **표지(1쪽) 그림은 머릿말 로고와 같이 번호만 소비한다.** 팀 서식의 표지에는
        # 발주처·수행사 로고가 들어가는데, 그것이 `[그림 1]`·`[그림 2]` 로 본문에
        # 실리면 전체 문서 검사가 "그림 번호가 3부터 시작한다"를 지적한다
        # (2026-09-14 QA). 로고인지 코드가 판정하지 않는다 — 표지에 있느냐만 본다.
        cover = page == 0 and n_doc_pages > 1
        out = pages.setdefault(page, [])
        if b.type == "heading":
            out += ["", "#" * min(b.level or 1, 6) + " " + (b.text or ""), ""]
        elif b.type == "table":
            caption = getattr(b.table, "caption", None)
            if caption:
                out.append(caption)
            if b.table is None or not b.table.cells:
                out.append("(표: 구조 미복원)")  # 조용히 빼면 "표 없음"으로 보인다
            else:
                # 순서: 중첩 표 평탄화 → 셀 그림 접붙이기 → 가로 병합 접기.
                # 그림은 앵커 칸에 붙고, 접기는 이어짐 칸만 지우므로 그림이 안 사라진다.
                grid = _flatten_nested(b.table)
                if cover:
                    for _ in (b.table.images or []):
                        next_fig_no()
                else:
                    grid = _embed_cell_figures(b.table, grid, next_fig_no)
                out += ["| " + " | ".join(_cell(c) for c in row) + " |"
                        for row in _collapse_hmerge(b.table, grid)]
            out.append("")
        elif b.type == "figure":
            no = next_fig_no()
            t = " ".join((b.text or "").split())
            if not cover:
                out.append(f"[그림 {no}: {t}]" if t else f"[그림 {no}]")
            if getattr(b, "caption", None):
                out.append(b.caption)
        elif b.text:  # paragraph / code / formula / footnote
            out.append(b.text)

    n_pages = max(int(model.meta.get("pages") or 0),
                  (max(pages) + 1) if pages else 0)
    text = "\n\f\n".join(
        "\n".join(pages.get(i, [])).strip(" \n") for i in range(n_pages))
    # "tables"/"images" 는 여기서 안 채운다 — TrkimLoader.load 가 legacy 로더로
    # 보충한다(파일 상단 docstring 참조). model.warnings 는 그대로 얹어 둔다 —
    # 이후 보충이 실패하면 TrkimLoader.load 가 여기 이어서 추가한다.
    meta = {
        "format": fmt,
        "pages": n_pages,
        "page_basis": "approximate" if model.meta.get("pages_approx") else
                      ("pdf" if fmt == "pdf" else "unknown"),
        "pages_approx": bool(model.meta.get("pages_approx")),
        "backend_notes": list(model.meta.get("backend_notes") or []),
        "parser": "trkim",
        "parser_warnings": list(model.warnings or []),
        # 문서에서 센 그림 수(본문에 안 실린 머릿말·표지 그림 포함).
        # legacy 그림 목록과 수를 맞출 때 쓴다(_augment_with_legacy_meta).
        "figures_seen": fig_no[0],
        # 머릿말·꼬리말의 **글자만**. 좌/우 배치는 담지 않는다 — 그건 탭 정지·문단
        # 정렬 정보라 Block 에 자리가 없다. 팀 기준이 요구하는 것은 "머릿말에
        # 의뢰번호가 있는가"까지라 글자면 된다(AI시험인증1팀 md §1.2).
        "headers": heads["headers"],
        "footers": heads["footers"],
    }
    return RawDoc(source_path=source_path or model.source, text=text, meta=meta)


# ---------------------------------------------------------------------------
# Loader + 설치
# ---------------------------------------------------------------------------

class TrkimLoader:
    """trkim 파서를 yhlee2 로더 레지스트리 규약으로 감싼다.

    trkim 파싱이 실패하면 기존(yhlee2) 로더로 폴백해 가용성을 지킨다 —
    단 폴백 사실을 meta 에 남겨 조용한 강등이 되지 않게 한다.
    """

    extensions = (".pdf", ".docx", ".hwpx", ".hwp")

    def __init__(self, ocr: bool) -> None:
        self._ocr = ocr

    def load(self, path: Path) -> RawDoc:
        from modules.doc_parser.router import parse_document as trkim_parse
        try:
            model = trkim_parse(path, ocr=self._ocr)
            if not model.blocks:
                raise RuntimeError(
                    "trkim 파서가 블록 0개 반환: " + "; ".join(model.warnings or []))
        except Exception as e:  # noqa: BLE001 — 폴백은 남기되 사실을 드러낸다
            raw = self._fallback(path)
            raw.meta["parser"] = "yhlee2-fallback"
            raw.meta["parser_warnings"] = [f"trkim 파서 실패로 기본 로더 사용: {e}"]
            return raw
        raw = to_rawdoc(model, path.suffix.lower().lstrip("."), source_path=str(path))
        return self._augment_with_legacy_meta(raw, path)

    # ponytail: 이중 파싱이다 — trkim 이 이미 읽은 문서를 legacy 로더로 한 번 더
    # 연다. 스캔 OCR(수십 초~수 분) 대비로는 소액이지만, 큰 디지털 PDF는
    # pdfplumber 표 추출(PdfDigitalLoader)이 그 자체로 병목일 수 있다(236쪽
    # 41초 실측, pdf_digital.py 모듈 docstring). 문서 1건 5분 목표 안에서는
    # 지금 수준으로 두고, 필요해지면 legacy 로더에서 표/그림 메타만 뽑는 경량
    # 경로를 분리한다(본문 재추출은 버린다).
    def _augment_with_legacy_meta(self, raw: RawDoc, path: Path) -> RawDoc:
        """표 글꼴·그림 메타를 legacy 로더로 보충한다.

        trkim 본문·구조는 그대로 두고 legacy RawDoc.meta 의 "tables"/"images"
        만 있으면 옮겨 붙인다. legacy 가 이 문서를 못 읽으면(예: OCR 이 필요한
        스캔 PDF — legacy 는 그 경로가 없다) trkim 결과는 그대로 반환하되
        실패 사실을 parser_warnings 에 남긴다 — 조용히 죽이지 않는다.
        """
        try:
            legacy = self._fallback(path)
        except Exception as e:  # noqa: BLE001 — 보충 실패로 trkim 본 결과를 버리지 않는다
            raw.meta["parser_warnings"].append(
                f"표 글꼴·그림 메타 보충 실패: {e} — 해당 검사는 이 문서에서 "
                "수행되지 않습니다")
            return raw

        tables = legacy.meta.get("tables")
        if tables:
            raw.meta["tables"] = tables
        images = legacy.meta.get("images")
        if images:
            raw.meta["images"] = images
            # 그림 번호 정합: trkim 본문의 [그림 N] 자리표시 수와 legacy 그림
            # 목록 개수가 다르면 describe_images 의 번호 짝짓기가 어긋날 수
            # 있다. 완전 정합화(같은 그림인지 내용까지 대조)는 범위 밖이라
            # 경고로만 알린다.
            # 본문에 실린 자리표시만 세면 머리말·표지 로고만큼 늘 모자라 경고가 매번
            # 뜬다. 번호는 그 그림들까지 소비하므로(to_rawdoc) 센 장수를 그대로 쓴다.
            seen = raw.meta.get("figures_seen", 0)
            if seen != len(images):
                raw.meta["parser_warnings"].append(
                    f"문서에서 센 그림 {seen}장과 뽑은 그림 "
                    f"{len(images)}개의 수가 달라, 그림에서 나온 지적의 그림 번호가 "
                    f"어긋날 수 있습니다.")
        return raw

    def _fallback(self, path: Path) -> RawDoc:
        from modules.doc_parser.ingestion.docx import DocxLoader
        from modules.doc_parser.ingestion.hwp import HwpLoader
        from modules.doc_parser.ingestion.hwpx import HwpxLoader
        from modules.doc_parser.ingestion.pdf_digital import PdfDigitalLoader
        fallbacks = {".pdf": PdfDigitalLoader, ".docx": DocxLoader,
                     ".hwpx": HwpxLoader, ".hwp": HwpLoader}
        return fallbacks[path.suffix.lower()]().load(path)


def install_trkim_parser(vlm_base_url: str = "", vlm_model: str = "ocr",
                         api_key: str = "") -> None:
    """서버/CLI 기동 시 1회 호출 — trkim 파서를 앞순위 로더로 꽂고 OCR 훅을 연결한다."""
    if any(isinstance(ld, TrkimLoader) for ld in ingestion_base.EXTRA_LOADERS):
        return  # 멱등
    ocr = bool(vlm_base_url)
    if ocr:
        from modules.doc_parser import router as trkim
        trkim.register_ocr(make_vl_ocr_hook(vlm_base_url, vlm_model, api_key))
    ingestion_base.EXTRA_LOADERS.insert(0, TrkimLoader(ocr=ocr))
