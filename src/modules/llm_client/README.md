# llm_client

LLM 호출 단일 창구. build_llm으로 provider(echo/local) 교체.

## 공개 인터페이스
`__init__.py`에서 export하는 것만 외부에서 쓴다:

`build_llm(config)` · `LLMClient` `EchoLLM` `Response` · `LocalClient`(provider별).

## 입출력 스키마
`Response(text, error=None, truncated=False)`.
- `error` — 호출이 실패했다(연결·시한·형식, 생각에 토큰을 다 써 **빈 답**). 부르는 쪽은 버린다.
- `truncated` — 답은 왔는데 `max_tokens` 에 닿아 **중간에** 끊겼다. 앞부분은 읽힐 수 있어
  error 로 만들지 않는다. 못 읽었을 때 "응답 없음"이 아니라 "잘림"이라고 말하려고 남긴다.

검사 Agent는 공통 Finding 스키마로 반환한다(루트 CLAUDE.md 참조). Finding·Document 등 공통 타입은 `modules.shared`.

## 의존성
- 외부 패키지: 없음(표준 라이브러리 urllib 만 쓴다).
- 모듈 의존: 없음(잎).

## 창구는 둘이다

| 함수 | 무엇 | 주소가 없으면 |
|---|---|---|
| `build_llm(config)` | 문서 검사용 텍스트 모델 | provider 에 따라 `EchoLLM`(빈 응답) |
| `build_vlm(config)` | 그림·다이어그램 해석용 비전 모델 | **`None`** |

엔드포인트를 나눈 이유는 서버가 두 모델을 GPU 배치까지 달리해 따로 띄우기
때문이다. 주소를 하나로 합쳐 두면 한쪽을 옮길 때 다른 쪽이 조용히 끊긴다.

`build_vlm` 이 `None` 을 주는 것은 의도된 것이다. `EchoLLM` 을 대신 주면 "붙었는데
답이 없다"와 "아예 못 붙는다"가 구분되지 않는다. 부르는 쪽은 `None` 을 보고 "그림
해석을 안 했다"를 결과에 남겨야 한다 — 조용히 건너뛰면 그림 안의 내용을 검토한
것처럼 보인다.

이미지는 `chat()` 에 OpenAI 호환 모양으로 그대로 넣는다(클라이언트 수정 불필요):

```python
vlm.chat([{"role": "user", "content": [
    {"type": "text", "text": "이 그림이 무엇을 나타내는가?"},
    {"type": "image_url", "image_url": {"url": "data:image/png;base64,..."}},
]}])
```

연동 확인은 `tests/test_live_server.py` 가 한다 — 주소를 환경변수로 주면 돌고,
없으면 스스로 skip 한다.

## 멈춤 신호 (`bind_stop`)

작업 큐가 작업 스레드 첫머리에서 `bind_stop(threading.Event)` 를 걸어 두면, 그
스레드에서 `build_llm`/`build_vlm` 으로 만든 `LocalClient` 가 그 이벤트를 물려받는다.
이벤트가 켜지면 진행 중인 호출을 기다리지 않고 `Response(error="취소됨")` 을
돌려보내고, 그 뒤의 호출은 서버에 가지도 않는다. 호출 자체는 딴 스레드에 남아
제 시한까지 돌다 버려진다(소켓은 못 끊는다 — 상한은 시한 × 동시 레인 수).
