"""로그인을 누른 뒤 홈이 뜨기까지.

예전엔 로그인하자마자 홈이 떴다. 그런데 팀 기준(criteria layers)과 검토
기록(history)이 아직 안 와서 기준 타일이 빈 채로 떴다가 뒤늦게 채워졌다 —
다 그려진 화면이 눈앞에서 한 번 더 고쳐지는 셈이었다.

**로딩 화면을 따로 만들지 않는다.** 한 번 만들어 봤다가 지웠다(2026-09-02):
로그인 화면이 이미 그 자리고 버튼도 벌써 돌고 있어서, 겹칠 화면을 하나 더 둘
이유가 없었다. 말만 바꿔 준다.

여기서 지키는 것은 셋.

1. **가짜 로딩이 아니다.** 시간을 재서 감추는 게 아니라 그 두 요청을 실제로
   기다린다. 그러려면 두 적재 함수가 프로미스를 돌려줘야 한다.
2. **사람을 가두지 않는다.** 성공이든 실패든 반드시 넘어가고, 서버가 늦으면
   상한에서 놓아준다. 홈은 못 읽은 사실을 제 자리에서 말할 수 있다.
3. **기다리는 동안 로그인 화면을 다시 그리지 않는다.** 그 화면은 입력과 버튼
   상태를 DOM 에만 들고 있어서, 다시 그리면 방금 친 글자와 도는 버튼이 날아간다.
"""
from __future__ import annotations

from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
APP_JS = (_ROOT / "web" / "app.js").read_text(encoding="utf-8")
API_JS = (_ROOT / "web" / "api.js").read_text(encoding="utf-8")
VIEWS_JS = (_ROOT / "web" / "views.js").read_text(encoding="utf-8")


def _do_login() -> str:
    body = APP_JS[APP_JS.index("    doLogin: function()"):]
    return body[:body.index("\n    },")]


def test_홈은_기준과_기록을_실제로_기다린_뒤에_뜬다() -> None:
    login = _do_login()
    assert "Promise.all([loadHomeCriteria(), loadHistory(true)])" in login, \
        "기다리는 대상이 진짜 요청 둘이 아니다 — 시간만 재면 가짜 로딩이다"
    # 그 둘이 프로미스를 안 돌려주면 위 Promise.all 은 즉시 끝나 아무것도 안 기다린다.
    crit = APP_JS[APP_JS.index("  function loadHomeCriteria()"):]
    crit = crit[:crit.index("\n  }")]
    assert "return fetchCriteriaLayers" in crit, "loadHomeCriteria 가 프로미스를 안 준다"
    assert "return Promise.resolve()" in crit, "일찍 빠지는 길이 프로미스를 안 준다"
    hist = API_JS[API_JS.index("  function loadHistory(quiet)"):]
    hist = hist[:hist.index("\n  }")]
    assert "return fetch(" in hist, "loadHistory 가 프로미스를 안 준다"
    assert "return Promise.resolve()" in hist, "일찍 빠지는 길이 프로미스를 안 준다"
    # 기다리는 동안에는 로그인 화면이 그대로 있어야 한다 — mode 를 먼저 바꾸면
    # 빈 홈이 떴다가 채워지는 예전 증상 그대로다.
    before = login[:login.index("Promise.all([loadHomeCriteria()")]
    assert 'state.mode = "home"' not in before, "다 읽기 전에 홈으로 넘어간다"


def test_기다리는_동안_로그인_화면을_다시_그리지_않는다() -> None:
    """로그인·회원가입 화면은 입력과 버튼 상태를 DOM 에만 들고 있다.

    실측(2026-09-02): 로그인을 누르면 백그라운드 적재 셋(health·criteria·history)이
    차례로 돌아오며 화면을 세 번 갈았다. 그때마다 버튼 글이 "로그인"으로
    되돌아가고 히어로 연출이 처음부터 다시 돌아 — "로그인 처리 중"은 보이지도
    않고 화면만 버벅였다.
    """
    assert "function onAuthScreen()" in API_JS, "인증 화면을 가리는 판단이 없다"
    cfg = API_JS[API_JS.index("  function loadServerConfig()"):]
    cfg = cfg[:cfg.index("\n  }")]
    assert "if (!onAuthScreen()) render()" in cfg, "설정 적재가 로그인 화면을 다시 그린다"

    crit = APP_JS[APP_JS.index("  function loadHomeCriteria()"):]
    crit = crit[:crit.index("\n  }")]
    assert 'if (state.mode === "home") render()' in crit, \
        "기준 적재가 홈이 아닌 화면까지 다시 그린다"

    # loadHistory 는 quiet 일 때 홈·기록 화면에서만 그린다 — 그 조건을 살려 쓴다.
    login = _do_login()
    assert "loadHistory(true)" in login, "기록 적재가 조용한 길을 안 쓴다"


def test_로그인_화면에_갇히지_않는다() -> None:
    login = _do_login()
    # 거절 하나로 멈추면 버튼이 영원히 돌고 새로고침 말고는 나갈 길이 없다.
    assert ".then(go, go)" in login, "실패했을 때 넘어가는 길이 없다"
    # 서버가 늦거나 죽어도 놓아준다.
    assert "MAX" in login and "Promise.race" in login, "상한이 없다"
    assert 'state.mode = "home"' in login, "홈으로 가는 곳이 없다"


def test_로딩_전용_화면을_다시_만들지_않는다() -> None:
    """한 번 만들었다가 지웠다 — 로그인 화면이 이미 그 자리다."""
    assert "splashView" not in VIEWS_JS, "겹치는 로딩 화면이 되살아났다"
    assert "state.splash" not in APP_JS, "쓰이지 않는 로딩 상태가 남았다"


def test_세션을_확인하기_전에는_안_그린다() -> None:
    """쿠키가 살아 있는 사람에게 로그인 화면이 번쩍 떴다가 홈으로 바뀌었다.

    실측(2026-09-02): 부팅이 state.mode="login" 인 채로 먼저 그리고 **그다음**
    세션을 물었다. 세션이 있는 사람에게는 새로고침마다 로그인 화면이 한 번
    보였다 — 화면이 거짓말을 한 셈이다.

    첫 그리기를 세션 응답 뒤로 미룬다. 서버가 없으면(정적 미리보기) 물어볼 데가
    없으니 바로 그린다.
    """
    boot = APP_JS[APP_JS.index("  function boot() {"):]
    boot = boot[:boot.index("\n  }")]
    assert "var firstPaint" in boot, "첫 그리기를 미루는 자리가 없다"
    # 세션 확인 **앞에서** 그리면 도로 번쩍인다.
    before = boot[:boot.index('fetch("api/auth/me")')]
    assert "firstPaint()" not in before, "세션을 묻기 전에 그린다"
    # 성공·실패 양쪽 다 그려야 한다 — 실패했는데 안 그리면 빈 화면에 갇힌다.
    after = boot[boot.index('fetch("api/auth/me")'):]
    assert after.count("firstPaint()") >= 3, \
        "세션 성공·실패·서버 없음 셋 중 빠진 길이 있다 — 빈 화면에 갇힌다"
