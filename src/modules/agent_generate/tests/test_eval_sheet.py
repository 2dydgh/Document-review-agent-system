"""팀 평가 체크리스트 시트(행 목록)를 평가 항목으로 읽는다. 열은 이름으로 찾는다."""
from __future__ import annotations

import pytest

from modules.agent_generate import EvalSheetError, read_eval_items, sheet_documents

# B-1 (요건BTP) 꼴: 제목 행 + 헤더 + 병합 셀(빈 칸) + Rev 비교 열
B1 = [
    ["문서 검토(요건 단계)", "", "", "Rev.06", "", "Rev.05"],
    ["Characteristic", "Detail\nCharacteristic", "ID", "Evaluation Item",
     "비교 (Rev.05, Rev.06)", "Evaluation Item"],
    ["Functional Characteristic", "Accuracy", "VR01-01",
     "Accuracy requirements should be provided.", "=EXACT(F3,D3)", "old text"],
    ["", "", "VR01-02", "Accuracy requirements should be stated numerically.",
     "=EXACT(F4,D4)", "old text"],
    ["", "Functionality", "VR02-01", "Functionality means that the operations work.", "", ""],
    ["", "", "", "", "", ""],
]

# A-1 (개념BTP) 꼴: Documents 열 + 평가 항목 한글 열
A1 = [
    ["Documents", "Characteristic", "Detail Characteristic", "ID", "Evaluation Item", "평가 항목"],
    ["SMP", "management characteristics", "Purpose", "BT-M-PU-01",
     "Purpose should be defined.", "목적을 정의"],
    ["SVVP", "management characteristics", "Purpose", "BT-V-PU-01", "SVVP purpose.", "SVVP 목적"],
]


def test_병합_셀은_위_값을_이어받고_수식_열은_안_읽는다() -> None:
    items = read_eval_items(B1)
    assert [it.id for it in items] == ["VR01-01", "VR01-02", "VR02-01"]
    assert items[1].characteristic == "Functional Characteristic"
    assert items[1].detail == "Accuracy"
    assert items[2].detail == "Functionality"
    assert items[0].item == "Accuracy requirements should be provided."
    assert items[0].item_ko == ""


def test_documents_열이_있으면_문서로_거른다() -> None:
    assert sheet_documents(A1) == ["SMP", "SVVP"]
    assert sheet_documents(B1) == []
    smp = read_eval_items(A1, document="SMP")
    assert [it.id for it in smp] == ["BT-M-PU-01"]
    assert smp[0].document == "SMP" and smp[0].item_ko == "목적을 정의"
    assert len(read_eval_items(A1)) == 2


def test_tbd_id는_순번을_붙이고_원래_값을_남긴다() -> None:
    rows = [["Characteristic", "Detail Characteristic", "ID", "Evaluation Item"],
            ["6.2.1", "Scope", "TBD", "The decomposition description records."],
            ["", "", "TBD", "It describes the way the system is structured."]]
    items = read_eval_items(rows)
    assert [it.id for it in items] == ["TBD-01", "TBD-02"]
    assert items[0].raw_id == "TBD" and items[1].raw_id == "TBD"


def test_필수_열이_없으면_어느_열인지_말하며_거절한다() -> None:
    with pytest.raises(EvalSheetError, match="Evaluation Item"):
        read_eval_items([["Rules", "Generic Characteristics", "Significance"],
                         ["2.1", "Dynamic Memory", "Minimize allocation."]])
    with pytest.raises(EvalSheetError, match="ID"):
        read_eval_items([["Characteristic", "Evaluation Item"], ["x", "y"]])


def test_detail_original_열보다_번역_열을_고른다() -> None:
    rows = [["Documents", "Detail Characteristic\n(original)", "Detail Characteristic", "ID",
             "Evaluation Item", "평가아이템"],
            ["SMP", "-", "Process Model", "NU-M-PR-01", "Is timing realistic?", "현실적인가"]]
    it = read_eval_items(rows)[0]
    assert it.detail == "Process Model" and it.item_ko == "현실적인가"


def test_to_dict_은_화면이_쓰는_열쇠를_전부_낸다() -> None:
    d = read_eval_items(B1)[0].to_dict()
    assert set(d) == {"id", "raw_id", "item", "characteristic", "detail", "item_ko",
                      "viewpoint", "document"}
