"""LLM 클라이언트 추상화. 기본 EchoLLM은 빈 응답을 준다."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass
class Response:
    text: str
    # 호출이 실패했으면 그 이유. 검토 도구에서 "실패"와 "이상 없음"은 절대
    # 같은 값이면 안 된다 — 실패를 통과로 읽으면 놓친 결함이 조용히 사라진다.
    error: str | None = None
    # 출력 한도(max_tokens)에 닿아 답이 **중간에** 끊겼는가. 실패(error)와 따로 둔다 —
    # 끊긴 답도 앞부분이 읽히면 쓸 수 있고, 여러 호출부가 error 만 보고 버리기 때문이다.
    # 읽지 못했을 때 "응답 없음"이 아니라 "잘림"이라고 말하려고 남긴다.
    truncated: bool = False


class LLMClient(Protocol):
    def complete(self, prompt: str, **opts) -> Response: ...

    def chat(self, messages: list[dict], **opts) -> Response: ...


class EchoLLM:
    """스켈레톤 기본 클라이언트. 지적사항을 지어내지 않도록 빈 응답."""

    def complete(self, prompt: str, **opts) -> Response:
        return Response(text="")

    def chat(self, messages: list[dict], **opts) -> Response:
        # agent 루프도 여기서는 아무것도 못 하고 '판단불가'로 끝난다. 의도된 것.
        return Response(text="")
