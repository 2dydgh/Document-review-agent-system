"""로컬 LLM 어댑터 — OpenAI 호환 `/v1/chat/completions`.

vLLM(사내 서버), Ollama, LM Studio가 모두 이 규격을 낸다. 그래서 Ollama 전용
`/api/chat` 대신 이쪽을 쓴다. 서버를 바꿔도 base_url/model만 고치면 된다.

의존성을 늘리지 않으려고 표준 라이브러리(urllib)만 쓴다. 호출량이 요건 수만큼
(수십~수백 회)이라 커넥션 풀링이 필요할 정도는 아니다.

**실패는 반드시 드러낸다.** 예전에는 타임아웃/서버다운을 빈 응답으로 바꿔
돌려줬는데, 체커가 그걸 "모순 없음"으로 읽어 지적사항이 조용히 사라졌다.
지금은 Response.error에 이유를 담고, 체커가 "검토되지 않음"으로 리포트한다.

사고(reasoning) 끄기:
  - vLLM: chat_template_kwargs로 꺼진다. 27B 기준 4케이스 76.8s → 1.1s (정확도 동일).
  - Ollama의 /v1: 이 옵션을 무시한다 (think/reasoning_effort/no_think 모두 무효).
    사고가 켜진 채 폭주해 타임아웃이 나기도 한다 → max_tokens와 error로 막는다.
"""
from __future__ import annotations

import json
import threading
import time
import urllib.error
import urllib.request

from .base import Response

#: 타임아웃 뒤 재시도 전 쉬는 시간(초). 부하가 빠질 틈을 준다. 길면 검토가 늘어지고
#: 짧으면 같은 벽에 다시 부딪힌다 — 근거 없이 잡은 값이라 실측되면 갱신할 것.
_RETRY_PAUSE = 3.0


class LocalLLMError(RuntimeError):
    """설정이 잘못된 경우처럼, 조용히 넘기면 안 되는 오류."""


