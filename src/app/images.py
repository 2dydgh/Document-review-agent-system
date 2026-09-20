"""그림을 비전 모델로 읽어 본문 자리표시를 채운다.

doc_parser 는 그림이 **있다는 사실**까지만 남긴다(`[그림 3]`). 여기서 그 그림을
비전 모델에 보내 설명을 받아 `[그림 3: 설명]` 으로 채운다.

**왜 doc_parser 가 아니라 여기인가.** 규칙 기반 검사는 LLM 없이 동작해야 한다
(루트 CLAUDE.md). doc_parser 가 LLM 에 의존하면 그 원칙이 깨진다. 파싱은 LLM 을
모르고, 해석은 조립 계층이 llm_client 로 한다.

**왜 값어치가 있는가.** 실측: PLT56_SYSA_RVVR 의 네트워크 구성도 4장에서
"SYSA Server-P (Main)는 IPS, DCS-CGW, SYSA Server-S (Backup)… 와 통신한다" 같은
문장이 나왔다. 그 시스템 이름이 본문에 없고 그림에만 있었다면 추적성·일관성 검사가
통째로 못 보고 있었던 것이다. 워드 대체텍스트는 "텍스트이(가) 표시된 사진" 뿐이다.

**대가.** 그림 하나에 1.8~3.4초(실측). 6장 6.4초, 4장 12.2초 — 문서 1건 5분 목표에
들어간다. 로고 같은 장식도 설명이 붙어 잡음이 되지만(10장 중 2장) 걸러내지 않는다.
무엇이 로고인지 코드가 판정하는 것도 추측이고, 놓치는 다이어그램의 값어치가 크다.

**설명은 실행마다 조금씩 다르다.** 실측(2026-09-01, PRJX-DS-005 그림 23장을 두 번):
19장은 같고 **4장이 달랐다**(그림 18·20·22·23 — 화면 캡처·그래프처럼 글자가 많은
것들). 온도는 이미 0이다 — vLLM 은 배치 스케줄링 때문에 같은 입력에도 비트 단위로
같은 출력을 보장하지 않는다. 그래서 **그림에서 나온 지적은 검토를 다시 돌리면
있었다 없었다 한다.** 도구의 고장이 아니라 이 경로의 성질이다. 숨기지 않는다:
읽은 장수는 준비 단계 줄에(orchestrator._ingestion_detail), 그림에서 읽은 근거라는
사실은 지적마다(agent_quality.consistency._FROM_IMAGE, 화면의 그림 칩) 붙는다.
"""
from __future__ import annotations

import base64
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace

from modules.doc_parser import RawDoc, iter_images, wmf_to_png

# 추측을 막고 글자를 그대로 옮기게 한다. 이 문서들의 그림은 대부분 표·구성도라
# "무엇처럼 보인다"보다 적힌 글자가 값어치 있다.
_PROMPT = (
    "이 그림은 기술 문서에 실린 것이다. 문서를 검토하는 사람에게 필요한 만큼만 "
    "설명하라. 그림 안에 글자가 있으면 그 글자를 그대로 옮겨라. "
    "3문장 이내로, 추측은 쓰지 마라."
)

# 설명이 길어지면 본문이 그림 설명으로 뒤덮인다. 실측 응답은 1~3문장이었다.
_MAX_CHARS = 600


def _mime(part: str) -> str:
    ext = part.rsplit(".", 1)[-1].lower() if "." in part else ""
    return {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
            "gif": "image/gif", "bmp": "image/bmp"}.get(ext, "image/png")


# WMF 파일 머리. 한글이 순서도·구성도를 저장하는 벡터 포맷이다(doc_parser.ocr_batch 와
# 같은 값). 확장자가 아니라 바이트로 본다 — part 이름은 백엔드마다 다르게 온다.
_WMF_MAGICS = (b"\x01\x00\x09\x00", b"\xd7\xcd\xc6\x9a")


def _rasterize(part: str, data: bytes) -> tuple[str, bytes] | None:
    """VLM 에 보낼 (mime, bytes). 벡터면 픽셀로 바꾼다. 못 바꾸면 None.

    **벡터를 그대로 보내면 안 된다.** 실측(2026-08-25, AX품질팀 상세설계서): 그림 26장
    중 18장이 WMF 였고 `image/wmf` 로 그대로 보내 전부 실패했다 — "그림 18/26장을
    읽지 않았습니다" 가 그 결과다. 파서 쪽(ocr_batch)은 같은 이유로 이미 변환하는데
    이 경로는 legacy `meta["images"]` 의 바이트를 따로 읽어 보내므로 여기서도 바꿔야
    한다. 변환기는 doc_parser 가 공개한 것을 그대로 쓴다.
    """
    if data[:4] in _WMF_MAGICS:
        png = wmf_to_png(data)
        return ("image/png", png) if png else None
    return _mime(part), data


