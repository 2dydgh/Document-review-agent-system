"""한글 폰트 대체 규칙(config/korean-fonts.conf).

이름 그대로 **폰트가 아니라 규칙**이다 — "굴림이라고 하면 나눔고딕을 써라".
폰트 파일은 apt 로 깐다(fonts-nanum·fonts-noto-cjk, Dockerfile 참조).

이 규칙이 없거나 틀리면 **조용히** 나빠진다 — 변환은 "성공"하고 PDF 만 원본과
달라진다. 실측(2026-09-03, PRJX-DS-014_상세설계서_v1.3.hwpx): 규칙 없이 변환하면 명조든
고딕이든 전부 Noto Sans CJK JP(일본어 자형) 하나로 그려져 64쪽이 나왔다. 규칙을
넣으면 61쪽이고, **한글에서 연 원본이 61쪽**이다 — 쪽 수가 맞아야 뷰어 하이라이트가
원본과 같은 쪽을 가리킨다.

그래서 실제 문서가 요구하는 이름이 **빠짐없이, 올바른 계열로** 걸리는지 본다.
아래 목록은 `.docreview/history/originals` 의 hwpx 를 열어 뽑은 실측값이다.
"""
import xml.etree.ElementTree as ET
from pathlib import Path

CONF = Path(__file__).resolve().parents[1] / "config" / "korean-fonts.conf"

# 실문서에서 관찰된 이름과 그 계열. 오른쪽이 이 폰트가 가야 할 곳이다.
OBSERVED = {
    "한컴바탕": "serif", "함초롬바탕": "serif", "휴먼명조": "serif",
    "한양신명조": "serif", "바탕": "serif",
    "함초롬돋움": "sans-serif", "굴림": "sans-serif", "맑은 고딕": "sans-serif",
    "HY헤드라인M": "sans-serif", "맑은": "sans-serif",
    "돋움체": "monospace",
}

# 계열별로 실제 그려질 폰트. 없는 것을 적어 두면 fontconfig 가 조용히 건너뛴다.
EXPECTED_HEAD = {
    "serif": "함초롬바탕", "sans-serif": "함초롬돋움", "monospace": "NanumGothicCoding",
}
INSTALLED = {"serif": "NanumMyeongjo", "sans-serif": "NanumGothic",
             "monospace": "NanumGothicCoding"}


def _aliases():
    """{폰트 이름: (prefer 목록, default 계열)}"""
    root = ET.parse(CONF).getroot()
    out = {}
    for al in root.findall("alias"):
        name = al.find("family").text
        prefer = [f.text for f in al.find("prefer").findall("family")]
        default = al.find("default").find("family").text
        out[name] = (prefer, default)
    return out


def test_설정이_올바른_XML_이다():
    """깨지면 fontconfig 가 파일을 통째로 무시한다 — 에러도 안 낸다."""
    assert ET.parse(CONF).getroot().tag == "fontconfig"


def test_실문서가_요구하는_이름이_빠짐없이_걸린다():
    missing = sorted(set(OBSERVED) - set(_aliases()))
    assert not missing, f"실문서에 나오는데 규칙에 없다: {missing}"


def test_명조는_명조로_고딕은_고딕으로_간다():
    """이게 원래 증상이었다 — 명조 문서가 고딕으로 그려졌다."""
    aliases = _aliases()
    for name, generic in OBSERVED.items():
        prefer, default = aliases[name]
        assert default == generic, f"{name} 의 계열이 {default} 로 잘못 걸려 있다"
        assert INSTALLED[generic] in prefer, \
            f"{name} 이 실제로 설치된 폰트({INSTALLED[generic]})에 닿지 않는다"


def test_함초롬이_설치되면_자동으로_그쪽이_이긴다():
    """라이선스 판단이 끝나 함초롬을 깔았을 때 이 파일을 다시 안 고쳐도 되게."""
    aliases = _aliases()
    for name, generic in OBSERVED.items():
        prefer, _ = aliases[name]
        assert prefer[0] == EXPECTED_HEAD[generic], \
            f"{name} 의 첫 후보가 {prefer[0]} 다 — {EXPECTED_HEAD[generic]} 이어야 한다"


def test_한국어_문맥에서만_기본_계열을_바꾼다():
    """Latin 까지 나눔으로 끌고 가면 영문이 나빠진다. lang=ko 조건이 있어야 한다."""
    root = ET.parse(CONF).getroot()
    matches = root.findall("match")
    assert matches, "이름을 못 알아본 폰트를 받을 규칙이 없다"
    for m in matches:
        langs = [t for t in m.findall("test") if t.get("name") == "lang"]
        assert langs and langs[0].find("string").text == "ko", \
            "기본 계열 교체가 한국어 문맥으로 제한되어 있지 않다"
