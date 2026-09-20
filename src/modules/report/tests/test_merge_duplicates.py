"""같은 근거·같은 종류의 중복 지적 병합(collector.merge_duplicates).

LLM 은 청크×기준묶음마다 따로 불려서 같은 문장을 같은 이유로 두세 번 지적한다
(실측 PLT56 RVVR: '운영권 조정/운영권조정' 모순 두 장). 카드가 두 장이면 검토자는
서로 다른 문제로 읽는다 — 내용이 같으면 카드도 하나다.
"""
from modules.report import merge_duplicates
from modules.shared import Anchor, Evidence, Finding, Severity


def _f(kind, quotes, section="22.2", message="용어 불일치", checker="consistency"):
    a = Anchor(page=1, section=section)
    return Finding(checker=checker, severity=Severity.MAJOR, message=message,
                   anchor=a, kind=kind,
                   evidence=[Evidence(anchor=a, quote=q) for q in quotes])


def test_같은_종류_같은_절_같은_인용이면_하나로_합친다():
    a = _f("모순", ["운영권 조정", "운영권조정"], message="표기가 일관되지 않다")
    b = _f("모순", ["운영권 조정", "운영권조정"], message="띄어쓰기가 갈린다")
    out, replaced = merge_duplicates([a, b])
    assert out == [a]
    assert replaced == {id(b): a}


def test_검사기가_달라도_내용이_같으면_합친다():
    a = _f("모순", ["운영권 조정", "운영권조정"], checker="consistency")
    b = _f("모순", ["운영권조정", "운영권 조정"], checker="consistency_doc")
    out, _ = merge_duplicates([a, b])
    assert out == [a], "인용 순서·검사기가 달라도 내용은 같다"


def test_종류가_달라도_근거가_부분집합이면_합친다():
    """종류(kind)는 모델이 붙이는 라벨이라 같은 결함을 회차마다 다르게 분류한다.

    실측(2026-08-31, PRJX-DS-014 §2.2.1): 같은 식별자 오류가 `표기` 한 장(근거 1개)과
    `모순` 한 장(근거 2개, 앞 1개를 포함)으로 떴다. 근거가 더 많은 쪽을 남긴다.
    """
    thin = _f("표기", ["| DS-SUD-PR-03-00 | 레포트 화면 |  |"], message="3자리 규칙 위반")
    thick = _f("모순", ["| DS-SUD-PR-03-00 | 레포트 화면 |  |",
                       "레포트 화면 [ID: DS-SUD-PR-03-003]"], message="목록과 정의가 다르다")
    out, replaced = merge_duplicates([thin, thick])
    assert out == [thick]
    assert replaced == {id(thin): thick}


def test_근거가_겹치지_않으면_안_합친다():
    """완화한 뒤에도 남는 방어선이다 — 같은 절이어도 서로 다른 문장을 물었으면
    다른 결함이다(문구까지 같은 경우만 위에서 따로 합친다)."""
    a = _f("모순", ["운영권 조정"], message="용어가 갈린다")
    b = _f("표기", ["해안선 관리"], message="띄어쓰기가 갈린다")
    out, replaced = merge_duplicates([a, b])
    assert out == [a, b] and not replaced


def test_규칙_지적은_이_완화에_안_걸린다():
    """kind 없는 규칙 지적은 다른 경로다. 같은 표 행을 물어도 "TBD 가 남았다"와
    "식별자가 틀렸다"는 섞이면 안 된다."""
    q = "| DS-SUD-PR-03-00 | 레포트 화면 |  |"
    a = _f("", [q], checker="completeness", message="미완성 표시가 남아 있습니다")
    b = _f("모순", [q], checker="consistency", message="식별자가 일치하지 않는다")
    out, replaced = merge_duplicates([a, b])
    assert out == [a, b] and not replaced


def test_절이_달라도_문구가_같으면_한_결함이다():
    """문서 전체 점검은 문서를 관통하는 결함을 낸다. 카드의 절은 첫 근거가
    어디 있었나일 뿐이라, 근거가 여러 절에 흩어지면 같은 결함이 카드 두 장이
    됐다 — 실측(PRJX-DS-014): "날짜 표기 형식이 혼용되었다" 가 §3.1.1.2 와
    §3.1.5.4 로 갈렸고, 다음 회차에 한 장으로 나오자 반영 확인이 남는 쪽을
    `안 보임` 으로 냈다.

    **근거는 합집합이다.** 절이 다르다는 것은 근거가 서로 다른 자리에 있다는
    뜻이라, 버리면 그 자리의 형광펜이 사라진다."""
    a = _f("모순", ["2025. 11. 21."], section="3.1.1.2", message="날짜 표기가 혼용됐다")
    b = _f("모순", ["2025. 07. 23."], section="3.1.5.4", message="날짜 표기가 혼용됐다")
    out, replaced = merge_duplicates([a, b])
    assert out == [a]
    assert replaced == {id(b): a}
    assert [e.quote for e in a.evidence] == ["2025. 11. 21.", "2025. 07. 23."]


def test_문구가_다르면_절이_달라도_남남이다():
    """문구는 모델이 값까지 적어 낸다 — 다른 결함이면 다르게 쓴다."""
    a = _f("모순", ["운영권 조정"], section="22.2", message="용어 표기가 갈린다")
    b = _f("모순", ["해안선 관리"], section="3.1", message="날짜 표기가 갈린다")
    out, replaced = merge_duplicates([a, b])
    assert out == [a, b] and not replaced


