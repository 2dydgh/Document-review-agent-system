"""목차 대조 규칙: 목차와 본문이 어긋나면 잡고, 목차를 못 읽으면 지적하지 않는다."""
from modules.agent_format import TocAppendixChecker, TocChecker
from modules.shared import Anchor, Document, Section

TOC = (r"(?i)^(table\s+of\s+)?contents$", r"(?i)^list\s+of\s+(tables|figures|appendices)")


def page(no, text):
    return Section(str(no), f"{no}쪽", 0, text, Anchor(no, str(no)))


def head(title, pg, level=1, children=()):
    return Section(title, title, level, title + "\n본문", Anchor(pg, title), list(children))


def contents(*lines):
    return page(2, "CONTENTS\nSection   Page   Title\n" + "\n".join(lines))


def rvvr(toc_lines, headings, appendix_page=None):
    sections = [page(1, "표지"), contents(*toc_lines)]
    if appendix_page:
        sections.append(page(3, appendix_page))
    return Document("rvvr.pdf", "pdf", sections + headings)


GOOD_TOC = ["1.0   Purpose ......................... 5",
            "3.0   References ...................... 6",
            "3.1.   Regulations .................... 6",
            "3.2   Code and Standards............... 7"]
# 목차는 쪽 번호를 인쇄 번호로 적는다. 여기서는 PDF 쪽 = 인쇄 쪽 + 2 (표지·목차 두 쪽).
GOOD_HEADS = [head("1.0 Purpose", 7),
              head("3.0 References", 8, children=[
                  head("3.1 Regulations", 8, 2, [head("3.1.1 RG 1.168, Rev.02", 8, 3)]),
                  head("3.2. Code and Standards", 9, 2)]),
              head("[Appendix A] Checklist", 10, children=[head("1. Table 1", 10, 2)])]


def messages(findings):
    return [("INFO " if f.unreviewed else "") + f.message for f in findings]


def test_matching_toc_is_clean_even_with_front_page_offset_and_deeper_body():
    """3.1. ↔ 3.1, 3.0 ↔ 3, 목차보다 깊은 3.1.1, 부록 안의 `1.` 은 지적하지 않는다."""
    assert TocChecker(TOC).check(rvvr(GOOD_TOC, GOOD_HEADS)) == []


def test_title_missing_and_unlisted_headings_are_flagged_with_toc_line_as_evidence():
    toc = [GOOD_TOC[0], "3.0   Reference ....... 6", GOOD_TOC[3], "4.0   Terms ....... 9"]
    got = TocChecker(TOC).check(rvvr(toc, GOOD_HEADS))
    msgs = messages(got)
    assert any("목차 'Reference' / 본문 'References'" in m for m in msgs)
    assert any("목차의 4 'Terms' 에 해당하는 본문 장이 없습니다" in m for m in msgs)
    assert any("본문 장 3.1 'Regulations' 이(가) 목차에 없습니다" in m for m in msgs)
    wrong = next(f for f in got if "Reference'" in f.message)
    assert wrong.evidence[0].quote == "3.0 Reference ....... 6"
    assert not any(f.unreviewed for f in got)


def test_page_number_off_from_the_common_offset_is_flagged():
    toc = GOOD_TOC[:3] + ["3.2   Code and Standards............... 9"]
    msgs = messages(TocChecker(TOC).check(rvvr(toc, GOOD_HEADS)))
    assert msgs == ["목차의 쪽 번호가 본문 위치와 다릅니다 — "
                    "3.2 'Code and Standards' 목차 9쪽, 실제 7쪽"]


def test_no_page_agreement_means_pages_are_not_judged():
    toc = ["1.0 Purpose ..... 1", "3.0 References ..... 9", "3.1 Regulations ..... 20",
           "3.2 Code and Standards ..... 40"]
    msgs = messages(TocChecker(TOC).check(rvvr(toc, GOOD_HEADS)))
    assert msgs == ["INFO 목차 쪽 번호와 본문 위치의 차이가 항목마다 달라 "
                    "쪽 번호는 대조하지 않았습니다."]


