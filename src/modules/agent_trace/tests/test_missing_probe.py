"""누락 요건의 "어디를 볼지" 짚기.

여기서 지키는 것은 넷.

1. **없으면 없다고 한다.** 억지로 후보를 채우면 검토자가 헛걸음한다.
2. **문서에 실재하는 절만 낸다.** 후보를 하위 문서 절에서 고르므로 지어낼
   자리가 자체가 없다 — 환각을 코드가 아니라 구조가 막는다(CLAUDE.md).
3. **왜 이 절인지 말한다.** 겹친 낱말을 함께 낸다. 점수만 주면 숫자를
   믿으라는 말이 된다.
4. **흔한 말만 겹친 절은 후보가 아니다.** "시스템 · 기능 · 데이터"는 어느
   문서에나 있어서, 그것만으로 짚으면 목록이 아무 절로 채워진다.
"""
from __future__ import annotations

from modules.agent_trace.missing_probe import probe_missing
from modules.shared import Anchor, Document, Section


def _doc(*secs: tuple[str, str, str]) -> Document:
    return Document(
        source_path="child.hwpx", doc_type="SDD",
        sections=[Section(id=f"s{i}", title=t, level=2, text=body,
                          anchor=Anchor(page=i + 1, section=num))
                  for i, (num, t, body) in enumerate(secs)])


def test_같은_내용을_다루는_절을_짚는다() -> None:
    child = _doc(
        ("5.1", "로그인 화면", "사용자 계정과 비밀번호를 입력받아 인증한다."),
        ("6.2", "알고리즘 성능 모니터링",
         "탐지 알고리즘의 정확도와 지연 시간을 주기적으로 수집하여 대시보드에 표시한다."),
        ("7.3", "백업", "일 단위로 스냅샷을 남긴다."))
    hits = probe_missing(
        "탐지 알고리즘의 정확도와 지연 시간을 모니터링할 수 있어야 한다.", child)
    assert hits, "대응하는 절이 있는데 못 짚었다"
    assert hits[0].anchor_section == "6.2", [h.anchor_section for h in hits]
    # 왜 그 절인지 — 겹친 낱말이 함께 나와야 검토자가 판단할 수 있다.
    assert hits[0].shared, "겹친 낱말을 안 알려준다"
    assert any("정확도" in w for w in hits[0].shared), hits[0].shared


def test_비슷한_절이_없으면_빈_목록이다() -> None:
    """이게 곧 "설계 자체가 없다"는 신호다. 억지로 채우면 그 신호가 죽는다."""
    child = _doc(("7.3", "백업", "일 단위로 스냅샷을 남긴다."))
    assert probe_missing(
        "생체 인증 모듈은 지문과 홍채를 구분하여 처리해야 한다.", child) == []


def test_흔한_말만_겹치면_안_짚는다() -> None:
    """"시스템·기능·데이터"는 어느 문서에나 있다 — 그것만으로 짚으면 목록이
    아무 절로 채워지고 "어디를 볼지"가 도로 흐려진다."""
    child = _doc(("2.1", "개요", "본 시스템의 기능과 데이터에 대하여 기술한다."))
    assert probe_missing("시스템은 기능과 데이터를 제공한다.", child) == []


def test_짚은_절의_본문은_문서에_실재한다() -> None:
    """후보를 문서 절에서 고르므로 지어낼 자리가 없다 — 인용 대조가 필요 없는
    이유이자, 이 방식을 고른 이유다."""
    body = "탐지 알고리즘의 정확도와 지연 시간을 주기적으로 수집한다."
    child = _doc(("6.2", "알고리즘 성능 모니터링", body))
    hits = probe_missing("탐지 알고리즘의 정확도와 지연 시간을 모니터링한다.", child)
    assert hits and hits[0].text == body


def test_후보는_셋까지만() -> None:
    """넷을 넘기면 "어디를 볼지"가 다시 흐려진다 — 좁혀 주는 것이 목적이다."""
    same = "탐지 알고리즘의 정확도와 지연 시간을 수집하여 기록한다."
    child = _doc(*[(f"{i}.1", f"절 {i}", same) for i in range(6)])
    hits = probe_missing("탐지 알고리즘의 정확도와 지연 시간을 모니터링한다.", child)
    assert len(hits) <= 3, len(hits)


def test_요건_서술이_비면_짚지_않는다() -> None:
    child = _doc(("6.2", "모니터링", "정확도를 수집한다."))
    assert probe_missing("", child) == []


def test_조사가_붙어도_같은_낱말로_본다() -> None:
    """형태소 분석기를 안 들이는 대신 낱말 앞부분만 잘라 맞춘다.
    "모니터링을"과 "모니터링" 이 갈리면 대부분의 후보를 놓친다."""
    child = _doc(("6.2", "성능 관측",
                  "알고리즘의 모니터링을 주기적으로 수행하며 정확도를 기록한다."))
    hits = probe_missing("알고리즘 모니터링과 정확도 기록이 필요하다.", child)
    assert hits, "조사 차이 때문에 못 짚는다"


