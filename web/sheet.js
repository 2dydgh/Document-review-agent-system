// 잡아끌어 닫는 시트 — 모달의 열림·닫힘·드래그를 한 곳에서 맡는다.
//
// 이 앱의 모달은 지금까지 CSS animation 으로 **들어오기만** 했다. 닫을 때는
// state 를 비우고 render() 가 innerHTML 을 갈아서 한 프레임에 사라졌다.
// 들어온 길과 나가는 길이 다르면 "어디로 갔는지"를 잃는다 — 여기서 나가는
// 길을 들어온 길의 역순으로 만든다.
//
// **왜 CSS 가 아니라 스프링인가.** CSS animation 은 시작하면 정해진 끝까지
// 간다. 닫히는 중인 카드를 다시 붙잡으면 CSS 는 그걸 못 받는다 — 끝까지 닫고
// 나서 다시 열리거나, 붙잡은 자리에서 끊긴다. 스프링은 목표만 바꾸면 되고
// 속도는 그대로 이어지므로 손이 언제 끼어들어도 이어진다. rAF 로 도는
// 이유가 그것 하나다.
//
// 값은 지어내지 않았다. 감쇠비·응답시간은 Apple 이 WWDC 2018 에서 쓴 표를
// 그대로 쓴다(서랍·시트 = 0.8 / 0.3). 착지 지점도 교과서의 v²/2a 가 아니라
// Apple 샘플코드의 지수감쇠식이다 — 스크롤 감속과 같은 식이라야 손끝 느낌이
// 브라우저 스크롤과 어긋나지 않는다.
(function (global) {
  "use strict";

  var DR = global.DR = global.DR || {};

  // ---- 순수 계산 ----------------------------------------------------------

  // 던진 것이 어디쯤 멈출지. (v/1000) 은 px/s 를 px/ms 로 바꾸는 것.
  function project(velocity, decelerationRate) {
    var d = decelerationRate === undefined ? 0.998 : decelerationRate;
    return (velocity / 1000) * d / (1 - d);
  }

  // 경계 밖으로 끌 때의 저항. 멀리 갈수록 덜 따라온다 — 딱 멈추면 "굳었다"로
  // 읽히고, 그대로 따라오면 경계가 없는 것처럼 보인다.
  function rubberband(overshoot, dimension, constant) {
    var c = constant === undefined ? 0.55 : constant;
    return (overshoot * dimension * c) / (dimension + c * Math.abs(overshoot));
  }

  // 닫을지 되돌릴지. **놓은 자리가 아니라 가려던 자리로 정한다.**
  // 놓은 자리로 정하면 살짝 끌고 세게 던진 손짓이 무시된다 — 손가락은 이미
  // 화면 밖을 향하는데 카드는 제자리로 돌아온다.
  //
  // threshold 는 카드 높이다(화면 밖까지의 거리가 아니다). 둘을 섞으면 큰
  // 화면에서 300px 를 끌어야 닫히는 시트가 된다 — 실제로 그렇게 짜 봤다.
  function decide(offset, velocity, threshold) {
    var landing = offset + project(velocity);
    return Math.abs(landing - threshold) < Math.abs(landing) ? "dismiss" : "return";
  }

  // ---- 스프링 -------------------------------------------------------------
  //
  // damping(감쇠비): 1 이면 튕김 없이 안착, 1 미만이면 살짝 넘어갔다 온다.
  // response(응답, 초): 목표에 닿는 속도. **지속시간이 아니다** — 스프링에는
  // 정해진 지속시간이 없고, 안착 시점은 두 값에서 따라 나온다.
  function Spring(o) {
    this.zeta = o.damping;
    this.w0 = 2 * Math.PI / o.response;
    this.x = o.from;
    this.v = o.velocity || 0;
    this.target = o.to;
  }

  // 큰 dt 를 한 번에 적분하면 발산한다(탭을 가렸다 돌아오면 카드가 날아간다).
  // 240Hz 로 잘게 나눠 적분한다.
  Spring.prototype.step = function (dt) {
    var n = Math.max(1, Math.ceil(dt / (1 / 240)));
    var h = dt / n;
    var k = this.w0 * this.w0;
    var c = 2 * this.zeta * this.w0;
    for (var i = 0; i < n; i++) {
      var a = -k * (this.x - this.target) - c * this.v;
      this.v += a * h;
      this.x += this.v * h;
    }
    return this.x;
  };

  // 눈에 안 보일 만큼 가까워지고 느려졌으면 끝난 것으로 친다.
  Spring.prototype.settled = function () {
    return Math.abs(this.x - this.target) < 0.5 && Math.abs(this.v) < 10;
  };

  // 목표만 바꾸고 속도는 그대로 둔다. 손이 방향을 뒤집었을 때 이 한 줄이
  // "벽에 부딪히는" 느낌을 없앤다 — 새 애니메이션으로 갈아치우면 그 순간
  // 속도가 0 으로 끊긴다.
  Spring.prototype.retarget = function (to) { this.target = to; };

  // ---- 움직임 줄이기 ------------------------------------------------------
  // CSS 의 @media 는 여기 안 닿는다. rAF 로 직접 움직이므로 직접 묻는다.
  function reduced() {
    return !!(global.matchMedia &&
      global.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  // ---- 그리기 -------------------------------------------------------------

  var live = {};   // key -> 시트 상태. DOM 이 아니라 여기 산다(렌더가 DOM 을 갈아도 남게).

  // 배경 딤과 카드를 **따로** 흐린다. scrim 에 opacity 를 걸면 카드까지 같이
  // 옅어져서, 살짝 끌기만 해도 글씨가 흐릿해진다.
  //
  // ref 는 "0(제자리)에서 얼마나 멀어졌나"를 재는 자다. 등장 중에는 등장 거리,
  // 그 뒤로는 카드 높이다 — 둘을 안 나누면 28px 올라오는 등장에서 흐림이
  // 이미 91% 라 **재질이 도착하는 것처럼 안 보인다**(그냥 켜진 것으로 읽힌다).
  function paint(s) {
    var el = s.el, y = s.y;
    if (!el) return;
    var t = Math.max(0, Math.min(1, y / (s.ref || s.height || 1)));
    // 흐림과 크기가 함께 자란다 — 유리가 «도착»하는 것처럼. 투명도만 바꾸면
    // 재질이 아니라 그림이 된다.
    if (!y && !t) el.style.transform = "";
    else el.style.transform = "translate3d(0," + y.toFixed(2) + "px,0) scale(" +
      (1 - 0.04 * t).toFixed(4) + ")";
    if (s.scrim) {
      s.scrim.style.backgroundColor = "rgba(0,0,0," + (s.dim * (1 - t)).toFixed(3) + ")";
      // 큰 면일수록 두껍게 읽혀야 한다 — 흐림 세기는 카드가 제 크기에 맞춰
      // data-sheet-blur 로 들고 온다(작은 확인창 12px ~ 큰 기준판 20px).
      var b = "blur(" + (s.blur * (1 - t)).toFixed(1) + "px)";
      s.scrim.style.backdropFilter = b;
      s.scrim.style.webkitBackdropFilter = b;
    }
    // 카드는 화면 밖으로 나가는 마지막 구간에서만 옅어진다 — 끌고 있는 동안은
    // 또렷해야 무엇을 쥐고 있는지 보인다.
    var out = s.exitY ? Math.max(0, Math.min(1, y / s.exitY)) : 0;
    el.style.opacity = out > 0.6 ? String(Math.max(0, (1 - out) / 0.4)) : "1";
  }

  function stop(s) {
    if (s.frame) { global.cancelAnimationFrame(s.frame); s.frame = 0; }
    s.spring = null;
  }

  // 스프링을 rAF 로 돌린다. 이미 돌고 있으면 목표만 바꾼다(속도 유지).
  function run(s, to, damping, response, velocity, done) {
    if (!s.el) return;
    if (reduced()) {                      // 움직임 줄이기: 결과만 즉시 반영
      stop(s);
      s.y = to;
      paint(s);
      if (done) done();
      return;
    }
    s.done = done || null;
    if (s.spring) {
      s.spring.retarget(to);
      if (velocity !== undefined) s.spring.v = velocity;
    } else {
      s.spring = new Spring({
        from: s.y, to: to, damping: damping, response: response,
        velocity: velocity || 0
      });
    }
    if (s.frame) return;                  // 도는 루프가 새 목표를 이어 받는다
    var last = 0;
    var tick = function (now) {
      if (!last) last = now;
      var dt = Math.min((now - last) / 1000, 0.064);   // 탭 복귀 시 큰 점프 방지
      last = now;
      if (!s.spring) { s.frame = 0; return; }
      s.y = s.spring.step(dt);
      paint(s);
      if (s.spring.settled()) {
        s.y = s.spring.target;
        paint(s);
        s.spring = null; s.frame = 0;
        if (s.done) { var d = s.done; s.done = null; d(); }
        return;
      }
      s.frame = global.requestAnimationFrame(tick);
    };
    s.frame = global.requestAnimationFrame(tick);
  }

  // 화면 밖으로 나가려면 얼마나 더 가야 하는지. 카드 높이로 대신하면 큰
  // 화면에서 카드가 화면 한복판에 남은 채 사라진다("툭 없어진다").
  function measure(s) {
    var r = s.el.getBoundingClientRect();
    s.height = r.height || s.height || 400;
    s.ref = s.height;                      // 등장이 끝났으면 자는 카드 높이다
    var vh = global.innerHeight || 800;
    s.exitY = Math.max(s.height, vh - r.top + 24) + s.y;
  }

  // ---- 드래그 -------------------------------------------------------------

  // 지금 끌고 있는 시트의 release. 아래 안전망이 이걸 부른다.
  var activeRelease = null;

  function wire(s) {
    var grip = s.el.querySelector("[data-sheet-grip]");
    if (!grip || grip._sheetWired) return;
    grip._sheetWired = true;

    grip.addEventListener("pointerdown", function (e) {
      // 버튼을 누른 것은 끌기가 아니다 — 닫기 X 를 누르다 손이 1px 흔들려도
      // 카드가 따라 내려오면 안 된다.
      if (e.target.closest && e.target.closest("button,a,input,select,textarea")) return;
      if (e.button !== undefined && e.button !== 0) return;
      stop(s);
      measure(s);
      s.startY = e.clientY;
      s.baseY = s.y;
      s.moved = false;
      // 마지막 몇 점만 들고 있는다 — 놓는 순간의 속도는 궤적 전체가 아니라
      // 직전 몇 프레임에서 나온다.
      s.hist = [{ y: e.clientY, t: e.timeStamp }];
      try { grip.setPointerCapture(e.pointerId); } catch (err) { /* 캡처 실패해도 진행 */ }
      s.dragging = true;
      DR.sheet.dragging = true;
      activeRelease = release;
    });

    grip.addEventListener("pointermove", function (e) {
      if (!s.dragging) return;
      var raw = s.baseY + (e.clientY - s.startY);
      if (!s.moved && Math.abs(raw - s.baseY) < 10) return;   // 10px 히스테리시스
      s.moved = true;
      // 위쪽은 닫히는 방향이 아니다 — 경계라서 저항만 준다.
      s.y = raw < 0 ? rubberband(raw, s.height) : raw;
      paint(s);
      s.hist.push({ y: e.clientY, t: e.timeStamp });
      if (s.hist.length > 6) s.hist.shift();
    });

    var release = function (e) {
      if (!s.dragging) return;
      s.dragging = false;
      DR.sheet.dragging = false;
      activeRelease = null;
      try { grip.releasePointerCapture(e.pointerId); } catch (err) { /* 무시 */ }

      if (s.moved) {
        var h = s.hist, v = 0;
        if (h.length >= 2) {
          var a = h[0], b = h[h.length - 1];
          var dt = (b.t - a.t) / 1000;
          if (dt > 0) v = (b.y - a.y) / dt;   // px/s
        }
        if (decide(s.y, v, s.height) === "dismiss") {
          // 던진 속도를 그대로 스프링에 넘긴다 — 손을 뗀 자리에 이음매가 없다.
          run(s, s.exitY, 1.0, 0.3, v, function () { if (s.onDismiss) s.onDismiss(); });
        } else {
          // 손짓이 실렸으니 살짝 튕겨도 좋다(튕김은 모멘텀이 있을 때만).
          run(s, 0, 0.8, 0.3, v);
        }
      }
      // 끄는 동안 밀어 둔 렌더가 있으면 이제 그린다(app.js 가 건다). **판정
      // 뒤에** 부른다 — 앞에서 부르면 렌더가 DOM 을 갈아 판정이 헛돈다.
      if (DR.sheet.onIdle) DR.sheet.onIdle();
    };
    grip.addEventListener("pointerup", release);
    grip.addEventListener("pointercancel", release);
  }

  // **안전망.** 포인터 캡처가 실패했거나 손을 카드 밖에서 떼면 grip 의
  // pointerup 이 안 온다. 그러면 dragging 이 켜진 채 남고, app.js 는 그동안
  // 렌더를 미루므로 **검토 진행 화면이 영영 멈춘다.** 한 번만 건다 —
  // 시트마다 걸면 렌더할 때마다 리스너가 쌓인다(노드는 매번 새로 생긴다).
  if (global.addEventListener) {
    global.addEventListener("pointerup", function (e) {
      if (activeRelease) activeRelease(e);
    }, true);
    global.addEventListener("pointercancel", function (e) {
      if (activeRelease) activeRelease(e);
    }, true);
  }

  function closer(node) {
    return function () {
      var act = node.getAttribute("data-sheet-close");
      if (!act) return;
      var btn = document.querySelector('[data-act="' + act + '"]');
      if (btn) btn.click();
    };
  }

  // ---- 바깥에서 쓰는 것 ---------------------------------------------------

  DR.sheet = {
    dragging: false,
    onIdle: null,

    // render() 가 DOM 을 갈기 직전. 살아 있는 시트를 scrim 째 들고 있는다.
    // (PDF 뷰어 host 를 옮겨 붙이는 render() 안의 수법과 같은 모양이다.)
    keep: function (rootEl) {
      var out = {};
      var nodes = rootEl.querySelectorAll("[data-sheet]");
      for (var i = 0; i < nodes.length; i++) {
        out[nodes[i].getAttribute("data-sheet")] = nodes[i].parentNode;
      }
      return out;
    },

    // render() 직후. 새 DOM 과 대조한다.
    //  - 새로 생긴 것  → 아래에서 올라오며 등장
    //  - 그대로 있는 것 → 끌고 있던 자리를 되살린다(렌더가 지운 transform 복원)
    //  - 사라진 것    → 들어온 길의 역순으로 내려보내고 나서 제거
    sync: function (rootEl, kept, layer) {
      var now = {}, nodes = rootEl.querySelectorAll("[data-sheet]"), i, k;
      for (i = 0; i < nodes.length; i++) now[nodes[i].getAttribute("data-sheet")] = nodes[i];

      for (k in kept) {
        if (!Object.prototype.hasOwnProperty.call(kept, k) || now[k]) continue;
        var s = live[k], scrim = kept[k];
        // **즉시 live 에서 뺀다.** 안 빼면 나가는 0.25초 안에 같은 모달을 다시
        // 열었을 때 새 카드가 나가던 상태를 물려받아 화면 밖에서 뜬다.
        delete live[k];
        if (!s || !scrim) continue;
        layer.appendChild(scrim);              // root 밖으로 옮겨 살려 둔다
        // 나가는 중인 막은 클릭을 먹으면 안 된다 — 닫자마자 누른 것이
        // 0.25초 동안 조용히 씹힌다.
        scrim.style.pointerEvents = "none";
        s.scrim = scrim;
        s.el = scrim.querySelector("[data-sheet]");
        if (!s.el) { if (scrim.parentNode) scrim.parentNode.removeChild(scrim); continue; }
        measure(s);
        run(s, s.exitY, 1.0, 0.25, undefined, (function (node) {
          return function () {
            if (node.parentNode) node.parentNode.removeChild(node);
          };
        })(scrim));
      }

      for (k in now) {
        if (!Object.prototype.hasOwnProperty.call(now, k)) continue;
        var el = now[k], st = live[k], fresh = !st;
        if (fresh) st = live[k] = { y: 0, frame: 0, spring: null, height: 0, exitY: 0, dragging: false };
        st.el = el;
        st.scrim = el.parentNode;
        st.dim = parseFloat(el.getAttribute("data-sheet-dim")) || 0.28;
        st.blur = parseFloat(el.getAttribute("data-sheet-blur")) || 12;
        st.onDismiss = closer(el);
        measure(st);
        wire(st);
        if (!fresh) { paint(st); continue; }   // 렌더가 지운 자리를 되돌린다
        if (reduced()) { st.y = 0; paint(st); continue; }
        // 들어오는 길: 아래에서 올라온다. 나가는 길(아래로)과 짝이다.
        st.y = 28;
        st.ref = 28;                       // 등장 동안만 자를 바꾼다(위 paint 주석)
        paint(st);
        run(st, 0, 1.0, 0.35, undefined, function () { st.ref = st.height; });
      }
    },

    // 테스트가 부르는 순수 계산
    project: project,
    rubberband: rubberband,
    decide: decide,
    Spring: Spring
  };
})(typeof globalThis !== "undefined" ? globalThis : this);

if (typeof module !== "undefined" && module.exports) {
  module.exports = (typeof globalThis !== "undefined" ? globalThis : this).DR.sheet;
}
