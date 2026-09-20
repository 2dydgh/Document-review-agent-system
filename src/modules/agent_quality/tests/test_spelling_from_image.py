"""그림에서 읽은 글자로 표기를 판정하지 않는다.

무슨 일이 났나 (2026-08-31, PRJX-DS-005 §3.1.4.2). 그 절의 본문은 `[그림 18]`
`[그림 19]` 두 줄이 전부다. 비전 모델이 화면 캡처 속 표를 옮겨 적으면서
`매우 높음` 을 `태우 높음` 으로, `야간` 을 `아칸` 으로 읽었고, LLM 이 그것을
오탈자로 지적해 `표기` major 로 리포트에 올랐다. 문서에는 그런 글자가 없다.

**환각 관문이 이것을 못 막는다.** `verify_quotes` 는 "이 인용이 문서에
있는가"만 보는데, 그 글자는 본문에 실재한다 — `describe_images` 가 채운
`[그림 18: …]` 줄에. 대조 상대가 원문이 아니라 다른 모델의 산출물이라
방어가 겉으로만 통과한다.

**버리지 않는다.** 그림 안의 진짜 오타일 수 있다. 등급을 내리고 미검토로
넘긴다 — "0건 통과"와 "검토를 못 했다"를 섞지 않는다(루트 CLAUDE.md).
"""
from __future__ import annotations

from dataclasses import dataclass

from modules.agent_quality.consistency import _spelling_from_image_only


@dataclass
class _E:
    """Evidence 중 이 판정이 보는 것만."""
    image_no: int | None = None


def test_그림_근거뿐인_표기_지적을_가려낸다() -> None:
    assert _spelling_from_image_only("표기", [_E(18), _E(18)])


def test_원문_근거가_하나라도_있으면_그대로_간다() -> None:
    """원문에 실재하는 인용이 하나라도 있으면 그것으로 판정할 수 있다."""
    assert not _spelling_from_image_only("표기", [_E(18), _E(None)])


def test_뜻을_따지는_지적은_그림에서_읽어도_살린다() -> None:
    """좁게 건다. 구성도의 시스템 이름이 본문에 없는 문서가 실제로 있었다 —
    그 값어치를 죽이면 그림을 읽는 이유가 사라진다."""
    assert not _spelling_from_image_only("모순", [_E(18)])
    assert not _spelling_from_image_only("모호", [_E(18)])


def test_근거가_없으면_이_판정의_대상이_아니다() -> None:
    """근거 0건은 다른 관문이 이미 처리했다(rescue · dropped_outright).
    여기서 참을 내면 `all([])` 때문에 조용히 INFO 로 강등된다."""
    assert not _spelling_from_image_only("표기", [])