def test_unreadable_inputs_are_unreviewed_not_findings():
    no_toc = Document("x.pdf", "pdf", GOOD_HEADS)
    assert messages(TocChecker(TOC).check(no_toc))[0].startswith("INFO 목차를 찾지 못해")
    unnumbered = rvvr(GOOD_TOC, [head("목적", 7), head("범위", 8)])
    assert messages(TocChecker(TOC).check(unnumbered)) == [
        "INFO 본문 장 제목에 번호가 없어 목차와 대조하지 못했습니다."]
    assert messages(TocChecker(()).check(no_toc))[0].startswith("INFO 목차 위치(toc_sections)")


APPX = ("Appendix", "부록")


def appendix_doc(listing, titles):
    return rvvr(GOOD_TOC, [*GOOD_HEADS[:2], *[head(t, 10 + i) for i, t in enumerate(titles)]],
                appendix_page="LIST OF TABLES\n" + listing)


def test_appendix_list_matches_bracket_and_dot_forms():
    doc = appendix_doc("APPENDICES\nAppendix A.   Summary Checklist\nAppendix B.   IEEE Std.1012",
                       ["[Appendix A] Summary Checklist", "Appendix B. IEEE Std. 1012"])
    assert TocAppendixChecker(TOC, APPX).check(doc) == []


def test_appendix_mismatch_missing_and_case_only():
    doc = appendix_doc(
        "Appendix A. Requirements Phase Checklist Appendix B. Risk Worksheet Appendix D. Report",
        ["[Appendix A] Requirement Phase Checklist", "[Appendix B] risk worksheet",
         "[Appendix C] Criticality"])
    msgs = messages(TocAppendixChecker(TOC, APPX).check(doc))
    assert "목차의 부록 D 'Report' 에 해당하는 본문 부록이 없습니다" in msgs
    assert "본문 부록 C 'Criticality' 이(가) 목차의 부록 목록에 없습니다" in msgs
    assert any(m.startswith("부록 A 제목이 목차와 본문에서 다릅니다") for m in msgs)
    assert any(m.startswith("부록 B 제목이 목차와 본문에서 대소문자만 다릅니다") for m in msgs)


def test_scrambled_appendix_list_skips_titles_but_still_checks_letters():
    """실측(SYSA Rev05): 칸이 섞여 `Appendix A. Appendix B. …제목들` 로 추출된다."""
    doc = appendix_doc("Appendix A. Appendix B.   Summary Checklist Consistency Analysis",
                       ["Appendix A. Summary Checklist", "Appendix B. Consistency Analysis",
                        "Appendix C. Extra"])
    msgs = messages(TocAppendixChecker(TOC, APPX).check(doc))
    assert "본문 부록 C 'Extra' 이(가) 목차의 부록 목록에 없습니다" in msgs
    assert any(m.startswith("INFO 목차의 부록 목록이 칸이 섞인 채") for m in msgs)
    assert not any("제목이 목차와 본문에서" in m for m in msgs)


def test_wrapped_column_gap_is_not_a_title_difference():
    """실측(PLT34 Appendix J): 목차 추출이 줄바꿈 칸을 섞어 낱말 순서만 바뀐다."""
    doc = appendix_doc("Appendix J.   Analysis between NSSS   and SRS Design Specification",
                       ["Appendix J. Analysis between NSSS Design Specification and SRS"])
    assert TocAppendixChecker(TOC, APPX).check(doc) == []


def test_annex_titles_are_flagged():
    doc = appendix_doc("Appendix A. Summary", ["Appendix A. Summary", "Annex B. Extra"])
    msgs = messages(TocAppendixChecker(TOC, APPX, ("Annex", "Attachment")).check(doc))
    assert "부록 표기를 Appendix 로 통일하세요 — 'Annex B. Extra'" in msgs
