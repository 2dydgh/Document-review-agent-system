"""지적사항 수집: 중복 제거 + 심각도 정렬."""
from __future__ import annotations

from dataclasses import replace

from modules.shared import Finding, Severity

_ORDER = {Severity.MAJOR: 0, Severity.MINOR: 1, Severity.INFO: 2}


def stamp(source, findings) -> list[Finding]:
    """지적에 **무엇이 잡았나**(label)를 찍는다.

    source 는 체커 객체이거나 그냥 이름 문자열이다. 문자열도 받는 이유: 모든 지적이
    체커에서 나오지는 않는다 — 산출물 간 대조(`compare_pair`)와 전체 대조
    (`compare_case_wide`)는 **함수**라 label 을 들 자리가 없다. 그것들을 빼먹으면
    화면 뱃지가 거기서만 `MAJOR` 로 되돌아간다(실제로 그랬다).

    체커가 Finding 마다 자기 이름을 적게 하지 않는 이유: 아홉 군데에 같은 말을
    되풀이하게 되고, 새 체커가 그걸 빠뜨려도 아무도 모른다. **무엇이 검사했는지
    아는 자리**가 한 번에 찍는다.

    이미 label 이 있으면 두지 않는다 — 조립 계층이 더 정확한 이름을 붙였을 수 있다.
    """
    label = source if isinstance(source, str) else (getattr(source, "label", "") or "")
    if not label:
        return list(findings)
    return [f if f.label else replace(f, label=label) for f in findings]


