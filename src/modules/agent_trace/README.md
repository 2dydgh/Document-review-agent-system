# agent_trace

> **여기서 `agent` 는 AI 에이전트가 아니다.** 요구사항 문서가 정한 **검토 담당 영역** 이름이다. 모델이 스스로 도구를 부르는 루프는 `shared/agent/` 에 있고, 그 루프를 쓰는 곳은 각 파일 머리에 적혀 있다.

정합성·추적성 검사. 추적성·내용일치·RTM.

## 공개 인터페이스
`__init__.py`에서 export하는 것만 외부에서 쓴다:

`TraceabilityChecker` `ContentMatchChecker` · `extract_id_anchors` `extract_id_statements` `excluded_ids` `build_rtm` `probe_missing` ·
`judge_missing` `judge_missing_rows` `apply_judgments` `Judgment` · `HAS_DESIGN` `NO_DESIGN` `UNKNOWN`.

`probe_missing(requirement_text, child_doc)` — 누락 요건이 하위 문서 **어디쯤**에
있을지 짚는다. `build_rtm` 의 "누락"은 ID 문자열이 없다는 말일 뿐이라, 검토자는
설계가 아예 없는 것인지 ID 만 안 적힌 것인지 가르려고 문서를 열어 뒤져야 했다.
낱말 겹침으로 가장 닮은 절을 최대 셋 골라 준다 — LLM 을 쓰지 않고, 후보는 하위
문서에 **실재하는 절**이라 지어낼 자리가 없다. 없으면 빈 목록이고 그 자체가
"비슷한 내용이 없다"는 답이다. 판정은 사람이 한다.

`judge_missing(upper_id, requirement, hits, child, llm, hint="")` — 누락 요건이
하위 문서에 **번호 없이** 있는지 찾는다. 모델이 설계서가 쓸 법한 말을 떠올리고
(요건에 이미 있는 말은 버린다 — probe 가 본 것이다), 그 말을 **코드가** 찾고,
걸린 절과 probe 후보를 모델이 읽어 설계있음/없음/확인못함을 낸다. 설계있음은
하위 원문 인용이 문자열 대조를 통과해야 한다. `hint` 는 검토자가 준 말이고
떠올린 말 앞에 선다. **라벨은 바꾸지 않는다** — `apply_judgments` 는 못 본
건수만 INFO 로 남기고, 결과(`Judgment.to_dict()`)는 화면이 요건 옆에 문장으로
보여준다. 예전엔 모델에게 검색 도구를 쥐여 주고 다음 낱말을 고르게 했는데
실측(PRJX, Qwen 27B)에서 거의 전부 요건 낱말만 골라 헛돌았다.

## 검사 매개변수 (기준이 정한다 — 코드에 값이 없다)
`params.*` 에 적힌 값이 `ReviewConfig` 를 거쳐 여기로 온다(`app/config.apply_criteria_params`).

| 키 | 뜻 |
|---|---|
| `id_pattern` | 요건 ID 정규식. 비면 추적성·내용대조를 아예 하지 않는다(그 사실을 INFO 로 밝힌다) |
| `scope_pattern` | 하위문서가 책임지는 상위 요건 범위. 비면 전부 범위 안 |
| `id_rollup_separator` | 하위요건 ID(`FR-CCG_01_01`)를 부모(`FR-CCG_01`)로 한 단계 접어 대조 |
| `id_example_words` | **예시 표기 낱말.** 이 낱말이 있는 줄(표는 한 행이 한 줄)의 ID 는 요건으로 세지 않는다 |

`id_example_words` 는 문서 앞머리의 "식별자 사례" 표(`| 식별자 사례 | SRS-RQ-001 |`)
때문에 있다. 형식 설명일 뿐인 그 ID 가 "하위문서에 누락"(MAJOR)이 되고 추적표에
행까지 만들었다(2026-09-14 QA 지적). 뺀 건수는 조용히 사라지지 않는다 —
`excluded_ids` 가 돌려주고 조립 계층이 INFO 한 건으로 적는다
("예시 표기 근처의 ID n건은 요건으로 세지 않았습니다"). 빈 목록이면 끈다.

## 입출력 스키마
검사 Agent는 공통 Finding 스키마로 반환한다(루트 CLAUDE.md 참조). Finding·Document 등 공통 타입은 `modules.shared`.

## 의존성
- 외부 패키지: 없음(표준 라이브러리).
- 모듈 의존: `shared`(Checker·Document·RtmRow).
