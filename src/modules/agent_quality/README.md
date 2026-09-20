# agent_quality

> **여기서 `agent` 는 AI 에이전트가 아니다.** 요구사항 문서가 정한 **검토 담당 영역** 이름이다. 모델이 스스로 도구를 부르는 루프는 `shared/agent/` 에 있고, 그 루프를 쓰는 곳은 각 파일 머리에 적혀 있다.

표현·내용 품질 검사 (LLM). 모호·모순 일관성.

## 공개 인터페이스
`__init__.py`에서 export하는 것만 외부에서 쓴다:

`ChunkCriteriaChecker`, `WholeDocCriteriaChecker`, `EvidenceCriteriaChecker`,
`select_evidence(doc, terms, max_chars)`, `SectionCriteriaChecker`,
`select_sections(doc, patterns)`.

## 장절 한정 검사

`SectionCriteriaChecker(criteria, max_chars=120000)`은 기준의 `sections`(장절 제목
정규식 목록)에 맞는 장절만 모델에 보낸다. 개정기록·목차·3.0 참조문서처럼 한 부분만
보는 기준이 문서 전체 길이 때문에 미검토로 떨어지지 않게 한다.

- 고르는 것은 코드다(`select_sections`). 제목이 있는 장절은 제목, 제목 없는 쪽
  (level 0)은 쪽 이름("1쪽")과 앞 세 줄을 대조한다. 맞은 장절은 하위 장절까지 싣는다.
- 장절을 자르지 않고 한도 안에서 순서대로 묶어 여러 번 묻는다. 장절 하나가 한도를
  넘으면 그 기준은 미판정이다.
- 못 찾으면: 문서 전체가 한도 안이면 전체를 보고, 넘으면 찾아본 패턴을 적어 미판정.
- 무엇을 보고 판정했는지는 기준별 `notes` 에 남는다.

## 긴 문서의 제한된 근거 대조

`EvidenceCriteriaChecker(criteria, max_chars=32000)`은 기준의 `evidence_terms`로
문서 전체를 검색하고, 검색어와 앞·뒤 위치를 번갈아 제한된 원문 구간을 선택한다.
검색된 구간을 함께 제공해 멀리 떨어진 원문을 대조한다. 검색은 로컬 문자열 탐색이며
외부 검색/임베딩 API를 사용하지 않는다. 원문을 요약하지 않고 실제 위치를 유지한다.
현재 여러 기준을 받으면 검색어를 합쳐 동일한 근거 묶음을 기준마다 1회 질의한다.

- 입력 길이는 선택 구간 사이의 구분자를 포함해 `max_chars` 이하이다(프롬프트 안내 제외).
- 전체 통과·해당없음·누락 판정은 받지 않는다. 원문 두 곳의 동일 식별자와 서로 다른
  명시적 값을 제시한 `모순` 후보만 인용 대조 후 반환한다.
- 동일 조건·속성인지에 대한 의미 판단은 여전히 LLM 판단이며, 문자열 대조가
  내용의 정확성을 보장하지는 않는다. 사용자가 원문 양쪽을 확인해야 한다.
- 인용이 발췌와 원문 양쪽에 없거나, 한쪽 근거가 없으면 지적을 제외하고 INFO로 알린다.
- 검색어 미일치·입력 제한은 기준별 `notes`와 `unreviewed` INFO에 기록한다.
  지적이 있어도 나머지 범위를 모두 확인한 것은 아니다.
- 규칙마다 값 비교를 지원한다는 명시적 설정이 있을 때만 라우팅한다. 내용 존재 여부,
  발행 승인, 다른 문서/외부 표준과의 일치는 이 방식으로 검사하지 않는다.

## 입출력 스키마
검사 Agent는 공통 Finding 스키마로 반환한다(루트 CLAUDE.md 참조). Finding·Document 등 공통 타입은 `modules.shared`.

## 인용 구조(rescue)

원문 대조에 실패한 지적 후보는 즉시 버리지 않고, 검색 도구(`find_term`)를 쥔
LLM 재질의(후보당 최대 2회)로 실재 근거를 다시 대게 한다(`rescue.py`). 판정은
그대로 `verify_quotes` 가 내린다 — 재인용도 대조에 실패하면 그때 버린다.
복원·제외 건수는 INFO 로 드러난다. 상한은 `Context.rescue_max`(직접 만들면
기본 0 = 끔)이고 **검사기 하나당** 상한이다 — 조각 단위 `ChunkCriteriaChecker`
와 문서 전체 단위 `WholeDocCriteriaChecker`가 각자 쓴다. DocSuree 배포 기본값 10은
`Config.llm_rescue_max`(`settings.toml`의 `[llm] rescue_max`)가 채운다. 0이면
예전처럼 즉시 폐기한다.

## 의존성
- 외부 패키지: 없음(표준 라이브러리).
- 모듈 의존: `shared`(Checker·Context·verify_quotes 등).
