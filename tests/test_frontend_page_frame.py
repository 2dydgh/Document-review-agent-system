"""화면 바깥 여백은 값이 아니라 **클래스**가 진다.

실측(2026-09-02 지적): 좌우 여백이 화면마다 달랐다 — 업로드·기준·설정·기록·폴더
리포트는 24px 인데 단일·비교 결과만 32px 였고, 위 여백은 10·16·20·36 넷이 각자
굳어 있었다. 화면을 옮길 때마다 좌우가 8px 움찔하고 제목 높이가 달라졌다.

원인은 판단이 아니라 **손으로 쓴 값**이다. 결과 화면 둘이 공용 껍질을 안 쓰고
여백을 인라인으로 박아 뒀다. pageHead 를 베껴 뒀다가 굵기 변경에서 혼자 뒤처진
것과 같은 종류다 — 관용구를 베끼면 한쪽만 늙는다.

그래서 여백은 두 껍질이 나눠 진다.

* `.page-shell`  — 폭 1600 에 가두는 보통 화면(위 20 / 최상위는 36)
* `.results-shell` — 좌우 분할이라 **폭 제한만 없는** 결과 화면(위 20)

좌우는 둘 다 24px 하나다.
"""
from __future__ import annotations

import re
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
CSS = (_ROOT / "web" / "index.html").read_text(encoding="utf-8")
VIEWS = (_ROOT / "web" / "views.js").read_text(encoding="utf-8")

_RESULT_SCREENS = ("singleResults", "compareResults")

#: 같은 작업 현황 프레임을 쓰는 진행 화면들.
_CARD_SCREENS = ("singleProgress", "compareProgress", "caseProgress")


def _fn(name: str) -> str:
    body = VIEWS[VIEWS.index("  function " + name + "("):]
    return body[:body.index("\n  }")]


def test_결과_화면은_공용_껍질을_쓴다() -> None:
    assert ".results-shell { --results-pad: 24px;" in CSS, "결과 화면 껍질이 없다"
    assert "padding: 20px var(--results-pad) 12px;" in CSS, \
        "백링크 줄이 공용 여백을 안 쓴다"
    for name in _RESULT_SCREENS:
        body = _fn(name)
        assert 'class="results-shell"' in body, f"{name} 이 공용 껍질을 안 쓴다"
        # 비교 결과는 백링크 줄이 상태 띠와 한 줄이다(class="results-head cmp-strip").
        assert 'class="results-head' in body, f"{name} 의 백링크 줄이 제 규격이 아니다"


def test_결과_화면이_바깥_여백을_손으로_박지_않는다() -> None:
    """화면 **틀**의 좌우만 본다.

    안쪽 여백까지 재면 안 된다 — 문서 본문 칸은 읽는 자리라 40/44px 이 맞고,
    카드 안쪽은 24px 이다. 그건 이 시험이 말할 바가 아니다. 여기서 막는 것은
    화면 틀을 만드는 요소가 좌우 값을 손으로 쓰는 것이고, 그 요소는 껍질의
    **직계 자식**뿐이다.
    """
    bad: list[str] = []
    for name in _RESULT_SCREENS:
        body = _fn(name)
        frame = body[body.index('<div class="results-shell"'):]
        # 직계 자식 줄만 — 그 밑으로 더 들어간 것은 화면 틀이 아니라 내용이다.
        for line in frame.split("' +"):
            if "results-shell" in line or "flex:1;min-height:0" in line or "flex:none" in line:
                for m in re.finditer(r"(?:padding|margin):\s*[\w()-]+\s+(\d+)px", line):
                    bad.append(f"{name}: {m.group(0).strip()}")
    assert not bad, ("결과 화면 틀이 좌우 여백을 손으로 박았다 — var(--results-pad) 를 "
                     "쓰거나 .results-head 에 맡겨라: " + ", ".join(bad))


def test_모든_화면의_좌우_여백이_한_값이다() -> None:
    """껍질이 둘이어도 세로선은 하나여야 화면을 옮길 때 안 움찔한다."""
    shell = re.search(r"\.page-shell \{ height: 100%; box-sizing: border-box; "
                      r"padding: (\d+)px (\d+)px;", CSS)
    assert shell, ".page-shell 규격을 못 읽었다"
    assert shell.group(2) == "24", f".page-shell 좌우가 24 가 아니다: {shell.group(2)}"
    assert "--results-pad: 24px" in CSS, ".results-shell 좌우가 24 가 아니다"
    # 위 여백은 두 단뿐이다: 최상위 화면 28, 그 밖(결과·리포트) 20.
    assert shell.group(1) == "20", f".page-shell 위가 20 이 아니다: {shell.group(1)}"
    assert ".page-shell-primary { padding: 28px 24px; }" in CSS, "최상위 화면 여백이 없다"


