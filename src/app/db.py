"""SQLite 연결과 스키마 — 계정·세션·검토 이력이 함께 쓴다.

JSON 파일 저장을 대체한다. 옮긴 이유는 셋이고, 전부 파일로는 못 고치는 것이다.

1. **계정이 조용히 사라졌다.** accounts.json 은 통째로 읽어 통째로 다시 썼다.
   프로세스 안 Lock 이 지켰지만 락은 프로세스 밖으로 못 나간다 — uvicorn 을
   워커 2개로 띄우는 순간 나중에 쓴 쪽이 앞의 가입을 덮고, 에러도 로그도 안
   남는다. 여기서는 쓰기가 전부 **문장 하나**라(읽고-고쳐-쓰기 없음) 겹쳐도
   덮이지 않는다.
2. **목록이 결과를 통째로 파싱했다.** 이력 20건의 제목·날짜만 필요한데 파일
   수백 개를 열어 payload 까지 json.loads 했다. 이제 인덱스로 20행만 읽는다.
3. **보관 기간 삭제를 못 했다.** 파일 이름 정렬로는 "개수 초과분"만 지울 수
   있었다. `WHERE at < ?` 가 가능해진다.

검토 결과(payload)는 여기 넣고, 원본 문서(PDF·한글 파일)는 파일로 남긴다 —
중앙값 1.5MB 짜리 바이너리는 DB 에 넣을 것이 아니고, 그건 지금도 개수·용량
상한으로 따로 관리된다.
"""
from __future__ import annotations

import re
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

#: 쓰기가 겹쳤을 때 기다릴 시간(초). WAL 이라 읽기는 안 막히고 쓰기만 줄을 선다.
BUSY_TIMEOUT = 10.0

#: 계정·세션. `auth.db` 가 가진다.
AUTH_SCHEMA = """
CREATE TABLE IF NOT EXISTS account (
  email      TEXT PRIMARY KEY,
  salt       TEXT NOT NULL,
  hash       TEXT NOT NULL,
  name       TEXT NOT NULL DEFAULT '',
  dept       TEXT NOT NULL DEFAULT '',
  team       TEXT NOT NULL DEFAULT '',
  role       TEXT NOT NULL DEFAULT 'user',
  created_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS session (
  token_hash TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  expires    REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS session_email   ON session(email);
CREATE INDEX IF NOT EXISTS session_expires ON session(expires);
"""

#: 검토 이력. `history/index.db` 가 가진다.
#:
#: review.id 는 앞이 시각이라 `ORDER BY id DESC` 가 곧 최신순이다(파일 이름
#: 역순으로 정렬하던 것과 같은 규칙). 그래서 at 에 인덱스를 또 두지 않는다.
#:
#: finding 은 payload 안 JSON 을 **행으로도** 펼친 것이다. payload 한 칸에
#: 들어 있으면 SQL 이 세지도 찾지도 못한다 — 심각도별 집계, 검사기별 집계,
#: 문서를 가로지르는 조회(Lv3)가 전부 막힌다. payload 는 그대로 두고 옆에
#: 둔다(화면·API 가 그 모양을 알고 있다). 어긋나지 않게 **한 트랜잭션에서**
#: 같이 쓰고, review 를 지우면 ON DELETE CASCADE 로 함께 사라진다.
#:
#: kind 한 칸에 단일 검토의 `kind`(표기·모순·모호)와 비교의 `type`
#: (missing·extra·mismatch)을 같이 담는다 — 둘 다 "무엇이 잘못됐나"를 답하고
#: (CLAUDE.md), 실제 값이 겹치지 않는다.
#:
#: 지적 전체가 아니라 **찾는 데 쓰는 칸만** 옮긴다. evidence(인용 목록)처럼
#: 구조가 있는 것은 payload 가 원본이고, seq 로 되짚어 간다.
HISTORY_SCHEMA = """
CREATE TABLE IF NOT EXISTS review (
  id       TEXT PRIMARY KEY,
  kind     TEXT NOT NULL,
  at       TEXT NOT NULL,
  title    TEXT NOT NULL DEFAULT '',
  owner    TEXT NOT NULL DEFAULT '',
  findings INTEGER NOT NULL DEFAULT 0,
  payload  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS review_owner ON review(owner, id DESC);

CREATE TABLE IF NOT EXISTS finding (
  review_id  TEXT NOT NULL REFERENCES review(id) ON DELETE CASCADE,
  seq        INTEGER NOT NULL,          -- payload.findings 안 자리. 원본으로 돌아가는 길
  finding_id TEXT NOT NULL DEFAULT '',
  sev        TEXT NOT NULL DEFAULT '',  -- major | minor | info
  kind       TEXT NOT NULL DEFAULT '',
  checker    TEXT NOT NULL DEFAULT '',
  section    TEXT NOT NULL DEFAULT '',
  page       INTEGER,                   -- 없을 수 있다(문서 전체 지적)
  document   TEXT NOT NULL DEFAULT '',  -- 산출물 세트 검토의 대상 문서
  unreviewed INTEGER NOT NULL DEFAULT 0,
  message    TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (review_id, seq)
);
CREATE INDEX IF NOT EXISTS finding_sev      ON finding(sev);
CREATE INDEX IF NOT EXISTS finding_checker  ON finding(checker);
CREATE INDEX IF NOT EXISTS finding_document ON finding(document);
"""