def test_ID_조각으로는_짚지_않는다() -> None:
    """실측(2026-09-02, PRJX 문서쌍): 요건 서술을 못 뽑은 행에서 "겹친 말:
    001 · 01 · rq · vp · 사례 · 식별자" 로 엉뚱한 절 셋이 후보로 올라왔다.

    ID 는 문서 전체가 같은 형식을 쓰므로, 그 조각(rq · vp · 001)을 세면 **ID 를
    쓰는 절이 전부 서로 닮아 보인다.** 검토자는 그 절을 열어 보고 헛걸음한다.
    """
    child = _doc(
        ("2.1", "상세설계 식별자 부여규칙",
         "식별자 부여 형식은 RQ-종류코드-구성코드(2자리)-일련번호(3자리)이다."),
        ("3.1", "컴포넌트 목록",
         "데이터 수집 모듈 | 관련 요구사항 | RQ-SER-PR-01-001"))
    # 서술을 못 뽑아 ID 와 표 머리글만 남은 요건.
    assert probe_missing("식별자 사례 RQ-SFR-VP-01-001", child) == []


def test_내용어가_두엇뿐이면_짚지_않는다() -> None:
    """한둘로 짚으면 우연히 겹친 절이 올라온다. 못 짚는 편이 낫다 —
    화면이 "요건 서술을 못 찾았다"고 말하면 검토자가 원인을 안다."""
    child = _doc(("6.2", "성능 관측", "정확도와 지연 시간을 수집하여 기록한다."))
    assert probe_missing("정확도", child) == []


def test_이_문서에서_흔한_말은_겹친_말로_안_센다() -> None:
    """실측(PRJX 설계서): 표마다 있는 "설명·이력·출처" 와 과제 코드가 겹친 말을 채웠다."""
    from modules.shared import Anchor, Document, Section
    boiler = "출처 | PRJX 요구사항명세서 | 이력 | 최초 작성 | 검증 | 확인"
    # 표 행마다 같은 칸이 되풀이되는 설계서 모양 — 절은 셋뿐이고 줄은 많다.
    def body(i):
        rows = [f"| 항목 {i}-{j} | {boiler} | 화면을 그린다. |" for j in range(20)]
        if i == 1:
            rows[5] = f"| 항목 1-5 | {boiler} | 계정을 잠그고 인증 실패를 센다. |"
        return "\n".join(rows)
    secs = [Section(id=f"{i}", title=f"절 {i}", level=1, text=body(i),
                    anchor=Anchor(None, f"{i}")) for i in range(3)]
    doc = Document(source_path="sdd.md", doc_type="generic", sections=secs)
    hits = probe_missing("인증 실패가 반복되면 계정을 잠근다. 출처와 이력을 검증한다.", doc)
    assert hits and hits[0].anchor_section == "1"
    assert not ({"출처", "이력", "검증", "prjx"} & set(hits[0].shared))
    assert "계정을" in hits[0].shared or "인증" in hits[0].shared


def test_후보는_절의_끝_쪽도_안다() -> None:
    from modules.shared import Anchor, Document, Section
    secs = [Section(id="1", title="계정 보호", level=1,
                    text="인증 실패가 반복되면 계정을 잠근다. 잠금은 30분.",
                    anchor=Anchor(11, "1")),
            Section(id="2", title="다음 절", level=1, text="다른 내용.", anchor=Anchor(14, "2"))]
    doc = Document(source_path="sdd.md", doc_type="generic", sections=secs)
    hits = probe_missing("인증 실패가 반복되면 계정을 일정 시간 잠근다.", doc)
    assert hits and hits[0].page == 11 and hits[0].page_end == 14
    assert hits[0].to_dict()["page_end"] == 14


def test_겹친_말은_어간이_아니라_문장에_나온_낱말로_보여준다() -> None:
    from modules.shared import Anchor, Document, Section
    doc = Document(source_path="sdd.md", doc_type="generic", sections=[
        Section(id="1", title="연계", level=1, text="외부 인터페이스를 통해 정상적으로 응답한다.",
                anchor=Anchor(None, "1"))])
    hits = probe_missing("모니터링 인터페이스는 정상적으로 응답을 전달해야 한다.", doc)
    assert hits and "인터페이스는" in hits[0].shared and "인터페이" not in hits[0].shared


def test_쪽마다_되풀이되는_머릿말_절은_후보가_아니다() -> None:
    from modules.shared import Anchor, Document, Section
    body = "모니터링 인터페이스 응답 전달 알고리즘 예측"
    secs = [Section(id=f"h{i}", title="상세설계서", level=1, text=body,
                    anchor=Anchor(i + 1, f"h{i}")) for i in range(4)]
    secs.append(Section(id="3.2", title="모니터링 설계", level=1, text=body,
                        anchor=Anchor(9, "3.2")))
    doc = Document(source_path="sdd.md", doc_type="generic", sections=secs)
    hits = probe_missing("모니터링 인터페이스는 예측 결과를 응답으로 전달한다.", doc)
    assert [h.section for h in hits] == ["모니터링 설계"]
