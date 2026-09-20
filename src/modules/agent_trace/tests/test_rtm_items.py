"""문서 간 기준의 항목 판정 — 기준이 자기 검사를 지명한다."""
from modules.agent_trace import rtm_check, rtm_verdict
from modules.shared import Anchor, Finding, RtmRow, Severity


class _C:
    def __init__(self, check=""):
        self.check = check


def _row(status, upper="RQ-1"):
    return RtmRow(upper_id=upper, lower_ids=[], status=status,
                  anchor=Anchor(page=None, section="1"))


def _f(checker, document, unreviewed=False):
    return Finding(checker=checker, severity=Severity.MAJOR, message="x",
                   anchor=Anchor(page=None, section="1"),
                   document=document, unreviewed=unreviewed)


def test_unknown_check_is_not_claimed():
    assert rtm_check(_C("rtm_forward")) == "rtm_forward"
    assert rtm_check(_C("오타")) == ""      # 조용히 넘기지 않는다
    assert rtm_check(_C("")) == ""


def test_forward_and_reverse_read_different_findings():
    rows = [_row("missing"), _row("orphan", None), _row("linked")]
    findings = [_f("traceability", "parent"), _f("traceability", "child")]
    st, mine, _ = rtm_verdict("rtm_forward", rows, findings)
    assert st == "flagged" and [f.document for f in mine] == ["parent"]
    st, mine, _ = rtm_verdict("rtm_reverse", rows, findings)
    assert st == "flagged" and [f.document for f in mine] == ["child"]


def test_no_id_pattern_is_unreviewed_not_clean():
    """RTM 이 비면 검사를 못 한 것이다 — clean 이면 검사도 안 하고 만족이 된다."""
    st, _, why = rtm_verdict("rtm_forward", [], [])
    assert st == "unreviewed" and "요건 ID 형식" in why


def test_llm_off_blocks_content_match_verdict():
    rows = [_row("linked")]
    st, _, why = rtm_verdict("rtm_content", rows, [], llm_enabled=False)
    assert st == "unreviewed" and "AI 검토를 꺼서" in why


def test_content_match_without_linked_rows_is_unreviewed():
    """볼 것이 없었는데 '이상 없음'이라 하면 검사한 척이 된다."""
    st, _, why = rtm_verdict("rtm_content", [_row("missing")], [])
    assert st == "unreviewed" and "대조할 것이 없었습니다" in why


def test_clean_when_checked_and_nothing_found():
    st, mine, why = rtm_verdict("rtm_forward", [_row("linked")], [])
    assert (st, mine, why) == ("clean", [], "")


def test_unreviewed_findings_do_not_flag():
    """미검토 보고(INFO)는 지적이 아니다 — flagged 로 세면 없는 결함이 생긴다."""
    rows = [_row("linked")]
    st, _, _ = rtm_verdict("rtm_forward", rows,
                           [_f("traceability", "parent", unreviewed=True)])
    assert st == "clean"
