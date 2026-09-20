# preset

팀 기준·체크리스트를 로드·파싱·저장·내보내기. 도메인 데이터는 presets/에 두고 주입.

## 공개 인터페이스
`__init__.py`에서 export하는 것만 외부에서 쓴다:

`build_items` `find_header` `guess_columns` `extract_tables` `UnsupportedChecklistFormat` · `Checklist` `ChecklistItem` `VERDICTS` · `ChecklistStore` `ChecklistError` · `to_csv`.

## 입출력 스키마
검사 Agent는 공통 Finding 스키마로 반환한다(루트 CLAUDE.md 참조). Finding·Document 등 공통 타입은 `modules.shared`.

## 의존성
- 외부 패키지: 표준 라이브러리(zipfile·xml·csv·json). PDF 표 추출 시 pdfplumber.
- 모듈 의존: `shared`.
# 파일명으로 적용 문서 구분

팀 YAML의 `outputs`는 `form_no`(양식번호 포함 여부) 외에
`filename_pattern`(정규식)을 사용할 수 있다. 서로 다른 `key`의 패턴이
동시에 맞거나 패턴이 잘못되면 식별하지 않는다. `applies_to`가 있는 기준은
식별하지 못한 문서에서 자동 실행하지 않는다. 이는 기준의 적용 대상 구분이며,
파일명 자체의 적합성을 검사하는 `items[].params.filename_pattern`과는 다르다.

단일 검토에만 사용할 분류 목록은 `single_outputs`에 둔다. 앱의 단일 문서
조립은 이 목록을 우선 사용하며, 폴더 검토는 기존 `outputs`를 유지한다.
따라서 단일 검토에서 SRS를 식별하도록 추가해도 폴더의 필수 제출물은 늘지 않는다.

`items[].requires_full_document: true`는 전체 문서 LLM 기준을 조각 검사로
대체하지 않겠다는 설정이다. 단일 검토에서 전체 입력 한도를 넘으면 해당 기준을
LLM에 보내지 않고 `unreviewed`와 길이/한도 사유를 기록한다. 기본값은 false로
기존 기준의 동작을 유지한다. 자동 판정 가능성이나 기준의 팀 승인 여부를 뜻하지 않는다.

예외적으로 `items[].evidence_terms: [신호, 입력, signal, input]`을 함께 선언하면,
단일 검토의 입력 한도 초과 시 관련 원문을 검색해 **부분 근거 대조**를 수행한다.
이 설정은 같은 식별자의 명시적 값 차이를 확인하는 기준에만 사용한다. 전체 누락
검사의 대체가 아니며, 검색 결과에서 통과·해당없음을 확정하지 않는다. 양쪽 인용과
식별자·값이 원문에 실재하는 후보만 남기고, 확인 범위 제한은 기준별로 기록한다.
