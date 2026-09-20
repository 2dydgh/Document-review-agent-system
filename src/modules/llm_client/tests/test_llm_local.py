import json
import urllib.error
from dataclasses import dataclass

import pytest

from modules.llm_client import build_llm
from modules.llm_client.local import LocalClient, LocalLLMError


@dataclass
class _Cfg:
    llm_provider: str = "local"
    llm_model: str = "qwen3:8b"
    llm_base_url: str = "http://127.0.0.1:11434/v1"
    llm_timeout: float = 5.0


class _FakeResp:
    def __init__(self, body: bytes):
        self._body = body

    def read(self) -> bytes:
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def _reply(content: str) -> bytes:
    return json.dumps({"choices": [{"message": {"content": content}}]}).encode()


@pytest.fixture
def captured(monkeypatch):
    """urlopen을 가로채 요청을 기록하고 정해진 응답을 준다."""
    box = {}

    def fake_urlopen(req, timeout=None):
        box["url"] = req.full_url
        box["timeout"] = timeout
        box["body"] = json.loads(req.data.decode())
        box["headers"] = req.headers
        return _FakeResp(box.get("reply", _reply("ISSUE: 응답시간 불일치")))

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    return box


def test_posts_openai_chat_completions(captured):
    LocalClient(model="qwen3:8b").complete("프롬프트")
    assert captured["url"] == "http://127.0.0.1:11434/v1/chat/completions"
    assert captured["body"]["model"] == "qwen3:8b"
    assert captured["body"]["messages"] == [{"role": "user", "content": "프롬프트"}]
    assert captured["body"]["stream"] is False


def test_temperature_is_zero_for_reproducible_reviews(captured):
    LocalClient(model="m").complete("x")
    assert captured["body"]["temperature"] == 0.0


def test_returns_message_content(captured):
    captured["reply"] = _reply("ISSUE: 3초 vs 5초")
    r = LocalClient(model="m").complete("x")
    assert r.text == "ISSUE: 3초 vs 5초" and r.error is None


def test_thinking_disabled_by_default(captured):
    LocalClient(model="m").complete("x")
    assert captured["body"]["chat_template_kwargs"] == {"enable_thinking": False}


def test_thinking_can_be_enabled(captured):
    LocalClient(model="m", thinking=True).complete("x")
    assert "chat_template_kwargs" not in captured["body"]


def test_api_key_becomes_bearer_header(captured):
    LocalClient(model="m", api_key="secret").complete("x")
    assert captured["headers"]["Authorization"] == "Bearer secret"


def test_no_api_key_means_no_auth_header(captured):
    LocalClient(model="m").complete("x")
    assert "Authorization" not in captured["headers"]


def test_quote_only_answer_means_no_issue(captured):
    # 사내 Qwen3.6은 "모순 없음"을 빈 문자열이 아니라 따옴표 두 개로 답한다.
    captured["reply"] = _reply('\n\n""')
    r = LocalClient(model="m").complete("x")
    assert r.text == "" and r.error is None and not r.truncated


def test_strips_reasoning_block_so_issue_prefix_survives(captured):
    # qwen3 등 추론형 모델. <think>가 남으면 체커가 'ISSUE:' 판정을 놓친다.
    captured["reply"] = _reply("<think>음... 3초와 5초는 다르다</think>\nISSUE: 응답시간 불일치")
    assert LocalClient(model="m").complete("x").text == "ISSUE: 응답시간 불일치"


def test_reasoning_block_without_issue_stays_empty_ish(captured):
    captured["reply"] = _reply("<think>고민</think>\n   ")
    assert LocalClient(model="m").complete("x").text == ""


def test_server_down_is_an_error_not_a_pass(monkeypatch):
    """서버가 죽었는데 빈 응답을 주면 체커가 '모순 없음'으로 읽는다. 반드시 error가 있어야 한다."""
    def boom(req, timeout=None):
        raise urllib.error.URLError("connection refused")

    monkeypatch.setattr("urllib.request.urlopen", boom)
    r = LocalClient(model="m").complete("x")
    assert r.text == "" and r.error and "연결" in r.error


def test_timeout_is_an_error_not_a_pass(monkeypatch):
    """실제로 겪은 사고: qwen3 사고 폭주로 240초 타임아웃 → 지적사항이 조용히 사라졌다."""
    def boom(req, timeout=None):
        raise TimeoutError()

    monkeypatch.setattr("urllib.request.urlopen", boom)
    monkeypatch.setattr("modules.llm_client.local._RETRY_PAUSE", 0.0)
    r = LocalClient(model="m", timeout=240).complete("x")
    assert r.text == "" and r.error and "240" in r.error


def test_malformed_response_is_an_error(captured):
    captured["reply"] = json.dumps({"unexpected": True}).encode()
    r = LocalClient(model="m").complete("x")
    assert r.text == "" and r.error == "응답 형식이 예상과 다름"


def test_output_cut_off_by_token_limit_is_an_error(captured):
    # 사고에 토큰을 다 쓰고 답을 못 낸 경우. 빈 응답으로 넘기면 "이상 없음"이 된다.
    captured["reply"] = json.dumps(
        {"choices": [{"message": {"content": ""}, "finish_reason": "length"}]}).encode()
    r = LocalClient(model="m", max_tokens=512).complete("x")
    assert r.error and "512" in r.error


