# app

DocSuree 조립 계층. 모듈들의 **공개 인터페이스로만** 조립한다 — 모듈은 DocSuree를
몰라야 하고, 팀명·문서명·규칙값 하드코딩은 여기가 아니라 presets/에 있다.

## 구성
- `server.py` — FastAPI 웹/API (정적 자산은 `web/`, 영속 데이터는
  `DOCSUREE_DATA_DIR` 또는 기본 `.docreview/`)
- `cli.py` — `docsuree` 엔트리포인트 (`app.cli:main`). `accounts list|role|delete`
  는 관리자 화면이 생기기 전까지 계정을 보고 고치는 길이다.
- `orchestrator.py` — 검토 파이프라인 조립 (load_document→normalize→chunk→체커→report)
- `registry.py` — agent 모듈 체커 등록
- `config.py` — settings.toml + 체크리스트 YAML → Config (스키마는 modules.shared)
- `db.py` — SQLite 연결·스키마 두 벌(`AUTH_SCHEMA`·`HISTORY_SCHEMA`). 왜 파일이
  아닌지, 왜 지적을 행으로 펼치는지가 여기 적혀 있다.
- `history.py` — 검토 이력 저장 (기록마다 `owner` = 검토를 돌린 계정). 목록은 **같은 팀끼리** 공유하고
  관리자는 전부 본다 — 누구까지인지는 `server._visible_owners` 가 계정 표를 보고 정한다. 사람이 누른
  판정(직접 확인·반영 확인·추적표)은 `*ConfirmedBy` 로 누가 눌렀는지 남긴다.
  결과는 `history/index.db` 의 `review`(payload JSON 통째로) + `finding`
  (지적을 행으로 펼친 조회용 — 심각도·검사기·문서별 집계가 SQL 로 된다.
  `review` 를 지우면 CASCADE 로 함께 사라진다). 뷰어용 원본 문서만 파일
  (`history/originals/`).
- `auth.py` — 계정·세션 (id/pw + 소속 팀, scrypt 해시, HttpOnly 쿠키 세션). `auth.db`.
  누가 무엇을 검토했는지를 가르는 최소형이지 API 방벽이 아니다 — 사내망 전제.

## 의존성
- 외부 패키지: fastapi, uvicorn, python-multipart, pyyaml.
- 모듈 의존: `doc_parser` `llm_client` `preset` `report` `agent_format` `agent_quality`
  `agent_trace` `agent_checklist` `shared` — 전부 공개 인터페이스로만.