def test_화면_껍질의_위아래_여백이_같다() -> None:
    """한쪽만 덮어쓰는 규칙은 반드시 샌다.

    실측(2026-09-02 지적): `.page-shell` 이 위 20 · 아래 32 였고 최상위 화면은
    `.page-shell-primary` 가 **위만** 36 으로 덮어써서, 위 36 · 아래 32 로
    어긋난 채 남았다 — "아래 여백만 더 크다"로 보였다. padding 한 줄이 네 면을
    함께 정하면 이 어긋남이 생길 자리가 없다.
    """
    bad: list[str] = []
    for m in re.finditer(r"(\.page-shell(?:-primary)?) \{([^}]*)\}", CSS):
        decl = m.group(2)
        if "padding" not in decl:
            continue
        if re.search(r"padding-(top|bottom):", decl):
            bad.append(f"{m.group(1)}: 한쪽만 덮어쓴다 — {decl.strip()[:60]}")
            continue
        v = re.search(r"padding: ([^;]+);", decl)
        if v and len(v.group(1).split()) not in (1, 2):
            bad.append(f"{m.group(1)}: 위아래가 다르다 — padding: {v.group(1)}")
    assert not bad, "; ".join(bad)


def test_홈과_보통_화면의_콘텐츠_폭이_같다() -> None:
    """홈만 border-box 라 좌우 패딩(48)을 폭 안에 이고 간다 — 그만큼 더 줘야
    다른 화면과 같은 세로선에서 끝난다. 예전에 이걸 빠뜨려 홈이 48px 좁았다.

    폭 자체는 취향이 아니라 **읽히는 한계**다. 한 줄로 읽는 목록(기준·설정)이
    끝없이 늘면 한 줄이 200 자를 넘는다. 그래서 없애지 않고 눈금으로 둔다.
    """
    m = re.search(r"\.page-container \{ width: 100%; max-width: (\d+)px;", CSS)
    assert m, ".page-container 폭을 못 읽었다"
    content = int(m.group(1))
    h = re.search(r"max-width: (\d+)px; margin: 0 auto; padding: \d+px 24px(?: \d+px)?;", CSS)
    assert h, ".home-layout 폭을 못 읽었다"
    assert int(h.group(1)) == content + 48, (
        f"홈({h.group(1)})과 보통 화면({content}+48)의 콘텐츠 폭이 다르다")



def test_검토_중_화면은_가운데_집중_패널을_공유한다() -> None:
    """세 진행 화면은 실제 modal은 아니지만 전폭 대신 같은 집중 폭을 쓴다."""
    frame = _fn("progressFrame")
    assert 'class="page-shell page-shell-primary page-shell-progress"' in frame
    assert 'class="page-container progress-page-container"><div class="page-stack">' in frame
    assert 'progress-context' not in frame and '.progress-context' not in CSS
    assert ' / 진행 상황' not in frame
    assert 'opts.pageTitle' not in frame
    assert "pageHead(opts.pageTitle)" not in frame
    assert "opts.pageSub" not in frame, "바깥 헤더와 진행 패널이 같은 설명을 반복한다"
    assert 'class="progress-workspace"' in frame
    assert 'class="progress-grid"' in frame
    assert ".progress-page-container { max-width: 620px; }" in CSS
    assert ".page-shell-progress { display: flex; flex-direction: column; }" in CSS
    assert "flex: none; margin-block: auto;" in CSS
    assert 'data-progress-settings="' in frame
    for name in _CARD_SCREENS:
        body = _fn(name)
        assert "return progressFrame({" in body, f"{name}: 공용 진행 프레임을 안 쓴다"
    assert "page-shell-center" not in CSS and "card-narrow" not in CSS


def test_preparation_card_is_compact_without_forced_height() -> None:
    selector = '.progress-workspace[data-progress-phase="preparing"]'
    body = re.search(re.escape(selector) + r"\s*\{([^}]+)\}", CSS).group(1)
    assert "width: min(100%, 480px)" in body
    assert "padding: 60px 44px" in body
    assert "height" not in body and "aspect-ratio" not in body
    assert "margin-inline: auto" in CSS
    assert selector + " .progress-summary-row { display: contents; }" in CSS
    assert 'state.progressSettings && state.progressSettings[opts.scroll]' in _fn("progressFrame")