def describe_images(raw: RawDoc, vlm, on_progress=None, concurrency: int = 1) -> RawDoc:
    """`[그림 N]` → `[그림 N: 설명]`. 못 읽은 그림은 자리표시를 그대로 둔다.

    vlm 이 None 이면(주소 미설정) 아무것도 하지 않고 그대로 돌려준다. 그 사실은
    meta["images_read"] 로 남는다 — 부르는 쪽이 "그림은 읽지 않았습니다"를 결과에
    올려야 한다. 조용히 넘기면 그림 안의 내용을 검토한 것처럼 보인다.

    바이트는 **먼저 한꺼번에** 읽고(ZIP 읽기라 빠르다) 모델 호출만 동시로 돌린다.
    포맷을 다루는 일과 네트워크를 기다리는 일을 섞지 않는 것이다 — .hwp 는 바이트를
    얻으려면 rhwp 를 불러야 하고, rhwp 는 Document 를 단일 스레드 모델로 다룬다.
    """
    images = raw.meta.get("images") or []
    if not images:
        return raw
    if vlm is None:
        return replace(raw, meta={**raw.meta, "images_read": 0})

    emit = on_progress or (lambda ev: None)
    # 바이트 먼저. 여기는 순차여도 0.01초다(실측).
    payloads = list(iter_images(raw))
    total = len(payloads)

    done = [0]
    lock = threading.Lock()

    def report() -> None:
        """몇 장 끝났는지 알린다. 동시에 돌면 완료 순서가 뒤섞이므로 누적으로 센다."""
        with lock:
            done[0] += 1
            i = done[0]
        emit({"key": "ingestion", "status": "running",
              "detail": f"그림 {i}/{total} 읽는 중"})

    def one(payload) -> dict:
        """그림 하나 → meta + description/error. 예외는 올리지 않는다 —
        그림 하나가 검토 전체를 죽이면 안 된다."""
        meta, data = payload
        try:
            if data is None:
                return {**meta, "description": "", "error": "그림 바이트를 얻지 못했습니다"}
            desc, error = _ask(meta.get("part", ""), data, vlm)
            return {**meta, "description": desc, "error": error}
        finally:
            report()

    if concurrency > 1 and total > 1:
        # map 은 입력 순서대로 결과를 낸다 — 순서가 흔들리면 그림 N 의 설명이
        # 다른 그림 자리에 들어간다.
        with ThreadPoolExecutor(max_workers=min(concurrency, total),
                                thread_name_prefix="vlm") as pool:
            described = list(pool.map(one, payloads))
    else:
        described = [one(p) for p in payloads]

    text = raw.text
    read = 0
    for meta in described:
        desc = meta.get("description") or ""
        if not desc:
            continue
        read += 1
        # 자리표시는 번호로 찾는다. 대체텍스트가 붙은 형태(`[그림 3: alt]`)와
        # 번호만 있는 형태(`[그림 3]`) 둘 다 있으므로 통째로 갈아끼운다.
        old_alt = f"[그림 {meta['no']}: {meta.get('alt', '')}]"
        old_bare = f"[그림 {meta['no']}]"
        new_mark = f"[그림 {meta['no']}: {desc}]"
        if old_alt in text:
            text = text.replace(old_alt, new_mark, 1)
        elif old_bare in text:
            text = text.replace(old_bare, new_mark, 1)

    return replace(raw, text=text,
                   meta={**raw.meta, "images": described, "images_read": read})


def _ask(part: str, data: bytes, vlm) -> tuple[str, str | None]:
    """(설명, 오류). 실패를 예외로 올리지 않는다."""
    ready = _rasterize(part, data)
    if ready is None:
        return "", "벡터(WMF) 그림을 픽셀로 바꾸지 못했습니다(LibreOffice 필요)"
    mime, data = ready
    uri = f"data:{mime};base64," + base64.b64encode(data).decode()
    resp = vlm.chat([{"role": "user", "content": [
        {"type": "text", "text": _PROMPT},
        {"type": "image_url", "image_url": {"url": uri}},
    ]}])
    if resp.error:
        return "", resp.error

    desc = " ".join((resp.text or "").split())[:_MAX_CHARS].strip()
    return (desc, None) if desc else ("", "빈 응답")
