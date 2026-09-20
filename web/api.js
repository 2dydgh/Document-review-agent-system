(function () {
  "use strict";
  window.DR = window.DR || {};
  // 검토/비교 파이프라인의 백엔드 호출·SSE·타이머. state와 render를 주입받아
  // app.js와 같은 상태를 공유한다. 반환한 함수들을 app.js가 재바인딩해 쓴다.
  window.DR.backend = function (ctx) {
    var state = ctx.state;
    var render = ctx.render;
    var repaintHistory = ctx.repaintHistoryRecords || function () { return false; };
    var historyPageRequest = 0;
    // 진행 화면 부분 갱신(레인·퍼센트·경과만). 성공 시 true — 전체 render 생략.
    var repaintProgress = ctx.repaintProgress || function () { return false; };
    // 스트림이 cancelled 를 알렸을 때 화면을 되돌리는 쪽(app.js). 알림 창에서
    // 멈춘 검토의 진행 화면이 굳어 있지 않게.
    var onCancelled = ctx.onCancelled || function () {};
    // 이 세션에 파일이 없는 검토(알림에서 재접속한 것)가 끝나면 이력 원본을 끌어온다.
    var pullOriginal = ctx.pullOriginal || function () {};
    // 작업 목록을 새로 받을 때마다 지난 판과 함께 넘긴다(app.js 마스코트 말풍선).
    var onJobsLoaded = ctx.onJobsLoaded || function () {};
    // 재접속: 시작 요청 대신 서버의 작업 스트림에 붙는다. 지나간 단계를 먼저
    // 받고 이어서 듣는다(server.py job_events). 이벤트 모양은 시작 스트림과 같다.
    function jobStream(id) { return "api/jobs/" + encodeURIComponent(id) + "/events"; }
    var esc = window.DR.helpers.esc;

  var timers = [];
  function clearTimers() { timers.forEach(clearTimeout); timers = []; }

  // file://로 연 프로토타입에는 서버가 없다. 그때는 목업/--emit-ui 결과를 그대로 쓴다.
  function servedOverHttp() { return window.location.protocol.indexOf("http") === 0; }

  // 서버가 지금 무슨 잣대로 문서를 재는지 물어본다. 이걸 화면에 띄우지 않으면,
  // 데모용 체크리스트(SR-\d+)로 실제 문서(RQ-...)를 검토해놓고 "0건"만 보게 된다.
  // 고른 체크리스트의 잣대를 묻는다. 기준을 고를 수 있게 된 뒤로는 기본값의
  // id 패턴·범위를 그대로 보여주면 안 된다 — 검토는 고른 기준으로 도는데 화면만
  // 다른 잣대를 말하면, 이 패널이 막으려던 사고("데모 기준으로 재고 0건")가 된다.
  // 로그인·회원가입·비밀번호 찾기 화면. 여기서는 백그라운드 적재가 화면을 다시
  // 그리면 안 된다 — 이 화면들은 입력과 버튼 상태를 DOM 에만 들고 있어서,
  // 다시 그리는 순간 방금 친 글자와 "…처리 중" 버튼 글이 날아간다. 실제로
  // 로그인을 누르면 적재 셋(health·criteria·history)이 차례로 돌아오며 화면을
  // 세 번 갈아, 버튼이 "로그인"으로 되돌아가고 히어로 연출이 다시 시작했다
  // (2026-09-02 "막 버벅이다가 들어가진다").
  function onAuthScreen() {
    var m = state.mode;
    return m === "login" || m === "signup" || m === "forgot";
  }

  function loadServerConfig() {
    if (!servedOverHttp()) return;
    var q = state.checklist ? ("?checklist=" + encodeURIComponent(state.checklist)) : "";
    fetch("api/health" + q)
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (cfg) { if (cfg) { state.server = cfg; if (!onAuthScreen()) render(); } })
      .catch(function () { /* 서버가 없으면 목업 그대로 둔다 */ });
  }

  // 저장된 검토 이력. 목업이 아니라 서버가 디스크에 남긴 진짜 결과다.
  //
  // 홈·시작 화면·빠른 검색용 최근 목록. 전체 기록 화면의 검색과 페이지는
  // loadHistoryPage가 별도로 관리하므로 이 캐시를 검색 결과로 덮지 않는다.
  // 프로미스를 돌려준다 — 로그인 직후 스플래시가 "진짜 다 불러왔는가"를
  // 기다려야 하기 때문이다. 시간을 재서 감추면 그건 가짜 로딩이다.
  function loadHistory(quiet) {
    if (!servedOverHttp()) return Promise.resolve();
    return fetch("api/history?limit=100")
      .then(function (res) {
        if (!res.ok) throw new Error("검토 기록 조회 실패 (HTTP " + res.status + ")");
        return res.json();
      })
      .then(function (body) {
        if (!body || !Array.isArray(body.entries)) throw new Error("검토 기록 응답 형식이 올바르지 않습니다");
        state.history = body.entries;
        state.historyAvailable = body.available_total;
        state.historyError = false;
        // 검토 완료 직후의 백그라운드 동기화는 지금 보는 완료 화면과 무관하다.
        // 여기서 다시 그리면 완료 체크의 CSS animation 이 응답 시점마다 재시작해
        // 같은 화면이 두세 번 고쳐지는 것처럼 보인다. 이력을 실제로 보고 있다면
        // quiet 요청이어도 갱신된 목록은 바로 보여준다.
        if (state.mode === "history") return loadHistoryPage();
        if (!quiet || state.mode === "home") render();
      })
      // **못 읽은 것과 없는 것을 섞지 않는다.** 예전에는 실패해도 빈 배열을 넣어서,
      // 서버가 죽었을 때 화면이 "아직 검토한 문서가 없습니다"라고 말했다 —
      // 검토를 스무 건 한 사람에게 한 건도 없다고 한 셈이다.
      // (CLAUDE.md "모르면 모른다고 말한다": 0건 통과와 검토를 못 했다를 섞지 않는다.)
      .catch(function () {
        state.history = []; state.historyError = true;
        if (state.mode === "history") return loadHistoryPage();
        if (!quiet || state.mode === "home") render();
      });
  }

  function loadHistoryPage() {
    if (!servedOverHttp()) return Promise.resolve();
    var id = ++historyPageRequest, user = state.user;
    var q = state.historyQ || "", kind = state.historyKind || "", offset = state.historyOffset || 0;
    var hp = state.historyPage = Object.assign({}, state.historyPage, { busy: true, error: null });
    function current() {
      return id === historyPageRequest && user === state.user &&
        q === (state.historyQ || "") && kind === (state.historyKind || "") && offset === (state.historyOffset || 0);
    }
    function paint() { if (state.mode === "history" && !repaintHistory()) render(); }
    paint();
    return fetch("api/history?limit=20&offset=" + offset + "&q=" + encodeURIComponent(q) + "&kind=" + encodeURIComponent(kind))
      .then(function (res) {
        if (!res.ok) throw new Error("검토 기록 조회 실패 (HTTP " + res.status + ")");
        return res.json();
      }).then(function (body) {
        if (!Array.isArray(body.entries) || !Number.isInteger(body.total) || !Number.isInteger(body.offset) ||
            !Number.isInteger(body.limit) || body.limit < 1 || body.total < 0 || body.offset < 0 ||
            !Number.isInteger(body.available_total) || !body.kind_counts) throw new Error("기록 응답을 확인할 수 없습니다");
        if (!current()) return;
        state.historyPage = Object.assign({}, body, { busy: false, error: null });
        state.historyOffset = body.offset;
        paint();
      }).catch(function (err) {
        if (!current()) return;
        hp.busy = false; hp.error = err.message || "기록을 불러오지 못했습니다";
        paint();
      });
  }

  // 서버가 실제로 저장했다고 돌려준 새 기록만 홈의 한 번짜리 강조 대상으로 둔다.
  // 완료됐어도 저장 실패면 목록에 행 자체가 없으므로 강조를 약속하지 않는다.
  function markFreshHistory(payload) {
    var h = payload && payload.history;
    if (h && h.saved !== false && h.id) state.homeFreshHistoryId = h.id;
  }

  // ── 알림 ────────────────────────────────────────────────────────────────
  // **이 세션에서 우리가 직접 본 사건만** 담는다. 서버에 알림함이 없고, 우리는
  // 만들지 않는다 — 새로고침하면 사라지는 것이 맞고, 화면이 그렇다고 말한다.
  //
  // 알릴 사건이 실제로 있다: 검사는 SSE 스트림이라 탭이 살아 있는 동안 돌지만,
  // setMode 는 그 스트림을 안 끊는다. 그래서 검토를 걸어놓고 홈이나 검토 기록으로
  // 옮기면 검사는 계속 돌고 **끝나도 그 화면에 없으면 조용히 끝난다.** 그 자리다.
  //
  // 보고 있었으면 안 쌓는다. 진행 화면을 지켜본 사람에게 "끝났습니다"는
  // 이미 아는 말이라 읽을 것만 늘린다.
  // 알림은 **서버가 가진 작업 목록**이다(GET /api/jobs). 예전에는 브라우저
  // 메모리에 쌓아서 새로고침하면 비워졌고, 그래서 화면이 "새로고침하면
  // 비워집니다"라고 변명해야 했다. 이제 검토는 서버가 들고 있는 일이라
  // (src/app/jobs.py) 창을 닫았다 열어도 그대로 있고, 진행 중인 것도 보인다.
  function loadJobs() {
    if (!servedOverHttp()) return Promise.resolve();
    return fetch("api/jobs").then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    }).then(function (b) {
      var was = JSON.stringify(state.jobs || []);
      var prevJobs = state.jobs || [];
      state.jobs = b.jobs || [];
      onJobsLoaded(prevJobs, state.jobs);
      // 도는 것이 하나라도 있으면 계속 지켜본다. 진행 중 표시가 멈춰 있으면
      // 검토가 죽은 것처럼 보인다.
      var running = state.jobs.some(function (j) { return j.status === "running"; });
      // 멈추는 중이면 더 자주 본다. 취소는 검사가 다음 진행을 알릴 때 걸리므로
      // 곧 상태가 바뀌는데, 5초를 기다리면 "멈추는 중"이 한참 붙어 있는다.
      var stopping = state.jobs.some(function (j) { return j.cancelling; });
      if (running) scheduleJobPoll(stopping ? 1200 : 5000);
      if (JSON.stringify(state.jobs) !== was) render();
    }).catch(function () { /* 알림은 편의다 — 실패해도 검토를 막지 않는다 */ });
  }

  // 진행 중인 작업이 있을 때만 돈다. 5초는 5분짜리 검토에서 단계가 바뀌는
  // 속도와 맞고, 50명이 동시에 켜 둬도 초당 10요청이라 부담이 없다.
  // 검토를 진짜로 멈춘다. 예전에는 브라우저 쪽 연결만 끊어서 서버는 끝까지
  // 돌았고, 취소한 검토가 이력에 저장돼 알림에 "검토 완료"로 떴다.
  //
  // 서버 응답을 기다리지 않는다 — 멈추라고 말하는 것과 화면을 되돌리는 것은
  // 별개다. 실패해도(이미 끝났다든지) 화면은 이미 떠난 뒤라 되돌릴 것이 없다.
  function cancelJob(which) {
    var id = state.jobId[which];
    state.jobId[which] = null;
    if (!id || !servedOverHttp()) return;
    fetch("api/jobs/" + encodeURIComponent(id) + "/cancel", { method: "POST" })
      .then(function () { loadJobs(); }, function () { /* 이미 끝났을 수 있다 */ });
  }

  var jobPollTimer = null;
  function scheduleJobPoll(ms) {
    if (jobPollTimer) return;
    jobPollTimer = setTimeout(function () { jobPollTimer = null; loadJobs(); }, ms || 5000);
  }

  // 사람이 읽는 상대 시각. 이력의 at은 ISO8601이다.
  function ago(iso) {
    var t = Date.parse(iso);
    if (isNaN(t)) return "";
    var s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return "방금";
    if (s < 3600) return Math.floor(s / 60) + "분 전";
    if (s < 86400) return Math.floor(s / 3600) + "시간 전";
    if (s < 86400 * 7) return Math.floor(s / 86400) + "일 전";
    return iso.slice(0, 10);
  }

  function postForm(url, fd) {
    return fetch(url, { method: "POST", body: fd }).then(function (res) {
      return res.json().then(function (body) {
        if (!res.ok) throw new Error(body.detail || ("서버 오류 (HTTP " + res.status + ")"));
        return body;
      });
    });
  }

  // 파이프라인 단계 애니메이션. live면 마지막 단계에서 멈추고 응답을 기다린다.
  function animate(count, setIndex, delay, live, onDone) {
    function step(i) {
      setIndex(i); render();
      if (i < count - 1) timers.push(setTimeout(function () { step(i + 1); }, delay));
      else if (!live) timers.push(setTimeout(onDone, 900));
    }
    timers.push(setTimeout(function () { step(0); }, 400));
  }

  // 검토가 끝났다는 사실을 잠깐 붙잡아 두고 넘어간다. 말없이 화면만 바뀌면
  // 끝난 건지 넘어간 건지 읽히지 않는다 — 특히 지적이 0건일 때는 빈 목록만 뜬다.
  // 끝난 화면을 붙잡아 두는 시간. 800ms 는 "검토 완료" 를 읽기 전에 결과 화면으로
  // 넘어가 버려서, 끝났다는 사실이 눈에 안 남았다.
  var DONE_HOLD_MS = 1400;
  function holdDone(markDone, advance, settleMs) {
    function revealDone() {
      // 완료 상태도 이 순간 처음 공개한다. 먼저 true 로 바꾸면 이력 갱신 같은
      // 별도 render 가 타이머보다 앞서 완료 머리말을 그려 애니메이션을 중복시킨다.
      markDone();
      render();
      timers.push(setTimeout(function () { advance(); render(); }, DONE_HOLD_MS));
    }
    // 단일 검토는 step 이벤트마다 레인이 하나씩 완료된다. 마지막 done 이벤트가
    // 오자마자 전체 렌더를 하면 마지막 체크의 전환이 시작되기도 전에 완료 머리말로
    // 교체된다. 그 레인만 먼저 제자리 갱신하고 짧게 착지시킨 뒤 최종 완료를 잇는다.
    if (settleMs && repaintProgress()) {
      timers.push(setTimeout(revealDone, settleMs));
      return;
    }
    revealDone();
  }

  function errMessage(err) { return (err && err.message) ? err.message : String(err); }

  function errorBanner(msg) {
    if (!msg) return "";
    // 다른 오류 배너와 같은 토큰(sev-crit) — 여기만 하드코딩 hex 라 미묘하게
    // 다른 앱처럼 보였고 다크에서 깨졌다. "분석 실패:" 접두어도 뗐다 — "문서를
    // 먼저 올려주세요" 같은 안내에는 거짓말이 된다. 메시지가 스스로 말한다.
    return '<div data-cerror style="padding:12px 14px;background:var(--sev-crit-bg);border:1px solid var(--sev-crit-bd);' +
      'border-radius:var(--r-sm);color:var(--sev-crit-fg);font-size:13px;font-weight:500;">' + esc(msg) + '</div>';
  }

  // SSE 스트림을 읽는다. EventSource는 GET만 되어 파일을 못 올린다 — 그래서
  // POST 응답 body를 직접 읽는다.
  function readEvents(reader, onEvent) {
    var dec = new TextDecoder(), buf = "";
    function pump() {
      return reader.read().then(function (r) {
        if (r.done) return;
        buf += dec.decode(r.value, { stream: true });
        var blocks = buf.split("\n\n");
        buf = blocks.pop();                       // 잘린 마지막 조각은 다음 청크에서 이어붙인다
        blocks.forEach(function (block) {
          block.split("\n").forEach(function (line) {
            if (line.indexOf("data:") === 0) onEvent(JSON.parse(line.slice(5).trim()));
          });
        });
        return pump();
      });
    }
    return pump();
  }

  // 검토는 몇 분씩 걸린다. 이벤트가 뜸한 구간(LLM 한 번 왕복)에도 화면이 살아
  // 있다는 걸 보여주는 건 경과 시간뿐이다. 1초마다 다시 그린다.
  function tickElapsed() {
    if (state.screen !== "progress" || state.mode !== "single") return;
    // 경과 시간만 바뀐다 — 부분 갱신으로 버튼 재생성을 피한다(hover 안 깜빡).
    timers.push(setTimeout(function () { if (!repaintProgress()) render(); tickElapsed(); }, 1000));
  }

  function tickCompareElapsed() {
    if (state.mode !== "compare" || state.cstep !== "progress") return;
    var el = document.getElementById("cmp-elapsed");
    if (el && state.compareStartedAt) {
      el.textContent = fmtElapsed(Date.now() - state.compareStartedAt) + " 경과";
    }
    timers.push(setTimeout(tickCompareElapsed, 1000));
  }

  // 초안 진행 화면의 경과. 서버는 ingestion 을 **한 번** 흘리고 파싱이 끝날
  // 때까지(실측 600초) 아무것도 안 보낸다 — 렌더가 안 오니 숫자가 굳는다.
  // 글자 하나만 갈아끼운다(render 를 부르면 pdf-mount 가 새로 만들어진다).
  function tickEvaluateElapsed() {
    if (state.mode !== "evaluate" || state.estep !== "progress") return;
    var el = document.getElementById("eval-elapsed");
    if (el && state.evalv.startedAt) {
      el.textContent = fmtElapsed(Date.now() - state.evalv.startedAt) + " 경과";
    }
    timers.push(setTimeout(tickEvaluateElapsed, 1000));
  }

  function fmtElapsed(ms) {
    var s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return s + "초";
    return Math.floor(s / 60) + "분 " + (s % 60) + "초";
  }

  function onReviewEvent(ev, stageKeys) {
    if (ev.event === "stage") {
      var i = stageKeys.indexOf(ev.key);
      // "done"이면 그 단계는 끝났으니 다음 단계(i+1)가 진행 중이다. i로 두면
      // 방금 다 센 숫자를 달고도 그 단계가 아직 RUNNING인 것처럼 그려진다.
      // 마지막 단계(report)가 done이면 i+1이 stages 길이를 넘는데, mkTimeline은
      // 모든 인덱스가 idx보다 작은지만 보므로 전 단계가 done으로 그려져 깨지지 않는다.
      if (i >= 0) state.stageIndex = ev.status === "done" ? i + 1 : i;
      if (ev.detail) state.stageDetail[ev.key] = ev.detail;

      var r = state.rev;
      var partial = false;
      // 첫 작업이 끝나기 전에도 실제 실행 중인 레인을 보여준다. 완료 개수만으로
      // 상태를 정하면 LLM 첫 응답을 기다리는 수십 초 동안 "대기"라고 거짓 표시된다.
      if (Object.prototype.hasOwnProperty.call(ev, "active")) r.active = ev.active || "";
      if (ev.key !== "review") {
        // 준비 단계(적재·정규화·분할). 대개 순식간에 끝나므로 진행이 아니라 결과로
        // 접어 보여준다.
        if (ev.status === "done") {
          r.prep[ev.key] = ev.detail;
          r.prepAt = Date.now();
          r.note = "";
        }
        else if (ev.detail) {
          // 그림 해석은 예외다. 한 장에 2~3초라 스캔 문서면 준비 단계가 수십 초
          // 걸리는데, done 만 보면 그 동안 "검토를 준비하는 중…"에서 멈춘 것처럼
          // 보인다. 진행 문장을 그대로 흘려 보낸다(레인이 없을 때 그 자리에 뜬다).
          r.note = ev.detail;
          partial = true;
        }
      } else if (ev.plan) {
        // 이번 검토가 실제로 할 일의 총량. 이게 있어야 퍼센트가 정직해진다.
        // 레인이 처음 생기는 구조 변화라 전체 render 로 그린다(id 컨테이너 생성).
        //
        // **통째로 갈아끼우지 않고 label 로 병합한다.** 레인은 검토 중간에 늘 수
        // 있다 — 근거 재확인은 1차 검사가 끝나야 작업량(대조 실패 후보 수)을
        // 알아서, 그때 자기 레인 하나만 plan 으로 신고한다. 교체하면 그 순간
        // 이미 그려진 레인들이 전부 사라진다.
        var lanes = r.lanes || [];
        ev.plan.forEach(function (p) {
          var key = p.label || p.kind;
          for (var li = 0; li < lanes.length; li++) {
            if ((lanes[li].label || lanes[li].kind) === key) { lanes[li] = p; return; }
          }
          lanes.push(p);
        });
        r.lanes = lanes;
      } else if (ev.step) {
        // 이게 수백 번 온다. 전체 render 면 '검토 취소' 버튼이 매번 재생성돼 hover 가
        // 깜빡인다 — 레인·퍼센트·경과만 부분 갱신하고 버튼은 그대로 둔다.
        // 카운터 열쇠는 label 이다 — kind 는 유일하지 않다. 표현 점검(조각)과
        // 문서 전체 점검이 둘 다 kind:"chunk" 로 신고해서, kind 로 담으면 두
        // 레인이 한 카운터를 덮어쓰고 완료 때 마지막 레인의 total 이 이긴다
        // (표현 점검 바가 완료 순간 엉뚱한 비율로 되돌아가던 버그).
        r.done[ev.step.label || ev.step.kind] = ev.step.i;
        r.active = ev.step.label || ev.step.kind;
        r.note = "";
        partial = true;
      } else if (ev.detail) {
        // 작업 단위가 없는 체커(필수 항목·미작성 표시). 문장만 짧게 스쳐 지나간다.
        r.note = ev.detail;
        partial = true;
      }
      // 부분 갱신이 가능한 이벤트면 그것부터 시도하고, 안 되면(진행 화면 아님 등)
      // 전체 render 로 폴백한다.
      if (partial && repaintProgress()) return;
      render();
      return;
    }
    if (ev.event === "done") {
      var p = ev.payload;
      markFreshHistory(p);
      // 이전 문서의 뷰어 blob을 회수하고 원본 모드로 되돌린다. 새 검토가 이전 PDF를
      // 그대로 띄운 채 시작하지 않게. blob URL은 매번 유일하므로 app.js의
      // syncPdfViewer가 새 원본을 자동으로 다시 만든다.
      if (state.viewer.origUrl) URL.revokeObjectURL(state.viewer.origUrl);
      if (state.annot.viewUrl) URL.revokeObjectURL(state.annot.viewUrl);
      // 재접속한 검토는 브라우저에 파일이 없다 — 이력 원본을 끌어온다. 그동안
      // 뷰어는 준비 중을 그린다(loadingOrig, openHistory 와 같은 길).
      var needOrig = !(state.files.single && state.files.single.file) && p.history && p.history.id;
      state.viewer = { mode: "orig", baseBlob: null, origUrl: null, converting: false, convertError: null,
                       loadingOrig: !!needOrig };
      state.annot = { busy: false, msg: "" };
      // 전체화면도 문서와 함께 푼다. 남겨두면 새 검토가 화면을 덮은 채 열리는데,
      // 그 상태에선 오른쪽 "검토 결과"가 가려져 결과부터 보려던 사람이 막힌다.
      state.viewerFull = false;
      window.DOCREVIEW.doc = p.doc;
      // 미리보기 본문. 이 기능 이전의 이력에는 없으므로 빈 배열로 받는다.
      window.DOCREVIEW.sections = p.sections || [];
      window.DOCREVIEW.findings = p.findings;
      // 그림의 번호·원본 크기. /api/locate 로 그대로 되돌려보내면 서버가 뷰어용
      // PDF 안의 이미지와 짝지어 좌표를 낸다 — 그림 설명에서 나온 지적을 짚기
      // 위해서다(그 설명은 PDF 텍스트 레이어에 없다). 옛 이력엔 없으므로 빈 배열.
      window.DOCREVIEW.images = p.images || [];
      window.DOCREVIEW.stages = p.stages;
      // 모든 단일 검토의 기준↔지적 연결. 업로드 기준을 골랐을 때만 checklist
      // 별칭도 와서 그룹 화면을 켠다. 둘 다 명시적으로 비워 이전 결과가 새
      // 문서에 눌어붙지 않게 한다.
      window.DOCREVIEW.criteriaResults = p.criteriaResults || null;
      window.DOCREVIEW.checklist = p.checklist || null;
      // 회신본 반영 확인(payload.lineage) + 이전 검토 후보(payload.lineage_candidate).
      // 없으면 이전 검토의 계보 결과가 새 문서에 눌어붙지 않게 명시적으로 비운다.
      window.DOCREVIEW.lineage = p.lineage || null;
      window.DOCREVIEW.lineageCandidate = p.lineage_candidate || null;
      // 검토자가 내린 반영 판정. 기계 판정과 **따로** 저장된다(lineageVerdicts).
      // 이력을 다시 열 때 이것이 없으면 지적을 하나씩 확인한 일이 사라진다.
      window.DOCREVIEW.lineageVerdicts = p.lineageVerdicts || null;
      // 그중 지난 검토에서 이어받은 것. 기계가 정한 판정으로 오해하지 않게 표시한다.
      window.DOCREVIEW.lineageCarried = p.lineageCarried || null;
      // 이 검토가 이력의 어느 항목인가. 판정을 저장하려면 있어야 한다 —
      // 저장에 실패한 검토(p.history.saved === false)면 id 가 없고, 그때는
      // 화면이 "저장할 수 없다"고 말한다(폴더 검토의 confirmCase 와 같다).
      window.DOCREVIEW.historyId = (p.history && p.history.id) || null;
      window.DOCREVIEW.historyAt = (p.history && p.history.at) || "";
      window.DOCREVIEW.dismissed = p.dismissed || [];   // 새 검토는 빈 목록 — 앞 문서 것이 눌어붙지 않게
      state.showDismissed = false;
      // 새 문서에 직전 결과의 보기 조건·판정 탭을 이어붙이지 않는다.
      state.reviewTab = null;
      state.sevFilter = { major: true, minor: true, info: true, unreviewed: true };
      state.checkerFilter = "all"; state.sort = "severity";
      state.selected = null; state.fixes = {}; state.exportMenuOpen = false;
      if (needOrig) pullOriginal(p.history.id, (p.doc || {}).name || "document", p.doc);
      state.stageIndex = p.stages.length - 1;
      state.reviewed = true;          // 이제 `지적사항` 으로 갈 수 있다
      // 끝났으면 격자도 다 찼다. 마지막 step 이벤트가 총량에 못 미친 채 끝나는
      // 경우(체커가 도중에 빠져나가는 경우)에도 화면이 미완으로 남지 않는다.
      state.rev.lanes.forEach(function (l) { state.rev.done[l.label || l.kind] = l.total; });
      state.rev.note = "";
      state.rev.active = "";
      loadJobs();   // 완료는 서버가 이미 안다 — 목록을 다시 읽는다
      holdDone(function () { state.done = true; },
               // 대기 중에 사용자가 화면을 떠났으면 끌어오지 않는다.
               // done 은 되돌리지 않는다 — 예전엔 여기서 false 로 되돌려서,
               // 결과 화면에서 진행 탭으로 돌아가면 끝난 검토가 "검토 중…"
               // 이라고 거짓말을 했다. 다음 검토 시작이 어차피 false 로 민다.
               function () { if (state.screen === "progress") state.screen = "results"; },
               // 마지막 fill 300ms → 완료색·체크 380ms가 모두 끝난 뒤 공개한다.
               760);
      loadHistory(true);   // 방금 검토가 이력에 올라온다 — 완료 화면은 다시 그리지 않는다
      return;
    }
    if (ev.event === "error") throw new Error(ev.message);   // 아래 catch가 받는다
  }


  // ── 케이스 검토 ──────────────────────────────────────────────────────────

  // 경과 시간만 1초마다 갈아끼운다. 전체 render 를 하면 진행 중에 화면이 튄다.
  function tickCaseElapsed() {
    if (state.mode !== "case" || state.kase.step !== "progress") return;
    var el = document.getElementById("kase-elapsed");
    if (el && state.kase.startedAt) {
      el.textContent = fmtElapsed(Date.now() - state.kase.startedAt) + " 경과";
    }
    timers.push(setTimeout(tickCaseElapsed, 1000));
  }

  // 진행 단계만 갈아끼운다(전체 render 없이) — 파일 목록·버튼이 재생성되지 않게.
  // 마크업은 views.js 가 만든다(app.js 가 주입). 예전에는 여기서 따로 그렸는데,
  // 화면 쪽 타임라인과 갈려 검사 중에만 옛 모양이 나왔다.
  var repaintCaseStages = ctx.repaintCaseStages || function () { return false; };
  // 체크리스트 검토 작성중 종이 — 같은 이유로 views.js 가 만들고 app.js 가 주입한다.
  var patchEvaluateProgress = ctx.patchEvaluateProgress || function () { return false; };

  // 팀 검토 기준. 화면이 payload 로 다시 지어내면 실제로 도는 규칙과 갈린다 —
  // 판정에 쓰이는 그대로 서버에서 받는다.
  function fetchCriteria(team) {
    return fetch("/api/teams/" + encodeURIComponent(team) + "/criteria")
      .then(function (r) {
        if (!r.ok) throw new Error("검토 기준을 불러오지 못했습니다 (" + r.status + ")");
        return r.json();
      });
  }

  // 검토 기준 3층. fetchCriteria 와 다르다 — 그쪽은 폴더 검토가 쓰는 구조 절을
  // 내고 items 는 개수만 낸다. 여기서는 항목 본문이 목적이다.
  function fetchCriteriaLayers(team) {
    var q = team ? ("?team=" + encodeURIComponent(team)) : "";
    return fetch("api/criteria" + q)
      .then(function (r) {
        if (!r.ok) throw new Error("검토 기준을 불러오지 못했습니다 (" + r.status + ")");
        return r.json();
      });
  }

  function streamCase(files, team, jobId) {
    var k = state.kase;
    var fd = new FormData();
    files.forEach(function (f) { fd.append("files", f, f.name); });
    fd.append("team", team);
    if (k.abort) k.abort.abort();
    var ac = new AbortController();
    k.abort = ac;
    var sawEnd = false;
    (jobId ? fetch(jobStream(jobId), { signal: ac.signal })
           : fetch("api/review-case", { method: "POST", body: fd, signal: ac.signal }))
      .then(function (res) {
        if (!res.ok) {
          return res.json().catch(function () { return {}; }).then(function (b) {
            throw new Error(b.detail || ("서버 오류 (HTTP " + res.status + ")"));
          });
        }
        return readEvents(res.body.getReader(), function (ev) {
          if (ev.event === "job") { state.jobId.case = ev.id; loadJobs(); return; }
          if (ev.event === "done" || ev.event === "error") sawEnd = true;
          if (ev.event === "cancelled") { sawEnd = true; onCancelled("case"); return; }
          if (ev.event === "stage") {
            k.stage[ev.key] = ev.detail || ev.status;
            if (!repaintCaseStages()) render();
            return;
          }
          if (ev.event === "done") {
            markFreshHistory(ev.payload);
            loadJobs();   // 완료는 서버가 이미 안다 — 목록을 다시 읽는다
            k.payload = ev.payload; k.step = "results"; k.tab = "summary";
            k.selOutput = ""; render();
            loadHistory(true);   // 홈으로 돌아올 때 새 폴더 검토 행과 강조를 함께 준비한다
            return;
          }
          if (ev.event === "error") throw new Error(ev.message);
        });
      })
      .then(function () {
        // done/error 없이 스트림이 그냥 닫히면 화면이 진행 중인 채로 굳는다.
        if (!sawEnd) throw new Error("검사가 끝나기 전에 서버와의 연결이 끊겼습니다. 다시 시도해주세요.");
      })
      .catch(function (err) {
        if (err && err.name === "AbortError") return;
        clearTimers();
        k.error = errMessage(err);
        k.step = "recognize";
        render();
      })
      .then(function () { if (k.abort === ac) k.abort = null; });
  }

  function streamReview(fd, jobId) {
    var stageKeys = window.DOCREVIEW.stages.map(function (s) { return s.key; });
    // 진행 중이던 스트림이 있으면 끊는다 — 안 그러면 그 스트림이 나중에 도착시킬
    // done payload가 지금 막 시작한 새 검토(다른 문서)의 결과를 덮어쓴다.
    if (state.reviewAbort) state.reviewAbort.abort();
    var ac = new AbortController();
    state.reviewAbort = ac;
    var sawEnd = false;   // done 또는 error 이벤트를 실제로 봤는지
    (jobId ? fetch(jobStream(jobId), { signal: ac.signal })
           : fetch("api/review", { method: "POST", body: fd, signal: ac.signal }))
      .then(function (res) {
        if (!res.ok) {
          return res.json().catch(function () { return {}; }).then(function (body) {
            throw new Error(body.detail || ("서버 오류 (HTTP " + res.status + ")"));
          });
        }
        return readEvents(res.body.getReader(), function (ev) {
          // 첫 이벤트가 작업 id 다. 취소는 이 id 로 서버에 간다 — 연결만
          // 끊으면 서버는 끝까지 돌고 이력에 저장한다(그게 예전 버그다).
          if (ev.event === "job") { state.jobId.single = ev.id; loadJobs(); return; }
          if (ev.event === "done" || ev.event === "error") sawEnd = true;
          if (ev.event === "cancelled") { sawEnd = true; onCancelled("single"); return; }
          onReviewEvent(ev, stageKeys);
        });
      })
      .then(function () {
        // 서버 재시작이나 워커 이상 종료로 스트림이 done/error 없이 그냥 닫히면,
        // 이대로 넘어갈 경우 화면이 중간 퍼센트에 멈춘 채 굳는다. 실패로 다룬다.
        if (!sawEnd) throw new Error("검토가 끝나기 전에 서버와의 연결이 끊겼습니다. 다시 시도해주세요.");
      })
      .catch(function (err) {
        if (err && err.name === "AbortError") return;   // 사용자가 새 검토를 시작해 스스로 취소한 것 — 에러 아님
        clearTimers();
        state.done = false;
        state.serror = errMessage(err);
        state.screen = "upload";
        render();
      })
      .then(function () {
        if (state.reviewAbort === ac) state.reviewAbort = null;
      });
  }


  // 비교 검토의 실제 진행. 예전에는 postForm 한 방 + 760ms 가짜 단계 애니메이션
  // 이었다 — 서버가 어디까지 갔는지와 무관한 연출이다. /api/compare 가 SSE 로
  // 단계를 흘리므로(ingest·align·cross·report) 그대로 화면에 옮긴다.
  function onCompareEvent(ev, stageKeys) {
    if (ev.event === "stage") {
      var i = stageKeys.indexOf(ev.key);
      if (i >= 0) {
        // done 이면 그 단계는 끝 — 다음 단계가 진행 중이다(onReviewEvent 와 동일).
        state.cstageIndex = ev.status === "done" ? i + 1 : i;
        var st = window.DOCREVIEW.compare.stages[i];
        if (st && ev.detail) st.detail = ev.detail;
      }
      render();
      return;
    }
    if (ev.event === "error") {
      clearTimers();
      state.cdone = false;
      state.cerror = ev.message || "비교 중 오류가 발생했습니다.";
      state.cstep = "setup";
      render();
      return;
    }
    if (ev.event === "done") {
      clearTimers();
      var payload = ev.payload;
      markFreshHistory(payload);
      window.DOCREVIEW.compare = payload;
      state.cstageIndex = payload.stages.length;
      state.cverdicts = payload.rtmVerdicts || {};
      state.cverdictSaveError = null;
      var cA = (payload.docA && payload.docA.name) || "문서";
      var cB = (payload.docB && payload.docB.name) || "문서";
      loadJobs();   // 완료는 서버가 이미 안다 — 목록을 다시 읽는다
      holdDone(function () { state.cdone = true; },
               function () { state.cdone = false; if (state.cstep === "progress") state.cstep = "results"; });
      loadHistory(true);   // 완료 연출을 다시 시작하지 않고 이력만 동기화한다
    }
  }

  function streamCompare(fd, jobId) {
    var stageKeys = ["ingest", "align", "cross", "report"];
    // 진행 중이던 스트림이 있으면 끊는다 — 안 그러면 그 스트림의 done payload 가
    // 지금 막 시작한 새 비교의 결과를 덮어쓴다(streamReview 와 같은 처방).
    if (state.compareAbort) state.compareAbort.abort();
    var ac = new AbortController();
    state.compareAbort = ac;
    var sawEnd = false;
    (jobId ? fetch(jobStream(jobId), { signal: ac.signal })
           : fetch("api/compare", { method: "POST", body: fd, signal: ac.signal }))
      .then(function (res) {
        if (!res.ok) {
          return res.json().catch(function () { return {}; }).then(function (body) {
            throw new Error(body.detail || ("서버 오류 (HTTP " + res.status + ")"));
          });
        }
        return readEvents(res.body.getReader(), function (ev) {
          if (ev.event === "job") { state.jobId.compare = ev.id; loadJobs(); return; }
          if (ev.event === "done" || ev.event === "error") sawEnd = true;
          if (ev.event === "cancelled") { sawEnd = true; onCancelled("compare"); return; }
          onCompareEvent(ev, stageKeys);
        });
      })
      .then(function () {
        if (!sawEnd) throw new Error("비교가 끝나기 전에 서버와의 연결이 끊겼습니다. 다시 시도해주세요.");
      })
      .catch(function (err) {
        if (err && err.name === "AbortError") return;   // 새 비교로 스스로 취소한 것
        clearTimers();
        state.cdone = false;
        state.cerror = errMessage(err);
        state.cstep = "setup";
        render();
      })
      .then(function () {
        if (state.compareAbort === ac) state.compareAbort = null;
      });
  }

  // 체크리스트 검토(부록 B 초안). /api/evaluate 가 흘리는 단계 키는
  // ingestion·draft·report 셋이고, draft 는 항목마다 detail("항목 n/N")을 갱신한다.
  function onEvaluateEvent(ev) {
    if (ev.event === "stage") {
      state.evalv.stage[ev.key] = ev.status;
      if (ev.detail) state.evalv.detail[ev.key] = ev.detail;
      // 끝난 행(ID·항목·판정·문장)은 모아 둔다 — 작성중 종이가 이걸 한 줄씩 쓴다.
      if (ev.row) (state.evalv.written = state.evalv.written || []).push(ev.row);
      // 항목 하나가 끝날 때마다(수십 번) 전체를 다시 그리면 종이의 쓰는 애니메이션이
      // 매번 처음부터 돈다. 종이가 떠 있으면 행·막대·숫자만 바꾸고, 단계가
      // 바뀌어 틀이 달라질 때만 render() 한다.
      if (!(state.mode === "evaluate" && state.estep === "progress" && patchEvaluateProgress(state.evalv))) render();
      return;
    }
    if (ev.event === "error") {
      // 경과 틱은 아래 estep 가드가 끝낸다 — timers 는 네 틱이 함께 쓰는 한 벌이라
      // 여기서 비우면 다른 검토의 경과까지 멈춘다.
      state.evalv.error = ev.message || ev.detail || "초안 생성 실패";
      state.estep = "setup";
      render();
      return;
    }
    if (ev.event === "done") {
      // error 쪽과 같은 이유로 타이머를 비우지 않는다 — 초안이 끝날 때 마침
      // 단일 검토를 보고 있으면 그쪽 경과가 같이 멈춘다. 초안 틱은 아래에서
      // estep 이 results 로 바뀌는 순간 제 가드로 끝난다.
      var p = ev.payload;
      markFreshHistory(p);
      // 초안은 `window.DOCREVIEW` 도 뷰어도 안 건드린다(2026-09-16 재설계).
      // 화면은 초안 표 하나뿐이고 원문은 새 창으로 연다 — 단일 검토와 상태를
      // 나눠 쓰지 않으니 서로의 화면을 빼앗을 길이 없다.
      state.evalv.payload = p;
      state.evalv.historyId = (p.history || {}).id || "";
      state.evalv.historyAt = (p.history || {}).at || "";
      state.estep = "results";
      loadJobs();          // 완료는 서버가 이미 안다 — 목록을 다시 읽는다
      render();
      loadHistory(true);
    }
  }

  function streamEvaluate(fd, jobId) {
    // 돌고 있던 스트림은 끊는다 — 안 그러면 그 done payload 가 방금 시작한
    // 초안의 결과를 덮어쓴다(streamCompare 와 같은 처방).
    if (state.evaluateAbort) state.evaluateAbort.abort();
    var ac = new AbortController();
    state.evaluateAbort = ac;
    var sawEnd = false;
    (jobId ? fetch(jobStream(jobId), { signal: ac.signal })
           : fetch("api/evaluate", { method: "POST", body: fd, signal: ac.signal }))
      .then(function (res) {
        if (!res.ok) {
          return res.json().catch(function () { return {}; }).then(function (body) {
            throw new Error(body.detail || ("서버 오류 (HTTP " + res.status + ")"));
          });
        }
        return readEvents(res.body.getReader(), function (ev) {
          if (ev.event === "job") { state.jobId.evaluate = ev.id; loadJobs(); return; }
          if (ev.event === "done" || ev.event === "error") sawEnd = true;
          if (ev.event === "cancelled") { sawEnd = true; onCancelled("evaluate"); return; }
          onEvaluateEvent(ev);
        });
      })
      .then(function () {
        if (!sawEnd) throw new Error("초안이 끝나기 전에 서버와의 연결이 끊겼습니다. 다시 시도해주세요.");
      })
      .catch(function (err) {
        if (err && err.name === "AbortError") return;   // 새 초안으로 스스로 취소한 것
        state.evalv.error = errMessage(err);
        state.estep = "setup";
        render();
      })
      .then(function () { if (state.evaluateAbort === ac) state.evaluateAbort = null; });
  }

  // 대화창(A 안): 말 한 번에 스트림 한 번. 서버가 턴이 끝나면 닫는다 — 끝나지 않는
  // 스트림을 붙들지 않는다. since 는 이어 받을 이벤트 번호.
  function streamChat(since, onEvent) {
    return fetch("api/chat/stream?since=" + (since || 0))
      .then(function (res) {
        if (!res.ok) {
          return res.json().catch(function () { return {}; }).then(function (b) {
            throw new Error(b.detail || ("서버 오류 (HTTP " + res.status + ")"));
          });
        }
        return readEvents(res.body.getReader(), onEvent);
      });
  }

    return {
      streamChat: streamChat,
      servedOverHttp: servedOverHttp, loadServerConfig: loadServerConfig, loadHistory: loadHistory,
      loadHistoryPage: loadHistoryPage,
      onAuthScreen: onAuthScreen,
      ago: ago, postForm: postForm, animate: animate, holdDone: holdDone, errMessage: errMessage,
      errorBanner: errorBanner, tickElapsed: tickElapsed,
      tickCompareElapsed: tickCompareElapsed, fmtElapsed: fmtElapsed,
      streamReview: streamReview, streamCompare: streamCompare, clearTimers: clearTimers,
      streamEvaluate: streamEvaluate, tickEvaluateElapsed: tickEvaluateElapsed,
      loadJobs: loadJobs, cancelJob: cancelJob,
      streamCase: streamCase, tickCaseElapsed: tickCaseElapsed,
      fetchCriteria: fetchCriteria, fetchCriteriaLayers: fetchCriteriaLayers,
      loadJobs: loadJobs
    };
  };
})();
