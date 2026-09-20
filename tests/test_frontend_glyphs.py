"""삽화형 문서·폴더 그림(업로드 드롭존 · 검토 기준 카드).

화면마다 따로 손으로 그린 SVG 라 계속 갈라졌다. 여기서 지키는 것은 둘.

1. **연한 채움에 윤곽선을 얹는다.** 채움(opacity .15)만 있으면 형태가 흐리다.
   한 화면에 윤곽선 있는 그림과 없는 그림이 같이 놓이면 없는 쪽만 덜 그려진
   것처럼 보인다 — 실제로 폴더 검토 그림에만 윤곽선이 있어서 그렇게 보였다.
2. **그라디언트 id 는 화면에서 유일하다.** 비교 검토는 드롭존을 A·B 두 번
   그린다. 고정 id 를 쓰면 같은 id 가 한 문서에 둘이 되고, 값이 갈리는 순간
   조용히 한쪽을 따라간다.
"""
from __future__ import annotations

import re
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
VIEWS_JS = (_ROOT / "web" / "views.js").read_text(encoding="utf-8")

# 삽화형 그림의 몸통. 문서(dropzone·검토 기준)와 폴더(폴더 검토)가 나눠 쓴다.
_DOC_SHAPES = (
    "M24 18 L57 18 L76 37 L76 78",  # 업로드 — 폴더와 면적을 맞춘 넓은 종이
    "M28 18 L56 18 L72 34 L72 78",  # 진행 스캔 — 기존 비율
)
_FOLDER_SHAPE = "M18 30 A4 4 0 0 1 22 26"


def _svg_blocks() -> list[str]:
    """viewBox="0 0 100 100" 짜리 삽화형 SVG 만 골라 온다."""
    return re.findall(r'<svg viewBox="0 0 100 100".*?</svg>', VIEWS_JS, re.DOTALL)


def test_문서_폴더_그림에_윤곽선이_있다() -> None:
    """**몸통 path** 만 본다.

    같은 svg 안의 화살표·더하기는 원래 stroke 로 그리므로, svg 통째로 "stroke 가
    있나"를 물으면 몸통이 채움뿐이어도 통과한다. 윤곽선 여부는 몸통에게 물어야 한다.

    윤곽선 색은 가리지 않는다 — 드롭존은 그라디언트로, 비교 검토 진행 화면의
    스캔 그림은 단색(--accent)으로 긋는다. 둘 다 형태가 또렷하면 목적을 채운다.
    """
    seen = 0
    for s in _svg_blocks():
        body = [p for p in re.findall(r"<path\b[^>]*>", s)
                if any(shape in p for shape in _DOC_SHAPES) or _FOLDER_SHAPE in p]
        if not body:
            continue
        seen += 1
        assert any('stroke="' in p for p in body), \
            "몸통에 윤곽선이 없다 — 채움만 있으면 형태가 흐리다"
    # 남은 삽화형 몸통은 **폴더 검토 드롭존의 폴더 하나**다(2026-09-08).
    # 업로드 드롭존과 검토 기준 카드의 문서 삽화는 화면을 다시 짜면서 ICONS 와
    # 작은 글리프 계열(docShapeIcon·kindShapeIcon)로 옮겨 갔다 — 그쪽 윤곽선은
    # 이 파일 맨 아래 test_기록형_목록의_파일_아이콘… 이 SHEET_STROKE 로 본다.
    # 비교 검토 진행 화면의 그림도 CSS 대조 장면(.cmp-doc, index.html)이라 밖이다.
    assert seen >= 1, f"삽화형 몸통을 {seen}개 찾았다 — 셀렉터가 낡았다"


def test_그림마다_그라디언트_id_가_다르다() -> None:
    """한 화면에 둘 이상 놓이므로 고정 id 를 쓰면 겹친다."""
    blocks = _svg_blocks()
    ids: list[str] = []
    for s in blocks:
        ids += re.findall(r'linearGradient id="([^"]*)"', s)
    # 한때 비교 검토가 같은 드롭존 함수를 A·B 두 번 불러 id 에 slot 을 붙여
    # 갈랐다. 지금 비교 드롭존은 SVG 가 아니라 점선 카드라 그 규약은 없어졌고,
    # 남은 것은 **한 화면에 같은 id 가 둘 있지 않다**는 원래 계약뿐이다.
    assert ids, "삽화형 그라디언트를 하나도 못 찾았다 — 검사가 무의미해졌다"
    fixed = [i for i in ids if "+" not in i]
    assert len(fixed) == len(set(fixed)), f"고정 id 가 겹친다: {fixed}"


