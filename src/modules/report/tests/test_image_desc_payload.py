"""그림 설명이 화면 payload 까지 간다.

그림 번호는 문서 안 이미지의 등장 순서라 지면 어디에도 안 적혀 있다 —
"그림 1" 이라는 말만 보고 검토자가 그 그림을 찾을 길이 없었다(실측 피드백).
벡터(WMF) 그림은 PDF 에 이미지 슬롯이 없어 좌표 짝짓기가 원리상 안 되므로,
그런 그림일수록 설명이 유일한 단서다.
"""
from modules.report.ui_export import to_ui_review_payload


def test_payload_carries_image_description():
    images = [{"no": 1, "width": 2086, "height": 302,
               "part": "BinData/image1.png",
               "description": "KRISO 로고와 함께 '선박해양플랜트연구소'라는 문구"},
              {"no": 2, "width": 0, "height": 0,
               "part": "BinData/image2.wmf", "description": "데이터 흐름 순서도"}]
    payload = to_ui_review_payload([], "a.hwpx", images=images)
    by_no = {im["no"]: im for im in payload["images"]}
    assert by_no[1]["desc"].startswith("KRISO")
    # 크기를 모르는(벡터) 그림도 설명은 실린다 — 좌표를 못 내는 그림이라 더 필요하다.
    assert by_no[2]["desc"] == "데이터 흐름 순서도"
    assert by_no[2]["width"] == 0


def test_missing_description_is_empty_not_absent():
    """설명이 없어도 키는 남는다 — 화면이 undefined 를 그리지 않게."""
    payload = to_ui_review_payload([], "a.hwpx",
                                   images=[{"no": 1, "width": 10, "height": 10}])
    assert payload["images"][0]["desc"] == ""
