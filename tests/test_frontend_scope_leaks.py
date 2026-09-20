"""화면 함수가 다른 함수의 지역 변수를 몰래 쓰지 않는지.

바닐라 SPA 라 스코프가 어긋나도 파일은 멀쩡히 파싱된다 — 그 화면을 **열어야**
`ReferenceError` 로 터진다. node --check 도 디자인 검사도 이것을 못 잡는다.
두 번 당했다:

* 2026-09-01 — 비교 요약 카드를 다시 쓰면서 `v.cmp` 대신 `cmp`(renderVals 지역)를
  써서 비교 결과 화면이 통째로 죽었다.
* 2026-09-02 — `RTM_GROUPS` 가 `compareResults` 안에 선언돼 있는데 바깥의 보조 패널
  이 먼저 썼다. 같은 화면 안이라 눈으로는 이어져 보였지만 스코프는 갈라져 있었다.
* 2026-09-03 — `statementHtml` 이 `compareResults` 안에 있는데 `compareDocView`
  가 썼다. **세 번째다.** 셋 다 "같은 화면의 다른 함수"였고, 셋 다 그 화면을
  열어야 죽었다.

둘의 모양이 달라 규칙도 둘이다. 파일 전체에 일반 스코프 분석을 걸어 봤지만
객체 리터럴 키(`{ title: … }`)와 지역 이름이 구별되지 않아 경보 200건이 쏟아졌다 —
잡음이 신호를 덮으면 아무도 안 본다. 그래서 신호가 분명한 두 모양만 본다.
"""
from __future__ import annotations

import re
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
VIEWS = (_ROOT / "web" / "views.js").read_text(encoding="utf-8")

#: 주석·문자열 안의 글자는 코드가 아니다. 지우고 본다.
#: 정규식 리터럴을 먼저 지운다 — `.replace(/"/g, …)` 의 따옴표가 문자열 시작으로
#: 읽히면 파일 뒤쪽이 통째로 삼켜진다(실측: 함수 143 개 중 44 개만 보였다).
_STRIP = re.compile(
    r"(//[^\n]*)"
    r"|(/\*.*?\*/)"
    r"|(?<=[=(,:!&|?{;\[])(\s*/(?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\\n])+/[gimsuy]*)"
    r"|('(?:\\.|[^'\\])*')"
    r"|(\"(?:\\.|[^\"\\])*\")",
    re.S)
CODE = _STRIP.sub(lambda m: "\n" * m.group(0).count("\n"), VIEWS)


def _top_level_functions() -> dict[str, tuple[int, int, str]]:
    """`  function 이름(` 로 시작하는 최상위 함수의 몸통 범위와 인자 목록."""
    out: dict[str, tuple[int, int, str]] = {}
    for m in re.finditer(r"\n  function ([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{", CODE):
        depth, i = 1, m.end()
        while i < len(CODE) and depth:
            if CODE[i] == "{":
                depth += 1
            elif CODE[i] == "}":
                depth -= 1
            i += 1
        out[m.group(1)] = (m.end(), i - 1, m.group(2))
    return out


#: renderVals 안에서만 사는 이름들. 화면 함수가 이걸 그대로 쓰면 터진다.
_RENDER_LOCALS = ("cmp", "counts", "rtmRows", "rtmForward", "rtmReverse",
                  "cmpBar", "cmpAdditional", "compareFindings", "statChips",
                  "tableFindings", "sevChips")

#: 검사할 화면 함수들. 새 화면을 만들면 여기 이름을 더한다.
_SCREENS = ("compareResults", "compareDocView", "compareSetup", "compareProgress",
            "compareAdditionalSection", "criteriaLayerCard", "criteriaItemRow",
            "checklistItemGroup", "draftCard", "singleResults", "caseDocView")


def _span(name: str) -> tuple[int, int, set[str]]:
    """함수 몸통의 범위와 그 안에서 선언된 이름(인자 + var)."""
    m = re.search(r"\n +function " + name + r"\(([^)]*)\)\s*\{", VIEWS)
    assert m, f"함수를 찾지 못했다: {name}"
    args = {a.strip() for a in m.group(1).split(",") if a.strip()}
    depth, i = 1, m.end()
    while i < len(VIEWS) and depth:
        if VIEWS[i] == "{":
            depth += 1
        elif VIEWS[i] == "}":
            depth -= 1
        i += 1
    body = VIEWS[m.end():i]
    return m.end(), i, args | set(re.findall(r"var\s+([A-Za-z_$][\w$]*)", body))


