# report

Finding → 렌더(md/json)·형광펜 PDF·엑셀·통계·진행단계.

## 공개 인터페이스
`__init__.py`에서 export하는 것만 외부에서 쓴다:

렌더 `render_markdown` `render_json` `render_rtm_markdown` `render_rtm_json` · UI `to_ui_payload` `to_ui_review_payload` `to_ui_checklist_review_payload` `render_ui_js` `render_review_ui_js` · `collect` · 진행 `review_stages` `REVIEW_STAGES` `REVIEW_DETAIL` `fmt_*` · 형광펜 `annotate` `locate` `Marked` `number_overlay` `find_font` · 산출물 `rtm_workbook` `evaluation_workbook`.

`rtm_workbook(rows, verdicts) -> bytes` — 추적성 매트릭스 xlsx(보고서 **부록 B**).
양식은 `web/brand/source/reference/추적성matrix.png` 의 네 칸 + 기계 관찰·판정·비고다.
기계 관찰과 사람 판정을 열로 나눈다 — 한 칸에 섞으면 "도구가 그렇게 판정했다"로
읽힌다. CSV 를 대신하지 않고 더한다: CSV 는 다른 도구에 넣을 때, 엑셀은 보고서에.
CSV 가 못 하던 셋을 한다 — 셀 안 줄바꿈(CSV 는 서술 첫 줄만 담고 있었다),
머리글 고정, 열 너비.

`evaluation_workbook(payload) -> bytes` — 체크리스트 검증 초안(부록 B 양식) xlsx.
입력은 체크리스트 검토 payload: `doc.name`, `items`(`EvalItem.to_dict` 목록), `rows`
(`DraftRow.to_dict` 목록 — 행마다 `status`), `unfound`, `unreviewed`, `llm_failures`,
`checklist_name`, `sheet`,
`document_kind`. 출력은 시트 두 장 — "부록 B 초안"(RVVR 부록 B 열 그대로: Classification·
Detail Characteristic·ID·Evaluation Item·Evaluation result and Comment·ANR No.·Status)과
"생성 정보"(문서·체크리스트·시트·근거 없음·검토하지 못함·그중 LLM 호출 실패 건수).
판정 칸은 항상 `제안:` 접두로 쓰고 그 아래 **코드가 확인한 절**을 `Section:` 한 줄로
싣는다(모델이 comment 안에서 든 절 번호가 아니다). ANR No.·Status 는 비운다 —
최종 판정은 검토자 몫이다. Comment 문구는 행의 `status` 하나로만 갈린다:
`drafted` → `제안: …`, `not_found` → "근거를 찾지 못함", `unreviewed` → "검토하지 못함
— <사유>". `reason` 문구를 읽어 갈래를 정하지 않는다 — "0건 통과"와 "검토를 못 했다"를
섞지 않는다는 원칙 그대로다. `status` 가 없는 옛 payload 는 `Not found` 를 미검토로 읽는다.

## 입출력 스키마
검사 Agent는 공통 Finding 스키마로 반환한다(루트 CLAUDE.md 참조). Finding·Document 등 공통 타입은 `modules.shared`.

### 원문 위치 연결

- `with_location_context(findings, sections, page_basis="unknown")`는 인용을 바꾸지 않고
  소속 절에서 유일하게 확인한 출현의 앞뒤 텍스트를 `evidence.context`에 보존한다.
  한 절 안에서도 반복되거나 본문이 없으면 문맥을 만들지 않는다. 입력은 수정하지 않는다.
- `locate`와 `annotate`는 동일한 위치 선택 규칙을 사용한다. 전체 인용을 우선 찾고,
  원문 문맥에 맞는 후보가 **하나일 때만** 표시한다. 반복 문구를 지적 순서로 배정하지 않는다.
  문맥 불일치·다중 후보는 이유와 함께 `unlocated`/`unmarked`로 반환한다.
- `page_basis`는 `pdf`/`approximate`/`unknown`. PDF의 절 시작 쪽도 근거의 정확한 쪽은
  아니므로, 별도로 검증된 `page_exact=true` 없이 페이지 힌트만으로 후보를 확정하지 않는다.
- `LOCATION_VERSION`은 위치 알고리즘의 캐시 버전이다. 앱 캐시는 PDF SHA-256과 버전,
  인용·문맥·이미지 입력을 함께 대조한다. 새 코드로 이전 좌표를 무조건 재사용하지 않는다.
- 현재 문맥 대조는 같은 PDF 페이지의 텍스트 흐름에 한정한다. 페이지를 가로지르는 인용,
  그림 내부 OCR 좌표, 자동번호 전반은 아직 별도 개선이 필요하다.
- 파싱과 위치 탐색 모두 `shared.decode_pdf_symbols`로 Wingdings의 채운 원
  글머리표만 글꼴 근거에 따라 해독한다. 일반 라틴 `l`을 지우거나 인용을 느슨하게
  바꿔 맞추지 않는다. 글머리표 포함 인용의 이동·PDF 강조를 회귀 테스트한다.
- 전체 인용이 탐색 범위에서 유일하면 그 위치를 쓴다. 파싱된 앞뒤 문맥은 표 읽기
  순서나 페이지 경계에서 PDF 흐름과 달라질 수 있어, 반복 인용을 구분할 때 사용한다.
  라벨을 제거한 축약 후보에는 이 예외를 적용하지 않는다.

합성·실문서 회귀: `pytest tests/test_location_context.py tests/test_locate.py`.
실문서가 없으면 해당 케이스만 skip한다. 검색 성공 건수는 전체 좌표 정확도 점수가 아니다.

## 의존성
- 외부 패키지: pdfplumber, pypdf, fpdf2(형광펜·요약 PDF), openpyxl(추적표 xlsx).
- 모듈 의존: `shared`(Finding 등).