def test_근거나_종류가_없으면_건드리지_않는다():
    # 규칙 검사(kind 없음)·미검토 INFO(근거 없음)는 동일성을 주장할 신호가 없다.
    a = Finding(checker="completeness", severity=Severity.MAJOR,
                message="필수 항목 누락: 1.0 Purpose", anchor=Anchor(page=None, section=None))
    b = Finding(checker="completeness", severity=Severity.MAJOR,
                message="필수 항목 누락: 1.0 Purpose", anchor=Anchor(page=None, section=None))
    out, replaced = merge_duplicates([a, b])
    assert out == [a, b] and not replaced


def test_kind_없는_규칙_지적도_검사기_문장_근거가_같으면_합친다():
    """실측: 약어 체커가 기준 셋에 각각 붙어 같은 카드가 세 장 떴다."""
    a = Anchor(page=3, section="1.5")
    e = [Evidence(anchor=a, quote="| 용어 작성 | 용어 설명 작성 |")]
    fs = [Finding(checker="completeness", severity=Severity.MAJOR, anchor=a, evidence=e,
                  message="약어 목록이 비어 있습니다") for _ in range(3)]
    out, replaced = merge_duplicates(fs)
    assert len(out) == 1
    assert set(replaced) == {id(fs[1]), id(fs[2])} and all(v is fs[0] for v in replaced.values())


def test_kind_없는_규칙_지적은_문장이_다르면_안_합친다():
    """TBD 지적 둘 — 같은 절·같은 검사기지만 행이 다르면 다른 결함이다."""
    a = Anchor(page=9, section="3.1.1.2")
    x = Finding(checker="completeness", severity=Severity.MAJOR, anchor=a,
                evidence=[Evidence(anchor=a, quote="| API 요청 처리 | TBD |")],
                message="미완성 표시가 남아 있습니다: 'API 요청 처리' 행")
    y = Finding(checker="completeness", severity=Severity.MAJOR, anchor=a,
                evidence=[Evidence(anchor=a, quote="| 시스템 관리 | TBD |")],
                message="미완성 표시가 남아 있습니다: '시스템 관리' 행")
    out, _ = merge_duplicates([x, y])
    assert len(out) == 2


def test_LLM_지적은_근거가_부분집합이면_합치고_근거_많은_쪽을_남긴다():
    """실측: 같은 모순이 근거 둘·근거 하나로 따로 나왔다 — LLM 은 실행마다 근거 수가 흔들린다."""
    a = Anchor(page=7, section="2.2.1")
    q1 = Evidence(anchor=a, quote="| DS-SUD-PR-03-00 | 레포트 화면 |")
    q2 = Evidence(anchor=Anchor(page=43, section="3.1.5.4"),
                  quote="레포트 화면 [ID: DS-SUD-PR-03-003]")
    one = Finding(checker="consistency_doc", severity=Severity.MAJOR, anchor=a, kind="모순",
                  evidence=[q1], message="식별자가 다르게 표기되어 있다")
    two = Finding(checker="consistency_doc", severity=Severity.MAJOR, anchor=a, kind="모순",
                  evidence=[q1, q2], message="식별자가 일치하지 않는다")
    out, replaced = merge_duplicates([one, two])
    assert out == [two]                       # 근거 많은 쪽이 남는다
    assert replaced == {id(one): two}


def test_근거가_겹치지_않으면_같은_종류_같은_절이어도_안_합친다():
    a = Anchor(page=7, section="2.2.1")
    x = Finding(checker="consistency_doc", severity=Severity.MAJOR, anchor=a, kind="모순",
                evidence=[Evidence(anchor=a, quote="A 는 B 다")], message="m1")
    y = Finding(checker="consistency_doc", severity=Severity.MAJOR, anchor=a, kind="모순",
                evidence=[Evidence(anchor=a, quote="C 는 D 다")], message="m2")
    out, _ = merge_duplicates([x, y])
    assert len(out) == 2


# ── 검토 상태 보고는 지적이 아니다 ────────────────────────────────────────

def test_미검토_보고는_불일치로_떨어지지_않는다() -> None:
    """`kind` 기본값이 mismatch 라, 문서에 안 매인 것이 전부 "불일치"로 떴다.

    실측(2026-09-03): "누락 1건은 판정하지 못했습니다" 라는 보고가 화면에
    `불일치 · AI 대조 · — ↔ —` 로 떴다. 검토자는 그걸 AI 가 찾은 결함으로
    읽는다. 집계는 이미 info 를 빼고 있었는데(_stats) 목록만 안 걸렀다.
    """
    from modules.report.ui_export import _finding_to_ui
    from modules.shared import Anchor, Finding, Severity

    notice = Finding(checker="traceability", severity=Severity.INFO,
                     message="누락 1건은 판정하지 못했습니다.",
                     anchor=Anchor(page=None, section=None), unreviewed=True)

    got = _finding_to_ui(notice, 0)

    assert got["type"] == "notice", got
    # 문서 자리를 가리키지 않는다 — 그리면 자리를 못 찾은 지적처럼 읽힌다.
    assert got["a"] is None and got["b"] is None


def test_진짜_불일치는_그대로_불일치다() -> None:
    from modules.report.ui_export import _finding_to_ui
    from modules.shared import Anchor, Finding, Severity

    real = Finding(checker="consistency", severity=Severity.MINOR,
                   message="응답 시간이 3초와 5초로 어긋난다.",
                   anchor=Anchor(page=None, section="3.5"))

    got = _finding_to_ui(real, 1)

    assert got["type"] == "mismatch"
    assert got["b"] == "3.5"