def test_answer_cut_mid_way_keeps_text_and_says_truncated(captured):
    """글자는 왔는데 한도에서 끊긴 답. 앞부분은 쓸 수 있으니 error 로 버리지 않고,
    못 읽었을 때 "잘림"이라고 말할 수 있게 표시만 단다."""
    captured["reply"] = json.dumps(
        {"choices": [{"message": {"content": '{"results": [{"no": "4"'},
                      "finish_reason": "length"}]}).encode()
    r = LocalClient(model="m").complete("x")
    assert r.text == '{"results": [{"no": "4"' and r.error is None and r.truncated


def test_normal_empty_answer_is_not_an_error(captured):
    # 모순이 없어서 빈 문자열을 답한 정상 케이스. 이건 error가 아니다.
    captured["reply"] = json.dumps(
        {"choices": [{"message": {"content": ""}, "finish_reason": "stop"}]}).encode()
    r = LocalClient(model="m").complete("x")
    assert r.text == "" and r.error is None


def test_http_error_is_reported(monkeypatch):
    def boom(req, timeout=None):
        raise urllib.error.HTTPError(req.full_url, 503, "unavailable", {}, None)

    monkeypatch.setattr("urllib.request.urlopen", boom)
    r = LocalClient(model="m").complete("x")
    assert r.error == "HTTP 503"


def test_empty_model_is_a_loud_error_not_silent():
    with pytest.raises(LocalLLMError, match="model"):
        LocalClient(model="")


def test_base_url_trailing_slash_is_normalized(captured):
    LocalClient(model="m", base_url="http://host:1234/v1/").complete("x")
    assert captured["url"] == "http://host:1234/v1/chat/completions"


def test_build_llm_wires_config_through(captured):
    llm = build_llm(_Cfg(llm_base_url="http://box:9999/v1", llm_timeout=7.0))
    llm.complete("x")
    assert captured["url"] == "http://box:9999/v1/chat/completions"
    assert captured["timeout"] == 7.0


def test_build_llm_unknown_provider_raises():
    with pytest.raises(ValueError, match="provider"):
        build_llm(_Cfg(llm_provider="mystery"))


def test_local_chat_sends_message_history(captured):
    """chat은 messages를 그대로 실어 보낸다 (complete는 1턴으로 감싼 것)."""
    captured["reply"] = _reply("OK")
    resp = LocalClient(model="m").chat([
        {"role": "user", "content": "첫 질문"},
        {"role": "assistant", "content": '{"tool":"get_section"}'},
        {"role": "user", "content": "도구 결과"},
    ])

    assert resp.text == "OK"
    assert len(captured["body"]["messages"]) == 3
    assert captured["body"]["messages"][1]["role"] == "assistant"
    # 사고 끄기는 다중 턴에서도 유지된다 (27B 기준 76.8s → 1.1s)
    assert captured["body"]["chat_template_kwargs"] == {"enable_thinking": False}


def test_timeout_once_then_success_is_not_an_error(monkeypatch):
    """타임아웃은 대개 순간 부하다(실측: 동시 8개 중 7개가 120초를 넘기고, 4개면 29초).
    한 번에 포기하면 그 묶음의 기준 전부가 미검토가 된다 — 한 번은 다시 보낸다."""
    import io
    calls = []

    def flaky(req, timeout=None):
        calls.append(1)
        if len(calls) == 1:
            raise TimeoutError()
        body = {"choices": [{"message": {"content": "ISSUE: 답"}}]}
        return io.BytesIO(json.dumps(body).encode())

    monkeypatch.setattr("urllib.request.urlopen", flaky)
    monkeypatch.setattr("modules.llm_client.local._RETRY_PAUSE", 0.0)
    r = LocalClient(model="m").complete("x")
    assert len(calls) == 2
    assert r.error is None and "답" in r.text


def test_timeout_twice_gives_up_honestly(monkeypatch):
    """두 번째도 넘기면 더 되풀이하지 않는다 — 여러 사람이 쓰는 서버에 부하를 더 얹는다."""
    calls = []

    def boom(req, timeout=None):
        calls.append(1)
        raise TimeoutError()

    monkeypatch.setattr("urllib.request.urlopen", boom)
    monkeypatch.setattr("modules.llm_client.local._RETRY_PAUSE", 0.0)
    r = LocalClient(model="m").complete("x")
    assert len(calls) == 2
    assert r.text == "" and r.error and "응답 없음" in r.error


def test_stop_signal_returns_immediately_without_waiting_for_the_call(monkeypatch):
    """멈춤 신호가 켜지면 진행 중인 호출(수십 초)을 기다리지 않고 바로 '취소됨'이다.
    호출은 딴 스레드에 남아 제 시한까지 돌다 버려진다."""
    import threading
    import time as _t

    from modules.llm_client.local import LocalClient

    def slow_urlopen(req, timeout=None):
        _t.sleep(3.0)
        return _FakeResp(_reply("늦은 답"))

    monkeypatch.setattr("urllib.request.urlopen", slow_urlopen)
    stop = threading.Event()
    c = LocalClient(model="m", stop=stop)
    threading.Timer(0.1, stop.set).start()
    t0 = _t.monotonic()
    r = c.chat([{"role": "user", "content": "x"}])
    assert _t.monotonic() - t0 < 1.5
    assert r.error == "취소됨" and r.text == ""
    # 이미 켜진 뒤의 호출은 서버에 가지도 않는다.
    t1 = _t.monotonic()
    assert c.chat([{"role": "user", "content": "y"}]).error == "취소됨"
    assert _t.monotonic() - t1 < 0.5
