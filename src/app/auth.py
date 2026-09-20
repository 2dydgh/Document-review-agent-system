"""계정·세션 저장소 — 자체 최소형 로그인(id/pw + 소속 팀, 일반/관리자 2등급).

예전 로그인은 브라우저 localStorage 에 계정이 있었다 — 브라우저를 지우면 계정이
사라지고, 다른 PC 에선 로그인이 안 되고, 아무나 개발자 도구로 계정을 위조할 수
있었다. 계정은 서버가 가진다.

그 다음 자리는 JSON 파일이었다. 파일 하나를 통째로 읽어 통째로 다시 쓰는 방식은
프로세스가 하나일 때만 맞았다 — 워커를 늘리면 가입이 조용히 사라진다. 지금은
SQLite 다(`app.db`). 쓰기를 전부 **문장 하나**로 만들어 읽고-고쳐-쓰기를 없앴다:
가입은 INSERT 의 PRIMARY KEY 충돌로 중복을 막고, 수정은 COALESCE 로 한 번에
바꾼다. 그래서 파이썬 Lock 이 필요 없다 — 잠금은 DB 가 진다.

비밀번호는 stdlib scrypt 로 해시한다(평문·복호화 가능한 저장 금지). 세션 토큰은
원문이 아니라 sha256 해시로 저장한다 — 세션 표가 새어도 토큰을 재사용 못 하게.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import re
import secrets
import sqlite3
import time
from pathlib import Path

from . import db

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
MIN_PASSWORD_LEN = 8
SESSION_TTL = 30 * 86400        # 30일. 사내 도구 — 매일 로그인시키지 않는다.

# scrypt 파라미터. n=2**14 는 로그인 한 번에 수십 ms — 50명 규모에 충분히 느리다.
_SCRYPT = {"n": 2 ** 14, "r": 8, "p": 1}

#: 계정·세션이 같이 쓰는 파일 이름. 검토 이력은 별개 DB 다(`history/index.db`) —
#: 둘 사이에 한 트랜잭션으로 묶을 일이 없어 굳이 한 파일에 넣지 않는다.
DB_NAME = "auth.db"


class AuthError(Exception):
    """가입·로그인 입력이 규칙에 안 맞는다. 메시지는 화면에 그대로 보여줄 한국어다."""


def _hash_pw(password: str, salt: bytes) -> bytes:
    return hashlib.scrypt(password.encode("utf-8"), salt=salt, **_SCRYPT)


def _db_path(root: str | Path) -> Path:
    """DB 를 만들고, 예전 JSON 이 있으면 한 번만 옮겨 담는다."""
    path = db.init(Path(root) / DB_NAME, db.AUTH_SCHEMA)
    _migrate_json(path, Path(root))
    return path


def _load_json(path: Path) -> dict:
    try:
        loaded = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return loaded if isinstance(loaded, dict) else {}


def _migrate_json(path: Path, root: Path) -> None:
    """accounts.json · sessions.json 을 표로 옮긴다. 표가 비어 있을 때만 한다.

    옮긴 뒤에도 원본 JSON 은 지우지 않는다 — 되돌릴 자리를 남겨 둔다. 두 번째
    실행부터는 표에 행이 있어 아무 일도 안 한다.
    """
    with db.connect(path, immediate=True) as con:
        if not con.execute("SELECT 1 FROM account LIMIT 1").fetchone():
            for email, a in _load_json(root / "accounts.json").items():
                if not isinstance(a, dict) or not a.get("hash"):
                    continue
                con.execute(
                    "INSERT OR IGNORE INTO account"
                    " (email, salt, hash, name, dept, team, role, created_at)"
                    " VALUES (?,?,?,?,?,?,?,?)",
                    (email, a.get("salt", ""), a["hash"], a.get("name") or "",
                     a.get("dept") or "", a.get("team") or "",
                     a.get("role") or "user", int(a.get("created_at") or 0)))
        if not con.execute("SELECT 1 FROM session LIMIT 1").fetchone():
            for key, s in _load_json(root / "sessions.json").items():
                if not isinstance(s, dict) or not s.get("email"):
                    continue
                con.execute(
                    "INSERT OR IGNORE INTO session (token_hash, email, expires)"
                    " VALUES (?,?,?)",
                    (key, s["email"], float(s.get("expires") or 0)))


class AccountStore:
    """account 표 — 이메일 → 계정. 공개 dict 에 비밀번호 해시는 안 나간다."""

    def __init__(self, root: str | Path) -> None:
        self._db = _db_path(root)

    @staticmethod
    def _public(email: str, row) -> dict:
        return {"email": email, "name": row["name"] or "",
                "dept": row["dept"] or "", "team": row["team"] or "",
                "role": row["role"] or "user",
                "created_at": int(row["created_at"] or 0)}

    def create(self, email: str, password: str, name: str = "",
               dept: str = "", team: str = "") -> dict:
        email = (email or "").strip().lower()
        if not _EMAIL_RE.match(email):
            raise AuthError("이메일 형식이 올바르지 않습니다.")
        if len(password or "") < MIN_PASSWORD_LEN:
            raise AuthError(f"비밀번호는 {MIN_PASSWORD_LEN}자 이상이어야 합니다.")
        salt = secrets.token_bytes(16)
        try:
            with db.connect(self._db) as con:
                # "있나 보고 없으면 넣기" 가 아니라 넣어 보고 부딪히면 안다 —
                # 그 사이에 남이 같은 이메일로 가입할 틈이 없다.
                con.execute(
                    "INSERT INTO account"
                    " (email, salt, hash, name, dept, team, role, created_at)"
                    # 권한 2등급(방침). 승격은 `docsuree accounts role` 로 한다.
                    " VALUES (?,?,?,?,?,?,'user',?)",
                    (email, salt.hex(), _hash_pw(password, salt).hex(),
                     (name or "").strip()[:50], (dept or "").strip()[:50],
                     (team or "").strip()[:50], int(time.time())))
        except sqlite3.IntegrityError:
            raise AuthError("이미 가입된 이메일입니다. 로그인해 주세요.") from None
        got = self.get(email)
        assert got is not None
        return got

    def _row(self, email: str):
        with db.connect(self._db) as con:
            return con.execute("SELECT * FROM account WHERE email=?",
                               (email,)).fetchone()

    def verify(self, email: str, password: str) -> dict | None:
        """맞으면 공개 계정 dict, 틀리면 None. 없는 계정과 틀린 비밀번호를
        구분해 말하지 않는다 — 가입 여부가 새는 것도 정보다."""
        email = (email or "").strip().lower()
        row = self._row(email)
        if row is None:
            return None
        try:
            expect = bytes.fromhex(row["hash"])
            got = _hash_pw(password or "", bytes.fromhex(row["salt"]))
        except ValueError:
            return None
        return self._public(email, row) if hmac.compare_digest(expect, got) else None

    def get(self, email: str) -> dict | None:
        email = (email or "").strip().lower()
        row = self._row(email)
        return self._public(email, row) if row is not None else None

    def list(self) -> list[dict]:
        """가입 순서대로 공개 계정 목록. 관리자 화면·CLI 가 쓴다."""
        with db.connect(self._db) as con:
            rows = con.execute(
                "SELECT * FROM account ORDER BY created_at, email").fetchall()
        return [self._public(r["email"], r) for r in rows]

    def set_role(self, email: str, role: str) -> dict:
        if role not in ("user", "admin"):
            raise AuthError(f"알 수 없는 권한: {role}")
        email = (email or "").strip().lower()
        with db.connect(self._db) as con:
            changed = con.execute("UPDATE account SET role=? WHERE email=?",
                                  (role, email)).rowcount
        if not changed:
            raise AuthError("계정을 찾을 수 없습니다.")
        got = self.get(email)
        assert got is not None
        return got

    def delete(self, email: str) -> None:
        email = (email or "").strip().lower()
        with db.connect(self._db) as con:
            changed = con.execute("DELETE FROM account WHERE email=?",
                                  (email,)).rowcount
        if not changed:
            raise AuthError("계정을 찾을 수 없습니다.")

    def update_profile(self, email: str, *, name: str | None = None,
                       dept: str | None = None, team: str | None = None) -> dict:
        email = (email or "").strip().lower()
        clip = lambda v: None if v is None else v.strip()[:50]  # noqa: E731
        with db.connect(self._db) as con:
            # COALESCE: 안 준 항목은 지금 값 그대로. 먼저 읽어 오지 않으므로
            # 두 요청이 겹쳐도 서로의 수정을 덮지 않는다.
            changed = con.execute(
                "UPDATE account SET name=COALESCE(?,name), dept=COALESCE(?,dept),"
                " team=COALESCE(?,team) WHERE email=?",
                (clip(name), clip(dept), clip(team), email)).rowcount
        if not changed:
            raise AuthError("계정을 찾을 수 없습니다.")
        got = self.get(email)
        assert got is not None
        return got


class SessionStore:
    """session 표 — sha256(토큰) → {email, expires}. 만료분은 쓸 때 정리한다."""

    def __init__(self, root: str | Path) -> None:
        self._db = _db_path(root)

    @staticmethod
    def _key(token: str) -> str:
        return hashlib.sha256((token or "").encode("utf-8")).hexdigest()

    def issue(self, email: str) -> str:
        token = secrets.token_urlsafe(32)
        now = time.time()
        with db.connect(self._db) as con:
            con.execute("DELETE FROM session WHERE expires<=?", (now,))
            con.execute("INSERT INTO session (token_hash, email, expires)"
                        " VALUES (?,?,?)",
                        (self._key(token), email, now + SESSION_TTL))
        return token

    def resolve(self, token: str) -> str | None:
        if not token:
            return None
        with db.connect(self._db) as con:
            row = con.execute(
                "SELECT email FROM session WHERE token_hash=? AND expires>?",
                (self._key(token), time.time())).fetchone()
        return row["email"] if row is not None else None

    def revoke_all(self, email: str) -> None:
        """그 계정의 세션을 전부 끊는다. 계정을 지웠는데 세션이 남으면 그 사람은
        쿠키만으로 계속 들어온다."""
        with db.connect(self._db) as con:
            con.execute("DELETE FROM session WHERE email=?", (email,))

    def revoke(self, token: str) -> None:
        with db.connect(self._db) as con:
            con.execute("DELETE FROM session WHERE token_hash=?",
                        (self._key(token),))
