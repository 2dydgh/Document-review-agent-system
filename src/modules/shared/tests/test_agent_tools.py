"""근거 재확인 검색 도구 — 파일 접근도 부작용도 없다."""
import pytest

from modules.shared import Anchor, DocTools, Document, Section


@pytest.fixture
def doc():
    sections = [
        Section(id="s0", title="개요", level=1, text="이 문서는 예측 기능을 다룬다.",
                anchor=Anchor(page=None, section="개요")),
        Section(id="s1", title="컴포넌트 목록", level=1,
                text="| 모듈 | 설명 |\n| 예측 | 위험도를 산정한다 |\n산문 한 줄.",
                anchor=Anchor(page=None, section="컴포넌트 목록")),
        Section(id="s2", title="부록", level=1, text="예측 기능 재언급.",
                anchor=Anchor(page=None, section="부록")),
    ]
    return Document(source_path="x", doc_type="generic", sections=sections)


def test_find_term_lists_every_line_with_location(doc):
    out = DocTools(doc).run("find_term", {"term": "예측"})
    assert "개요" in out and "컴포넌트 목록" in out and "부록" in out


def test_find_term_reports_absence(doc):
    out = DocTools(doc).run("find_term", {"term": "존재하지않는말"})
    assert "없" in out


def test_unknown_tool_explains(doc):
    out = DocTools(doc).run("semantic_search", {"query": "x"})
    assert "알 수 없는 도구" in out


def test_missing_arg_explains(doc):
    out = DocTools(doc).run("find_term", {})
    assert "term" in out


def test_specs_describe_every_tool(doc):
    """SPECS 는 프롬프트가 모델에게 알려주는 목록이다.

    도구 목록을 여기에 박아 두면 도구를 늘릴 때마다 이 테스트만 고치게 된다.
    정작 막아야 할 것은 **SPECS 와 실제가 어긋나는 것**이다 — SPECS 에만 있는
    도구를 모델이 부르면 run() 이 "알 수 없는 도구"를 돌려주고, 그 조각의
    판정이 통째로 날아간다.
    """
    tools = DocTools(doc)
    assert DocTools.SPECS, "도구를 하나도 알려주지 않으면 모델은 못 부른다"
    for spec in DocTools.SPECS:
        assert callable(getattr(tools, spec["name"], None)), spec["name"]
        # 인자를 빈 값으로 줘도 run() 이 "알 수 없는 도구"로 떨어지지 않는다.
        out = tools.run(spec["name"], dict.fromkeys(spec["args"], ""))
        assert "알 수 없는 도구" not in out, spec["name"]


# ── 구절 검색이 0건일 때 낱말을 쪼개 알려준다 ─────────────────────────────

def test_phrase_miss_reports_each_word(doc):
    """0건이 "없다"와 "검색어가 틀렸다"를 뭉개면 안 된다.

    실측(2026-09-03, PRJX): 모델이 라이브러리 이름 다섯 개를 한 문자열로 넣어
    검색했고 당연히 0건이 나왔다. 그 0건을 모델은 "설계가 없다"로 읽었다.
    """
    out = DocTools(doc).find_term("예측 기능 없는낱말")

    assert "문서에 없습니다" in out
    assert "'예측'" in out and "'기능'" in out and "'없는낱말' 0곳" in out
    assert "걸린 낱말로 다시" in out


def test_single_word_miss_stays_plain(doc):
    # 낱말 하나짜리 0건은 진짜 0건이다. 쪼갤 것이 없으니 힌트도 없다.
    out = DocTools(doc).find_term("없는낱말")

    assert out == "'없는낱말' 은(는) 문서에 없습니다."


def test_all_words_missing_says_so(doc):
    # 낱말을 하나씩 재도 다 0이면 "진짜 없다"는 더 강한 신호다.
    out = DocTools(doc).find_term("없는낱말 다른낱말")

    assert "낱말을 하나씩 찾아도 없습니다" in out
    assert "걸린 낱말로 다시" not in out


def test_hit_needs_no_hint(doc):
    # 찾았으면 힌트를 붙이지 않는다 — 결과가 힌트에 묻힌다.
    out = DocTools(doc).find_term("예측")

    assert "낱말을 하나씩" not in out


# ── 목차와 제목으로 읽기(2026-09-16) ──────────────────────────────────────
# 어시스턴트가 "3.0 References 가 §몇인지"를 찾기로 더듬느라 호출 38번을 썼다.

@pytest.fixture
def numbered():
    def sec(sid, title, text, page, level=1):
        return Section(id=sid, title=title, level=level, text=text,
                       anchor=Anchor(page=page, section=sid))
    sections = [
        sec("5.1", "3.1.", "3.3.1. 첫 문서", 8, level=2),
        sec("6", "3.0 References", "3.3.6. SRS 문서", 8),
        sec("7", "4.0 Definition of Terms", "용어", 10),
        sec("22", "Appendix B Checklist", "B " * 1500, 24),
    ]
    return Document(source_path="x", doc_type="generic", sections=sections)


def test_outline_lists_every_section_with_page(numbered):
    toc = DocTools(numbered).outline()
    assert "[6] 3.0 References (8쪽)" in toc and "[22] Appendix B Checklist (24쪽)" in toc


def test_read_section_accepts_document_number_and_title(numbered):
    tools = DocTools(numbered)
    assert "SRS 문서" in tools.read_section("3.0")
    assert "SRS 문서" in tools.read_section("3.0 References")
    assert "용어" in tools.read_section("4.0 definition")
    assert "B B" in tools.read_section("부록 B")
    assert "첫 문서" in tools.read_section("5.1")           # 파서 순번은 그대로 통한다


def test_read_section_reports_candidates_and_absence(numbered):
    tools = DocTools(numbered)
    # "3" 은 3.0 과 3.1. 둘 다 — 추측하지 않고 후보를 준다.
    out = tools.read_section("3")
    assert "2개" in out and "[3.0 References / 6]" in out and "[3.1. / 5.1]" in out
    assert "list_sections" in tools.read_section("9.9")


def test_read_section_continues_with_offset(numbered):
    tools = DocTools(numbered)
    first = tools.read_section("부록 B")
    assert "이어 읽으려면 offset=2000" in first
    assert "(offset 2000부터)" in tools.read_section("부록 B", offset=2000)