class LocalClient:
    def __init__(self, model: str, base_url: str = "http://127.0.0.1:11434/v1",
                 timeout: float = 120.0, temperature: float = 0.0,
                 api_key: str = "", thinking: bool = False,
                 max_tokens: int = 1024,
                 stop: threading.Event | None = None) -> None:
        if not model:
            raise LocalLLMError(
                "settings.toml의 [llm] model이 비어 있습니다. "
                '예: model = "Qwen/Qwen3.6-27B"')
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        # 같은 문서를 두 번 돌리면 같은 결과가 나와야 검토 결과를 신뢰할 수 있다.
        self.temperature = temperature
        self.api_key = api_key
        self.thinking = thinking
        # 사고가 켜진 모델이 폭주해 응답 없이 끝나는 것을 막는 상한.
        self.max_tokens = max_tokens
        # 멈춤 신호(작업 큐가 건다). 켜지면 진행 중인 호출을 기다리지 않고 "취소됨"
        # 으로 돌려보낸다 — 사람이 멈추기를 누른 뒤 AI 왕복 한 번(수십 초)을 더
        # 기다리던 것이 이것 때문이었다(2026-09-04).
        self.stop = stop

    def _payload(self, messages: list[dict]) -> dict:
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": self.temperature,
            "max_tokens": self.max_tokens,
            "stream": False,
        }
        if not self.thinking:
            # vLLM은 이걸로 사고를 끈다. 모르는 서버는 무시하므로 보내도 안전하다.
            payload["chat_template_kwargs"] = {"enable_thinking": False}
        return payload

    def _headers(self) -> dict:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    def complete(self, prompt: str, **opts) -> Response:
        return self.chat([{"role": "user", "content": prompt}], **opts)

    def _send_or_stop(self, req: urllib.request.Request) -> dict:
        """멈춤 신호가 걸려 있으면 호출을 딴 스레드에 맡기고 신호를 지켜본다.

        신호가 켜지면 그 자리에서 LocalLLMError("취소됨") — 호출은 딴 스레드에
        남아 제 시한까지 돌다 버려진다. 소켓을 끊지는 못한다: urllib 은 응답이
        오기 전엔 소켓을 안 내주고, 끊어도 vLLM 이 그 계산을 바로 버린다는 보장이
        없다. 그래서 "돌려보내는 것"만 즉시다.
        # ponytail: 버려진 호출이 시한(기본 120초)까지 스레드 하나를 쥔다 — 레인 수만큼
        # 상한이라 지금은 둔다. 서버 부하가 문제 되면 http.client + select 로 소켓을 쥐고 끊는다.
        """
        stop = self.stop
        if stop is None:
            return self._send(req)
        if stop.is_set():
            raise LocalLLMError("취소됨")
        box: dict = {}

        def go() -> None:
            try:
                box["r"] = self._send(req)
            except BaseException as exc:  # noqa: BLE001 — 그대로 본 스레드로 넘긴다
                box["e"] = exc

        t = threading.Thread(target=go, name="llm-call", daemon=True)
        t.start()
        while t.is_alive():
            if stop.is_set():
                raise LocalLLMError("취소됨")
            t.join(0.2)
        if "e" in box:
            raise box["e"]
        return box["r"]

    def _send(self, req: urllib.request.Request) -> dict:
        """요청 한 번. 시한을 넘기면 **잠깐 쉬고 한 번 더** 보낸다.

        타임아웃은 대개 서버가 죽어서가 아니라 순간 부하다. 실측(2026-08-26, 27B ·
        KV 캐시 444블록): 4천 자 청크를 동시에 8개 보내면 7개가 120초를 넘기는데,
        4개면 29초에 다 온다 — 서버가 요청을 서로 밀어내며(preemption 254회) 재계산
        하는 것이다. 그 순간을 넘기면 같은 요청이 멀쩡히 온다. 한 번에 포기하면 그
        묶음의 기준 전부가 미검토로 떨어진다(실측: 31회 전부 → "표현 점검이 수행되지
        않았습니다").

        딱 한 번만, 짧게 쉬고 다시 보낸다. 여러 번 되풀이하면 부하를 더 얹어 남의
        요청까지 밀어낸다 — 이 서버는 여러 사람이 같이 쓴다. 두 번째도 넘기면
        그때는 정직하게 실패다.
        """
        for attempt in range(2):
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    return json.loads(resp.read().decode("utf-8"))
            except TimeoutError:
                if attempt == 1:
                    raise
                time.sleep(_RETRY_PAUSE)
        raise TimeoutError  # 도달하지 않는다 — 형식상

    def chat(self, messages: list[dict], **opts) -> Response:
        req = urllib.request.Request(
            f"{self.base_url}/chat/completions",
            data=json.dumps(self._payload(messages)).encode("utf-8"),
            headers=self._headers(),
            method="POST",
        )
        try:
            body = self._send_or_stop(req)
        except LocalLLMError as exc:
            return Response(text="", error=str(exc))
        except urllib.error.HTTPError as exc:
            return Response(text="", error=f"HTTP {exc.code}")
        except TimeoutError:
            return Response(text="", error=f"{self.timeout:.0f}초 안에 응답 없음")
        except urllib.error.URLError as exc:
            return Response(text="", error=f"{self.base_url} 에 연결할 수 없음 ({exc.reason})")
        except OSError as exc:
            return Response(text="", error=f"{self.base_url} 에 연결할 수 없음 ({exc})")
        except json.JSONDecodeError:
            return Response(text="", error="응답이 JSON이 아님")

        try:
            choice = body["choices"][0]
            text = choice["message"]["content"] or ""
        except (KeyError, IndexError, TypeError):
            return Response(text="", error="응답 형식이 예상과 다름")

        text = _clean(text)
        # 사고에 토큰을 다 쓰고 답을 못 낸 경우. 빈 응답으로 넘기면 "이상 없음"이 된다.
        if not text and choice.get("finish_reason") == "length":
            return Response(text="", error=f"출력 한도({self.max_tokens} 토큰) 초과")
        return Response(text=text, truncated=choice.get("finish_reason") == "length")


def _clean(text: str) -> str:
    """모델이 답 대신 내놓는 껍데기를 걷어낸다.

    - Ollama의 qwen3는 사고를 <think>...</think>로 본문에 섞는다. 남겨두면
      응답이 'ISSUE:'로 시작하지 않아 정상 지적까지 버려진다.
    - 사내 Qwen3.6은 "모순 없음"을 빈 문자열이 아니라 따옴표 두 개(`""`)로 답한다.
    """
    close = "</think>"
    if close in text:
        text = text.rsplit(close, 1)[1]
    text = text.strip()
    if text in ('""', "''", '""""'):
        return ""
    return text