def test_점선_카드_hover_는_brand_state이다() -> None:
    """중립 목록 hover는 드롭 동작의 강조로 재사용하지 않는다.

    점선 드롭존은 브랜드 호버를 쓰고, 지속되는 선택 상태의 --accent-weak보다
    옅게 유지한다.
    """
    app_js = (_ROOT / "web" / "app.js").read_text(encoding="utf-8")
    # 점선 카드를 그리는 자리 = "…px dashed var(--line-dashed)" 를 가진 마크업.
    # 굵기는 고정하지 않는다 — 2px 로 박아 두었더니 1px 로 얇아진 순간 검사가
    # 조용히 0건을 훑고 지나갔다(2026-09-08).
    cards = [m for m in re.findall(r"'[^']*\dpx dashed var\(--line-dashed\)[^']*'[^;]*",
                                   VIEWS_JS)]
    assert cards, "점선 카드를 못 찾았다 — 셀렉터가 낡았다"
    for c in cards:
        assert "var(--state-hover-neutral)" not in c, \
            "점선 카드 hover 에 중립 목록 hover가 남아 있다"

    # onmouseover 로 중립 면을 칠하는 점선 카드가 없어야 한다(마크업 전체에서).
    for chunk in re.findall(r"onmouseover=[^+]*var\(--state-hover-neutral\)[^+]*", VIEWS_JS):
        assert "borderColor='var(--accent)'" not in chunk, \
            "점선 카드 hover 가 중립 목록 hover로 되돌아갔다"

    # 끌어다 놓는 중의 강조(폴더 검토)도 같은 브랜드 호버 값이어야 한다.
    drag = app_js[app_js.index("var z = caseZoneOf(e); if (z) { e.preventDefault();"):]
    drag = drag[:drag.index("\n")]
    assert "var(--state-hover-brand)" in drag, \
        "폴더 검토 드래그 강조가 브랜드 호버 토큰을 쓰지 않는다"


# 검토 기준 카드의 문서 그림 둘을 docGlyph() 한 함수에서 뽑는지 보던 검사는
# 뺐다 — 그 카드가 ICONS 로 바뀌면서 함수 자체가 없어졌다(2026-09-08).
# "한쪽만 고쳐진다" 는 원래 걱정은 ICONS 가 한 곳이라 구조가 대신 막는다.
def test_업로드_그림의_크기와_농도가_한_단계다() -> None:
    """남은 52px 보조 삽화(폴더)와 작은 글리프 계열이 같은 농도를 쓴다.

    한때 문서·체크리스트·폴더 셋이 이 크기를 나눠 썼다. 앞의 둘은 ICONS 로
    옮겨 가 하나만 남았다(2026-09-08) — 크기 세트가 아니라 **농도 토큰**이
    이 검사의 알맹이다. 값이 리터럴로 박히면 다크에서 종이가 사라진다.
    """
    assert VIEWS_JS.count('width:52px;height:52px') >= 1
    assert 'width:48px;height:48px;margin:0 auto 12px' not in VIEWS_JS
    # 일반 문서와 공용 체크리스트 함수 모두 같은 외곽 농도와 내부 선을 쓴다.
    # 농도는 리터럴이 아니라 테마 토큰이다(--glyph-*) — 값이 박혀 있으면
    # 다크에서 종이가 거의 사라진다(2026-09-01).
    assert VIEWS_JS.count('style="opacity:var(--glyph-line)"') >= 4
    assert VIEWS_JS.count('stroke-width="4"') >= 3
    # 첨부 전·후 폴더도 면을 진하게 바꾸지 않고 내부 기호로 상태를 구분한다.
    assert 'folder("0.15", "0.40")' in VIEWS_JS
    assert 'folder("0.25", "0.5")' not in VIEWS_JS


def test_기록형_목록의_파일_아이콘은_작아져도_문서_윤곽을_유지한다() -> None:
    """별도 기록과 홈은 각각의 작은 크기로 같은 문서 외곽을 유지한다."""
    start = VIEWS_JS.index("function folderGlyph(")
    block = VIEWS_JS[start:VIEWS_JS.index("function kindShapeIcon(", start)]
    # 문서 몸통·접힌 면, 폴더 몸통·탭 네 곳이 같은 선과 농도를 쓴다
    # (폴더 둘은 folderGlyph, 문서 둘은 docShapeIcon — 두 함수가 잇달아 온다).
    assert block.count("stroke-width=\"' + SHEET_STROKE + '\"") == 4
    assert block.count('style="opacity:var(--glyph-line)"') == 4
    # 윤곽 굵기는 리터럴로 흩어지지 않는다 — 화면에 찍히는 두께를 맞추려면
    # 축소해 그리는 비교 글리프만 다른 값을 써야 해서, 두 상수로만 갈린다.
    kstart = VIEWS_JS.index("function kindShapeIcon(")
    kblock = VIEWS_JS[kstart:VIEWS_JS.index("function iconTile(", kstart)]
    assert 'stroke-width="0.7"' not in block and 'stroke-width="0.7"' not in kblock, \
        "윤곽 굵기를 리터럴로 박으면 비교 글리프만 얇게 찍힌다"
    # 비교의 두 장(scale 0.8)만 축소용 굵기를 쓴다.
    assert kblock.count("SHEET_STROKE_SCALED") == 2
    assert 'var SHEET_STROKE = "0.53", SHEET_STROKE_SCALED = "0.7";' in VIEWS_JS
    # 일반 인라인 자리는 원래의 확장자 배지를 유지하되, 기록형 목록은 명시적으로
    # 문서 윤곽을 요청한다. 크기는 별도 기록과 홈에서 각각 정한다.
    dblock = VIEWS_JS[VIEWS_JS.index("function docShapeIcon("):
                      VIEWS_JS.index("function kindShapeIcon(")]
    assert "if (size < 40 && !keepShape)" in dblock
    assert "<svg viewBox=\"0 0 28 36\"" in dblock
    hstart = VIEWS_JS.index("function recordShapeIcon(")
    hblock = VIEWS_JS[hstart:VIEWS_JS.index("function iconTile(", hstart)]
    assert 'docShapeIcon(title, size, "accent", true)' in hblock