def merge_duplicates(findings: list[Finding]) -> tuple[list[Finding], dict[int, Finding]]:
    """같은 절·같은 근거 인용 집합의 지적을 하나로 합친다.

    LLM 은 청크×기준묶음마다 따로 불려서, 같은 문장을 같은 이유로 두세 번
    지적한다(실측 PLT56 RVVR: '운영권 조정/운영권조정' 모순 두 장, §4 문장 붕괴
    두 장). 내용이 같으니 카드도 하나여야 한다 — 문구가 조금 다른 쪽은 버려지지만
    남는 카드가 같은 근거로 같은 종류의 잘못을 이미 말한다.

    근거가 없는 지적(INFO 보고·미검토)은 합치지 않는다 — 동일성을 주장할 신호가
    없는데 합치면 다른 지적을 삼키게 된다.

    kind 가 없는 규칙 지적도 합친다 — 단 **검사기·문장·근거가 전부 같을 때만.**
    규칙 체커는 결정적이라 같은 문장을 내면 같은 결함이다. 실측(2026-08-26,
    PRJX-DS-014): 약어 체커가 기준 셋(공통 C2·팀 F2.3-3·DVR05-02)에 각각 붙어
    "약어 목록이 비어 있습니다"가 카드 세 장으로 떴고 번호도 셋(1·21·22)이었다.
    검사기 열쇠가 params 유무로 갈려(checker_key) 결과 객체가 셋이 된 것이다.
    기준 쪽 참조는 아래 replaced 로 살아남으므로 "기준: … 외 2건" 으로 셋 다 보인다.

    반환: (생존 목록, {버린 지적의 id(): 생존 지적}). 체크리스트 항목이 버린
    지적을 참조하고 있으면 이 맵으로 생존 지적으로 갈아끼운다 — 항목 쪽 참조를
    끊으면 "이 기준에서 나온 지적"이 조용히 사라진다.
    """
    out: list[Finding] = []
    replaced: dict[int, Finding] = {}
    by_key: dict[tuple, Finding] = {}
    # LLM 지적은 근거가 **부분집합**이어도 합친다. 실측(2026-08-26, PRJX-DS-014):
    # 같은 "레포트 화면 ID 불일치" 가 한 번은 근거 둘(목록+상세정의), 한 번은 하나(목록)로
    # 나와 완전 일치로는 안 합쳐졌다 — LLM 은 실행마다 근거 수가 흔들린다. 같은 종류·
    # 같은 절에서 한쪽 근거가 다른 쪽에 다 들어 있으면 같은 지적이다. 근거가 더 많은
    # 쪽을 남긴다(카드에 형광펜이 더 많이 붙는다). 규칙 지적은 결정적이라 그대로 둔다.
    llm_groups: dict[tuple, list[Finding]] = {}
    # (종류, 문구) → 그 문구로 이미 선 카드. **문구가 똑같으면 절이 달라도 한 결함이다.**
    by_message: dict[tuple, Finding] = {}
    for f in findings:
        quotes = tuple(sorted("".join((e.quote or "").split())
                              for e in (f.evidence or [])))
        kind = getattr(f, "kind", "") or ""
        if not quotes:
            out.append(f)
            continue
        section = getattr(f.anchor, "section", None)
        if kind:
            # **문구가 똑같으면 절이 달라도 한 결함이다.** 문서 전체 점검
            # (`consistency_doc`)은 문서를 관통하는 결함을 내는데, 카드의 절은
            # 첫 근거가 어디 있었나일 뿐이다 — 근거가 여러 절에 흩어지면 절이
            # 열쇠인 아래 묶음에서 갈라져 **같은 결함이 카드 두 장**이 된다.
            #
            # 실측(2026-08-31, PRJX-DS-014): "날짜 표기 형식이 혼용되었다" 가
            # §3.1.1.2 와 §3.1.5.4 두 장으로 떴다 — 문구는 한 글자도 안 틀렸고
            # 각각 근거 하나씩만 물었다. 다음 회차에 한 장으로 나오자 반영 확인이
            # 남는 쪽을 `안 보임` 으로 냈다. 검토자에게는 "안 고친 문서를 두 번
            # 넣었는데 지적이 사라졌다" 로 보인다.
            #
            # 근거는 **합집합**이다. 버리면 그 자리의 형광펜이 사라진다 — 절이
            # 다르다는 것은 곧 근거가 서로 다른 자리에 있다는 뜻이다.
            twin = by_message.get(f.message)
            if twin is not None:
                have = set(_quote_set(twin))
                twin.evidence = list(twin.evidence) + [
                    e for e in (f.evidence or [])
                    if "".join((e.quote or "").split()) not in have]
                replaced[id(f)] = twin
                continue
            # **종류(kind)는 열쇠가 아니다.** 모델이 붙이는 라벨이라 같은 결함을
            # 회차마다 다르게 분류한다. 실측(2026-08-31, PRJX-DS-014 §2.2.1):
            #   `표기`  "식별자가 3자리로 끝나 규칙에 어긋난다"   근거 1개
            #   `모순`  "목록은 -00, 상세 정의는 -003"           근거 2개(위 1개 포함)
            # 같은 절에서 한쪽 근거가 다른 쪽에 통째로 들어 있는데 라벨만 달라
            # 카드가 두 장이었다. 검토자에게는 같은 결함이 두 번 지적된 것으로 보인다.
            #
            # 대가는 진 쪽의 종류와 문구가 사라지는 것이다 — 한 문장에 오타도 있고
            # 앞뒤 모순도 있으면 한쪽만 남는다. 실측된 손해(같은 결함이 카드 여럿,
            # 이력 대조가 끊김)가 아직 실측된 적 없는 그 손해보다 크다고 보고 골랐다.
            # 규칙 지적(kind 없음)은 아래 다른 경로라 이 완화에 안 걸린다 — 같은 표
            # 행을 무는 "TBD 가 남았다"와 "식별자가 틀렸다"가 섞이지 않는다.
            group = llm_groups.setdefault(section, [])
            qs = set(quotes)
            keep = next((g for g in group
                         if qs <= set(_quote_set(g)) or set(_quote_set(g)) <= qs), None)
            if keep is None:
                group.append(f)
                out.append(f)
                by_message[f.message] = f
            elif len(qs) > len(_quote_set(keep)):
                # 새 것이 근거가 더 많다 — 그쪽을 남기고 옛 것을 갈아끼운다.
                group[group.index(keep)] = f
                out[out.index(keep)] = f
                replaced[id(keep)] = f
                for k, v in list(replaced.items()):
                    if v is keep:
                        replaced[k] = f
                # 문구 열쇠도 새 생존자로 돌린다 — 안 돌리면 다음 쌍둥이가
                # 밀려난(이미 out 에 없는) 카드에 근거를 붙인다.
                for k, v in list(by_message.items()):
                    if v is keep:
                        by_message[k] = f
                by_message[f.message] = f
            else:
                replaced[id(f)] = keep
            continue
        # kind 없는 규칙 지적은 문장까지 같아야 한다 — 결정적이라 다르면 다른 결함.
        key = ("rule", f.checker, f.message, section, quotes)
        keep = by_key.get(key)
        if keep is None:
            by_key[key] = f
            out.append(f)
        else:
            replaced[id(f)] = keep
    return out, replaced


def _quote_set(f: Finding) -> tuple[str, ...]:
    return tuple("".join((e.quote or "").split()) for e in (f.evidence or []))


def collect(findings: list[Finding]) -> list[Finding]:
    seen = set()
    unique: list[Finding] = []
    for f in findings:
        key = (f.checker, f.severity, f.message, f.anchor, f.document)
        if key in seen:
            continue
        seen.add(key)
        unique.append(f)
    return sorted(unique, key=lambda f: _ORDER[f.severity])