_TABLE_RE = re.compile(r"CREATE TABLE IF NOT EXISTS (\w+)")

#: 이 모듈이 관리하는 표 전부. 아래 청소가 손댈 수 있는 범위를 여기로 묶는다 —
#: 모르는 표는 누가 손으로 만든 것일 수 있으니 건드리지 않는다.
_KNOWN = set(_TABLE_RE.findall(AUTH_SCHEMA)) | set(_TABLE_RE.findall(HISTORY_SCHEMA))


@contextmanager
def connect(path: str | Path, *, immediate: bool = False) -> Iterator[sqlite3.Connection]:
    """연결 하나를 열고 블록이 끝나면 커밋(예외면 롤백)하고 닫는다.

    요청마다 새로 연다. SQLite 연결은 파일 핸들 하나라 값이 싸고, 이렇게 하면
    스레드 간 공유를 아예 안 하게 돼 check_same_thread 문제가 사라진다.

    immediate 는 **읽고-고쳐-쓰기** 에만 쓴다. 기본(deferred)으로 두면 두 요청이
    같은 행을 읽은 뒤 둘 다 쓰려다 하나가 잠금 승격에 실패한다. 미리 쓰기 잠금을
    잡으면 뒤엣것이 기다렸다가 **앞의 결과를 보고** 고친다.
    """
    con = sqlite3.connect(path, timeout=BUSY_TIMEOUT)
    con.row_factory = sqlite3.Row
    # WAL: 읽기가 쓰기를 안 기다린다. 파일에 남는 설정이라 두 번째부터는 확인만 한다.
    con.execute("PRAGMA journal_mode=WAL")
    # 외래키는 SQLite 가 기본으로 **꺼 놓는다**. 연결마다 켜야 REFERENCES 가
    # 실제로 지켜지고 ON DELETE CASCADE 가 동작한다(끄면 조용히 무시된다).
    con.execute("PRAGMA foreign_keys=ON")
    try:
        if immediate:
            con.execute("BEGIN IMMEDIATE")
        with con:
            yield con
    finally:
        con.close()


def init(path: str | Path, schema: str) -> Path:
    """DB 파일과 그 DB 의 표를 만든다(이미 있으면 그대로). 저장소 생성 때 한 번.

    schema 는 AUTH_SCHEMA 또는 HISTORY_SCHEMA — 어느 DB 인지 부르는 쪽이 정한다.
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with connect(path) as con:
        con.executescript(schema)
        _drop_stray_empty_tables(con, schema)
    return path


def _drop_stray_empty_tables(con: sqlite3.Connection, schema: str) -> None:
    """이 DB 것이 아닌 표가 비어 있으면 지운다.

    처음에는 두 DB 에 스키마를 한 덩어리로 실행해서, 이력 DB 안에도 계정 표가
    (그 반대도) 만들어졌다. 비어 있어 동작에는 영향이 없지만 계정 표가 두 군데
    있는 것처럼 보여, 나중에 누가 빈 쪽을 열고 "계정이 없다"고 판단한다.

    **행이 하나라도 있으면 건드리지 않는다** — 그때는 코드가 아니라 사람이
    봐야 하는 상황이다. 모르는 이름의 표도 그대로 둔다.
    """
    mine = set(_TABLE_RE.findall(schema))
    rows = con.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    for (name,) in rows:
        if name in mine or name not in _KNOWN:
            continue
        if con.execute(f"SELECT COUNT(*) FROM {name}").fetchone()[0] == 0:
            con.execute(f"DROP TABLE {name}")
