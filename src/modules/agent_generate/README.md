# agent_generate

> **여기서 `agent` 는 AI 에이전트가 아니다.** 요구사항 문서가 정한 **검토 담당 영역** 이름이다.

작성·생성 지원. 지금은 하나 — **평가 체크리스트 → 부록 B 평가표 초안**.
CLAUDE.md 의 생성 계열: Finding 이 아니라 산출물(행 목록) + 메타를 돌려준다.

## 공개 인터페이스
`read_eval_items(rows, document="") -> list[EvalItem]` — 시트 행 목록(헤더 포함)을 항목으로.
열은 헤더 낱말로 찾는다(`ID`·`Evaluation Item` 필수, `Characteristic|Classification`,
`Detail Characteristic`, `평가 항목|아이템`, `평가 관점`, `Documents` 선택). 없으면 `EvalSheetError`.
`sheet_documents(rows)` — `Documents` 열 값들(A 계열 시트).
`draft_evaluation(doc, items, llm, *, on_progress=None, concurrency=4) -> EvaluationDraft`
— 항목마다 떠올리기(LLM) → 찾기(코드) → 확인(LLM) → 인용 대조(코드).
`EvaluationDraft(rows: list[DraftRow], unfound, llm_failures, unreviewed, notes)`,
`DraftRow(item_id, verdict_hint ∈ VERDICTS, status, comment, sections, quotes, reason, words)`.

`status` 는 **우리가 무엇을 했는지**다(`verdict_hint` 는 모델의 제안이다). 셋뿐이다:
`DRAFTED`(`"drafted"`) 근거를 확인해 초안을 썼다 · `NOT_FOUND_STATUS`(`"not_found"`)
문서를 찾아봤고 받쳐 주는 것이 없었다 · `UNREVIEWED`(`"unreviewed"`) 쓸 만한 일이
아무것도 없었다(LLM 호출 실패·응답 불명·판정 불명·주장 폐기).
집계는 `unfound`(not_found 수) · `unreviewed`(unreviewed 수) · `llm_failures`
(unreviewed 중 호출 실패, 부분집합) 셋이고 `notes` 가 같은 말을 문장으로 낸다.
**소비자는 `status` 와 이 수들만 본다 — `reason` 은 사람 읽을 설명이지 분기 기준이 아니다.**

## 환각 계약
인용은 `verify_quotes` 로 문서와 문자열 대조하고, 절 id 는 모델에게 보여준 절 안에서만
받는다. 하나라도 비면 모델 문장은 버린다 — 그 행은 `status="unreviewed"` 다(문서에 근거가
없다는 뜻이 아니라 **모델 주장을 폐기했다**는 뜻이다). 버린 건수는 `unreviewed` 로
드러난다. 문서를 실제로 찾아봤고 없었던 것만 `unfound` 다 — 둘을 섞지 않는다.
판정은 제안이다 — 조립 계층이 "제안:" 을 붙이고 최종은 검토자가 정한다.

## 의존성
stdlib + `modules.shared`(DocTools, verify_quotes, _parse). LLM 은 `.complete(prompt)` 를
가진 무엇이든 된다(`modules.llm_client`).
