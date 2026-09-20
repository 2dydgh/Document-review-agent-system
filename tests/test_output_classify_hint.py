"""산출물 판별 실패 메시지가 "팀을 잘못 골랐을 가능성"을 말하는지.

실측(2026-08-31): AX품질팀 상세설계서를 시험인증팀으로 돌리면 "가리지 못했다"
INFO 만 뜨고, 남의 표기 규칙 지적이 우수수 나왔다. 그 INFO 가 팀 선택 힌트를
싣지 않으면 검토자는 파일명만 의심한다.
"""
from app.case import output_spec_for, structure_suggestion

_SPEC = {
    "name": "AI시험인증1팀",
    "outputs": [
        {"key": "갑지", "form_no": "SST-K-TP-7-08-06(00)"},
        {"key": "을지", "form_no": "SST-K-TP-7-08-07(00)"},
    ],
}


def test_unclassified_hints_wrong_team():
    spec, why = output_spec_for("PRJX-DS-005_상세설계서_v1.0.hwpx", _SPEC)
    assert spec is None
    assert "팀 선택" in why and "AI시험인증1팀" in why


def test_classified_has_no_hint():
    spec, why = output_spec_for("SST-K-TP-7-08-06(00) 시험성적서.docx", _SPEC)
    assert spec is not None and why == ""


def test_suggestion_mentions_team_check():
    _, why = output_spec_for("아무거나.hwpx", _SPEC)
    assert "팀 선택" in structure_suggestion(why)
