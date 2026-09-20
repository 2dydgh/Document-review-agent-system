"""**이 저장소에서 "에이전트"는 여기 하나를 뜻한다.**

모델이 판정 대신 도구를 부르고 → 코드가 도구를 돌려 결과를 다시 물리고 →
모델이 낸 근거를 코드가 원문과 대조하는 루프. 그 부품이 이 폴더에 있다.

    parsing.py   응답에서 JSON 하나를 골라낸다(results | tool)
    tools.py     DocTools — find_term · read_section
    verify.py    verify_quotes — 인용이 문서에 실재하는지 문자열로 대조

지금 이 루프를 쓰는 곳은 셋이다.

    agent_quality/rescue.py          인용을 못 댄 지적에게 다시 기회를 준다
    agent_quality/consistency.py     조각 밖을 봐야 판정되는 기준
    agent_trace/missing_judge.py     누락이 설계 없음인지 ID 미부여인지

**`agent_format` · `agent_trace` 같은 모듈 이름의 `agent` 는 이것이 아니다.**
그쪽은 요구사항 문서가 정한 **검토 담당 영역**(형식·완전성, 정합성·추적성 …)
이라 도구 루프와 무관하다. 낱말이 겹칠 뿐이다.

도구를 늘릴 때: `DocTools.SPECS` 에 추가하는 것만으로는 모델이 안 쓴다.
**응답 형식 블록 안에** 넣어야 한다 — 프롬프트 끝에 덧붙이면 모델이 쳐다보지
않는다(실측 2026-09-02, Qwen3.8-27B: 끝에 붙임 0/3 · 형식 블록 (1)번 3/3).
"""