def test_screens_do_not_read_render_locals() -> None:
    bad: list[str] = []
    for name in _SCREENS:
        a, b, local = _span(name)
        body = VIEWS[a:b]
        for leak in _RENDER_LOCALS:
            if leak in local:
                continue
            if re.search(r"(?<![\w.$])" + leak + r"\s*\.", body):
                bad.append(f"{name} → {leak}")
    assert not bad, ("화면 함수가 renderVals 지역 변수를 쓴다(열면 ReferenceError): "
                     + ", ".join(bad))


def test_공유_상수는_한_함수_안에_갇혀_있지_않다() -> None:
    """대문자 상수(RTM_GROUPS·MODES…)는 표·라벨 사전이라 여러 화면이 나눠 쓴다.

    한 함수 **안에** 선언해 두고 다른 함수가 쓰면, 파일은 파싱되지만 그 화면을
    여는 순간 죽는다. 대문자 이름은 객체 키와 헷갈릴 일이 거의 없어 이 모양만은
    파일 전체에 걸어도 잡음이 안 난다.

    고치는 법: 두 곳 이상에서 쓰면 모듈 스코프로 올린다.
    """
    decls = list(re.finditer(r"\n( {4,})var ([A-Z][A-Z0-9_]{2,})\s*=", VIEWS))
    #: 같은 이름을 여러 함수가 각자 선언했으면 각자의 것이다(ACC 처럼) — 서로를
    #: 바깥 사용으로 오해하지 않게 뺀다.
    dup = {m.group(2) for m in decls
           if sum(1 for o in decls if o.group(2) == m.group(2)) > 1}
    bad: list[str] = []
    for m in decls:
        const = m.group(2)
        if const in dup:
            continue
        # 이 상수를 감싸는 함수의 끝을 찾는다 — 선언 지점에서 여는 괄호가
        # 다 닫히는 자리다.
        depth, i = 1, m.start()
        while i >= 0 and depth:
            i -= 1
            if VIEWS[i] == "}":
                depth += 1
            elif VIEWS[i] == "{":
                depth -= 1
        start = i
        depth, j = 1, m.start()
        while j < len(VIEWS) and depth:
            if VIEWS[j] == "{":
                depth += 1
            elif VIEWS[j] == "}":
                depth -= 1
            j += 1
        outside = VIEWS[:start] + VIEWS[j:]
        if re.search(r"(?<![\w.$])" + const + r"(?![\w$])", outside):
            bad.append(const)
    assert not bad, ("상수가 선언된 함수 밖에서 쓰인다 — 그 화면을 열면 "
                     "ReferenceError 로 죽는다. 모듈 스코프로 올려라: "
                     + ", ".join(sorted(set(bad))))


def test_함수는_선언된_함수_밖에서_안_쓰인다() -> None:
    """도우미 함수(statementHtml·clipCell…)를 다른 최상위 함수가 쓰면,
    파일은 파싱되지만 그 화면을 여는 순간 ReferenceError 로 죽는다.

    **함수 이름은 잡음이 없다.** 일반 지역 변수는 `title`·`body` 처럼 흔해서
    파일 전체 검사가 경보 200 건을 냈지만(위 주석), 함수 이름은 그 자리에서만
    쓰는 고유한 말이라 그대로 걸 수 있다.

    고치는 법: 둘 이상이 쓰면 모듈 스코프로 올린다.
    """
    fns = _top_level_functions()
    assert len(fns) > 50, f"함수를 제대로 못 찾았다({len(fns)}개)"
    module_scope = set(fns)

    # 이름 → 그 이름을 선언한 최상위 함수들.
    owner: dict[str, set[str]] = {}
    inner: dict[str, set[str]] = {}
    for name, (a, b, _params) in fns.items():
        body = CODE[a:b]
        names = set(re.findall(r"\bfunction\s+([A-Za-z_$][\w$]*)\s*\(", body))
        names |= set(re.findall(r"\b(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*function\b",
                                body))
        inner[name] = names
        for d in names - module_scope:
            owner.setdefault(d, set()).add(name)

    bad: list[str] = []
    for name, (a, b, _params) in fns.items():
        body = CODE[a:b]
        for fname, owners in owner.items():
            if name in owners or fname in inner[name]:
                continue
            if re.search(r"(?<![\w.$])" + re.escape(fname) + r"\s*\(", body):
                bad.append(f"{name} → {fname}() (선언: {', '.join(sorted(owners))})")
    assert not bad, ("다른 함수 안에 선언된 도우미를 쓴다 — 그 화면을 열면 "
                     "ReferenceError 로 죽는다. 모듈 스코프로 올려라: "
                     + "; ".join(sorted(bad)))
