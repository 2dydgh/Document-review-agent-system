/*
 * DocReview frontend — ported from DocReviewDev.dc.html (Claude Design) to a
 * no-build vanilla-JS SPA. UI only; reads window.DOCREVIEW mock data.
 * Visual system: modern B2B SaaS (Linear/Vercel) — see index.html tokens.
 * Real backend (review_document) wiring is intentionally deferred.
 */
(function () {
  "use strict";

  // ---- props --------------------------------------------------------------
  // 색은 여기 없다. 예전엔 accent 를 hex 로 들고 뷰모델에 실었는데, 색이 CSS
  // 변수로 옮겨간 뒤로는 아무도 안 쓰는 값이었다 — hex 는 다크에서 안 뒤집혀
  // 애초에 여기 있을 것이 아니었다(2026-09-02 토큰 정리).
  var props = {};

  // ---- icons (Lucide SVGs) ------------------------------------------------
  var ICONS = window.DR.ICONS;

  // ---- state --------------------------------------------------------------
  var state = {
    mode: "login", screen: "upload", stageIndex: -1, serror: null, theme: "light", done: false,
    // 서버가 보고한 단계별 detail("6,180 chars"). 서버가 준 것만 들어온다 —
    // 비어 있으면 화면은 숫자를 그리지 않는다.
    stageDetail: {},
    // 진행 중인 /api/review 스트림의 AbortController. 다른 검토를 새로 시작하면
    // 이걸로 이전 스트림을 끊는다 — 안 그러면 두 스트림이 같은 window.DOCREVIEW를 다툰다.
    reviewAbort: null,
    // 지금 돌고 있는 서버 작업의 id. 취소가 이 id 로 간다 — 연결만 끊으면
    // 서버는 끝까지 돌고 이력에 저장한다.
    jobId: { single: null, compare: null, case: null, evaluate: null },
    // 결과 화면 옆 대화창(A 안). 서버가 chat_enabled 를 줄 때만 그린다. msgs 는 이 화면에
    // 머무는 동안만 산다 — 대화는 감사 산출물이 아니라 저장하지 않는다(설계 §2).
    chat: { sessions: [], loaded: false, current: null, msgs: [], busy: false, error: "", since: 0,
            // 대화를 여는 중(목록 조회 → 세션 열기, 첫 번은 DoSuree 프로세스 기동까지). 화면이 이걸 말한다.
            opening: false,
            pendingReview: "", pendingReviewTitle: "", pendingReviewKind: "",
            // 사이드바 접힘은 브라우저에 기억한다(상용 채팅 화면 관례).
            sideCollapsed: (function () { try { return localStorage.getItem("dr.assistantSide") === "closed"; } catch (e) { return false; } })(),
            // 어시스턴트를 한 번이라도 열어 봤나(또는 자기소개를 닫았나). 아니면 마스코트가 한 번 자기소개한다.
            seen: (function () { try { return localStorage.getItem("dr.assistantSeen") === "1"; } catch (e) { return false; } })() },
    // 멈춘 직후 잠깐 "검토를 멈췄습니다"를 보여 주는 동안 true(stopThen).
    stopped: { single: false, compare: false, case: false },
    compareAbort: null,
    // 검토의 실제 작업량과 진척. 서버가 Review 시작 때 lanes를 신고하고(청크 68·그룹 84)
    // 그 뒤 step으로 하나씩 채워 보낸다. 총량을 미리 알기에 퍼센트가 역주행하지 않는다.
    rev: { startedAt: 0, prepAt: 0, prep: {}, lanes: [], done: {}, note: "", active: "", criteriaOpen: false },
    cstep: "setup", cstageIndex: -1, cerror: null, cdone: false,
    // 체크리스트 검토(부록 B 초안). 시트 목록은 xlsx 를 올리면 서버가 준다.
    estep: "setup",
    // 초안은 window.DOCREVIEW 를 안 쓴다(2026-09-16 재설계) — 엑셀·원문 보기가
    // 읽을 이력 id 를 제 안에 들고 있는다.
    evalv: { sheets: null, sheetIndex: 0, documentKind: "", error: null, busy: false,
             stage: {}, detail: {}, startedAt: 0, payload: null, written: [],
             historyId: "", historyAt: "" },
    evaluateAbort: null,
    // 비교 검토 입력·표시. cscope 는 하위문서의 담당 요건 범위(정규식) — 문서쌍마다
    // 달라 기준 파일에 못 넣고 요청이 진다. crtmOosOpen 은 범위 밖 묶음 펼침.
    cscope: "", crtmOosOpen: false, crtmOpenKey: null,
    // 긴 셀을 편 자리(셀 단위 — 행을 통째로 펴면 옆 칸까지 길어져 도로 벽이 된다).
    crtmCellOpen: {},
    // 비교 결과의 탭: 요건 판정(rtm) · 기준 판정(criteria). 기준 판정은 화면 맨 아래 접힌
    // 띠였는데 있는 줄도 몰라 탭으로 올렸다(2026-09-16).
    cmpTab: "rtm",
    // 판정을 고치는 중인 행. 판정이 끝난 칸은 결론만 남기므로, 고칠 때만 버튼을 낸다.
    crtmEditKey: null,
    // 키보드로 짚고 있는 행. 25 건을 마우스로만 하면 지친다.
    crtmCursor: null,
    // "아직 판정 안 함"만 보기. 25 건을 두세 번에 나눠 하려면 필수다 —
    // 없으면 다시 앉을 때마다 처음부터 훑어야 한다.
    crtmOnlyTodo: false,
    cview: null,   // 비교 원문 뷰어 {side, file, name, findings, focus}
    // 비교 슬롯별 요건 ID 감지 결과. 추적성의 성패를 가르는 값이라 문서마다
    // 따로 보여준다 — 전역 감지(state.detect)는 마지막 파일 것만 남는다.
    cdetect: { compareA: null, compareB: null },
    // 추적표 판정 {요건ID: {verdict, note}}. 이력이 진실이고 이건 사본이다.
    cverdicts: {}, cverdictSaveError: null,
    // 원문 창. 상위·하위 한 창씩 — 행을 옮기면 같은 창이 따라간다(openDocWindow).
    docWins: {},
    // 원문 창 모드(새 창에서 뷰어만). ?doc= 로 열린다.
    popup: false,
    // 누락 요건 다시 찾기: 진행 중인 요건 ID 와 검토자가 친 힌트.
    csearchBusy: {}, chint: {},
    // 직접 작성 중인 추가 기준(과제 층). 파일 업로드와 달리 검사 방식과 과제
    // 설정값(요건 ID 형식·담당 범위)을 함께 적는다 — 그것이 이 층의 존재 이유다.
    cdraft: null,
    // 케이스 검토(산출물 세트). 값을 **전부 state 에 둔다** — 회원가입 폼처럼 DOM 에
    // 들고 있으면 render() 한 번에 고른 것이 날아간다(아래 selToggle 주석 참고).
    // files 는 File 객체 배열이고 서버로 올릴 때까지 브라우저가 들고 있는다.
    kase: {
      step: "upload",      // upload | recognize | progress | results
      tab: "summary",      // 리포트 탭: summary | outputs | compare | other
      selOutput: "",       // 산출물 탭에서 고른 것
      view: null,          // {key, file, findings} — 뷰어에 띄운 산출물
      checked: {},         // {직접확인 id: true} — 사람이 눌렀나
      manualInputs: {},    // {직접확인 id: 외부 원천값} — 저장된 문서값과 추가 대조
      confirmedAt: "",     // 서버에 남긴 시각. 비면 아직 확정 전이다
      confirming: false,
      // 로그인한 사용자의 소속 팀이 채운다(doLogin). 한 팀을 박아두면 다른 팀이
      // 로그인해도 남의 기준으로 산출물을 재고, 그 실패는 조용한 0건이다.
      team: "",
      files: [],           // [File]
      recog: null,         // /api/classify-case 응답
      assign: {},          // {파일명: 산출물키} — 미분류를 사람이 지정한 것
      exclude: {},         // {파일명: true} — 사람이 뺀 것
      stage: {},           // 진행 detail
      startedAt: 0,
      payload: null,
      criteria: null,      // 팀 검토 기준 (GET /api/teams/{team}/criteria)
      criteriaLoading: false,
      criteriaError: "",   // 못 불러온 사유. "아직 안 부름"과 섞지 않는다
      criteriaFocus: "",   // 기준 화면에서 짚어 보여줄 항목 id
      matrixFocus: "",     // 필드 대조표에서 펼쳐 볼 항목 id
      error: null,
      abort: null
    },
    // 빈 값 = 서버 기본 기준. 예전 기본값 "prd"는 서버에 없는 목업 id 였다.
    checklist: "",
    // 검토자가 기준을 직접 골랐나. 골랐으면 자동 감지가 그 선택을 덮지 않는다.
    checklistPicked: false,
    // 단일 검토를 "이 체크리스트 기준으로 평가"할지. 위 checklist(자동 검토
    // 기준·id_pattern 등)와도, 아래 runChecklistId(독립 화면에서 사람이 직접
    // 채우는 화면)와도 다른 셋째 선택이다 — 등록된 체크리스트를 골라 그 항목별로
    // 자동 findings 를 묶어 본다. 빈 값 = 안 씀(기존 평면 지적 목록 그대로).
    reviewChecklistId: "",
    // 단일 검토에서 "체크리스트" 링크로 탭에 들어왔는지. true 면 탭이 "고르기"
    // 모드가 되어 행마다 "선택" + 상단 "검토로 돌아가기"를 띄운다. 옆
    // 네비게이션으로 그냥 들어오면(setMode) false 로 되돌린다 — 관리 모드다.
    checklistPickReturn: false,
    // /api/detect 결과. 업로드 문서에서 체크리스트별로 요건 ID가 몇 개
    // 걸리는지. null이면 아직 재지 않았다(감지는 편의 기능이라 없어도 검토는 된다).
    detect: null,
    // 체크리스트 라이브러리. preview 는 등록 전 확인용이다 —
    // 열 추측이 틀렸는데 조용히 등록되면 엉뚱한 항목으로 검토하게 된다.
    clib: { list: [], detail: null, busy: false, error: null },
    // 검토 기준 3층(공통·팀별·업로드)을 층째로. 업로드 목록(clib)과 다르다 —
    // 여기는 "무엇으로 재는지"를 항목 본문까지 보여주는 자리다.
    clayers: { list: null, busy: false, error: null, open: {}, openItem: {}, how: "" },
    // 지금 채우고 있는 체크리스트. 자동 검토(rev)와 완전히 독립된 화면(mode
    // "checklistrun")에서 채운다 — LLM 을 기다리지 않는다. from: 뒤로가기
    // 대상("checklists"|"history"). documentName: 이 화면에서 적은 검토 대상
    // 문서명(자동 검토의 files.single 과 무관 — 이 화면은 그걸 거치지 않고도 온다).
    crun: { checklist: null, results: {}, saving: false, error: null, from: "checklists", documentName: "" },
    // 지금 채우는 중인 체크리스트 id(독립 화면 진입원과 무관하게 하나만 있다).
    runChecklistId: "",
    // unreviewed 는 심각도가 아니라 "검사를 못 했다" 보고의 칩이다 — info 와
    // 따로 켜고 끈다(info 를 꺼도 미검토 보고가 같이 사라지면 안 된다).
    sevFilter: { major: true, minor: true, info: true, unreviewed: true },
    // 자리를 확정 못 한 지적의 후보 위치 {id, idx, list:[{page, rect}]}. 고른 카드에만.
    cand: null,
    // "기준 판정" 탭에서 펼친 구역. 사람 확인만 기본으로 열린다.
    criteriaSections: { manual: true },
    // 시작 화면의 문서 종류 {outputs:[{key}], detected, why, key(검토자가 고른 것)}.
    // 파일을 고르면 서버가 파일명으로 가려 주고, 못 가리면 검토자가 고른다.
    outputPick: null,
    checkerFilter: "all", selected: null, sort: "severity", llm: "on",
    files: { single: null, compareA: null, compareB: null, evalDoc: null, evalSheet: null },
    // 원본 PDF 표시(POST /api/annotate)의 진행·결과 문구.
    annot: { busy: false, msg: "" },
    // 인용 하나의 수정안(POST /api/suggest). "지적id|인용순번" → {busy, ok,
    // original, revised, reason}. 지적당 하나가 아니라 **인용당 하나**다 — 지적
    // 하나가 문장 열여덟 개를 근거로 드는 일이 있어, 첫 인용만 고쳐 주면 나머지는
    // 검토자가 손으로 옮겨 적어야 했다. 펼친 카드를 옮기면 통째로 비운다.
    fixes: {},
    // 원본/변환 PDF 뷰어. baseBlob=base PDF(원본 또는 변환본), origUrl=그 blob URL,
    // annot.viewUrl=표시본. converting=변환 중, convertError=변환 실패 문구.
    viewer: { mode: "orig", baseBlob: null, origUrl: null, converting: false, convertError: null },
    // 지적 좌표(POST /api/locate). {pages, items:[{id,no,page,sev,marks}], unlocated}.
    // 형광펜 오버레이와 카드→문서 점프가 읽는다.
    marks: null,
    profileMenuOpen: false, searchOpen: false, notiOpen: false,
    // 홈 우하단 마스코트 런처(빠른 시작 메뉴).
    // 지금 화면에 실린 기록의 id(히스토리 키용). 기록에서 열면 그 id, 방금
    // 돌린 검토면 null. navKey 가 결과 화면 키에 붙여, 기록을 갈아탈 때마다
    // 히스토리가 한 칸씩 쌓이고 뒤로가기가 그 기록을 다시 연다.
    navRecordId: null,
    // 로그인 화면에 한 번 띄우는 안내(회원가입 완료 등). 화면을 옮기면 지운다.
    authNotice: null,
    // 이 세션에서 우리가 직접 본 사건(api.js 의 notify). 서버 알림함이 아니라
    // 새로고침하면 비워지는 목록이고, 화면이 그렇다고 말한다.
    // 알림 = 서버가 가진 검토 작업(GET /api/jobs). 진행 중인 것과 최근에 끝난
    // 것이 함께 온다 — 브라우저 메모리가 아니라서 새로고침해도 그대로다.
    jobs: [],
    // 마스코트 말풍선 — 백그라운드 검토가 **방금** 끝났을 때 하나만(2026-09-15 결정).
    // 인사·팁·진행 중계는 안 한다. 종 알림이 이미 다 말하고, 마스코트까지 말하면 세 번 듣는다.
    mascotSay: null,
    // 어시스턴트로 들어온 자리. "돌아가기"가 여기로 돌려보낸다 — 검토 결과에서 들어왔으면
    // 그 결과로, 홈에서 들어왔으면 홈으로. {mode, screen, cstep, reviewId}.
    assistantReturn: null,
    // 도움말 모달(가운데 문서). 글은 views.js introDoc.
    helpOpen: false, helpClosing: false,
    // 검색어. <input> 이 아니라 여기에 둔다 — DOM 에 들고 있으면 render() 한
    // 번에 날아간다(회원가입 폼이 그렇게 아팠다).
    searchQ: "",
    // 검토 결과 패널 헤더의 내보내기(⇩) 드롭다운.
    exportMenuOpen: false,
    // 서버가 실제로 적용 중인 검토 기준(GET /api/health). null이면 아직 못 읽었다.
    server: null,
    // 저장된 검토 이력(GET /api/history). null이면 아직 못 읽었다(빈 배열과 다르다).
    history: null,
    // 이력을 **못 읽은** 상태. null(아직 안 읽음)·[](없음)과 다른 세 번째다.
    historyError: false, hbusy: false,
    // 검토 기록 목록의 유형 필터. 빈 문자열은 전체다.
    historyKind: "",
    historyQ: "",
    historyOffset: 0,
    historyPage: { entries: [], busy: true, error: null, total: 0, available_total: 0, kind_counts: {}, limit: 20, offset: 0 },
    // 이 세션에서 방금 저장된 검토 기록. 홈 목록에 실제 행이 나타난 첫 렌더에서만
    // 한 번 강조하고 즉시 비운다 — 새로고침·기존 기록 열람에는 애니메이션이 없다.
    homeFreshHistoryId: null,
    // 삭제 확인 모달 대상. null이면 닫힘, {id, title}이면 그 기록을 지울지 묻는 중.
    confirmDelete: null,
    // 계정 관리(관리자). confirmAccount 는 삭제를 묻는 중인 이메일이다.
    admin: { busy: false, list: null, error: null },
    // 설정 화면의 탭. "accounts" 는 관리자에게만 뜨고, 화면이 다시 재확인한다.
    settingsTab: "app",
    confirmAccount: null,
    // 홈의 "무엇으로 재나" 가 쓰는 진짜 기준. {team, layers}
    homeCriteria: null,
    homeCriteriaFocus: "common", // 홈에서 읽는 설명. 실제 검토 기준 선택과는 별개다.
    // 이 세션에서 단일 검토를 끝낸 적이 있나. 없으면 `지적사항` 으로 못 간다.
    reviewed: false,
    // 이 세션에서 비교를 끝낸(또는 기록에서 되살린) 적이 있나 — 단일의
    // reviewed 와 같은 가드. 없으면 비교의 `지적사항` 탭으로 못 뛴다.
    compared: false,
    // 지금 결과 화면을 검토 기록에서 열었나. 결과 화면의 "목록으로 돌아가기"는
    // 이게 참일 때만 뜬다 — 방금 검토를 마친 흐름에는 "돌아갈" 목록이 없다
    // (checklistrun 의 crun.from 과 같은 관용구다).
    fromHistory: false,
    // 지적사항 화면 오른쪽 "검토 결과" 패널 접힘. 재현본은 그만큼 넓어지지만
    // PDF 카드는 안 커진다 — aspect-ratio로 높이에 맞춰 폭을 정해서, 자리가 나도
    // 좌우 여백만 늘 뿐이다. PDF를 크게 보려면 viewerFull(전체화면) 쪽을 쓴다.
    issuesCollapsed: false,
    // 결과 패널은 수정 사항 / 검토 상태를 구분한다. 재검토라면 반영 확인도 유지한다.
    // 기본은 일반 검토에서 수정 사항, 재검토에서 반영 확인이다.
    // null 이면 아직 안 골랐다는 뜻이라 화면이 기본값을 정한다.
    reviewTab: null,
    // 결과 화면 전체화면. 문서와 "검토 결과"를 둘 다 남긴 채 사이드바·헤더·백링크
    // 바만 덮어 세로를 번다(views.js resultsRowCss).
    viewerFull: false
  };


  // ---- helpers ------------------------------------------------------------
  var _H = window.DR.helpers;
  var esc = _H.esc, downloadBlob = _H.downloadBlob, download = _H.download, fmtSize = _H.fmtSize;
  // Store a picked/dropped file into a slot; optionally jump into that mode.

  // ── 케이스 파일 모으기 ──────────────────────────────────────────────────
  // 폴더를 통째로 받는다. 산출물이 00.~03. 하위 폴더로 나뉘어 있어서, 파일만
  // 고르게 하면 사용자가 네 번 반복해야 한다.

  function openCasePicker(folder) {
    var inp = document.createElement("input");
    inp.type = "file";
    inp.multiple = true;
    if (folder) { inp.webkitdirectory = true; inp.directory = true; }
    inp.onchange = function () {
      actions.addCaseFiles(Array.prototype.slice.call(inp.files || []));
    };
    inp.click();
  }

  // 드롭된 항목을 재귀로 훑어 파일만 모은다. webkitGetAsEntry 를 안 쓰면
  // dataTransfer.files 에 폴더가 이름만 담겨 와 내용이 사라진다.
  function collectDropped(items, done) {
    var entries = [], pending = 1, out = [];
    for (var i = 0; i < items.length; i++) {
      var e = items[i].webkitGetAsEntry && items[i].webkitGetAsEntry();
      if (e) entries.push(e);
    }
    if (!entries.length) { done(out); return; }
    function finish() { if (--pending === 0) done(out); }
    function walk(entry) {
      if (entry.isFile) {
        pending++;
        entry.file(function (f) { out.push(f); finish(); }, finish);
        return;
      }
      if (!entry.isDirectory) return;
      pending++;
      var reader = entry.createReader();
      (function readMore() {
        reader.readEntries(function (batch) {
          if (!batch.length) { finish(); return; }
          batch.forEach(walk);
          readMore();               // readEntries 는 한 번에 다 주지 않는다
        }, finish);
      })();
    }
    entries.forEach(walk);
    finish();
  }

  // 이 팀이 가리는 문서 종류와, 이 파일명으로 가린 결과를 받아 온다(2026-09-15).
  // 못 가리면 종류 전용 검사가 통째로 빠지므로 검토자가 시작 화면에서 고른다.
  function loadOutputPick(name) {
    var team = state.checklist || (state.user && state.user.team) || "";
    state.outputPick = null;
    if (!team) return;
    fetch("api/teams/" + encodeURIComponent(team) + "/single-outputs?name=" + encodeURIComponent(name))
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (b) {
        if (!b || !(b.outputs || []).length) return;
        state.outputPick = { outputs: b.outputs, detected: b.detected || "", why: b.why || "", key: "" };
        if (state.mode === "single" && state.screen === "upload") render();
      })
      .catch(function () { /* 목록 없이도 검토는 된다 — 파일명으로 가린다 */ });
  }

  // 체크리스트 xlsx 를 올리면 시트 목록(항목 수·읽을 수 없는 이유)을 받아 둔다.
  function loadEvalSheets(file) {
    var fd = new FormData();
    fd.append("file", file);
    state.evalv.sheets = null; state.evalv.sheetIndex = 0; state.evalv.documentKind = "";
    state.evalv.busy = true; state.evalv.error = null;
    render();
    // 읽는 동안 경과를 센다 — 검토 작업과 겹치면 수 초가 걸려, 숫자가 움직여야 산 줄 안다.
    var t0 = Date.now();
    (function tickSheets() {
      if (!state.evalv.busy) return;
      var el = document.getElementById("eval-sheets-elapsed");
      if (el) { var sec = Math.round((Date.now() - t0) / 1000); el.textContent = sec >= 2 ? sec + "초" : ""; }
      setTimeout(tickSheets, 500);
    })();
    fetch("api/evaluate/sheets", { method: "POST", body: fd })
      .then(function (res) {
        if (!res.ok) return res.json().catch(function () { return {}; }).then(function (b) {
          throw new Error(b.detail || ("서버 오류 (HTTP " + res.status + ")")); });
        return res.json();
      })
      .then(function (b) {
        state.evalv.sheets = b.sheets || [];
        // 읽을 수 있는 첫 시트를 미리 고른다 — 대개 그게 원하는 것이고, 아니면 바꾼다.
        var ok = state.evalv.sheets.filter(function (s) { return !s.error; })[0];
        state.evalv.sheetIndex = ok ? ok.index : -1;
      })
      .catch(function (err) { state.evalv.error = errMessage(err); state.evalv.sheets = []; })
      .then(function () { state.evalv.busy = false; render(); });
  }

  function handleFile(slot, nav, file) {
    if (!file || !state.files.hasOwnProperty(slot)) return;
    // file 원본을 들고 있어야 /api/compare로 실제 업로드할 수 있다.
    state.files[slot] = { name: file.name, size: file.size, file: file };
    // 단일 검토 파일이면 어디서 골랐든(시작 화면의 드롭존은 nav 가 없다) 문서 종류를 묻는다.
    if (slot === "single") loadOutputPick(file.name);
    // 체크리스트 xlsx 는 시트를 골라야 쓸 수 있다 — 올리는 즉시 목록을 받는다.
    if (slot === "evalSheet") loadEvalSheets(file);
    if (nav === "single") {
      state.mode = "single"; state.screen = "upload";
      // 파일 드롭으로 들어오면 setMode를 안 거쳐 체크리스트 목록이 안 읽힌다.
      // 그러면 "체크리스트 선택"이 첫 화면에서 비어 있다 — 여기서 채운다.
      if (!state.clib.list.length) actions.loadChecklists();
    }
    else if (nav === "compare") { state.mode = "compare"; state.cstep = "setup"; }
    else if (nav === "evaluate") { state.mode = "evaluate"; state.estep = "setup"; }
    render();
    // 기준(요건 ID) 감지는 단일·비교 검토의 것이다. 체크리스트 검토의 두 칸은
    // 시트가 잣대라 감지할 것이 없다 — xlsx 를 파서에 태우면 헛돈다.
    if (slot !== "evalDoc" && slot !== "evalSheet") detectChecklist(file, nav === "compare" ? slot : "");
  }

  // 업로드한 문서를 체크리스트마다 재서 요건 ID가 몇 개 걸리는지 알아온다.
  //
  // 잘못된 체크리스트의 실패는 에러가 아니라 **조용한 0건**이다 — 검토를 통과한
  // 것처럼 보인다. 같은 실에서 온 문서인데도 ID 체계가 달라(PLT34: FR-GC_01,
  // PLT56: FR1-0305) 어떤 기본값도 옳을 수 없다. 그래서 고르기 전에 재본다.
  //
  // 서버가 없으면(정적 미리보기) 조용히 넘어간다 — 감지는 편의 기능이지
  // 검토의 전제가 아니다.
  // 판정 한 건을 이력에 붙인다(부분 저장 — 서버가 합친다). 실패는 조용히
  // 넘기지 않는다 — 화면이 저장된 척하면 27건 판정이 통째로 사라진다.
  //: 저장이 끝나기를 기다리는 콜백들. 엑셀은 방금 누른 판정까지 담아야 하는데,
  //: 파일은 **서버가 이력에서 꺼내** 만들기 때문에 저장이 끝나야 들어간다.
  //: 시간을 추측해 기다리면(setTimeout) 느린 날에는 빠진 채로 나간다.
  var rtmSaving = 0;
  var rtmSavedCbs = [];
  function afterRtmSaved(fn) {
    if (!rtmSaving) { fn(); return; }
    rtmSavedCbs.push(fn);
  }
  function rtmSaveDone() {
    rtmSaving = Math.max(0, rtmSaving - 1);
    if (rtmSaving) return;
    var cbs = rtmSavedCbs; rtmSavedCbs = [];
    cbs.forEach(function (fn) { fn(); });
  }

  function saveRtmVerdict(vkey, value) {
    var hid = ((window.DOCREVIEW.compare || {}).history || {}).id;
    if (!hid) {
      state.cverdictSaveError = "이 결과는 이력에 저장되지 않아 판정을 남길 수 없습니다.";
      if (!repaintCompareTrace({ chrome: true })) render();
      return;
    }
    rtmSaving += 1;
    var fd = new FormData();
    var one = {}; one[vkey] = value;
    fd.append("verdicts", JSON.stringify(one));
    fetch("api/history/" + encodeURIComponent(hid) + "/rtm-verdicts",
          { method: "POST", body: fd })
      .then(function (res) {
        if (!res.ok) return res.json().catch(function () { return {}; })
          .then(function (b) { throw new Error(b.detail || ("HTTP " + res.status)); });
        return res.json();
      })
      .then(function (payload) {
        window.DOCREVIEW.compare.rtmVerdicts = payload.rtmVerdicts || {};
        window.DOCREVIEW.compare.rtmCarried = payload.rtmCarried || {};
        if (state.cverdictSaveError) {
          state.cverdictSaveError = null;
          if (!repaintCompareTrace({ chrome: true })) render();
        }
        rtmSaveDone();
      })
      .catch(function (err) {
        rtmSaveDone();
        state.cverdictSaveError = "판정 저장 실패: " + errMessage(err);
        if (!repaintCompareTrace({ chrome: true })) render();
      });
  }

  function detectChecklist(file, slot) {
    if (!servedOverHttp()) return;
    state.detect = { busy: true, best: null, list: [], error: null };
    if (slot) state.cdetect[slot] = { busy: true };
    render();
    var fd = new FormData();
    fd.append("file", file, file.name);
    postForm("api/detect", fd).then(function (body) {
      state.detect = { busy: false, best: body.best, list: body.detected || [], error: null };
      // 슬롯에는 목록째 둔다 — 개수는 renderVals 가 지금 고른 기준으로 그때그때
      // 계산한다. 여기서 개수를 굳히면 기준을 바꿀 때 옛 숫자가 남는다.
      if (slot) state.cdetect[slot] = { busy: false, list: body.detected || [], error: null };
      // 검토자가 직접 고른 기준은 말없이 갈아치우지 않는다. 아무것도 안 골랐을
      // 때만 감지 결과로 맞춰준다 — 그게 조용한 0건을 막는 가장 확실한 지점이다.
      if (body.best && !state.checklistPicked && state.checklist !== body.best) {
        state.checklist = body.best;
        if (servedOverHttp()) loadServerConfig(); else render();
        return;
      }
      render();
    }).catch(function (err) {
      // 감지 실패가 검토를 막지는 않는다. 다만 조용히 넘기지도 않는다.
      state.detect = { busy: false, best: null, list: [], error: errMessage(err) };
      if (slot) state.cdetect[slot] = { busy: false, list: [], error: errMessage(err) };
      render();
    });
  }

  // ---- backend ------------------------------------------------------------
  // 서버가 보관한 이력 원본을 뷰어로. 이력에서 열 때(openHistory)와 알림에서
  // 재접속한 검토가 끝났을 때(api.js done) 같은 길을 쓴다. 밀려나 없으면 404 →
  // 텍스트 폴백. doc 은 그새 다른 검토로 넘어갔는지 대조하는 표식이다.
  function pullOriginal(historyId, docName, doc) {
    var viewer = state.viewer;
    function current() {
      return state.viewer === viewer && state.mode === "single" && state.screen === "results" && window.DOCREVIEW.doc === doc;
    }
    return fetch("api/history/" + encodeURIComponent(historyId) + "/original")
      .then(function (res) {
        if (res.status === 404) return null;
        if (!res.ok) throw new Error("원본 조회 실패 (HTTP " + res.status + ")");
        return res.blob();
      })
      .then(function (blob) {
        if (!current()) return;
        state.viewer.loadingOrig = false;
        state.viewer.originalError = null;
        state.viewer.originalGone = false;
        if (!blob) {
          // 원본 없음(404). 조용히 텍스트 재현본으로 떨어뜨리면 "PDF 변환이
          // 깨졌다"로 읽힌다 — 실제로 그렇게 보고가 올라왔다(2026-09-08).
          // 검토 결과는 그대로 있고 사라진 것은 원문뿐이라는 사실을 말한다.
          state.viewer.originalError =
            "보관 한도가 지나 원본 문서가 서버에 없습니다. 엔진이 읽은 본문으로 표시합니다.";
          state.viewer.originalGone = true;       // 다시 불러와도 없다 — 재시도를 권하지 않는다
          render(); return;
        }
        // 세 번째 인자를 빼면 File 의 type 이 빈 문자열이 된다 — 서버가
        // application/pdf 로 보내도 여기서 버려지고, 그 blob URL 을 받은
        // iframe 은 PDF 를 못 그린다. 업로드 경로(input.files[0])는 브라우저가
        // 타입을 채워주므로 이력에서 되살릴 때만 나던 증상이었다.
        var file = new File([blob], docName, { type: blob.type || "application/pdf" });
        state.files.single = { name: docName, size: file.size, file: file };
        render();   // maybeConvert가 뷰어를 띄운다(pdf 직접·docx/hwpx 변환)
      })
      .catch(function () {
        if (!current()) return;
        state.viewer.loadingOrig = false;
        state.viewer.originalError = "원본 파일을 불러오지 못했습니다. 저장된 본문을 표시합니다.";
        state.viewer.originalGone = false;        // 통신 실패는 다시 해 볼 값어치가 있다
        render();
      });
  }
  // 멈춘 뒤 곧장 업로드 화면으로 튀지 않고, 진행 화면 머리말이 "검토를 멈췄습니다"
  // 를 한 박자(STOP_HOLD_MS) 말한 뒤 돌아간다(2026-09-04: "취소돼서 업로드로
  // 넘어오는 게 뚝 끊긴다"). 완료 때의 holdDone 과 같은 관용구 — 상태가 바뀌었다는
  // 것을 먼저 보여 주고 화면을 옮긴다. 이미 멈추는 중이면 두 번 걸지 않는다.
  var STOP_HOLD_MS = 900;
  function stopThen(which, reset) {
    if (state.stopped[which]) return;
    state.stopped[which] = true;
    render();
    setTimeout(function () { state.stopped[which] = false; reset(); }, STOP_HOLD_MS);
  }
  // 밖에서 멈춘 검토(알림 창의 "멈추기"·다른 탭). 스트림이 cancelled 를 보내면
  // 진행 화면이 그 자리에 굳어 있었다(2026-09-04) — 제 손으로 멈췄을 때와 같은
  // 자리(업로드·설정·인식 확인)로 돌아간다. 서버엔 다시 안 보낸다: jobId 를 먼저
  // 비우면 cancelReview 안의 cancelJob 이 보낼 것이 없어 조용히 지나간다.
  function onJobCancelledRemotely(which) {
    state.jobId[which] = null;
    // 그 진행 화면을 보고 있으면 머리말이 말한다 — 토스트는 다른 화면에 있을 때만.
    if (state.mode !== which) toast("검토를 멈췄습니다");
    if (which === "single") actions.cancelReview();
    else if (which === "compare") actions.cancelCompare();
    else if (which === "evaluate") actions.cancelEvaluate();
    else actions.cancelCase();
  }
  // 방금 끝난 검토를 마스코트가 말한다. 그 검토의 진행 화면을 이 탭이 보고 있으면
  // 안 한다 — 결과가 이미 눈앞에 뜬다. 15초 뒤 스스로 걷는다(버튼 둘을 읽을 시간).
  var mascotSayTimer = null;
  function mascotAnnounce(prevJobs, jobs) {
    var job = _H.newlyDone(prevJobs, jobs);
    if (!job) return;
    var which = job.kind === "review" ? "single" : job.kind === "compare" ? "compare"
              : job.kind === "case" ? "case" : job.kind === "evaluation" ? "evaluate" : null;
    if (which && state.jobId[which] === job.id && state.mode === which) return;
    state.mascotSay = { id: job.id, kind: job.kind, title: job.title || "", history_id: job.history_id || "" };
    if (mascotSayTimer) clearTimeout(mascotSayTimer);
    mascotSayTimer = setTimeout(function () {
      mascotSayTimer = null;
      if (state.mascotSay && state.mascotSay.id === job.id) { state.mascotSay = null; render(); }
    }, 15000);
    render();
  }
  var _be = window.DR.backend({ state: state, render: render, repaintProgress: repaintProgress,
                                repaintHistoryRecords: repaintHistoryRecords,
                                repaintCaseStages: repaintCaseStages,
                                // _views 는 아래에서 만들어지므로 늦게 묶는다(호출 시점엔 있다).
                                patchEvaluateProgress: function (evalv) { return _views.patchEvaluateProgress(evalv); },
                                onCancelled: onJobCancelledRemotely, pullOriginal: pullOriginal,
                                onJobsLoaded: mascotAnnounce });
  var servedOverHttp = _be.servedOverHttp, loadServerConfig = _be.loadServerConfig,
      loadHistory = _be.loadHistory, ago = _be.ago, postForm = _be.postForm,
      loadHistoryPage = _be.loadHistoryPage,
      loadJobs = _be.loadJobs, cancelJob = _be.cancelJob,
      animate = _be.animate, holdDone = _be.holdDone, errMessage = _be.errMessage,
      errorBanner = _be.errorBanner, tickElapsed = _be.tickElapsed, fmtElapsed = _be.fmtElapsed,
      streamReview = _be.streamReview, streamCompare = _be.streamCompare,
      streamEvaluate = _be.streamEvaluate, tickEvaluateElapsed = _be.tickEvaluateElapsed,
      streamChat = _be.streamChat,
      clearTimers = _be.clearTimers,
      streamCase = _be.streamCase, tickCaseElapsed = _be.tickCaseElapsed,
      tickCompareElapsed = _be.tickCompareElapsed,
      fetchCriteria = _be.fetchCriteria,
      fetchCriteriaLayers = _be.fetchCriteriaLayers,
      notify = _be.notify;

  // 산출물 세트 검토가 쓸 팀 기준. 로그인이 채우지만, 기록에서 되살린 화면이나
  // 팀 없이 만들어진 옛 계정은 비어 있을 수 있다. 그대로 서버에 보내면 404 가
  // 나므로 여기서 막고 무엇을 해야 하는지 말한다 — 실패 이유가 "그런 팀 기준이
  // 없습니다"로 뜨면 검토자는 자기가 뭘 잘못했는지 알 수 없다.
  function caseTeam() {
    return state.kase.team || (state.user && state.user.team) || "";
  }
  var _NO_TEAM = "소속 팀을 확인할 수 없습니다. 다시 로그인해 주세요.";

  function invalidateManualResult(k, id) {
    var p = k.payload;
    k.confirmedAt = "";
    k.error = "";
    if (!p) return;
    p.manualResults = (p.manualResults || []).filter(function (r) { return r.id !== id; });
    p.findings = (p.findings || []).filter(function (f) {
      return !(f.kind === "manual_input" && f.ruleId === id);
    });
    p.stats = p.stats || {};
    p.stats.findings = p.findings.filter(function (f) { return !f.unreviewed && f.sev !== "info"; }).length;
    p.stats.unreviewed = p.findings.filter(function (f) { return !!f.unreviewed; }).length;
  }

  function focusCaseNode(selector) {
    setTimeout(function () {
      var el = document.querySelector(selector);
      // index.html 의 prefers-reduced-motion 규칙(scroll-behavior:auto)은 여기
      // 안 먹는다: JS 가 behavior 를 명시하면 그쪽이 CSS 를 이긴다. 직접 묻는다.
      if (el && el.scrollIntoView) {
        el.scrollIntoView({ block: "center", behavior: reduceMotion() ? "auto" : "smooth" });
      }
    }, 0);
  }

  // ---- actions ------------------------------------------------------------
  var actions = {
    doLogin: function() {
      var em = document.getElementById("loginEmail").value;
      var pw = document.getElementById("loginPwd").value;
      var remember = document.getElementById("rememberId").checked;
      if (remember) localStorage.setItem("dr_last_email", em);
      else localStorage.removeItem("dr_last_email");

      var btn = document.getElementById("loginBtn");
      btn.innerHTML = '<span style="display:inline-block;animation:spin 1s linear infinite;margin-right:8px;">' + ICONS.refresh + '</span>로그인 처리 중...';
      btn.style.pointerEvents = "none";
      btn.style.opacity = "0.8";
      function fail(msg) {
        // alert 가 아니라 화면 안 글줄이다. render() 를 부르면 입력이 DOM 에만
        // 있어 방금 친 이메일·비밀번호가 날아가므로(selToggle 주석) 글만 채운다.
        var b = document.getElementById("loginBtn");
        if (b) { b.innerHTML = "로그인"; b.style.pointerEvents = ""; b.style.opacity = ""; }
        authError(msg);
      }
      // 계정은 서버가 가진다. 세션은 HttpOnly 쿠키라 JS 가 토큰을 못 만진다.
      var fd = new FormData();
      fd.append("email", em); fd.append("password", pw);
      // 세션 수명은 서버가 정한다 — 켜면 30일 쿠키, 끄면 브라우저를 닫을 때
      // 사라지는 세션 쿠키다. 화면에서 못 정한다(HttpOnly 라 JS 가 못 만진다).
      fd.append("remember", remember ? "1" : "");
      postForm("api/auth/login", fd).then(function (acc) {
        state.authNotice = null;
        applyAccount(acc);
        state.profileMenuOpen = false;
        // 홈은 **준비된 뒤에** 보여준다. 예전엔 로그인하자마자 홈이 떴는데,
        // 팀 기준과 검토 기록이 아직 없어서 기준 타일이 빈 채로 떴다가 뒤늦게
        // 채워졌다 — 다 그려진 화면이 눈앞에서 한 번 더 고쳐지는 셈이었다.
        //
        // 로딩 화면을 따로 만들지 않는다. 로그인 화면이 이미 그 자리고, 버튼이
        // 벌써 돌고 있다. 글도 안 바꾼다 — 사용자에게는 로그인이 끝난 게 아니라
        // 아직 들어가는 중이라, "로그인 처리 중" 한 마디로 충분하다.
        //
        // 시간을 재서 감추는 가짜 로딩이 아니다. 실제로 저 둘을 기다린다. 다만
        // 서버가 늦거나 죽으면 MAX 에서 놓아준다 — 홈은 못 읽은 사실을 제 자리에서
        // 말할 수 있고, 로그인 화면에 사람을 가둘 일이 아니다.
        var MAX = 5000;
        // quiet: 아직 로그인 화면이다 — 목록이 도착했다고 다시 그리면 안 된다.
        var loaded = Promise.all([loadHomeCriteria(), loadHistory(true)]);
        var capped = new Promise(function (done) { setTimeout(done, MAX); });
        // 성공이든 실패든 반드시 넘어간다. 거절 하나로 멈추면 버튼이 영원히 돌고,
        // 새로고침 말고는 나갈 길이 없다.
        // 걸어둔 검토가 아직 돌고 있으면 알림에 뜬다. 홈을 막지는 않는다 —
        // 알림은 편의라 도착이 늦어도 화면이 기다릴 이유가 없다.
        function go() { state.mode = "home"; render(); loadJobs(); }
        Promise.race([loaded, capped]).then(go, go);
      }).catch(function (err) { fail(errMessage(err)); });
    },
    toggleProfile: function() {
      state.profileMenuOpen = !state.profileMenuOpen;
      if (state.profileMenuOpen) state.profileOpenedAt = Date.now();
      state.searchOpen = false;
      render();
    },
    openProfileSettings: function() {
      state.profileSettingsOpen = true;
      state.profileMenuOpen = false;
      render();
      var sDept = state.user ? state.user.dept : "";
      var pst = state.user ? state.user.team : "";
      var opts = state.server && state.server.checklists ? state.server.checklists : [];
      for (var i = 0; i < opts.length; i++) {
        if (opts[i].name === pst || opts[i] === pst) {
          pst = opts[i].id || opts[i];
          break;
        }
      }
      actions.selPick("psDept|" + sDept);
      actions.selPick("psTeam|" + pst);
    },
    openHelp: function () { state.helpOpen = true; state.helpClosing = false; state.profileMenuOpen = false; render(); },
    // 닫기는 밀려 나가는 200ms 뒤에 DOM 에서 뗀다 — 바로 떼면 나가는 움직임이 없다.
    closeHelp: function () {
      if (!state.helpOpen || state.helpClosing) return;
      state.helpClosing = true; render();
      setTimeout(function () { state.helpOpen = false; state.helpClosing = false; render(); }, 160);
    },
    closeProfileSettings: function() {
      state.profileSettingsOpen = false;
      render();
    },
    saveProfileSettings: function() {
      if (!state.user) return;
      var nm = document.getElementById("psName").value || state.user.name;
      var selDept = document.getElementById("psDept");
      var dept = selDept && selDept.dataset.value ? selDept.dataset.value : state.user.dept;
      var selTeam = document.getElementById("psTeam");
      var team = selTeam && selTeam.dataset.value ? selTeam.dataset.value : state.user.team;
      
      // 프로필은 서버 계정에 남는다 — 다음 로그인·다른 PC 에서도 같아야 한다.
      var fd = new FormData();
      fd.append("name", nm); fd.append("dept", dept); fd.append("team", team);
      state.profileSettingsOpen = false;
      applyAccount({ email: state.user.email, name: nm, dept: dept, team: team,
                     role: state.user.role });
      render();
      if (!servedOverHttp()) return;
      postForm("api/auth/profile", fd).catch(function (err) {
        toast("프로필 저장 실패: " + errMessage(err), "bad");
      });
    },
    // 알림을 펼치면 읽은 것으로 친다 — 목록을 봤는데도 빨간 점이 남아 있으면
    // 무엇을 더 해야 하는지 알 수 없다.
    toggleNoti: function () {
      state.notiOpen = !state.notiOpen;
      if (state.notiOpen) {
        // 등장 애니메이션은 이 시각 기준으로 한 번만 — views 가 흐른 시간만큼
        // 음수 지연을 줘서, 진행 이벤트·폴링으로 다시 그려져도 되감기지 않는다.
        state.notiOpenedAt = Date.now();
        // 펼칠 때 새로 가져온다. 목록은 부팅 때 한 번 받아둔 것이라, 그동안
        // 끝났거나 새로 걸린 검토가 반영돼 있지 않다.
        loadJobs();
        // 읽음은 서버가 기억한다 — 새로고침해도 다시 빨간 점이 뜨지 않게.
        if (servedOverHttp()) {
          postForm("api/jobs/seen", new FormData()).then(function () {
            state.jobs = (state.jobs || []).map(function (j) {
              return Object.assign({}, j, { seen: true });
            });
            render();
          }).catch(function () { /* 편의라 실패해도 조용히 넘어간다 */ });
        }
      }
      state.profileMenuOpen = false; state.searchOpen = false;
      render();
    },

    // 검색은 검토 기록(제목)과 등록된 체크리스트(이름)를 뒤진다. 둘 다 이미 받아
    // 둔 목록이라 새 엔드포인트가 없다 — 체크리스트만 아직 안 읽었으면 여기서
    // 채운다(검토 기준 화면에 한 번도 안 들어간 사람은 목록이 비어 있다).
    toggleSearch: function() {
      state.searchOpen = !state.searchOpen;
      // 열 때마다 빈 칸에서 시작한다. 지난 검색어가 남아 있으면 결과부터 뜨는데,
      // 그게 방금 친 것인지 저번 것인지 구별이 안 된다.
      if (state.searchOpen) {
        state.searchQ = "";
        if (!state.clib.list.length) actions.loadChecklists(true);
      }
      // 프로필 메뉴가 열려 있었다면 헤더가 바뀌어야 한다 — 그때만 전체를 그린다.
      var hadMenu = state.profileMenuOpen;
      state.profileMenuOpen = false;
      if (hadMenu) render(); else renderSearch();
    },
    goSignup: function() {
      state.mode = "signup";
      render();
    },
    // 커스텀 셀렉트(회원가입 부서·팀). 회원가입 폼은 입력값을 state 가 아니라
    // DOM 에 들고 있어서, 여기서 render() 를 부르면 이미 친 이름·이메일이 날아간다 —
    // 그래서 이 두 액션만 다시 그리지 않고 DOM 을 직접 만진다.
    selToggle: function (id) {
      var sel = document.getElementById(id);
      if (!sel) return;
      var willOpen = !sel.classList.contains("open");
      closeSelects();
      if (willOpen) {
        sel.classList.add("open");
        sel.querySelector(".sel-btn").setAttribute("aria-expanded", "true");
      }
    },
    selPick: function (arg) {
      var cut = arg.indexOf("|");
      var selId = arg.slice(0, cut);
      var sel = document.getElementById(selId);
      var val = arg.slice(cut + 1);
      if (!sel) return;
      // 번역 기능이 없는 언어를 선택·저장한 것처럼 보이지 않게 한다.
      if (selId === "settingsLanguage" && val !== "ko") return;
      sel.setAttribute("data-value", val);
      var label = sel.querySelector(".sel-label");
      label.removeAttribute("data-ph");   // placeholder 회색을 벗는다
      var opts = sel.querySelectorAll(".sel-opt");
      for (var i = 0; i < opts.length; i++) {
        var on = opts[i].getAttribute("data-arg") === arg;
        opts[i].setAttribute("aria-selected", on ? "true" : "false");
        // 값과 보이는 이름은 다를 수 있다 — 팀은 값이 "EV2", 이름이 "에너지검증 2팀"
        // 이다. val 을 그대로 쓰면 화면에 파일명이 뜬다.
        if (on) label.textContent = opts[i].querySelector("span").textContent;
      }
      closeSelects();

      if (selId === "settingsLanguage") {
        sel.querySelector(".sel-btn").focus();
        return;
      }
      if (selId === "criteriaHow") {
        actions.setCriteriaHow(val === "all" ? "" : val);
        var criteriaTrigger = document.querySelector('#criteriaHow .sel-btn');
        if (criteriaTrigger) criteriaTrigger.focus({ preventScroll: true });
        return;
      }
      // 체크리스트 검토의 문서 종류. 시트가 문서마다 행을 가를 때만 뜬다.
      if (selId === "evalDocKind") { actions.setEvalDocKind(val); return; }
      // 시작 화면의 문서 종류. 값만 담는다 — 검토 시작 때 output_key 로 보낸다.
      if (selId === "outputKey") {
        if (state.outputPick) state.outputPick.key = val;
        return;
      }
      if (selId === "singleResultChecker" || selId === "singleResultSort") {
        actions[selId === "singleResultChecker" ? "setChecker" : "setSort"](val);
        // 결과 패널만 갱신한 뒤 새 선택 버튼으로 포커스를 돌려준다.
        var next = document.querySelector('#' + selId + ' .sel-btn');
        if (next) next.focus({ preventScroll: true });
        return;
      }

      // 반영 확인 판정. 회원가입 폼과 달리 값이 state 에 있어야 한다 — DOM 에만
      // 두면 새로고침 한 번에 사라지고, 서버에도 안 간다.
      if (selId.indexOf("lnv-") === 0) {
        actions.setLineageVerdict(selId.slice(4), val);
        return;                       // setLineageVerdict 가 render() 한다
      }

      // 인식 확인의 "미분류 → 산출물 지정". 파일명이 아니라 미분류 목록의
      // 위치(index)를 id 에 싣는다 — 파일명에는 | 나 따옴표가 올 수 있어
      // data-arg 파싱을 깬다.
      // 관리자 계정 관리의 권한 드롭다운. id 에 이메일이 실려 있다(arole-<메일>).
      if (selId.indexOf("arole-") === 0) {
        actions.setAccountRole(selId.slice(6) + "|" + val);
        return;                       // setAccountRole 이 다시 읽어 render 한다
      }

      if (selId.indexOf("asg-") === 0) {
        var r = state.kase.recog || {};
        var nm = (r.unclassified || [])[Number(selId.slice(4))];
        if (nm != null) actions.assignOutput(nm, val);
        return;                       // assignOutput 이 render() 한다
      }

      if (selId === "signupDept" || selId === "psDept") {
        var teamSelId = selId === "signupDept" ? "signupTeam" : "psTeam";
        var teamWrapperId = teamSelId + "Wrapper";
        var wrapper = document.getElementById(teamWrapperId);
        if (wrapper && _views.getTeamsForDept && _views.selectField) {
          var filteredTeams = _views.getTeamsForDept(val);
          var html = "";
          if (selId === "signupDept") {
             html += '<label style="display:block;margin-bottom:8px;font-size:14px;font-weight:600;color:var(--text);">팀</label>';
          } else {
             html += '<div style="font-size:12px;color:var(--text-3);margin-bottom:6px;">팀 (검사 기준)</div>';
          }
          html += _views.selectField(teamSelId, "팀 선택", filteredTeams);
          wrapper.innerHTML = html;
        }
      }
    },
    doSignup: function() {
      var em = document.getElementById("signupEmail").value;
      var pw = document.getElementById("signupPwd").value;
      var nm = document.getElementById("signupName").value || "";
      var dept = selValue("signupDept"), team = selValue("signupTeam");
      if (!em || !pw) {
        authError("이메일과 비밀번호를 모두 입력해주세요.");
        return;
      }
      var btn = document.getElementById("signupBtn");
      btn.innerHTML = '<span style="display:inline-block;animation:spin 1s linear infinite;margin-right:8px;">' + ICONS.refresh + '</span>가입 처리 중...';
      btn.style.pointerEvents = "none";
      btn.style.opacity = "0.8";
      var fd = new FormData();
      fd.append("email", em); fd.append("password", pw);
      fd.append("name", nm); fd.append("dept", dept); fd.append("team", team);
      // 규칙(형식·길이·중복)은 서버가 진다 — 화면에서만 막으면 API 로 우회된다.
      postForm("api/auth/signup", fd).then(function () {
        state.authNotice = "회원가입이 완료되었습니다. 로그인해 주세요.";
        state.mode = "login";
        render();
      }).catch(function (err) {
        var b = document.getElementById("signupBtn");
        if (b) { b.innerHTML = "회원가입"; b.style.pointerEvents = ""; b.style.opacity = ""; }
        authError(errMessage(err));
      });
    },
    // 비밀번호 재발급은 아직 없다 — 사내 메일 발송 경로가 정해지지 않았다.
    // "보냈다"고 말하지 않는다(거짓말 대신 관리자 문의로 보낸다).
    doForgot: function() {
      state.authNotice = null;
      authError("비밀번호 재설정은 아직 준비 중입니다. 관리자에게 문의해 주세요.");
    },
    // 새로고침으로 나간다. state 를 손으로 비우면 반드시 하나를 빠뜨리고, 그
    // 하나가 다음 사람에게 남는다 — 실제로 kase.team 이 남아 팀 없는 계정이
    // 앞사람 팀 기준으로 검토됐다. 아이디 기억은 localStorage 라 살아남는다.
    doLogout: function() {
      // 서버 세션까지 끊고 새로고침한다. state 를 손으로 비우면 반드시 하나를
      // 빠뜨린다. 쿠키만 지우고 화면을 남기면 다음 사람이 앞사람 결과를 본다.
      var done = function () { location.reload(); };
      if (!servedOverHttp()) { done(); return; }
      fetch("api/auth/logout", { method: "POST" }).then(done, done);
    },
    // 새 문서를 검토하러 업로드 화면으로. 검토가 끝나면 screen이 "results"에
    // 머무는데, setMode는 mode만 바꾸므로 홈을 거쳐 돌아와도 묵은 결과가 다시
    // 떴다 — 페이지를 새로고침하지 않는 한 다음 문서를 볼 수 없었다.
    //
    // 앞 문서의 흔적을 여기서 다 지운다. 하나라도 남으면 새 문서 위에 이전
    // 지적·PDF가 얹혀 보인다 — 검토 도구에서 이건 그냥 오답이다.
    newReview: function (which) {
      if (state.viewer.origUrl) URL.revokeObjectURL(state.viewer.origUrl);
      if (state.annot.viewUrl) URL.revokeObjectURL(state.annot.viewUrl);
      state.viewer = { mode: "orig", baseBlob: null, origUrl: null, converting: false, convertError: null };
      state.annot = { busy: false, msg: "" };
      state.fixes = {};
      state.files.single = null;
      state.selected = null;
      state.serror = null;
      state.done = false;
      state.stageDetail = {};
      state.stageIndex = -1;
      // 고른 체크리스트와 그 판정·이유도 앞 문서의 흔적이다. 독립 화면
      // (checklistrun)은 startChecklistRun/openHistory 가 매번 새로 세우지만,
      // 여기서 안 지우면 그새 자동 검토 결과 쪽으로 묵은 crun이 남는다.
      state.crun = { checklist: null, results: {}, saving: false, error: null, from: "checklists", documentName: "" };
      state.runChecklistId = "";
      // 뷰어 캐시도 비운다. 안 그러면 다음 문서가 와도 "같은 blob"으로 보고 넘겨
      // 이전 PDF가 그대로 남는다.
      viewerFor = null;
      clearTimers();
      // 비교 결과에서 눌렀으면 비교 설정으로 돌아가야 한다 — 단일로 튀면
      // 방금 하던 일과 상관없는 화면이 뜬다.
      if (which === "compare") {
        state.files.compareA = null; state.files.compareB = null;
        state.cerror = null; state.cdone = false;
        state.crtmCursor = null; state.crtmOnlyTodo = false;
        state.crtmOosOpen = false;
        state.cstageIndex = -1;
        state.mode = "compare"; state.cstep = "setup";
      } else if (which === "evaluate") {
        // 체크리스트 검토 결과에서 "새 문서 검토" — 문서·체크리스트·시트 목록·초안을
        // 다 비우고 업로드로. 남기면 다음 문서에 지난 시트 선택이 눌어붙는다.
        state.files.evalDoc = null; state.files.evalSheet = null;
        state.evalv = { sheets: null, sheetIndex: 0, documentKind: "", error: null, busy: false,
                        stage: {}, detail: {}, startedAt: 0, payload: null, written: [],
                        historyId: "", historyAt: "" };
        state.mode = "evaluate"; state.estep = "setup";
      } else {
        state.mode = "single"; state.screen = "upload";
        if (!state.clib.list.length) actions.loadChecklists();
      }
      render();
    },

    // ── 케이스 검토 ────────────────────────────────────────────────────────
    // 고른 값은 전부 state.kase 에 있다. DOM 에 들고 있으면 render() 한 번에
    // 날아간다 — 회원가입 폼이 그렇게 아팠고(selToggle 주석), 여기는 파일 10개에
    // 드롭다운이 붙어 훨씬 크게 아프다.
    pickCaseFiles: function () { openCasePicker(false); },
    pickCaseFolder: function () { openCasePicker(true); },
    clearCaseFiles: function () {
      state.kase.files = []; 
      state.kase.recog = null; 
      state.kase.error = null;
      state.kase.result = null;
      state.kase.payload = null;
      state.kase.checked = {};
      state.kase.manualInputs = {};
      state.kase.confirmedAt = "";
      state.kase.stage = 0;
      state.kase.step = "upload";
      render();
    },
    addCaseFiles: function (files) {
      var seen = {};
      state.kase.files.forEach(function (f) { seen[f.name] = true; });
      files.forEach(function (f) { if (!seen[f.name]) { state.kase.files.push(f); seen[f.name] = true; } });
      state.kase.recog = null; state.kase.error = null;
      render();
    },
    classifyCase: function () {
      var k = state.kase;
      // 버튼은 파일이 있어야 뜨지만(뷰), 다른 경로로 와도 조용히 죽지 않는다.
      if (!k.files.length) { toast("검토할 폴더나 파일을 먼저 올려주세요.", "err"); return; }
      if (!caseTeam()) { k.error = _NO_TEAM; render(); return; }
      var fd = new FormData();
      fd.append("names", JSON.stringify(k.files.map(function (f) { return f.name; })));
      fd.append("team", caseTeam());
      k.error = null;
      fetch("api/classify-case", { method: "POST", body: fd })
        .then(function (res) {
          if (!res.ok) return res.json().catch(function () { return {}; })
            .then(function (b) { throw new Error(b.detail || ("서버 오류 (HTTP " + res.status + ")")); });
          return res.json();
        })
        .then(function (r) { k.recog = r; k.assign = {}; k.exclude = {}; k.step = "recognize"; render(); })
        .catch(function (err) { k.error = errMessage(err); render(); });
    },
    assignOutput: function (name, value) { state.kase.assign[name] = value || ""; render(); },
    toggleExclude: function (name) {
      state.kase.exclude[name] = !state.kase.exclude[name];
      render();
    },
    backToCaseUpload: function () { state.kase.step = "upload"; render(); },

    // 지적 → 그 문서를 뷰어로. 서버는 검사 뒤 임시본을 지우지만 **브라우저가
    // 원본을 들고 있다**(state.kase.files) — 기존 뷰어도 그때그때 다시 올리는
    // 구조라 같은 경로를 그대로 쓴다.
    openCaseDoc: function (arg) {
      var parts = String(arg || "").split("|");
      var key = parts[0], only = parts[1] || "";
      var p = state.kase.payload;
      if (!p) return;
      var out = (p.outputs || []).filter(function (o) { return o.key === key; })[0];
      if (!out) return;
      var file = state.kase.files.filter(function (f) { return f.name === out.file; })[0];
      if (!file) { state.kase.error = "원본 파일을 찾지 못했습니다: " + out.file; render(); return; }

      // 이 문서에 해당하는 근거만 남긴다. 상대 문서의 인용을 함께 넘기면 여기서는
      // 못 찾아 unlocated 만 쌓인다.
      var findings = (p.findings || []).filter(function (f) {
        // only 는 처음 이동할 지적일 뿐이다. 여기서 나머지를 버리면 특정 카드의
        // "문서에서 보기"로 열었을 때 같은 문서의 다른 하이라이트가 사라진다.
        return !f.unreviewed && (f.document || "").indexOf(key) >= 0;
      }).map(function (f) {
        // 화면(views.js caseDocView)이 버튼을 그릴 때와 **같은 규칙**으로 가른다.
        // 갈리면 버튼은 뜨는데 여기서 그 문서의 근거를 못 찾아 아무 일도 안 난다.
        var sides = window.DR.helpers.docSides(f.document);
        var i = sides.indexOf(key);
        var ev = (f.evidence || []);
        return { id: f.id, sev: f.sev, message: f.message,
                 evidence: (i >= 0 && ev[i]) ? [ev[i]] : ev };
      });

      state.kase.view = { key: key, file: file, findings: findings, focus: only };
      state.viewer = { mode: "orig", baseBlob: null, origUrl: null,
                       converting: false, convertError: null };
      state.marks = null;
      render();
    },
    closeCaseDoc: function () {
      state.kase.view = null;
      state.viewer = { mode: "orig", baseBlob: null, origUrl: null,
                       converting: false, convertError: null };
      state.marks = null;
      render();
    },
    // 기준은 리포트와 별개로 받아 온다. 한 번 받으면 들고 있는다 —
    // 탭을 오갈 때마다 다시 부르면 화면이 깜빡인다.
    loadCriteriaLayers: function (options) {
      options = options || {};
      var s = state.clayers;
      function contextKey() {
        var user = state.user || {};
        return JSON.stringify([user.email || "", user.team || "", state.checklist || ""]);
      }
      var key = contextKey();
      if (s.cacheKey !== key) {
        s.cacheKey = key; s.list = null; s.busy = false; s.selected = null;
      }
      if (s.busy || (s.list && !options.refresh)) return;
      var request = s.request = (s.request || 0) + 1;
      function current() {
        return state.clayers === s && s.request === request && contextKey() === key;
      }
      s.busy = true; s.error = "";
      var pending = fetchCriteriaLayers(state.checklist || "")
        .then(function (b) {
          if (!current()) return;
          if (!b || !Array.isArray(b.layers) || b.layers.some(function (L) { return !L || !Array.isArray(L.items); }))
            throw new Error("검토 기준 응답을 읽지 못했습니다.");
          s.list = b.layers;
        })
        .catch(function (err) { if (current()) s.error = errMessage(err); })
        .then(function () {
          if (!current()) return;
          s.busy = false;
          // 다른 화면으로 떠난 뒤 도착한 응답은 그 화면을 다시 그리지 않는다.
          if (state.mode === "checklists") repaintCriteriaLayers();
          else if (state.rev && state.rev.criteriaOpen) render();
        });
      if (!options.deferRender && !repaintCriteriaLayers()) render();
      return pending;
    },
    // 항목 한 줄 펴기. 접힌 줄은 제목 한 줄이고, 기준 본문은 펴야 나온다.
    // 본문이 없는 줄은 아예 안 눌리므로 여기 오지 않는다(views.js).
    toggleCriteriaItem: function (key) {
      var o = state.clayers.openItem;
      o[key] = !o[key];
      if (!repaintCriteriaLayers()) render();
    },
    toggleCriteriaLayer: function (id) {
      var open = state.clayers.open;
      open[id] = !open[id];
      if (!repaintCriteriaLayers()) render();
    },
    // 확인 방식 단일 선택("" = 전체).
    setCriteriaHow: function (how) {
      var s = state.clayers;
      s.how = how || "";
      if (!repaintCriteriaLayers()) render();
    },
    setCriteriaScope: function (scope) {
      state.clayers.scope = scope || "";
      if (!repaintCriteriaLayers()) render();
    },
    selectCriterion: function (key) {
      state.clayers.selected = key;
      if (!repaintCriteriaLayers()) render();
      var inspector = document.getElementById("criteriaInspector");
      if (inspector) inspector.scrollTop = 0;
      Array.prototype.forEach.call(document.querySelectorAll('button[data-act="selectCriterion"]'), function (button) {
        if (button.getAttribute("data-arg") === key) button.focus({ preventScroll: true });
      });
      if (window.matchMedia("(max-width: 700px)").matches) {
        var title = document.getElementById("criterion-detail-title");
        if (title) { title.focus(); title.scrollIntoView({ block: "nearest" }); }
      }
    },
    closeCriterion: function () {
      var key = state.clayers.selected;
      state.clayers.selected = null;
      if (!repaintCriteriaLayers()) render();
      var buttons = document.querySelectorAll('button[data-act="selectCriterion"]');
      Array.prototype.forEach.call(buttons, function (button) {
        if (button.getAttribute("data-arg") === key) button.focus();
      });
    },
    resetCriteriaCatalog: function () {
      state.clayers.q = ""; state.clayers.how = ""; state.clayers.scope = "";
      var input = document.querySelector("[data-criteria-q]");
      if (input) input.value = "";
      if (!repaintCriteriaLayers()) render();
      if (input) input.focus();
    },
    retryCriteriaCatalog: function () {
      actions.loadCriteriaLayers({ refresh: true });
    },
    askDeleteChecklist: function (id) {
      var layer = (state.clayers.list || []).filter(function (L) { return L.id === id && L.editable; })[0];
      if (!layer) return;
      state.confirmChecklist = { id: id, name: layer.name, count: layer.items.length };
      render();
    },
    openReviewCriteria: function () {
      state.rev.criteriaOpen = true;
      if (!state.clayers.list && !state.clayers.busy) actions.loadCriteriaLayers();
      else render();
    },
    closeReviewCriteria: function () {
      state.rev.criteriaOpen = false;
      render();
    },
    loadCriteria: function () {
      var k = state.kase;
      // 이미 있으면(또는 부르는 중이면) 다시 안 부른다 — 그래도 **그리기는 한다.**
      // 탭 전환(setCaseTab)과 대조표의 항목 이름(openCriteria)이 여기로 오는데,
      // render 없이 조기 반환하면 두 번째 클릭부터 탭이 죽은 것처럼 보였다.
      if (k.criteria || k.criteriaLoading) { render(); return; }
      if (!caseTeam()) { k.criteriaError = _NO_TEAM; render(); return; }
      k.criteriaLoading = true;
      k.criteriaError = "";
      fetchCriteria(caseTeam())
        .then(function (c) { k.criteria = c; })
        .catch(function (err) { k.criteriaError = errMessage(err); })
        .then(function () {
          k.criteriaLoading = false;
          render();
          if (k.criteriaFocus) focusCaseNode('[data-criteria-focused="true"]');
        });
      render();
    },
    // 리포트의 "미검토"에서 그 기준으로 건너뛴다. "못 봤다"만 알려주고 왜인지
    // 못 짚으면 검토자가 할 수 있는 게 없다.
    openCriteria: function (id) {
      state.kase.tab = "criteria";
      // 쌍 기준의 finding id 는 `1-7/대표자` 모양이지만 기준 id 는 `1-7`이다.
      state.kase.criteriaFocus = String(id || "").split("/")[0];
      actions.loadCriteria();
      focusCaseNode('[data-criteria-focused="true"]');
    },
    openMatrixDetail: function (id) {
      var k = state.kase;
      var same = k.tab === "matrix" && k.matrixFocus === id;
      k.tab = "matrix";
      k.matrixFocus = same ? "" : (id || "");
      render();
      if (k.matrixFocus) focusCaseNode('[data-matrix-row="' + k.matrixFocus + '"]');
    },
    toggleManual: function (id) {
      var k = state.kase;
      if (k.confirming) return;
      k.checked[id] = !k.checked[id];
      invalidateManualResult(k, id);
      render();
    },
    setManualInput: function (id, value) {
      var k = state.kase;
      if (k.confirming) return;
      k.manualInputs = k.manualInputs || {};
      k.manualInputs[id] = value;
      invalidateManualResult(k, id);
      // 타이핑 중에는 입력을 다시 만들지 않는다. 대신 현재 행의 옛 판정만 바로
      // 걷고, blur/change 뒤 전체 render가 합계까지 새 값으로 맞춘다.
      var input = Array.prototype.filter.call(
        document.querySelectorAll("[data-manual-input]"),
        function (node) { return node.getAttribute("data-manual-input") === id; })[0];
      var row = input && input.closest("[data-manual-row]");
      if (row) Array.prototype.forEach.call(
        row.querySelectorAll("[data-manual-result]"), function (node) { node.remove(); });
      var saved = document.getElementById("case-confirmed-at");
      if (saved) saved.remove();
    },
    // 확인 표시를 이력에 남긴다. 결과는 이미 저장돼 있는데 확인 표시만 브라우저에
    // 있으면, 나중에 그 기록을 열었을 때 "이 건은 발급했나"를 알 수 없다.
    confirmCase: function () {
      var k = state.kase, p = k.payload;
      if (!p || !p.history || !p.history.id) {
        k.error = "이력에 저장되지 않아 확정할 수 없습니다."; render(); return;
      }
      if (k.confirming) return;
      var ids = Object.keys(k.checked).filter(function (i) { return k.checked[i]; });
      k.error = "";
      k.confirming = true; render();
      fetch("api/history/" + encodeURIComponent(p.history.id) + "/confirm",
            { method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ checked: ids, inputs: k.manualInputs || {} }) })
        .then(function (res) {
          if (!res.ok) return res.json().catch(function () { return {}; })
            .then(function (b) { throw new Error(b.detail || ("HTTP " + res.status)); });
          return res.json();
        })
        .then(function (body) {
          // 저장된 payload에는 자기 이력 id가 들어 있지 않다(_remember가 저장 뒤
          // 응답에만 붙인다). 현재 id를 다시 붙여야 값을 고쳐 재확정할 수 있다.
          body.history = p.history;
          k.payload = body;
          k.confirmedAt = body.confirmedAt || "";
          k.manualInputs = body.manualInputs || {};
          k.checked = {};
          (body.manualChecked || []).forEach(function (id) { k.checked[id] = true; });
          k.error = "";
          loadHistory();
        })
        .catch(function (err) { k.error = errMessage(err); })
        .then(function () { k.confirming = false; render(); });
    },
    // 반영 확인의 판정을 이력에 남긴다. 예전에는 드롭다운에 아무것도 안 붙어
    // 있어서, 검토자가 지적을 하나씩 판정해도 새로고침 한 번에 사라졌다.
    //
    // 기계 판정(lineage.items[].status)은 안 건드린다 — 서버가 lineageVerdicts
    // 로 따로 담는다. 그래야 판정 근거가 남고, 다시 검토해 기계 판정이 새로
    // 계산될 때 사람이 한 일까지 지워지지 않는다.
    setLineageVerdict: function (idx, value) {
      var D = window.DOCREVIEW;
      if (!D || idx == null) return;
      D.lineageVerdicts = D.lineageVerdicts || {};
      // **순번이 아니라 지적의 신원**으로 저장한다(서버가 lineage.items[].key 로 준다).
      // 순번은 그 검토 안에서만 뜻이 있어, 다음 검토에서 3번째는 다른 지적이다 —
      // "해당없음"이라 판정한 것을 이어주려면 무엇에 대한 판정인지가 남아야 한다.
      var item = ((D.lineage && D.lineage.items) || [])[Number(idx)] || {};
      var key = item.key || String(idx);
      D.lineageVerdicts[key] = value;
      // 검토자가 직접 고른 순간 `지난 판정` 이 아니게 된다. 태그를 안 떼면 이번에
      // 자기가 바꿔놓고도 지난번 것을 물려받은 줄 안다 — 실측으로 그렇게 남아 있었다
      // (이어받은 것 `해당없음`, 저장된 값 `미반영`, 태그는 그대로).
      if (D.lineageCarried) delete D.lineageCarried[key];
      // **여기서 render() 를 부르면 안 된다.** 통째로 그리면 pdf-mount 가 새로
      // 만들어져 뷰어가 PDF 를 다시 연다(syncViewer) — 판정 하나 바꿀 때마다
      // 문서가 깜빡이고 형광펜이 날아간다. select 가 repaintCard 를 쓰는 이유와
      // 같다. 고른 값은 셀렉트가 이미 제 label 을 바꿔 두었고, 남은 것은 셈
      // 두 군데와 형광펜뿐이다.
      repaintLineagePanel();          // `지난 판정` 태그가 떨어진다
      repaintLineageCounts();
      paintMarks();                   // 미반영만 칠하므로 문서도 따라 바뀐다
      // 지적 카드의 `해당없음` 뱃지도 이 판정에서 온다(renderVals 의
      // na: !!naIds[f.id] ← lineageNaIds 가 status === "해당없음" 인 matchId 를
      // 모은다). 여기를 빼먹어서 판정을 바꿔도 뱃지는 다음 전체 렌더까지
      // 옛 상태로 남아 있었다 — 검토자가 반영 확인에서 정리한 것을 지적
      // 목록은 아직 모르는 것처럼 보였다.
      repaintCard(item.match_id);
      if (!D.historyId) {
        // serror 배너는 업로드 화면에만 있어서 결과 화면에서는 안 보였다 —
        // 토스트는 어디서든 뜬다.
        toast("이력에 저장되지 않아 판정을 남길 수 없습니다.", "err");
        return;
      }
      var fd = new FormData();
      fd.append("verdicts", JSON.stringify(D.lineageVerdicts));
      fetch("api/history/" + encodeURIComponent(D.historyId) + "/lineage",
            { method: "POST", body: fd })
        .then(function (res) {
          if (!res.ok) return res.json().catch(function () { return {}; })
            .then(function (b) { throw new Error(b.detail || ("HTTP " + res.status)); });
        })
        .catch(function (err) {
          // 저장에 실패했는데 화면만 바뀌면 검토자는 남았다고 믿는다.
          // serror 배너는 결과 화면에 자리가 없어 토스트로 말한다.
          toast("판정을 저장하지 못했습니다: " + errMessage(err), "err");
        });
    },

    // 탭을 옮기면 문서에 칠하는 것도 바뀐다(markItems 참고).
    setReviewTab: function (t) {
      if (["findings", "status", "lineage", "criteria"].indexOf(t) < 0) return;
      state.reviewTab = t;
      state.selected = null;
      state.fixes = {};
      window.DR.pdfview.highlight(null);
      if (!repaintSingleIssues()) render();
      paintMarks();
      var list = document.querySelector('#issuesPanel [data-scroll="issues"]');
      if (list) list.scrollTop = 0;
      var tab = document.getElementById("tab-" + t);
      if (tab) tab.focus({ preventScroll: true });
    },

    setCaseTab: function (t) {
      state.kase.tab = t;
      // 기준 탭은 payload 와 별개로 서버에서 받아온다. 여기서 안 부르면 탭을
      // 직접 누른 검토자는 빈 화면만 본다 — openCriteria 로 들어올 때만 됐었다.
      if (t === "criteria") { actions.loadCriteria(); return; }
      render();
    },
    pickCaseOutput: function (key) { state.kase.selOutput = key; render(); },
    caseCsv: function () {
      var p = state.kase.payload;
      if (!p) return;
      download((p.caseId || "case") + "_검토결과.csv",
                 "\ufeff" + _views.caseCsvText(p), "text/csv;charset=utf-8");
    },
    runCase: function () {
      var k = state.kase;
      // 사람이 뺀 파일은 올리지 않는다. 지정한 것은 그대로 올린다 — 서버가 다시
      // 판별하지만, 지정은 아직 서버에 전달하지 않는다(다음 단계).
      var send = k.files.filter(function (f) { return !k.exclude[f.name]; });
      if (!send.length) { k.error = "올릴 파일이 없습니다."; render(); return; }
      state.fromHistory = false;    // 새로 시작한 폴더 검토 — "돌아갈" 목록이 없다
      state.navRecordId = null;
      k.step = "progress"; k.stage = {}; k.error = null;
      k.startedAt = Date.now(); k.payload = null;
      render();
      streamCase(send, caseTeam());
      tickCaseElapsed();
    },
    setMode: function (m) {
      // 옆 메뉴의 "비교 검토"·"단일 검토"는 그 검토의 **시작**이다. 결과를 보고 있을
      // 때 눌렀는데 같은 결과가 그대로면 갈 데가 없다(2026-09-08 지적: 결국 업로드
      // 탭을 직접 눌렀다). 진행 중인 검토는 건드리지 않는다.
      if (m === "compare" && state.mode === "compare" && state.cstep === "results") actions.newReview("compare");
      if (m === "single" && state.mode === "single" && state.screen === "results") actions.newReview("single");
      if (m === "evaluate" && state.mode === "evaluate" && state.estep === "results") {
        state.estep = "setup"; state.evalv.payload = null; state.evalv.error = null;
      }
      state.mode = m;
      // 지난 화면의 한 번짜리 안내·오류는 화면을 옮기면 끝난 얘기다.
      state.authNotice = null;
      state.herror = null;
      // 홈은 "무엇으로 재나"를 진짜 기준으로 말한다 — 들어올 때 읽는다.
      if (m === "home") loadHomeCriteria();
      if (m === "history") loadHistoryPage();
      if (m === "assistant") loadChatSessions();
      // 화면을 옮기면 열려 있던 팝오버는 닫는다. 바깥 클릭으로 닫는 규칙이
      // 못 잡는 자리가 하나 있다 — 팝오버 **안**의 로그아웃이다(메뉴 안이라
      // 바깥 클릭에서 제외된다). 그대로 두면 다시 로그인했을 때 프로필 메뉴가
      // 열린 채로 떠 있었다.
      state.profileMenuOpen = false; state.searchOpen = false; state.notiOpen = false;
      // 체크리스트 화면에 들어올 때마다 목록을 새로 읽는다 — 다른 화면에서
      // 등록/삭제하고 돌아와도 묵은 목록이 뜨지 않게.
      if (m === "checklists") {
        // 옆 네비게이션으로 직접 들어오면 관리 모드다 — 검토에서 온 "고르기"
        // 모드를 끈다. 검토 링크는 setMode 를 안 거치는 goPickChecklist 로 온다.
        state.checklistPickReturn = false;
        // 묵은 상세·오류가 다시 뜬다. 화면에 돌아올 때마다 깨끗이 지운다.
        state.clib.detail = null;
        state.clib.error = null;
        actions.loadChecklists({ background: true });
        // 같은 조건의 목록은 즉시 표시하고 갱신한다. 진입 렌더는 아래 한 번뿐이다.
        actions.loadCriteriaLayers({ refresh: true, deferRender: true });
      }
      // 설정에 들어오면 계정 목록을 읽는다 — 관리자에게만 보이는 구역이지만
      // 호출은 서버가 403 으로 끊으므로 role 을 화면에서 다시 재지 않는다.
      // 실패하면 그 구역이 오류를 말한다(관리자가 아니면 구역 자체가 없다).
      if (m === "settings") state.settingsTab = "app";
      // 단일 검토 셋업의 "체크리스트로 평가" 카드도 등록 목록이 있어야 고를 수
      // 있다. 이미 읽었으면(다른 화면에서) 다시 부르지 않는다.
      if (m === "single" && !state.clib.list.length) actions.loadChecklists();
      render();
    },
    // 아직 안 간 단계로는 못 뛴다. 폴더 검토(goCaseStep)가 이미 그렇게 막는데
    // 단일 검토만 아무 데나 갈 수 있었다 — 업로드도 안 하고 `지적사항` 을 누르면
    // 빈 결과가, 예전에는 프로토타입 시절의 가짜 지적 11건이 떴다.
    go: function (s) {
      if (s === "results" && !state.reviewed) return;
      if (s === "progress" && !state.reviewed && state.stageIndex < 0) return;
      state.screen = s; render();
    },
    // 단일(go)·폴더(goCaseStep)와 같은 가드 — 아직 안 간 단계로는 못 뛴다.
    // 비교만 아무 데나 갈 수 있어, 돌린 적 없이 `지적사항` 을 누르면 빈/묵은
    // 결과가 떴다(2026-09-01). 진행(progress)은 지나가는 화면이라 늘 막는다.
    goCStep: function (s) {
      if (s === "results" && !state.compared) return;
      if (s === "progress") return;
      state.cstep = s; render();
    },
    // 진행 레일에서 요건 하나를 눌러 그 자리로 간다. 추적표가 표가 된 뒤로는
    // 펼칠 것이 없다 — 네 칸이 이미 다 보이므로 그 행으로 옮겨만 준다.
    // crtmOpenKey 는 남는다: 원문 뷰어 옆 판정 패널이 "어느 요건인가"를 이걸로 안다.
    goRtmRow: function (key) {
      state.crtmOpenKey = key;
      render();
      var el = document.getElementById("rtm-" + key);
      // 나머지 세 곳(focusCaseNode·업로드 드롭존·지적 선택)과 같은 이유로 직접
      // 묻는다 — JS 가 behavior 를 명시하면 CSS 의 scroll-behavior:auto 를 이긴다.
      if (el && el.scrollIntoView) {
        el.scrollIntoView({ block: "center", behavior: reduceMotion() ? "auto" : "smooth" });
      }
    },
    toggleRtmOos: function () {
      state.crtmOosOpen = !state.crtmOosOpen;
      if (!repaintCompareTrace({ keepDetail: true })) render();
    },
    // 긴 셀 하나만 편다.
    toggleRtmCell: function (key) {
      if (state.crtmCellOpen[key]) delete state.crtmCellOpen[key];
      else state.crtmCellOpen[key] = true;
      render();
    },
    // 이미 판정한 행을 다시 고친다.
    editRtmVerdict: function (key) { state.crtmEditKey = key; render(); },
    // 검토 대기열에서 한 요건을 고른다. 선택은 판정과 다르므로 저장하지 않는다.
    selectRtmRow: function (key) {
      if (!key) return;
      state.crtmCursor = key;
      state.crtmEditKey = null;
      if (!repaintCompareTrace()) render();
    },
    // 전체 | 미판정 알약. 이미 켜진 쪽을 눌러도 뒤집히지 않는다.
    setRtmOnlyTodo: function (arg) {
      var on = arg === "todo";
      if (state.crtmOnlyTodo === on) return;
      actions.toggleRtmOnlyTodo();
    },
    toggleRtmOnlyTodo: function () {
      state.crtmOnlyTodo = !state.crtmOnlyTodo;
      state.crtmCursor = null;
      if (!repaintCompareTrace()) render();
    },
    // 화면에는 오래전부터 "직접 작성" 카드가 있었지만 핸들러가 없어 눌러도
    // 아무 일도 안 났다. 그 자리를 과제 층 등록으로 채운다.
    writeChecklist: function () {
      state.cdraft = { name: "", idExample: "", idPattern: "", scope: "",
                       items: [{ text: "", mode: "사람" }], busy: false, error: null };
      render();
    },
    // 담당 범위 후보를 누르면 칸을 채운다. 적는 대신 고르게 하는 게 요점이라
    // 여기서는 render() 를 부른다 — 입력 중이 아니라 클릭이므로 커서가 없다.
    pickScope: function (arg) { state.cscope = arg || ""; render(); },
    cancelDraft: function () { state.cdraft = null; render(); },
    draftAdd: function () {
      state.cdraft.items.push({ text: "", mode: "사람" });
      render();
    },
    draftDel: function (i) {
      state.cdraft.items.splice(Number(i), 1);
      if (!state.cdraft.items.length) state.cdraft.items.push({ text: "", mode: "사람" });
      render();
    },
    draftSetMode: function (arg) {
      var cut = String(arg).indexOf("|");
      var i = Number(String(arg).slice(0, cut)), mode = String(arg).slice(cut + 1);
      state.cdraft.items[i].mode = mode;
      render();
    },
    saveDraft: function () {
      var d = state.cdraft;
      if (!d || d.busy) return;
      var rows = d.items.filter(function (it) { return (it.text || "").trim(); })
        .map(function (it) { return { text: it.text.trim(), mode: it.mode }; });
      // 과제 설정값은 항목 하나로 싣는다 — 기준이 매개변수를 지고, 코드가 값을
      // 따로 보관하지 않는다는 원칙 그대로다(기준은 항상 주입받는다).
      var params = {};
      // 검토자는 예시를 적고, 형식은 코드가 만든다. 정규식을 직접 쓴 경우에만
      // 그쪽이 이긴다 — 예시 하나로 못 담는 체계가 있다(종류 코드 길이가
      // 문서마다 다른 경우 등).
      var made = _H.idPatternFrom(d.idExample);
      var pat = (d.idPattern || "").trim() || (made ? made.pattern : "");
      if (pat) params.id_pattern = pat;
      // 예시도 함께 저장한다. 화면이 "이 형식은 무엇인가"를 사람에게 말할 때
      // 정규식이 아니라 이걸 보여 준다(서버가 이미 받는 값이다).
      if ((d.idExample || "").trim()) params.id_example = d.idExample.trim();
      if ((d.scope || "").trim()) params.scope_pattern = d.scope.trim();
      if (Object.keys(params).length) {
        rows.push({ text: "이 과제의 요건 ID 형식·담당 범위", mode: "사람",
                    note: "검토 요청마다 다시 입력하지 않도록 여기 적어 둔 값입니다.",
                    params: params });
      }
      if (!rows.length) {
        d.error = "항목을 하나 이상 적거나 과제 설정값을 채워야 합니다.";
        render(); return;
      }
      d.busy = true; d.error = null; render();
      var fd = new FormData();
      fd.append("name", d.name || "");
      fd.append("items", JSON.stringify(rows));
      postForm("api/criteria/manual", fd)
        .then(function () {
          state.cdraft = null;
          actions.loadChecklists();
          // 기준 층 화면도 다시 읽는다 — 방금 만든 층이 거기 떠야 한다.
          state.clayers = { list: null, busy: false, error: null, open: {}, openItem: {}, how: "", q: "" };
          actions.loadCriteriaLayers();
          render();
        })
        .catch(function (err) {
          state.cdraft.busy = false;
          state.cdraft.error = errMessage(err);
          render();
        });
    },
    // 판정은 검토자의 결론 — 즉시 이력에 저장한다. 브라우저에만 있으면
    // 새로고침 한 번에 사라진다(lineage 판정과 같은 이유). 같은 버튼을 다시
    // 누르면 판정 취소.
    setCmpTab: function (arg) { state.cmpTab = arg === "criteria" ? "criteria" : "rtm"; render(); },
    setRtmVerdict: function (arg) {
      // 누르면 그 행은 끝난 것이다 — 편집 모드를 닫아 결론만 남긴다.
      state.crtmEditKey = null;
      var i = String(arg || "").indexOf("|");
      var vkey = String(arg).slice(0, i), verdict = String(arg).slice(i + 1);
      var cur = state.cverdicts[vkey] || { verdict: "", note: "" };
      var next = { verdict: cur.verdict === verdict ? "" : verdict, note: cur.note || "" };
      if (!next.verdict && !next.note) delete state.cverdicts[vkey];
      else state.cverdicts[vkey] = next;
      if (!repaintCompareTrace({ keepDetail: true, chrome: true })) render();
      // 방금 판정한 행을 잠깐 밝힌다 — 버튼만 채워지고 끝이면 목록의 알약과 위 띠의 숫자가
      // 바뀐 것을 못 알아챈다(2026-09-16). 다시 그린 뒤라 새 요소에 건다.
      var row = document.querySelector('.trace-queue-item[data-vkey="' + CSS.escape(vkey) + '"]');
      if (row && next.verdict) { row.classList.remove("is-judged"); void row.offsetWidth; row.classList.add("is-judged"); }
      saveRtmVerdict(vkey, next);
    },
    setRtmNote: function (vkey, note) {
      var cur = state.cverdicts[vkey] || { verdict: "", note: "" };
      var next = { verdict: cur.verdict || "", note: note };
      if (!next.verdict && !next.note) delete state.cverdicts[vkey];
      else state.cverdicts[vkey] = next;
      saveRtmVerdict(vkey, next);
    },
    // 추적표 행 → 그 문서를 뷰어로. 폴더 검토(openCaseDoc)와 같은 원리 —
    // 서버는 검사 뒤 임시본을 지우지만 브라우저가 원본 File 을 들고 있다.
    // ID만 보내면 목차·다른 표의 같은 ID가 먼저 잡힐 수 있다. 실제 상·하위 문장을
    // 첫 근거로 보내고 ID는 문장 위치를 못 찾았을 때의 보조 근거로만 쓴다.
    openCompareDoc: function (arg) {
      var parts = String(arg || "").split("|");
      var side = parts[0] === "B" ? "B" : "A", focus = parts[1] || "";
      // 세 번째 칸은 쪽수다. 후보도 별도 지적 id를 만들어 실제 후보 문장에
      // 형광펜을 붙인다. 쪽수는 텍스트 위치를 못 찾았을 때만 쓰는 안전망이다.
      var page = parseInt(parts[2] || "", 10) || 0;
      // 네 번째 칸은 추적표의 행 키다. 뷰어 옆 판정 패널이 "지금 어느 요건을
      // 보고 있나"를 이걸로 안다 — 없으면 그 패널이 안 뜨고, 문서만 열린다.
      if (parts[3]) state.crtmOpenKey = parts[3];
      // 이미 같은 문서를 보고 있으면 PDF를 다시 열지 않고 기존 좌표에서 곧장
      // 이동한다. 예전에는 같은 focus면 쪽만 옮겨 형광펜을 켜지 않았고, 다른
      // focus면 뷰어가 같은 blob이라 좌표 재로딩도 안 되어 아무 데도 안 갔다.
      if (state.cview && state.cview.side === side &&
          window.DR.pdfview && window.DR.pdfview.isOpen()) {
        var changedFocus = state.cview.focus !== focus;
        state.cview.focus = focus;
        state.cview.page = page;
        if (changedFocus) render();
        if (state.popup) paintMarks();          // 원문 창은 새 행 것만 칠한다
        var located = ((state.marks || {}).items || []).filter(function (it) {
          return it.id === focus;
        })[0];
        if (located && located.marks && located.marks.length) {
          window.DR.pdfview.highlight(focus);
          window.DR.pdfview.goTo(located.marks[0].page, located.marks[0].rect);
        } else {
          toast("원문 위치를 확정하지 못했습니다. 문서에서 해당 내용을 확인해 주세요.", "err");
        }
        return;
      }
      var slot = side === "A" ? state.files.compareA : state.files.compareB;
      var hid = ((window.DOCREVIEW.compare || {}).history || {}).id;
      if (!slot || !slot.file) {
        // 브라우저가 원본을 안 들고 있으면(새로고침·기록에서 열기) 서버가 보관한
        // 것을 가져온다. 비교도 이제 원본을 남긴다 — 예전에는 이 자리에서 그냥
        // 실패했고, 검토자는 원문 보기가 사라진 줄 알았다.
        if (!hid) {
          state.cerror = "원본이 없어 원문을 열 수 없습니다 — 이 검토는 이력에 저장되지 않았습니다.";
          render(); return;
        }
        var names = window.DOCREVIEW.compare || {};
        var nm = ((side === "A" ? names.docA : names.docB) || {}).name || "document";
        fetch("api/history/" + encodeURIComponent(hid) + "/original?slot=" + side)
          .then(function (res) {
            if (!res.ok) throw new Error("보관된 원본이 없습니다(개수·용량 제한으로 밀렸을 수 있습니다).");
            return res.blob();
          })
          .then(function (blob) {
            var box = side === "A" ? "compareA" : "compareB";
            state.files[box] = { name: nm, size: blob.size,
                                 file: new File([blob], nm) };
            actions.openCompareDoc(arg);       // 이제 파일이 있으니 같은 길로 연다
          })
          .catch(function (err) {
            state.cerror = "원문을 열지 못했습니다: " + errMessage(err);
            render();
          });
        return;
      }
      var SEV = { missing: "major", orphan: "major", linked: "info",
                  rolled_up: "info", out_of_scope: "info" };
      var LBL = { linked: "반영됨", missing: "누락", out_of_scope: "범위 밖",
                  rolled_up: "부모 수준 검증", orphan: "근거 없음" };
      var findings = [];
      ((window.DOCREVIEW.compare || {}).rtm || []).forEach(function (r, i) {
        var ids = side === "A" ? (r.upper_id ? [r.upper_id] : []) : (r.lower_ids || []);
        var line = ((r.text || "").split("\n")[0] || "")
          .replace(/\[\s*ID\s*:[^\]]*\]/gi, "");
        var title = line.split("|").map(function (x) { return x.trim(); })
          .filter(function (x) {
            return x && ids.indexOf(x) < 0 && x !== "ID" && x !== "우선순위" && x !== "-";
          }).join(" ").replace(/RQ-[A-Z-]+-\d{2}-\d{3}/g, "").trim().slice(0, 70);
        var quote = side === "A" ? (r.text || "") : (r.child_text || (r.status === "orphan" ? r.text : "") || "");
        // 서술이 표 여러 줄이면 통째로는 PDF 에서 못 찾는다 — 제일 긴 칸(요건 제목·설명)
        // 한 줄만 인용해 거기에 형광펜을 얹는다. ID 는 아래서 따로 인용한다.
        if (quote.indexOf("|") >= 0 || quote.indexOf("\n") >= 0) {
          var bestCell = "";
          quote.split("\n").forEach(function (ln) {
            ln.split("|").forEach(function (c) {
              c = c.trim().replace(/\[\s*ID\s*:[^\]]*\]/gi, "").trim();
              if (c.length >= 8 && /[가-힣A-Za-z]/.test(c) && c.length > bestCell.length) bestCell = c;
            });
          });
          if (bestCell) quote = bestCell.slice(0, 160);
        }
        var evidence = [];
        if (quote) {
          var primary = { quote: quote };
          if (side === "A") {
            if (r.section) primary.section = r.section;
            if (r.page) primary.page = r.page;
          } else {
            if (r.child_section || (r.status === "orphan" && r.section)) {
              primary.section = r.child_section || r.section;
            }
            if (r.child_page || (r.status === "orphan" && r.page)) {
              primary.page = r.child_page || r.page;
            }
          }
          evidence.push(primary);
        }
        ids.forEach(function (x) {
          if (x && x !== quote) evidence.push({ quote: x });
        });
        if (evidence.length) {
          findings.push({ id: "r" + i, sev: SEV[r.status] || "info",
                          message: (LBL[r.status] || r.status) +
                            (ids[0] ? " · " + ids[0] : "") + (title ? " — " + title : ""),
                          evidence: evidence });
        }
        // ID가 없는 유사 위치도 눌렀을 때 정확한 문장을 짚을 수 있어야 한다.
        // 행 focus와 분리된 id를 써야 같은 문서를 연 채 후보끼리 이동할 수 있다.
        if (side === "B") (r.probes || []).forEach(function (h, pi) {
          if (!h.text) return;
          // 절 전체를 인용하면 PDF 에서 못 찾아 형광펜 없이 쪽만 간다. **겹친 말이
          // 가장 많이 든 칸** 하나를 인용해 거기에 형광펜을 얹는다 — 검토자가 보고
          // 싶은 자리가 그 말들이 있는 자리다.
          // 겹친 말은 요건 문장의 원형("모델이")이라 설계서 칸엔 조사가 다를 수 있다 —
          // 꼬리 한 글자를 뗀 앞부분으로도 맞춘다(missing_probe._stem 과 같은 생각).
          var shared = (h.shared || []).map(function (w) {
            return w.length >= 4 && /^[가-힣]+$/.test(w) ? w.slice(0, -1) : w;
          });
          var best = "", bestN = -1;
          String(h.text).split("\n").forEach(function (ln) {
            ln.split("|").forEach(function (c) {
              c = c.trim();
              if (c.length < 8 || !/[가-힣A-Za-z]/.test(c)) return;
              // 파서가 남긴 그림 자리표시(<img …>)·링크는 PDF 글자가 아니다.
              if (/<[a-z]|https?:\/\//i.test(c)) return;
              var n = shared.filter(function (w) { return c.indexOf(w) >= 0; }).length;
              if (n > bestN || (n === bestN && c.length > best.length)) { best = c; bestN = n; }
            });
          });
          var ev = { quote: (best || h.text).slice(0, 160) };
          // 그 절의 쪽 범위 안에서만 찾는다 — 표마다 되풀이되는 칸이라 문서 전체에서
          // 찾으면 카드가 말한 쪽과 다른 쪽으로 간다(annotate_pdf._candidate_pages).
          // 옛 이력엔 page_end 가 없다 — 그때는 시작 쪽부터 몇 쪽만 본다.
          if (h.page) { ev.page = h.page; ev.strict_page = true; ev.page_end = h.page_end || (h.page + 4); }
          if (h.anchor_section) ev.section = h.anchor_section;
          findings.push({ id: "pr" + i + "-" + pi, sev: "info",
                          message: "하위 문서의 유사 위치 후보", evidence: [ev] });
        });
      });
      state.cview = { side: side, file: slot.file, name: slot.name, findings: findings,
                      focus: focus, page: page };
      state.viewer = { mode: "orig", baseBlob: null, origUrl: null,
                       converting: false, convertError: null };
      state.marks = null;
      render();
    },
    cancelCompare: function () {
      cancelJob("compare");  // 서버에도 멈추라고 한다
      if (state.compareAbort) { state.compareAbort.abort(); state.compareAbort = null; }
      stopThen("compare", function () {
        clearTimers();
        state.cdone = false;
        state.cstageIndex = -1;
        state.cerror = null;
        state.cstep = "setup";
        render();
      });
    },
    closeCompareDoc: function () {
      // 원문 창에서는 "돌아가기"가 창을 닫는 것이다 — 결과 화면은 본 창에 있다.
      if (state.popup) { window.close(); return; }
      state.cview = null;
      state.viewer = { mode: "orig", baseBlob: null, origUrl: null,
                       converting: false, convertError: null };
      state.marks = null;
      render();
    },
    // 추적표를 보고서 부록 B 재료(CSV)로 내린다. 판정어·비고는 검토자 몫이라
    // 비워 둔다 — 기계 관찰(반영됨/누락/근거없음)만 싣는다.
    // 엑셀은 서버가 만든다 — 바닐라 JS 로는 xlsx 를 못 만들고, 사람의 판정이
    // 이력에 저장돼 있어 거기서 꺼내야 파일과 이력이 안 갈린다. 이력에 없으면
    // 판정도 못 남기는 상태라, 그 사실을 그대로 말한다.
    // 단일 검토 엑셀. 서버가 이력에서 만든다(review_xlsx) — 이력에 없으면 못 만들고
    // 메뉴가 이미 그렇게 말한다(views.js exportMenu).
    exportXlsx: function () {
      closeExportMenu();
      var D = window.DOCREVIEW, hid = D.historyId;
      if (!hid) { toast("이 검토는 이력에 저장되지 않아 엑셀을 만들 수 없습니다.", "err"); return; }
      fetch("api/history/" + encodeURIComponent(hid) + "/review.xlsx")
        .then(function (res) {
          if (!res.ok) {
            return res.json().catch(function () { return {}; })
              .then(function (b) {
                throw new Error(b.detail || (res.status === 404
                  ? "서버에 이 기능이 없습니다 — 서버를 다시 시작해 주세요." : "HTTP " + res.status));
              });
          }
          return res.blob();
        })
        .then(function (blob) {
          downloadBlob(_H.exportStem((D.doc && D.doc.name) || "document", D.historyAt) + ".검토결과.xlsx", blob);
        })
        .catch(function (err) { toast("엑셀 내보내기 실패: " + errMessage(err), "err"); });
    },
    exportRtmXlsx: function () {
      var hid = ((window.DOCREVIEW.compare || {}).history || {}).id;
      if (!hid) {
        state.cerror = "이 검토는 이력에 저장되지 않아 엑셀을 만들 수 없습니다.";
        render(); return;
      }
      // 판정을 방금 눌렀을 수 있다. 서버가 이력에서 꺼내 만들므로 **저장이 끝난
      // 뒤에** 받아야 그 값이 들어간다. 시간을 추측해 기다리면 느린 날에 빠진다.
      //
      // location.href 로 넘기지 않는다. 실패하면 앱 밖으로 나가 서버가 낸 JSON
      // 오류가 통째로 뜨고, 보고 있던 검토 화면을 잃는다(2026-09-02: 서버가 옛
      // 코드라 404 가 났는데 화면이 그 자리에서 사라졌다). 받아서 확인한 뒤
      // 내려주고, 실패는 화면 안에서 말한다.
      state.cerror = null;
      afterRtmSaved(function () {
        fetch("api/history/" + encodeURIComponent(hid) + "/rtm.xlsx")
          .then(function (res) {
            if (!res.ok) {
              return res.json().catch(function () { return {}; })
                .then(function (b) {
                  throw new Error(b.detail ||
                    (res.status === 404
                      ? "서버에 이 기능이 없습니다 — 서버를 다시 시작해 주세요."
                      : "HTTP " + res.status));
                });
            }
            return res.blob();
          })
          .then(function (blob) {
            var cmp = window.DOCREVIEW.compare || {};
            var stem = _H.exportStem((cmp.docA || {}).name || "compare", (cmp.history || {}).at);
            downloadBlob(stem + ".추적성매트릭스.xlsx", blob);
          })
          .catch(function (err) {
            state.cerror = "엑셀 내보내기 실패: " + errMessage(err);
            render();
          });
      });
    },
    // 원문을 **새 창**으로. 검토자는 대개 모니터가 둘이라 설계서를 옆에 두고
    // 이쪽에서 판정한다. 같은 쪽(상위/하위)은 창 하나뿐이고, 다른 행에서 다시
    // 누르면 새 창이 아니라 그 창이 그 자리로 간다(postMessage). 이력에 없는
    // 결과(저장 실패)는 새 창이 원본을 못 받으니 예전처럼 제자리에서 연다.
    openDocWindow: function (arg) {
      var parts = String(arg || "").split("|");
      var side = parts[0] === "B" ? "B" : "A";
      var hid = ((window.DOCREVIEW.compare || {}).history || {}).id;
      if (!hid || state.popup) { actions.openCompareDoc(arg); return; }
      var w = state.docWins[side];
      if (w && !w.closed) {
        try { w.postMessage({ type: "docsuree-focus", arg: arg }, location.origin); w.focus(); return; }
        catch (e) { /* 닫힌 창 — 아래에서 새로 연다 */ }
      }
      var url = location.pathname + "?doc=" + encodeURIComponent(hid) + "&arg=" + encodeURIComponent(arg);
      state.docWins[side] = window.open(url, "docsuree-doc-" + side, "popup=yes,width=1100,height=900");
      if (!state.docWins[side]) actions.openCompareDoc(arg);   // 팝업이 막혔으면 제자리
    },
    // 누락 요건을 검토자의 말로 다시 찾는다(4단계). 비교 때 자동으로 돈 것과
    // 같은 함수가 서버에서 돈다 — 힌트만 앞에 선다. 결과는 이력에 남는다.
    searchMissing: function (rid) {
      var hid = ((window.DOCREVIEW.compare || {}).history || {}).id;
      if (!rid || !hid || state.csearchBusy[rid]) return;
      var input = document.querySelector('[data-hint="' + CSS.escape(rid) + '"]');
      var hint = ((input && input.value) || state.chint[rid] || "").trim();
      state.chint[rid] = hint;
      state.csearchBusy[rid] = true;
      if (!repaintCompareTrace({ keepDetail: true })) render();
      var fd = new FormData();
      fd.append("requirement_id", rid);
      fd.append("hint", hint);
      fetch("api/history/" + encodeURIComponent(hid) + "/search", { method: "POST", body: fd })
        .then(function (res) {
          if (!res.ok) return res.json().catch(function () { return {}; })
            .then(function (b) { throw new Error(b.detail || ("HTTP " + res.status)); });
          return res.json();
        })
        .then(function (found) {
          var cmp = window.DOCREVIEW.compare;
          cmp.rtmSearches = cmp.rtmSearches || {};
          cmp.rtmSearches[rid] = found;
        })
        .catch(function (err) {
          var cmp = window.DOCREVIEW.compare;
          cmp.rtmSearches = cmp.rtmSearches || {};
          cmp.rtmSearches[rid] = { verdict: "확인못함", reason: errMessage(err), hint: hint, words: [], hits: {}, read: [] };
        })
        .then(function () {
          delete state.csearchBusy[rid];
          if (!repaintCompareTrace({ keepDetail: true })) render();
        });
    },
    // 산출물 세트도 같은 단계 이동. 단, 아직 도달 못 한 단계로는 못 뛴다 —
    // recog 없이 recognize 로 가면 빈 표가, payload 없이 results 로 가면 빈
    // 리포트가 나온다. 검사 중(progress)에는 이동 자체를 막는다.
    goCaseStep: function (s) {
      var k = state.kase;
      if (k.step === "progress") return;
      if (s === "recognize" && !k.recog) return;
      if (s === "results" && !k.payload) return;
      if (s === "progress") return;
      k.step = s; k.view = null; render();
    },
    // 번호 하나를 눌러 그 자리로 간다. 한 지적이 여러 곳을 물면 번호도 여럿인데
    // (`3, 4, 5, 6`), 카드를 누르면 늘 첫 번호로만 갔다 — 나머지로 갈 길이 없었다.
    goMark: function (arg) {
      var cut = String(arg).indexOf("|");
      if (cut < 0) return;
      var id = arg.slice(0, cut), no = arg.slice(cut + 1);
      var it = ((state.marks || {}).items || []).filter(function (x) {
        return x.id === id;
      })[0];
      if (!it) { toast("이 근거의 원문 위치를 아직 찾지 못했습니다.", "err"); return; }
      var m = (it.marks || []).filter(function (x) {
        return String(x.no) === String(no);
      })[0];
      if (!m) { toast("선택한 근거의 위치를 찾지 못했습니다. 다른 근거 번호를 확인해 주세요.", "err"); return; }
      window.DR.pdfview.highlight(id);
      window.DR.pdfview.goTo(m.page, m.rect);
    },
    // 확실/확인 필요는 켜고 끄는 체크박스가 아니라 "이 결과만 보기"다. 예전엔
    // `확실`을 누르면 확실한 카드가 사라져 버튼의 문구와 결과가 반대로 움직였다.
    setSevFilter: function (k) {
      var keys = ["major", "minor", "info", "unreviewed"];
      // `issue` 는 화면 묶음(지적 = major+minor, views.js SEV_GROUPS).
      var on = k === "all" ? keys : k === "issue" ? ["major", "minor"] : keys.indexOf(k) < 0 ? null : [k];
      if (!on) return;
      keys.forEach(function (key) { state.sevFilter[key] = on.indexOf(key) >= 0; });
      state.selected = null;
      state.fixes = {};
      window.DR.pdfview.highlight(null);
      if (!repaintSingleIssues()) render();
      var selectedFilter = document.querySelector('#issuesPanel [data-act="setSevFilter"][data-arg="' + k + '"]');
      if (selectedFilter) selectedFilter.focus({ preventScroll: true });
      var list = document.querySelector('#issuesPanel [data-scroll="issues"]');
      if (list) list.scrollTop = 0;
    },
    setChecker: function (c) {
      state.checkerFilter = c;
      state.selected = null;
      state.fixes = {};
      window.DR.pdfview.highlight(null);
      if (!repaintSingleIssues()) render();
      var list = document.querySelector('#issuesPanel [data-scroll="issues"]');
      if (list) list.scrollTop = 0;
    },
    resetResultFilters: function () {
      state.checkerFilter = "all";
      actions.setSevFilter("all");
    },
    // 지적 카드 고르기. 전체 렌더는 pdf-mount 를 새로 만들어 뷰어를 다시 열게 하므로
    // (viewerFor 참고), 카드를 누를 때마다 문서가 깜빡인다 — 그래서 바뀌는 카드 둘만
    // 갈아끼우고 뷰어는 손대지 않는다. toggleIssues가 같은 이유로 쓰는 방식이다.
    select: function (id) {
      // 상태 탭을 보는 중 원문 형광펜을 누르면 해당 수정 사항을 다시 드러낸다.
      var fromStatus = _views.reviewTabNow() === "status";
      if (fromStatus) {
        state.reviewTab = "findings";
        state.checkerFilter = "all";
        ["major", "minor", "info", "unreviewed"].forEach(function (key) { state.sevFilter[key] = true; });
      }
      var prev = state.selected;
      state.selected = prev === id ? null : id;
      // 수정안은 그 지적에 딸린 것이다. 카드를 옮기면 남겨둘 이유가 없다.
      if (prev !== state.selected) state.fixes = {};
      var hadCand = !!state.cand;
      state.cand = null;                       // 후보 점선은 고른 카드에만 붙는다

      // 텍스트 폴백(원본 PDF가 없어 본문을 그리는 화면)은 고른 지적에 따라
      // 형광 인용까지 다시 계산해야 한다 — 거기선 통째로 그리는 게 맞다.
      // 어차피 그 화면엔 iframe이 없어 잃을 것도 없다.
      if (!document.getElementById("pdf-mount")) { render(); return; }

      // 카드가 없어도 문서로는 간다. `반영 확인` 탭에는 지적 카드가 아예 없어서,
      // 예전에는 여기서 통째로 다시 그리고 끝났다 — 항목을 눌러도 새로고침만
      // 되고 그 자리로 안 갔다. 갈아끼울 카드가 없는 것과 갈 곳이 없는 것은 다르다.
      if (fromStatus) repaintSingleIssues();
      var cards = document.querySelectorAll("[data-card]");
      if (cards.length) repaintCard(prev, state.selected);
      syncViewer();
      // 고른 지적으로 문서를 옮긴다. locate() 좌표라 정확한 자리로 가고, 문서를
      // 다시 읽지 않으므로 깜빡임이 없다. 선택 해제면 강조만 끄고 그 자리에 둔다.
      window.DR.pdfview.highlight(state.selected || null);
      var it = ((state.marks || {}).items || []).filter(function (x) {
        return x.id === state.selected;
      })[0];
      if (it && it.marks && it.marks.length) {
        window.DR.pdfview.goTo(it.marks[0].page, it.marks[0].rect);
      } else if (state.selected && state.marks) {
        if (goUnlocated(state.selected)) return;
      }
      if (hadCand) paintMarks();               // 다른 카드로 옮겼으면 점선을 걷는다
    },
    // 인용 옆 "후보 N곳 / 위치 못 찾음" 칩이 부른다 — 카드는 이미 열려 있다.
    goUnlocated: function (id) { goUnlocated(id); },
    // 후보 자리 이동(같은 문장이 여러 곳). 카드의 ‹ › 가 부른다.
    candStep: function (dir) {
      var c = state.cand;
      if (!c || !c.list.length) return;
      c.idx = (c.idx + (Number(dir) || 1) + c.list.length) % c.list.length;
      window.DR.pdfview.goTo(c.list[c.idx].page, c.list[c.idx].rect);
      repaintCard(c.id);
    },
    // 지적 하나의 수정안을 받아 카드 안에 펼친다. 검토 때 미리 만들지 않는 이유는
    // 지적 대부분이 읽고 넘기는 것이라, 매번 문장을 새로 짓게 하면 검토가 느려지고
    // 비싸지기 때문이다 — 검토자가 그 지적을 붙들었을 때만 묻는다.
    suggestFix: function (key) {
      // 인용마다 따로 만든다 — arg 는 "지적id|인용순번" 이다. 예전엔 지적 하나에
      // 하나뿐이라 첫 인용만 고쳐졌고, 근거가 여럿인 지적(실측 18개)에서는
      // 나머지를 검토자가 손으로 옮겨 적어야 했다.
      var cut = String(key).lastIndexOf("|");
      var id = cut < 0 ? String(key) : String(key).slice(0, cut);
      var qi = cut < 0 ? 0 : parseInt(String(key).slice(cut + 1), 10) || 0;
      var f = null;
      (window.DOCREVIEW.findings || []).forEach(function (x) { if (x.id === id) f = x; });
      if (!f) return;
      var ev = (f.evidence || [])[qi] || {};

      state.fixes[key] = { busy: true };
      repaintCard(id);

      var fd = new FormData();
      fd.append("message", f.message || "");
      fd.append("quote", ev.quote || "");
      // 어느 기준에서 나온 지적인지 함께 보낸다 — 기준을 모르면 모델이 어느
      // 방향으로 고칠지 알 수 없다(SI 단위계는 "5kg" 가 아니라 "5 kg" 가 맞다).
      // 기준 없는 일반 검토면 빈 문자열이고, 서버는 그때 기준 절을 안 만든다.
      fd.append("criterion", _views.criterionTextFor(id) || "");
      // 같은 지적이 함께 든 다른 인용. 모순 지적은 두 곳이 어긋나 나오는데, 한
      // 곳만 보내면 모델이 지적 문장에 적힌 다른 쪽 표현을 정답으로 삼아 이쪽을
      // 거기 맞춰 고쳐 쓴다 — 실측: 개요의 "기능 및 성능 시험" 을 표 제목의
      // "기능 및 성능 및 기타 시험" 으로 바꿔 놨다. 하지도 않은 시험이 문서에
      // 들어갈 뻔했다. 다른 쪽을 보여줘야 "어느 쪽이 맞는지 확인하라"고 답한다.
      // 인용이 줄바꿈을 품을 일은 없다(문장 단위) — 줄바꿈으로 잇는다.
      fd.append("others", (f.evidence || []).filter(function (e, j) {
        return j !== qi && e && e.quote;
      }).map(function (e) { return e.quote; }).join("\n"));
      fd.append("llm", state.llm);
      fetch("api/suggest", { method: "POST", body: fd })
        .then(function (res) {
          if (!res.ok) {
            return res.text().then(function (b) {
              var d = b; try { d = JSON.parse(b).detail || b; } catch (e) { /* 평문 */ }
              throw new Error(String(d).slice(0, 160));
            });
          }
          return res.json();
        })
        .then(function (out) {
          if (!state.fixes[key]) return;   // 그새 다른 카드로 옮겼다(통째로 비웠다)
          state.fixes[key] = { busy: false, ok: !!out.ok, original: out.original || "",
                               revised: out.revised || "", reason: out.reason || "" };
          repaintCard(id);
        })
        .catch(function (e) {
          if (!state.fixes[key]) return;
          state.fixes[key] = { busy: false, ok: false, original: "", revised: "",
                               reason: "수정안을 받지 못했습니다: " + e.message };
          repaintCard(id);
        });
    },
    // 갈아끼우는 건 사람이 한다 — 원본이 PDF·HWPX라 도구가 직접 못 고친다.
    // 그래서 복사까지가 이 기능의 끝이다.
    copyFix: function (key) {
      var fx = state.fixes[key];
      if (!fx || !fx.revised) return;
      var text = fx.revised;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        // 성공을 말해준다 — 조용히 끝나면 복사가 됐는지 몰라 두 번 누른다.
        navigator.clipboard.writeText(text)
          .then(function () { toast("수정안을 복사했습니다"); })
          .catch(function () { window.prompt("복사하세요:", text); });
      } else {
        window.prompt("복사하세요:", text);   // http(비보안 컨텍스트)에선 clipboard가 없다
      }
    },
    // 기준을 바꾸면 잣대(id 패턴·범위·미작성 표시)가 통째로 달라진다. 서버에
    // 다시 물어 검토 기준 패널이 고른 것을 말하게 한다 — 안 그러면 example 로
    // 검토하면서 화면에는 prjx 가 떠 있다.
    // 검토를 중단하고 업로드 화면으로 돌아간다.
    //
    // abort() 만 불러선 안 된다. api.js 의 catch 는 AbortError 를 "새 검토가
    // 스스로 취소한 것"으로 보고 아무것도 하지 않는데(그 경우 새 검토가 이미
    // 화면을 세웠다), 사용자가 누른 중단은 세워줄 사람이 없어 진행 화면에
    // 멈춘 채 굳는다. 그래서 화면 복구를 여기서 직접 한다.
    cancelReview: function () {
      cancelJob("single");   // 서버에도 멈추라고 한다 — 연결만 끊으면 계속 돈다
      if (state.reviewAbort) { state.reviewAbort.abort(); state.reviewAbort = null; }
      stopThen("single", function () {
        clearTimers();
        state.done = false;
        state.stageIndex = -1;
        state.stageDetail = {};
        state.rev = { startedAt: 0, prepAt: 0, prep: {}, lanes: [], done: {}, note: "", active: "", criteriaOpen: false };
        state.serror = null;
        state.screen = "upload";
        render();
      });
    },
    // 검사 취소 — 단일 검토(cancelReview)와 같은 자리, 같은 뜻. 인식 결과는
    // 남겨 두고 인식 확인 단계로 되돌린다. 업로드까지 되돌리면 폴더를 다시
    // 끌어다 놓아야 한다.
    cancelCase: function () {
      var k = state.kase;
      cancelJob("case");     // 서버에도 멈추라고 한다
      if (k.abort) { k.abort.abort(); k.abort = null; }
      stopThen("case", function () {
        k.stage = {};
        k.startedAt = 0;
        k.error = null;
        k.step = k.recog ? "recognize" : "upload";
        render();
      });
    },
    // 단일 검토를 등록된 체크리스트 기준으로 평가할지 고른다("" = 안 씀).
    // 자동 검토 기준(state.checklist)과 달리 감지·서버설정을 다시 부르지 않는다 —
    // 이 선택은 항목별 그룹핑에만 쓰이고 엔진의 id_pattern과 무관하다.
    pickReviewChecklist: function (id) {
      state.reviewChecklistId = id;
      state.clayers = { list: null, busy: false, error: null, open: {}, openItem: {}, how: "", q: "" };
      render();
    },
    // 단일 검토에서 "체크리스트가 없습니다 → 체크리스트" 링크로 왔다. 탭을
    // 고르기 모드로 열어, 등록/작성 후 "선택" → "검토로 돌아가기"로 복귀시킨다.
    // setMode 를 안 거친다 — setMode(checklists)는 고르기 모드를 끄기 때문이다.
    goPickChecklist: function () {
      state.checklistPickReturn = true;
      state.clib.detail = null; state.clib.error = null;
      state.mode = "checklists";
      actions.loadChecklists();   // 완료되면 다시 render 한다
      state.clayers.scope = "추가";
      actions.loadCriteriaLayers({ refresh: true, deferRender: true });
      render();
    },
    // 고르기 모드에서 이 체크리스트를 고른다 — 그 자리에서 선택 표시만 하고
    // 머문다. 곧장 돌아가면 순간이동처럼 뜨므로, 돌아가는 건 배너의
    // "검토로 돌아가기"로 사람이 누른다(backToReviewFromChecklist).
    selectChecklistForReview: function (id) {
      state.reviewChecklistId = id;
      render();
    },
    // 검토 화면으로 돌아간다(상단 배너). 위에서 고른 reviewChecklistId 는
    // 그대로 남아, 셋업 화면에 그 체크리스트가 칩으로 선택되어 있다.
    backToReviewFromChecklist: function () {
      state.checklistPickReturn = false;
      state.mode = "single"; state.screen = "upload";
      if (!state.clib.list.length) actions.loadChecklists();
      render();
    },
    setSort: function (k) {
      state.sort = k;
      if (!repaintSingleIssues()) render();
    },
    setLlm: function (k) { state.llm = k; render(); },
    // 테마는 기억한다. 예전엔 <html>에 data-theme만 걸고 어디에도 남기지 않아
    // 새로고침하면 늘 라이트로 되돌아갔다 — "설정"이라 불러놓고 안 지켜졌다.
    setTheme: function (k) {
      state.theme = k;
      document.documentElement.setAttribute("data-theme", k);
      try { localStorage.setItem("dr_theme", k); } catch (e) { /* 사생활 보호 모드 */ }
      render();
    },
    openFile: function (slot) { var el = document.getElementById("file-" + slot); if (el) el.click(); },
    clearFile: function (slot) {
      if (!state.files.hasOwnProperty(slot)) return;
      state.files[slot] = null;
      if (state.cdetect.hasOwnProperty(slot)) state.cdetect[slot] = null;
      // 시트 목록은 그 xlsx 의 것이다 — 파일을 빼고 남기면 없는 파일의 시트를
      // 고른 채로 화면이 서 있는다.
      if (slot === "evalSheet") {
        state.evalv.sheets = null; state.evalv.sheetIndex = 0;
        state.evalv.documentKind = ""; state.evalv.error = null;
      }
      render();
    },
    startReview: function () {
      clearTimers();
      // clearTimers()가 진행 중이던 holdDone의 advance()도 지운다 — 그대로 두면
      // done이 true로 눌어붙은 채 다음 검토로 들어간다.
      state.done = false;
      var f = state.files.single;
      // 문서 없이 시작하면 목업 findings가 진짜 결과처럼 떴다. 그 길을 막는다.
      if (!f || !f.file) {
        // 상단 배너는 원인(드롭존)과 메시지를 갈라놓는다 — 토스트가 말하고
        // 드롭존 강조가 자리를 짚는다(.drop-attention). 진짜 실패(서버 오류)는
        // 여전히 배너다 — 이건 실패가 아니라 안내다.
        state.mode = "single"; state.screen = "upload"; render();
        toast("검토할 문서를 먼저 올려주세요.", "err");
        var dz = document.querySelector(".dropzone");
        if (dz) {
          dz.classList.remove("drop-attention");
          void dz.offsetWidth;            // 애니메이션 재시작(클래스 재부착용 reflow)
          dz.classList.add("drop-attention");
          dz.scrollIntoView({ block: "center", behavior: reduceMotion() ? "auto" : "smooth" });
        }
        return;
      }
      if (!servedOverHttp()) {
        state.serror = "브라우저로 파일을 직접 연 상태입니다. `docreview serve`로 띄운 주소에서 검토하세요.";
        state.mode = "single"; state.screen = "upload"; render();
        return;
      }

      window.DOCREVIEW.doc.name = f.name;
      window.DOCREVIEW.doc.type = (f.name.split(".").pop() || "").toUpperCase();
      state.fromHistory = false;    // 새로 시작한 검토 — "돌아갈" 목록이 없다
      state.navRecordId = null;
      state.serror = null;
      state.stageDetail = {};
      state.rev = { startedAt: Date.now(), prepAt: 0, prep: {}, lanes: [], done: {}, note: "", active: "", criteriaOpen: false };
      state.clayers = { list: null, busy: false, error: null, open: {}, openItem: {}, how: "", q: "" };
      state.mode = "single"; state.screen = "progress"; state.stageIndex = -1;
      state.reviewed = false;                 // 이번 검토는 아직 결과가 없다
      state.selected = null;
      render();
      actions.loadCriteriaLayers();
      tickElapsed();   // 경과 시간은 이벤트가 없어도 흘러야 한다

      var fd = new FormData();
      fd.append("file", f.file);
      fd.append("llm", state.llm);
      if (state.checklist) fd.append("checklist", state.checklist);
      // 등록된 체크리스트를 평가 기준으로 골랐으면 함께 보낸다 — 서버가 항목별
      // findings(payload.checklist)를 되돌려 보낸다(done 이벤트는 api.js가 받는다).
      if (state.reviewChecklistId) fd.append("checklist_id", state.reviewChecklistId);
      // 검토자가 고른 문서 종류. 비우면 서버가 파일명으로 가린다.
      if (state.outputPick && state.outputPick.key) fd.append("output_key", state.outputPick.key);
      streamReview(fd);
    },
    // ── 체크리스트 검토(부록 B 초안) ──────────────────────────────────────
    goEStep: function (step) {
      if (step === "results" && !state.evalv.payload) return;
      if (step === "progress") return;      // 지나가는 화면 — 돌아갈 곳이 아니다
      state.estep = step; render();
    },
    setEvalSheet: function (index) {
      var s = (state.evalv.sheets || []).filter(function (x) { return x.index === Number(index); })[0];
      if (!s || s.error) return;
      // 시트가 바뀌면 문서 종류 후보도 바뀐다 — 앞 시트에서 고른 값을 끌고 가지 않는다.
      state.evalv.sheetIndex = s.index; state.evalv.documentKind = ""; render();
    },
    setEvalDocKind: function (kind) { state.evalv.documentKind = kind || ""; render(); },
    startEvaluate: function () {
      clearTimers();
      var fd0 = state.files.evalDoc, fs0 = state.files.evalSheet;
      if (!(fd0 && fd0.file) || !(fs0 && fs0.file)) {
        state.evalv.error = "검토 대상 문서와 체크리스트를 모두 올려야 합니다."; render(); return;
      }
      var picked = (state.evalv.sheets || []).filter(function (s) { return s.index === state.evalv.sheetIndex; })[0];
      if (!picked || picked.error) { state.evalv.error = "읽을 수 있는 시트를 고르세요."; render(); return; }
      if ((picked.documents || []).length && !state.evalv.documentKind) {
        state.evalv.error = "이 시트는 문서마다 행이 갈립니다 — 문서 종류를 고르세요."; render(); return;
      }
      state.fromHistory = false; state.navRecordId = null;
      state.evalv.error = null; state.evalv.payload = null;
      state.evalv.historyId = ""; state.evalv.historyAt = "";
      state.evalv.stage = {}; state.evalv.detail = {}; state.evalv.written = []; state.evalv.startedAt = Date.now();
      state.mode = "evaluate"; state.estep = "progress";
      render();
      tickEvaluateElapsed();
      var fd = new FormData();
      fd.append("document", fd0.file);
      fd.append("checklist", fs0.file);
      fd.append("sheet_index", String(state.evalv.sheetIndex));
      fd.append("document_kind", state.evalv.documentKind || "");
      fd.append("llm", state.llm);
      streamEvaluate(fd);
    },
    // 단일·비교와 같은 관용구(stopThen) — 진행 화면 머리말이 "검토를 멈췄습니다"를
    // 한 박자 말한 뒤 설정으로 돌아간다. 예전엔 곧장 setup 으로 튀면서 빨간 에러
    // 배너로 알렸는데, 멈춘 것은 잘못된 일이 아니라 시킨 일이라 배너가 과했고
    // 세 화면 중 여기만 달랐다.
    cancelEvaluate: function () {
      cancelJob("evaluate");    // 서버에도 멈추라고 한다 — 연결만 끊으면 끝까지 돈다
      if (state.evaluateAbort) { state.evaluateAbort.abort(); state.evaluateAbort = null; }
      stopThen("evaluate", function () {
        clearTimers();
        state.estep = "setup";
        state.evalv.error = null;
        render();
      });
    },
    // 원문을 **새 창**으로. 비교 검토의 원문 보기와 같은 관용구다(openDocWindow)
    // — 검토자는 대개 모니터가 둘이라 설계서를 옆에 두고 이쪽에서 판정한다.
    // 초안은 화면에 뷰어를 안 박는다(2026-09-16 재설계).
    //
    // 쪽 번호를 URL 조각으로 넘기지 않는다 — 이 저장소는 app.js 에서 그 조각을
    // 금지한다(tests/test_frontend_viewer_assets.py: 예전 iframe 뷰어가 조각으로
    // 쪽을 옮기다 매번 깜빡였다). 창은 문서 첫 쪽에서 열리고, 몇 쪽인지는 행이
    // 글자로 말한다("12쪽").
    // 원문은 비교 검토와 **같은 자체 뷰어 창**(?doc=…)으로 연다 — 브라우저 내장 PDF 뷰어는
    // 쪽 이동도 형광펜도 못 하고 docx·hwpx 는 다운로드로 떨어졌다(2026-09-17). arg 는
    // "E|행번호|쪽": 창이 그 행의 인용에 형광펜을 얹고 그 자리로 간다.
    openEvalOriginal: function (arg) {
      var hid = state.evalv.historyId;
      if (!hid) {
        state.evalv.error = "이력에 저장되지 않아 원문을 열 수 없습니다."; render(); return;
      }
      arg = String(arg || "E||");
      if (state.popup) { actions.openEvalDoc(arg); return; }
      var w = state.docWins.evaluate;
      if (w && !w.closed) {
        // 창은 하나뿐이다 — 행마다 창이 열리면 금세 열댓 개가 된다. 행을 옮기면 따라간다.
        try { w.postMessage({ type: "docsuree-focus", arg: arg }, location.origin); w.focus(); return; }
        catch (e) { /* 닫힌 창 — 아래에서 새로 연다 */ }
      }
      var url = location.pathname + "?doc=" + encodeURIComponent(hid) + "&arg=" + encodeURIComponent(arg);
      state.docWins.evaluate = window.open(url, "docsuree-doc-evaluate", "popup=yes,width=1100,height=900");
      if (!state.docWins.evaluate) {
        state.evalv.error = "팝업이 막혀 원문을 열지 못했습니다. 이 사이트의 팝업을 허용해 주세요.";
        render();
      }
    },
    // 행의 쪽수: 창을 새로 띄우지 않는다. 열린 원문 창이 있으면 그 행의 자리로 옮기고,
    // 없으면 여는 길(원문 ↗)을 알려 준다 — 버튼 하나가 두 일을 하면 "원문 보기와 뭐가
    // 다르지"가 된다(2026-09-17 정리).
    evalRowOriginal: function (arg) {
      if (state.popup) { actions.openEvalDoc(String(arg || "")); return; }
      var w = state.docWins.evaluate;
      if (w && !w.closed) {
        try { w.postMessage({ type: "docsuree-focus", arg: String(arg || "") }, location.origin); w.focus(); return; }
        catch (e) { /* 닫힌 창 */ }
      }
      toast("원문 창이 열려 있지 않습니다 — 위의 원문 ↗ 으로 먼저 여세요.");
    },
    // 원문 창 안에서: 초안 기록의 문서를 자체 뷰어로 연다. 초안 행의 검증된 인용이
    // 형광펜 자리다(id "e<행번호>"). openCompareDoc 과 같은 cview 계약이라 뷰어·
    // 형광펜·판정 패널 없는 팝업 화면을 그대로 쓴다.
    openEvalDoc: function (arg) {
      var parts = String(arg || "").split("|");
      var focus = parts[1] !== "" && parts[1] !== undefined ? "e" + parts[1] : "";
      var page = parseInt(parts[2] || "", 10) || 0;
      var p = state.evalv.payload || {};
      var hid = state.evalv.historyId;
      if (state.cview && state.cview.side === "E" && window.DR.pdfview && window.DR.pdfview.isOpen()) {
        var changed = state.cview.focus !== focus;
        state.cview.focus = focus; state.cview.page = page;
        if (changed) render();
        if (state.popup) paintMarks();
        var located = ((state.marks || {}).items || []).filter(function (it) { return it.id === focus; })[0];
        if (located && located.marks && located.marks.length) {
          window.DR.pdfview.highlight(focus);
          window.DR.pdfview.goTo(located.marks[0].page, located.marks[0].rect);
        } else if (page) {
          // 좌표가 아직 없으면(캐시가 비어 서버가 세는 중) 쪽으로 먼저 간다 — 검토자가
          // "안 움직인다"고 느끼지 않게. 좌표가 오면 loadMarks 가 그 자리로 옮기고 칠한다.
          window.DR.pdfview.goTo(page);
          if (!state.marks) toast("원문 위치를 찾는 중입니다 — 잠시 뒤 형광펜이 표시됩니다.");
        }
        return;
      }
      var slot = state.files.evalDoc;
      if (!slot || !slot.file) {
        if (!hid) { state.cerror = "원본이 없어 원문을 열 수 없습니다."; render(); return; }
        var nm = (p.doc || {}).name || "document";
        fetch("api/history/" + encodeURIComponent(hid) + "/original")
          .then(function (res) {
            if (!res.ok) throw new Error("보관된 원본이 없습니다(개수·용량 제한으로 밀렸을 수 있습니다).");
            return res.blob();
          })
          .then(function (blob) {
            state.files.evalDoc = { name: nm, size: blob.size, file: new File([blob], nm) };
            actions.openEvalDoc(arg);
          })
          .catch(function (err) { state.cerror = "원문을 열지 못했습니다: " + errMessage(err); render(); });
        return;
      }
      // id 는 **항목 순번**("e<i>") — 결과 표의 행 버튼(views.js evaluateRows)과 같은 번호.
      var byItem = {};
      (p.rows || []).forEach(function (r) { byItem[r.item_id] = r; });
      var findings = (p.items || []).map(function (it, i) {
        var r = byItem[it.id] || {};
        var ev = (r.quotes || []).filter(function (q) { return q.quote; })
          .map(function (q) { return { quote: q.quote, page: q.page || undefined, section: q.section || undefined }; });
        return { id: "e" + i, sev: "info", message: (r.status === "drafted" ? "제안 " + (r.verdict_hint || "") + " · " : "") + (r.comment || ""), evidence: ev };
      }).filter(function (f) { return f.evidence.length; });
      state.cview = { side: "E", file: slot.file, name: slot.name, findings: findings, focus: focus, page: page };
      state.viewer = { mode: "orig", baseBlob: null, origUrl: null, converting: false, convertError: null };
      state.marks = null;
      render();
    },
    // 부록 B 엑셀. 단일 검토(exportXlsx)와 같은 길 — 서버가 이력에서 만든다.
    exportEvaluationXlsx: function () {
      var hid = state.evalv.historyId;
      if (!hid) {
        state.evalv.error = "이력에 저장되지 않아 엑셀을 만들 수 없습니다."; render(); return;
      }
      fetch("api/history/" + encodeURIComponent(hid) + "/evaluation.xlsx")
        .then(function (res) {
          if (!res.ok) {
            return res.json().catch(function () { return {}; })
              .then(function (b) {
                throw new Error(b.detail || (res.status === 404
                  ? "서버에 이 기능이 없습니다 — 서버를 다시 시작해 주세요." : "HTTP " + res.status));
              });
          }
          return res.blob();
        })
        .then(function (blob) {
          var name = ((state.evalv.payload || {}).doc || {}).name || "document";
          downloadBlob(_H.exportStem(name, state.evalv.historyAt) + ".평가표초안.xlsx", blob);
        })
        .catch(function (err) { toast("엑셀 내보내기 실패: " + errMessage(err), "err"); });
    },
    startCompare: function () {
      clearTimers();
      var fa = state.files.compareA, fb = state.files.compareB;
      // 두 문서가 다 있어야 비교다. 예전에는 빈 채로도 목업 흐름이 돌아
      // 가짜 진행·빈 결과가 떴다 — 없는 검토를 그럴듯하게 보여주는 것이다.
      if (!(fa && fa.file) || !(fb && fb.file)) {
        state.cerror = "상위 문서와 하위 문서를 모두 올려야 비교를 시작할 수 있습니다.";
        render();
        return;
      }
      window.DOCREVIEW.compare.docA.name = fa.name;
      window.DOCREVIEW.compare.docB.name = fb.name;
      state.fromHistory = false;    // 새로 시작한 비교 — "돌아갈" 목록이 없다
      state.navRecordId = null;
      // 비교 진행 화면의 경과 시간 원점. 단계 SSE가 올 때마다 화면 머리말에서
      // 같은 시각을 기준으로 갱신한다.
      state.compareStartedAt = Date.now();
      state.cerror = null;
      state.mode = "compare"; state.cstep = "progress"; state.cstageIndex = -1;
      state.cdone = false;
      render();
      tickCompareElapsed();

      // file:// 프로토타입(서버 없음)만 목업 연출을 유지한다. 서버가 있으면
      // 가짜 단계 애니메이션 대신 /api/compare SSE 가 실제 진행을 흘린다.
      if (!servedOverHttp()) {
        animate(window.DOCREVIEW.compare.stages.length, function (i) { state.cstageIndex = i; },
          760, false, function () {
            holdDone(function () { state.cdone = true; },
                     function () { state.cdone = false; if (state.cstep === "progress") state.cstep = "results"; });
          });
        return;
      }

      // 씨앗 단계의 목업 문구(가짜 건수)를 비운다 — 실제 이벤트가 채운다.
      window.DOCREVIEW.compare.stages.forEach(function (s) { s.detail = ""; });
      var fd = new FormData();
      fd.append("parent", fa.file);
      fd.append("child", fb.file);
      fd.append("llm", state.llm);
      if (state.checklist) fd.append("checklist", state.checklist);
      if (state.cscope) fd.append("scope", state.cscope);
      streamCompare(fd);
    },
    reloadHistory: function () {
      clearTimeout(historySearchTimer);
      return state.mode === "history" ? loadHistoryPage() : loadHistory();
    },
    setHistoryPage: function (offset) {
      if (state.hbusy || (state.historyPage && state.historyPage.busy)) return;
      state.historyOffset = Math.max(0, Number(offset) || 0);
      clearTimeout(historySearchTimer);
      closeHistoryActions();
      return loadHistoryPage();
    },
    setHistoryKind: function (kind) {
      state.historyKind = kind || "";
      state.historyOffset = 0;
      clearTimeout(historySearchTimer);
      closeHistoryActions();
      loadHistoryPage();
      var buttons = document.querySelectorAll('#historyRecords [data-act="setHistoryKind"]');
      Array.prototype.forEach.call(buttons, function (button) {
        if (button.getAttribute("data-arg") === state.historyKind) button.focus({ preventScroll: true });
      });
    },
    resetHistoryFilters: function () {
      state.historyQ = ""; state.historyKind = "";
      state.historyOffset = 0;
      clearTimeout(historySearchTimer);
      closeHistoryActions();
      loadHistoryPage();
      var input = document.querySelector('[data-history-q]');
      if (input) { input.value = ""; input.focus({ preventScroll: true }); }
    },
    toggleHistoryActions: function (id) {
      var button = document.getElementById(id);
      var menu = document.getElementById(id + "-menu");
      if (!button || !menu) return;
      var opening = menu.hidden;
      closeHistoryActions();
      if (!opening) { button.focus({ preventScroll: true }); return; }
      menu.hidden = false; button.setAttribute("aria-expanded", "true");
      menu.classList.remove("is-above");
      if (menu.getBoundingClientRect().bottom > window.innerHeight - 16) menu.classList.add("is-above");
      var first = menu.querySelector("button");
      if (first) first.focus({ preventScroll: true });
    },
    // 저장해둔 검토를 다시 연다. 문서를 재업로드하지 않는다 — 그때 그 결과 그대로다.
    openHistory: function (id) {
      if (!id || state.hbusy) return;
      // 알림·검색에서도 부른다 — 결과로 넘어가는데 팝오버가 남아 있으면 안 된다.
      state.notiOpen = false; state.searchOpen = false;
      state.herror = null;
      // 어디서 열었는지 — 결과 화면 백링크가 "홈으로/목록으로 돌아가기"를
      // 출처대로 단다. 홈에서 열었는데 "목록으로 돌아가기"는 거짓말이었다
      // (2026-09-01 지적).
      state.historyOrigin = state.mode;
      state.hbusy = true; render();
      fetch("api/history/" + encodeURIComponent(id))
        .then(function (res) {
          if (!res.ok) throw new Error("이력을 불러오지 못했습니다 (HTTP " + res.status + ")");
          return res.json();
        })
        .then(function (rec) {
          state.hbusy = false;
          clearTimers();
          state.fromHistory = true;   // 결과 화면 백링크가 "목록으로 돌아가기"를 단다
          state.navRecordId = id;     // 뒤로가기가 이 기록으로 정확히 돌아오게
          var p = rec.payload;
          if (rec.kind === "case") {
            // 산출물 세트 검토. 원본 파일은 브라우저가 안 들고 있으므로 뷰어는 못 연다
            // (검사 때 올린 것은 서버가 이미 지웠다). 리포트와 확인 표시만 되살린다.
            var checked = {};
            (p.manualChecked || []).forEach(function (id) { checked[id] = true; });
            p.history = { saved: true, id: rec.id, at: rec.at };
            state.kase = {
              step: "results", tab: "summary", selOutput: "", view: null,
              checked: checked, manualInputs: p.manualInputs || {},
              confirmedAt: p.confirmedAt || "", confirming: false,
              team: "", files: [], recog: null, assign: {}, exclude: {},
              stage: {}, startedAt: 0, payload: p, criteria: null,
              criteriaLoading: false, criteriaError: "", criteriaFocus: "",
              matrixFocus: "", error: null, abort: null
            };
            state.mode = "case";
            render();
            return;
          }
          if (rec.kind === "evaluation") {
            // 부록 B 초안. 뷰어도 전역도 안 건드린다 — 화면은 초안 표 하나뿐이고
            // 원문은 새 창이 연다(2026-09-16 재설계). 단일 검토 상태는 그대로 둔다.
            p.history = { saved: true, id: rec.id, at: rec.at };
            state.evalv.payload = p; state.evalv.error = null;
            state.evalv.historyId = rec.id; state.evalv.historyAt = rec.at || "";
            state.mode = "evaluate"; state.estep = "results";
            render();
            return;
          }
          if (rec.kind === "compare") {
            // 이 결과가 이력의 어느 항목인지 다시 채운다. 서버는 저장 뒤
            // history 표식을 **응답에만** 얹고 저장본에는 안 넣으므로, 이력에서
            // 열면 그 자리가 비어 있다 — 그러면 화면이 "이력에 저장되지 않아
            // 원문을 열 수 없다 · 판정을 남길 수 없다"고 말한다. 방금 이력에서
            // 꺼내 온 결과에게 할 말이 아니다(2026-09-02).
            // 폴더 검토(아래 case 분기)는 진작 이렇게 하고 있었다.
            p.history = { saved: true, id: rec.id, at: rec.at };
            window.DOCREVIEW.compare = p;
            state.mode = "compare"; state.cstep = "results";
            state.cstageIndex = (p.stages || []).length - 1;
            state.cerror = null;
            state.cverdicts = p.rtmVerdicts || {};
            state.cverdictSaveError = null;
            state.cview = null; state.crtmOpenKey = null; state.crtmCursor = null;
            state.crtmOnlyTodo = !!state.todoFocus; state.todoFocus = false;
          } else if (rec.kind === "checklist") {
            // compare/single 과 달리 payload로 감싸지 않는다 — rec 최상위에
            // checklist_id·checklist_name·document_name·results 를 그대로 담아
            // 온다. 저장된 스냅샷만으로 자체 완결이라(체크리스트가 나중에
            // 지워져도 이어서 보고 판정할 수 있다 — 재저장·CSV만 서버가 404로
            // 막는다) 여기선 GET /api/checklists/{id} 를 다시 부르지 않는다.
            var saved = rec.results || [];
            var items = saved.map(function (r) {
              return { no: r.no, text: r.text, group: r.group, note: "" };
            });
            var results = {};
            // 결과는 no 가 아니라 배열 위치(index)로 키잉한다(위 setVerdict
            // 주석 참고) — 저장 스냅샷의 순서를 그 위치로 그대로 되쓴다.
            saved.forEach(function (r, i) {
              if (r.verdict || r.reason) results[String(i)] = { verdict: r.verdict || null, reason: r.reason || "" };
            });
            state.crun = { checklist: { id: rec.checklist_id, name: rec.checklist_name, items: items },
                           results: results, saving: false, error: null, from: "history",
                           documentName: rec.document_name || "" };
            state.runChecklistId = rec.checklist_id;
            state.mode = "checklistrun";
            render();
            return;
          } else {
            // 이력은 원본 파일이 없다 — 뷰어 대신 텍스트 폴백으로 간다. 직전 실검토의
            // blob·파일이 남아 엉뚱한 PDF가 뜨지 않도록 뷰어 상태를 비운다.
            if (state.viewer.origUrl) URL.revokeObjectURL(state.viewer.origUrl);
            if (state.annot.viewUrl) URL.revokeObjectURL(state.annot.viewUrl);
            // loadingOrig: 이력 원본을 내려받는 동안 — 뷰어는 이 동안도 "준비 중"을
            // 그린다. 없으면 첫 프레임에 텍스트 재현본이 떴다가 원본으로 바뀐다(2026-09-04).
            state.viewer = { mode: "orig", baseBlob: null, origUrl: null, converting: false, convertError: null,
                             loadingOrig: rec.kind !== "compare" };
            state.annot = { busy: false, msg: "" };
            state.files.single = null;
            viewerFor = null;
            window.DOCREVIEW.doc = p.doc;
            window.DOCREVIEW.sections = p.sections || [];
            window.DOCREVIEW.findings = p.findings;
            window.DOCREVIEW.stages = p.stages;
            // 라이브 done 핸들러(api.js)와 똑같이 기준↔지적 연결과, 업로드 기준을
            // 골랐을 때의 그룹 화면 상태를 되살린다.
            window.DOCREVIEW.criteriaResults = p.criteriaResults || null;
            window.DOCREVIEW.checklist = p.checklist || null;
            // 기록마다 원문·판정·저장 대상이 함께 바뀌어야 한다. 직전 문서의 계보를
            // 남겨두면 다른 문서의 반영 판정을 보여주거나 이전 기록에 저장할 수 있다.
            window.DOCREVIEW.images = p.images || [];
            window.DOCREVIEW.lineage = p.lineage || null;
            window.DOCREVIEW.lineageCandidate = p.lineage_candidate || null;
            window.DOCREVIEW.lineageVerdicts = p.lineageVerdicts || null;
            window.DOCREVIEW.lineageCarried = p.lineageCarried || null;
            window.DOCREVIEW.historyId = rec.id;
            window.DOCREVIEW.historyAt = rec.at || "";
            window.DOCREVIEW.dismissed = p.dismissed || [];
            state.showDismissed = false;
            state.reviewTab = null;
            state.sevFilter = { major: true, minor: true, info: true, unreviewed: true };
            state.checkerFilter = "all"; state.sort = "severity";
            state.fixes = {}; state.exportMenuOpen = false;
            state.marks = null; state.markItems = []; state.issuesCollapsed = false;
            state.mode = "single"; state.screen = "results";
            state.stageIndex = (p.stages || []).length - 1;
            state.reviewed = true;      // 이력에서 되살린 것도 진짜 결과다
            state.done = true;          // 진행 탭이 "검토 중…"이라 거짓말하지 않게
            state.selected = null; state.serror = null;
          }
          render();
          // 서버가 원본을 보관해뒀다면(최근 몇 건) 되살려 뷰어로 — 재업로드·재검토 없이.
          // 밀려나 없으면 404 → 텍스트 폴백 그대로.
          if (rec.kind !== "compare") pullOriginal(id, (p.doc || {}).name || "document", p.doc);
        })
        .catch(function (err) {
          state.hbusy = false;
          state.herror = errMessage(err);
          render();
        });
    },
    // ---- 계정 관리(관리자) ----------------------------------------------
    // 서버가 403 으로 끊는 것이 진짜 관문이다. 여기 실패는 전부 화면에 드러낸다 —
    // 조용히 실패하면 관리자가 "바꿨다"고 믿는데 서버는 그대로다.
    // 프로필 메뉴의 바로가기 — 설정으로 가되 계정 관리 탭을 편다. setMode 가
    // 들어올 때마다 탭을 "app" 으로 되돌리므로 순서가 중요하다.
    goAccounts: function () {
      actions.setMode("settings");
      actions.setSettingsTab("accounts");
    },
    setSettingsTab: function (t) {
      state.settingsTab = t === "accounts" ? "accounts" : "app";
      // 탭을 열 때마다 다시 읽는다 — 다른 관리자가 그새 바꿨을 수 있다.
      if (state.settingsTab === "accounts") { actions.loadAdminAccounts(); return; }
      render();
    },
    loadAdminAccounts: function () {
      if (!servedOverHttp()) return;
      state.admin = { busy: true, list: null, error: null };
      render();
      fetch("api/admin/accounts").then(function (res) {
        return res.json().then(function (b) {
          if (!res.ok) throw new Error(b.detail || ("HTTP " + res.status));
          return b;
        });
      }).then(function (b) {
        state.admin = { busy: false, list: b.accounts || [], error: null };
        render();
      }).catch(function (err) {
        state.admin = { busy: false, list: null, error: errMessage(err) };
        render();
      });
    },
    setAccountRole: function (arg) {
      // arg = "이메일|등급" — selPick 이 넘긴다.
      var at = (arg || "").lastIndexOf("|");
      if (at < 0) return;
      var email = arg.slice(0, at), role = arg.slice(at + 1);
      var fd = new FormData();
      fd.append("role", role);
      postForm("api/admin/accounts/" + encodeURIComponent(email) + "/role", fd)
        .then(function () { actions.loadAdminAccounts(); })
        .catch(function (err) {
          toast("권한 변경 실패: " + errMessage(err), "bad");
          actions.loadAdminAccounts();     // 화면을 서버 값으로 되돌린다
        });
    },
    askDeleteAccount: function (email) {
      if (!email) return;
      state.confirmAccount = email;
      render();
    },
    deleteAccount: function (email) {
      state.confirmAccount = null;
      fetch("api/admin/accounts/" + encodeURIComponent(email), { method: "DELETE" })
        .then(function (res) {
          return res.json().then(function (b) {
            if (!res.ok) throw new Error(b.detail || ("HTTP " + res.status));
            return b;
          });
        })
        .then(function () {
          toast(email + " 계정을 삭제했습니다.");
          actions.loadAdminAccounts();
        })
        .catch(function (err) {
          toast("계정 삭제 실패: " + errMessage(err), "bad");
          actions.loadAdminAccounts();
        });
    },
    // 알림 줄의 "멈추기". 진행 화면으로 돌아가지 않아도 멈출 수 있어야 한다 —
    // 새로고침한 뒤에는 그 화면이 없다. 화면을 바꾸지 않으므로(알림은 열린 채)
    // 상태가 바뀌는 것은 목록이 다시 읽히면서 보인다.
    // 알림 창에서 검토를 누른다(2026-09-04). 끝난 것은 결과로, 진행 중인 것은
    // **진행 화면으로** — 알림을 여는 이유가 "어디까지 됐지"라서 진행 중인 항목이
    // 제일 눌려야 한다. 이 세션이 시작한 검토면 화면만 옮기고, 아니면(새로고침
    // 뒤·다른 탭에서 시작) 서버의 작업 스트림에 다시 붙는다(api.js jobStream).
    // 시작 상태는 startReview/startCompare/runCase 가 두는 것과 같되 파일이 없다 —
    // 끝나면 이력 원본을 끌어온다(api.js done → pullOriginal).
    // 홈 할 일 카드의 "N개 판정하기" — 비교 결과를 **판정 대기만** 보이게 연다.
    openTodo: function (id) { state.todoFocus = true; actions.openHistory(id); },
    // 종이와 포커스를 유지한 채 설명만 전환한다. 적용 기준에는 손대지 않는다.
    homeCriteriaExplain: function (key) {
      if (["common", "team", "upload"].indexOf(key) < 0) return;
      var tile = document.querySelector(".tile.crit");
      if (!tile || !tile.querySelector(".crit-descriptions")) return;
      state.homeCriteriaFocus = key;
      tile.querySelector(".crit-deck").classList.remove("scope-enter");
      tile.querySelectorAll('[data-act="homeCriteriaExplain"]').forEach(function (button) {
        var active = button.getAttribute("data-arg") === key;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", active ? "true" : "false");
      });
      tile.querySelectorAll(".crit-description").forEach(function (panel) {
        panel.hidden = panel.id !== "crit-description-" + key;
      });
    },
    // 홈 "무엇이든 물어보세요" — 문맥 없는 새 대화를 열고 첫 말을 바로 보낸다. 답하는 중인
    // 대화가 있으면 끊지 않고 입력창에만 둔다(openAssistant 가 그 대화를 지킨다).
    homeAsk: function () {
      var input = document.getElementById("homeAsk");
      var text = input ? input.value.trim() : "";
      if (text) actions.homeAskChip(text);
    },
    homeAskChip: function (text) {
      rememberAssistantReturn("");
      openAssistant("", "");
      var input = document.getElementById("chatInput");
      if (input) { input.value = text; if (!state.chat.busy) actions.chatSay(); }
    },
    // 도움말 차례 — 모달 안에서 그 절로 내린다(모달 몸통이 스크롤 상자라 앵커 링크가 안 듣는다).
    helpJump: function (id) {
      var el = document.getElementById(id);
      if (el) el.scrollIntoView({ block: "start", behavior: "smooth" });
    },
    // 홈 "DoSuree 에게 물어보기" — 문맥 없는 새 대화를 열고 첫 말을 바로 보낸다. 답하는 중인
    // 대화가 있으면 끊지 않고 입력창에만 둔다(openAssistant 가 그 대화를 지킨다).
    openJob: function (id) {
      var job = (state.jobs || []).filter(function (j) { return j.id === id; })[0];
      if (!job) return;
      state.notiOpen = false;
      if (job.status !== "running") {
        if (job.history_id) actions.openHistory(job.history_id); else render();
        return;
      }
      var which = job.kind === "review" ? "single" : job.kind === "compare" ? "compare"
                : job.kind === "case" ? "case" : job.kind === "evaluation" ? "evaluate" : null;
      if (!which) { render(); return; }            // 체크리스트 판정 등 — 진행 화면이 없다
      state.fromHistory = false; state.navRecordId = null;
      if (state.jobId[which] === id) {              // 이미 듣고 있다 — 화면만 옮긴다
        state.mode = which;
        if (which === "single") state.screen = "progress";
        else if (which === "compare") state.cstep = "progress";
        else if (which === "evaluate") state.estep = "progress";
        else state.kase.step = "progress";
        render(); return;
      }
      var startedAt = job.started_at ? job.started_at * 1000 : Date.now();
      if (which === "single") {
        clearTimers();
        state.done = false; state.files.single = null;
        window.DOCREVIEW.doc.name = job.title;
        window.DOCREVIEW.doc.type = (String(job.title).split(".").pop() || "").toUpperCase();
        state.serror = null; state.stageDetail = {};
        state.rev = { startedAt: startedAt, prepAt: 0, prep: {}, lanes: [], done: {}, note: "", active: "", criteriaOpen: false };
        state.clayers = { list: null, busy: false, error: null, open: {}, openItem: {}, how: "", q: "" };
        state.mode = "single"; state.screen = "progress"; state.stageIndex = -1;
        state.reviewed = false; state.selected = null;
        state.jobId.single = id;
        render();
        actions.loadCriteriaLayers();
        tickElapsed();
        streamReview(null, id);
      } else if (which === "evaluate") {
        // 알림에서 이어 듣는 초안.
        state.files.evalDoc = null;
        state.evalv.error = null; state.evalv.payload = null;
        state.evalv.historyId = ""; state.evalv.historyAt = "";
        state.evalv.stage = {}; state.evalv.detail = {}; state.evalv.written = []; state.evalv.startedAt = startedAt;
        state.mode = "evaluate"; state.estep = "progress";
        state.jobId.evaluate = id;
        render();
        tickEvaluateElapsed();
        streamEvaluate(null, id);
      } else if (which === "compare") {
        clearTimers();
        state.compareStartedAt = startedAt; state.cerror = null;
        state.mode = "compare"; state.cstep = "progress"; state.cstageIndex = -1; state.cdone = false;
        state.jobId.compare = id;
        render();
        tickCompareElapsed();
        streamCompare(null, id);
      } else {
        var k = state.kase;
        k.step = "progress"; k.stage = {}; k.error = null; k.startedAt = startedAt; k.payload = null;
        state.mode = "case";
        state.jobId.case = id;
        render();
        streamCase([], caseTeam(), id);
        tickCaseElapsed();
      }
    },
    cancelJobById: function (id) {
      if (!id || !servedOverHttp()) return;
      // 이 세션이 듣고 있는 검토면 진행 화면의 취소 버튼과 **같은 길**을 탄다 —
      // 서버에 알리고 화면은 바로 "멈췄습니다"로. 예전엔 알림에서 멈추면 서버가
      // 실제로 설 때까지(AI 호출 한 번, 수십 초) 진행 화면이 "멈추는 중"으로
      // 기다렸다 — 누른 자리에 따라 기다리는 시간이 달랐다(2026-09-04).
      // 서버의 마무리는 알림 창의 "멈추는 중"이 말한다.
      var which = ["single", "compare", "case", "evaluate"].filter(function (w) { return state.jobId[w] === id; })[0];
      if (which === "single") { actions.cancelReview(); return; }
      if (which === "compare") { actions.cancelCompare(); return; }
      if (which === "evaluate") { actions.cancelEvaluate(); return; }
      if (which === "case") { actions.cancelCase(); return; }
      // 이 세션 것이 아니면(다른 탭·새로고침 전 검토) 서버에만 알린다.
      fetch("api/jobs/" + encodeURIComponent(id) + "/cancel", { method: "POST" })
        .then(function () { loadJobs(); },
              function () { loadJobs(); });   // 이미 끝났을 수 있다 — 목록이 말한다
    },
    // 행의 삭제 버튼은 바로 지우지 않고 확인 모달을 연다.
    askDeleteHistory: function (id) {
      if (!id) return;
      var h = ((state.historyPage && state.historyPage.entries) || []).concat(state.history || [])
        .filter(function (x) { return x.id === id; })[0];
      if (!h) return;
      closeHistoryActions();
      state.confirmDelete = { id: id, title: h.title || "이 기록", kind: h.kind || "review" };
      render();
    },
    // 잘못된 지적을 뺀다(2026-09-15 품질팀). 서버가 이력에 남기고(payload.dismissed)
    // 지적의 신원 열쇠로 해당없음 판정을 붙여, 같은 문서를 다시 검토하면 이어받는다.
    // 화면은 서버가 돌려준 값으로만 바꾼다 — 먼저 감춰 두고 저장에 실패하면 거짓이 된다.
    dismissFinding: function (id) {
      // 되돌릴 수 있지만 한 번은 묻는다 — 단추 이름만 보고 눌러 보는 일이 있었다.
      // 기록 삭제와 **같은 확인창**(views.confirmDialog)을 쓰되 render() 는 부르지 않는다 —
      // 통째로 그리면 pdf-mount 가 새로 만들어져 뷰어가 PDF 를 다시 연다. 창은 #root
      // 밖(body)에 직접 넣고 닫을 때 떼어 낸다. 브라우저 기본 confirm 은 주소가 붙어
      // 다른 앱 창처럼 보여 뺐다(2026-09-15 지적).
      var f = (window.DOCREVIEW.findings || []).filter(function (x) { return x.id === id; })[0] || {};
      var head = String(f.message || "");
      if (head.length > 90) head = head.slice(0, 90) + "…";
      closeDismissModal();
      var wrap = document.createElement("div");
      wrap.id = "dismissModal";
      wrap.innerHTML = _views.confirmDialog({
        title: "지적 삭제",
        body: esc(head) + "<br><br>같은 문서를 다시 검토해도 올라오지 않습니다. 목록 아래 '제외한 지적'에서 되돌릴 수 있습니다.",
        act: "dismissFindingConfirmed", arg: id });
      document.body.appendChild(wrap);
      // 다른 시트와 같은 등장(아래에서 올라옴)·끌어서 닫기·퇴장을 sheet.js 가 건다.
      // render() 가 keep/sync 로 하는 일을 이 조각에만 손으로 해 준다.
      window.DR.sheet.sync(wrap, {}, sheetLayer());
    },
    dismissFindingConfirmed: function (id) {
      closeDismissModal();
      setDismissed(id, true);
    },
    restoreFinding: function (id) { setDismissed(id, false); },
    toggleCriteriaSection: function (key) {
      state.criteriaSections = state.criteriaSections || { manual: true };
      state.criteriaSections[key] = !state.criteriaSections[key];
      if (!repaintSingleIssues()) render();
    },
    toggleDismissed: function () {
      state.showDismissed = !state.showDismissed;
      if (!repaintSingleIssues()) render();
    },
    // 결과 화면의 내보내기 메뉴에서 이 검토를 지운다(2026-09-14 품질팀: 결과가
    // 별로면 바로 삭제). 목록의 삭제와 같은 확인창(state.confirmDelete)을 쓴다.
    askDeleteCurrent: function () {
      var D = window.DOCREVIEW;
      if (!D.historyId) return;
      closeExportMenu();
      state.confirmDelete = { id: D.historyId, title: (D.doc && D.doc.name) || "이 기록",
                              kind: D.checklist ? "checklist" : "review", fromResult: true };
      render();
    },
    cancelDelete: function () {
      // 지적 삭제 확인창은 상태 없이 body 에 얹은 것이라 떼어 내기만 한다 — render() 를
      // 부르면 결과 화면의 PDF 뷰어가 다시 열린다.
      if (closeDismissModal()) return;
      state.confirmDelete = null; state.confirmAccount = null; state.confirmChecklist = null; render();
    },
    // 현재 페이지의 기록만 확인받는다. 검색 결과 전체나 최근 캐시를 지우지 않는다.
    // 지우는 것은 같은 API 를 건마다 부르는 것이다 — 서버에 일괄 삭제를 따로
    // 두지 않는다(한 건이 실패해도 나머지는 지워지고, 결과는 목록이 말한다).
    askDeleteAll: function () {
      var rows = state.historyPage ? state.historyPage.entries || [] : state.history || [];
      if (state.historyPage && (state.historyPage.busy || state.historyPage.error)) return;
      var n = rows.length;
      if (!n) return;
      closeHistoryActions();
      state.confirmDelete = { id: "*", title: "현재 페이지 기록 " + n + "건", all: true,
        ids: rows.map(function (h) { return h.id; }) };
      render();
    },
    // 지적사항 화면의 "검토 결과" 사이드바를 접었다 폈다 — 문서를 넓게 정독할 때.
    // render()로 전체를 다시 그리면 문서 뷰어의 PDF iframe이 재부착되며 리로드된다.
    // 그래서 패널·레일은 늘 DOM에 있고, 둘의 실제 폭을 서로 넘겨주는 전환만 걸어
    // 뷰어를 건드리지 않는다. 문서 영역도 그 폭을 따라 한 번에 튀지 않고 늘어난다.
    // ---- 어시스턴트(A 안 2판) ----
    toggleAssistantSide: function () {
      state.chat.sideCollapsed = !state.chat.sideCollapsed;
      try { localStorage.setItem("dr.assistantSide", state.chat.sideCollapsed ? "closed" : "open"); } catch (e) { /* 기억 못 해도 동작한다 */ }
      // 통째로 다시 그리면 transition 이 안 탄다 — 클래스만 바꾼다.
      var root = document.querySelector(".assistant-app");
      if (!root) { render(); return; }
      root.classList.toggle("side-collapsed", state.chat.sideCollapsed);
      var full = root.querySelector(".assistant-side-full"), rail = root.querySelector(".assistant-rail");
      if (full) full.setAttribute("aria-hidden", state.chat.sideCollapsed ? "true" : "false");
      if (rail) rail.setAttribute("aria-hidden", state.chat.sideCollapsed ? "false" : "true");
    },
    // 마스코트 말풍선의 세 버튼. 결과 보기는 종 알림의 openJob 과 같은 길,
    // 물어보기는 그 검토를 문맥으로 안고 어시스턴트로.
    mascotSayClose: function () { state.mascotSay = null; render(); },
    // 자기소개 말풍선을 닫으면 "봤다"로 친다 — 열어 본 것과 같은 기억.
    mascotIntroClose: function () { markAssistantSeen(); render(); },
    mascotSayOpen: function () {
      var say = state.mascotSay; state.mascotSay = null;
      if (say) actions.openJob(say.id); else render();
    },
    mascotSayAsk: function () {
      var say = state.mascotSay; state.mascotSay = null;
      rememberAssistantReturn("");
      if (say) openAssistant(say.history_id, say.title, say.kind); else render();
    },
    launcherChat: function () {
      rememberAssistantReturn(chatReviewId());
      openAssistant(chatReviewId(), chatReviewTitle(), chatReviewKind());
    },
    // 들어온 자리로. 없으면 홈. 문맥 칩이 따로 검토를 열던 것을 이 하나로 합쳤다 — "DocSuree 로"와
    // 칩 링크가 둘 다 나가는 문이라 겹쳤다(2026-09-16).
    assistantBack: function () {
      var r = state.assistantReturn;
      if (!r || r.mode === "assistant") { actions.setMode("home"); return; }
      state.mode = r.mode; state.screen = r.screen; state.cstep = r.cstep;
      if (r.estep) state.estep = r.estep;
      render();
    },
    chatNew: function () {
      var c = state.chat;
      if (c.busy) return;
      c.pendingReview = ""; c.pendingReviewTitle = ""; c.pendingReviewKind = "";
      c.current = null; c.msgs = []; c.error = ""; c.since = 0;
      render();
    },
    chatChip: function (text) {
      var input = document.getElementById("chatInput");
      if (input) input.value = text;
      actions.chatSay();
    },
    chatOpen: function (sid) {
      var c = state.chat;
      if (c.busy) return;
      c.opening = true; c.error = "";
      render();
      postForm("api/chat/sessions/" + encodeURIComponent(sid) + "/open", new FormData())
        .then(function (body) {
          c.current = body.session; c.msgs = body.messages || []; c.error = ""; c.since = 0;
          c.pendingReview = ""; c.pendingReviewTitle = ""; c.pendingReviewKind = ""; c.opening = false;
          render();
        })
        .catch(function (err) { c.opening = false; c.error = errMessage(err); render(); });
    },
    chatRename: function (sid) {
      var s = state.chat.sessions.filter(function (x) { return x.id === sid; })[0];
      var name = window.prompt("대화 이름", s ? s.title : "");
      if (!name) return;
      var fd = new FormData(); fd.append("title", name);
      postForm("api/chat/sessions/" + encodeURIComponent(sid) + "/rename", fd)
        .then(function () { return loadChatSessions(); })
        .catch(function (err) { state.chat.error = errMessage(err); render(); });
    },
    chatDelete: function (sid) {
      if (!window.confirm("이 대화를 지울까요? 되돌릴 수 없습니다.")) return;
      fetch("api/chat/sessions/" + encodeURIComponent(sid), { method: "DELETE" })
        .then(function (res) { if (!res.ok) throw new Error("삭제 실패 (HTTP " + res.status + ")"); })
        .then(function () {
          var c = state.chat;
          if (c.current && c.current.id === sid) { c.current = null; c.msgs = []; c.since = 0; }
          return loadChatSessions();
        })
        .catch(function (err) { state.chat.error = errMessage(err); render(); });
    },
    chatSay: function () {
      var input = document.getElementById("chatInput");
      var text = input ? input.value.trim() : "";
      var c = state.chat;
      if (!text || c.busy || c.opening) return;
      c.busy = true; c.error = ""; input.value = ""; input.style.height = "";
      c.msgs.push({ role: "user", text: text });
      c.msgs.push({ role: "assistant", text: "", tools: [] });
      repaintChat();
      var fd = new FormData();
      fd.append("message", text);
      // 검토 문맥: 열려 있는 대화의 것, 없으면 마스코트로 안고 온 것.
      fd.append("review_id", (c.current && c.current.review_id) || c.pendingReview || "");
      var firstTurn = !c.current;
      postForm("api/chat/say", fd)
        .then(function (body) {
          c.current = body.session;
          c.pendingReview = ""; c.pendingReviewTitle = ""; c.pendingReviewKind = "";
          // 이번 턴의 시작 번호부터 읽는다 — 0 부터 읽으면 같은 계정의 지난 턴이 이번
          // 답으로 뜬다(다른 창·curl 도 같은 프로세스를 쓴다).
          if (typeof body.since === "number") c.since = body.since;
          return streamChat(c.since, onChatEvent);
        })
        .then(function () { c.busy = false; repaintChat(); if (firstTurn) loadChatSessions(); })
        .catch(function (err) { c.busy = false; c.error = errMessage(err); repaintChat(); });
    },
    chatCopy: function (i) {
      var m = state.chat.msgs[parseInt(i, 10)];
      if (!m || !m.text) return;
      // http:// 사내 주소에서는 navigator.clipboard 가 없다(보안 문맥 아님). 옛 방식으로.
      var done = function () { toast("답을 복사했습니다."); };
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(m.text).then(done, function () { copyFallback(m.text) && done(); });
      } else if (copyFallback(m.text)) done();
      else toast("복사하지 못했습니다. 드래그해서 복사하세요.", "bad");
    },
    chatAbort: function () {
      postForm("api/chat/abort", new FormData()).catch(function () {});
    },
    toggleIssues: function () {
      var p = document.getElementById("issuesPanel"), r = document.getElementById("issuesRail");
      if (!p || !r) {
        state.issuesCollapsed = !state.issuesCollapsed; state.exportMenuOpen = false; render(); return;
      }
      // 열린 메뉴만 제자리에서 정리한다. 패널을 접기 위해 전체 render 를 부르면
      // 아래 애니메이션보다 먼저 PDF iframe 이 다시 만들어진다.
      if (state.exportMenuOpen) {
        state.exportMenuOpen = false;
        var menu = document.getElementById("exportMenu");
        if (menu) menu.remove();
        var exportBtn = p.querySelector('[data-act="toggleExportMenu"]');
        if (exportBtn) {
          exportBtn.style.borderColor = "var(--line)";
          exportBtn.style.background = "var(--bg)";
          exportBtn.style.color = "var(--text-3)";
        }
      }

      // 연속 실행 때는 지금 화면에 보이는 폭에서 반대 방향으로 이어간다.
      var app = p.closest && p.closest(".dr-app");
      var zoom = p.currentCSSZoom || (app && parseFloat(app.style.zoom)) || 1;
      var pRect = p.getBoundingClientRect(), rRect = r.getBoundingClientRect();
      var pNow = pRect.width / zoom, rNow = rRect.width / zoom;
      var pMarginNow = pRect.width ? (parseFloat(window.getComputedStyle(p).marginRight) || 0) : 0;
      if (p._issuesAnimation) p._issuesAnimation.cancel();
      if (r._issuesAnimation) r._issuesAnimation.cancel();

      state.issuesCollapsed = !state.issuesCollapsed;
      var collapsing = state.issuesCollapsed;
      p.style.display = "flex";
      r.style.display = "flex";

      if (reduceMotion() || !p.animate || !r.animate) {
        p.style.display = collapsing ? "none" : "flex";
        r.style.display = collapsing ? "flex" : "none";
        return;
      }

      var pTarget = parseFloat(window.getComputedStyle(p).width) || 400;
      var pMarginTarget = parseFloat(window.getComputedStyle(p).marginRight) || 32;
      var rTarget = parseFloat(window.getComputedStyle(r).width) || 44;
      p.style.pointerEvents = "none";
      r.style.pointerEvents = "none";
      p._issuesAnimation = p.animate([
        { width: pNow + "px", marginRight: pMarginNow + "px", opacity: pNow ? 1 : 0,
          transform: pNow ? "translateX(0)" : "translateX(12px)" },
        { width: (collapsing ? 0 : pTarget) + "px",
          marginRight: (collapsing ? 0 : pMarginTarget) + "px",
          opacity: collapsing ? 0 : 1,
          transform: collapsing ? "translateX(12px)" : "translateX(0)" }
      ], { duration: 300, easing: "cubic-bezier(.16, 1, .3, 1)", fill: "both" });
      r._issuesAnimation = r.animate([
        { width: rNow + "px", opacity: rNow ? 1 : 0,
          transform: rNow ? "translateX(0)" : "translateX(12px)" },
        { width: (collapsing ? rTarget : 0) + "px", opacity: collapsing ? 1 : 0,
          transform: collapsing ? "translateX(0)" : "translateX(12px)" }
      ], { duration: 300, easing: "cubic-bezier(.16, 1, .3, 1)", fill: "both" });

      p._issuesAnimation.onfinish = function () {
        if (state.issuesCollapsed !== collapsing) return;
        p.style.display = collapsing ? "none" : "flex";
        r.style.display = collapsing ? "flex" : "none";
        p.style.pointerEvents = "";
        r.style.pointerEvents = "";
        var pa = p._issuesAnimation, ra = r._issuesAnimation;
        p._issuesAnimation = null; r._issuesAnimation = null;
        if (pa) pa.cancel();
        if (ra) ra.cancel();
      };
    },
    // 결과 화면(문서 + "검토 결과")을 화면 전체로. 덮는 대상이 문서 카드가 아니라
    // 2단 행 전체인 이유는 views.js의 resultsRowCss 주석에 있다.
    //
    // toggleIssues와 같은 이유로 render()를 쓰지 않는다 — 전체 렌더는 PDF iframe을
    // 재부착해 리로드시키므로 읽던 쪽을 잃는다. 행을 옮기지도 않고(제자리
    // position:fixed) 스타일만 통째로 갈아끼운다. 다만 바뀌기 전후의 화면상
    // 사각형은 기억했다가 FLIP transform 으로 이어, 카드가 제자리에서 자연스럽게
    // 펼쳐지는 것처럼 보이게 한다. PDF 노드는 여전히 한 번도 옮기지 않는다.
    toggleViewerFull: function () {
      var row = document.getElementById("results-row");
      var btn = document.getElementById("viewerFullBtn");
      state.viewerFull = !state.viewerFull;
      if (!row || !btn) { render(); return; }
      var first = row.getBoundingClientRect();
      if (row._viewerFullAnimation) row._viewerFullAnimation.cancel();
      row.style.cssText = _views.resultsRowCss(state.viewerFull);
      btn.innerHTML = state.viewerFull ? window.DR.ICONS.minimize : window.DR.ICONS.maximize;
      btn.title = state.viewerFull ? "원래 크기로 (Esc)" : "전체화면";

      var last = row.getBoundingClientRect();
      if (reduceMotion() || !row.animate || !first.width || !last.width) return;
      // getBoundingClientRect 는 실제 화면 px, transform 은 zoom 전의 CSS px 를 쓴다.
      // 앱 전체가 화면 높이에 맞춰 CSS zoom 되므로 이동량만 그 비율로 되돌린다.
      var app = row.closest && row.closest(".dr-app");
      var zoom = row.currentCSSZoom || (app && parseFloat(app.style.zoom)) || 1;
      var dx = (first.left - last.left) / zoom;
      var dy = (first.top - last.top) / zoom;
      var sx = first.width / last.width;
      var sy = first.height / last.height;
      row._viewerFullAnimation = row.animate([
        { transformOrigin: "top left", transform: "translate(" + dx + "px," + dy + "px) scale(" + sx + "," + sy + ")", opacity: .96 },
        { transformOrigin: "top left", transform: "translate(0,0) scale(1,1)", opacity: 1 }
      ], { duration: 300, easing: "cubic-bezier(.16, 1, .3, 1)" });
      row._viewerFullAnimation.onfinish = function () { row._viewerFullAnimation = null; };
    },
    // 검토 결과 헤더의 내보내기(⇩) 드롭다운. 다른 팝오버는 닫는다.
    toggleExportMenu: function () {
      state.exportMenuOpen = !state.exportMenuOpen;
      if (state.exportMenuOpen) state.exportOpenedAt = Date.now();
      state.profileMenuOpen = false; state.searchOpen = false;
      if (!repaintSingleIssues()) render();
    },
    deleteHistory: function (id) {
      if (!id || state.hbusy) return;
      var confirmedIds = state.confirmDelete && state.confirmDelete.ids;
      var fromResult = !!(state.confirmDelete && state.confirmDelete.fromResult);
      state.confirmDelete = null;   // 확인했으니 모달을 닫고 실제로 지운다
      state.herror = null;
      state.hbusy = true; render();
      // `*` 는 전체다. 건마다 부르고 다 끝나면 한 번만 목록을 다시 읽는다.
      var ids = id === "*"
        ? (confirmedIds || (state.historyPage ? state.historyPage.entries || [] : state.history || []).map(function (h) { return h.id; }))
        : [id];
      return Promise.all(ids.map(function (one) {
        return fetch("api/history/" + encodeURIComponent(one), { method: "DELETE" })
          .then(function (res) { return { id: one, deleted: res.ok }; })
          .catch(function () { return { id: one, deleted: false }; });
      })).then(function (results) {
        var deleted = results.filter(function (r) { return r.deleted; }).map(function (r) { return r.id; });
        var failed = results.length - deleted.length;
        state.hbusy = false;
        state.history = (state.history || []).filter(function (h) { return deleted.indexOf(h.id) < 0; });
        if (failed) {
          state.herror = (deleted.length ? deleted.length + "건 삭제 완료. " : "") +
            failed + "건은 삭제를 확인하지 못했습니다. 목록을 새로고침한 뒤 다시 확인해 주세요.";
          toast(state.herror, "err");
        } else if (deleted.length) {
          toast("기록 " + deleted.length + "건을 삭제했습니다");
        }
        // 결과 화면에서 지웠으면(askDeleteCurrent) 그 화면에 남을 수 없다 — 기록 목록으로.
        if (fromResult && deleted.indexOf(id) >= 0) {
          window.DOCREVIEW.historyId = null;
          actions.newReview("single");
          actions.setMode("history");
        }
        render();
        return loadHistory();
      });
    },
    // 원본 PDF에 형광펜을 얹어 받는다. 서버는 원본을 보관하지 않으므로 파일을
    // 다시 보낸다 — 검토 직후면 브라우저가 아직 들고 있어서 사용자는 아무것도
    // 안 해도 된다. 이력에서 연 검토는 원본이 없으니 다시 고르게 한다.
    // 문서 뷰어 줌. render() 를 부르지 않는다 — 전체 렌더는 뷰어를 다시 열어
    // 읽던 자리를 잃는다. pdfview 가 캔버스만 다시 그린다.
    zoom: function (arg) {
      window.DR.pdfview.zoom(arg === "fit" ? "fit" : parseFloat(arg));
    },
    // 형광펜 끄기. 지적이 수십 건이면 색이 겹쳐 원문이 안 보인다 — 끄고 읽다가
    // 다시 켠다. 전체 render()는 부르지 않는다. PDF 뷰어는 살아남더라도 오른쪽
    // 검토 결과 패널이 새 DOM으로 교체돼 읽던 카드의 스크롤이 맨 위로 돌아간다.
    // 바뀌는 것은 형광펜 레이어와 이 단추의 상태뿐이므로 둘만 제자리에서 고친다.
    toggleMarks: function () {
      state.marksOn = state.marksOn === false;
      window.DR.pdfview.setMarksVisible(state.marksOn);
      var buttons = document.querySelectorAll('[data-act="toggleMarks"]');
      for (var i = 0; i < buttons.length; i++) {
        var btn = buttons[i];
        btn.title = state.marksOn ? "형광펜 끄기" : "형광펜 켜기";
        btn.setAttribute("aria-pressed", state.marksOn ? "true" : "false");
        btn.style.background = state.marksOn ? "var(--accent-weak)" : "var(--bg)";
        btn.style.color = state.marksOn ? "var(--accent-ink)" : "var(--text-3)";
      }
    },
    retryOriginal: function () {
      var D = window.DOCREVIEW;
      if (!D.historyId || state.viewer.loadingOrig) return;
      state.viewer.originalError = null; state.viewer.originalGone = false;
      state.viewer.loadingOrig = true;
      render();
      return pullOriginal(D.historyId, (D.doc || {}).name || "document", D.doc);
    },
    downloadMarked: function () {
      closeExportMenu();              // 항목을 골랐으니 메뉴를 닫는다
      var D = window.DOCREVIEW;
      var base = _H.exportStem((D.doc && D.doc.name) || "document", D.historyAt);
      if (state.annot.blob) { downloadBlob(base + ".marked.pdf", state.annot.blob); return; }
      var f = state.files.single;
      if (f && f.file) { doAnnotate(f.file, function () { downloadBlob(base + ".marked.pdf", state.annot.blob); }); return; }
      state.annot = Object.assign({}, state.annot, { msg: "원본 PDF를 다시 선택하세요. (서버는 원본을 보관하지 않습니다)" });
      render();
    },
    exportAs: function (kind) {
      closeExportMenu();
      var base = _H.exportStem(window.DOCREVIEW.doc.name, window.DOCREVIEW.historyAt);
      // 본문은 views.js 가 만든다 — 여기는 내려받기 통로만 진다. 넷 다 지난번
      // 지적에 대한 검토자의 판정을 함께 싣는다(반영 확인이 회신서의 알맹이다).
      if (kind === "html") {
        // 문서 본문 + 모든 지적이 박힌 자기완결 HTML. 브라우저에서 인쇄하면 PDF가 된다.
        download(base + ".review.html", _views.reviewHtml(), "text/html");
      } else if (kind === "json") {
        download(base + ".review.json", _views.reviewJson(), "application/json");
      } else if (kind === "md") {
        download(base + ".review.md", _views.reviewMd(), "text/markdown");
      } else {
        download(base + ".review.csv", "﻿" + _views.reviewCsv(), "text/csv");
      }
    },

    // ---- 체크리스트 라이브러리 --------------------------------------------
    // quiet: 검색창을 열면서 부르는 경우다. 목록이 도착했다고 화면 전체를 다시
    // 그리면 방금 연 검색 뒤로 홈 애니메이션이 처음부터 다시 돈다 — 결과 목록만
    // 갈아끼운다.
    loadChecklists: function (quiet) {
      if (!servedOverHttp()) return;
      // 기준 관리 목록은 /api/criteria 로 그린다. 라이브러리 캐시 갱신 때문에
      // 그 목록과 페이지 전환을 다시 시작하지 않는다.
      var done = quiet && quiet.background ? function () {} : quiet ? renderSearchResults : render;
      fetch("api/checklists").then(function (r) { return r.json(); })
        .then(function (b) { state.clib.list = b.checklists || []; done(); })
        .catch(function (e) { state.clib.error = errMessage(e); done(); });
    },

    // 목록에서 눌러 항목을 들여다본다. 열을 틀리게 골라 등록한 것도 여기서 드러난다.
    //
    // 화면도 같이 옮긴다 — 검색 결과에서 바로 부르면 상세만 채워 놓고 다른 화면에
    // 머물러, 눌러도 아무 일이 없는 것처럼 보인다.
    openChecklist: function (id) {
      state.mode = "checklists";
      state.searchOpen = false;
      state.clib.detail = null; state.cdraft = null;
      state.clayers.q = ""; state.clayers.how = ""; state.clayers.scope = "추가";
      state.clayers.selected = id + "|0";
      if (!state.clayers.list) actions.loadCriteriaLayers();
      else render();
    },
    closeChecklist: function () { state.clib.detail = null; render(); },

    deleteChecklist: function (id) {
      if (state.clib.deleting) return;
      state.confirmChecklist = null; state.clib.deleting = true; state.clib.error = null; render();
      return fetch("api/checklists/" + encodeURIComponent(id), { method: "DELETE" })
        .then(function (res) {
          if (!res.ok) throw new Error("추가 기준을 삭제하지 못했습니다 (" + res.status + ")");
          state.clib.deleting = false;
          state.clayers.selected = null; state.clayers.list = null;
          actions.loadChecklists(); actions.loadCriteriaLayers();
        })
        .catch(function (e) { state.clib.deleting = false; state.clib.error = errMessage(e); render(); });
    },

    // ---- 체크 흐름(등록된 체크리스트를 판정·이유로 채우기) -------------------
    // 라이브러리 행의 "검토 시작" — 체크리스트 채우기를 자동 검토와 완전히
    // 떼어 독립 화면(mode "checklistrun")으로 곧장 연다.
    startChecklistRun: function (id) {
      if (!id) return;
      fetch("api/checklists/" + encodeURIComponent(id))
        .then(function (r) { return r.json(); })
        .then(function (c) {
          state.crun = { checklist: c, results: {}, saving: false, error: null,
                         from: "checklists", documentName: "" };
          state.runChecklistId = id;
          state.navRecordId = "cl-" + id;   // 뒤로가기가 이 판정지로 돌아오게
          state.mode = "checklistrun";
          render();
        })
        .catch(function (e) { state.crun.error = errMessage(e); render(); });
    },

    // 인자 형식 "v|항목위치인덱스|판정값". data-arg 하나로 둘을 실어 보낸다.
    // no 가 아니라 배열 위치(index)로 키잉한다 — no 는 선택 안 하면 전부 ""
    // 이고 구간별 재시작으로 겹칠 수 있어(| 도 섞일 수 있어), 위치만이 항목을
    // 유일하게 가리킨다.
    setVerdict: function (arg) {
      var p = String(arg).split("|");
      var idx = p[1];
      var cur = state.crun.results[idx] || { verdict: null, reason: "" };
      cur.verdict = p[2] || null;
      state.crun.results[idx] = cur;
      state.crun.savedAt = 0;          // 고치는 순간 "저장됨"은 거짓말이 된다
      render();
    },

    setReason: function (idx, text) {
      var cur = state.crun.results[idx] || { verdict: null, reason: "" };
      cur.reason = text;
      state.crun.results[idx] = cur;   // 입력 중에는 render 하지 않는다(포커스 유지)
      state.crun.savedAt = 0;
    },

    saveChecklistRun: function () {
      var c = state.crun.checklist;
      if (!c) return;
      state.crun.saving = true; state.crun.savedAt = 0; render();
      var fd = new FormData();
      // 독립 화면 자체에서 받은 문서명을 우선한다 — 자동 검토를 거치지 않고
      // 라이브러리/기록에서 곧장 들어온 경우 files.single 은 애초에 비어 있다.
      fd.append("document_name", state.crun.documentName || (state.files.single && state.files.single.name) || "");
      fd.append("results", JSON.stringify(state.crun.results));
      postForm("api/checklists/" + encodeURIComponent(c.id) + "/run", fd)
        // 저장이 성공해도 화면이 아무 말 없으면 검토자는 저장됐는지 모른다 —
        // "저장됨"을 띄우고, 다시 고치는 순간 지운다(setVerdict/setReason).
        .then(function (out) {
          state.crun.saving = false; state.crun.savedAt = Date.now();
          var h = out && out.history;
          if (h && h.saved !== false && h.id) state.homeFreshHistoryId = h.id;
          // 홈으로 돌아갔을 때 방금 저장한 체크리스트 기록이 목록에 있어야 강조할
          // 수 있다. quiet라 현재 판정 화면은 다시 그리지 않는다.
          loadHistory(true);
          render();
        })
        .catch(function (e) {
          state.crun.saving = false; state.crun.error = errMessage(e); render();
        });
    },

    exportChecklistCsv: function () {
      var c = state.crun.checklist;
      if (!c) return;
      var fd = new FormData();
      fd.append("results", JSON.stringify(state.crun.results));
      fetch("api/checklists/" + encodeURIComponent(c.id) + "/csv",
            { method: "POST", body: fd })
        .then(function (r) { return r.blob(); })
        .then(function (b) { downloadBlob(c.name + ".checklist.csv", b); })
        .catch(function (e) { state.crun.error = errMessage(e); render(); });
    }
  };

  // ---- 뷰 레이어(views.js) 재바인딩 --------------------------------------
  var _views = window.DR.views({ state: state, props: props, render: render, backend: _be });
  var renderVals = _views.renderVals, view = _views.view,
      selectedSection = _views.selectedSection, reviewHtml = _views.reviewHtml,
      doAnnotate = _views.doAnnotate,
      findingCardClass = _views.findingCardClass, findingCardInner = _views.findingCardInner,
      numberChip = _views.numberChip;
  var lastScrolled = null;

  // 비교 결과에서 한 항목을 고르거나 판정할 때 앱 전체를 다시 만들지 않는다.
  // 전체 render는 헤더·작업대까지 모두 교체해 새로고침처럼 보이고, 대기열과
  // 판정 카드의 스크롤도 끊는다. 새 뷰를 메모리에서 만든 뒤 필요한 조각만 옮긴다.
  function repaintCompareTrace(opts) {
    opts = opts || {};
    var workbench = document.getElementById("traceWorkbench");
    if (!workbench) return false;
    var oldQueue = workbench.querySelector(".trace-queue-list");
    var oldDetail = workbench.querySelector(".trace-detail");
    var queueTop = oldQueue ? oldQueue.scrollTop : 0;
    var detailTop = oldDetail ? oldDetail.scrollTop : 0;

    var snapshot = document.createElement("div");
    snapshot.innerHTML = view(renderVals());
    var freshWorkbench = snapshot.querySelector("#traceWorkbench");
    if (!freshWorkbench) return false;
    workbench.innerHTML = freshWorkbench.innerHTML;

    var newQueue = workbench.querySelector(".trace-queue-list");
    if (newQueue) newQueue.scrollTop = queueTop;
    if (opts.keepDetail) {
      var newDetail = workbench.querySelector(".trace-detail");
      if (newDetail) newDetail.scrollTop = detailTop;
    }
    if (opts.chrome) {
      var currentStatus = document.getElementById("compareStatusBar");
      var freshStatus = snapshot.querySelector("#compareStatusBar");
      if (currentStatus && freshStatus) currentStatus.outerHTML = freshStatus.outerHTML;
      var currentMeta = document.getElementById("traceToolbarMeta");
      var freshMeta = snapshot.querySelector("#traceToolbarMeta");
      if (currentMeta && freshMeta) currentMeta.outerHTML = freshMeta.outerHTML;
    }
    return true;
  }

  // 검토 기록 필터는 목록 표만 바꾼다. 헤더와 사이드바까지 교체하면 단순 필터가
  // 페이지 이동처럼 보여 데이터 도구의 즉각적인 탐색 감각이 사라진다.
  function closeHistoryActions(restoreFocus) {
    document.querySelectorAll('.history-actions-menu:not([hidden])').forEach(function (menu) {
      menu.hidden = true;
      var button = menu.parentElement.querySelector('.history-more-button');
      if (button) {
        button.setAttribute('aria-expanded', 'false');
        if (restoreFocus) button.focus({ preventScroll: true });
      }
    });
  }

  var historySearchTimer = null;
  var historyRecordFocus = null;
  function repaintHistoryRecords() {
    var current = document.getElementById("historyRecords");
    if (!current) return false;
    var active = document.activeElement, act = active && active.getAttribute("data-act");
    var arg = active && active.getAttribute("data-arg"), label = active && active.textContent;
    if (act && current.contains(active)) historyRecordFocus = { act: act, arg: arg, label: label };
    else if (active && active !== document.body) historyRecordFocus = null;
    var snapshot = document.createElement("div");
    snapshot.innerHTML = view(renderVals());
    var fresh = snapshot.querySelector("#historyRecords");
    if (!fresh) return false;
    current.outerHTML = fresh.outerHTML;
    ["historySearchScope", "historyBulkActions"].forEach(function (id) {
      var old = document.getElementById(id), next = snapshot.querySelector("#" + id);
      if (old && next) old.innerHTML = next.innerHTML;
    });
    if (historyRecordFocus) {
      var focus = historyRecordFocus;
      var match = Array.prototype.filter.call(document.querySelectorAll("#historyRecords button[data-act]"), function (el) {
        return el.getAttribute("data-act") === focus.act &&
          (focus.act === "setHistoryPage" ? el.textContent === focus.label : el.getAttribute("data-arg") === focus.arg);
      })[0];
      // 로딩 중 비활성화된 페이지 버튼은 응답 뒤 초점을 돌려준다.
      // 마지막 페이지에서는 이동 가능한 반대 버튼을 사용한다.
      if (focus.act === "setHistoryPage" && !(state.historyPage && state.historyPage.busy) && (!match || match.disabled)) {
        match = document.querySelector('#historyRecords [data-act="setHistoryPage"]:not(:disabled)');
      }
      if (match && !match.disabled) match.focus({ preventScroll: true });
      if (!(state.historyPage && state.historyPage.busy)) historyRecordFocus = null;
    }
    return true;
  }

  // 기준 층·세부 항목·검사 방식 필터는 기준 목록 안에서만 바꾼다. 행 하나를
  // 펴는데 페이지 헤더와 추가 체크리스트까지 다시 만들면 새로고침처럼 보이고,
  // 긴 기준 목록을 읽던 위치도 끊긴다. 검색 입력은 별도 입력 핸들러가 캐럿을
  // 보존하므로 이 함수는 클릭으로 생기는 목록 상태 변화에만 쓴다.
  function repaintCriteriaLayers() {
    var records = document.getElementById("criteriaCatalogRecords");
    if (records) {
      var active = document.activeElement;
      var act = active && active.getAttribute("data-act"), arg = active && active.getAttribute("data-arg");
      var scroll = records.querySelector("[data-scroll]");
      var top = scroll ? scroll.scrollTop : 0;
      var parts = _views.criteriaWorkspaceParts();
      var howSelect = document.getElementById("criteriaHow");
      if (howSelect && howSelect.getAttribute("data-value") !== (state.clayers.how || "all"))
        howSelect.outerHTML = _views.criteriaHowSelect();
      // 갱신 문구만 바뀌었을 때 동일한 표·상세 DOM은 유지한다.
      function replaceChanged(el, html, key) {
        key = key === undefined ? html : key;
        if (!el || el._criteriaHTML === key) return;
        var template = document.createElement("template");
        template.innerHTML = html;
        if (el.innerHTML !== template.innerHTML) el.replaceChildren(template.content);
        el._criteriaHTML = key;
      }
      var body = document.getElementById("criteriaCatalogBody");
      replaceChanged(body, parts.body);
      if (body) body.setAttribute("aria-busy", String(!!state.clayers.busy));
      replaceChanged(document.getElementById("criteriaCatalogStatus"), parts.summary);
      replaceChanged(document.getElementById("criteriaScopeTabs"), parts.tabs);
      var inspector = document.getElementById("criteriaInspector");
      var detailTop = inspector ? inspector.scrollTop : 0;
      replaceChanged(inspector, parts.detail, parts.detailKey);
      if (inspector) inspector.scrollTop = detailTop;
      scroll = records.querySelector("[data-scroll]");
      if (scroll) scroll.scrollTop = top;
      if (act) Array.prototype.forEach.call(document.querySelectorAll("[data-act]"), function (el) {
        if (el.getAttribute("data-act") === act && el.getAttribute("data-arg") === arg) el.focus({ preventScroll: true });
      });
      return true;
    }
    var current = document.getElementById("criteriaLayersRecords");
    if (!current) return false;
    var snapshot = document.createElement("div");
    snapshot.innerHTML = view(renderVals());
    var fresh = snapshot.querySelector("#criteriaLayersRecords");
    if (!fresh) return false;
    current.outerHTML = fresh.outerHTML;
    return true;
  }

  // 체크리스트 "이유" 입력을 두 가지 위협에서 지킨다. (1) 자동 검토는 몇 분간
  // SSE로 stage 이벤트를 계속 보내는데(api.js onReviewEvent의 "stage" 분기),
  // 그때마다 render()를 부른다 — 결과 화면에서 "이유"를 타이핑하는 도중에도
  // 이게 계속 들어온다. innerHTML을 통째로 갈아엎으면 그 input DOM 노드가
  // 아예 새로 만들어지므로 포커스·캐럿이 날아간다. (2) 한글 등 IME 조합
  // 중엔 아직 커밋되지 않은 글자가 DOM에만 있을 뿐 어디에도 값으로 남지
  // 않는다 — 그 상태에서 노드가 죽으면 그 글자는 그냥 사라진다(input
  // 이벤트로 넘어오기도 전에 노드가 죽는다). setReason이 render를 부르지
  // 않는 것만으론 부족하다 — 문제는 "남이" 부르는 render다.
  //
  // 예전엔 포커스가 [data-reason]에 있기만 해도 render() 전체를 건너뛰었다.
  // 그런데 검토 화면의 다른 버튼(검증 결과·저장·CSV 내보내기 등)을 누르는
  // 것도 mousedown → blur → focusout을 먼저 일으켜 클릭보다 먼저 렌더를
  // 끼워 넣는다 — 클릭 델리게이션(아래 document.addEventListener("click", ...))
  // 이 data-act를 찾는 시점엔 원래 누른 노드가 이미 통째로 새 노드로 바뀐
  // 뒤라 클릭이 그냥 씹혔다. 게다가 reasonComposing이 compositionend로만
  // 풀리는데, 일부 IME/브라우저 조합은 이 이벤트를 아예 안 보내는 경우가
  // 있어(문서화된 known issue) 그러면 render()가 앱 전체에서 영구히 멈췄다.
  //
  // 그래서 (1)번은 "건너뛰기"가 아니라 "캡처 후 복원"으로 바꾼다 — render()
  // 안, innerHTML을 갈아엎기 직전에 포커스된 입력의 data-reason 값과 캐럿
  // 위치를 기억해뒀다가 다시 그린 뒤 같은 input을 찾아 되살린다. data-scroll
  // 컨테이너의 스크롤 위치를 기억했다 되살리는 것과 정확히 같은 모양이다.
  // 이러면 클릭은 원래 노드가 살아있는 동안 델리게이션에 잡히고, 그 뒤
  // render가 일어나도 입력은 멀쩡히 이어진다.
  //
  // (2)번(진짜 조합 중)만은 여전히 render를 건너뛴다 — 조합 중인 글자는
  // 값 자체가 아직 확정되지 않아 캡처해서 복원할 수가 없기 때문이다. 이때
  // 건너뛴 렌더는 reasonRenderPending에 표시해뒀다가 compositionend에서
  // 몰아 그린다.
  //
  // watchdog: compositionend가 끝내 안 오는 브라우저/IME에 대비해, 조합
  // 시작 후 일정 시간이 지나도 종료 신호가 없으면 강제로 reasonComposing을
  // 풀고 밀린 렌더를 흘려보낸다(아래 boot()의 compositionstart 리스너 참고).
  // 이게 없으면 그 브라우저에서는 새로고침 전까지 앱이 영원히 멈춘다.
  //
  // focusout에서는 절대 몰아 그리지 않는다 — 이전 코드의 핵심 버그였다. 다른
  // 컨트롤을 누르면 그 클릭이 오기 "직전"에 focusout이 먼저 발생하므로,
  // 거기서 렌더를 흘려보내면 방금 누른 버튼의 DOM 노드가 클릭이 델리게이션에
  // 닿기도 전에 사라진다 — 저장 버튼이 조용히 안 눌리던 원인이 바로 이것
  // 이었다. 몰아 그리는 시점은 오직 compositionend(정상 종료)와 watchdog
  // (비정상 미종료 대비)뿐이다.
  var reasonComposing = false;
  var reasonRenderPending = false;
  // 부팅 직후 잠깐 render 를 모아 그린다. 설정·이력·작업·기준 응답이 수십 ms
  // 간격으로 도착해 홈 전체를 그때마다 다시 그렸다(2026-09-04 실측: 860·921·971ms).
  // 창(renderHoldMs) 안에 온 요청은 한 번으로 합친다. 0 이면 즉시 그린다.
  var renderHoldMs = 0, renderHoldTimer = null, renderHoldBypass = false;
  var reasonComposeWatchdog = null;    // compositionend 유실 대비 타이머 id

  // pdf.js 뷰어에 지금 올라간 base blob. 문서가 바뀔 때만 다시 연다(syncViewer 참고).
  // iframe 시절의 pdfFrame/pdfSrcUrl/pdfLastKey 캐시를 이 하나가 대신한다 — pdf.js는
  // canvas라 노드를 DOM에서 옮겨도 리로드되지 않으므로 복잡한 키가 필요 없다.
  var viewerFor = null;


  // 뷰어가 지금 무엇을 그려야 하나. 단일 검토와 의뢰 건이 같은 부품(render-pdf ·
  // locate · pdfview)을 쓰므로 **출처만** 갈라 준다 — 부품을 복사하면 한쪽만 고쳐지는
  // 버그가 생긴다.
  // 뷰어가 볼 문서. historyId 를 함께 낸다 — 서버가 그 원본과 변환본을 이미
  // 갖고 있으므로, 있으면 브라우저가 파일을 올릴 필요가 없다(왕복 2MB × 2 와
  // LibreOffice 7초가 사라진다). 없으면(검토 직후·미저장) 예전처럼 올린다.
  function viewerSource() {
    if (state.mode === "case" && state.kase.step === "results" && state.kase.view) {
      var kv = state.kase.view;
      return { file: kv.file, name: kv.file ? kv.file.name : "",
               findings: kv.findings || [], images: [], single: false };
    }
    if (state.mode === "compare" && state.cstep === "results" && state.cview) {
      var cv = state.cview;
      // 평가 초안 창(side "E")은 초안 기록의 원본(자리 없음)이다.
      var isE = cv.side === "E";
      return { file: cv.file, name: cv.name || "", findings: cv.findings || [],
               images: [], single: false,
               historyId: isE ? (state.evalv.historyId || "")
                              : (((window.DOCREVIEW.compare || {}).history || {}).id || ""),
               slot: isE ? "" : (cv.side || "") };
    }
    if (state.mode === "single" && state.screen === "results") {
      var f = state.files.single;
      return { file: f && f.file, name: (window.DOCREVIEW.doc || {}).name || "",
               findings: window.DOCREVIEW.findings || [],
               images: window.DOCREVIEW.images || [], single: true,
               historyId: (window.DOCREVIEW.history || {}).id || "", slot: "" };
    }
    return null;
  }

  function maybeConvert() {
    var v = state.viewer;
    var src = viewerSource();
    if (!src) return;
    if (v.origUrl || v.converting || v.convertError) return;   // 이미 준비/진행/실패
    var f = { file: src.file };
    // 브라우저에 파일이 없어도 서버가 이력 원본을 갖고 있으면 열 수 있다.
    if (!f.file && !src.historyId) return;                     // 텍스트 폴백
    var type = String((src.name.split(".").pop() || "")).toUpperCase();
    if (type === "PDF") {                                       // 변환 불필요
      // 원본이 PDF 면 서버에 물어볼 것이 없다. 다만 이력에서 열면 내려받는 중일
      // 수 있다 — 그때는 기다린다(없는 blob 으로 URL 을 만들면 뷰어가 죽는다).
      if (!f.file) return;
      v.baseBlob = f.file;
      v.origUrl = URL.createObjectURL(f.file);
      return;
    }
    // docx·hwp·hwpx는 LibreOffice로 PDF로 변환해 뷰어에 띄운다(hwp/hwpx는 H2Orestart
    // 필터로 원본을 직접 변환 — 진짜 레이아웃). 그 밖은 텍스트 폴백.
    if (type !== "DOCX" && type !== "HWPX" && type !== "HWP") return;
    // render() 를 부르지 않는다 — 이 함수는 render() 의 첫머리에서 돌아서, 지금
    // 그리는 그 렌더가 곧 준비 중 상태를 그린다. 예전엔 끝에서 돌며 render() 를
    // 다시 불러, 첫 프레임에 텍스트 재현본이 잠깐 떴다 사라졌다(2026-09-04).
    v.converting = true;
    var fd = new FormData();
    // 서버가 원본을 갖고 있으면 id 만 보낸다 — 변환본이 캐시돼 있으면 변환조차
    // 안 하고 바로 온다. 없으면(검토 직후) 예전처럼 파일을 올린다.
    if (src.historyId) {
      fd.append("history_id", src.historyId);
      fd.append("slot", src.slot || "");
    } else {
      fd.append("file", f.file);
    }
    fetch("api/render-pdf", { method: "POST", body: fd })
      .then(function (res) {
        if (!res.ok) {
          return res.text().then(function (b) {
            var d = b; try { d = JSON.parse(b).detail || b; } catch (e) { /* 평문 */ }
            throw new Error(String(d).slice(0, 160));
          });
        }
        if (state.viewer === v) v.pdfSha256 = res.headers.get("X-DocSuree-PDF-SHA256") || "";
        return res.blob();
      })
      .then(function (blob) {
        if (state.viewer !== v) return;   // 이전 문서 변환이 늦게 끝나도 새 뷰어를 덮지 않는다.
        state.viewer.baseBlob = blob;
        state.viewer.origUrl = URL.createObjectURL(blob);
        state.viewer.converting = false;
        render();   // baseBlob 이 새 blob이라 syncViewer 가 자동으로 다시 연다
      })
      .catch(function (e) {
        if (state.viewer !== v) return;
        state.viewer.converting = false;
        state.viewer.convertError = "원본을 PDF로 준비하지 못했습니다: " + e.message;
        render();
      });
  }

  // 결과 화면의 마운트에 pdf.js 뷰어를 세운다. 문서가 바뀔 때만 다시 연다(viewerFor
  // 위 선언 참고) — 전체 렌더마다 열면 읽던 자리가 날아간다. render() 끝에서 부른다.
  // 뷰어에 칠할 것. **탭에 따라 다르다.**
  //
  // `반영 확인` 탭은 지난 지적을 다루는 자리다. 거기서 이번 검토 지적을 통째로
  // 칠하면 무엇이 지난 지적이고 무엇이 새 것인지 문서 위에서 안 갈린다. 그래서
  // 지난 지적 중 **아직 미반영으로 둔 것**만 칠한다 — 검토자가 판정을 바꾸면
  // 칠이 따라 바뀐다. "판정을 바꾸면 뭐가 달라지나"에 대한 답이 이것이다.
  //
  // `안 보임` 은 이번 문서에 짝이 없어 칠할 자리도 없다(matchId 가 빈다).
  function markItems() {
    var all = state.markItems || [];
    // 원문 창은 **지금 보는 요건 하나**만 칠한다. 번호도 안 단다 — 표의 행마다
    // 번호를 달아 문서 전체를 칠하면 "왜 형광펜이 있고 번호가 붙었지"가 된다
    // (2026-09-08 피드백). 행을 옮기면 그 행 것으로 바뀐다(openCompareDoc).
    if (state.popup && state.cview) {
      var focus = state.cview.focus || "";
      return all.filter(function (it) { return it.id === focus; })
        .map(function (it) {
          // 번호는 좌표(m.no)에도 박혀 있다 — pdfview.setMarks 가 그쪽을 우선하므로 둘 다 뗀다.
          var marks = (it.marks || []).map(function (m) { return Object.assign({}, m, { no: "" }); });
          return { id: it.id, no: "", marks: marks, message: it.message, sev: it.sev };
        });
    }
    // 검토자가 뺀 지적의 형광펜은 안 칠한다 — 카드가 없는데 문서만 노랗면 "이게 뭐지"가 된다.
    var hidden = _views.hiddenFindingIds ? _views.hiddenFindingIds() : {};
    all = all.filter(function (it) { return !hidden[it.id]; });
    // 자리를 확정 못 한 지적을 골랐으면 후보들을 점선으로 얹는다(번호 없음).
    if (state.cand && state.cand.id === state.selected) {
      all = all.concat([{ id: state.cand.id, no: "", sev: "candidate", message: state.cand.message,
        // 후보 하나가 여러 줄이면 줄마다 상자 하나(rects). 옛 좌표(rect 만)는 그대로 둔다.
        marks: state.cand.list.reduce(function (acc, c) {
          return acc.concat((c.rects || [c.rect]).map(function (r) { return { page: c.page, rect: r, no: "" }; }));
        }, []) }]);
    }
    if (_views.reviewTabNow() !== "lineage") return all;
    var keep = _views.lineageMarkIds();
    if (!keep) return all;
    // 색도 바꾼다. 이 탭에서 칠해진 것은 전부 "지난 지적인데 아직 미반영" 하나라
    // 심각도로 갈라 칠하면 두 탭이 같은 것을 말하는 것처럼 보인다.
    return all.filter(function (it) { return keep[it.id]; })
      .map(function (it) {
        return { id: it.id, no: it.no, marks: it.marks, message: it.message,
                 sev: "past" };
      });
  }

  // 판정을 바꾸면 달라지는 것은 셈 두 군데다 — 반영 확인 요약 줄과 탭 이름.
  // 통째로 다시 그리지 않고 글자만 갈아끼운다(뷰어를 안 건드리려고).
  // 반영 확인 패널만 다시 그린다. 통째로 render() 하면 pdf-mount 가 새로 만들어져
  // 뷰어가 PDF 를 다시 연다(syncViewer).
  function repaintLineagePanel() {
    var el = document.getElementById("lineagePanel");
    if (!el) return;
    var html = _views.lineagePanelHtml();
    if (html) el.outerHTML = html;
  }

  function repaintLineageCounts() {
    var L = _views.lineageView();
    if (!L) return;
    var sum = document.getElementById("lineageSummary");
    if (sum) sum.textContent = _views.lineageSummaryText(L);
    var tab = document.getElementById("tab-lineage");
    if (tab) tab.textContent = _views.lineageTabLabel(L);
  }

  function paintMarks() {
    if (!state.markItems || !window.DR.pdfview.isOpen()) return;
    window.DR.pdfview.setMarks(markItems(), function (id) {
      if (state.markSingle) actions.select(id);                // 형광펜 → 카드
    });
  }

  // 보고 있는 쪽·배율을 도구줄에 적는다. render 를 안 부른다 — 스크롤마다 통째로
  // 그리면 화면이 쉼 없이 흔들린다. 글자 하나만 갈아끼운다.
  // 내보내기 메뉴만 닫는다. render() 를 부르면 화면 전체가 다시 그려져 검토 결과
  // 패널까지 새로 그린다 — 내려받기 한 번에 화면이 새로고침된 것처럼 보였다.
  // 닫을 것은 팝오버 하나뿐이라 그 노드만 지운다(repaintCard 와 같은 방식).
  // 홈이 "무엇으로 재나"를 말하려면 진짜 기준이 있어야 한다. 서버 설정 세 줄로는
  // 못 한다 — 검토를 이끄는 것은 presets/criteria 의 공통·팀 기준이다.
  // 한 번만 읽고 팀이 바뀌면 다시 읽는다.
  // loadHistory 와 같은 이유로 프로미스를 돌려준다 — 로그인 스플래시가 기다린다.
  function loadHomeCriteria() {
    if (!servedOverHttp()) return Promise.resolve();
    var team = (state.user && state.user.team) || "";
    if (state.homeCriteria && state.homeCriteria.team === team) return Promise.resolve();
    return fetchCriteriaLayers(team)
      .then(function (b) {
        state.homeCriteria = { team: team, layers: b.layers || [] };
        // 홈만 이 값을 보여준다. 다른 화면(특히 로그인)을 다시 그리면 그 화면이
        // DOM 에 들고 있던 입력·버튼 상태가 날아간다 — api.js onAuthScreen 주석.
        if (state.mode === "home") render();
      })
      .catch(function () { /* 못 읽으면 홈이 안내 문구를 대신 낸다 */ });
  }

  // ---- 토스트 -------------------------------------------------------------
  // 비동기 결과(복사됨·삭제됨·저장 실패)를 화면 자리 안 뺏고 한 줄로 알린다.
  // 호스트는 #root 밖(body 직속)이라 render() 가 못 지운다 — boot 이 만든다.
  // 실패는 더 오래 머문다: 사라진 실패 알림은 "됐다"로 읽힌다.
  function toast(msg, tone) {
    var host = document.getElementById("toast-host");
    if (!host) return;
    // 결과 화면에서는 **문서 뷰어 위쪽 가운데**에 띄운다(2026-09-15 지적) — 검토자의
    // 눈이 거기 있다. 뷰어가 없는 화면은 CSS 기본 자리(헤더 아래 가운데).
    var viewer = document.getElementById("pdf-mount") || document.getElementById("doc-scroll");
    if (viewer && viewer.getBoundingClientRect) {
      var r = viewer.getBoundingClientRect();
      host.style.left = Math.round(r.left + r.width / 2) + "px";
      host.style.top = Math.round(r.top + 12) + "px";
    } else {
      host.style.left = ""; host.style.top = "";
    }
    var el = document.createElement("div");
    el.className = "toast" + (tone === "err" ? " is-err" : "");
    el.textContent = msg;
    host.appendChild(el);
    setTimeout(function () {
      el.classList.add("is-leaving");
      setTimeout(function () { el.remove(); }, 220);
    }, tone === "err" ? 5200 : 3200);
  }

  function closeExportMenu() {
    state.exportMenuOpen = false;
    var menu = document.getElementById("exportMenu");
    if (menu) menu.remove();
    var btn = document.querySelector('[data-act="toggleExportMenu"]');
    if (btn) btn.classList.remove("is-active");
  }

  function paintWhere(at) {
    var el = document.getElementById("pdf-where");
    if (!el) return;
    at = at || window.DR.pdfview.viewState();
    el.textContent = at ? at.page + " / " + at.pages + "쪽" : "";
    // 배율은 확대·축소 묶음 가운데에 — 누르면 폭 맞춤이다.
    var z = document.getElementById("pdf-zoom");
    if (z) z.textContent = at ? at.pct + "%" : "";
  }

  function syncViewer() {
    var mount = document.getElementById("pdf-mount");
    if (!mount) {                                  // 뷰어 화면이 아니거나 텍스트 폴백
      if (window.DR.pdfview.isOpen()) { window.DR.pdfview.close(); viewerFor = null; }
      return;
    }
    var blob = state.viewer.baseBlob;              // maybeConvert 가 채운다(원본/변환본)
    if (!blob) return;
    if (viewerFor === blob && mount.firstChild) return;   // 같은 문서 — 다시 안 연다
    viewerFor = blob;
    state.marks = null;
    mount.innerHTML = "";
    // 보고 있는 쪽·배율을 도구줄에 적는다. render 를 안 부른다 — 스크롤마다
    // 통째로 그리면 화면이 쉼 없이 흔들린다. 글자 하나만 갈아끼운다.
    window.DR.pdfview.onViewChange(paintWhere);
    window.DR.pdfview.open(mount, blob, {
      onError: function (msg) { state.viewer.convertError = msg; render(); },
    }).then(function () { loadMarks(blob); });
  }

  // 지적 좌표를 받아 형광펜을 얹는다. 표시본을 굽는 것과 달리 PDF 를 만들지 않아
  // 훨씬 싸고, 화면은 원본을 그대로 그린다 — 요약 페이지 오프셋이 아예 없다.
  function loadMarks(blob) {
    var src = viewerSource() || { name: "document", findings: [], images: [], single: true };
    var name = (src.name || "document").replace(/\.[^.]+$/, "") + ".pdf";
    var fd = new FormData();
    // 서버가 같은 PDF 를 이미 갖고 있으면(이력) 올리지 않는다 — 방금 받은 것을
    // 도로 올려보내던 자리다.
    if (src.historyId) {
      fd.append("history_id", src.historyId);
      fd.append("slot", src.slot || "");
    } else {
      fd.append("file", new File([blob], name, { type: "application/pdf" }));
    }
    fd.append("findings", JSON.stringify(src.findings));
    // 그림 설명에서 나온 지적은 인용문으로 위치를 찾을 수 없다(그 설명은 PDF
    // 텍스트 레이어에 없다). 그림의 번호·크기를 함께 주면 서버가 그림 자체를 짚는다.
    fd.append("images", JSON.stringify(src.images));
    fetch("api/locate", { method: "POST", body: fd })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (body) {
        if (!body || state.viewer.baseBlob !== blob) return;   // 그새 문서가 바뀌었다
        if (state.viewer.pdfSha256 && body.pdf_sha256 !== state.viewer.pdfSha256) {
          toast("표시된 PDF와 위치 정보가 달라 하이라이트를 적용하지 않았습니다. 문서를 다시 열어 주세요.", "err");
          return;
        }
        state.marks = body;
        // 형광펜 클릭 팝업에 지적 문구를 띄우려면 좌표에 message 를 실어 보낸다
        // (locate 응답엔 좌표만 있다). id 로 findings 에서 가져온다.
        var byId = {};
        src.findings.forEach(function (f) { byId[f.id] = f; });
        var items = (body.items || []).map(function (it) {
          var f = byId[it.id] || {};
          return { id: it.id, no: it.no, sev: it.sev, marks: it.marks,
                   message: f.message || "" };
        });
        state.markItems = items;                   // 탭에 따라 걸러 칠한다
        state.markSingle = !!src.single;
        paintMarks();
        if (!src.single) {
          // 폴더 검토 카드의 번호 자리만 갱신한다. render()를 부르면 pdf-mount가
          // 교체되어 방금 연 PDF를 다시 읽으므로 문서 뷰어는 그대로 둔다.
          var byNo = {};
          (body.items || []).forEach(function (it) { byNo[it.id] = it.no || ""; });
          document.querySelectorAll("[data-case-number]").forEach(function (el) {
            var id = el.getAttribute("data-case-number") || "";
            el.innerHTML = numberChip(byNo[id] || "", null, id, true);
          });

          // 특정 카드에서 들어왔더라도 문서의 모든 지적은 함께 칠하고, 처음 위치만
          // 그 카드로 잡는다. 전체 하이라이트와 클릭 의도를 동시에 보존한다.
          var focus = (state.kase.view && state.kase.view.focus) ||
                      (state.cview && state.cview.focus);
          var target = (body.items || []).filter(function (it) { return it.id === focus; })[0];
          if (target && target.marks && target.marks.length) {
            window.DR.pdfview.highlight(focus);
            window.DR.pdfview.goTo(target.marks[0].page, target.marks[0].rect);
          } else if (focus) {
            var missing = (body.unlocated || []).filter(function (it) { return it.id === focus; })[0];
            toast((missing && missing.reason) || "원문 위치 확인이 필요합니다.", "err");
          }
        }
        // 반영 확인 카드의 형광펜 번호도 방금 받은 좌표에서 온다. 이 패널은
        // 지적 카드가 아니라 repaintCard 가 못 닿는다 — 안 그리면 번호가
        // 영영 안 붙는다(좌표는 검토가 끝난 뒤에 온다).
        repaintLineagePanel();
        // 카드 번호도 방금 받은 좌표에서 온다. render() 는 뷰어를 리로드하므로,
        // 뷰어는 놔두고 카드만 다시 그려 번호를 띄운다. (이걸 안 하면 좌표가
        // 늦게 도착해도 카드가 안 갱신돼, 카드를 눌러야 그제서야 번호가 떴다.)
        // 카드 번호 갱신은 단일 검토 화면의 것이다(의뢰 건은 카드 구조가 다르다).
        if (src.single) {
          repaintCard.apply(null, src.findings.map(function (f) { return f.id; }));
        }
      })
      .catch(function () { /* 좌표를 못 받으면 형광펜 없이 문서만 보인다 */ });
  }

  // 지적 카드 몇 개만 다시 그린다. 전체 렌더는 PDF iframe을 재부착해 뷰어를
  // 새로고침시키므로(makePdfFrame 위 주석 참고), 카드만 바뀌는 상호작용은
  // 여기를 쓴다. 인자로 준 id 중 실제로 화면에 있는 것만 손댄다.
  function repaintCard() {
    var ids = Array.prototype.slice.call(arguments).filter(Boolean);
    if (!ids.length) return;
    var v = renderVals();
    var byId = {};
    (v.tableFindings || []).forEach(function (f) { byId[f.id] = f; });
    ids.forEach(function (fid) {
      var el = document.querySelector('[data-card="' + fid + '"]');
      var f = byId[fid];
      if (!el || !f) return;
      // 모양은 .fcard 규칙이 갖는다. 클래스만 바꾸면 hover 도 그대로 산다.
      el.className = findingCardClass(f);
      el.setAttribute("aria-expanded", f.open ? "true" : "false");
      el.innerHTML = findingCardInner(f, v);
    });
  }

  // 결과 필터·정렬·내보내기 메뉴는 오른쪽 패널만 바꾼다. 앱 전체를 다시 그리면
  // 왼쪽 PDF iframe까지 재부착되어 필터 하나를 누를 때마다 문서가 새로고침된다.
  // 형광펜을 못 얹은 지적을 **어디로든** 데려간다(2026-09-15 지적: 카드를 눌러도
  // 아무 데도 안 갔다). 인용이 실제로 있는 후보 자리들(locate 의 candidates)이 있으면
  // 점선으로 전부 얹고 첫 후보로, 그것도 없으면 인용이 있는 쪽이나 파서가 매긴 쪽으로.
  // 정확한 자리가 아니라는 건 토스트가 말한다. 간 곳이 있으면 true.
  function goUnlocated(id) {
    var missing = ((state.marks || {}).unlocated || []).filter(function (x) { return x.id === id; });
    if (!missing.length) return false;
    var f = (window.DOCREVIEW.findings || []).filter(function (x) { return x.id === id; })[0] || {};
    var reason = missing[0].reason || "원문 위치 확인이 필요합니다.";
    var cands = [];
    missing.forEach(function (m) { cands = cands.concat(m.candidates || []); });
    if (cands.length) {
      state.cand = { id: id, idx: 0, list: cands, message: f.message || "" };
      paintMarks();
      window.DR.pdfview.goTo(cands[0].page, cands[0].rect);
      repaintCard(id);
      toast(cands.length > 1
        ? "같은 문장이 " + cands.length + "곳에 있어 자리를 확정하지 못했습니다. 카드의 ‹ › 로 옮겨 보세요."
        : reason);
      return true;
    }
    var pages = [];
    missing.forEach(function (m) { (m.pages || []).forEach(function (p) { if (pages.indexOf(p) < 0) pages.push(p); }); });
    pages.sort(function (a, b) { return a - b; });
    var page = pages[0] || f.page;
    if (page) {
      window.DR.pdfview.goTo(page, null);
      toast(reason + (pages.length > 1
        ? " 인용은 " + pages.slice(0, 6).join("·") + "쪽에 있어 첫 쪽으로 이동했습니다."
        : " " + page + "쪽으로만 이동했습니다."));
    } else {
      toast(reason, "err");
    }
    return true;
  }

  function closeDismissModal() {
    var m = document.getElementById("dismissModal");
    if (!m) return false;
    // 들어온 길의 역순으로 내려보낸다 — sheet.sync 가 사라진 시트를 layer 로 옮겨
    // 퇴장 애니메이션 뒤에 지운다(render() 의 닫힘과 같은 길).
    var kept = window.DR.sheet.keep(m);
    m.innerHTML = "";
    window.DR.sheet.sync(m, kept, sheetLayer());
    m.remove();
    return true;
  }

  function setDismissed(id, on) {
    var D = window.DOCREVIEW;
    if (!id) return;
    if (!D.historyId) { toast("이력에 저장되지 않아 지적을 뺄 수 없습니다.", "err"); return; }
    var fd = new FormData();
    fd.append("finding_id", id);
    fd.append("dismissed", on ? "1" : "0");
    fetch("api/history/" + encodeURIComponent(D.historyId) + "/dismiss", { method: "POST", body: fd })
      .then(function (res) {
        if (!res.ok) return res.json().catch(function () { return {}; })
          .then(function (b) { throw new Error(b.detail || (res.status === 404
            ? "서버에 이 기능이 없습니다 — 서버를 다시 시작해 주세요." : "HTTP " + res.status)); });
        return res.json();
      })
      .then(function (p) {
        D.dismissed = p.dismissed || [];
        D.lineageVerdicts = p.lineageVerdicts || null;
        D.lineageCarried = p.lineageCarried || null;
        if (state.selected === id) state.selected = null;
        if (!repaintSingleIssues()) render();
        paintMarks();
        toast(on ? "지적에서 뺐습니다. 같은 문서를 다시 검토해도 올라오지 않습니다." : "지적으로 되돌렸습니다.");
      })
      .catch(function (err) { toast("저장 실패: " + errMessage(err), "err"); });
  }

  function repaintSingleIssues() {
    if (state.mode !== "single" || state.screen !== "results") return false;
    var panel = document.getElementById("issuesPanel");
    // 텍스트 재현본은 선택 상태가 본문 형광펜 HTML에도 들어가므로 전체 렌더가 맞다.
    if (!panel || !document.getElementById("pdf-mount")) return false;
    var oldScroll = panel.querySelector('[data-scroll="issues"]');
    var top = oldScroll ? oldScroll.scrollTop : 0;
    var snapshot = document.createElement("div");
    snapshot.innerHTML = view(renderVals());
    var fresh = snapshot.querySelector("#issuesPanel");
    if (!fresh) return false;
    panel.innerHTML = fresh.innerHTML;
    var nextScroll = panel.querySelector('[data-scroll="issues"]');
    if (nextScroll) nextScroll.scrollTop = top;
    return true;
  }

  // 진행 화면에서 step 이벤트마다 레인·퍼센트·경과만 부분 갱신한다. 전체 render를
  // 부르면 '검토 취소' 버튼 DOM이 step마다 재생성돼 hover(:hover)가 깜빡인다 —
  // 여기선 버튼을 안 건드리고 id로 감싼 조각들 안쪽만 갈아끼운다. 진행 화면이
  // 아니거나 조각 컨테이너가 없으면 false 를 돌려 호출측이 전체 render로 폴백한다.
  // Capture before either partial updates or a full render. The phase belongs to
  // the displayed DOM, not the already-updated server state.
  function captureProgressExpansion() {
    var card = document.querySelector('.page-shell-progress .progress-workspace');
    if (!card) return null;
    return { phase: card.getAttribute('data-progress-phase'),
      screen: card.closest('[data-scroll]').getAttribute('data-scroll'),
      run: card.getAttribute('data-progress-run'), height: card.getBoundingClientRect().height,
      width: card.getBoundingClientRect().width,
      until: card._progressExpandUntil || 0 };
  }

  function animateProgressExpansion(before) {
    var card = document.querySelector('.page-shell-progress .progress-workspace');
    if (!card || !before || card.getAttribute('data-progress-phase') !== 'reviewing' ||
        card.closest('[data-scroll]').getAttribute('data-scroll') !== before.screen ||
        card.getAttribute('data-progress-run') !== before.run) return;
    var first = before.phase === 'preparing';
    var remaining = before.until - Date.now();
    if (!first && remaining <= 0) return;
    // Continue an in-flight expansion on a replacement DOM without restarting
    // the 250ms clock. No entrance animation on navigation or later counters.
    if (card._progressExpandAnimation) card._progressExpandAnimation.cancel();
    if (reduceMotion() || !card.animate) return;
    var target = card.getBoundingClientRect();
    if (Math.abs(target.height - before.height) < 1 && Math.abs(target.width - before.width) < 1) return;
    var duration = first ? 250 : remaining;
    card._progressExpandUntil = Date.now() + duration;
    var animation = card.animate([
      { width: before.width + 'px', height: before.height + 'px', overflow: 'clip' },
      { width: target.width + 'px', height: target.height + 'px', overflow: 'clip' }
    ], { duration: duration, easing: 'cubic-bezier(.4, 0, .2, 1)' });
    card._progressExpandAnimation = animation;
    var reveal = first && card.querySelector('#pg-lanes');
    var revealAnimation = reveal && reveal.animate([{ opacity: .35 }, { opacity: 1 }],
      { duration: 200, easing: 'ease-out' });
    // Animate layout dimensions, not scale: text stays sharp as the centered
    // card grows in both directions. Resizing restores intrinsic dimensions.
    // Never crop contents
    // to a measurement made at a different viewport width.
    var cancel = function () { animation.cancel(); };
    var cleanup = function () {
      window.removeEventListener('resize', cancel);
      if (revealAnimation) revealAnimation.cancel();
      if (card._progressExpandAnimation === animation) {
        card._progressExpandAnimation = null;
        card._progressExpandUntil = 0;
      }
    };
    animation.onfinish = cleanup;
    animation.oncancel = cleanup;
    window.addEventListener('resize', cancel);
  }

  function repaintProgress() {
    if (state.mode !== "single" || state.screen !== "progress") return false;
    var host = document.getElementById("pg-lanes");
    if (!host) return false;
    var progressBefore = captureProgressExpansion();
    var v = renderVals();
    var f = _views.progressFragments(v);
    var set = function (id, html) { var el = document.getElementById(id); if (el) el.innerHTML = html; };
    // 레인은 통째로 다시 그리지 않는다. 진행량 전환이 끊기지 않게 폭·카운터만 고친다.
    // 상태(대기/진행/완료)가 바뀌었거나 레인 구성이 달라졌을 때만 통째로 그린다.
    if (!updateLanesInPlace(host, v.review.lanes)) set("pg-lanes", f.lanes);
    var preparation = document.getElementById("pg-preparation");
    if (preparation && preparation.innerHTML !== f.preparation) preparation.innerHTML = f.preparation;
    set("pg-note", v.review.prepReady ? f.note : "");
    set("pg-pct", f.pct);
    set("pg-elapsed", f.elapsed);
    // 멈추는 중이면 머리말은 그 말을 하고 있다 — 단계 문구로 덮지 않는다.
    if (!v.done && !_views.jobStopping("single") && !state.stopped.single) {
      var phase = _views.singleProgressPhase(v.review);
      var title = document.getElementById("pg-status-title");
      if (title) title.textContent = phase.title;
      var sub = document.getElementById("pg-status-sub");
      if (sub) sub.textContent = phase.sub;
    }
    var prepDesc = document.getElementById("pg-prep-desc");
    if (prepDesc) prepDesc.textContent = f.prepDesc;
    Array.prototype.forEach.call(document.querySelectorAll(".progress-step-guide li"), function (el, i) {
      if (i === (v.done ? 2 : (v.review.prepReady ? 1 : 0))) el.setAttribute("aria-current", "step");
      else el.removeAttribute("aria-current");
    });
    var card = host.closest('.progress-workspace');
    if (card) card.setAttribute('data-progress-phase', v.done ? 'done' :
      (v.review.lanes.length ? 'reviewing' : 'preparing'));
    animateProgressExpansion(progressBefore);
    return true;
  }

  // 산출물 세트 진행 화면의 타임라인만 갈아끼운다. 전체 render 를 하면 취소
  // 버튼이 재생성돼 hover 가 풀리고 유리 패널이 매 단계마다 다시 그려진다.
  // 화면 마크업은 views.js 한 곳에서만 만든다 — api.js 가 따로 지어내면 갈린다.
  function repaintCaseStages() {
    if (state.mode !== "case" || state.kase.step !== "progress") return false;
    var box = document.getElementById("kase-stages");
    if (!box) return false;
    box.innerHTML = _views.caseStageList(state.kase);
    var meta = _views.caseProgressMeta(state.kase);
    var pct = document.getElementById("kase-pct");
    if (pct) pct.innerHTML = "";
    var count = document.getElementById("kase-stage-count");
    if (count) count.textContent = meta.total + "단계 중 " + meta.reached + "단계 도달";
    var elapsed = document.getElementById("kase-elapsed");
    if (elapsed) elapsed.textContent = state.kase.startedAt
      ? _be.fmtElapsed(Date.now() - state.kase.startedAt) + " 경과" : "시작하는 중";
    return true;
  }

  // 같은 상태에서는 DOM을 보존해 실제 진행량의 transform 전환을 이어간다.
  function updateLanesInPlace(host, lanes) {
    var wraps = host.querySelectorAll("[data-lane-idx]");
    if (wraps.length !== lanes.length) return false;
    for (var i = 0; i < lanes.length; i++) {
      var w = wraps[i];
      var m = _views.laneMetrics(lanes[i]);
      // 바뀐 레인만 갱신해 다른 레인의 진행량 전환을 끊지 않는다.
      var before = w.getAttribute("data-lane-status");
      // 마지막 수치가 들어오는 순간 run→done 으로 노드를 바로 갈면, 살아 있던
      // progress fill 의 transform 전환도 함께 버려져 마지막 몇 %가 순간이동한다.
      // 먼저 기존 바를 100%까지 채운 뒤 완료색·체크로 교체한다. finishing 표식은
      // 그 사이 done 이벤트나 경과 타이머가 같은 노드를 다시 가는 것을 막는다.
      if (before === "run" && m.status === "done") {
        w.setAttribute("data-lane-status", "finishing");
        var lastFill = w.querySelector("[data-lane-fill]");
        if (lastFill) lastFill.style.transform = "scaleX(1)";
        (function (wrapper, lane) {
          setTimeout(function () {
            if (!wrapper.isConnected || wrapper.getAttribute("data-lane-status") !== "finishing") return;
            wrapper.setAttribute("data-lane-status", "done");
            wrapper.style.opacity = "1";
            wrapper.innerHTML = _views.laneInner(lane, true);
          }, reduceMotion() ? 0 : 250);
        })(w, lanes[i]);
        continue;
      }
      if (before === "finishing" && m.status === "done") continue;
      if (before !== m.status) {
        w.setAttribute("data-lane-status", m.status);
        w.style.opacity = m.status === "wait" ? ".5" : "1";
        w.innerHTML = _views.laneInner(lanes[i], true);
        continue;
      }
      var fill = w.querySelector("[data-lane-fill]");
      if (fill) fill.style.transform = "scaleX(" + (m.pct / 100) + ")";
      var ctr = w.querySelector("[data-lane-counter]");
      if (ctr) ctr.textContent = m.counter;
    }
    return true;
  }

  // 움직임을 줄여 달라고 했는지. CSS 는 @media 로 알아서 따르지만, JS 가 직접
  // 움직이는 것(스크롤)은 물어봐야 안다.
  function reduceMotion() {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  // ---- 로그인 계열 화면의 오류 배너 ---------------------------------------
  // alert 대신 화면 안 자리(#authError)에 글만 채운다. render() 를 부르면 이
  // 화면들의 입력값이 DOM 에만 있어 통째로 날아가므로(selToggle 주석) 다시
  // 그리지 않는다 — 검색 결과 목록만 갈아끼우는 것과 같은 수법이다.
  // 서버가 준 계정을 화면 상태에 앉힌다. 로그인·세션 복원·프로필 저장이 모두
  // 이 한 곳을 지난다 — 세 곳에서 각자 채우다 하나를 빠뜨리면(예전엔 kase.team)
  // 팀 없는 계정이 앞사람 팀 기준으로 검토된다.
  function applyAccount(acc) {
    state.user = { name: acc.name || "", email: acc.email, dept: acc.dept || "",
                   team: acc.team || "", role: acc.role || "user" };
    // 소속 팀 기준을 기본으로 건다. 안 걸면 검토자가 매번 골라야 하고, 안 고르면
    // 공통 기준만으로 돈다 — 팀 기준 수십 건이 조용히 빠진다. 팀이 없으면
    // **비운다**: 안 비우면 화면엔 "미지정"인데 요청은 앞 팀으로 나간다.
    state.checklist = acc.team || "";
    state.kase.team = acc.team || "";
    // 서버가 "지금 무슨 잣대로 재는지"를 다시 답해야 한다.
    if (acc.team && servedOverHttp()) loadServerConfig();
  }

  function authError(msg) {
    var box = document.getElementById("authError");
    var text = document.getElementById("authErrorText");
    if (!box || !text) return;
    text.textContent = msg;
    box.hidden = false;
  }

  // ---- 브라우저 뒤로가기 --------------------------------------------------
  // SPA 라 주소가 안 바뀌어, 뒤로가기를 누르면 앱 밖으로 나가며 검토 상태가
  // 통째로 날아갔다. 화면 전환마다 히스토리에 한 칸을 쌓고 popstate 로 그
  // 화면을 되살린다. 진행(progress) 화면은 지나가는 상태라 안 쌓는다 — 뒤로
  // 가서 "검토 중" 화면에 다시 서도 할 수 있는 게 없다.
  var navApplying = false;   // popstate 로 온 전환은 다시 쌓지 않는다
  var lastNavKey = null;
  // 뒤로가기 복원 중의 목표 키. 기록을 다시 여는 동안의 중간 렌더(hbusy)와
  // 완료 렌더가 히스토리에 새 칸을 쌓지 않게 한다.
  var navRestoreKey = null;
  // 직전 렌더의 화면 키(진행 화면 포함 — lastNavKey 는 진행을 안 담는다).
  // 검토가 도는 채로 진행 화면을 떠나는 순간을 잡아 "계속 돈다"고 알려준다.
  var prevScreenKey = null;
  function noteLeavingProgress(cur) {
    if (prevScreenKey === cur) return;
    var wasProgress = /\/progress$/.test(prevScreenKey || "");
    prevScreenKey = cur;
    if (!wasProgress || /\/progress$/.test(cur)) return;
    // 아직 도는 검토가 있을 때만 말한다. 자연 완료는 화면이 넘어가기 **전에**
    // done·payload·cdone 이 서므로 여기 안 걸리고, 취소는 abort 를 비우고
    // 나가므로 역시 안 걸린다 — 남는 것은 "떠났는데 계속 도는" 경우뿐이다.
    var running = (state.reviewAbort && !state.done) ||
                  (state.kase.abort && !state.kase.payload) ||
                  (state.compareAbort && !state.cdone);
    if (running) toast("검토는 계속 진행됩니다 — 끝나면 알림으로 알려드립니다");
  }
  var AUTH_MODES = { login: 1, signup: 1, forgot: 1 };
  function navKey() {
    var sub = state.mode === "single" ? state.screen
      : state.mode === "compare" ? state.cstep
      : state.mode === "evaluate" ? state.estep
      : state.mode === "case" ? state.kase.step : "";
    var key = state.mode + (sub ? "/" + sub : "");
    // 내용이 실린 화면은 **어느 기록인지**까지 키에 넣는다. 화면 종류만 키면
    // 기록 A 결과를 보다 기록 B 를 열 때 키가 같아 히스토리가 안 쌓이고,
    // 뒤로가기가 B 직전이 아니라 한참 전 화면으로 뛰었다(2026-09-01 요구).
    if (state.navRecordId &&
        (key === "single/results" || key === "compare/results" ||
         key === "case/results" || key === "evaluate/results" || key === "checklistrun")) {
      key += "#" + state.navRecordId;
    }
    return key;
  }
  function syncHistory() {
    var key = navKey();
    if (navRestoreKey) {
      if (state.hbusy) return;             // 복원 중간 렌더 — 히스토리에 안 쓴다
      var target = navRestoreKey; navRestoreKey = null;
      if (key === target) { lastNavKey = key; return; }   // 복원 완료
      // 복원 실패(기록 삭제 등) — 제자리 그대로, 아래 일반 규칙을 탄다.
    }
    if (/\/progress$/.test(key) || key === lastNavKey) return;
    var first = lastNavKey === null;
    // 로그인 계열은 히스토리에 안 쌓는다(제자리 교체) — 로그인을 마친 뒤
    // 뒤로가기로 로그인 화면에 되돌아가게 두지 않는다. 그 화면들 사이의 이동은
    // 자체 "돌아가기" 링크가 진다.
    var authHop = first || AUTH_MODES[lastNavKey.split("/")[0]] || AUTH_MODES[state.mode];
    lastNavKey = key;
    if (navApplying) return;
    var entry = { mode: state.mode, screen: state.screen,
                  cstep: state.cstep, kstep: state.kase.step, estep: state.estep,
                  recordId: state.navRecordId || null };
    // file:// 나 일부 내장 브라우저는 pushState 를 막는다 — 앱은 그래도 돈다.
    try {
      if (authHop) history.replaceState(entry, "");
      else history.pushState(entry, "");
    } catch (e) { /* 히스토리 없이 계속 */ }
  }

  // ---- render + wiring ----------------------------------------------------
  var root;

  // 검색은 앱 위에 겹쳐 뜨는 것이므로 밑을 다시 그리지 않는다. 예전엔 돋보기가
  // render() 를 불러 화면 전체를 innerHTML 로 갈았고(홈 애니메이션이 0프레임부터
  // 다시 돌고 PDF 뷰어가 다시 뜬다), 이어서 체크리스트 fetch 가 끝나면 한 번 더
  // 갈았다 — 두 번 깜빡이니 새로고침한 것처럼 보였다.
  // 닫히는 시트가 잠시 머무는 자리. render() 가 root 를 갈면 나가던 카드까지
  // 같이 사라지므로, 여기로 옮겨 놓고 끝까지 내려보낸 뒤 지운다 —
  // render() 안에서 PDF 뷰어 host 를 옮겨 붙이는 것과 같은 수법이다.
  function sheetLayer() {
    var el = document.getElementById("sheet-layer");
    if (!el) {
      el = document.createElement("div");
      el.id = "sheet-layer";
      document.body.appendChild(el);
    }
    return el;
  }

  // 끌고 있는 동안 밀어 둔 렌더. IME 조합 중 렌더를 미루는 것과 같은 이유다 —
  // 손이 카드를 쥐고 있는데 그 카드를 innerHTML 로 갈아치우면 포인터 캡처가
  // 끊겨 드래그가 손에서 빠진다.
  var sheetRenderPending = false;

  function renderSearch() {
    var layer = document.getElementById("search-layer");
    if (!layer) {
      layer = document.createElement("div");
      layer.id = "search-layer";
      document.body.appendChild(layer);
    }
    var html = _views.searchModalHtml();
    // 이미 열려 있는데 같은 HTML 을 다시 꽂으면 입력 칸이 새로 만들어져
    // 포커스·캐럿·조합 중인 한글이 날아간다. 바뀔 때만 갈아끼운다.
    var keptSheets = window.DR.sheet.keep(layer);
    if (layer.innerHTML !== html) layer.innerHTML = html;
    window.DR.sheet.sync(layer, keptSheets, sheetLayer());
    // 헤더의 돋보기 눌린 표시는 헤더를 다시 그리지 않으므로 직접 맞춘다.
    var btn = document.querySelector('header .icon-btn[aria-label="검색"]');
    if (btn) btn.classList.toggle("on", !!state.searchOpen);
    // <input autofocus> 는 문서를 파싱할 때만 먹고 innerHTML 로 꽂은 노드에는
    // 안 먹으므로 직접 준다. 이미 그 칸에 있으면 건드리지 않는다 — 다시 focus
    // 하면 캐럿이 끝으로 튄다.
    if (state.searchOpen) {
      var qbox = layer.querySelector("[data-search-q]");
      if (qbox && document.activeElement !== qbox) qbox.focus();
    }
  }

  // 검색 결과 목록만 갈아끼운다(입력 칸은 안 건드린다 — IME 보존).
  function renderSearchResults() {
    var box = document.getElementById("searchResults");
    if (box) box.innerHTML = _views.searchResultsHtml();
  }
  // ---- 어시스턴트(A 안 2판) 보조 ----
  // 지금 결과 화면이 어느 검토 기록인지. 이력에서 열었든 방금 검토했든 history.id 에 있다.
  // 어시스턴트가 안고 갈 검토 — **지금 보고 있는 결과 화면**의 것만. window.DOCREVIEW 에는
  // 마지막에 열었던 단일 검토가 그대로 남아 있어, 비교 결과나 홈에서 눌러도 그 단일 검토가
  // 문맥으로 잡혔다(2026-09-16 지적: 비교 화면에서 "PLT56 … 이 검토에 대해 물어보세요").
  function rememberAssistantReturn(reviewId) {
    state.assistantReturn = { mode: state.mode, screen: state.screen, cstep: state.cstep, estep: state.estep, reviewId: reviewId || "" };
  }
  function chatReviewId() {
    var D = window.DOCREVIEW || {};
    if (state.mode === "compare") {
      var c = D.compare;
      return (state.cstep === "results" && c && c.history && c.history.id) || "";
    }
    if (state.mode === "single" && state.screen === "results") {
      return (D.history && D.history.id) || D.historyId || "";
    }
    if (state.mode === "evaluate" && state.estep === "results") {
      return state.evalv.historyId || "";   // 체크리스트 검토(부록 B 초안) — 2026-09-17 연결
    }
    return "";   // 홈·기록·설정·폴더 검토 — 문맥 없음(폴더 검토는 어시스턴트가 아직 못 읽는다)
  }
  // 문맥의 종류 — 인사 화면의 시작 카드가 이걸로 갈린다(초안 기록엔 "지적"이 없다).
  function chatReviewKind() {
    if (state.mode === "compare") return "compare";
    if (state.mode === "evaluate") return "evaluation";
    return "review";
  }
  function chatReviewTitle() {
    var D = window.DOCREVIEW || {};
    if (state.mode === "compare") {
      var c = D.compare || {};
      var a = (c.docA || {}).name || "상위 문서", b = (c.docB || {}).name || "하위 문서";
      return a + " ↔ " + b;
    }
    if (state.mode === "evaluate") return ((state.evalv.payload || {}).doc || {}).name || "";
    return (D.doc && D.doc.name) || "";
  }
  // 화면 전체를 다시 그리면 대화 창이 새 요소라 스크롤이 맨 위로 튄다 — 첫 답이 끝난 직후
  // 목록을 다시 읽을 때 그랬다(2026-09-16 지적). 그리기 전 자리를 재서 되돌린다.
  function renderKeepingChatScroll() {
    var log = document.getElementById("chatLog");
    var was = log ? { top: log.scrollTop, bottom: chatAtBottom(log) } : null;
    render();
    log = document.getElementById("chatLog");
    if (log && was) log.scrollTop = was.bottom ? log.scrollHeight : was.top;
  }
  function loadChatSessions() {
    return fetch("api/chat/sessions").then(function (res) {
      if (!res.ok) throw new Error("대화 목록을 읽지 못했습니다 (HTTP " + res.status + ")");
      return res.json();
    }).then(function (body) {
      state.chat.sessions = body.sessions || [];
      state.chat.loaded = true;
      renderKeepingChatScroll();
    }).catch(function (err) { state.chat.loaded = true; state.chat.error = errMessage(err); renderKeepingChatScroll(); });
  }
  // 어시스턴트 화면으로. 검토를 안고 왔으면 그 검토의 최근 대화를 잇고, 없으면 새 대화가
  // 그 검토를 문맥으로 갖는다 — 같은 문서로 대화가 여럿 쌓이지 않게.
  function markAssistantSeen() {
    if (state.chat.seen) return;
    state.chat.seen = true;
    try { localStorage.setItem("dr.assistantSeen", "1"); } catch (e) { /* 기억 못 해도 동작한다 */ }
  }
  function openAssistant(reviewId, reviewTitle, reviewKind) {
    var c = state.chat;
    state.mode = "assistant";
    markAssistantSeen();
    c.error = "";
    if (!reviewId) {
      // 문맥 없이 들어오면 **새 대화**다 — 그냥 화면만 바꾸니 어디서 눌러도 마지막 대화로
      // 돌아가는 것처럼 보였다(2026-09-16). 지난 대화는 옆 목록에 있다. 답이 흘러오는
      // 중이면 그 대화를 끊지 않는다.
      if (!c.busy) { c.current = null; c.msgs = []; c.since = 0; c.pendingReview = ""; c.pendingReviewTitle = ""; c.pendingReviewKind = ""; }
      render(); loadChatSessions(); return;
    }
    // 검토를 안고 오면 목록을 읽고 그 검토의 대화를 여는 데 한두 번 왕복이 든다(첫 번은
    // DoSuree 기동까지). 그동안 옛 화면에 머물면 눌린 줄 모른다(2026-09-15 지적) — 먼저
    // 어시스턴트 화면을 "여는 중"으로 띄운다.
    c.opening = true; c.current = null; c.msgs = []; c.since = 0;
    c.pendingReview = reviewId; c.pendingReviewTitle = reviewTitle || reviewId;
    c.pendingReviewKind = reviewKind || "review";
    render();
    fetch("api/chat/sessions").then(function (res) { return res.ok ? res.json() : { sessions: [] }; })
      .then(function (body) {
        c.sessions = body.sessions || []; c.loaded = true;
        var same = c.sessions.filter(function (s) { return s.review_id === reviewId && !s.missing; })[0];
        if (same) { actions.chatOpen(same.id); return; }
        c.opening = false;
        render();
      })
      .catch(function (err) { c.opening = false; c.error = errMessage(err); render(); });
  }
  // 서버 이벤트 하나를 상태에 반영하고 대화 로그만 다시 그린다. 글자가 흘러오는
  // 동안 전체 render() 를 부르면 입력 초점이 날아간다.
  function onChatEvent(ev) {
    var c = state.chat;
    if (typeof ev.i === "number") c.since = ev.i + 1;
    var last = c.msgs[c.msgs.length - 1];
    if (!last || last.role !== "assistant") return;
    if (ev.event === "text") last.text += ev.delta || "";
    else if (ev.event === "tool") last.tools.push({ name: ev.name, done: false, ok: true, args: ev.args || {} });
    else if (ev.event === "tool_done") {
      var t = last.tools.filter(function (x) { return x.name === ev.name && !x.done; })[0];
      if (t) { t.done = true; t.ok = ev.ok !== false; }
    } else if (ev.event === "error") c.error = ev.message || "오류";
    else if (ev.event === "closed" && ev.code) {
      c.error = "대화 프로세스가 끝났습니다(코드 " + ev.code + "). 다시 보내면 새로 시작합니다.";
    } else if (ev.event !== "turn" && ev.event !== "user" && ev.event !== "ping") return;
    repaintChat();
  }
  function copyFallback(text) {
    var ta = document.createElement("textarea");
    ta.value = text; ta.setAttribute("readonly", "");
    ta.style.position = "fixed"; ta.style.top = "-1000px";
    document.body.appendChild(ta); ta.select();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }
  // 아래에 붙어 있을 때만 따라 내려간다. 매번 맨 아래로 밀면 답이 흘러오는 동안 위로
  // 올라가 지난 말을 읽을 수 없었다(2026-09-16 지적). 80px 은 "거의 아래" 의 여유.
  function chatAtBottom(log) {
    return log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  }
  function repaintChat() {
    var log = document.getElementById("chatLog");
    if (!log || log.querySelector(".chat-empty")) { render(); return; }
    var stick = chatAtBottom(log);
    log.innerHTML = _views.chatLogHtml(state.chat);
    if (stick) log.scrollTop = log.scrollHeight;
    var btn = document.getElementById("chatSend"), stop = document.getElementById("chatStop");
    if (btn) btn.disabled = !!state.chat.busy;
    if (stop) stop.style.display = state.chat.busy ? "" : "none";
  }
  document.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && e.target && e.target.id === "homeAsk") { e.preventDefault(); actions.homeAsk(); return; }
    if (e.key === "Enter" && !e.shiftKey && e.target && e.target.id === "chatInput") {
      e.preventDefault();
      actions.chatSay();
    }
  });
  // 입력창은 줄에 맞춰 자란다(최대 200px). 보내면 한 줄로 돌아온다(chatSay 가 value 를 비운다).
  document.addEventListener("input", function (e) {
    var t = e.target;
    if (!t || t.id !== "chatInput") return;
    t.style.height = "auto";
    t.style.height = Math.min(t.scrollHeight, 200) + "px";
    // 입력창이 자라면 대화 창 아래 여백도 같이 — 떠 있는 입력창이 마지막 말을 덮지 않게.
    var col = t.closest(".assistant-main-col"), box = t.closest(".chat-composer");
    if (col && box) col.style.setProperty("--composer-h", (box.offsetHeight + 8) + "px");
  });

  function render() {
    if (state.mode === "assistant" && !state.chat.loaded && !state.chat.loading) {
      state.chat.loading = true;
      loadChatSessions().then(function () { state.chat.loading = false; });
    }
    // 한글 등 IME 조합 중엔 render를 통째로 건너뛴다 — 위 reasonComposing
    // 선언부 주석 참고(조합 중인 글자는 캡처해서 복원할 방법이 없는 유일한
    // 경우다). 조합이 끝나면(compositionend) 또는 watchdog이 강제로 풀면
    // flushReasonRender가 몰아서 그린다.
    if (reasonComposing) { reasonRenderPending = true; return; }
    // 시트를 쥐고 있는 동안은 그리지 않는다(위 sheetRenderPending 주석).
    // 손을 떼면 sheet.js 의 onIdle 이 밀린 것을 그린다.
    if (window.DR.sheet && window.DR.sheet.dragging) { sheetRenderPending = true; return; }
    if (renderHoldMs && !renderHoldBypass) {
      if (!renderHoldTimer) renderHoldTimer = setTimeout(function () {
        renderHoldTimer = null; renderHoldBypass = true;
        try { render(); } finally { renderHoldBypass = false; }
      }, renderHoldMs);
      return;
    }
    sheetRenderPending = false;
    // 실제로 그렸으면 밀린 렌더는 해소된 것이다. 이 줄이 없으면 click 끝에서
    // 한 번 더 그리게 된다(해롭진 않지만 뷰어 iframe이 다시 로드된다).
    reasonRenderPending = false;

    // 원문 창은 문서가 열린 뒤엔 늘 비교 결과 모드다 — 로그인 확인·이력 갱신 같은
    // 흐름이 mode 를 홈으로 돌려놔도 문서를 그린다(2026-09-08).
    if (state.popup && state.cview) { state.mode = "compare"; state.cstep = "results"; }
    // 화면 전환을 히스토리에 맞춘다. state 는 이 시점에 이미 다 바뀌어 있다.
    syncHistory();
    // 변환이 필요하면 **그리기 전에** 플래그를 켠다 — 그래야 이번 렌더가 바로
    // 준비 중 상태를 그린다. 상태만 바꾸고 fetch 를 띄울 뿐 DOM 은 안 만진다.
    maybeConvert();

    // 체크리스트 "이유" 입력에 포커스가 있으면 캡처 후 복원한다 — 위
    // reasonComposing 주석 참고(포커스만으로는 더 이상 렌더를 건너뛰지
    // 않는다: 건너뛰면 다른 버튼 클릭이 focusout에 가려 씹힌다).
    var reasonFocused = document.activeElement;
    var reasonKey = null, reasonSelStart = null, reasonSelEnd = null;
    if (reasonFocused && reasonFocused.getAttribute && reasonFocused.getAttribute("data-reason") != null) {
      reasonKey = reasonFocused.getAttribute("data-reason");
      try { reasonSelStart = reasonFocused.selectionStart; reasonSelEnd = reasonFocused.selectionEnd; }
      catch (e) { /* 일부 입력 타입은 selection 속성을 지원하지 않는다 */ }
    }

    // innerHTML로 통째로 다시 그리므로 스크롤 위치가 날아간다 — 안 그러면 심각도
    // 칩 하나만 눌러도 화면이 맨 위로 튕긴다. data-scroll 표식을 단 컨테이너의
    // 위치를 키별로 기억했다가 되살린다.
    //
    // 예전에는 id 두 개(main-scroll·doc-scroll)만 되살렸다. 그런데 업로드·비교
    // 설정 화면은 그 안에 자기 스크롤러를 하나 더 두고 있어(height:100% +
    // overflow:auto) 실제로 스크롤되는 건 그쪽이었고, 표식이 없어 복원에서
    // 빠졌다 — 체크리스트를 고를 때마다 화면이 맨 위로 올라간 이유다.
    var tops = {};
    Array.prototype.forEach.call(document.querySelectorAll("[data-scroll]"), function (el) {
      tops[el.getAttribute("data-scroll")] = el.scrollTop;
    });

    // **자리는 새로 그리고, 살아 있는 뷰어 알맹이만 옮겨 붙인다.**
    //
    // innerHTML 을 갈면 `#pdf-mount` 가 새 빈 노드가 되고, syncViewer 가 빈 자리를
    // 보고 PDF 를 처음부터 다시 읽는다 — 읽던 자리가 날아가고 깜빡인다. 내보내기
    // 메뉴를 열거나 닫기만 해도 그랬다(toggleExportMenu·exportAs 가 render 를 부른다).
    //
    // 옛 mount 노드를 통째로 새 자리에 바꿔치기하면 안 된다. 그 노드가 들고 있던
    // 크기 규칙이 새 화면과 어긋난다(단일 검토는 `flex:1;overflow:hidden`, 폴더
    // 검토는 `flex:1;min-height:0`). style 을 덮어써 맞춰 봤더니 이번엔 **빈 화면**이
    // 났다.
    //
    // pdfview 는 mount 안에 제 host 를 만들어 넣는다(pdfview.open). 그 host 만 새
    // mount 로 옮기면 캔버스·스크롤 위치·리스너가 그대로 살고, 자리는 새로 그린
    // 것이 쓰인다.
    var oldMount = document.getElementById("pdf-mount");
    var keptHost = oldMount && oldMount.firstChild;
    // 노드를 DOM 에서 떼면 스크롤 위치가 0 으로 초기화된다 — 옮겨 붙인 뒤 되돌려
    // 놓지 않으면 내려받기 한 번에 문서가 맨 위로 튄다. data-scroll 복원과 같은
    // 이유인데, 뷰어의 스크롤 상자는 pdfview 가 만든 것이라 그 표식이 없다.
    var keptTop = keptHost ? keptHost.scrollTop : 0;

    // 지금 떠 있는 시트를 scrim 째 붙잡아 둔다 — 아래 innerHTML 이 지우기 전에.
    var keptSheets = window.DR.sheet.keep(root);

    var progressBefore = captureProgressExpansion();
    root.innerHTML = view(renderVals());
    animateProgressExpansion(progressBefore);
    // 새 기록 강조는 DOM에 실제 대상 행이 생긴 첫 렌더 한 번으로 끝낸다.
    // 이력을 아직 불러오는 중이면 행이 없으므로 값을 남겨 다음 렌더가 받는다.
    var freshHomeRow = root.querySelector('[data-fresh-history="true"]');
    if (freshHomeRow) state.homeFreshHistoryId = null;
    // 새 DOM 과 대조해 등장·유지·퇴장을 가른다.
    window.DR.sheet.sync(root, keptSheets, sheetLayer());

    if (keptHost) {
      var viewerSlot = document.getElementById("pdf-mount");
      // 새 화면에 뷰어 자리가 없으면 안 옮긴다 — syncViewer 가 닫는다.
      if (viewerSlot) {
        viewerSlot.appendChild(keptHost);
        keptHost.scrollTop = keptTop;   // 읽던 자리로 되돌린다
        paintWhere();          // 도구줄이 새로 그려졌다 — 값을 되살린다
      }
    }

    Array.prototype.forEach.call(document.querySelectorAll("[data-scroll]"), function (el) {
      var t = tops[el.getAttribute("data-scroll")];
      if (t) el.scrollTop = t;
    });

    // 위에서 캡처해둔 "이유" 입력 포커스·커서를 새 DOM에 되살린다. data-scroll
    // 복원과 같은 자리, 같은 이유(innerHTML 교체가 그 사이 값을 다 지운다)다.
    if (reasonKey != null) {
      var reasonRestored = document.querySelector('[data-reason="' + reasonKey + '"]');
      if (reasonRestored) {
        reasonRestored.focus();
        if (reasonSelStart != null && reasonSelEnd != null) {
          try { reasonRestored.setSelectionRange(reasonSelStart, reasonSelEnd); }
          catch (e) { /* 무시 — 포커스만 되살아나도 충분하다 */ }
        }
      }
    }

    renderSearch();

    // 지적을 새로 고른 렌더에서만 그 절로 옮긴다. 매 렌더마다 옮기면 사용자가
    // 문서를 훑는 동안 화면이 계속 튄다.
    if (state.selected !== lastScrolled) {
      lastScrolled = state.selected;
      var target = state.selected && document.getElementById("sec-" + selectedSection());
      // 순간이동하면 검토자는 자기가 어디서 어디로 왔는지 잃는다 — 지적과 문서를
      // 잇는 게 이 화면의 일인데, 문서가 툭 갈리면 그 연결이 안 보인다.
      //
      // index.html 의 prefers-reduced-motion 규칙(scroll-behavior:auto)은 여기
      // 안 먹는다: JS 가 behavior 를 명시하면 그쪽이 CSS 를 이긴다. 직접 묻는다.
      if (target) target.scrollIntoView({ block: "center", behavior: reduceMotion() ? "auto" : "smooth" });
    }
    // 비교 결과 화면이 합법 경로(완료·기록 복원)로 그려졌다는 표식. goCStep 은
    // 이 표식 없이는 results 로 못 가므로, 표식 없는 점프 경로가 없다.
    if (state.mode === "compare" && state.cstep === "results") state.compared = true;
    // 홈은 페이지째 스크롤, 앱 화면은 안쪽 스크롤러(main-scroll 등)가 맡는다.
    var home = state.mode === "home";
    document.documentElement.style.overflow = home ? "auto" : "hidden";
    document.body.style.overflow = home ? "auto" : "hidden";
    document.body.classList.toggle("is-home", home);

    syncViewer();
    noteLeavingProgress(navKey().split("#")[0]);
  }

  // 위 render()가 조합 중이라 건너뛴 게 있으면 여기서 몰아서 그린다.
  // compositionend(정상 종료)와 조합 watchdog(비정상 미종료 대비)만 부른다 —
  // focusout에서는 절대 부르지 않는다(위 reasonComposing 선언부 주석 참고:
  // 다른 컨트롤 클릭이 focusout 뒤에 오므로, 거기서 렌더하면 그 클릭이 씹힌다).
  //
  // **compositionend도 blur의 부산물로 온다.** 조합 중(한글을 치던 중)에 저장·
  // CSV 같은 다른 버튼을 누르면 브라우저는 blur 전에 조합을 끝내야 하므로
  // mousedown 시점에 compositionend가 먼저 발생한다. 여기서 곧바로 그려버리면
  // click이 델리게이션에 닿기 전에 원래 노드가 사라져 — focusout에서 그리던
  // 옛 버그와 똑같이 — 버튼이 조용히 안 눌린다. 한글 입력에서는 조합 중이
  // 오히려 기본 상태라 자주 난다.
  //
  // 그래서 조합하던 입력이 이미 포커스를 잃었으면 그리지 않고 표시만 남긴다.
  // 밀린 렌더는 뒤이어 오는 click이 델리게이션을 다 거친 뒤에 흘려보낸다
  // (아래 click 리스너 끝). 타이머로 미루지 않는 이유: 마우스를 오래 누르고
  // 있으면 타이머가 click보다 먼저 발화해 같은 버그가 그대로 재발한다.
  function flushReasonRender() {
    if (!reasonRenderPending) return;
    var el = document.activeElement;
    if (el && el.getAttribute && el.getAttribute("data-reason") != null) {
      render();                 // 여전히 그 입력에 있다 = 정상적인 조합 종료
      return;
    }
    // 포커스가 떠났다 — 지금 그리면 클릭이 씹힌다. click 쪽에 맡긴다.
  }

  // 줌 아트보드는 걷어냈다(2026-09-01). 예전에는 앱 전체를 800px 높이 고정으로
  // 그려놓고 CSS zoom 으로 모니터에 맞춰 확대했다 — Claude Design 목업을 이식할
  // 때 딸려온 방식이다. 큰 화면에서 내용이 더 보이는 게 아니라 글자만 커졌고,
  // 비정수 배율이라 텍스트가 흐릿했다. 이제 .dr-app 이 100vh 실측으로 서고
  // (index.html), 남아 있는 currentCSSZoom 보정들은 zoom 이 없어 1 로 떨어진다.

  // 커스텀 셀렉트(.sel)의 열림 상태는 state 가 아니라 DOM 클래스에 있다 —
  // 같은 화면의 폼 입력을 지우지 않으려면 다시 그리지 않아야 하기 때문이다.
  function reviewSelectKeydown(e) {
    var sel = e.target.closest && e.target.closest('#settingsLanguage, #singleResultChecker, #singleResultSort, #criteriaHow');
    if (!sel) return;
    var trigger = sel.querySelector('.sel-btn');
    if (e.key === 'Escape') {
      e.preventDefault(); closeSelects(); trigger.focus(); return;
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].indexOf(e.key) < 0) return;
    e.preventDefault();
    if (!sel.classList.contains('open')) actions.selToggle(sel.id);
    var options = Array.prototype.slice.call(sel.querySelectorAll('.sel-opt:not(:disabled)'));
    if (!options.length) return;
    var at = options.indexOf(document.activeElement);
    var next = e.key === 'Home' ? 0 : e.key === 'End' ? options.length - 1 :
      at < 0 ? (e.key === 'ArrowUp' ? options.length - 1 : 0) :
        (at + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
    options[next].focus();
  }

  function closeSelects() {
    var open = document.querySelectorAll(".sel.open");
    for (var i = 0; i < open.length; i++) {
      open[i].classList.remove("open");
      open[i].querySelector(".sel-btn").setAttribute("aria-expanded", "false");
    }
  }
  function selValue(id) {
    var el = document.getElementById(id);
    return el ? el.getAttribute("data-value") || "" : "";
  }

  function boot() {
    document.addEventListener('keydown', reviewSelectKeydown);
    document.addEventListener('focusin', function (e) {
      if (document.querySelector('#settingsLanguage.open, #singleResultChecker.open, #singleResultSort.open') &&
          !e.target.closest('.sel.open')) closeSelects();
    });
    // Set Document Title
    document.title = "DocSuree | 문서 일관성 검토 Agent";
    
    // 파비콘/앱 아이콘은 index.html <head>에 정적 <link>로 선언되어 있다.

    root = document.getElementById("root");

    // 원문 창 모드. `?doc=<이력 id>&arg=<side|focus|page|row>` 로 열리면 그 비교를
    // 이력에서 읽어 뷰어만 띄운다. 본 창이 행을 옮기면 postMessage 로 따라간다.
    var qs = new URLSearchParams(location.search);
    if (qs.get("doc")) {
      state.popup = true;
      var popupDoc = qs.get("doc"), popupArg = qs.get("arg") || "A";
      document.title = "DocSuree | 원문";
      var isEval = popupArg.charAt(0) === "E";
      window.addEventListener("message", function (e) {
        if (e.origin !== location.origin || !e.data || e.data.type !== "docsuree-focus") return;
        var a = String(e.data.arg || "");
        if (a.charAt(0) === "E") actions.openEvalDoc(a); else actions.openCompareDoc(a);
      });
      // 이력 읽기는 비동기다 — 결과가 실리면 그때 문서를 연다.
      var waited = 0;
      var tick = setInterval(function () {
        var cmp = window.DOCREVIEW.compare;
        if (isEval && state.evalv.historyId === popupDoc && state.evalv.payload) {
          clearInterval(tick); actions.openEvalDoc(popupArg);
        } else if (!isEval && cmp && cmp.history && cmp.history.id === popupDoc) {
          clearInterval(tick); actions.openCompareDoc(popupArg);
        } else if ((waited += 200) > 30000) {
          clearInterval(tick);
        } else if (!state.hbusy) {
          // 아직 못 읽었으면 다시 청한다 — 부팅 중 다른 이력 읽기(hbusy)와 겹치면
          // openHistory 가 조용히 빠져나오므로, 한 번 부르고 마는 것으로는 부족하다.
          actions.openHistory(popupDoc);
        }
      }, 200);
      history.replaceState(null, "", location.pathname + location.search);
    }

    // 시트에서 손을 뗀 순간, 끄는 동안 밀어 둔 렌더를 그린다.
    window.DR.sheet.onIdle = function () { if (sheetRenderPending) render(); };
    // 토스트 호스트 — #root 밖에 둬야 render() 의 innerHTML 교체가 못 지운다.
    // aria-live 로 스크린리더에도 알린다.
    var toastHost = document.createElement("div");
    toastHost.id = "toast-host";
    toastHost.setAttribute("aria-live", "polite");
    document.body.appendChild(toastHost);
    document.addEventListener("click", function (e) {
      var el = e.target.closest ? e.target.closest("[data-act]") : null;
      var act = el && el.getAttribute("data-act");
      // 작업 열의 여백은 결과 링크가 아니다. 버튼·메뉴의 자체 액션은 유지한다.
      if (act === "openHistory" && e.target.closest("#historyRecords .record-actions")) {
        el = null;
        act = null;
      }
      if (act !== "toggleHistoryActions") closeHistoryActions();

      // 열려 있는 팝오버는 바깥을 누르면 닫는다. 예전엔 항목을 고르거나 같은
      // 버튼을 다시 눌러야만 닫혀서, 다른 곳을 눌러도 계속 열린 채 남았다.
      // 그 팝오버 안의 항목을 누른 경우와, 자기 자신을 여닫는 버튼은 제외한다.
      var inMenu = e.target.closest && e.target.closest("#exportMenu");
      if (state.exportMenuOpen && !inMenu && act !== "toggleExportMenu") {
        // 팝오버 하나 닫자고 화면을 통째로 다시 그리지 않는다 — 뷰어까지 흔들린다.
        closeExportMenu();
      }
      // 헤더의 프로필·알림 팝오버도 같은 규칙이다. 예전엔 이 둘만 빠져 있어서,
      // 열어두고 화면 아무 데나 눌러도 계속 떠 있었다(같은 버튼을 다시 누르는
      // 것이 닫는 유일한 길이었다). 메뉴 안의 항목은 자기 액션이 닫는다.
      var inProfile = e.target.closest && e.target.closest("#profileMenu");
      if (state.profileMenuOpen && !inProfile && act !== "toggleProfile") {
        state.profileMenuOpen = false;
        if (!act) render();
      }
      var inNoti = e.target.closest && e.target.closest("#notiMenu");
      if (state.notiOpen && !inNoti && act !== "toggleNoti") {
        state.notiOpen = false;
        if (!act) render();
      }

      // 펼친 셀렉트도 마찬가지 — 자기 자신을 여닫는 버튼과 목록 항목만 빼고
      // 어디를 누르든 닫는다. 다시 그리지 않으므로 클래스만 걷어낸다.
      if (act !== "selToggle" && act !== "selPick") closeSelects();

      // <select data-act>는 클릭이 아니라 change 로 다룬다. 여기서 잡으면
      // 사용자가 고르기도 전에 액션이 돌고 render 가 드롭다운을 닫아버린다.
      if (el && el.tagName !== "SELECT") {
        var arg = el.getAttribute("data-arg");
        if (actions[act]) actions[act](arg);
      }

      // 조합 중에 뭔가를 누르느라 미뤄둔 렌더가 있으면 여기서 흘려보낸다.
      // 이 자리여야 안전하다 — 델리게이션이 data-act를 이미 찾아 액션까지
      // 돌린 뒤라, 지금 노드를 갈아엎어도 씹힐 클릭이 없다
      // (flushReasonRender 주석 참고). 액션이 스스로 그렸으면 render()가
      // 표시를 지웠으므로 여기서는 아무 일도 일어나지 않는다.
      //
      // data-act가 없는 빈 자리를 눌렀을 때도 지나가야 한다. 예전엔 위에서
      // early return 했는데, 조합 중에 빈 공간을 누르면 조합만 끝나고 밀린
      // 렌더는 아무도 흘려보내지 않아 화면이 낡은 채 남았다.
      if (reasonRenderPending) { reasonRenderPending = false; render(); }
    });
    document.addEventListener("change", function (e) {
      var el = e.target;
      if (!el || el.type !== "file") return;
      var file = el.files && el.files[0];
      if (!file) return;
      if (!el.getAttribute("data-slot")) return;
      handleFile(el.getAttribute("data-slot"), el.getAttribute("data-nav"), file);
    });
    // 인식 확인의 산출물 지정은 네이티브 <select> 에서 앱 커스텀 셀렉트(.sel)로
    // 옮겼다(selPick 의 asg- 분기) — OS 가 그리는 목록만 혼자 다른 모양이었다.
    // 체크리스트 항목의 "이유" 입력. render()를 부르지 않는 setReason과 짝을
    // 이룬다 — 여기서 render를 부르면 입력 중 포커스를 잃는다.
    document.addEventListener("input", function (e) {
      var el = e.target.closest ? e.target.closest("[data-reason]") : null;
      if (el) actions.setReason(el.getAttribute("data-reason"), el.value);
    });
    // 독립 체크리스트 화면의 "검토 대상 문서명" 입력. data-reason과 같은 이유로
    // render()를 부르지 않는다 — 여기서 그리면 입력 중 포커스를 잃는다.
    document.addEventListener("input", function (e) {
      var el = e.target.closest ? e.target.closest("[data-checklist-doc]") : null;
      if (el) state.crun.documentName = el.value;
    });
    // 비교 검토의 담당 요건 범위 입력. render()를 부르지 않는 이유는 위와 같다.
    document.addEventListener("input", function (e) {
      var el = e.target.closest ? e.target.closest("[data-cscope]") : null;
      if (el) {
        state.cscope = el.value;
        // 계산 블록만 갈아끼운다 — render() 를 부르면 <input> 이 새로 만들어져
        // 커서와 한글 조합이 날아간다.
        var calc = document.querySelector("[data-scopecalc]");
        if (calc) calc.outerHTML = views.scopeCalc(renderVals());
      }
    });
    // 기준 검색. 입력 DOM은 남기고 목록과 상세만 갱신해 한글 조합을 보존한다.
    document.addEventListener("input", function (e) {
      var el = e.target.closest ? e.target.closest("[data-criteria-q]") : null;
      if (!el) return;
      state.clayers.q = el.value;
      if (!repaintCriteriaLayers()) render();
    });
    document.addEventListener("click", function (e) {
      var menu = document.querySelector(".criteria-add-menu[open]");
      if (menu && (!menu.contains(e.target) || e.target.closest("[data-act]"))) menu.open = false;
    });
    document.addEventListener("keydown", function (e) {
      var menu = document.querySelector(".criteria-add-menu[open]");
      if (e.key === "Escape" && menu) { menu.open = false; menu.querySelector("summary").focus(); }
    });
    document.addEventListener("toggle", function (e) {
      if (!e.target.matches("[data-progress-settings]")) return;
      // 접힘 영역은 단계 이벤트로 전체 렌더되어도 사용자의 선택을 유지한다.
      if (!e.target.isConnected) return;
      state.progressSettings = state.progressSettings || {};
      state.progressSettings[e.target.getAttribute("data-progress-settings")] = e.target.open;
    }, true);
    // 추가 기준 작성 폼. 위 입력들과 같은 이유로 render 를 안 부른다.
    document.addEventListener("input", function (e) {
      var el = e.target.closest ? e.target.closest("[data-draft]") : null;
      if (!el || !state.cdraft) return;
      var key = el.getAttribute("data-draft");
      if (key === "name") state.cdraft.name = el.value;
      else if (key === "idExample") state.cdraft.idExample = el.value;
      else if (key === "idPattern") state.cdraft.idPattern = el.value;
      else if (key === "scope") state.cdraft.scope = el.value;
      else if (key.indexOf("item:") === 0) {
        state.cdraft.items[Number(key.slice(5))].text = el.value;
      }
      // 되읽기 줄만 갈아끼운다. render() 를 부르면 <input> 이 새로 만들어져
      // 한글 조합과 커서 위치가 날아간다(위 검색 입력과 같은 이유).
      if (key === "idExample" || key === "idPattern") {
        var read = document.querySelector("[data-idread]");
        if (read) read.outerHTML = views.idReadback(state.cdraft);
      }
    });
    // 추적표 판정 비고. 타이핑마다 저장하면 요청이 글자 수만큼 나간다 —
    // 입력을 마치고 포커스가 떠날 때(change) 저장한다.
    document.addEventListener("change", function (e) {
      var el = e.target.closest ? e.target.closest("[data-cvnote]") : null;
      if (el) actions.setRtmNote(el.getAttribute("data-cvnote"), el.value);
    });
    // 누락 다시 찾기 힌트 — 타이핑은 state 에만, Enter 는 찾기.
    document.addEventListener("input", function (e) {
      var el = e.target.closest ? e.target.closest("[data-hint]") : null;
      if (el) state.chint[el.getAttribute("data-hint")] = el.value;
    });
    document.addEventListener("keydown", function (e) {
      if (!e.target.matches || !e.target.matches("[data-hint]")) return;
      if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); actions.searchMissing(e.target.getAttribute("data-hint")); }
    });
    // 폴더 검토의 외부 원천값. 타이핑마다 render하면 포커스가 끊기므로 state만
    // 갱신한다. 확정 버튼을 누를 때 이 값을 서버가 저장된 문서 필드와 대조한다.
    document.addEventListener("input", function (e) {
      var el = e.target.closest ? e.target.closest("[data-manual-input]") : null;
      if (el) actions.setManualInput(el.getAttribute("data-manual-input"), el.value);
    });
    document.addEventListener("change", function (e) {
      var el = e.target.closest ? e.target.closest("[data-manual-input]") : null;
      if (el) render();
    });
    // 기록 검색 입력은 목록 밖에 둔다. 한글 조합 중에도 입력 DOM과 캐럿을 보존한다.
    document.addEventListener("input", function (e) {
      if (!e.target || !e.target.hasAttribute("data-history-q")) return;
      state.historyQ = e.target.value;
      state.historyOffset = 0;
      closeHistoryActions();
      clearTimeout(historySearchTimer);
      if (state.historyPage) state.historyPage.busy = true;
      repaintHistoryRecords();
      historySearchTimer = setTimeout(function () { loadHistoryPage(); }, 250);
    });
    document.addEventListener("focusin", function (e) {
      if (!e.target.closest('.history-actions-wrap')) closeHistoryActions();
    });
    document.addEventListener("keydown", function (e) {
      var menu = document.querySelector('.history-actions-menu:not([hidden])');
      if (!menu) return;
      if (e.key === "Escape") { e.preventDefault(); closeHistoryActions(true); return; }
      if (["ArrowDown", "ArrowUp", "Home", "End"].indexOf(e.key) < 0 || !menu.contains(e.target)) return;
      e.preventDefault();
      var buttons = Array.prototype.slice.call(menu.querySelectorAll('button'));
      var at = buttons.indexOf(document.activeElement);
      var next = e.key === "Home" ? 0 : e.key === "End" ? buttons.length - 1 :
        (at + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
      if (buttons[next]) buttons[next].focus();
    });
    // 검색어. 위 둘과 달리 **화면이 바뀌어야 한다**(결과 목록). 그렇다고 render()를
    // 부르면 <input> 이 통째로 새로 만들어져 포커스도 캐럿도 조합 중인 한글도
    // 날아간다 — 그래서 결과 목록 노드 하나만 갈아끼운다. 입력 요소는 안 건드리므로
    // IME 도 그대로다(data-reason 이 compositionstart 감시까지 해야 했던 것과
    // 대조적이다 — 저쪽은 render 가 입력을 지웠기 때문이다).
    document.addEventListener("input", function (e) {
      var el = e.target.closest ? e.target.closest("[data-search-q]") : null;
      if (!el) return;
      state.searchQ = el.value;
      renderSearchResults();
    });
    // 위 render()의 reasonComposing 가드와 짝이다. 조합 중엔 render를
    // 건너뛰고 몰아 둔다(위 reasonComposing 선언부 주석 참고 — 조합 중인
    // 글자는 캡처해서 복원할 방법이 없는 유일한 경우다). compositionend가
    // 정상적으로 오면 그 즉시 밀린 렌더를 흘려보낸다.
    //
    // watchdog: 일부 브라우저/IME 조합은 compositionend를 아예 안 보내는
    // known issue가 있다 — 그대로 두면 reasonComposing이 영원히 true로 남아
    // render()가 앱 전체에서 사실상 멈춘다(새로고침밖에 방법이 없다). 그래서
    // 조합 시작 후 일정 시간이 지나도 종료 신호가 없으면 강제로 풀고 밀린
    // 렌더를 흘려보낸다. 값은 넉넉히 잡는다 — 실제 조합은 보통 수백 ms 안에
    // 끝나므로, 이 타이머가 발동하는 건 사실상 비정상 상황뿐이다.
    var REASON_COMPOSE_WATCHDOG_MS = 4000;
    document.addEventListener("compositionstart", function (e) {
      if (!(e.target && e.target.closest && e.target.closest("[data-reason]"))) return;
      reasonComposing = true;
      if (reasonComposeWatchdog) clearTimeout(reasonComposeWatchdog);
      reasonComposeWatchdog = setTimeout(function () {
        reasonComposeWatchdog = null;
        reasonComposing = false;
        flushReasonRender();
      }, REASON_COMPOSE_WATCHDOG_MS);
    });
    document.addEventListener("compositionend", function (e) {
      if (!(e.target && e.target.closest && e.target.closest("[data-reason]"))) return;
      if (reasonComposeWatchdog) { clearTimeout(reasonComposeWatchdog); reasonComposeWatchdog = null; }
      reasonComposing = false;
      flushReasonRender();
    });
    // focusout에는 아무것도 걸지 않는다 — 위 reasonComposing 선언부 주석
    // 참고: 다른 버튼을 누르면 그 click보다 먼저 focusout이 발생하므로,
    // 여기서 render를 흘려보내면 방금 누른 버튼의 DOM 노드가 클릭이
    // 델리게이션에 닿기도 전에 사라져 클릭이 조용히 씹힌다.
    // 드롭은 네모 안에 정확히 놓지 않아도 받는다. **화면에 드롭존이 하나뿐이면**
    // 어디에 놓아도 그 하나로 보낸다 — 갈 곳이 하나인데 조준을 요구할 이유가 없다
    // (단일 검토·폴더 검토가 그렇다). 비교 검토는 A·B 둘이라 어디에 놓았는지가
    // 곧 어느 쪽인지이므로 넓히지 않는다 — 넓히면 우리가 찍어서 배정하게 된다.
    function soleZone(sel) {
      var all = document.querySelectorAll(sel);
      return all.length === 1 ? all[0] : null;
    }
    function zoneOf(e) {
      return (e.target && e.target.closest ? e.target.closest("[data-drop]") : null) ||
        soleZone("[data-drop]");
    }
    // 빗나간 드롭을 삼킨다. 안 그러면 브라우저가 그 파일로 페이지를 이동해
    // 지금까지 올려둔 것이 통째로 날아간다 — 비교 검토에서 A를 올려두고 B를
    // 빗맞히면 A까지 잃는다. 드롭존이 있는 화면에서만 건다.
    function hasZone() { return !!document.querySelector("[data-drop],[data-casedrop]"); }
    document.addEventListener("dragover", function (e) { if (hasZone()) e.preventDefault(); });
    document.addEventListener("drop", function (e) { if (hasZone()) e.preventDefault(); });
    // 끌고 있을 때는 hover 와 같은 신호(강조색 점선 + 브랜드 면). 밝기 4% 만
    // 낮추던 때는 손에 든 순간이 마우스만 올린 때보다 약했다(2026-09-04).
    // 끌기 중엔 :hover 가 안 걸리는 브라우저가 있어 인라인으로 준다.
    function dragOn(z) { z.style.borderColor = "var(--accent)"; z.style.background = "var(--state-hover-brand)"; }
    function dragOff(z) { z.style.borderColor = ""; z.style.background = ""; }
    document.addEventListener("dragover", function (e) { var z = zoneOf(e); if (z) { e.preventDefault(); dragOn(z); } });
    // dragleave 는 자식 요소를 지날 때마다 뜬다. 화면 전체가 드롭 대상이 된
    // 뒤로는 그때마다 강조를 껐다 켜면 끄는 쪽이 눈에 남는다 — 창 밖으로
    // 나간 것(relatedTarget 없음)만 원상복구한다. 드롭했을 때는 drop 이 지운다.
    document.addEventListener("dragleave", function (e) {
      if (e.relatedTarget) return;
      var z = zoneOf(e); if (z) dragOff(z);
    });
    function caseZoneOf(e) {
      return (e.target && e.target.closest ? e.target.closest("[data-casedrop]") : null) ||
        soleZone("[data-casedrop]");
    }
    document.addEventListener("dragover", function (e) {
      // 끌어다 놓는 중의 강조도 점선 카드 hover와 같은 브랜드 상태면으로 쓴다.
      // 선택 상태용 --accent-weak보다 옅어, 아직 드롭하지 않은 상태와 구별된다.
      var z = caseZoneOf(e); if (z) { e.preventDefault(); z.style.background = "var(--state-hover-brand)"; }
    });
    document.addEventListener("dragleave", function (e) {
      if (e.relatedTarget) return;      // 위 dragleave 주석 참고 — 창 밖만
      var z = caseZoneOf(e); if (z) z.style.background = "";
    });
    document.addEventListener("drop", function (e) {
      var kz = caseZoneOf(e); if (!kz) return;
      e.preventDefault(); kz.style.background = "";
      var dt = e.dataTransfer;
      // 폴더는 dataTransfer.files 에 이름만 담겨 온다 — webkitGetAsEntry 로
      // 내려가야 안이 나온다. 브라우저가 그걸 안 주면 파일만이라도 받는다.
      //
      // dt 는 핸들러가 끝나면 비워지므로 fallback 을 **여기서** 떠 둔다.
      // 메서드가 있는지만 보고 들어왔다가 그게 null 만 돌려주면(합성 드롭·
      // 일부 브라우저) 0건으로 조용히 끝나, 사용자는 드롭이 씹힌 줄도 모른다.
      var fallback = dt && dt.files ? Array.prototype.slice.call(dt.files) : [];
      if (dt && dt.items && dt.items.length && dt.items[0].webkitGetAsEntry) {
        collectDropped(dt.items, function (files) {
          actions.addCaseFiles(files.length ? files : fallback);
        });
      } else if (fallback.length) {
        actions.addCaseFiles(fallback);
      }
    }, true);
    document.addEventListener("drop", function (e) {
      var z = zoneOf(e); if (!z) return;
      if (caseZoneOf(e)) return;          // 케이스 드롭존은 위에서 처리했다
      e.preventDefault(); dragOff(z);
      var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) handleFile(z.getAttribute("data-drop"), z.getAttribute("data-nav"), file);
    });
    // 전체화면은 헤더 버튼 말고 Esc로도 빠져나온다. 화면을 다 덮고 있어 다른
    // 곳을 눌러 나가는 길이 없으므로, 갇힌 느낌이 들지 않게 관례대로 받아둔다.
    // 검색창도 Esc 로 닫는다. 전체화면보다 먼저 본다 — 전체화면 위에서 검색을
    // 열었으면 Esc 한 번에 둘 다 닫히는 게 아니라 위엣것부터 닫혀야 한다.
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      if (state.helpOpen) { actions.closeHelp(); return; }
      if (state.rev.criteriaOpen) { actions.closeReviewCriteria(); return; }
      if (state.searchOpen) { actions.toggleSearch(); return; }
      if (state.viewerFull) actions.toggleViewerFull();
    });
    // 키보드 접근 — 지적 카드·탭·심각도 칩은 div/span 이라 클릭 위임만 받는다.
    // tabindex(views.js)로 포커스를 받은 요소의 Enter/Space 를 클릭으로 잇는다.
    // 네이티브 버튼·입력은 브라우저가 이미 하므로 건드리지 않는다(Space 스크롤도
    // 그쪽에선 preventDefault 하면 안 된다).
    // 추적표 키보드. 25 건을 마우스로만 하면 지친다 — j/k 로 옮기고 1/2/3 으로
    // 판정한다. 입력 칸(비고)에 있을 때는 안 가로챈다: 거기선 1 이 글자다.
    document.addEventListener("keydown", function (e) {
      if (state.mode !== "compare" || state.cstep !== "results" || state.cview) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      var t = e.target, tag = t && t.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" ||
          (t && t.isContentEditable)) return;
      // _rtmKeys 는 생성된 뷰 객체(_views)에 있다. window.DR.views 는 공장 함수라
      // 거기서 찾으면 늘 undefined — 처음 넣은 날부터 1·2·3 이 안 먹었던 이유다(2026-09-08).
      var rows = (_views && _views._rtmKeys) ? _views._rtmKeys() : [];
      if (!rows.length) return;
      var at = rows.indexOf(state.crtmCursor);
      var move = function (d) {
        var next = at < 0 ? (d > 0 ? 0 : rows.length - 1)
                          : Math.min(rows.length - 1, Math.max(0, at + d));
        state.crtmCursor = rows[next];
        if (!repaintCompareTrace()) render();
        var el = document.getElementById("rtm-" + rows[next]);
        if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
      };
      if (e.key === "j" || e.key === "ArrowDown") { e.preventDefault(); move(1); return; }
      if (e.key === "k" || e.key === "ArrowUp") { e.preventDefault(); move(-1); return; }
      var word = { "1": "만족함", "2": "수정필요", "3": "해당사항없음" }[e.key];
      if (!word || at < 0) return;
      var vkey = (_views._rtmVkey || function () { return ""; })(state.crtmCursor);
      if (!vkey) return;
      e.preventDefault();
      actions.setRtmVerdict(vkey + "|" + word);
      // 판정하면 다음 줄로 — 하나 누르고 손을 옮기지 않아도 이어진다.
      move(1);
    });

    document.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      var el = e.target;
      if (!el || !el.getAttribute || el.getAttribute("data-act") == null) return;
      var tag = el.tagName;
      if (tag === "BUTTON" || tag === "A" || tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      e.preventDefault();
      el.click();
    });
    // 홈 타일 포인터 글로우 — 커서 자리를 CSS 변수로 넘기면 ::after 의
    // radial-gradient 가 그 자리를 밝힌다(index.html [data-glow]). 마우스가
    // 있는 환경에서만 건다 — 터치에는 커서가 없다. .dr-app 이 zoom 을 쓰므로
    // 화면 좌표를 요소의 CSS 좌표로 되돌릴 때 zoom 으로 나눈다.
    if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
      document.addEventListener("mousemove", function (e) {
        var t = e.target && e.target.closest ? e.target.closest("[data-glow]") : null;
        if (!t) return;
        var r = t.getBoundingClientRect();
        var z = t.currentCSSZoom || 1;
        t.style.setProperty("--mx", ((e.clientX - r.left) / z) + "px");
        t.style.setProperty("--my", ((e.clientY - r.top) / z) + "px");
      });
    }
    // 브라우저 뒤로가기·앞으로가기. 쌓아둔 항목을 지금 갈 수 있는 화면으로
    // 고쳐(resolveNav — 결과가 비워졌으면 업로드로, 로그인한 채 로그인 화면
    // 으로는 안 돌아간다) 그 화면을 되살린다.
    window.addEventListener("popstate", function (e) {
      if (!e.state) return;              // 앱이 쌓은 칸이 아니다
      // 기록이 실린 항목은 화면 종류만 되살리지 않고 **그 기록을 다시 연다** —
      // 종류만 되살리면 그 항목 이름 밑에 지금 데이터가 뜬다. lastNavKey 를
      // 그 항목의 키로 미리 맞춰, 열기 완료 렌더가 새로 푸시하지 않게 한다.
      var rid = e.state.recordId;
      if (rid && state.user && !state.hbusy) {
        var rsub = e.state.mode === "single" ? e.state.screen
          : e.state.mode === "compare" ? e.state.cstep
          : e.state.mode === "evaluate" ? e.state.estep
          : e.state.mode === "case" ? e.state.kstep : "";
        navRestoreKey = e.state.mode + (rsub ? "/" + rsub : "") + "#" + rid;
        state.navRecordId = rid;
        if (rid.indexOf("cl-") === 0) actions.startChecklistRun(rid.slice(3));
        else actions.openHistory(rid);
        return;
      }
      var to = _H.resolveNav(e.state, {
        loggedIn: !!state.user, reviewed: state.reviewed, compared: state.compared,
        hasRecog: !!state.kase.recog, hasPayload: !!state.kase.payload,
        hasCrun: !!state.crun.checklist, hasDraft: !!state.evalv.payload
      });
      navApplying = true;
      // 가는 모드의 단계만 만진다 — 다른 흐름의 단계까지 초기화하면, 검토를
      // 마친 단일 검토가 사이드바로 돌아왔을 때 결과 대신 업로드로 떨어진다.
      if (to.mode === "single") state.screen = to.screen;
      else if (to.mode === "compare") { state.cstep = to.cstep; state.cview = null; }
      else if (to.mode === "case") { state.kase.step = to.kstep; state.kase.view = null; }
      else if (to.mode === "evaluate") state.estep = to.estep;
      if (to.mode === "single" || to.mode === "compare" || to.mode === "case" ||
          to.mode === "evaluate") {
        state.profileMenuOpen = false; state.searchOpen = false; state.notiOpen = false;
        state.mode = to.mode;
        if (to.mode === "single" && !state.clib.list.length) actions.loadChecklists();
        render();
      } else {
        actions.setMode(to.mode);        // 목록 재조회 등 부수효과째로, render 포함
      }
      navApplying = false;
    });
    // 테마는 index.html 의 <head> 스크립트가 첫 페인트 전에 이미 걸어놨다
    // (안 그러면 흰 화면이 번쩍인다). 여기선 그 값을 state 로 받아오기만 한다 —
    // 두 곳에서 각자 계산하면 설정 화면의 선택 표시가 실제 화면과 어긋난다.
    state.theme = document.documentElement.getAttribute("data-theme") === "dark"
      ? "dark" : "light";
    loadServerConfig();
    // 세션 복원. 쿠키가 살아 있으면 로그인 화면을 건너뛴다 — 새로고침마다 다시
    // 로그인시키면 검토 중 실수로 F5 를 누른 사람이 처음부터 다시 해야 한다.
    // 서버가 없으면(정적 미리보기) 그냥 로그인 화면이다.
    // **세션을 확인하기 전에는 아무것도 그리지 않는다.**
    // 예전엔 state.mode 가 "login" 인 채로 먼저 그리고 그다음 세션을 물었다 —
    // 쿠키가 살아 있는 사람에게는 새로고침마다 로그인 화면이 번쩍 떴다가
    // 홈으로 바뀌었다(2026-09-02 지적). 화면이 거짓말을 한 셈이다.
    //
    // 서버가 없으면(정적 미리보기) 물어볼 데가 없으니 바로 로그인 화면이다.
    var firstPaint = function () {
      (function waitData() {
        if (window.DOCREVIEW) render();
        else setTimeout(waitData, 60);
      })();
    };
    if (servedOverHttp()) {
      fetch("api/auth/me").then(function (res) {
        if (!res.ok) throw new Error("no session");
        return res.json();
      }).then(function (acc) {
        applyAccount(acc);
        // 원문 창은 홈으로 안 간다 — 이 응답이 문서를 연 뒤에 도착하면 창이 홈으로
        // 바뀌어 버렸다(2026-09-08, "원문 누르면 홈이 뜬다"). 문서를 여는 흐름은 boot 의
        // 팝업 분기가 진다.
        if (!state.popup) state.mode = "home";
        loadHomeCriteria();
        firstPaint();
        // 첫 그림 뒤 2.5초 동안은 응답이 올 때마다가 아니라 80ms 에 한 번 그린다.
        renderHoldMs = 80;
        setTimeout(function () { renderHoldMs = 0; }, 2500);
        loadHistory();
        // 새로고침 전에 걸어둔 검토가 아직 돌고 있으면 여기서 되찾는다 —
        // 스트림은 놓았지만 검토는 서버에서 계속 돌고 있었다.
        loadJobs();
      }).catch(function () { firstPaint(); loadHistory(); });
    } else {
      firstPaint();
      loadHistory();
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
