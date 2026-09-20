(function () {
  "use strict";
  window.DR = window.DR || {};
  // 뷰 레이어: 심각도 팔레트·뷰모델(renderVals)·문서 미리보기·검토결과 HTML·
  // 화면 템플릿(view). state/props/render와 backend 일부를 주입받아 app.js와
  // 같은 상태를 그린다. 반환 함수를 app.js의 render()가 호출한다.
  window.DR.views = function (ctx) {
    var state = ctx.state, props = ctx.props, render = ctx.render;
    var ICONS = window.DR.ICONS;
    var H = window.DR.helpers;
    var esc = H.esc, fmtSize = H.fmtSize, download = H.download, downloadBlob = H.downloadBlob;
    var docSides = H.docSides;
    var be = ctx.backend, errorBanner = be.errorBanner, ago = be.ago, fmtElapsed = be.fmtElapsed;

  // 지적 id → 그 지적을 낸 기준 본문들. renderVals 가 매 렌더마다 채운다.
  // 수정안 호출이 기준을 함께 보내려면 화면 밖에서도 읽을 수 있어야 한다.
  var _critByFinding = {};

  // 기준 본문. 한 지적이 기준 여럿에 걸리면 줄바꿈으로 잇는다.
  // 층(scope)의 화면 표기. 서버 값 "업로드"는 계약이라 그대로 받고, 화면은
  // "추가"라고 부른다(2026-09-01 결정 — 셋째 층의 이름은 "추가 기준"이다.
  // 라이브러리의 개별 파일·Lv2 판정지는 여전히 체크리스트라고 부른다).
  function scopeLabel(scope) {
    return scope === "업로드" ? "추가" : scope;
  }

  function criterionTextFor(id) {
    var cs = _critByFinding[id];
    return (cs && cs.length) ? cs.join("\n") : "";
  }

  // ---- severity / type palette (one dot + soft badge) ----------------------
  //
  // dot 은 **통짜 색 조각**이고 fg 는 **연한 면 위 글자**다. 일이 다르니 값도
  // 다르다. 한 번 dot 을 fg 토큰으로 맞춰 봤는데(2026-08-12), 라이트에서
  // --sev-min-fg 가 #854D0E 라 범례 점이 갈색이 됐다 — fg 는 연한 노랑 면 위에서
  // 6.21:1 을 내려고 어둡게 고른 값이지, 그 자체로 "노랑"을 뜻하라고 고른 값이
  // 아니다. 색 토큰은 **역할이 다르면 못 돌려 쓴다.**
  //
  // 그래서 그 자리에 hex 를 박아 뒀는데(2026-09-02 정리), 그러면 다크에서 점만
  // 안 뒤집혀 패널 위에 진흙색으로 가라앉는다. 답은 그때 주석이 이미 적어 둔
  // 대로다 — --sev-*-dot 을 **따로 만든다.** 역할이 다르면 토큰을 하나 더 둔다.
  // **라벨은 이 축이 무엇인지 말해야 한다.** severity 는 "얼마나 나쁜가"(중대성)가
  // 아니라 **"이 판정을 얼마나 믿을 수 있나"(확실성)** 다 — shared/models.py 의
  // Severity 독스트링이 정한 축이다. 그런데 화면은 Major/Minor 라고 불렀고,
  // 검토자는 그걸 "심각/경미"로 읽었다. Minor 가 특히 정반대로 읽힌다:
  // 실제 뜻은 "네가 확인해야 한다"인데 "덜 급하다"로 읽혀 그냥 넘어간다.
  //
  // 중대성("이 문서 그대로 낼 수 있나")은 팀이 정할 값이지 도구가 정할 값이
  // 아니다(CLAUDE.md "기능 방침 — 점수"와 같은 이유). 기준이 등급을 채워 주면
  // 그때 별도 축으로 싣는다 — 지금은 지어내지 않는다.
  //
  // **화면은 확실/확인 필요를 가르지 않는다**(2026-09-14 품질팀: "어차피 검토자가
  // 한 번 더 보니까 굳이 나누지 말까"). 데이터의 sev(major/minor)는 그대로다 —
  // 정렬·이력 대조·내보내기가 쓴다. 화면에서는 둘 다 `지적` 하나로 보이고 색도
  // 같다. 칩·범례·요약은 SEV_GROUPS 로 센다.
  var SEV = {
    major:    { dot: "var(--sev-maj-dot)", bg: "var(--sev-maj-bg)", fg: "var(--sev-maj-fg)", bd: "var(--sev-maj-bd)", label: "지적" },
    minor:    { dot: "var(--sev-maj-dot)", bg: "var(--sev-maj-bg)", fg: "var(--sev-maj-fg)", bd: "var(--sev-maj-bd)", label: "지적" },
    issue:    { dot: "var(--sev-maj-dot)", bg: "var(--sev-maj-bg)", fg: "var(--sev-maj-fg)", bd: "var(--sev-maj-bd)", label: "지적" },
    info:     { dot: "var(--sev-info-dot)", bg: "var(--sev-info-bg)", fg: "var(--sev-info-fg)", bd: "var(--sev-info-bd)", label: "검토 상태" },
    // 미검토는 심각도가 아니라 "검사를 못 했다"는 보고다. 뱃지(sevBadge)처럼
    // 면을 채우지 않는다 — 채우면 지적으로 읽힌다.
    unreviewed: { dot: "var(--neutral-dot)", bg: "transparent", fg: "var(--text-3)", bd: "var(--line-2)", label: "미검토" },
    // 누락은 실패가 아니라 결함 — 지적과 같은 주황. 빨강은 실패·오류에만 쓴다(2026-09-16).
    missing:  { dot: "var(--sev-maj-dot)", bg: "var(--sev-maj-bg)", fg: "var(--sev-maj-fg)", bd: "var(--sev-maj-bd)" },
    mismatch: { dot: "var(--sev-maj-dot)", bg: "var(--sev-maj-bg)", fg: "var(--sev-maj-fg)", bd: "var(--sev-maj-bd)" },
    conflict: { dot: "var(--sev-maj-dot)", bg: "var(--sev-maj-bg)", fg: "var(--sev-maj-fg)", bd: "var(--sev-maj-bd)" },
    unknown:  { dot: "var(--neutral-dot)", bg: "var(--neutral-weak)", fg: "var(--text-2)", bd: "var(--line)", label: "Other" }
  };
  // 검사기(checker) → 필터 분류. 필터 칩은 내부 검사기 이름이 아니라 이 분류로
  // 묶는다 — 검토자에게 "필수 항목 확인"과 "칸 값 검사"는 같은 형식 검사다.
  var CHECKER_CAT = {
    completeness: ["form", "형식 검사"],
    consistency: ["expr", "표현 검사"],
    consistency_doc: ["expr", "표현 검사"],
    consistency_evidence: ["expr", "표현 검사"],
    traceability: ["trace", "추적 검사"],
    field_match: ["trace", "추적 검사"],
    case_wide: ["trace", "추적 검사"],
    parser: ["process", "검토 과정"],
    images: ["process", "검토 과정"]
  };
  var CAT_ORDER = ["form", "expr", "trace", "process", "etc"];
  // 분류 칩 — 짧은 이름을 적은 작은 알약. 아이콘만 두니 파랑·보라가 뭔지 아무도 몰랐다
  // (2026-09-15). 이름은 검사 필터(형식 검사·표현 검사·추적 검사)와 같은 말이라 따로 배울 게 없다.
  // 색은 index.html .pill.cat-* 가 갖는다.
  var CAT_SHORT = { form: "형식", expr: "표현", trace: "추적", process: "과정", etc: "기타" };
  function catChip(cat, title) {
    var key = CAT_LABEL[cat] ? cat : "etc";
    return '<span class="pill pill-cat cat-' + key + '" title="' + esc(title || CAT_LABEL[key] || "") + '">' +
      esc(CAT_SHORT[key]) + '</span>';
  }
  var CAT_LABEL = { form: "형식 검사", expr: "표현 검사", trace: "추적 검사",
                    process: "검토 과정", etc: "기타" };
  // 추적 대조(비교 검토)의 색. 심각도와 **같은 신호를 쓴다** — 검토자에게
  // "누락"은 어느 화면에서나 같은 빨강이어야 한다. 예전엔 여기만 라이트 전용
  // hex 넷씩(면·글자·테두리까지)이라, 다크에서 흰 면에 빨간 글씨가 그대로 남았다.
  var TM = {
    // 누락은 실패가 아니라 결함 — 지적과 같은 주황. 빨강은 실패·오류에만 쓴다(2026-09-16).
    missing:  { dot: "var(--sev-maj-dot)", bg: "var(--sev-maj-bg)", fg: "var(--sev-maj-fg)", bd: "var(--sev-maj-bd)" },
    mismatch: { dot: "var(--sev-maj-dot)", bg: "var(--sev-maj-bg)", fg: "var(--sev-maj-fg)", bd: "var(--sev-maj-bd)" },
    extra:    { dot: "var(--sev-info-dot)", bg: "var(--sev-info-bg)", fg: "var(--sev-info-fg)", bd: "var(--line-2)" },
    // 검토 상태 보고는 지적이 아니다 — 면을 채우지 않는다(미검토 뱃지와 같은
    // 처방). 채우면 또 하나의 결함으로 읽힌다.
    notice:   { dot: "var(--neutral-dot)", bg: "transparent", fg: "var(--text-3)", bd: "var(--line-2)" }
  };

  // 체크리스트 아이콘. 체크리스트 화면과 홈이 같은 것을 쓴다 — 사본을 만들지 않는다.
  var glyphs = {
    generic: ICONS.list,
    prd: ICONS.fileText,
    api: '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>'
  };

  var ORDER = ["major", "minor", "info"];

  // 지적의 위치를 **사람이 읽는 말**로. 절 id(§22.1)는 파서가 매긴 내부 순번이라 문서
  // 어디에도 없다 — 검토자가 "§23 이 어디지" 를 되물었다(2026-09-16). 기본은 쪽수,
  // 제목이 문서 번호("3.0", "7.2.", "Appendix B")로 시작하면 그 번호만 덧붙인다. 제목
  // 글자는 안 보여 준다 — 제목 없는 쪽(표지·부록·표)이 많고, 위치 표시로는 무겁다.
  function locOf(f) {
    var D = window.DOCREVIEW || {}, sid = f && f.section ? String(f.section) : "";
    var num = "";
    if (sid) {
      var sec = (D.sections || []).filter(function (s) { return String(s.id) === sid; })[0];
      num = docSectionNo(String((sec && sec.title) || ""));
    }
    var page = f && f.page ? f.page + "쪽" : "";
    if (page && num) return page + " · " + num;
    return num || page || "문서 전체";
  }
  // 제목 첫머리의 문서 번호. "3.0 References" → "3.0절", "Appendix B …" / "부록 B" → "부록 B".
  function docSectionNo(title) {
    var t = title.replace(/\s+/g, " ").trim();
    var m = /^(\d+(?:\.\d+)*)\.?(?=\s|$)/.exec(t);
    if (m) return m[1] + "절";
    var a = /^(?:appendix|부록)\s*([A-Za-z0-9]+)/i.exec(t);
    if (a) return "부록 " + a[1].toUpperCase();
    return "";
  }
  // 화면 묶음: 지적 = major+minor, 검토 상태 = info(SEV 주석 참고).
  var SEV_GROUPS = [{ k: "issue", sevs: ["major", "minor"] }, { k: "info", sevs: ["info"] }];
  function sevGroupCounts(counts, sevFilter) {
    return SEV_GROUPS.map(function (g) {
      var c = { sev: g.k, label: SEV[g.k].label,
                count: g.sevs.reduce(function (n, k) { return n + (counts[k] || 0); }, 0) };
      if (sevFilter) c.on = g.sevs.every(function (k) { return !!sevFilter[k]; });
      return c;
    });
  }

  // ---- animation gating ---------------------------------------------------
  // 화면 전체를 매번 다시 그리는 구조라, 애니메이션을 그냥 붙이면 칩 하나만 눌러도
  // 목록 전체가 다시 재생된다. 직전 렌더와 비교해 "방금 바뀐 것"에만 붙인다.
  // 화면에 막 들어온 뒤에도 렌더가 한 번 더 오는 경우가 있다 (검토가 끝나면 이력을
  // 다시 불러오면서 10ms 뒤에 또 그린다). 그 렌더가 등장 연출을 지워버리므로,
  // 진입 직후 잠깐은 연출을 유지하고 지나간 만큼 딜레이를 당겨 이어붙인다.
  var ENTER_WINDOW = 250;
  // 마지막 카드의 지연(최대 300ms) + 재생 시간(300ms)까지 이어 붙인다.
  var LIST_ENTER_WINDOW = 600;
  // 홈의 인사·기준 도식 모션은 250ms보다 길다. API 응답으로 중간 렌더가 와도
  // 음수 지연으로 같은 시점부터 이어지도록 별도 창을 둔다.
  var HOME_ENTER_WINDOW = 1800;
  var prev = { key: null, visit: 0, at: 0, selected: null, stage: -1, cstage: -1,
               ready: null, readyAt: 0, booted: false };
  function animFlags(st) {
    // 현재 보이는 화면만 비교한다. 다른 검토의 백그라운드 진행은 화면 이동이 아니다.
    var step = st.mode === "single" ? st.screen
      : st.mode === "compare" ? st.cstep + (st.cview ? "/document" : "")
      : st.mode === "case" ? (st.kase || {}).step + ((st.kase || {}).view ? "/document" : "") : "";
    var key = st.mode + "/" + step;
    var now = Date.now();
    // 첫 화면(새로고침 직후)은 **쉬는 상태로** 그린다 — 타일이 아래에서 올라오고
    // 화면이 옅게 들어오는 등장 연출은 "다른 화면에서 왔다"는 말이라, 아무 데서도
    // 오지 않은 새로고침에는 맞지 않는다. 게다가 그 250ms 동안 설정·이력·작업
    // 응답이 도착해 다시 그려지면 연출과 겹쳐 버벅인다(2026-09-04 실측: 첫 1초에
    // 다섯 번). 다음 화면으로 옮긴 뒤부터 연출이 켜진다. 홈의 인사(손짓·기준
    // 도식)는 제자리 연출이라 그대로 둔다(homeEntered).
    if (key !== prev.key) { prev.booted = prev.key !== null; prev.key = key; prev.at = now; prev.visit++; }
    var elapsed = now - prev.at;
    // "검토 시작"·"비교 시작"은 파일이 붙어야 나타난다. 그 등장 연출을 매 렌더마다
    // 주면 **프로필 메뉴를 여닫기만 해도 버튼이 다시 튀어 오른다**(2026-09-02
    // 지적) — render() 가 화면을 통째로 다시 그리기 때문이다. 파일이 바뀐 때를
    // 기준으로 재고, 아래 화면들이 음수 지연으로 이어 붙인다(body 의 fadeIn 과
    // 같은 수법: 진입 창 안에 다시 그려져도 처음부터 되감기지 않는다).
    var ready = (st.files.single ? "s" : "") + (st.files.compareA ? "a" : "") +
                (st.files.compareB ? "b" : "");
    if (ready !== prev.ready) { prev.ready = ready; prev.readyAt = now; }
    var readyElapsed = now - prev.readyAt;
    var f = {
      readyEntered: readyElapsed < ENTER_WINDOW,
      readyElapsed: readyElapsed,
      entered: prev.booted && elapsed < ENTER_WINDOW,
      listEntered: prev.booted && elapsed < LIST_ENTER_WINDOW,
      enterElapsed: elapsed,
      homeEntered: st.mode === "home" && elapsed < HOME_ENTER_WINDOW,
      homeEnterElapsed: elapsed,
      openedId: st.selected && st.selected !== prev.selected ? st.selected : null,
      // 방금 완료로 넘어간 단계 (없으면 -1)
      doneStage: st.stageIndex !== prev.stage ? st.stageIndex - 1 : -1,
      cdoneStage: st.cstageIndex !== prev.cstage ? st.cstageIndex - 1 : -1
    };
    prev.selected = st.selected;
    prev.stage = st.stageIndex; prev.cstage = st.cstageIndex;
    return f;
  }

  // 이번 검토에 **실제로 합쳐지는 층만** 추린다. /api/criteria 는 관리 화면도
  // 함께 쓰므로 업로드 기준을 전부 돌려주지만, 단일 검토는 그중 사람이 고른
  // checklist_id 하나만 쓴다. 공통 → 팀 → 업로드 순 중복 제거도 서버의
  // resolve_criteria 와 같아야 화면의 항목 수가 실제 작업량보다 부풀지 않는다.
  function reviewCriteriaInfo(clayers, uploadedId, llmEnabled, open) {
    var src = (clayers && clayers.list) || [];
    var seenText = Object.create(null), usedNo = Object.create(null);
    var counts = { rule: 0, expression: 0, whole: 0, manual: 0, disabled: 0 };
    var layers = src.filter(function (L) {
      return !L.editable || (!!uploadedId && L.id === uploadedId);
    }).map(function (L) {
      var items = (L.items || []).filter(function (it) {
        var key = String(it.text || "").trim();
        if (Object.prototype.hasOwnProperty.call(seenText, key)) return false;
        seenText[key] = true;
        return true;
      }).map(function (it) {
        var copy = {};
        Object.keys(it).forEach(function (k) { copy[k] = it[k]; });
        var no = String(copy.no || "");
        if (no && usedNo[no]) copy.no = no + "(" + L.scope + ")";
        usedNo[no] = true;

        if (copy.howChecked === "규칙 · 자동") counts.rule++;
        else if (copy.howChecked === "LLM · 자동" && !llmEnabled) {
          counts.disabled++;
          copy.howChecked = "AI 꺼짐 · 미검토";
        } else if (copy.howChecked === "LLM · 자동" && copy.mode === "LLM-문서") {
          counts.whole++;
        } else if (copy.howChecked === "LLM · 자동") counts.expression++;
        else counts.manual++;
        return copy;
      });
      return { scope: L.scope, id: L.id, name: L.name, editable: L.editable,
               error: L.error || "", items: items };
    });
    return {
      layers: layers,
      total: layers.reduce(function (n, L) { return n + L.items.length; }, 0),
      counts: counts,
      busy: !!(clayers && clayers.busy),
      error: (clayers && clayers.error) || "",
      loaded: !!(clayers && clayers.list),
      open: !!open
    };
  }

  // ---- derive view-model --------------------------------------------------
  function renderVals() {
    var D = window.DOCREVIEW, st = state, mode = st.mode;
    var anim = animFlags(st);
    var meta = D.sevMeta;

    // INFO는 검토 과정 보고이고 unreviewed는 검사를 못 했다는 보고다. 둘을 모두
    // "지적 발견"으로 세면 문제 수를 부풀리고, 반대로 미검토가 있는데 "기준 통과"
    // 라고 하면 더 위험하다. 그래서 미검토는 심각도 통에 섞지 않고 따로 센다 —
    // 필터 칩도 이 넷을 그대로 쓴다(info 를 꺼도 미검토 보고는 남아야 한다).
    var counts = { major: 0, minor: 0, info: 0, unreviewed: 0 };
    var issueCount = 0, unreviewedCount = 0, dismissedCount = 0;
    var hiddenIds = hiddenFindingIds();
    D.findings.forEach(function (f) {
      if (f.unreviewed) { counts.unreviewed++; unreviewedCount++; return; }
      if (hiddenIds[f.id]) { dismissedCount++; return; }   // 검토자가 뺀 것 — 지적으로 안 센다
      counts[f.sev]++;
      if (f.sev !== "info") issueCount++;   // counts.<등급> 직접 읽기는 가드가 막는다
    });
    var total = D.findings.length;

    // sidebar
    var featDefs = [
      { k: "home", label: "홈", icon: ICONS.home },
      // 끝을 "검토"로 맞춘다. 예전엔 축이 섞여 있었다 — "단일 검토"는 범위+동작,
      // "문서 비교"는 대상+동작, "산출물 세트"는 대상만 있고 동작이 없었다.
      // 이제 앞말이 **방식**이고 뒷말이 다 검토다: 문서 하나 안에서(단일),
      // 두 문서를 맞대어(비교), 폴더째 한 세트로(폴더).
      { k: "single", label: "단일 검토", icon: ICONS.single }, { k: "compare", label: "비교 검토", icon: ICONS.compare },
      { k: "case", label: "폴더 검토", icon: ICONS.folder },
      // 같은 축이다: 팀 평가 체크리스트를 잣대로 문서 하나를 훑어 부록 B 초안을 만든다.
      { k: "evaluate", label: "체크리스트 검토", icon: ICONS.checklist },
      { k: "checklists", label: "검토 기준", icon: ICONS.list }, { k: "history", label: "검토 기록", icon: ICONS.history },
      { k: "settings", label: "설정", icon: ICONS.settings }
    ].filter(function (d) { return !d.hidden; });
    var features = featDefs.map(function (d) { return { k: d.k, label: d.label, icon: d.icon, on: mode === d.k }; });

    // header + step tabs
    var heads = {
      login: ["", ""],
      signup: ["", ""],
      forgot: ["", ""],
      home: ["홈", "기능을 선택하세요"],
      single: ["단일 검토", "한 문서를 검토 기준으로 검토"],
      compare: ["비교 검토", "SRS ↔ SDD 교차검토"],
      "case": ["폴더 검토", "폴더째 올려 — 낱장마다 보고, 서로 맞춰본다"],
      evaluate: ["체크리스트 검토", "문서 + 과제 평가 체크리스트 → 평가표 초안"],
      checklists: ["검토 기준", "공통·팀 기준과 내가 등록한 추가 기준"],
      checklistrun: ["검토 기준", "항목별 판정"],
      history: ["검토 기록", "최근 실행 내역"],
      assistant: ["어시스턴트", "검토 결과에 대해 묻습니다"],
      settings: ["설정", "LLM · 청크 · 테마"]
    };
    var steps = [], hasSteps = false;
    if (mode === "single") {
      hasSteps = true;
      steps = [["upload", "업로드"], ["progress", "검토"], ["results", "검토 결과"]].map(function (p) {
        return { act: "go", k: p[0], label: p[1], on: st.screen === p[0] };
      });
    } else if (mode === "compare") {
      hasSteps = true;
      // 같은 단계는 같은 이름으로 부른다. 비교의 results도 "리포트"가 아니라 지적사항 목록이다.
      steps = [["setup", "업로드"], ["progress", "비교"], ["results", "검토 결과"]].map(function (p) {
        return { act: "goCStep", k: p[0], label: p[1], on: st.cstep === p[0] };
      });
    } else if (mode === "evaluate") {
      hasSteps = true;
      steps = [["setup", "업로드"], ["progress", "작성중"], ["results", "초안"]].map(function (p) {
        return { act: "goEStep", k: p[0], label: p[1], on: st.estep === p[0] };
      });
    } else if (mode === "case") {
      // 산출물 세트만 단계 표시가 없어서 지금 어디쯤인지, 몇 단계가 남았는지
      // 화면에 안 나왔다. 다른 기능과 같은 이름을 쓴다 — "인식 확인"만 이
      // 기능 고유 단계다(폴더째 올리니 무엇이 무엇인지 사람이 확인해야 한다).
      hasSteps = true;
      steps = [["upload", "업로드"], ["recognize", "인식 확인"],
               ["progress", "검토"], ["results", "검토 결과"]].map(function (p) {
        return { act: "goCaseStep", k: p[0], label: p[1], on: st.kase.step === p[0] };
      });
    }

    // 목록은 서버(GET /api/health)가 준 것만 쓴다. 예전엔 docreview-data.js 의
    // 목업(Generic·PRD·API Spec)을 그렸는데, 그 셋은 서버에 존재하지도 않았고
    // 골라도 전달되지 않아 "고르는 시늉"만 하는 UI였다. 서버를 아직 못 읽었으면
    // 빈 목록 — 없는 기준을 지어내느니 아무것도 안 보여주는 편이 낫다.
    var srvChecklists = (st.server && st.server.checklists) || [];
    var pickedChecklist = st.checklist || (st.server && st.server.checklist_id) || "";

    // 업로드 문서를 재본 결과. 잘못된 기준의 실패는 에러가 아니라 조용한 0건이라
    // (같은 실 문서인데 PLT34는 FR-GC_01, PLT56은 FR1-0305 — 서로 0개다),
    // 검토를 돌리기 **전에** 몇 개 걸리는지 보여줘야 한다.
    var dt = st.detect;
    var detectRow = dt && !dt.busy && !dt.error
      ? (dt.list || []).filter(function (d) { return d.id === pickedChecklist; })[0]
      : null;
    // 지금 고른 기준으로 찾은 요건 ID 개수. null이면 아직 재지 않았다 —
    // "0개"와 "모름"은 다르다. 모르는 걸 0으로 그리면 없는 경고가 뜬다.
    var detectCount = detectRow ? detectRow.matches : null;
    var detectBest = (dt && dt.best) || "";
    // id_pattern 이 없는 체크리스트(단일문서용 rvvr-standard 등)는 애초에 요건
    // ID 를 보지 않는다. 매칭 0개를 결함처럼 경고하면 정상 사용에서 붉은 띠가
    // 떠 배너 자체가 무시된다 — 경고를 무시하게 만드는 경고는 없느니만 못하다.
    var detectScored = !!(detectRow && detectRow.has_pattern);
    var detectWarn = (detectScored && detectCount === 0)
      ? ("이 기준으로는 요건 ID를 한 개도 찾지 못했습니다. 이대로 검토하면 "
         + "수정 사항 0건이 뜨는데, 그건 통과가 아니라 검토를 못 한 것입니다."
         + (detectBest ? " 이 문서에는 '" + detectBest + "' 기준이 맞습니다." : ""))
      : "";
    var detectAuto = !!(detectBest && !st.checklistPicked && detectBest === pickedChecklist);
    // 비교 슬롯별 감지 — 전역(state.detect)과 같은 파생 규칙을 지금 고른 기준에
    // 적용한다. "0개"와 "아직 모름"을 절대 섞지 않는다.
    function slotDetect(slot) {
      if (!st.files[slot]) return null;
      var d = st.cdetect && st.cdetect[slot];
      if (!d) return null;
      if (d.busy) return { busy: true };
      if (d.error) return { error: d.error };
      var row = (d.list || []).filter(function (x) { return x.id === pickedChecklist; })[0];
      if (!row) return { unknown: true };
      return { scored: !!row.has_pattern, count: row.matches,
               example: row.id_example || "",
               format: row.id_format || "",
               // 찾은 ID 자체. 화면이 "이 문서가 맡은 범위" 후보를 만드는 데 쓴다.
               ids: row.ids || [] };
    }
    var cslotDetect = { compareA: slotDetect("compareA"), compareB: slotDetect("compareB") };
    var checklistCards = srvChecklists.map(function (c) {
      return { id: c.id, name: c.name, glyph: glyphs[c.id] || ICONS.list,
               sel: pickedChecklist === c.id,
               reqLabel: c.doc_type ? c.doc_type : "팀 기준" };
    });

    // AI 검토를 켤지 끌지만 고른다. 어떤 모델을 쓸지는 서버 설정이 정한다 —
    // 브라우저가 provider를 고를 수 있으면 사내 문서를 외부 API로 내보내는
    // 경로가 열린다. 모델 이름도 지어내지 않고 서버가 답한 것만 보여준다.
    var srv = st.server;
    var llmChips = [];
    var llmNote = "";
    if (!srv) {
      llmNote = "서버에 연결되지 않아 무엇으로 검토하는지 알 수 없습니다.";
    } else if (srv.llm_provider === "echo") {
      llmNote = "서버에 AI 모델이 설정되지 않았습니다. 규칙 검사만 돕니다.";
    } else {
      // 그림 해석용 모델이 붙어 있으면 그 사실을 칩에 단다. 검토자가 "그림을
      // 읽었는지"를 알아야 결과를 옳게 읽는다 — 안 읽었으면 그림 안의 표·구성도는
      // 검토되지 않은 것이다. 안 붙어 있을 때 따로 경고하지는 않는다: 검토 결과에
      // "그림 N장을 읽지 않았습니다"가 지적으로 올라오므로 그쪽이 근거다.
      llmChips = [
        { k: "off", label: "규칙만 · 빠름", on: st.llm === "off" },
        { k: "on",
          label: shortModel(srv.llm_label || srv.llm_model) + " · 사내"
                 + (srv.vlm_enabled ? " · 그림 포함" : ""),
          on: st.llm === "on" }
      ];
    }

    // 단일 검토 진행 화면. 준비 3단계는 0.1초에 끝나므로 요약 한 줄로 접고,
    // 몇 분이 걸리는 Review를 본무대로 올린다 — 레인마다 실제 작업 단위
    // (규칙·LLM 호출)의 완료 수를 센다.
    var rv = st.rev || { prep: {}, lanes: [], done: {}, active: "" };
    var prepParts = [];
    if (rv.prep.ingestion) prepParts.push(rv.prep.ingestion);
    if (rv.prep.normalize) prepParts.push(rv.prep.normalize);
    if (rv.prep.chunking) prepParts.push(rv.prep.chunking);
    var lanes = (rv.lanes || []).map(function (l) {
      // 열쇠는 label — kind("chunk")는 표현 점검과 문서 전체 점검이 공유해서
      // 유일하지 않다(api.js 의 step 처리 주석 참고).
      var done = rv.done[l.label || l.kind] || 0;
      var key = l.label || l.kind;
      return { kind: l.kind, label: key, total: l.total, doneCount: done,
        description: l.description || "", scope: l.scope || "", limited: !!l.limited,
        // 서버가 시작 이벤트에 active를 싣는다. 첫 완료 전에도 실제로 도는 레인은
        // 진행 중이고, 아직 차례가 오지 않은 레인만 대기다.
        status: l.total <= 0 ? "empty"
          : (done >= l.total ? "done" : (rv.active === key ? "run" : "wait")) };
    });
    var unitsDone = lanes.reduce(function (a, l) { return a + l.doneCount; }, 0);
    var unitsTotal = lanes.reduce(function (a, l) { return a + l.total; }, 0);
    var review = {
      prep: prepParts.join(" · "),
      prepReady: prepParts.length === 3,
      prepMs: rv.prepAt && rv.startedAt ? rv.prepAt - rv.startedAt : 0,
      lanes: lanes,
      note: rv.note || "",
      // 총량을 미리 받았을 때만 퍼센트를 말한다. 모르면 지어내지 않는다.
      pct: unitsTotal > 0 ? Math.round((unitsDone / unitsTotal) * 100) : null,
      elapsed: rv.startedAt ? fmtElapsed(Date.now() - rv.startedAt) : ""
    };
    review.criteria = reviewCriteriaInfo(st.clayers, st.reviewChecklistId,
                                         st.llm !== "off", rv.criteriaOpen);

    // pipelines
    // 이전 서버·저장 기록의 영문 표시명도 같은 사용자용 단계명으로 표시한다.
    var stageLabels = { Ingestion: "문서 읽기", Alignment: "요건 연결",
      "Cross-check": "문서 간 대조", Report: "결과 정리" };
    function mkTimeline(stages, idx, justDone) {
      return stages.map(function (s, i) {
        var done = i < idx, active = i === idx;
        return { label: stageLabels[s.label] || s.label, desc: s.desc,
          // 서버가 방금 보고한 값만 그린다(state.stageDetail). 비교 stage는 key가 없어
          // 조회가 비므로 detail 줄이 그려지지 않는다 — 목업 숫자를 대신 끌어오지 않는다.
          detail: (st.stageDetail || {})[s.key] || "",
          done: done, active: active,
          statusLabel: done ? "완료" : (active ? "진행 중" : "대기"),
          justDone: done && i === justDone,
          // 앞 단계가 방금 닫혔으면 지금 진행 중인 단계가 곧 방금 열린 단계다.
          justOpened: active && justDone >= 0 };
      });
    }
    // 완료 비트 동안에는 마지막 단계도 체크로 넘긴다 — 다 끝났는데 마지막 점이
    // 계속 돌고 있으면 "완료"라는 말과 화면이 서로 다른 소리를 한다.
    var sIdx = st.done ? D.stages.length : st.stageIndex;
    var cIdx = st.cdone ? D.compare.stages.length : st.cstageIndex;
    var pipeline = mkTimeline(D.stages, sIdx, st.done ? D.stages.length - 1 : anim.doneStage);
    var progressPct = st.stageIndex < 0 ? 0 : Math.round(((st.stageIndex + 1) / D.stages.length) * 100);
    var cpipeline = mkTimeline(D.compare.stages, cIdx, st.cdone ? D.compare.stages.length - 1 : anim.cdoneStage);
    var cProgressPct = st.cstageIndex < 0 ? 0 : Math.round(((st.cstageIndex + 1) / D.compare.stages.length) * 100);

    // findings table
    var sevChips = sevGroupCounts(counts, st.sevFilter).filter(function (c) { return c.count > 0; });
    // 미검토 칩은 있을 때만 — 0 이면 "미검토 0" 이 헤더 자리를 먹는다.
    if (counts.unreviewed) {
      sevChips.push({ sev: "unreviewed", label: "미검토", count: counts.unreviewed, on: st.sevFilter.unreviewed });
    }
    // 이 칩들은 체크박스가 아니라 보기 전환이다. `확실`을 눌렀는데 확실한 결과가
    // 사라지는 역동작을 없애고, 누른 종류만 보여준다. 전체로 돌아갈 길도 첫 칩에 둔다.
    var allSevOn = sevChips.every(function (c) { return c.on; });
    // 내부 필터 값은 전체 보기일 때 모두 true지만, 버튼까지 전부 선택 표시하면
    // 다중 선택처럼 보인다. 화면 선택 상태는 `전체` 하나만 켜고 나머지는 눌리지
    // 않은 선택지로 둔다. 실제 필터 값(st.sevFilter)은 그대로라 결과는 모두 보인다.
    if (allSevOn) sevChips.forEach(function (c) { c.on = false; });
    sevChips.unshift({ sev: "all", label: "전체", count: total, on: allSevOn });
    // 검사기 필터는 내부 이름(필수 항목 확인·parser…)이 아니라 검토자가 아는
    // 분류로 묶는다 — "필수항목확인이 뭔데?"를 필터가 만들지 않는다(2026-08-14
    // 사용자 피드백). 세부 이름은 카드 뱃지(label · kind)가 계속 말한다.
    var checkerCatOf = function (c) { return (CHECKER_CAT[c] || ["etc", "기타"])[0]; };
    var seenCat = {};
    D.findings.forEach(function (f) { seenCat[checkerCatOf(f.checker)] = true; });
    var checkerOpts = [{ k: "all", label: "전체" }];
    CAT_ORDER.forEach(function (k) {
      if (seenCat[k]) checkerOpts.push({ k: k, label: CAT_LABEL[k] });
    });
    var checkerChips = checkerOpts.map(function (c) {
      return { k: c.k, label: c.label, on: st.checkerFilter === c.k };
    });
    var sortChips = [{ k: "severity", l: "확실도순" }, { k: "section", l: "위치순" }].map(function (o) {
      return { k: o.k, label: o.l, on: st.sort === o.k };
    });
    var filtered = D.findings.filter(function (f) {
      // 미검토 보고는 sev(대개 info)가 아니라 자기 칩이 가린다 — info 를 꺼도 남는다.
      var on = f.unreviewed ? st.sevFilter.unreviewed : st.sevFilter[f.sev];
      return on && (st.checkerFilter === "all" || checkerCatOf(f.checker) === st.checkerFilter);
    });
    var sortFn = st.sort === "section"
      ? function (a, b) { var pa = a.section || "", pb = b.section || ""; if (!pa && pb) return -1; if (pa && !pb) return 1; return pa.localeCompare(pb, undefined, { numeric: true }); }
      : function (a, b) { return meta[a.sev].order - meta[b.sev].order; };
    // 번호는 표시본이 지면에 찍은 것을 그대로 쓴다. 화면이 따로 매기면 "3번"이
    // 서로 다른 것을 가리켜 번호를 다는 목적이 깨진다. 표시본을 아직 안 만들었으면
    // 번호가 없다 — 번호가 형광펜에 매달려 있어 PDF를 훑기 전에는 정해지지 않는다.
    // 번호는 뷰어 오버레이(POST /api/locate)가 형광펜에 매긴 것을 그대로 쓴다.
    // 화면이 따로 매기면 "3번"이 형광펜과 카드에서 서로 다른 것을 가리킨다.
    var markNumbers = {}, markQuoteNos = {};
    ((st.marks && st.marks.items) || []).forEach(function (it) {
      if (it.no) markNumbers[it.id] = it.no;
      // 인용별 번호(evidence 순서, 못 찾은 인용은 null). 같은 절의 인용이 둘이면
      // 번호 없이는 카드에서 둘째 인용의 위치를 알 길이 없다.
      if (it.quote_nos) markQuoteNos[it.id] = it.quote_nos;
    });
    // finding.id → 그 지적을 품은 기준 라벨. payload 는 항목→지적 방향만 준다
    // (criteriaResults.items[].findings 가 평면 findings 와 같은 dict 참조) —
    // 카드·수정안에서 쓰도록 역으로 만든다. checklist는 옛 payload 호환 폴백이다.
    var critByFinding = {}, critLayerByFinding = {};
    ((((D.criteriaResults || D.checklist) || {}).items) || []).forEach(function (it) {
      (it.findings || []).forEach(function (f) {
        (critByFinding[f.id] = critByFinding[f.id] || []).push(it.text || it.no || "");
        // 층(공통/팀별/업로드)은 표시용으로만 따로 든다 — 수정안 프롬프트에
        // 보내는 기준 본문(critByFinding)에 섞으면 모델에게 잡음이다.
        (critLayerByFinding[f.id] = critLayerByFinding[f.id] || []).push(it.layer || "");
      });
    });
    // 수정안(/api/suggest)이 이 맵을 쓴다 — renderVals 안의 지역 변수라 밖에서
    // 못 읽으므로 마지막 것을 여기 둔다. 기준을 모르면 모델이 어느 방향으로
    // 고칠지 알 수 없다(SI 단위계는 "5kg" 가 아니라 "5 kg" 가 맞다).
    _critByFinding = critByFinding;
    function critLabel(id) {
      var cs = critByFinding[id];
      if (!cs || !cs.length) return "";
      // 공통·팀은 늘 도는 기준이지만 업로드는 검토자가 고른 것이다 — 어느 층의
      // 기준이 낸 지적인지 앞에 단다.
      var layer = (critLayerByFinding[id] || [])[0];
      var head = (layer ? "[" + layer + "] " : "") + cs[0];
      return cs.length === 1 ? head : (head + " 외 " + (cs.length - 1) + "건");
    }
    // 이번에만 나온 지적. 예전에는 반영 확인 패널이 이 목록을 **따로 한 번 더**
    // 그려서 같은 지적이 위아래에 두 번 보였다. 목록을 없애고 카드에 표시만 단다.
    var newIds = {};
    ((D.lineage && D.lineage.new_findings) || []).forEach(function (f) {
      if (f && f.id) newIds[f.id] = true;
    });
    // 검토자가 `해당없음` 으로 정리한 지적. **카드를 지우지는 않는다** — 기계가
    // 낸 것을 화면이 삼키면 안 되고(CLAUDE.md), 검사기는 다음에도 그 지적을 낸다.
    // 대신 "이건 이미 해당없음으로 정리됐다"를 카드가 말한다. 안 그러면 검토자가
    // "해당없다고 했는데 왜 또 뜨지" 를 매번 다시 겪는다.
    var naIds = lineageNaIds() || {};
    var tableFindings = filtered.slice().sort(sortFn).map(function (f) {
      var open = st.selected === f.id;
      // kind(모순·표기·모호)를 빠뜨리면 뱃지가 종류를 못 그린다. 이 자리는 payload
      // 를 화면용으로 **다시 짓는 곳**이라, 새 필드는 여기 적어야 살아 넘어간다.
      return { id: f.id, open: open, sev: f.sev, unreviewed: !!f.unreviewed, checker: f.checker, kind: f.kind || "",
        label: f.label || "", message: f.message, rescued: !!f.rescued,
        rescueTrace: f.rescue_trace || null,
        isNew: !!newIds[f.id], na: !!naIds[f.id], hidden: hiddenIds[f.id] || "",
        no: markNumbers[f.id] || null,
        quoteNos: markQuoteNos[f.id] || [],
        criteria: critLabel(f.id),
        // 체커가 단 제안. 없으면 없는 대로 둔다 — 예전엔 "위치를 확인해
        // 수정하세요."를 대신 채워 넣고 'AI 제안'이라 이름 붙였는데, 그건
        // 화면이 지어낸 문구지 AI가 만든 것이 아니다.
        // 절이 없는 지적(문서 전체를 보는 info 등)의 위치 표기. "doc" 은 디버그
        // 문자열처럼 읽혔다 — 화면·내보내기가 같은 한국어를 쓴다.
        suggestion: f.suggestion || "", loc: locOf(f),
        // 검증을 통과한 원문 인용. 카드가 이걸 직접 보여준다(findingCardInner).
        evidence: f.evidence || [],
        chevron: open ? "▾" : "▸" };
    });

    // 미리보기. 고른 지적이 가리키는 절과, 그 지적이 들고 온 원문 인용.
    // 규칙 체커는 근거를 안 달아 quotes가 빈다 — 그 경우 절로 스크롤만 한다.
    var selected = null;
    D.findings.forEach(function (f) { if (f.id === st.selected) selected = f; });
    var hlSection = selected ? selected.section : null;
    // 절 id → 그 절에서 칠할 인용들. 근거가 자기 위치를 들고 오므로 그대로 쓴다.
    // 절을 모르는 근거(section=null)는 지적이 가리키는 절에 붙인다.
    var hlBySection = {};
    (selected && selected.evidence || []).forEach(function (e) {
      var sid = e.section || hlSection;
      if (!sid) return;
      // 심각도 색으로 칠한다. 예전엔 앰버 한 색이라, 같은 문서를 PDF 로 보면
      // 3색(pdfview) · 텍스트 재현본으로 보면 1색 · 내보내면 다시 3색이었다.
      (hlBySection[sid] = hlBySection[sid] || []).push(
        { q: e.quote, cls: "sev-" + selected.sev });
    });

    // summary
    // ORDER 를 돌린다 — 등급을 더하거나 빼도 여기를 같이 고칠 필요가 없다.
    // (예전엔 counts.critical 을 직접 읽어서, 등급이 빠지면 undefined 로 NaN 이 됐다.)
    var groupRows = sevGroupCounts(counts);
    var maxCount = Math.max.apply(null, groupRows.map(function (g) { return g.count; }).concat(1));
    var statRows = groupRows.map(function (g) {
      return { sev: g.sev, label: g.label, count: g.count, pct: Math.round(g.count / maxCount * 100) };
    });
    var chk = { completeness: 0, consistency: 0 };
    // 모르는 checker 이름이 오면 NaN이 되지 않게 막는다 (엔진에 체커가 추가될 수 있다).
    D.findings.forEach(function (f) { if (chk[f.checker] !== undefined) chk[f.checker]++; });
    var checkerCards = [{ label: "completeness", glyph: ICONS.check, count: chk.completeness }, { label: "consistency", glyph: ICONS.equal, count: chk.consistency }];
    var topFindings = D.findings.slice().sort(function (a, b) { return meta[a.sev].order - meta[b.sev].order; }).slice(0, 3).map(function (f) {
      return { sev: f.sev, sevLabel: SEV[f.sev].label, message: f.message, loc: locOf(f) };
    });
    // 점수(100 - 가중 감점)는 뺐다. 근거는 CLAUDE.md "기능 방침 — 점수".
    // 요약하면: 가중치도 구간도 실측 근거가 없었고, critical 항은 발동조차 하지
    // 않았으며, info 는 "못 봤다"는 보고인데 감점이었다. 눈금을 검증할 정답셋
    // (golden/)이 생기기 전에는 다시 넣지 않는다.

    // compare
    var cmp = D.compare;
    var compareFindings = cmp.findings.slice().sort(function (a, b) { return meta[a.sev].order - meta[b.sev].order; }).map(function (f) {
      return { id: f.id, type: f.type, typeLabel: D.typeMeta[f.type].short, sev: f.sev,
        aLoc: f.a ? "§" + f.a : "—", bLoc: f.b ? "§" + f.b : "—", aOn: !!f.a, bOn: !!f.b,
        // 검토 상태 보고는 문서 자리를 안 가리킨다 — `— ↔ —` 를 그리면 자리를
        // 못 찾은 지적처럼 읽힌다.
        locOn: f.type !== "notice",
        // 출처: 누락·근거없음은 규칙(문자열 대조)이 확정한 것이고, 불일치는 AI 가
        // 서술을 읽고 올린 후보다. 검토자가 신뢰 수준을 가려 읽게 배지로 단다.
        // 보고는 둘 다 아니다 — 검사가 어떻게 됐나를 말할 뿐이라 출처가 없다.
        origin: f.type === "notice" ? "" : (f.type === "mismatch" ? "AI 대조" : "규칙 대조"),
        requirementId: f.requirement_id || "",
        message: f.message, suggestion: f.suggestion };
    });
    var coverage = cmp.stats.requirements
      ? Math.round(cmp.stats.matched / cmp.stats.requirements * 100) : 0;
    var cmpStatCards = [
      { label: "누락", count: cmp.stats.missing, color: TM.missing.dot },
      { label: "불일치", count: cmp.stats.mismatch, color: TM.mismatch.dot },
      { label: "근거 없음", count: cmp.stats.extra, color: TM.extra.dot }
    ];
    // 부모 수준에서만 검증된 세부 요건(FR-GC_01_01 → FR-GC_01). 누락은 아니지만
    // 연결과도 다르다 — 커버리지 분모에는 들어가므로 감추면 "누락 0인데 커버리지는
    // 63%"가 되어 나머지가 어디서 왔는지 화면만 봐서는 알 수 없다.
    if (cmp.stats.rolled_up) {
      cmpStatCards.push({ label: "부모 수준 검증", count: cmp.stats.rolled_up, color: "var(--sev-info-dot)" });
    }
    // 범위 밖(부분 설계서가 담당하지 않는 상위 요건)은 누락이 아니다.
    // 그렇다고 감추지도 않는다 — 개수를 띄워 사용자가 범위를 확인하게 한다.
    if (cmp.stats.out_of_scope) {
      cmpStatCards.push({ label: "범위 밖", count: cmp.stats.out_of_scope, color: "var(--neutral-dot)" });
    }
    // 추적표(보고서 부록 B의 재료). 순방향 = 상위 요건 순서 그대로, 역방향 = 하위에만
    // 있는 ID(orphan). payload 에 rtm 이 없으면(옛 이력) 표 없이 지적 목록만 남는다.
    var RTM_LABEL = { linked: "ID 연결됨", missing: "하위 연결 없음", out_of_scope: "범위 밖",
                      rolled_up: "부모 ID만 연결", orphan: "상위 근거 없음" };
    var RTM_COLOR = { linked: "var(--band-good-fg)", missing: TM.missing.dot,
                      out_of_scope: "var(--neutral-dot)", rolled_up: "var(--sev-info-dot)", orphan: TM.extra.dot };
    // 상태 알약은 지적 배지와 같은 문법(badge: bg·fg·bd 토큰)을 쓴다 — 새 색을
    // 만들지 않고 심각도·판정 신호색을 그대로 입는다.
    var RTM_PAL = {
      missing: { bg: "var(--sev-maj-bg)", fg: "var(--sev-maj-fg)", bd: "var(--sev-maj-bd)" },
      orphan: { bg: "var(--sev-min-bg)", fg: "var(--sev-min-fg)", bd: "var(--sev-min-bd)" },
      rolled_up: { bg: "var(--sev-info-bg)", fg: "var(--sev-info-fg)", bd: "var(--sev-info-bd)" },
      linked: { bg: "var(--band-good-bg)", fg: "var(--band-good-fg)", bd: "var(--band-good-bg)" },
      out_of_scope: { bg: "transparent", fg: "var(--text-3)", bd: "var(--line-2)" }
    };
    // 같은 ID가 양쪽에 있다는 것과 내용이 충돌하지 않는다는 것은 다른 사실이다.
    // 추적 상태와 내용 대조 상태를 한 알약에 섞지 않고 같은 행 안의 두 신호로 둔다.
    var CONTENT_META = {
      // 엑셀(rtm_xlsx)과 같은 말. "모순 후보"는 우리 안의 말이라 받는 사람이 물었다.
      conflict: { label: "AI: 문장이 어긋나 보임", cls: "is-conflict" },
      unreviewed: { label: "AI 대조 못 함", cls: "is-unreviewed" },
      no_conflict: { label: "AI: 어긋난 문장 없음", cls: "is-clear" },
      not_reviewed: { label: "내용 대조 안 함", cls: "is-idle" },
      not_applicable: { label: "", cls: "is-idle" }
    };
    // 서술 블록에서 사람이 읽을 한 줄을 뽑는다.
    //
    // 예전엔 **첫 줄만** 보고 ID 를 지운 나머지를 썼다. 그게 통하는 문서도 있지만
    // (요구사항 목록 표 "| ID | 제목 |"), PRJX-AN-002 처럼 ID 가 항목-값 표에
    // 들어 있으면("| 식별자 사례 | RQ-… |") 칸 이름만 남아 **31 줄이 전부
    // "식별자 사례"** 가 됐다(2026-09-02 지적: 보기 어렵다).
    //
    // 그래서 블록 전체를 훑어 **가장 긴 값**을 고른다. 칸 이름은 짧고 요건
    // 서술은 길다 — 라벨 목록을 코드에 박지 않고도 갈린다. 짧은 것밖에 없으면
    // 빈 채로 둔다: 없는 제목을 지어내느니 ID 만 보이는 편이 낫다.
    function rtmTitle(text, id) {
      // "| 제목 | X |" 처럼 제목 칸이 있으면 그것. 제일 긴 칸을 고르면 설명 칸이
      // 뽑혀 목록에 서술 전문이 실렸다(2026-09-08).
      var m = /\|\s*제목\s*\|\s*([^|\n]{2,80}?)\s*\|/.exec(String(text || ""));
      if (m && m[1].indexOf(id) < 0) return m[1].trim();
      var best = "";
      String(text || "").split("\n").forEach(function (line) {
        var t = line.replace(/\[\s*ID\s*:[^\]]*\]/gi, "").trim();
        if (!t) return;
        var cells = t.indexOf("|") >= 0
          ? t.split("|").map(function (x) { return x.trim(); })
          : [t];
        cells.forEach(function (c) {
          // ID 자체와 ID 를 품은 칸은 제목이 아니다. 순수 숫자·기호도 뺀다.
          if (!c || c === id || c.indexOf(id) >= 0) return;
          if (!/[가-힣A-Za-z]/.test(c)) return;
          if (c.length > best.length) best = c;
        });
      });
      // 너무 짧으면 칸 이름일 뿐이다(실측: "식별자 사례" 6자, 진짜 요건명 15자+).
      return best.length >= 8 ? best : "";
    }
    // 판정어 팔레트 — 부록 A 어휘 그대로. 기계 관찰 알약과 같은 badge 문법.
    var VERDICT_PAL = {
      "만족함": { bg: "var(--band-good-bg)", fg: "var(--band-good-fg)", bd: "var(--band-good-bg)" },
      "수정필요": { bg: "var(--sev-maj-bg)", fg: "var(--sev-maj-fg)", bd: "var(--sev-maj-bd)" },
      "해당사항없음": { bg: "var(--sev-info-bg)", fg: "var(--sev-info-fg)", bd: "var(--sev-info-bd)" }
    };
    // 지난 회차 한 줄. 이어받은 행은 태그가 대신 말하므로 비운다. 행에 문자열로
    // 실어 보낸다 — 표를 그리는 함수는 다른 스코프라 RTM_LABEL 이 안 보인다.
    function rtmPriorHtml(prior, carried, status) {
      if (!prior || carried) return "";
      // 지난 회차가 **말해 주는 게 있을 때만** 적는다: 판정을 눌렀었거나, 기계 관찰이
      // 이번과 달라졌거나. 지난번도 누락·이번도 누락에 "지난 회차: 하위 연결 없음"은
      // 아무 정보도 아니다(2026-09-08 지적).
      var changed = prior.status && status && prior.status !== status;
      if (!prior.verdict && !changed) return "";
      var parts = [];
      if (prior.verdict) parts.push(prior.verdict);
      if (changed) parts.push((RTM_LABEL[prior.status] || prior.status) + " → 이번 " + (RTM_LABEL[status] || status));
      return '<div style="font-size:11px;color:var(--text-3);margin-bottom:4px;">지난 회차: ' +
        esc(parts.join(" · ")) + (prior.note ? ' — ' + esc(prior.note) : '') + '</div>';
    }
    // **여러 줄이 같은 제목이면 그건 제목이 아니다.**
    // 길이 문턱만으로는 "요구사항 상세 설명" 같은 긴 칸 이름을 못 거른다.
    // 같은 글자가 세 줄 넘게 나오면 그 문서의 표 구조를 잘못 읽은 것이므로
    // 전부 비운다 — 같은 제목 31 줄은 아무것도 안 알려주고 ID 만 가린다.
    var titleSeen = Object.create(null);
    (cmp.rtm || []).forEach(function (r) {
      var t = rtmTitle(r.text, r.upper_id || (r.lower_ids || [])[0] || "");
      if (t) titleSeen[t] = (titleSeen[t] || 0) + 1;
    });
    function usefulTitle(text, id) {
      var t = rtmTitle(text, id);
      return (t && titleSeen[t] <= 3) ? t : "";
    }
    // 요건 서술이 사실상 ID 뿐인가. 실측(PRJX): 요구사항명세서의 "식별자 부여
    // 규칙" 절에 ID 가 **예시로** 적혀 있으면 그 표 행이 서술로 잡힌다 —
    // "식별자 사례 | RQ-SFR-VP-01-001". 그 상태로 "비슷한 내용이 없다"고 하면
    // 설계 탓으로 들리는데, 실은 상위 문서를 우리가 못 읽은 것이다.
    function thinStatement(text) {
      var words = String(text || "").replace(/\|/g, " ")
        .split(/\s+/).filter(function (w) {
          return w && !/^[0-9]+$/.test(w) && !/^[A-Za-z0-9-]+$/.test(w);
        });
      return words.length < 4;
    }

    var rtmRows = (cmp.rtm || []).map(function (r, i) {
      var id = r.upper_id || (r.lower_ids || [])[0] || "";
      var vd = st.cverdicts[id] || {};
      // 같은 문서쌍의 지난 회차. 판정·기계 관찰을 행 옆에 둔다 — "수정필요였던
      // 것이 이번엔 어떤가"를 표를 떠나지 않고 읽는다(서버 carry_rtm).
      var prior = (cmp.rtmPrior || {})[id] || null;
      var carriedVd = (cmp.rtmCarried || {})[id] || null;
      // 이어받은 값 그대로일 때만 `지난 판정` 이다. 검토자가 덮어쓰면
      // 이번에 자기가 고른 것이다(반영 확인의 carried 와 같은 규칙).
      var carried = !!carriedVd && carriedVd.verdict === (vd.verdict || "") &&
                    (carriedVd.note || "") === (vd.note || "");
      return { key: "r" + i, vkey: id, verdict: vd.verdict || "", vnote: vd.note || "",
               verdictPal: VERDICT_PAL[vd.verdict] || null,
               carried: carried, priorHtml: rtmPriorHtml(prior, carried, r.status),
               upperId: r.upper_id || "—",
               // 절 제목이 있으면 그것 — 절 id 는 파서 순번일 수 있어(§8.1) 문서에 없다.
               // 자리는 절 제목으로만. 파서가 순서대로 매긴 §번호는 문서에 없는 번호라 안 보여 준다
               // (2026-09-16 지적). 제목도 없으면 쪽 번호가 대신하고, 그것도 없으면 비운다.
               loc: r.section_title ? r.section_title : "—",
               childSectionTitle: r.child_section_title || "",
               lowerIds: (r.lower_ids || []).join(", ") || "—", status: r.status,
               text: r.text || "", childText: r.child_text || "",
               page: r.page || null, childSection: r.child_section || "",
               childPage: r.child_page || null,
               probes: r.probes || [],
               contentStatus: r.content_status || "not_applicable",
               contentMeta: CONTENT_META[r.content_status] || CONTENT_META.not_applicable,
               contentFindings: r.content_findings || [],
               // 요건 서술을 제대로 못 뽑은 행. 짚지 못한 이유가 "없어서"가
               // 아니라 "못 읽어서"라는 것을 화면이 갈라 말한다.
               thinText: thinStatement(r.text || ""),
               title: usefulTitle(r.text, id),
               open: st.crtmOpenKey === "r" + i,
               label: RTM_LABEL[r.status] || r.status,
               pal: RTM_PAL[r.status] || RTM_PAL.out_of_scope,
               color: RTM_COLOR[r.status] || "var(--text-3)" };
    });
    // 요약 카드의 분포 바 — 상위 요건 전체가 어떻게 갈렸는지 한 눈에.
    // 분모는 상위 요건(orphan 은 하위 쪽 이야기라 바에 안 싣고 범례로만 말한다).
    var cmpBarTotal = (cmp.stats.missing || 0) + (cmp.stats.rolled_up || 0) +
                      (cmp.stats.matched || 0) + (cmp.stats.out_of_scope || 0);
    var cmpBar = !cmpBarTotal ? [] : [
      { color: "var(--sev-maj-fg)", n: cmp.stats.missing || 0 },
      { color: "var(--sev-info-fg)", n: cmp.stats.rolled_up || 0 },
      { color: "var(--band-good-fg)", n: cmp.stats.matched || 0 },
      { color: "var(--neutral-strong)", n: cmp.stats.out_of_scope || 0 }
    ].filter(function (seg) { return seg.n > 0; }).map(function (seg) {
      return { color: seg.color, pct: Math.max(2, Math.round(seg.n / cmpBarTotal * 100)) };
    });
    var rtmForward = rtmRows.filter(function (r) { return r.status !== "orphan"; });
    var rtmReverse = rtmRows.filter(function (r) { return r.status === "orphan"; });
    // 읽는 순서 = 검토 순서. 확인할 것(누락)을 위로, 이상 없음(반영됨)을 다음에,
    // 남의 산출물 몫(범위 밖)은 접힌 묶음으로 뺀다 — 32행이 상위 문서 등장
    // 순서대로 나열되면 중요한 몇 건이 잡음에 묻힌다(실측: 누락 5가 범위 밖
    // 20 사이에 흩어져 있었다).
    var RTM_ORDER = { missing: 0, rolled_up: 1, linked: 2, out_of_scope: 3 };
    rtmForward.sort(function (a, b) {
      return (RTM_ORDER[a.status] || 0) - (RTM_ORDER[b.status] || 0);
    });
    var rtmOos = rtmForward.filter(function (r) { return r.status === "out_of_scope"; });
    var rtmForwardMain = rtmForward.filter(function (r) { return r.status !== "out_of_scope"; });
    // 판정 진행. 분모는 이 문서 몫(범위 밖 제외) — 남의 몫까지 세면 영영 안 끝난다.
    var rtmJudgeable = rtmForwardMain.length + rtmReverse.length;
    var rtmJudged = rtmForwardMain.concat(rtmReverse)
      .filter(function (r) { return r.verdict; }).length;
    // 검토자가 실제로 할 일. 도넛 퍼센트보다 이 한 줄이 먼저다.
    var cmpCheckCount = (cmp.stats.missing || 0) + (cmp.stats.extra || 0) + (cmp.stats.mismatch || 0);
    var cmpActionLine = "확인할 것 " + cmpCheckCount + "건 (누락 " + (cmp.stats.missing || 0) +
      " · 근거 없음 " + (cmp.stats.extra || 0) +
      ((cmp.stats.mismatch || 0) ? " · 내용 모순 후보 " + cmp.stats.mismatch : "") +
      ") · 이상 없음 " + (cmp.stats.matched || 0) +
      ((cmp.stats.out_of_scope || 0) ? " · 범위 밖 " + cmp.stats.out_of_scope : "");
    // 범위를 안 넣으면 다른 산출물 몫까지 누락으로 세는데, 그 사정을 화면이
    // 말하지 않으면 낮은 반영률만 보고 문서를 의심하게 된다.
    // 누락이 부풀었을 때 그 사실을 말한다. 문구를 두 번 고쳤다 —
    // "담당 요건 범위를 입력하지 않았습니다"(2026-09-01)는 그 말이 무슨 뜻인지
    // 안 알려줬고, "맡은 요건 ID 의 공통 앞부분"(2026-09-02)은 우리가 지어낸
    // 말이라 더 알 수 없었다. 지금은 **이 문서의 실제 ID 로 예를 든다.**
    var cmpScopeWarn = (!st.cscope && rtmRows.length && !(cmp.stats.out_of_scope || 0))
      ? "누락 " + (cmp.stats.missing || 0) + "건은 실제보다 많을 수 있습니다."
      : "";
    // 고치는 법. 요구사항명세서 한 권을 설계서 여러 권이 나눠 맡는 것이 보통이라,
    // 이 설계서 몫만 세려면 그 요건들의 ID 를 알려줘야 한다.
    var cmpScopeHow = "";
    if (cmpScopeWarn) {
      // 예시는 **이 문서쌍에 실제로 있는 ID** 로 만든다. 지어낸 예(RQ-AA-001)는
      // 자기 문서와 안 닮아 "우리 건 이런 게 아닌데"로 읽힌다.
      var anyId = "";
      (cmp.rtm || []).some(function (r) {
        anyId = r.upper_id || (r.lower_ids || [])[0] || "";
        return !!anyId;
      });
      var head = anyId ? anyId.split("-").slice(0, 3).join("-") : "";
      cmpScopeHow = "요구사항명세서에는 여러 설계서가 나눠 맡은 요건이 다 들어 있습니다. " +
        "이 설계서가 그중 일부만 맡았다면 남의 몫까지 누락으로 세어집니다. " +
        (head
          ? "다시 비교할 때 업로드 화면에서 이 설계서가 맡은 요건 ID 를 적으세요 — " +
            "예를 들어 " + anyId + " 처럼 생긴 요건들을 맡았다면 " + head + " 라고 적으면 됩니다."
          : "다시 비교할 때 업로드 화면에서 이 설계서가 맡은 요건 ID 를 적으세요.");
    }

    // 요건 ID에 귀속되는 결과는 위 rtmRows의 자동 확인·내용 대조에 이미 들어 있다.
    // 여기에는 특정 요건 하나로 연결할 수 없는 문서쌍 전체 기준과 지적만 남긴다.
    // `check`가 새 payload의 안정 키다. 옛 비교 이력의 criteriaResults는 구조상
    // RTM 세 기준만 담았으므로(check 필드 도입 전), RTM 행이 있는 옛 항목도
    // 요건별 판정에 포함된 것으로 본다. 원본 데이터는 이력에 그대로 남는다.
    var cmpAdditional = (function () {
      var c = cmp.criteriaResults;
      var requirementChecks = { rtm_forward: true, rtm_reverse: true, rtm_content: true };
      var rtmIds = Object.create(null);
      rtmRows.forEach(function (r) { if (r.vkey) rtmIds[r.vkey] = true; });
      // 요건 ID 가 필드에 없으면(옛 기록) 문장에서 찾는다 — "하위문서에 누락된 ID: RQ-…" 28건이
      // 전부 "연결되지 않은 결과"로 떨어졌다(2026-09-16). ID 뒤에 글자·숫자·'-' 가 이어지면
      // 다른 ID 의 앞부분이므로 안 친다(RQ-01 ≠ RQ-010).
      var idList = Object.keys(rtmIds);
      var mentionsId = function (text) {
        return idList.some(function (id) {
          var at = text.indexOf(id);
          if (at < 0) return false;
          var next = text.charAt(at + id.length);
          return !next || !/[A-Za-z0-9_-]/.test(next);
        });
      };
      var isLinkedFinding = function (f) {
        var rid = String((f && (f.requirement_id || f.requirementId)) || "");
        if (rid) return !!rtmIds[rid];
        return !!f && mentionsId(String(f.message || ""));
      };
      var byId = {};
      (cmp.findings || []).forEach(function (f) { byId[f.id] = f; });
      var items = ((c && c.items) || []).map(function (it) {
        var originalFindings = (it.findings || []).map(function (f) { return byId[f.id] || f; });
        var unlinkedFindings = originalFindings.filter(function (f) { return !isLinkedFinding(f); });
        return { no: it.no, text: it.text, group: it.group, check: it.check || "", status: it.status,
                 note: it.note || "", mode: it.mode || "",
                 mode_declared: !!it.mode_declared, layer: it.layer || "",
                 _hadFindings: originalFindings.length > 0, findings: unlinkedFindings };
      }).filter(function (it) {
        if (requirementChecks[it.check]) return false;
        if (!it.check && rtmRows.length) return false;
        if (it.status === "na" || it.status === "outofscope") return false;
        // 결과가 전부 요건 행에 붙었다면 기준 항목도 그 행에서 이미 설명된다.
        return !(it._hadFindings && !it.findings.length);
      });
      var claimed = Object.create(null);
      items.forEach(function (it) {
        it.findings.forEach(function (f) { if (f.id) claimed[f.id] = true; });
        delete it._hadFindings;
      });
      // 검토 과정 보고(notice·info — "n건은 판정 못 했다" 따위)는 여기 안 싣는다.
      // 판정할 항목이 아니고, 행에 붙는 것은 그 행의 AI 블록이 이미 말한다.
      var findings = compareFindings.filter(function (f) {
        return !isLinkedFinding(f) && !claimed[f.id] && !(f.type === "notice" && f.sev === "info");
      });
      var total = items.length + findings.length;
      return total ? { items: items, findings: findings, total: total } : null;
    })();
    // 과거 이력을 열 때는 **당시 payload**가 진실이다. 현재 설정의 AI 토글로
    // 설명하면, AI를 끄고 했던 옛 검토를 지금 켜져 있다는 이유로 "대조 완료"라
    // 부르게 된다.
    var analysis = cmp.analysis || {};
    var contentState = analysis.content_match || (st.llm === "off" ? "disabled" : "not_applicable");
    var cmpAiLine = contentState === "completed"
      ? "AI가 연결된 요건 " + cmp.stats.matched + "건에서 명시적 모순 후보를 확인했습니다 — 후보 " + cmp.stats.mismatch + "건."
      : contentState === "disabled"
      ? "AI 내용 대조를 끄고 실행했습니다. ID 기반 추적 결과만 확인하세요."
      : contentState === "unavailable"
      ? "서버에 AI 모델이 없어 내용 대조를 수행하지 못했습니다."
      : contentState === "no_pattern"
      ? "요건 ID 형식이 없어 연결 항목의 내용 대조를 수행하지 못했습니다."
      : "이 기록에는 내용 대조 수행 정보가 없습니다.";
    var workflowLabel = (analysis.parent_kind || "상위 문서") + " → " +
                        (analysis.child_kind || "하위 문서");

    // 단일 검토 셋업에서 "체크리스트로 평가"에 고를 수 있는 목록. 이건 **라이브러리에
    // 올려 등록한 체크리스트**(state.clib.list, /api/checklists)다 — 자동 검토 기준
    // (srvChecklists = YAML)이 아니다. 검토는 이 id 를 서버에서 checklists.get 으로
    // 다시 읽으므로, YAML id 를 보내면 라이브러리에 없어 404 가 난다.
    var reviewChecklistCards = (st.clib.list || []).map(function (c) {
      return { id: c.id, name: c.name, count: c.item_count || 0,
               sel: st.reviewChecklistId === c.id };
    });

    // 체크리스트가 이끈 검토의 항목별 결과(done 이벤트의 payload.checklist,
    // api.js가 window.DOCREVIEW.checklist에 보관). 안 골랐으면(null) 결과
    // 화면은 기존 평면 지적 목록을 그대로 쓴다 — singleResults가 이 값의
    // 존재로 갈린다.
    // 체크리스트 검토(D.checklist)와 보통 검토의 팀 기준 판정(D.criteriaResults)이
    // **같은 부품**을 쓴다 — 서버가 같은 모양으로 보낸다(to_ui_criteria_review_payload).
    var buildCriteriaView = function (c) {
      if (!c) return null;
      // 항목 안의 findings 는 payload.findings 와 같은 dict(참조)라 번호·형광펜
      // 매핑(markNumbers)이 평면 목록과 그대로 맞아떨어진다 — 여기서 새로
      // 매기지 않는다.
      function mapFinding(f) {
        var open = st.selected === f.id;
        // kind(모순·표기·모호)를 빠뜨리면 뱃지가 종류를 못 그린다. 이 자리는 payload
        // 를 화면용으로 **다시 짓는 곳**이라, 새 필드는 여기 적어야 살아 넘어간다.
        return { id: f.id, open: open, sev: f.sev, checker: f.checker, kind: f.kind || "", label: f.label || "", message: f.message,
          rescued: !!f.rescued, rescueTrace: f.rescue_trace || null,
          no: markNumbers[f.id] || null, quoteNos: markQuoteNos[f.id] || [],
          suggestion: f.suggestion || "",
          loc: locOf(f),
          evidence: f.evidence || [], chevron: open ? "▾" : "▸" };
      }
      var items = (c.items || []).map(function (it) {
        return { no: it.no, text: it.text, group: it.group, status: it.status,
          // 기준 자체. 본문만으로는 "이 기준이 뭐였는지"를 알 수 없다 —
          // 공통 기준 본문은 "아래 양식으로"에서 끊겨 있고 세부는 note 에 있다.
          note: it.note || "", mode: it.mode || "",
          layer: it.layer || "",   // 공통/팀별/업로드 — 항목 헤더가 출처를 단다
          findings: (it.findings || []).map(mapFinding) };
      });
      return { items: items, summary: c.summary || { flagged: 0, clean: 0, unreviewed: 0, na: 0, outofscope: 0, noanswer: 0, manual: 0, total: 0 } };
    };
    var checklistReview = buildCriteriaView(D.checklist);
    // 보통 단일 검토의 항목별 판정. 8/24 부터 서버가 계산해 보냈지만 화면은 체크리스트
    // 검토에서만 그렸다(2026-09-16 지적: 종류별 기준이 7할인 팀은 "사람 확인 필요"가
    // 어디 있는지 볼 수 없었다). 기본 화면은 그대로 두고 별도 탭에서만 연다.
    var criteriaReview = D.checklist ? null : buildCriteriaView(D.criteriaResults);

    // 회신본 반영 확인(D.lineage): 이전 지적별 상태(열림/닫힘/해당없음) + 신규 지적.
    // checklistReview 와 같은 패턴 — D 를 읽어 화면용 뷰 오브젝트를 만든다.
    var lineage = lineageView();
    var lineageCandidate = lineageCandidateOf();

    return {
      isLogin: mode === "login", isSignup: mode === "signup", isForgot: mode === "forgot", isHome: mode === "home", files: st.files,
      isSingle: mode === "single", isCompare: mode === "compare",
      isChecklists: mode === "checklists", isHistory: mode === "history", isSettings: mode === "settings",
      isAssistant: mode === "assistant",
      // 로그인한 계정. 설정의 계정 관리 구역이 role 을 본다 — 화면에서 숨기는
      // 것은 편의고, 진짜 관문은 서버(/api/admin/*)다.
      user: st.user,
      // 체크리스트를 채우는 독립 화면. 라이브러리 "검토 시작"과 기록에서
      // 이어서 열 때 둘 다 여기로 온다 — 자동 검토(single/results)와 무관하다.
      isChecklistRun: mode === "checklistrun",
      sUpload: mode === "single" && st.screen === "upload", sProgress: mode === "single" && st.screen === "progress",
      sResults: mode === "single" && st.screen === "results",
      cSetup: mode === "compare" && st.cstep === "setup", cProgress: mode === "compare" && st.cstep === "progress",
      // 체크리스트 검토(부록 B 초안). 단계 이름만 다르고 짜임은 비교 검토와 같다.
      eSetup: mode === "evaluate" && st.estep === "setup",
      eProgress: mode === "evaluate" && st.estep === "progress",
      eResults: mode === "evaluate" && st.estep === "results",
      evalv: st.evalv || {},
      // 진행 화면의 경과. 초안은 항목마다 stage 이벤트가 와서 그때마다 다시 그려진다.
      elapsed: (mode === "evaluate" && st.evalv && st.evalv.startedAt)
        ? fmtElapsed(Date.now() - st.evalv.startedAt) : "",
      kase: st.kase,
      kUpload: mode === "case" && st.kase.step === "upload",
      kRecognize: mode === "case" && st.kase.step === "recognize",
      kProgress: mode === "case" && st.kase.step === "progress",
      kResults: mode === "case" && st.kase.step === "results",
      cResults: mode === "compare" && st.cstep === "results",
      SEV: SEV, TM: TM, anim: anim,
      doc: D.doc, cmp: cmp, llm: st.llm, features: features, hasSteps: hasSteps, steps: steps,
      pipelinePreview: D.stages, headTitle: heads[mode][0], headSub: heads[mode][1],
      checklistCards: checklistCards, llmChips: llmChips,
      reviewChecklistCards: reviewChecklistCards, reviewChecklistId: st.reviewChecklistId,
      outputPick: st.outputPick,
      checklistPickReturn: st.checklistPickReturn,
      checklistReview: checklistReview,
      criteriaReview: criteriaReview,
      criteriaSections: st.criteriaSections || { manual: true },
      lineage: lineage, lineageCandidate: lineageCandidate,
      detectCount: detectCount, detectWarn: detectWarn, detectBest: detectBest,
      detectScored: detectScored,
      clib: st.clib,
      clayers: st.clayers,
      clibDetail: st.clib.detail,
      runChecklistId: st.runChecklistId,
      // 사람이 직접 채우는 체크리스트(독립 화면 checklistrun). 안 골랐으면
      // (checklist null) 화면이 안내 문구만 보여준다 — v.crun 이 그 신호다.
      crun: (function () {
        var c = st.crun.checklist;
        if (!c) return null;
        var items = (c.items || []).map(function (it, i) {
          // 결과는 no 가 아니라 배열 위치(i)로 찾는다 — no 는 선택 안 하면
          // 전부 "" 이고 구간별 재시작으로 겹칠 수 있어, no 를 키로 쓰면 같은
          // no 를 가진 다른 항목까지 판정된 것처럼 보인다.
          var r = st.crun.results[String(i)] || {};
          return { idx: i, no: it.no, text: it.text, group: it.group,
                   verdict: r.verdict || null, reason: r.reason || "" };
        });
        return { name: c.name, items: items, saving: st.crun.saving,
                 saved: !!st.crun.savedAt,     // 저장 후 아직 안 고쳤다 — "저장됨" 표시
                 error: st.crun.error || null,
                 // 뒤로가기 대상("checklists"|"history")과 이 화면에서 적은
                 // 검토 대상 문서명 — 둘 다 checklistRunScreen 헤더가 쓴다.
                 from: st.crun.from || "checklists",
                 documentName: st.crun.documentName || "",
                 // 안 본 항목 개수. 이걸 안 보여주면 다 본 것처럼 읽힌다.
                 unjudged: items.filter(function (i) { return !i.verdict; }).length };
      })(),
      detectAuto: detectAuto, detectBusy: !!(dt && dt.busy), cslotDetect: cslotDetect,
      detectIdExample: detectRow ? (detectRow.id_example || "") : "",
      llmNote: llmNote,
      pipeline: pipeline, progressPct: progressPct, cpipeline: cpipeline, cProgressPct: cProgressPct,
      review: review,
      done: st.done, cdone: st.cdone, cTotalCount: (D.compare.findings || []).filter(function (f) {
        return !f.unreviewed && f.sev !== "info";
      }).length,
      cUnreviewedCount: (D.compare.findings || []).filter(function (f) { return !!f.unreviewed; }).length,
      // 지금 펼친 카드에서 받아둔 수정안들. 인용마다 하나라 "지적id|인용순번"
      // 으로 든다 — 지적 하나에 인용이 열여덟 개인 경우가 실제로 있다.
      fixes: st.fixes,
      sevChips: sevChips, checkerChips: checkerChips, sortChips: sortChips, tableFindings: tableFindings,
      exportBtns: [{ kind: "json", label: "JSON" }, { kind: "md", label: "Markdown" }, { kind: "csv", label: "CSV" }],
      totalCount: total, issueCount: issueCount, unreviewedCount: unreviewedCount, infoCount: counts.info,
      dismissedCount: dismissedCount,
      hasFindings: tableFindings.length > 0, noFindings: tableFindings.length === 0,
      sections: D.sections || [], hlSection: hlSection, hlBySection: hlBySection,
      // 원본에 표시하는 건 PDF만 된다. hwpx는 브라우저로도 못 그리고 원본에
      // 표시할 방법도 사실상 없다 — 그 문서에는 이 버튼을 띄우지 않는다.
      isPdf: !!(D.doc && String(D.doc.type || "").toUpperCase() === "PDF"),
      annot: st.annot,
      hasOrigFile: !!(st.files.single && st.files.single.file),
      viewerMode: st.viewer.mode,
      markedReady: !!st.annot.viewUrl,
      viewerKind: String((D.doc || {}).type || "").toUpperCase(),   // PDF/DOCX/HWPX/…
      converting: st.viewer.converting,
      loadingOrig: !!st.viewer.loadingOrig,
      originalError: st.viewer.originalError || "",
      originalGone: !!st.viewer.originalGone,
      convertError: st.viewer.convertError,
      statRows: statRows, checkerCards: checkerCards, topFindings: topFindings,
      compareFindings: compareFindings, coverage: coverage, cmpStatCards: cmpStatCards,
      rtmForward: rtmForward, rtmForwardMain: rtmForwardMain, rtmOos: rtmOos, cmpBar: cmpBar,
      rtmJudged: rtmJudged, rtmJudgeable: rtmJudgeable, cmpAdditional: cmpAdditional,
      rtmLineage: cmp.rtm_lineage || null,
      rtmCarriedCount: rtmForwardMain.concat(rtmReverse)
        .filter(function (r) { return r.carried; }).length,
      rtmReverse: rtmReverse, cmpAiLine: cmpAiLine,
      workflowLabel: workflowLabel, contentState: contentState,
      cmpActionLine: cmpActionLine, cmpScopeWarn: cmpScopeWarn,
      cmpScopeHow: cmpScopeHow,
      cerror: st.cerror, serror: st.serror
    };
  }

  function doAnnotate(file, then) {
    var D = window.DOCREVIEW;
    state.annot = Object.assign({}, state.annot, { busy: true, msg: "" });
    render();
    var fd = new FormData();
    // 표시본은 base PDF(원본이든 재현본이든)에 형광펜을 얹는다. 원본 파일(docx/hwpx)을
    // 그대로 보내면 /api/annotate가 PDF가 아니라고 거부한다 — 변환된 base를 보낸다.
    var base = state.viewer.baseBlob || file;
    var stem = (((window.DOCREVIEW.doc || {}).name) || "document").replace(/\.[^.]+$/, "");
    fd.append("file", base, stem + ".pdf");
    fd.append("findings", JSON.stringify(D.findings || []));
    fetch("api/annotate", { method: "POST", body: fd })
      .then(function (res) {
        if (!res.ok) {
          // 서버가 늘 JSON으로 답하지는 않는다. 500은 본문이 "Internal Server
          // Error" 평문이라 res.json()을 그냥 부르면 파싱 오류가 대신 뜬다 —
          // 사용자는 진짜 원인 대신 "Unexpected token 'I'"를 보게 된다.
          return res.text().then(function (body) {
            var detail = body;
            try { detail = JSON.parse(body).detail || body; } catch (e) { /* 평문 */ }
            throw new Error("서버 오류 " + res.status + " — " + String(detail).slice(0, 120));
          });
        }
        var mk = parseInt(res.headers.get("X-Marked-Count") || "0", 10);
        var un = parseInt(res.headers.get("X-Unmarked-Count") || "0", 10);
        var summary = res.headers.get("X-Summary") === "1";
        var sp = parseInt(res.headers.get("X-Summary-Pages") || "0", 10);
        // 지적 id → 지면에 찍힌 번호. 카드에 같은 번호를 달아 "3번 지적"이
        // 표시본과 화면에서 같은 것을 가리키게 한다. 헤더가 없거나 깨져도
        // 번호만 안 뜰 뿐 표시본 자체는 멀쩡해야 하므로 조용히 비운다.
        var numbers = {};
        try { numbers = JSON.parse(res.headers.get("X-Numbers") || "{}") || {}; }
        catch (e) { numbers = {}; }
        return res.blob().then(function (b) {
          if (state.annot.viewUrl) URL.revokeObjectURL(state.annot.viewUrl);
          var msg = "근거 " + mk + "곳에 형광펜과 번호를 붙였습니다.";
          // 요약 페이지가 지적을 지면에 직접 그린다. 크롬 기본 뷰어는 주석
          // 팝업의 한글을 못 찍고 인쇄하면 아예 사라지므로, 이게 본체다.
          msg += summary
            ? " 맨 앞에 수정 사항 요약 페이지가 붙어 있습니다."
            : " 다만 서버에 한글 폰트가 없어 요약 페이지는 넣지 못했습니다 (sudo apt install fonts-nanum).";
          // 표시하지 못한 지적을 조용히 넘기지 않는다 — 형광펜이 없다고 해서
          // 지적이 없는 것이 아니다.
          if (un) {
            msg += " " + un + "건은 본문에서 위치를 찾지 못해 형광펜을 못 칠했습니다 — 요약 페이지에 번호 없이 실려 있습니다.";
          }
          // 다운로드하지 않고 blob을 캐시해 뷰어에 띄운다. 다운로드는 별도 버튼이
          // 이 캐시를 저장한다 — 표시본을 두 번 굽지 않게.
          state.annot = { busy: false, msg: msg, blob: b,
                          viewUrl: URL.createObjectURL(b), summaryPages: sp,
                          numbers: numbers };
          state.viewer.mode = "marked";
          render();
          if (then) then();
        });
      })
      .catch(function (e) {
        state.annot = Object.assign({}, state.annot, { busy: false, msg: "표시하지 못했습니다: " + e.message });
        state.viewer.mode = "orig";
        render();
      });
  }

  // 마지막으로 스크롤을 옮긴 지적. 선택이 바뀐 렌더에서만 뷰어를 움직이려고 둔다.

  function selectedSection() {
    var found = null;
    (window.DOCREVIEW.findings || []).forEach(function (f) {
      if (f.id === state.selected) found = f.section;
    });
    return found;
  }

  // ---- 문서 미리보기 ------------------------------------------------------
  // 엔진이 실제로 읽은 텍스트를 그린다. 원본(hwpx/pdf)을 띄우지 않는 이유는
  // docs/superpowers/specs/2026-07-14-single-review-preview-design.md 참고 —
  // hwpx는 브라우저에서 렌더할 방법이 없고(주력 포맷이 전부 hwpx다), 원본을
  // 띄우면 추출이 놓친 내용까지 "엔진이 봤다"고 오해하게 된다.

  // verify_quotes._norm 과 같은 규칙이어야 한다. 규칙이 갈라지면 백엔드가
  // "원문에 있다"고 보증한 인용을 화면이 못 찾아 하이라이트가 조용히 사라진다.
  function normQ(s) { return String(s == null ? "" : s).replace(/\s+/g, " ").trim(); }

  // marks: [{ q, cls, title }]. 화면은 고른 지적 하나만 칠하고, 내보내기는 모든
  // 지적을 심각도 색으로 칠한다 — 렌더러는 하나다.
  function markLine(line, marks) {
    if (!marks || !marks.length) return esc(line);
    function tag(m, text) {
      return '<mark class="' + (m.cls || "hl") + '"' +
        (m.title ? ' title="' + esc(m.title) + '"' : "") + '>' + esc(text) + '</mark>';
    }
    for (var i = 0; i < marks.length; i++) {
      var q = marks[i] && marks[i].q;
      if (!q) continue;
      var at = line.indexOf(q);
      // 글자까지 그대로 맞으면 그 부분만 칠한다.
      if (at >= 0) {
        return esc(line.slice(0, at)) + tag(marks[i], q) + esc(line.slice(at + q.length));
      }
    }
    var n = normQ(line);
    for (var j = 0; j < marks.length; j++) {
      // 공백만 다른 경우(verify_quotes가 허용하는 차이). 어디까지가 인용인지
      // 원문 좌표로 되짚기 어려우니 줄을 통째로 칠한다 — 못 찾은 척하는 것보다 낫다.
      if (marks[j] && marks[j].q && n.indexOf(normQ(marks[j].q)) >= 0) {
        return tag(marks[j], line);
      }
    }
    return esc(line);
  }

  function rowCells(line) {
    var parts = line.split("|");
    if (parts.length && !parts[0].trim()) parts.shift();
    if (parts.length && !parts[parts.length - 1].trim()) parts.pop();
    return parts;
  }

  var _TD = "border:1px solid var(--line);padding:8px 10px;font-size:13px;line-height:1.6;color:var(--text-2);vertical-align:top;";
  var _TH = _TD + "background:var(--bg);color:var(--text);font-weight:700;";

  function docTable(rows, quotes) {
    var head = rowCells(rows[0]).map(function (c) {
      return '<th style="' + _TH + '">' + markLine(c.trim(), quotes) + '</th>';
    }).join("");
    var body = rows.slice(1).map(function (r) {
      return '<tr>' + rowCells(r).map(function (c) {
        return '<td style="' + _TD + '">' + markLine(c.trim(), quotes) + '</td>';
      }).join("") + '</tr>';
    }).join("");
    return '<div style="overflow-x:auto;margin:0 0 18px;">' +
      '<table style="border-collapse:collapse;width:100%;">' +
      '<thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div>';
  }

  // 추출기가 내는 모양은 세 가지뿐이다(### 제목 / | 셀 | 셀 | / 문단).
  // 마크다운 파서를 붙이지 않는다 — 파서는 우리가 안 쓰는 문법까지 해석해
  // 원문에 없는 구조를 만들어낸다.
  function docBlocks(text, quotes) {
    var lines = String(text == null ? "" : text).split("\n");
    var out = [], i = 0;
    while (i < lines.length) {
      var t = lines[i].trim();
      if (!t) { i++; continue; }
      if (t.charAt(0) === "|") {
        var rows = [];
        while (i < lines.length && lines[i].trim().charAt(0) === "|") {
          rows.push(lines[i].trim()); i++;
        }
        out.push(docTable(rows, quotes));
        continue;
      }
      var m = /^(#{1,6})\s+(.*)$/.exec(t);
      if (m) {
        var lv = Math.min(m[1].length + 2, 6);
        out.push('<h' + lv + ' style="font-size:' + (19 - m[1].length) + 'px;font-weight:700;' +
          'color:var(--text);margin:22px 0 10px;letter-spacing:var(--tr-body);">' +
          markLine(m[2], quotes) + '</h' + lv + '>');
        i++; continue;
      }
      out.push('<p style="font-size:13px;line-height:1.6;color:var(--text-2);margin:0 0 12px;">' +
        markLine(t, quotes) + '</p>');
      i++;
    }
    return out.join("");
  }

  function docBody(v) {
    if (!v.sections.length) {
      return '<div style="padding:64px 24px;text-align:center;color:var(--text-3);font-size:14px;line-height:1.6;">' +
        '이 검토에는 문서 본문이 저장되지 않았습니다.<br>' +
        '<span style="font-size:13px;">미리보기 기능 이전에 실행된 검토입니다. 다시 검토하면 본문이 함께 저장됩니다.</span></div>';
    }
    return v.sections.map(function (s) {
      // 근거는 자기 절을 안다. 일관성 지적은 본질적으로 "여기와 저기"라서
      // 근거 둘이 서로 다른 절에 흩어진다 — 지적의 anchor 하나만 보고 칠하면
      // 나머지 근거는 영영 안 보인다. 절마다 자기 몫의 인용만 칠한다.
      var quotes = v.hlBySection[s.id] || [];
      var on = quotes.length > 0 || (v.hlSection && s.id === v.hlSection);
      var page = s.page ? '<span style="font-size:11px;color:var(--text-3);font-weight:600;">' + s.page + '쪽</span>' : "";
      return '<section id="sec-' + esc(s.id) + '" style="scroll-margin-top:24px;padding:14px 18px;margin:0 0 6px;border-radius:var(--r-md);' +
          (on ? 'background:var(--accent-weak);' : '') + '">' +
        '<div style="display:flex;align-items:baseline;gap:10px;margin-bottom:8px;">' +
          '<span style="font-size:11px;font-weight:600;color:var(--accent-ink);font-variant-numeric:tabular-nums;">§' + esc(s.id) + '</span>' +
          '<span style="font-size:15px;font-weight:700;color:var(--text);">' + esc(s.title) + '</span>' + page +
        '</div>' +
        docBlocks(s.text, quotes) +
      '</section>';
    }).join("");
  }

  // ---- 검토 결과 문서 (자기완결 HTML) -------------------------------------
  // 미리보기와 같은 렌더러(docBlocks/markLine)를 쓴다. 산출물이 화면과 다르게
  // 생기면 둘 중 하나는 거짓말이 된다.
  //
  // 화면과 다른 점은 둘뿐이다:
  //   1. 고른 지적 하나가 아니라 모든 지적을 심각도 색으로 한꺼번에 칠한다
  //   2. CSS 변수를 파일 안에 박는다 — 이 파일은 DocSuree 없이 혼자 열려야 한다
  //      (그래서 외부 폰트·스크립트도 안 쓴다)

  // index.html의 :root 라이트 토큰. 여기서 벗어나면 산출물 색이 화면과 달라진다.
  var EXPORT_TOKENS =
    ":root{--bg:#F2E0D4;--panel:#FFFEFC;--line:#DDCEC3;--line-2:#EEE2DA;" +
    "--text:#2B2926;--text-2:#55504A;--text-3:#6B645E;--accent:#356998;--accent-ink:#356998;" +
    "--accent-strong:#284F73;--accent-weak:rgba(53,105,152,.12);--neutral-weak:rgba(122,103,91,.11);" +
    "--sev-crit-bg:rgba(220,38,38,.1);--sev-crit-fg:#B91C1C;--sev-crit-bd:rgba(220,38,38,.2);" +
    "--sev-maj-bg:rgba(234,88,12,.1);--sev-maj-fg:#C2410C;--sev-maj-bd:rgba(234,88,12,.2);" +
    "--sev-min-bg:rgba(202,138,4,.1);--sev-min-fg:#A16207;--sev-min-bd:rgba(202,138,4,.2);" +
    "--sev-info-bg:rgba(100,116,139,.1);--sev-info-fg:#475569;--sev-info-bd:rgba(100,116,139,.2);}";

  var EXPORT_CSS = EXPORT_TOKENS +
    "*{box-sizing:border-box}" +
    "body{margin:0;background:var(--bg);color:var(--text);line-height:1.6;" +
    "font-family:system-ui,-apple-system,'Segoe UI',Roboto,'Malgun Gothic','Apple SD Gothic Neo',sans-serif}" +
    ".wrap{max-width:900px;margin:0 auto;padding:32px 20px 80px}" +
    ".card{background:var(--panel);border:1px solid var(--line);border-radius:var(--r-md);padding:24px 28px;margin-bottom:20px}" +
    "h1{font-size:22px;margin:0 0 6px;letter-spacing:var(--tr-body)}" +
    ".sub{color:var(--text-3);font-size:13px;margin-bottom:20px}" +
    ".warn{background:var(--sev-crit-bg);color:var(--sev-crit-fg);border:1px solid var(--sev-crit-bd);" +
    "border-radius:var(--r-sm);padding:10px 14px;font-size:12px;font-weight:600;margin-bottom:20px}" +
    ".kv{display:flex;gap:10px;font-size:13px;padding:6px 0;border-bottom:1px solid var(--line-2)}" +
    ".kv b{flex:none;width:110px;color:var(--text-3);font-weight:600}" +
    ".counts{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0 0}" +
    ".pill{font-size:12px;font-weight:600;padding:6px 12px;border-radius:999px;border:1px solid}" +
    ".fx{border:1px solid var(--line);border-radius:var(--r-md);padding:14px 16px;margin-bottom:10px}" +
    ".fx-head{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px}" +
    ".fx-msg{font-weight:700;font-size:14px}" +
    ".fx-sug{font-size:12px;color:var(--text-2);margin-top:6px}" +
    ".fx-q{font-size:12px;color:var(--text-2);background:var(--bg);border-radius:var(--r-sm);padding:8px 10px;margin-top:6px}" +
    "mark{border-radius:3px;padding:2px 2px}" +
    "mark.sev-major{background:var(--sev-min-bg);box-shadow:0 0 0 1px var(--sev-min-bd)}" +   // 화면과 같이 노랑 하나
    "mark.sev-minor{background:var(--sev-min-bg);box-shadow:0 0 0 1px var(--sev-min-bd)}" +
    "mark.sev-info{background:var(--sev-info-bg);box-shadow:0 0 0 1px var(--sev-info-bd)}" +
    "section{padding:10px 14px;border-radius:var(--r-sm);margin-bottom:4px}" +
    "section.hit{background:var(--accent-weak)}" +
    ".sec-h{display:flex;align-items:baseline;gap:8px;margin-bottom:6px}" +
    ".sec-n{font-size:11px;font-weight:600;color:var(--accent-ink)}" +
    ".sec-t{font-size:15px;font-weight:700}" +
    "@media print{body{background:#fff}.card{break-inside:avoid}}";

  // 반영 확인 화면과 내보내기가 함께 쓰는 뷰 모델. 두 곳이 각자 만들면
  // 화면이 말하는 판정과 회신서에 실리는 판정이 갈린다.
  // 반영 확인 한 줄 요약. 화면과 회신서가 같은 말을 하게 한 곳에 둔다.
  // 검토자가 **처리한** 건수. `해당없음` 도 처리한 것이다 — 안 세면 다섯 건을
  // 정리해도 진행률이 안 움직여 일한 티가 안 난다. 탭과 app.js 가 각자 더하면
  // 두 숫자가 갈리므로 여기 한 곳에서만 센다.
  function lineageDoneCount(L) {
    return (L.summary.closed || 0) + (L.summary.na || 0);
  }

  function lineageTabLabel(L) {
    return "반영 확인 " + lineageDoneCount(L) + "/" + L.items.length;
  }

  function lineageSummaryText(L) {
    return "반영 확인 — 반영됨 " + L.summary.closed + " · 미반영 " + L.summary.open +
      (L.summary.na ? " · 해당없음 " + L.summary.na : "") +
      " · 신규 " + L.summary.added;
  }

  // 뷰어 오버레이(POST /api/locate)가 형광펜에 매긴 번호.
  function markNumberOf(id) {
    if (!id) return null;
    var items = (state.marks && state.marks.items) || [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].id === id) return items[i].no || null;
    }
    return null;
  }

  function lineageView() {
    var D = window.DOCREVIEW || {};
    var L = D.lineage;
    if (!L) return null;
    // 사람이 내린 판정. 기계 판정(it.status)을 **덮지 않고 따로** 온다 —
    // 덮으면 판정 근거가 사라지고, 다시 검토해 기계 판정이 새로 계산될 때
    // 사람이 한 일까지 지워진다(서버의 confirm_lineage 참고).
    var saved = D.lineageVerdicts || {};
    // 지난 검토에서 이어받은 판정 {열쇠: 값}. 검토자가 이번에 누른 것과 갈라
    // 보여준다. 값까지 보는 이유는 덮어쓰면 더 이상 이어받은 것이 아니어서다.
    var carried = D.lineageCarried || {};
    // 옛 이력은 열림·닫힘으로 저장돼 있다. 표가 없으면 그 검토들이 빈 값으로 보인다.
    var LEGACY = { "열림": "그대로 있음", "닫힘": "안 보임", "해당없음": "해당없음" };
    // 기계가 본 것 → 사람 판정의 초기값. 검토자가 안 건드리면 이 값으로 읽힌다.
    // **셋 다 미반영이다** — 기계는 고쳐졌다고 단정할 수 없다(lineage.py 참고).
    var FROM_AUTO = { "그대로 있음": "미반영", "안 보임": "미반영", "해당없음": "해당없음",
                      "판단 못 함": "미반영" };
    var items = (L.items || []).map(function (it, i) {
      var f = it.finding || {};
      var auto = LEGACY[it.status] || it.status;      // 기계가 본 것. 안 바뀐다
      // 판정은 **지적의 신원**(서버가 준 key)에 붙는다. 순번은 그 검토 안에서만
      // 뜻이 있어 다음 검토로 못 잇는다. String(i) 는 그렇게 저장된 옛 이력용이다.
      var mine = saved[it.key] || saved[String(i)];   // 사람이 고른 것(있으면)
      return { idx: String(i),
               message: f.message || "", loc: locOf(f),
               // 이어받은 값 그대로일 때만 `지난 판정` 이다. 검토자가
               // 덮어쓰면 그건 이번에 자기가 고른 것이다.
               auto: auto, carried: !!mine && carried[it.key] === mine,
               // 형광펜 번호. 뷰어가 매긴 것을 그대로 쓴다 — 화면이 따로 매기면
               // "3번"이 형광펜과 카드에서 서로 다른 것을 가리킨다.
               // `안 보임` 은 문서에 자리가 없어 번호도 없다.
               no: markNumberOf(it.match_id),
               // 이번 검토의 같은 지적. 누르면 문서의 그 자리로 간다.
               // 이전 지적의 좌표는 **이전 문서** 것이라 여기선 못 쓴다.
               matchId: it.match_id || "",
               // 짝이 없으면(`안 보임`) 갈 자리가 없다. 대신 지난번 인용을 보여줘
               // 검토자가 문서에서 찾을 수 있게 한다 — 목록만 있으면 어딘지 모른다.
               quote: ((f.evidence || [])[0] || {}).quote || "",
               status: mine || FROM_AUTO[auto] || "미반영" };
    });
    var newFindings = (L.new_findings || []).map(function (f) {
      return { message: f.message || "", loc: locOf(f),
               sev: f.sev || "info" };
    });
    // 요약은 **사람 판정** 기준이다 — 검토자가 실제로 무엇을 확인했는지가
    // "기계가 못 찾았다"보다 중요하다.
    var done = items.filter(function (i) { return i.status === "반영됨"; }).length;
    var todo = items.filter(function (i) { return i.status === "미반영"; }).length;
    var na = items.filter(function (i) { return i.status === "해당없음"; }).length;
    return { items: items, newFindings: newFindings,
             statusOpts: ["미반영", "반영됨", "해당없음"],
             newLabel: "신규",
             summary: { closed: done, open: todo, na: na,
                        added: newFindings.length } };
  }

  // 회신서의 알맹이. 검토자가 지난번 지적을 하나씩 판정한 결과다 —
  // 이게 없으면 드롭다운을 누를 이유가 없다(눌러도 자기만 본다).
  // `반영 확인` 탭에서 문서에 칠할 지적의 id 들. 지난 지적 중 **아직 미반영으로
  // 둔 것**만이다 — 검토자가 판정을 바꾸면 칠이 따라 바뀐다.
  //
  // `안 보임` 은 이번 문서에 짝이 없어 칠할 자리도 없다(matchId 가 빈다).
  // 재검토가 아니면 null — 걸러낼 것이 없다는 뜻이다.
  // 지금 보고 있는 결과 탭. **기본값을 한 곳에서만 정한다** — state.reviewTab 은
  // 검토자가 탭을 직접 누르기 전까지 null 이고, 화면만 "재검토면 반영 확인부터"로
  // 기본을 잡고 있었다. 그래서 app.js 가 `state.reviewTab !== "lineage"` 로 물으면
  // 반영 확인 탭을 보고 있는데도 아니라고 답했다(형광펜이 안 바뀌었다).
  function reviewTabNow() {
    var D = window.DOCREVIEW || {};
    if (state.reviewTab === "status" && (D.findings || []).some(function (f) {
      return f.unreviewed || f.sev === "info";
    })) return "status";
    if (state.reviewTab === "status") return D.lineage ? "lineage" : "findings";
    if (state.reviewTab === "criteria") return (D.criteriaResults && !D.checklist) ? "criteria" : "findings";
    return D.lineage ? (state.reviewTab || "lineage") : "findings";
  }

  // 검토자가 `해당없음` 으로 정리한 지적의 id 들(이번 검토 기준).
  // 카드를 **지우지는 않는다** — 기계가 낸 것을 화면이 삼키면 안 되고(CLAUDE.md),
  // 검사기는 다음에도 그 지적을 낸다. 대신 카드가 "이미 정리됐다"를 말한다.
  // 안 그러면 검토자가 "해당없다고 했는데 왜 또 뜨지" 를 매번 다시 겪는다.
  function lineageNaIds() {
    var L = lineageView();
    if (!L) return null;
    var na = {};
    L.items.forEach(function (it) {
      if (it.matchId && it.status === "해당없음") na[it.matchId] = true;
    });
    return na;
  }

  // 검토자가 뺀 지적 → {id: "dismissed" | "carried"}. 목록·건수·형광펜·내보내기가
  // 전부 이걸로 거른다(2026-09-15 품질팀: "잘못된 지적은 사용자가 빼고, 다음
  // 검토에 안 이어지게"). `dismissed` 는 이번 검토에서 직접 뺀 것(payload.dismissed),
  // `carried` 는 지난 검토의 해당없음을 이어받은 것(lineageNaIds). 숨기되 건수 한
  // 줄("제외한 지적 N건")로 남긴다 — 조용히 삼키지 않는다(CLAUDE.md).
  function hiddenFindingIds() {
    var D = window.DOCREVIEW || {};
    var out = {};
    Object.keys(lineageNaIds() || {}).forEach(function (id) { out[id] = "carried"; });
    (D.dismissed || []).forEach(function (id) { out[id] = "dismissed"; });
    return out;
  }

  function lineageMarkIds() {
    var L = lineageView();
    if (!L) return null;
    var keep = {};
    L.items.forEach(function (it) {
      if (it.matchId && it.status === "미반영") keep[it.matchId] = true;
    });
    return keep;
  }

  // 반영 확인 패널 전체. 좌표(POST /api/locate)는 검토가 끝난 **뒤에** 온다 —
  // 형광펜 번호가 그때 정해지므로, 도착하면 이 패널만 다시 그린다. 통째로 그리면
  // 뷰어가 PDF 를 다시 연다.
  // 이전 검토 발견 배너 — "이어서 반영 확인?"
  function lineageCandidateOf() {
    var c = (window.DOCREVIEW || {}).lineageCandidate;
    return c ? { title: c.title, at: c.at } : null;
  }

  function lineagePanelHtml() {
    var L = lineageView();
    if (!L) return "";
    return lineageHtml(L, lineageCandidateOf());
  }

  function lineageCardHtml() {
    var L = lineageView();
    if (!L || !L.items.length) return "";
    var rows = L.items.map(function (it) {
      return '<div class="fx"><div class="fx-h">' +
        '<span class="pill">' + esc(it.status) + '</span>' +
        '<span class="fx-loc">' + esc(it.loc) + '</span>' +
        '<span class="sub" style="margin-left:auto;">기계 관찰: ' + esc(it.auto) +
          // 이번에 새로 내린 판정인지, 지난 검토에서 이어온 것인지 갈라 준다.
          (it.carried ? ' · 지난 판정' : '') + '</span>' +
        '</div><div class="fx-msg">' + esc(it.message) + '</div></div>';
    }).join("");
    return '<div class="card"><h1 style="font-size:18px;">반영 확인 ' + L.items.length + '건</h1>' +
      '<div class="sub">' + esc(lineageSummaryText(L)) +
        ' — 판정은 검토자가 내린 것이고, 기계 관찰은 그 근거입니다.</div>' + rows + '</div>';
  }

  // 내보내기 본문. **화면 밖으로 나가는 글은 여기서 만든다** — 액션(app.js)은
  // 내려받기 통로만 진다. 액션 안에 두면 DOM 없이 못 돌려서, 판정이 실제로
  // 실렸는지 글자 대조로만 지킬 수 있었다(조건만 꺼도 문자열은 남는다).
  // 내보내기용 목록. 검토자가 뺀 지적은 산출물에도 안 나간다(2026-09-15 결정).
  function _sortedFindings() {
    var D = window.DOCREVIEW, meta = D.sevMeta, hidden = hiddenFindingIds();
    return D.findings.filter(function (f) { return !hidden[f.id]; }).sort(function (a, b) {
      return meta[a.sev].order - meta[b.sev].order;
    });
  }

  function reviewJson() {
    var D = window.DOCREVIEW, fs = _sortedFindings(), L = lineageView();
    var obj = { source: D.doc.name, total: fs.length,
      findings: fs.map(function (f) {
        return { checker: f.checker, severity: f.sev, message: f.message,
                 anchor: { section: f.section }, suggestion: f.suggestion || null };
      }) };
    if (L && L.items.length) {
      obj.lineage = { summary: L.summary, items: L.items.map(function (it) {
        return { verdict: it.status, observed: it.auto,
                 section: it.loc, message: it.message };
      }) };
    }
    return JSON.stringify(obj, null, 2);
  }

  function reviewMd() {
    var D = window.DOCREVIEW, meta = D.sevMeta, fs = _sortedFindings(), L = lineageView();
    var s = "# 문서 검토 결과: " + D.doc.name + "\n\n총 " + fs.length + "건\n\n";
    fs.forEach(function (f) {
      s += "- **[" + meta[f.sev].label + "]** (" + f.checker + ", " +
        locOf(f) + ") " + f.message + "\n";
      if (f.suggestion) s += "  - 제안: " + f.suggestion + "\n";
    });
    if (L && L.items.length) {
      s += "\n## 반영 확인 " + L.items.length + "건\n\n" + lineageSummaryText(L) + "\n\n";
      L.items.forEach(function (it) {
        s += "- **[" + it.status + "]** (" + it.loc + ") " + it.message +
          "  \n  기계 관찰: " + it.auto + "\n";
      });
    }
    return s;
  }

  function reviewCsv() {
    var fs = _sortedFindings(), L = lineageView();
    var q = function (v) { return '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"'; };
    var csv = "severity,checker,section,message,suggestion\n";
    fs.forEach(function (f) {
      csv += [q(f.sev), q(f.checker), q(f.section || ""), q(f.message),
              q(f.suggestion || "")].join(",") + "\n";
    });
    if (L && L.items.length) {
      // 엑셀에서 두 표로 읽히게 빈 줄로 끊고 머리글을 다시 낸다.
      csv += "\n" + lineageSummaryText(L) + "\n판정,기계 관찰,위치,지난번 수정 사항\n";
      L.items.forEach(function (it) {
        csv += [q(it.status), q(it.auto), q(it.loc), q(it.message)].join(",") + "\n";
      });
    }
    return csv;
  }

  function reviewHtml() {
    var D = window.DOCREVIEW, meta = D.sevMeta, s = state.server;
    var fs = _sortedFindings();

    // 절 → 그 절에서 칠할 인용들. 지적 전부를 한꺼번에 얹는다.
    var bySec = {}, hit = {};
    fs.forEach(function (f) {
      if (f.section) hit[f.section] = true;
      (f.evidence || []).forEach(function (e) {
        var sid = e.section || f.section;
        if (!sid) return;
        hit[sid] = true;
        (bySec[sid] = bySec[sid] || []).push(
          { q: e.quote, cls: "sev-" + f.sev, title: meta[f.sev].label + " · " + f.message });
      });
    });

    var counts = { major: 0, minor: 0, info: 0 };
    fs.forEach(function (f) { counts[f.sev]++; });
    var pills = sevGroupCounts(counts).map(function (g) {
      var p = SEV[g.sev];
      return '<span class="pill" style="background:' + p.bg + ';color:' + p.fg + ';border-color:' + p.bd + ';">' +
        g.label + ' ' + g.count + '</span>';
    }).join("");

    var kv = function (k, v) {
      return v ? '<div class="kv"><b>' + esc(k) + '</b><span>' + esc(v) + '</span></div>' : "";
    };
    var basis = s
      ? kv("팀 기준", s.checklist) +
        kv("담당 범위", s.scope_label || s.scope_pattern) +
        kv("검토 엔진", s.llm_provider === "echo" ? "규칙만 (LLM 미사용)" : s.llm_model)
      : '<div class="sub">검토 기준을 서버에서 읽지 못했습니다.</div>';

    // 지적 목록. 근거 인용을 함께 싣는다 — 목록만 봐도 무엇을 근거로 한 지적인지 보인다.
    var list = fs.length ? fs.map(function (f) {
      var p = SEV[f.sev];
      var qs = (f.evidence || []).map(function (e) {
        return '<div class="fx-q">' + esc(e.quote) + '</div>';
      }).join("");
      return '<div class="fx" id="' + esc(f.id) + '">' +
        '<div class="fx-head">' +
          '<span class="pill" style="background:' + p.bg + ';color:' + p.fg + ';border-color:' + p.bd + ';">' +
            meta[f.sev].label + '</span>' +
          '<span style="font-size:11px;font-weight:600;color:var(--text-3);">' +
            (f.section ? '§' + esc(f.section) : '문서 전체') +
            (f.page ? ' · ' + f.page + '쪽' : '') + ' · ' + esc(f.checker) + '</span>' +
        '</div>' +
        '<div class="fx-msg">' + esc(f.message) + '</div>' + qs +
        (f.suggestion ? '<div class="fx-sug">제안: ' + esc(f.suggestion) + '</div>' : '') +
      '</div>';
    }).join("") : '<div class="sub">수정 사항이 없습니다.</div>';

    var body = (D.sections || []).length
      ? (D.sections).map(function (sec) {
          var marks = bySec[sec.id] || [];
          return '<section class="' + (hit[sec.id] ? "hit" : "") + '">' +
            '<div class="sec-h"><span class="sec-n">§' + esc(sec.id) + '</span>' +
              '<span class="sec-t">' + esc(sec.title) + '</span>' +
              (sec.page ? '<span style="font-size:11px;color:var(--text-3);font-weight:600;">' + sec.page + '쪽</span>' : '') +
            '</div>' + docBlocks(sec.text, marks) +
          '</section>';
        }).join("")
      : '<div class="sub">이 검토에는 문서 본문이 저장되지 않았습니다.</div>';

    var name = (D.doc && D.doc.name) || "문서";
    // 파일 안에 문서 본문이 통째로 들어간다. 이 파일 하나가 사내 문서 사본이다.
    return "<!doctype html>\n<html lang=\"ko\"><head><meta charset=\"utf-8\">" +
      "<title>" + esc(name) + " — DocSuree 검토 결과</title><style>" + EXPORT_CSS + "</style></head><body>" +
      '<div class="wrap">' +
        '<div class="card">' +
          '<h1>' + esc(name) + '</h1>' +
          '<div class="sub">DocSuree · 문서 일관성·추적성 검토 Agent — 검토 결과 ' +
            esc(new Date().toLocaleString("ko-KR")) + '</div>' +
          '<div class="warn">사내 문서 — 이 파일에는 문서 본문 전체가 포함됩니다. 외부 반출 금지.</div>' +
          basis +
          '<div class="counts">' + pills + '</div>' +
        '</div>' +
        lineageCardHtml() +
        '<div class="card"><h1 style="font-size:18px;">수정 사항 ' + fs.length + '건</h1>' +
          '<div class="sub">LLM이 낸 수정 사항에는 원문 근거가 함께 실려 있습니다. 근거 없는 것은 리포트에 오르지 않습니다.</div>' +
          list +
        '</div>' +
        '<div class="card"><h1 style="font-size:18px;">문서 본문</h1>' +
          '<div class="sub">엔진이 읽은 텍스트입니다. 수정 사항의 근거가 본문 위에 표시되어 있습니다.</div>' +
          body +
        '</div>' +
      '</div></body></html>';
  }

  // ---- small template helpers --------------------------------------------
  // 종이·폴더 윤곽선의 굵기. **화면에 찍히는 두께**를 맞추려고 두 값을 쓴다 —
  // 비교 글리프는 두 장을 한 상자에 담느라 0.8 로 줄여 그리므로, 같은 0.7 을
  // 쓰면 비교만 얇게 찍힌다(0.60px 대 0.80px). 단일 문서 옆에 나란히 놓으면
  // 그 차이가 "다른 아이콘 세트"로 보였다(2026-09-01 지적).
  //   축소 없이 그리는 것(단일·체크리스트·폴더) → SHEET_STROKE
  //   0.8 로 줄여 그리는 것(비교의 두 장)        → SHEET_STROKE_SCALED
  // 둘 다 40px 에서 약 0.60px 로 찍힌다.
  var SHEET_STROKE = "0.53", SHEET_STROKE_SCALED = "0.7";
  // 글리프 농도는 테마가 정한다(index.html --glyph-*). 값이 SVG 에 박혀 있으면
  // 다크에서 종이가 거의 사라진다 — 0.15 채움은 흰 바탕용이다.
  var FILL = "var(--glyph-fill)", FOLD = "var(--glyph-fold)",
      LINE = "var(--glyph-line)";

  // 폴더 종이 글리프. docShapeIcon(확장자 없는 이름)과 kindShapeIcon("case") 이
  // 같은 것을 그리도록 한 곳에 둔다 — 예전에는 kindShapeIcon 이 docShapeIcon 을
  // 거쳐 갔는데, 거기 있는 "40px 미만은 선 아이콘" 갈림길에 걸려 런처 메뉴에서만
  // 폴더가 다른 어휘로 떨어졌다.
  function folderGlyph(size, colorBase, count) {
    // 폴더는 가로가 넓다. 문서의 세로 비율(28×36)에 맞추려 들면 억지스러워지므로
    // 자기 viewBox(30×26)를 쓴다. 같은 것은 비율이 아니라 **시각 언어**다 —
    // 같은 색, 같은 두 겹 투명도(몸통 0.15 · 탭 0.3), 같은 얇은 윤곽과 여백.
    var F = "M0 4a2 2 0 0 1 2-2h8.5l3 3.5H28a2 2 0 0 1 2 2v14.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2z";
    var T = "M0 4a2 2 0 0 1 2-2h8.5l3 3.5H0z";
    return '<svg viewBox="0 0 30 26" style="width:' + Math.round(size * 0.85) + 'px;height:' + Math.round(size * 0.737) + 'px;color:var(--' + colorBase + ');flex:none;margin:0 4px;">' +
      '<path d="' + F + '" fill="currentColor" style="opacity:var(--glyph-fill)"/>' +
      '<path d="' + T + '" fill="currentColor" style="opacity:var(--glyph-fold)"/>' +
      '<path d="' + F + '" fill="none" stroke="currentColor" stroke-width="' + SHEET_STROKE + '" stroke-linejoin="round" style="opacity:var(--glyph-line)"/>' +
      '<path d="' + T.slice(0, -1) + '" fill="none" stroke="currentColor" stroke-width="' + SHEET_STROKE + '" stroke-linejoin="round" style="opacity:var(--glyph-line)"/>' +
      // 서류 두 줄. 문서 아이콘은 확장자 글자가 안을 채우는데 폴더는 빈 도형이라
      // 나란히 놓으면 혼자 허전했다.
      '<line x1="8" y1="13" x2="22" y2="13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" style="opacity:var(--glyph-mark)"/>' +
      '<line x1="8" y1="17" x2="18" y2="17" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" style="opacity:var(--glyph-mark)"/>' +
      // 건수 배지(2026-09-17 사용자 선택): 폴더 오른쪽 아래에 이 세트가 본 문서 수. 폴더만으로는
      // "여러 문서를 함께 봤다"가 안 읽혔다. 판 색 테두리로 폴더 윤곽과 뗀다. 수가 없으면(런처
      // 타일·옛 기록) 배지 없이 폴더만. 두 자리까지만 — 세 자리는 34px 에서 못 읽는다.
      (count > 0
        ? '<circle cx="24" cy="20" r="6" fill="var(--panel)"/><circle cx="24" cy="20" r="5" fill="currentColor"/>' +
          '<text x="24" y="22" text-anchor="middle" font-size="6.2" font-weight="700" fill="var(--panel)" ' +
            'font-family="inherit" style="font-variant-numeric:tabular-nums;">' + (count > 99 ? "99+" : count) + '</text>'
        : '') +
      '</svg>';
  }

  function docShapeIcon(title, size, colorBase, keepShape) {
    // 2글자 확장자까지 받는다 — `.md` 가 3글자 규칙에 안 걸려 혼자 일반 아이콘으로
    // 떨어졌다. 지원 형식이 .md·.txt·.pdf·.hwpx·.hwp·.docx 이므로 2~4 면 전부 덮는다.
    var extMatch = title ? title.match(/\.([a-zA-Z0-9]{2,4})$/) : null;

    // 확장자가 없으면 폴더다(폴더 검토가 세트째 하나로 뜨는 자리). 문서 아이콘과
    // 같은 시각 언어로 그린다 — 같은 viewBox·같은 두 겹 투명도라 나란히 놓아도
    // 크기와 색이 어긋나지 않는다. 종이의 접힌 모서리 자리를 폴더의 탭이 맡는다.
    if (!extMatch) {
      if (size < 40) {
        return '<span style="color:var(--'+colorBase+');display:inline-flex;align-items:center;font-size:'+size+'px;">' + ICONS.folder + '</span>';
      }
      return folderGlyph(size, colorBase);
    }

    var ext = extMatch[1].toUpperCase();
    // 2글자(MD)는 같은 크기로 두면 허전하다. 글자 수에 맞춰 셋으로 나눈다.
    var fSize = ext.length > 3 ? "6.5" : (ext.length < 3 ? "9" : "7.5");

    // 조밀한 인라인 자리에서는 원래의 확장자 배지를 쓴다. 다만 별도 검토 기록
    // 화면은 서로 다른 검토 유형 아이콘을 한 열에서 비교하므로, keepShape=true로
    // 작은 크기에서도 문서 윤곽을 유지한다. 기록형 목록은 recordShapeIcon에서
    // 이 예외를 명시적으로 요청한다.
    if (size < 40 && !keepShape) {
      return '<span style="display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;background:var(--'+colorBase+'-weak);color:var(--'+colorBase+');padding:2px 4px;border-radius:4px;line-height:1;vertical-align:middle;margin-right:6px;">' + ext + '</span>';
    }

    var w = Math.round(size * 0.8);
    var h = size;

    /* 업로드 삽화와 같은 문서 윤곽을 크기에 맞춰 통째로 축소한다. */
    return '<svg viewBox="0 0 28 36" style="width:'+w+'px;height:'+h+'px;color:var(--'+colorBase+');flex:none;margin:0 4px;">' +
      '<path d="M4 0h13l11 11v21a4 4 0 0 1-4 4H4a4 4 0 0 1-4-4V4a4 4 0 0 1 4-4z" fill="currentColor" style="opacity:var(--glyph-fill)"/>' +
      '<path d="M17 0v11h11" fill="currentColor" style="opacity:var(--glyph-fold)"/>' +
      '<path d="M4 0h13l11 11v21a4 4 0 0 1-4 4H4a4 4 0 0 1-4-4V4a4 4 0 0 1 4-4z" fill="none" stroke="currentColor" stroke-width="' + SHEET_STROKE + '" stroke-linejoin="round" style="opacity:var(--glyph-line)"/>' +
      '<path d="M17 0v11h11" fill="none" stroke="currentColor" stroke-width="' + SHEET_STROKE + '" stroke-linejoin="round" style="opacity:var(--glyph-line)"/>' +
      '<text x="14" y="26" font-size="' + fSize + '" font-weight="900" style="font-family:var(--font-body);" fill="currentColor" text-anchor="middle" letter-spacing="-0.3px">' + ext + '</text></svg>';
  }

  // 검토 유형 글리프. 기록·최근 목록에서 docShapeIcon(파란 문서 + 확장자 글씨)과
  // 나란히 놓이는 자리인데, 예전엔 비교·폴더·체크리스트만 회색 상자 + 회색
  // 아이콘이라 단일 문서와 딴 세트처럼 보였다(2026-09-01 지적). 넷 다 같은
  // 시각 언어로 그린다 — 같은 문서 도형, 0.15 채움 · 0.3 접힘 · 얇은 윤곽, accent.
  function kindShapeIcon(kind, title, size, count) {
    var doc = 'M4 0h13l11 11v21a4 4 0 0 1-4 4H4a4 4 0 0 1-4-4V4a4 4 0 0 1 4-4z';
    var fold = 'M17 0v11h11';
    // sw 를 안 주면 축소 없이 그리는 쪽(SHEET_STROKE)이다.
    function layers(fillOp, foldOp, lineOp, sw) {
      sw = sw || SHEET_STROKE;
      return '<path d="' + doc + '" fill="currentColor" style="opacity:' + fillOp + '"/>' +
        '<path d="' + fold + '" fill="currentColor" style="opacity:' + foldOp + '"/>' +
        '<path d="' + doc + '" fill="none" stroke="currentColor" stroke-width="' + sw + '" stroke-linejoin="round" style="opacity:' + lineOp + '"/>' +
        '<path d="' + fold + '" fill="none" stroke="currentColor" stroke-width="' + sw + '" stroke-linejoin="round" style="opacity:' + lineOp + '"/>';
    }
    // 마주보는 두 화살표. 녹아웃(판 색 굵은 선) → 색 선 순서로 두 번 긋는다.
    var arrowPath = "M3.5 16.5h23M23.6 13.6l2.9 2.9-2.9 2.9M26.5 22.5h-23M6.4 19.6l-2.9 2.9 2.9 2.9";
    var crossArrows =
      '<path d="' + arrowPath + '" fill="none" stroke="var(--panel)" stroke-width="3.6" ' +
        'stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="' + arrowPath + '" fill="none" stroke="currentColor" stroke-width="1.8" ' +
        'stroke-linecap="round" stroke-linejoin="round"/>';
    if (kind === "compare") {
      // 두 문서 겹침 + 앞 문서 안의 맞물린 화살표. 겹치기만 하면 "문서 2건"으로
      // 읽히지 **비교**라는 동작이 안 보인다(2026-09-01 지적). 표시는 앞 장
      // 안에 넣는다 — 확장자 글자·점검 표시가 앉는 그 자리다. 우하단 배지도
      // 해 봤는데 40px 에서 점으로 뭉개졌다(실측).
      //
      // 뒤 문서는 한 단 옅게 물려 물러나고, 앞 문서 아래에는 판 배경을 깔아
      // 뒤 문서의 선이 반투명 채움을 뚫고 비치지 않게 한다.
      return '<svg viewBox="0 0 30 37" style="width:' + Math.round(size * 0.8) + 'px;height:' + size + 'px;color:var(--accent);flex:none;margin:0 4px;">' +
        '<g transform="translate(7.6 0) scale(0.8)">' +
          layers("calc(var(--glyph-fill) * .67)", "calc(var(--glyph-fold) * .67)", "calc(var(--glyph-line) * .79)", SHEET_STROKE_SCALED) + '</g>' +
        '<g transform="translate(0 8.2) scale(0.8)"><path d="' + doc + '" fill="var(--panel)"/>' +
          layers(FILL, FOLD, LINE, SHEET_STROKE_SCALED) + '</g>' +
        // 화살표는 **두 장을 가로지른다** — 앞 장 안에만 두면 그 한 장의 속성처럼
        // 읽히지, 두 문서 **사이의 일**로 안 보인다(2026-09-01). 겹친 자리에서
        // 묻히지 않게 같은 길을 판 색으로 굵게 한 번 긋고(녹아웃) 그 위에 색을
        // 얹는다. 판 색은 토큰이라 다크에서도 알아서 뒤집힌다.
        crossArrows +
        '</svg>';
    }
    if (kind === "evaluation") {
      // 체크리스트 검토(부록 B 초안): **클립보드 몸통** + 체크 줄 두 단 + 빈 단(2026-09-17 사용자
      // 선택). 몸통을 바꾼 이유 — 문서 몸통은 다른 넷과 같아 안의 표시로만 갈라야 했고 기준
      // 판정(체크 두 단)과 미묘하게 닮았다. 집게 달린 클립보드는 접힌 귀 문서들과 34px 에서
      // 한눈에 갈리고, 사이드메뉴의 체크리스트 검토 아이콘(클립보드)과 같은 어휘라 메뉴에서
      // 본 모양을 기록에서 다시 만난다. 두 겹 투명도·얇은 윤곽은 문서 글리프와 같다.
      var clip = 'M3 5a2 2 0 0 1 2-2h18a2 2 0 0 1 2 2v27a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z';
      var clipTab = 'M10 1.5h8a1.5 1.5 0 0 1 1.5 1.5v2.5h-11V3A1.5 1.5 0 0 1 10 1.5z';
      var tick = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
      var ln = 'stroke="currentColor" stroke-width="2" stroke-linecap="round"';
      return '<svg viewBox="0 0 28 36" style="width:' + Math.round(size * 0.8) + 'px;height:' + size + 'px;color:var(--accent);flex:none;margin:0 4px;">' +
        '<path d="' + clip + '" fill="currentColor" style="opacity:' + FILL + '"/>' +
        '<path d="' + clip + '" fill="none" stroke="currentColor" stroke-width="' + SHEET_STROKE + '" stroke-linejoin="round" style="opacity:' + LINE + '"/>' +
        '<path d="' + clipTab + '" fill="var(--panel)"/>' +
        '<path d="' + clipTab + '" fill="currentColor" style="opacity:' + FOLD + '"/>' +
        '<path d="' + clipTab + '" fill="none" stroke="currentColor" stroke-width="' + SHEET_STROKE + '" stroke-linejoin="round" style="opacity:' + LINE + '"/>' +
        '<path d="M7 14.5l2.2 2.2 4-4.5" ' + tick + '/><line x1="16" y1="15" x2="22" y2="15" ' + ln + '/>' +
        '<path d="M7 21.5l2.2 2.2 4-4.5" ' + tick + '/><line x1="16" y1="22" x2="22" y2="22" ' + ln + '/>' +
        '<line x1="16" y1="29" x2="22" y2="29" ' + ln + ' style="opacity:var(--glyph-mark)"/>' +
        '</svg>';
    }
    if (kind === "checklist") {
      // 문서 안에 확장자 글씨 대신 점검 표시 두 줄.
      return '<svg viewBox="0 0 28 36" style="width:' + Math.round(size * 0.8) + 'px;height:' + size + 'px;color:var(--accent);flex:none;margin:0 4px;">' +
        layers(FILL, FOLD, LINE) +
        '<path d="M7 19l2.5 2.5L14 17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
        '<line x1="17" y1="20" x2="22" y2="20" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
        '<path d="M7 27l2.5 2.5L14 25" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
        '<line x1="17" y1="28" x2="22" y2="28" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
        '</svg>';
    }
    // 폴더는 크기와 무관하게 종이 글리프다 — docShapeIcon 을 거치면 40px 미만에서
    // 선 아이콘으로 떨어져 런처 메뉴에서만 어휘가 갈렸다.
    if (kind === "case") return folderGlyph(size, "accent", count);
    // 파일명이 없으면(홈 타일처럼 개념만 가리킬 때) 확장자 글자 대신 글줄 두
    // 개를 넣는다 — docShapeIcon 은 확장자가 없으면 폴더로 떨어지므로 여기서
    // 가른다. 폴더 글리프의 서류 두 줄과 같은 굵기·농도다.
    if (!title) {
      return '<svg viewBox="0 0 28 36" style="width:' + Math.round(size * 0.8) + 'px;height:' + size + 'px;color:var(--accent);flex:none;margin:0 4px;">' +
        layers(FILL, FOLD, LINE) +
        '<line x1="8" y1="20" x2="20" y2="20" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" style="opacity:var(--glyph-mark)"/>' +
        '<line x1="8" y1="25" x2="16" y2="25" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" style="opacity:var(--glyph-mark)"/>' +
        '</svg>';
    }
    return docShapeIcon(title, size, "accent");
  }

  // 기록형 목록용 글리프. 단일 검토가 HWPX 같은 글자 배지로 축약되면 옆의
  // 비교·폴더·체크리스트 도형과 다른 열처럼 보인다. 외부 받침 면은 두지 않고
  // 도형 내부의 옅은 채움만 유지한다: 별도 검토 기록 34px, 홈 최근 검토 30px.
  function recordShapeIcon(kind, title, size, count) {
    if (kind === "compare" || kind === "case" || kind === "checklist" || kind === "evaluation") {
      return kindShapeIcon(kind, title, size, count);
    }
    return docShapeIcon(title, size, "accent", true);
  }

  function iconTile(glyph, size, sel) {
    var s = size || 34;
    var bg = sel ? "var(--accent)" : "var(--accent-weak)", fg = sel ? "#fff" : "var(--accent-ink)";
    return '<div style="width:' + s + 'px;height:' + s + 'px;flex:none;border-radius:' + Math.round(s * 0.28) + 'px;background:' + bg + ';display:flex;align-items:center;justify-content:center;color:' + fg + ';font-weight:700;font-size:' + Math.round(s * 0.42) + 'px;">' + glyph + '</div>';
  }
  // 심각도 점을 여기 따로 달지 않는다. 면·테두리·글자색이 이미 그 색이라
  // 같은 말을 두 번 하는 것이고, 카드 머리줄(번호 칩·뱃지·신규·위치)은 폭이
  // 빠듯하다. 위쪽 범례와 안 맞아 보이던 건 뱃지 탓이 아니라 **범례 점이
  // 테마를 안 따라가서**였다 — SEV.dot 주석 참고.
  // 표시본이 지면에 찍은 번호. 화면과 PDF가 같은 번호를 가리키게 하는 표식이라
  // 화면이 임의로 매기지 않는다 — 번호가 없으면(표시본 전이거나 못 칠한 지적)
  // 자리를 비운다. 지어낸 번호는 지면에 없는 곳을 가리킨다.
  // 근거가 여럿이면 "1, 2"로 온다.
  // 지적 하나의 심각도 뱃지. **단일 검토와 폴더 검토가 같은 것을 쓴다.**
  //
  // 예전엔 폴더 쪽이 `<span class="mono">major</span>` 맨 글자였다. 같은 심각도가
  // 한쪽에서는 색 채운 알약, 한쪽에서는 회색 소문자로 보여 두 화면이 다른 도구처럼
  // 읽혔다. 뱃지 함수(solidBadge)는 이미 있었는데 폴더 쪽만 안 쓰고 있었다.
  //
  // 미검토는 심각도가 아니다 — "문제를 찾았다"가 아니라 "검사를 못 했다"는 보고라
  // 색을 안 채우고 테두리만 있는 뱃지(badge)로 낸다. 채우면 지적으로 읽힌다.
  function sevBadge(f) {
    var pal = f.unreviewed ? SEV.unreviewed : (SEV[f.sev] || SEV.unknown);
    // 검사 종류와 판정 확실도는 서로 다른 축이다. 한때 `표현 점검 · 모순`을
    // 확실도색의 옅은 빨간 면에 넣어, 태그 이름 자체가 위험 등급처럼 읽혔다.
    // 종류는 중립 태그로, 확실도는 작은 색 점과 글자로 분리한다.
    // 분류는 색 칩 하나(형식·표현·추적·검토 과정), 종류 이름은 회색 글자. 색이 사는 곳은 칩뿐이다.
    // 분류 알약 옆 글자는 **잘못의 종류** 하나(모순·표기·모호). 검사기 이름까지 붙이니
    // "표현 · 문서 전체 점검 · 모순"처럼 같은 말이 세 번 섰다(2026-09-15). 종류가 없을 때만
    // 검사기 이름으로 대신한다 — 분류 하나("형식")로는 무슨 검사인지 모른다.
    var cat = CHECKER_CAT[f.checker] || ["etc", ""];
    var text = f.kind || f.label || cat[1] || "";
    var kindBadge = catChip(cat[0], CAT_LABEL[cat[0]]) +
      (text ? '<span class="finding-kind">' + esc(text) + '</span>' : '');
    // 단일 검토의 "수정 사항" 탭은 지적만 모인 목록이라 카드마다 "● 지적"을 다시 적으면
    // 탭 이름을 57번 되풀이하는 셈이다(2026-09-15). 거기서는 뺀다 — 검토 상태 탭(미검토·
    // 검토 상태)과 폴더 검토처럼 성격이 섞이는 목록에서만 표식이 일을 한다.
    var uniform = state.mode === "single" && state.screen === "results" && !f.unreviewed && f.sev !== "info";
    var confidence = uniform ? '' : '<span class="finding-confidence"><i style="background:' + pal.dot +
      ';"></i>' + esc(f.unreviewed ? "미검토" : (pal.label || "검토 상태")) + '</span>';
    var rescued = f.rescued
      ? '<span class="finding-note-badge">근거 재확인됨</span>'
      : '';
    return kindBadge + confidence + rescued;
  }

  // title 을 안 주면 형광펜 번호로 본다(단일 검토의 기본 용도). 폴더 검토는 같은
  // 칩에 기준 번호를 담으므로 제목을 갈아 끼운다 — 안 그러면 "표시본 PDF의
  // W-작성일자-순서번 형광펜" 같은 툴팁이 뜬다.
  function numberChip(no, title, id, showAll) {
    if (!no) return "";
    var one = function (n, act) {
      // 모양은 index.html 의 .nchip 이 갖는다 — 인라인로 두면 :hover 를 못 써서
      // 누를 수 있다는 것이 보이지 않았다(실제로 몰라서 못 눌렀다).
      return '<span class="nchip"' + act + ' title="' +
        esc(title || (act ? n + "번 형광펜 위치로 이동" : "표시본 PDF의 " + n + "번 형광펜")) +
        '">' + esc(n) + '</span>';
    };
    // 한 지적이 여러 곳을 물면 번호도 여럿이다("3, 4, 5, 6"). **칩을 쪼개 각각
    // 누를 수 있게 한다** — 예전에는 한 덩어리라 카드를 눌러도 늘 첫 번호(3번)로만
    // 갔고, 나머지 셋으로 갈 길이 없었다.
    //
    // 카드를 다시 누르는 것으로는 못 돈다 — 그건 선택 해제다(select 는 토글).
    var parts = id ? String(no).split(",").map(function (n) { return n.trim(); }) : [];
    if (parts.length < 2) {
      return one(no, id ? ' data-act="goMark" data-arg="' + esc(id + "|" + no) + '"' : "");
    }
    // 접힌 카드에서는 앞 몇 개 + "+N" 으로 줄인다. 한 지적이 17곳을 물면
    // (실측: §21.1 수일치 지적) 칩 18개가 카드 폭을 뚫고 나가 헤더가 깨졌다.
    // 펼치면(showAll) 전부 — 컨테이너가 flex-wrap 이라 줄바꿈으로 들어간다.
    var MAX = 6;
    var shown = (showAll || parts.length <= MAX) ? parts : parts.slice(0, MAX - 1);
    var html = shown.map(function (n) {
      return one(n, ' data-act="goMark" data-arg="' + esc(id + "|" + n) + '"');
    }).join("");
    if (shown.length < parts.length) {
      html += '<span class="nchip" title="카드를 펼치면 번호 전체가 보입니다">+' +
        (parts.length - shown.length) + '</span>';
    }
    return html;
  }

  // 지적 카드의 겉·속을 따로 만든다. 카드를 고를 때 화면 전체를 다시 그리면
  // PDF iframe이 DOM에서 떨어졌다 붙으며 리로드된다(=새로고침처럼 보인다).
  // 그래서 app.js의 select는 이 둘로 해당 카드만 갈아끼운다 — 뷰어는 안 건드린다.
  // 모양은 index.html 의 .fcard 규칙이 갖는다 — 인라인으로 두면 :hover 가
  // 인라인에 밀려 안 먹는다. 여기선 상태(펼침)만 클래스로 얹는다.
  function findingCardClass(f) {
    return "fcard" + (f.open ? " on" : "");
  }

  function lineageHtml(L, cand) {
    if (!L) return '';
    // 어느 검토와 대조했는지. 두 번 고친 자리다 — 처음엔 강조 테두리 +
    // "이어서 반영 확인?" 물음이라 눌러야 하는 것처럼 보였고(누를 것이 없다 —
    // 서버가 이미 대조를 끝낸 뒤다), 평서문 한 줄로 바꾸니 이번엔 맨몸 글자가
    // 허공에 떠 보였다. 이 앱에서 문서는 늘 아이콘 + 파일명이다(뷰어 헤더·
    // 업로드·이력) — 대조 대상도 문서니 같은 관용구로, 아래 안내 상자의
    // 머리행으로 넣는다. 알림 셋(대조 대상·요약·안내)이 상자 하나로 모인다.
    var srcRow = cand
      ? '<div style="display:flex;align-items:center;gap:6px;padding-bottom:8px;' +
          'margin-bottom:8px;border-bottom:1px solid var(--line-2);">' +
          '<span style="flex:none;display:flex;">' + docShapeIcon(cand.title, 16, "accent") + '</span>' +
          '<span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' +
            'font-size:12px;font-weight:600;color:var(--text);">' + esc(cand.title) + '</span>' +
          (cand.at ? '<span class="mono" style="flex:none;font-size:12px;color:var(--text-3);">' +
            esc(cand.at) + '</span>' : '') +
          // 누구 검토에 이었는지 — 기록이 팀에 공유되므로(2026-09-09) 내 것이 아닐 수 있다.
          (cand.by ? '<span style="flex:none;font-size:12px;color:var(--text-3);">' +
            esc(cand.by) + '</span>' : '') +
        '</div>'
      : '';
    var items = L.items.map(function (it) {
      // 지적 카드와 같은 관용구(fcard)를 쓴다. 두 탭을 오갈 때 눈이 같은 곳을 보게 —
      // 목록형으로 두었더니 나란히 놓았을 때 딴 화면처럼 보였다.
      //
      // 누르면 문서의 그 자리로 간다. 짝이 없으면(`안 보임`) 갈 데가 없어 안 건다.
      return '<div' + (it.matchId ? ' data-act="select" data-arg="' + esc(it.matchId) + '" tabindex="0" role="button"' : '') +
        ' class="fcard"' + (it.matchId ? '' : ' style="cursor:default;"') + '>' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:10px;">' +
          // **번호를 다 보여준다.** 여기서는 이 칩이 그 자리로 가는 유일한 길이다 —
          // 검토 결과 카드는 접었다가 펼칠 수 있지만(showAll=f.open) 반영 확인
          // 카드에는 펼치는 동작이 없어서, 접으면 `+16` 이 갈 데 없는 안내가 된다
          // (실측 PRJX-DS-014 §3.1.1.2: 근거 21곳 중 5곳만 누를 수 있었다).
          // 헤더가 깨지지 않는 것은 flex-wrap 이 받는다.
          '<span style="display:flex;flex-wrap:wrap;align-items:center;gap:4px;min-width:0;">' +
            numberChip(it.no, null, it.matchId, true) +
            // **기계가 본 것.** 판정의 근거다 — `안 보임` 은 "고쳐졌다"가 아니라
            // "같은 인용을 못 찾았다"일 뿐이라, 검토자가 그 차이를 알아야 한다.
            '<span style="flex:none;font-size:12px;font-weight:600;padding:2px 8px;' +
              'border-radius:var(--r-sm);background:var(--neutral-weak);color:var(--text-3);' +
              'white-space:nowrap;">' + esc(it.auto) + '</span>' +
            // 기계가 정한 것이 아니라 **지난번에 검토자가** 내린 판정이다.
            (it.carried ? '<span style="flex:none;font-size:12px;font-weight:600;' +
              'padding:2px 8px;border-radius:var(--r-sm);background:var(--accent-weak);' +
              'color:var(--accent-ink);">지난 판정</span>' : '') +
          '</span>' +
          // 칩이 여러 줄로 늘어나도 절 표시는 안 찌그러진다.
          '<span style="flex:none;white-space:nowrap;font-variant-numeric:tabular-nums;' +
            'font-size:12px;font-weight:600;color:var(--text-3);">' + esc(it.loc) + '</span>' +
        '</div>' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-end;gap:12px;">' +
          '<span style="flex:1;min-width:0;">' +
            '<div style="font-size:14px;line-height:1.6;color:var(--text);font-weight:500;">' +
              esc(it.message) + '</div>' +
            // 짝이 없으면 이번 문서에 가리킬 자리가 없다. 지난번 인용을 보여줘
            // 검토자가 직접 찾게 한다 — "어딘지 모르겠다"가 그래서 나온다.
            (!it.matchId && it.quote
              ? '<div style="margin-top:6px;font-size:12px;color:var(--text-3);' +
                'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">지난 근거: ' +
                esc(it.quote) + '</div>' : '') +
          '</span>' +
          // 앱이 그리는 셀렉트를 쓴다. 네이티브 <select> 는 펼친 목록을 OS 가
          // 그려서 화면의 다른 목록과 안 어울린다(index.html 의 .sel 참고).
          // id 앞머리 `lnv-` 로 app.js 의 selPick 이 판정 저장으로 잇는다.
          selectField('lnv-' + it.idx, '판정', L.statusOpts,
                      { value: it.status, cls: 'sel-sm' }) +
        '</div>' +
      '</div>';
    }).join('');
    // 신규 지적 목록은 여기서 그리지 않는다. 같은 지적이 아래 카드에도 나와
    // 위아래로 두 번 보였다 — 카드의 `신규` 뱃지가 그 자리를 대신한다.
    // 이 화면을 **어떻게 봐야 하는지**를 화면이 말해야 한다. 어휘를 아무리 골라도
    // 처음 보는 사람은 `그대로 있음`·`안 보임` 이 무엇의 결과인지 모른다 —
    // 기계가 본 것인지 자기가 해야 할 일인지부터 안 갈린다.
    // 용어는 **카드에 실제로 붙는 상태 칩 그대로** 보여주고 옆에 뜻을 단다.
    // 산문에 볼드를 섞어 쓰던 이전 판은 강조 볼드와 용어 볼드가 구별되지 않아
    // "볼드가 무슨 뜻인지"부터 헷갈렸다 — 칩과 같은 생김새면 설명이 필요 없다.
    // 볼드는 딱 하나, 검토자가 바꿔야 할 값(반영됨)에만 남긴다.
    var term = function (t, desc) {
      return '<div style="display:flex;align-items:flex-start;gap:8px;">' +
        '<span style="flex:none;font-size:12px;font-weight:600;padding:2px 8px;' +
          'border-radius:var(--r-sm);background:var(--neutral-weak);color:var(--text-3);' +
          'white-space:nowrap;">' + t + '</span>' +
        '<span style="padding-top:2px;min-width:0;">' + desc + '</span>' +
      '</div>';
    };
    // 상자는 이 패널의 노트 관용구(--bg 면 + --line 테두리 — issuesShell 의
    // annot 노트와 동일)를 쓴다. --neutral-weak 채움이던 때는 안에 넣을 상태
    // 칩(같은 --neutral-weak)이 바닥과 한 색이 돼 사라졌다.
    var legend = '<div style="font-size:13px;line-height:1.6;color:var(--text-2);' +
      'margin-bottom:10px;padding:10px 12px;background:var(--bg);' +
      'border:1px solid var(--line);border-radius:var(--r-sm);">' +
      srcRow +
      '<div style="margin-bottom:8px;color:var(--text-2);">' +
        (cand ? '지난 검토의 수정 사항을 이번 문서에서 다시 찾아본 결과입니다. '
              : '지난 수정 사항을 이번 문서에서 다시 찾아본 결과입니다. ') +
        '고쳐졌다고 단정하지는 않으니 직접 확인하고, 확인했으면 판정을 ' +
        '<b>반영됨</b>으로 바꿔 주세요. 확인 전까지 판정은 모두 미반영입니다.</div>' +
      '<div style="display:flex;flex-direction:column;gap:6px;">' +
        term('그대로 있음', '지적한 문장이 문서에 아직 그대로 있습니다') +
        term('안 보임', '같은 문장을 못 찾았습니다 — 고친 건지 표현만 바뀐 건지는 직접 봐야 합니다') +
        term('판단 못 함', '이번 검사가 불완전해서 알 수 없습니다') +
        term('해당없음', '지난 검토에서 내린 판정입니다 — 다음 검토에도 이어집니다') +
      '</div>' +
      '</div>';
    return '<div id="lineagePanel" style="margin-bottom:16px;">' +
      '<div id="lineageSummary" style="font-size:12px;font-weight:600;color:var(--text-2);margin-bottom:6px;">' + esc(lineageSummaryText(L)) + '</div>' +
      legend + items + '</div>';
  }

  // 카드 안의 원문 인용 줄. verify_quotes 를 통과한 근거만 여기 온다 —
  // 규칙 체커는 근거를 안 달아 빈다(그때는 줄 자체가 없다).
  function evidenceQuotes(f, v) {
    var evs = f.evidence || [];
    if (!evs.length) return "";
    if (!f.open) {
      // 접힌 카드는 한 줄로 자른다. 목록에서는 "어느 문장인지"의 첫 조각이면
      // 충분하고, 전문은 펼치거나 문서에서 본다.
      //
      // 단, 그림에서 읽은 근거가 숨어 있으면 그 사실만은 여기서 말한다 —
      // "외 1곳"만 보고는 그 1곳이 그림인 줄 몰라, 검토자가 본문을 뒤지고도
      // 못 찾는다(실측: 그림 제목의 '인사결정지원' 오타). 펼치면 그림 칩으로
      // 그 그림에 간다.
      var imgNos = evs.map(function (e) { return e.image_no; }).filter(Boolean);
      var tail = evs.length > 1
        ? ' <span style="font-size:12px;color:var(--text-3);">외 ' + (evs.length - 1) + '곳' +
          (imgNos.length ? ' · 그림 ' + imgNos.join(', ') + ' 포함 — 펼쳐서 이동' : '') + '</span>'
        : (imgNos.length ? ' <span style="font-size:12px;color:var(--text-3);">그림 ' + imgNos[0] + ' — 펼쳐서 이동</span>' : '');
      return '<div style="margin-top:8px;font-size:14px;line-height:1.6;color:var(--text);' +
        'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' +
        '<mark class="sev-' + esc(f.sev) + '">' + esc(evs[0].quote || "") + '</mark>' +
        tail +
      '</div>';
    }
    return evs.map(function (e, i) {
      // 이 인용의 형광펜 번호. 같은 절의 인용이 둘이면("운영권 조정"/"운영권조정")
      // 번호가 없을 때 둘째 인용이 문서 어디인지 알 길이 없었다 — 눌러서 간다.
      var no = (f.quoteNos || [])[i];
      var chip = no
        ? '<span class="nchip" data-act="goMark" data-arg="' + esc(f.id + "|" + no) +
          '" title="' + no + '번 형광펜 위치로 이동" style="margin-right:6px;">' + no + '</span>'
        : '';
      // 번호가 없는 인용 = 형광펜을 못 얹은 인용. 왜 없는지를 그 자리에서 말한다
      // (2026-09-15 지적: "세 군데 지적인데 왜 번호가 둘뿐이냐"). 후보 자리가 있으면
      // 눌러서 점선 후보로 간다(app.js goUnlocated).
      if (!no && !e.image_no && state.marks) {
        var un = ((state.marks.unlocated || []).filter(function (x) {
          return x.id === f.id && (x.quote || "") === (e.quote || "");
        })[0]);
        if (un) {
          var nCand = (un.candidates || []).length;
          chip = '<span class="nchip nchip-miss" data-act="goUnlocated" data-arg="' + esc(f.id) +
            '" title="' + esc(un.reason || "원문 위치를 찾지 못했습니다.") + '" style="margin-right:6px;">' +
            (nCand ? '후보 ' + nCand + '곳' : '위치 못 찾음') + '</span>';
        }
      }
      // **원문 인용이 아니라 비전 모델이 그림에서 읽은 글자다.** 안 밝히면 검토자가
      // 원문 인용과 구별할 단서가 하나도 없다 — 실측(PRJX-DS-005 §3.1.4.2): 그림 18
      // 속 `매우 높음` 을 `태우 높음` 으로 읽은 것이 오탈자 지적으로 올랐다.
      // 겸해서 "왜 이 인용에는 번호가 없나"에도 답한다(그림 짝짓기가 실패한 경우).
      // 눌러서 그 그림으로 간다. 갈 자리는 번호 칩과 같다(형광펜이 그림 자체에
      // 얹혀 있다) — 번호는 "몇 번째 지적인가"고 이쪽은 "어느 그림인가"라,
      // 검토자가 누르고 싶은 쪽은 이름이 붙은 이쪽이다. 짝짓기가 실패해 번호가
      // 없으면 갈 데도 없으니 안 건다 — 라벨로는 그대로 남는다.
      // **그림 번호만으로는 검토자가 그 그림을 못 찾는다** — 번호는 문서 안
      // 이미지의 등장 순서라 지면 어디에도 안 적혀 있다(실측 피드백: "그림 1이
      // 뭔지 어떻게 아냐"). 그래서 쪽수와 그림 설명을 함께 말한다.
      //   쪽수 — 형광펜 좌표(marks)가 도착해야 안다. 벡터(WMF) 그림은 PDF 에
      //          이미지 슬롯이 없어 좌표를 못 낸다. 그때는 쪽수가 빈다.
      //   설명 — 비전 모델이 그 그림을 보고 쓴 것(payload.images[].desc).
      //          좌표가 없을 때 그림을 알아보는 유일한 단서다.
      var imgPage = null;
      if (no) {
        var mi = (((state.marks || {}).items) || []).filter(function (x) { return x.id === f.id; })[0];
        var mk = mi && (mi.marks || []).filter(function (x) { return String(x.no) === String(no); })[0];
        imgPage = mk && mk.page;
      }
      var imgDesc = "";
      if (e.image_no) {
        var meta = ((window.DOCREVIEW.images || []).filter(function (x) {
          return String(x.no) === String(e.image_no);
        })[0]) || {};
        imgDesc = meta.desc || "";
      }
      var img = e.image_no
        ? '<span class="nchip"' +
          (no ? ' data-act="goMark" data-arg="' + esc(f.id + "|" + no) + '"' : '') +
          ' title="그림 ' + esc(e.image_no) + (no ? '으로 이동 — ' : ' — 뷰어에서 위치를 찾지 못했습니다(벡터 그림은 좌표를 낼 수 없습니다). ') +
          '비전 모델이 읽은 글자입니다. 원문 인용이 아니므로 그림을 직접 확인하세요"' +
          ' style="margin-right:6px;">그림 ' + esc(e.image_no) +
          (imgPage ? ' · ' + imgPage + '쪽' : '') + '</span>'
        : '';
      // 설명은 칩 밖 회색 글줄로. 인용(mark)과 같은 줄에 두면 어디까지가 원문
      // 인용인지 흐려진다.
      var imgDescLine = (e.image_no && imgDesc)
        ? '<div style="margin-top:2px;font-size:13px;line-height:1.6;color:var(--text-2);">' +
            '그림 ' + esc(e.image_no) + ': ' + esc(imgDesc) + '</div>'
        : '';
      return '<div' + (state.mode === "single" && state.screen === "results"
        ? ' class="single-evidence-quote"'
        : ' style="margin-top:8px;font-size:14px;line-height:1.6;color:var(--text);"') + '>' +
        chip + img +
        '<mark class="sev-' + esc(f.sev) + '">' + esc(e.quote || "") + '</mark>' +
        (e.section && String(e.section) !== String(f.section || "")
          ? ' <span style="font-size:12px;color:var(--text-3);">' + esc(locOf({ section: e.section, page: e.page })) + '</span>' : '') +
        imgDescLine +
        fixLine(f, v, i) +
      '</div>';
    }).join("");
  }

  // 인용 하나의 수정안. **인용마다 따로 만든다.** 예전엔 지적당 하나였고 대상은
  // 언제나 첫 인용이었다 — 지적 하나가 문장 여럿을 근거로 들면(실측: 수일치 오류
  // 지적 하나에 인용 18개) 나머지 문장은 검토자가 손으로 옮겨 적어야 했다.
  //
  // 겸해서 이 줄이 **잘못 끌려온 인용을 드러내는 자리**다. 인용이 문서에 실재하는지는
  // 코드가 대조하지만(verify_quotes) 그 인용에 지적이 해당하는지는 대조할 방법이
  // 없다. 모델이 "고칠 곳이 없다"고 답하면 그 사실을 그대로 보여준다 — 화면이
  // 대신 판정하지 않는다.
  function fixLine(f, v, i) {
    var key = f.id + "|" + i;
    var fx = (v.fixes || {})[key];
    var out = "";
    if (fx && fx.busy) {
      out = '<div style="font-size:13px;color:var(--text-2);display:flex;align-items:center;gap:6px;">' +
        '<span style="display:inline-block;animation:spin 1s linear infinite;">' + ICONS.refresh + '</span>수정안을 만드는 중…</div>';
    } else if (fx && fx.ok) {
      // 갈아끼우는 건 사람이 한다(원본이 PDF·HWPX라 도구가 직접 못 고친다) —
      // 그래서 복사 버튼까지가 이 기능의 끝이다.
      out = '<div class="eyebrow" style="color:var(--accent-ink);margin-bottom:4px;">수정안</div>' +
        '<div style="font-size:14px;line-height:1.6;color:var(--text);font-weight:500;background:var(--accent-weak);padding:8px 10px;border-radius:var(--r-sm);">' + esc(fx.revised) + '</div>' +
        '<div style="display:flex;justify-content:flex-end;margin-top:6px;">' +
        '<button data-act="copyFix" data-arg="' + esc(key) + '" class="linkbtn" style="font-size:14px;">수정안 복사</button></div>';
    } else if (fx) {
      // 못 만든 경우. 이유를 그대로 보여준다 — 조용히 비워두면 버튼이 고장난
      // 줄 안다.
      out = '<div style="font-size:14px;line-height:1.6;color:var(--text);">' + esc(fx.reason) + '</div>';
    }
    // 카드의 행동 버튼은 이것 하나다 — 뺀 "원문에서 보기"(2026-09-09)가 쓰던
    // solid 를 그대로 이어받아, 펼친 카드에서 누를 것이 무엇인지 한눈에 보이게.
    var btn = (fx && fx.busy) ? "" :
      '<div style="display:flex;justify-content:flex-end;margin-top:8px;">' +
      '<button type="button" data-act="suggestFix" data-arg="' + esc(key) + '" class="btn btn-xs btn-primary">' +
      (fx ? "수정안 다시 만들기" : "수정안 만들기") + '</button></div>';
    return '<div style="margin:6px 0 2px 0;">' +
      out + btn + '</div>';
  }

  // 복원 지적의 "재확인 여정" — 처음 인용(대조 실패) → 검색 → 확정 근거.
  // 에이전트가 도구를 들고 문서를 뒤진 과정이다. 결과만 남기면 그 과정이
  // 사라져, 복원 지적이 어디서 왔는지 검토자가 알 길이 없다. 펼친 카드에서만
  // 보인다 — 목록에서는 "근거 재확인됨" 뱃지가 그 역할을 한다.
  function rescueJourney(f) {
    if (!f.open || !f.rescued || !f.rescueTrace) return "";
    var t = f.rescueTrace;
    var rows = [];
    (t.failed_quotes || []).forEach(function (q) {
      rows.push('처음 인용 <span style="text-decoration:line-through;">“' + esc(q) + '”</span> — 문서에 없음');
    });
    (t.searched || []).forEach(function (s) {
      rows.push('문서 검색: <span class="mono">' + esc(s) + '</span>');
    });
    rows.push('다시 인용한 근거가 원문 대조를 통과 — 위 형광펜 문장');
    return '<div style="margin-top:8px;padding:8px 10px;border:1px solid var(--line-2);' +
      'border-radius:var(--r-sm);font-size:13px;line-height:1.6;color:var(--text-2);">' +
      '<div style="font-weight:600;margin-bottom:2px;">근거 재확인 여정</div>' +
      rows.map(function (r) { return '<div>→ ' + r + '</div>'; }).join("") +
    '</div>';
  }

  function findingCardInner(f, v) {
    return '<div class="finding-card-head">' +
        // 형광펜 번호는 맨 앞 — 이 카드의 번호다(2026-09-16 결정). 분류 알약과 나란히 서도
        // 옷이 다르다: 번호는 면 없는 파란 숫자, 분류는 연한 면 알약. 같은 알약 둘로 두니
        // 태그 둘로 읽혀 번호가 손잡이인 게 안 보였다.
        '<span class="finding-card-tags">' +
        (f.no ? '<span class="nchips">' + numberChip(f.no, null, f.id, f.open) + '</span>' : '') +
        sevBadge(f) +
        // 재검토에서 이번에만 나온 지적. 반영 확인 패널이 같은 목록을 한 번 더
        // 그리던 것을 이 표시로 대신한다.
        // 테두리만 있는 꼴 — 옅은 면으로 두면 형광펜 번호 칩(.nchip)과 똑같이 보여 번호로
        // 읽혔다(2026-09-15 지적). 번호 칩은 그대로 두고 이쪽을 갈랐다.
        // 검토자가 반영 확인에서 "우리 문서엔 해당 안 된다"고 정리한 지적이다.
        (f.na ? '<span style="flex:none;font-size:12px;font-weight:600;padding:2px 8px;' +
          'border-radius:var(--r-sm);background:var(--neutral-weak);color:var(--text-3);">지난 검토 해당없음</span>' : '') +
        '</span>' +
        // 잘못된 지적은 검토자가 뺀다(2026-09-15 품질팀). 뺀 것은 다음에 같은 문서를
        // 검토해도 안 올라온다(서버 /dismiss 가 해당없음 판정으로 잇는다). 이어받은
        // 것(carried)은 반영 확인 탭의 판정이 원본이라 여기서 되돌리지 않는다.
        (state.mode === "single" && state.screen === "results" && !f.unreviewed && f.sev !== "info" && f.hidden !== "carried"
          ? (f.hidden === "dismissed"
              ? '<button type="button" class="finding-dismiss" data-act="restoreFinding" data-arg="' + esc(f.id) + '" title="다시 지적으로 되돌립니다">되돌리기</button>'
              // "지적 아님"은 뭔지 몰라 눌러 보게 된다(2026-09-15 지적) — 무엇을 하는지
              // 이름이 말하고(삭제), 누르면 확인을 한 번 받는다(app.js dismissFinding).
              : '<button type="button" class="finding-dismiss" data-act="dismissFinding" data-arg="' + esc(f.id) + '" title="이 지적을 삭제합니다 — 같은 문서를 다시 검토해도 올라오지 않습니다" aria-label="삭제">' + ICONS.trash + '</button>')
          : '') +
        // 신규(이번 재검토에서 처음 나온 지적)는 오른쪽 위치 옆에 글자 하나로 — 왼쪽에
        // 알약으로 두니 번호 칩·분류 알약과 셋이 나란히 서서 번잡했다(2026-09-15).
        '<span class="finding-card-aside">' +
          (f.isNew ? '<span class="finding-new">신규</span>' : '') +
          '<span>' + esc(f.loc) + '</span>' +
          '<span class="finding-card-disclosure" aria-hidden="true">' +
            (state.mode === "single" && state.screen === "results"
              ? '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m4 6 4 4 4-4"/></svg>'
              : esc(f.chevron || "▸")) + '</span>' +
        '</span>' +
      '</div>' +
      // 모양은 CSS 의 .fmsg 가 정한다 — 접힘/펼침에 따라 줄 수와 두께가 달라지는데,
      // 인라인으로 두면 그 규칙이 인라인에 밀려 안 먹는다(.fcard 주석과 같은 이유).
      //
      // 문장마다 줄을 바꾼다. 한두 문장짜리(정상)에는 티가 안 나고, 길게 나온
      // 것에서만 벽이 목록으로 바뀐다. 자르는 규칙은 helpers.sentences 에 있다 —
      // `500.00 GB` 같은 마침표를 문장 끝으로 오해하지 않는 게 핵심이다.
      '<div class="fmsg">' + H.sentences(f.message).map(esc).join("<br>") + '</div>' +
      // **원문 근거를 카드가 직접 보여준다.** 인용 대조를 통과한 문장(이 제품의
      // 계약)이 문서 안에만 칠해져 있어서, 카드에서는 "무엇이 문제인지"만 읽고
      // "어느 문장이 문제인지"는 문서로 눈을 옮겨야 했다. 문서·내보내기와 같은
      // mark.sev-* 형광펜을 그대로 쓴다 — 왼쪽 문서와 오른쪽 카드가 같은 색으로
      // 같은 문장을 가리킨다. 접힌 카드는 첫 인용 한 줄만, 펼치면 전부.
      (state.mode === "single" && state.screen === "results" && f.open && (f.evidence || []).length
        ? '<div class="single-finding-evidence"><div class="single-evidence-label">판정 근거 · 원문 인용</div>' +
            evidenceQuotes(f, v) + '</div>'
        : evidenceQuotes(f, v)) +
      rescueJourney(f) +
      // 같은 문장이 여러 곳이라 자리를 확정 못 한 지적. 후보를 ‹ › 로 옮겨 다닌다
      // (app.js candStep). 카드를 펼쳤을 때만 — 접힌 카드에 단추가 있으면 무엇인지 모른다.
      (f.open && state.cand && state.cand.id === f.id && (state.cand.list || []).length > 1
        ? '<div class="cand-nav" data-cand-nav>' +
            '<button type="button" data-act="candStep" data-arg="-1" aria-label="이전 후보">‹</button>' +
            '<span>같은 문장 <b>' + (state.cand.idx + 1) + '/' + state.cand.list.length + '</b> 곳 — 자리를 확정하지 못해 후보를 점선으로 표시했습니다</span>' +
            '<button type="button" data-act="candStep" data-arg="1" aria-label="다음 후보">›</button>' +
          '</div>'
        : '') +
      (f.criteria ? '<div style="margin-top:6px;font-size:12px;font-weight:600;color:var(--text-3);">기준: ' + esc(f.criteria) + '</div>' : '') +
      // "원문에서 보기" 버튼은 뺐다(2026-09-09). 카드 클릭과 근거 번호 칩이 이미
      // 같은 자리로 가고, 이 화면은 뷰어가 옆에 붙어 있어 새 창도 필요 없다.
      (f.open && f.suggestion ? expand(v.anim.openedId === f.id, suggestBox(f)) : '');
  }

  // 카드 겉껍질(data-act·data-card 속성 포함)을 만드는 **유일한** 자리. 평면
  // 지적 목록과 체크리스트 항목별 목록 둘 다 이 함수로 카드를 그린다 —
  // 각자 따로 카드 껍질을 찍으면 부분 갱신(app.js의 select)이 찾는 앵커가
  // 두 곳으로 갈라져, 한쪽 모양만 고치고 잊는 사고가 난다
  // (test_card_markup_is_shared_between_full_render_and_partial_update 가
  // 그 속성이 소스에 한 번만 나오는지를 지킨다).
  function findingCardHtml(f, v, extraStyle) {
    // tabindex/role: 카드는 div 라 포커스를 못 받는다 — 클릭 위임(app.js)이
    // 키보드에선 Enter/Space 브리지로 이어지므로, 포커스만 받게 하면 된다.
    return '<div data-act="select" data-arg="' + f.id + '" data-card="' + f.id +
      '" tabindex="0" role="button" aria-expanded="' + (f.open ? 'true' : 'false') + '" class="' + findingCardClass(f) + '" style="' + (extraStyle || "") + '">' +
      findingCardInner(f, v) + '</div>';
  }

  // 펼친 카드 아래쪽. 체커가 단 지침이다 — "무엇을 확인하라"는 말이지
  // "이 문장을 이렇게 고쳐라"가 아니다. 구체적 수정안은 인용마다 붙는다(fixLine):
  // 지적 하나가 여러 문장을 근거로 들 때 첫 문장 하나만 고쳐 줄 수는 없다.
  function suggestBox(f) {
    if (!f.suggestion) return "";
    return '<div style="margin-top:14px;padding:14px;background:var(--panel);border:1px solid var(--line-2);border-radius:var(--r-sm);animation:fadeIn var(--dur-2) var(--ease-out);">' +
      '<div class="eyebrow" style="color:var(--accent-ink);margin-bottom:8px;">검토 지침</div>' +
      '<div style="font-size:14px;color:var(--text);line-height:1.6;">' + esc(f.suggestion) + '</div>' +
    '</div>';
  }

  // 오른쪽 패널 접기/펼치기 아이콘(Lucide panel-right-close/open). 홑화살(›)보다
  // "패널을 닫는다"는 직관이 커 접힘↔펼침이 짝으로 읽힌다.
  var ICON_PANEL_CLOSE = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/><path d="m8 9 3 3-3 3"/></svg>';
  var ICON_CHAT = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  // ---- 대화창(A 안) ----
  // 결과 화면 옆에서 DoSuree 와 주고받는 패널. 서버가 chat_enabled 를 줄 때만 있다.
  // 도구 호출은 이름 대신 "무엇을 했나"로 적는다 — mcp__docsuree_get_review 는
  // 검토자에게 뜻이 없다.
  var CHAT_TOOL_LABEL = {
    mcp__docsuree_get_review: "검토 결과를 읽었습니다",
    mcp__docsuree_list_reviews: "검토 목록을 찾았습니다",
    mcp__docsuree_find_in_document: "문서에서 찾았습니다",
    mcp__docsuree_read_section: "절을 읽었습니다"
  };
  // 왼쪽 사이드바용 패널 아이콘 — 칸막이가 왼쪽(x=9)이고 화살표가 접는 방향을 가리킨다.
  // 결과 화면의 ICON_PANEL_* 은 오른쪽 패널용이라 방향이 반대다(2026-09-14 지적).
  var ICON_SIDE_COLLAPSE = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="m16 15-3-3 3-3"/></svg>';
  var ICON_SIDE_EXPAND = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="m14 9 3 3-3 3"/></svg>';
  var ICON_CHAT_BUBBLE = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  // 말풍선 없이 줄로 놓는다(brand/source/reference/chat1.png). 사람 말은 이니셜 + 글,
  // 답은 "DoSuree ✦" 라벨 + 본문 + 복사. 답은 마크다운으로 온다(표·굵게·목록).
  // 말풍선 둘(brand/source/reference/chat3.png, Codex 앱): 사람 말은 오른쪽 짙은 풍선,
  // 답은 왼쪽 연한 풍선. 답 풍선 안 맨 위가 "무엇을 했나"(도구 줄), 맨 아래가 복사.
  function chatLogHtml(c) {
    c = c || {};
    var msgs = c.msgs || [];
    if (!msgs.length) return "";
    return msgs.map(function (m, i) {
      if (m.role === "user") {
        return '<div class="chat-row chat-row-user"><div class="chat-bubble chat-bubble-user">' + esc(m.text) + '</div></div>';
      }
      // 같은 도구를 여러 번 부르면 한 줄로 묶고 무엇을 찾았는지 붙인다 — 다섯 줄이
      // 같은 말이면 잡음이다(2026-09-14 지적). 미완료가 하나라도 있으면 "…".
      var groups = [];
      (m.tools || []).forEach(function (t) {
        var g = groups.filter(function (x) { return x.name === t.name; })[0];
        if (!g) { g = { name: t.name, n: 0, pending: 0, bad: 0, terms: [] }; groups.push(g); }
        g.n++; if (!t.done) g.pending++; if (t.done && !t.ok) g.bad++;
        var a = t.args || {}, term = a.term || a.section_id || a.q || "";
        if (term && g.terms.indexOf(term) < 0) g.terms.push(term);
      });
      var tools = groups.map(function (g) {
        var mark = g.pending ? "… " : (g.bad ? "✗ " : "✓ ");
        var what = g.terms.length ? " · " + g.terms.slice(0, 4).map(function (t) { return "‘" + esc(t) + "’"; }).join(", ") +
          (g.terms.length > 4 ? " …" : "") : "";
        return '<div class="chat-tool">' + mark + esc(CHAT_TOOL_LABEL[g.name] || g.name) + what +
          (g.n > 1 ? ' <span class="chat-tool-n">(' + g.n + '회)</span>' : '') + '</div>';
      }).join("");
      var body = m.text ? '<div class="chat-md">' + H.markdown(m.text) + '</div>'
        : (c.busy ? '<div class="chat-thinking">답하는 중…</div>' : '');
      var actions = m.text && !(c.busy && i === msgs.length - 1)
        ? '<div class="chat-actions"><button type="button" class="chat-action" data-act="chatCopy" data-arg="' + i + '" title="답 복사">복사</button></div>'
        : '';
      return '<div class="chat-row chat-row-assistant"><div class="chat-bubble chat-bubble-bot">' + tools + body + actions + '</div></div>';
    }).join("") + (c.error ? '<div class="chat-row"><div class="chat-error">' + esc(c.error) + '</div></div>' : '');
  }
  // 우하단 마스코트 런처 — 모든 화면에 있다. 홈에서는 빠른 시작 셋도 같이, 어시스턴트가
  // 켜져 있으면 "어시스턴트와 대화"가 맨 위. 예전엔 홈에만 있었고 "채팅이 이 자리에 올
  // 예정"이라고 적혀 있었다(2026-09-14 실현).
  // 우하단 마스코트 = DoSuree 의 얼굴. 누르면 바로 대화다 — 메뉴로 "새 검토" 를 같이 띄웠더니
  // 홈의 "+ 새 검토" 와 겹치고 대화만 아이콘이 달라 이물처럼 보였다(2026-09-14 지적).
  // DoSuree 가 안 켜져 있으면 얼굴도 없다.
  // 말풍선은 둘뿐: 처음 만났을 때 자기소개 한 번, 그리고 검토 완료. 인사·팁·진행 중계는 없다.
  // 이름표를 옆에 띄우거나 버튼을 알약으로 늘리는 건 둘 다 어색했다(2026-09-15) — 마스코트는
  // 그냥 마스코트로 두고, 처음 한 번만 말풍선으로 자기가 누군지 말한다.
  function launcherHtml(v) {
    if (!(state.server && state.server.chat_enabled)) return "";
    var say = state.mascotSay, bubble = "";
    if (say) {
      bubble = '<div class="mascot-say" role="status">' +
        '<button type="button" class="mascot-say-x" data-act="mascotSayClose" aria-label="닫기">' + ICONS.x + '</button>' +
        '<div class="mascot-say-text">' + (say.title ? '<b>' + esc(say.title) + '</b> ' : '') + '검토가 끝났어요.</div>' +
        '<div class="mascot-say-actions">' +
          '<button type="button" class="btn btn-sm btn-primary" data-act="mascotSayOpen">결과 보기</button>' +
          ((say.kind === "review" || say.kind === "compare" || say.kind === "evaluation") && say.history_id
            ? '<button type="button" class="btn btn-sm btn-ghost" data-act="mascotSayAsk">물어보기</button>' : '') +
        '</div>' +
      '</div>';
    } else if (!(state.chat && state.chat.seen)) {
      bubble = '<div class="mascot-say" role="status">' +
        '<button type="button" class="mascot-say-x" data-act="mascotIntroClose" aria-label="닫기">' + ICONS.x + '</button>' +
        '<div class="mascot-say-text"><b>DoSuree</b> 예요. 검토 결과가 왜 그렇게 나왔는지, 문서 어디에 뭐가 있는지 물어보세요.</div>' +
        '<div class="mascot-say-actions">' +
          '<button type="button" class="btn btn-sm btn-primary" data-act="launcherChat">대화 시작</button>' +
        '</div>' +
      '</div>';
    }
    // 평소엔 마우스를 올릴 때만 작은 말풍선("DoSuree 와 대화")이 뜬다 — 브라우저 툴팁 대신
    // 마스코트가 말하는 모양. 다른 말풍선이 떠 있으면 안 겹치게 안 단다.
    var hover = bubble ? '' : '<span class="mascot-say mascot-say-hover" aria-hidden="true">DoSuree 와 대화</span>';
    return bubble +
      '<button type="button" class="home-launcher" data-act="launcherChat" aria-label="DoSuree 와 대화">' +
        '<img src="public/mascot-investigator-192.png?v=20260820" alt="">' +
      '</button>' + hover;
  }

  // 어시스턴트 — DocSuree 껍데기(사이드바·헤더) 없이 **DoSuree 의 얼굴**로 그린다.
  // ChatGPT 웹 ↔ Codex CLI 처럼, DoSuree 웹 ↔ DoSuree CLI. 검토 화면은 결과를 보는
  // 도구고 대화는 말을 주고받는 도구라 한 껍데기 안에 나란히 두면 이어 붙인 것처럼
  // 보였다(2026-09-14 지적). 왼쪽 대화 기록, 가운데 대화. DocSuree 로는 링크 하나.
  function assistantView(v) {
    var c = state.chat || {};
    var cur = c.current || null;
    // 대화 기록은 날짜로 묶는다(오늘 · 지난 7일 · 이전). 참고 화면의 "Last 7 Days".
    var now = Date.now() / 1000, groups = [["오늘", []], ["지난 7일", []], ["이전", []]];
    (c.sessions || []).forEach(function (s) {
      var age = now - (s.updated || 0);
      (age < 86400 ? groups[0] : age < 7 * 86400 ? groups[1] : groups[2])[1].push(s);
    });
    var item = function (s) {
      var on = cur && cur.id === s.id;
      return '<div class="assistant-item' + (on ? ' on' : '') + (s.missing ? ' missing' : '') +
        '" data-act="chatOpen" data-arg="' + esc(s.id) + '" tabindex="0" role="button" title="' + esc(s.review_title || '') + '">' +
        '<span class="assistant-item-ico">' + ICON_CHAT_BUBBLE + '</span>' +
        '<span class="assistant-item-title">' + esc(s.title || '(제목 없음)') + (s.missing ? ' · 삭제됨' : '') + '</span>' +
        '<span class="assistant-item-actions">' +
          '<button type="button" class="assistant-item-btn" data-act="chatRename" data-arg="' + esc(s.id) + '" title="이름 바꾸기">' + ICONS.settings + '</button>' +
          '<button type="button" class="assistant-item-btn" data-act="chatDelete" data-arg="' + esc(s.id) + '" title="삭제">' + ICONS.x + '</button>' +
        '</span>' +
      '</div>';
    };
    var list = groups.filter(function (g) { return g[1].length; }).map(function (g) {
      return '<div class="assistant-group">' + esc(g[0]) + '</div>' + g[1].map(item).join("");
    }).join("");
    // 검토 문맥의 그림. 비교 검토(제목이 "A ↔ B")는 상위·하위 표를 단 문서 둘을 대조 기호로
    // 잇는다 — 이름 둘을 한 줄로 이으니 잘려서 "…↔ PRJX-DS-014_상"이 됐고, 대조한다는 것도
    // 안 보였다(2026-09-16). 긴 이름은 가운데를 줄여 확장자를 살린다.
    var midCut = function (name, max) {
      name = String(name || "");
      if (name.length <= max) return name;
      var tail = Math.min(12, Math.floor(max / 2));
      return name.slice(0, max - tail - 1) + "…" + name.slice(-tail);
    };
    var docCtxHtml = function (title, max, stacked) {
      // 쌍인지는 공용 규칙(helpers.docSides)으로 가른다 — 화면이 구분자를 따로 알면 갈린다.
      var parts = String(title || "").indexOf(" ↔ ") >= 0 ? H.docSides(title) : [];
      if (parts.length !== 2) return ICONS.fileText + '<span class="doc-ctx-name">' + esc(midCut(title, max)) + '</span>';
      // 머리줄 칩은 한 줄 — 두 줄로 쌓으니 머리줄만 두꺼워져 이상했다(2026-09-16). 이름은 각각 짧게,
      // 전체는 툴팁과 인사 화면이 말한다.
      if (!stacked) {
        // 화살표 대신 상위·하위 작은 표 — "↔" 글자 하나는 옹졸해 보였다(2026-09-16).
        return '<span class="doc-ctx-name doc-ctx-pair" title="' + esc(title) + '">' +
          '<b>상위</b>' + esc(midCut(parts[0], max)) + '<b>하위</b>' + esc(midCut(parts[1], max)) + '</span>';
      }
      // 인사 화면은 상하로 쌓는다 — 각 이름이 한 줄을 다 써서 안 잘리고, 위가 상위·아래가 하위라 관계도 읽힌다.
      return '<span class="doc-pair">' +
        '<span class="doc-pair-doc"><b>상위</b><span>' + esc(midCut(parts[0], max)) + '</span></span>' +
        '<span class="doc-pair-doc"><b>하위</b><span>' + esc(midCut(parts[1], max)) + '</span></span>' +
      '</span>';
    };
    // 문맥 칩은 라벨이다. 나가는 문은 "돌아가기" 하나 — 들어온 자리가 이 검토가 아닐 때만(목록에서
    // 옛 대화를 열었을 때) 칩 안에 "열기"를 단다.
    var ret = state.assistantReturn || {};
    var ctxChip = cur && cur.review_id
      ? '<span class="assistant-chip">' + docCtxHtml(cur.review_title || cur.review_id, 22) +
          (ret.reviewId !== cur.review_id
            ? ' <button type="button" class="assistant-chip-open" data-act="openHistory" data-arg="' + esc(cur.review_id) + '" title="DocSuree 에서 이 검토 결과 열기">열기</button>'
            : '') + '</span>'
      : (c.pendingReviewTitle
        ? '<span class="assistant-chip">' + docCtxHtml(c.pendingReviewTitle, 22) + '</span><span class="assistant-ctx-note">첫 말을 보내면 이 검토를 기준으로 답합니다</span>'
        : '');   // 검토가 없으면 아무 말도 안 한다 — "없다"는 안내는 잡음이었다(2026-09-14 지적)
    // 빈 화면(brand/source/reference/chat2.png): 아이콘 · 제목 · 부제 · 시작 카드.
    // 검토를 안고 왔으면 인사 자리에 그 문서가 선다 — 위 칩 하나로는 "이 대화가 그 문서
    // 얘기"라는 게 안 보였다(2026-09-15 지적). 카드도 그 검토 것만 남긴다.
    var ctxTitle = c.pendingReviewTitle || "";
    // 체크리스트 검토(부록 B 초안)는 지적이 없다 — 행의 status 셋과 "다시 찾기"가 물을 거리다.
    var cards = ctxTitle && c.pendingReviewKind === "evaluation" ? [
      ["근거 못 찾은 항목", "근거를 못 찾은 항목을 알려 주고, 각각 어떤 말로 다시 찾아보면 좋을지 제안해 줘"],
      ["다른 말로 다시 찾기", "근거 못 찾은 항목 중 첫 번째를 다른 낱말로 문서에서 다시 찾아 줘"],
      ["폐기된 항목", "모델 주장을 폐기한 항목은 뭐고 왜 폐기됐어?"],
      ["의견 문장 쓰기", "미흡으로 제안된 항목을 검토 의견 문장으로 정리해 줘"]
    ] : ctxTitle && c.pendingReviewKind === "compare" ? [
      // 비교 검토는 지적보다 요건 행(누락·연결)이 물을 거리다.
      ["누락 요건 추리기", "누락된 요건 중 인터페이스와 관련된 것만 추려 줘"],
      ["상하위 서술 비교", "연결된 요건 하나를 골라 상위와 하위 서술이 어디서 갈리는지 설명해 줘"],
      ["지난 판과 비교", "이 문서쌍의 직전 검토와 비교해 누락이 얼마나 줄었는지 알려 줘"],
      ["요약해 줘", "이 비교 결과를 연결됨·누락·범위 밖 건수로 짧게 요약해 줘"]
    ] : ctxTitle ? [
      ["지적 근거 보기", "이 검토의 지적을 근거 원문과 함께 보여줘"],
      ["검사 못 한 항목", "이 검토에서 검사 못 한 항목은 뭐고 왜 못 했어?"],
      ["지난 판과 비교", "이 문서의 직전 검토와 비교해 어떤 지적이 사라지고 남았는지 알려 줘"],
      ["요약해 줘", "이 검토 결과를 심각도별로 짧게 요약해 줘"]
    ] : [
      // 문맥 없이 열면 기록을 가로지르는 질문이 제자리다(search_findings, 2026-09-17).
      ["최근 검토 살펴보기", "내가 볼 수 있는 검토 중 최근 것 3개를 제목과 검토자로 보여줘"],
      ["자주 나온 지적", "최근 검토들에서 자주 나온 지적이 뭔지 검사기별로 정리해 줘"],
      ["같은 지적 찾기", "'표기 규칙' 지적이 있었던 검토를 다 찾아 문서 이름과 날짜로 보여줘"],
      ["문서에서 찾기", "검토 하나를 골라 그 문서에서 '권고'라는 말이 나오는 곳을 찾아줘"]
    ];
    var hello = ctxTitle
      ? '<div class="chat-hello-doc">' + docCtxHtml(ctxTitle, 60, true) + '</div>' +
        '<div class="chat-hello">이 검토에 대해 물어보세요</div>' +
        '<div class="chat-hello-sub">DoSuree 가 이 검토의 지적 · 근거 · 문서 본문을 읽어 답합니다.<br>읽기만 하고 판정은 바꾸지 않습니다.</div>'
      : '<div class="chat-hello">무엇을 도와드릴까요?</div>' +
        '<div class="chat-hello-sub">DoSuree 가 검토 결과 · 팀 기준 · 문서 본문을 읽어 답합니다.<br>읽기만 하고 판정은 바꾸지 않습니다.</div>';
    // 여는 중이면 인사 대신 "불러오는 중" — 검토 화면에서 넘어올 때 한두 번 왕복이 있다.
    var empty = c.opening
      ? '<div class="chat-empty chat-opening"><img class="chat-hello-mascot" src="public/mascot-investigator-192.png?v=20260820" alt="">' +
          '<div class="chat-hello-sub"><span class="chat-opening-spin" aria-hidden="true">' + ICONS.refresh + '</span> 대화를 불러오는 중…</div></div>'
      : !(c.msgs || []).length
      ? '<div class="chat-empty"><img class="chat-hello-mascot" src="public/mascot-investigator-192.png?v=20260820" alt="">' +
          hello +
          '<div class="assistant-cards">' + cards.map(function (k) {
            return '<button type="button" class="assistant-card" data-act="chatChip" data-arg="' + esc(k[1]) + '">' +
              '<strong>' + esc(k[0]) + '</strong><span>' + esc(k[1]) + '</span></button>';
          }).join("") + '</div></div>'
      : '';
    var uName = state.user ? state.user.name : "";
    var headTitle = cur ? (cur.title || "") : "";   // 새 대화엔 제목이 없다 — "새 대화"라고 적지 않는다
    var collapsed = !!c.sideCollapsed;
    // 접힘은 aside 를 없애지 않고 폭을 0 으로 접는다(CSS transition). 없애면 애니메이션이 없다.
    var ICON_PLUS = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>';
    return '<div class="dr-app assistant-app' + (collapsed ? ' side-collapsed' : '') + '">' +
      // 접으면 aside 가 없어지지 않고 52px 레일이 된다(chat4.png, ChatGPT): 펼치기 · 새 대화 · 나.
      // 펼친 내용(.assistant-side-full)과 레일(.assistant-rail)이 둘 다 DOM 에 있고 CSS 가 하나만 보인다.
      ('<aside class="assistant-side">' +
        '<div class="assistant-rail" aria-hidden="' + (collapsed ? 'false' : 'true') + '">' +
          '<button type="button" class="assistant-rail-btn assistant-side-expand" data-act="toggleAssistantSide" title="사이드바 펼치기" aria-label="사이드바 펼치기">' + ICON_SIDE_EXPAND + '</button>' +
          '<button type="button" class="assistant-rail-btn" data-act="chatNew" title="새 대화" aria-label="새 대화">' + ICON_PLUS + '</button>' +
          (uName ? '<div class="assistant-rail-foot"><span class="chat-avatar" title="' + esc(uName) + '">' + esc(uName.charAt(0)) + '</span></div>' : '') +
        '</div>' +
        '<div class="assistant-side-full" aria-hidden="' + (collapsed ? 'true' : 'false') + '">' +
        // 위는 워드마크 하나와 돌아가는 링크뿐(chat3, Codex). 마스코트·문구는 빈 화면 인사에만 —
        // 사이드바에도 두니 같은 그림이 겹쳤다(2026-09-14 지적).
        // 위는 워드마크 하나(chat3 의 "Codex" 자리). 돌아가는 길은 아래에 모양이 다른 버튼으로
        // 뗀다 — 워드마크 옆에 두면 DocSuree/DoSuree 가 나란히 서서 오타처럼 읽혔다(2026-09-14).
        // 워드마크는 DocSuree 사이드바와 같은 규격(.brand-wordmark 18px, 뒷말만 브랜드색).
        '<div class="assistant-top">' +
          '<div class="brand-wordmark" style="font-size:18px;">Do<span style="color:var(--accent-ink);">Suree</span></div>' +
          '<button type="button" class="result-icon-btn assistant-side-toggle" data-act="toggleAssistantSide" title="사이드바 접기" aria-label="사이드바 접기">' + ICON_SIDE_COLLAPSE + '</button>' +
        '</div>' +
        '<div class="assistant-side-top">' +
          '<button type="button" class="btn btn-primary assistant-new" data-act="chatNew">+ 새 대화</button>' +
        '</div>' +
        '<div class="assistant-list-head">내 대화</div>' +
        '<div class="assistant-list">' + (list || '<div class="assistant-empty">아직 대화가 없습니다.</div>') + '</div>' +
        (uName ? '<div class="assistant-side-foot"><div class="assistant-foot-row assistant-foot-user">' +
          '<span class="chat-avatar">' + esc(uName.charAt(0)) + '</span><span>' + esc(uName) + '</span></div></div>' : '') +
        '</div>' +
      '</aside>') +
      '<main class="assistant-main-col">' +
        // 흰 헤더 띠는 없다 — 대화 제목·문맥 칩·나가기가 배경 위에 그냥 놓인다(2026-09-14).
        '<div class="assistant-head">' +
          '<div class="assistant-head-title">' + esc(headTitle) + '</div>' +
          '<div class="assistant-head-ctx">' + ctxChip +
            // 나가기는 머리줄 오른쪽 버튼 하나. 우하단 로고 버튼도 해 봤지만 두 마스코트가 같은
            // 얼굴이라 뜻이 갈렸다(2026-09-16). 들어온 자리로 돌아간다.
            '<button type="button" class="btn btn-sm btn-ghost assistant-help" data-act="openHelp" title="도움말">도움말</button>' +
            '<button type="button" class="btn btn-sm btn-primary assistant-back" data-act="assistantBack">' +
              ICONS.arrowLeft + '<span>' + (state.assistantReturn && state.assistantReturn.reviewId ? '검토로 돌아가기' : 'DocSuree 로') + '</span></button>' +
            // 나가기는 전역 동작 — 전체 화면 하위 앱의 관례대로 오른쪽 위 끝(2026-09-14 결정).

          '</div>' +
        '</div>' +
        '<div id="chatLog" class="chat-log">' + empty + chatLogHtml(c) + '</div>' +

        '<div class="chat-composer"><div class="chat-composer-box">' +
          '<textarea id="chatInput" rows="1" placeholder="무엇이든 요청하세요" maxlength="4000"' + (c.opening ? ' disabled' : '') + '></textarea>' +
          '<div class="chat-composer-row">' +
            '<span class="chat-hint">Enter 보내기 · Shift+Enter 줄바꿈 · 답은 검토 기록과 문서 본문에서만</span>' +
            '<button type="button" id="chatStop" class="btn btn-sm btn-ghost" data-act="chatAbort" style="display:' + (c.busy ? "" : "none") + ';">멈춤</button>' +
            '<button type="button" id="chatSend" class="btn btn-primary chat-send" data-act="chatSay" title="보내기"' + (c.busy ? ' disabled' : '') + '>' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/></svg></button>' +
          '</div>' +
        '</div></div>' +
      '</main>' +
    '</div>' + helpSheetHtml();   // 도움말은 DocSuree 머리줄이 없는 이 화면에서도 열린다(2026-09-17)
  }

  var ICON_PANEL_OPEN = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/><path d="m10 15-3-3 3-3"/></svg>';

  // 범례 한 줄: 색 점 + 이름 + 한 줄 설명.
  function legendRow(dotColor, label, desc) {
    return '<div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:10px;">' +
        '<span style="flex:none;width:8px;height:8px;border-radius:50%;background:' + dotColor + ';margin-top:6px;"></span>' +
        '<div>' +
          '<div style="font-size:13px;font-weight:600;color:var(--text);">' + esc(label) + '</div>' +
          '<div style="font-size:12px;color:var(--text-3);line-height:1.6;">' + esc(desc) + '</div>' +
        '</div>' +
      '</div>';
  }
  function card(inner, pad) {
    return '<div style="background:var(--panel);border:1px solid var(--line);border-radius:var(--r-sm);padding:' + (pad || "20px") + ';">' + inner + '</div>';
  }
  // 뒤로가기 링크. 화면마다 붙여넣지 않는다 — 문구도 간격도 한 곳에서 정한다.
  // "목록으로 돌아가기" 맞은편. 홈을 거쳐 돌아오는 길은 검토가 끝난 화면을
  // 다시 보여줄 뿐이라(screen이 results에 머문다), 다음 문서로 가려면 별도의
  // 길이 필요하다.
  //
  // 아이콘은 문서+플러스다. 새로고침 화살표를 쓰면 "같은 문서를 다시 돌린다"로
  // 읽히는데, 이건 다른 문서를 새로 올리는 길이다.
  var ICON_DOC_PLUS = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h6"/><polyline points="14 2 14 8 20 8"/><line x1="18" y1="14" x2="18" y2="20"/><line x1="15" y1="17" x2="21" y2="17"/></svg>';

  function newReviewLink(which) {
    return '<div class="hover-accent" data-act="newReview" data-arg="' + (which || "single") + '" tabindex="0" role="button" ' +
      'title="다른 문서를 새로 올려 검토합니다" ' +
      'style="display:inline-flex;align-items:center;gap:6px;font-size:14px;font-weight:500;' +
      'color:var(--text-3);cursor:pointer;padding:8px;">' + ICON_DOC_PLUS + ' 새 문서 검토</div>';
  }

  function backLink(mode, label) {
    return '<div class="hover-accent" data-act="setMode" data-arg="' + mode + '" tabindex="0" role="button" style="display:inline-flex;align-self:flex-start;align-items:center;gap:6px;font-size:14px;font-weight:500;color:var(--text-3);cursor:pointer;padding:8px;margin-left:-8px;">' + ICONS.arrowLeft + ' ' + esc(label) + '</div>';
  }

  // 결과 화면(단일·비교·폴더)의 왼쪽 백링크. "목록으로 돌아가기"는 기록에서
  // 열었을 때만 참말이다 — 방금 업로드→검토를 마친 사람은 목록에 간 적이
  // 없는데 "돌아가라"고 하니 뒤로가기가 이상하다고 읽혔다(2026-09-01 지적).
  // 그 흐름에서는 아무것도 안 낸다: 다음 행동은 오른쪽 "새 검토" 링크가 지고,
  // 결과는 사이드바 검토 기록에 저장돼 있다. 빈 span 이 자리를 지켜
  // space-between 의 오른쪽 링크가 제자리에 남는다.
  function resultsBackLink() {
    // 방금 돌린 검토에는 뒤로가기가 **아예 없었다** — 결과를 보고 나면 "새 문서
    // 검토" 말고는 나갈 손잡이가 없어 갇힌 화면이 됐다(2026-09-02 피드백).
    // 갓 돌린 결과는 온 곳이 업로드 화면인데 거기로 되돌리면 방금 올린 파일이
    // 그대로 있어 "돌아왔다"가 아니라 "다시 하라"로 읽힌다. 홈이 맞다.
    if (!state.fromHistory) return backLink("home", "홈으로");
    // 출처대로 말한다(2026-09-01 지적: 홈에서 열었는데 "목록으로 돌아가기"는
    // 거짓말). 홈·기록에서 연 것은 "돌아가기"가 참말이고, 검색·알림처럼 다른
    // 화면에서 연 것은 가 본 적 없는 곳이라 "돌아가기"를 빼고 방향만 말한다.
    if (state.historyOrigin === "home") return backLink("home", "홈으로 돌아가기");
    if (state.historyOrigin === "history") return backLink("history", "목록으로 돌아가기");
    return backLink("history", "검토 기록으로");
  }

  // 페이지 헤더 — 화면당 하나, **카드 밖**에 선다. 제목은 브랜드 서체
  // (.page-title = 제목 서체 700 · 26px), 밑에 한 줄 부제와 얇은 구분선.
  // 예전엔 제목이 큰 흰 카드 **안**에 있어서, 페이지 제목인지 카드 제목인지
  // 위계가 섞여 보였다 — 판단 규칙: 화면 하나에 하나면 페이지 제목(여기),
  // 그 안의 덩어리면 섹션·카드 제목(본문 서체 600~700)이다.
  //
  // **크기**(2026-09-02): 홈 인사말(.home-greeting-title)과 같은 22px 눈금이다.
  // 28 로도 가 봤는데 컸다 — 제목을 세우는 것은 크기가 아니라 **한 줄 안에서
  // 갈리는 굵기**였다(index.html .page-title 주석에 다섯 번의 왕복을 적어 뒀다).
  // 이름은 사이드바와 같은 말을 쓴다(길을 잃지 않게). **지금 할 일**은 밑줄이 진다.
  //
  // actions 는 오른쪽에 붙는 버튼 묶음(검토 기록의 새로고침·전체 삭제)이다.
  // 예전엔 그 화면이 이 함수를 안 쓰고 같은 꼴을 손으로 베껴 뒀는데, 규격이
  // 바뀔 때마다 한쪽만 따라와 뒤처졌다 — 제목 굵기를 700 으로 올렸을 때
  // 거기만 500 으로 남았다(2026-09-02). 베끼는 대신 자리를 만든다.
  // 제목은 한 덩어리다(2026-09-04). 앞말/뒷말 굵기를 가르던 보정은 뺐다 —
  // index.html .page-title 주석 참고. 크기는 CSS 가 진다(26px, 좁으면 22px).
  function titleHtml(title) { return esc(String(title || "")); }

  // 머리말은 낮고 조용하게(2026-09-04). "텅 비고 느낌 없다"를 색 채운 아이콘
  // 면으로 메워 봤는데 제목 옆 장식 아이콘은 낡은 관용구였다("촌스럽다").
  // 레퍼런스(Linear 계열 설정 화면)는 채우지 않고 **붙여서** 푼다 — 제목을
  // 크지 않게, 부제는 한 줄, 밑줄 없이 곧장 내용으로. 머리말 밑 hairline 은
  // 아래 패널 테두리와 겹으로 구분을 만들어 그 사이가 빈 띠로 보였다.
  function pageHead(title, sub, actions) {
    return '<div style="display:flex;justify-content:space-between;align-items:flex-end;' +
      'gap:16px;padding-bottom:2px;">' +
      '<div style="min-width:0;">' +
        // .headline 을 안 단다 — 제목은 굵기가 한 줄 안에서 갈리는 제 규격이
        // 있다(index.html .page-title). 겹쳐 달고 덮어쓰면 "왜 둘 다 있나"가
        // 남는다. 굵기·서체는 클래스가 진다: 인라인으로 두면 규칙이 CSS 밖으로
        // 새고, 다른 자리에 그대로 복사된다.
        '<h1 class="page-title" style="margin:0;' +
          'line-height:1.2;color:var(--text);">' + titleHtml(title) + '</h1>' +
        // 시험 중(2026-09-04): 부제 13px·보통 굵기. 되돌리기는 14px·500.
        (sub ? '<p style="margin:4px 0 0;font-size:13px;font-weight:400;line-height:1.6;' +
          'color:var(--text-3);">' + esc(sub) + '</p>' : '') +
      '</div>' +
      (actions ? '<div style="display:flex;gap:8px;flex:none;">' + actions + '</div>' : '') +
    '</div>';
  }
  // PDF 표시본을 굽는 동안의 자리. 실제 PDF 뷰어처럼 회색 뷰포트 안에 한 장의
  // 종이가 폭을 채우고, 제목·본문·표가 문서 전체 높이에 걸쳐 먼저 자리 잡는다.
  // 중앙에 글줄 몇 개만 띄웠을 때는 로딩이 끝나는 순간 배경과 문서 폭이 한꺼번에
  // 바뀌어 화면이 덜컥거렸다. .skel 은 index.html 의 공용 반짝임 막대다.
  function pdfPendingHtml(label) {
    var bar = function (w, h) {
      return '<div class="skel" style="width:' + w + ';height:' + (h || 8) + 'px;opacity:.62;"></div>';
    };
    var copy = function (widths) {
      return '<div class="pdf-pending-copy">' + widths.map(function (w) {
        return bar(w, 7);
      }).join("") + '</div>';
    };
    var cells = ["62%", "45%", "54%", "78%", "58%", "66%", "70%", "50%", "61%"]
      .map(function (w) {
        return '<div class="pdf-pending-cell">' + bar(w, 7) + '</div>';
      }).join("");
    return '<div class="pdf-pending" role="status" aria-live="polite" aria-label="' + esc(label) + '">' +
      '<div class="pdf-pending-status"><span aria-hidden="true">' + ICONS.refresh + '</span>' +
        '<span>' + esc(label) + '</span></div>' +
      '<div class="pdf-pending-page" aria-hidden="true">' +
        '<div class="pdf-pending-page-head">' +
          '<div class="pdf-pending-block">' + bar("58%", 14) + bar("82%", 9) + '</div>' +
          '<div class="pdf-pending-block">' + bar("100%", 8) + bar("72%", 8) + '</div>' +
        '</div>' +
        '<div class="pdf-pending-rule"></div>' +
        '<div class="pdf-pending-section">' + bar("30%", 11) +
          '<div style="height:14px;"></div>' + copy(["100%", "96%", "88%", "94%", "64%"]) + '</div>' +
        '<div class="pdf-pending-section">' + bar("24%", 11) +
          '<div class="pdf-pending-table">' + cells + '</div></div>' +
        '<div class="pdf-pending-section">' + bar("34%", 11) +
          '<div style="height:14px;"></div>' + copy(["100%", "91%", "97%", "74%"]) + '</div>' +
      '</div>' +
    '</div>';
  }
  // 검사 단계를 드롭존 아래 한 줄로. 예전엔 오른쪽 320px 세로 패널이었는데
  // 업로드 상자와 폭을 나눠 가져 화면의 주인공이 둘이었다(2026-09-04). 단계
  // 설명은 title 로 남긴다 — 검사 시작 전에 무엇을 보는지는 여기서만 읽힌다.
  function pipelineStrip(label, stages) {
    return '<div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;margin-top:14px;font-size:12px;">' +
      '<span class="eyebrow" style="font-size:12px;color:var(--text-3);">' + esc(label) + '</span>' +
      stages.map(function (s, i) {
        var n = (i + 1 < 10 ? "0" : "") + (i + 1);
        return '<span title="' + esc(s.desc || "") + '" style="display:inline-flex;align-items:center;gap:6px;color:var(--text-2);font-weight:500;">' +
          '<span class="mono" style="font-size:12px;color:var(--accent-ink);">' + n + '</span>' + esc(s.label) + '</span>';
      }).join('<span aria-hidden="true" style="color:var(--text-3);">›</span>') +
    '</div>';
  }
  // Drag-and-drop file picker. opts: { slot, file, nav? }. `file` is
  // {name,size} from state or null. Wired via data-drop / data-slot in boot().
  function dropzone(opts) {
    var f = opts.file, id = "file-" + opts.slot;
    var navAttr = opts.nav ? ' data-nav="' + opts.nav + '"' : "";
    // 기본은 문서. 체크리스트 검토의 오른쪽 칸만 xlsx 를 받는다 — 거기에 문서를
    // 올리면 서버가 400 으로 되돌리므로 고르는 창에서 미리 갈라 준다.
    // 순서는 안내 문구에 그대로 나간다 — 주력 포맷(hwpx)이 앞이다.
    var accept = opts.accept || ".hwpx,.hwp,.docx,.pdf,.md,.txt";
    var input = '<input id="' + id + '" type="file" data-slot="' + opts.slot + '"' + navAttr +
      ' accept="' + accept + '" style="display:none;">';
    var big = !!opts.big;
    var body;
    if (f) {
      if (big) {
        body = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:20px 0;">' +
          docShapeIcon(f.name, 52, 'accent') +
          '<div style="text-align:center;width:100%;">' +
            '<div style="font-weight:700;font-size:15px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:80%;margin:0 auto 6px;">' + esc(f.name) + '</div>' +
            '<div class="mono" style="font-size:13px;color:var(--text-3);">' + esc(fmtSize(f.size)) + '</div>' +
          '</div>' +
          '<div style="display:flex;gap:16px;align-items:center;margin-top:20px;">' +
            '<span style="display:flex;align-items:center;gap:4px;font-size:12px;font-weight:600;color:var(--band-good-fg);background:var(--band-good-bg);padding:6px 12px;border-radius:var(--r-xl);">' + ICONS.check + ' 첨부 완료</span>' +
            '<button class="btn btn-ghost btn-ghost-accent" data-act="clearFile" data-arg="' + opts.slot + '">제거</button>' +
          '</div>' +
        '</div>';
      } else {
        body = '<div style="display:flex;align-items:center;gap:16px;">' + docShapeIcon(f.name, 52, 'accent') +
          '<div style="min-width:0;flex:1;">' +
            '<div style="font-weight:700;font-size:15px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(f.name) + '</div>' +
            '<div class="mono" style="font-size:12px;color:var(--text-3);margin-top:4px;">' + esc(fmtSize(f.size)) + '</div>' +
          '</div>' +
          '<span style="flex:none;display:flex;align-items:center;gap:4px;font-size:12px;font-weight:600;color:var(--band-good-fg);background:var(--band-good-bg);padding:6px 12px;border-radius:var(--r-xl);">' + ICONS.check + ' 첨부 완료</span>' +
          '<button class="btn btn-ghost btn-ghost-accent" data-act="clearFile" data-arg="' + opts.slot + '" style="flex:none;">제거</button>' +
        '</div>';
      }
    } else {
      body = '<div data-act="openFile" data-arg="' + opts.slot + '" style="cursor:pointer;text-align:center;padding:' + (big ? "40px 20px" : "28px 20px") + ';">' +
        // 빈 상자는 조용하게 — 단색 라인 아이콘, 보통 굵기 문구, 1px 점선.
        // 그라디언트 문서 그림·굵은 글씨·2px 점선이던 때는 빈 상태부터 꽉 차서
        // 파일이 붙어도 전후가 잘 안 갈렸다(2026-09-04). 색은 붙은 뒤에만 난다.
        // 색은 solid 버튼 하나에만(2026-09-04). 업로드 레퍼런스 셋이 전부 드롭존
        // 안에 solid "파일 추가" 버튼을 둔다 — 파일을 올리기 전 이 화면엔 그게
        // 유일한 브랜드색 면이다. 아이콘은 회색으로 물러난다(한 상자에 파란 게 둘이면
        // 어느 쪽을 누르라는 건지 흐려진다). 버튼도 상자와 같은 openFile 을 쏜다.
        '<span style="display:block;width:40px;height:40px;margin:0 auto 12px;font-size:40px;line-height:1;color:var(--text-3);">' + ICONS.upload + '</span>' +
        '<div style="font-size:14px;font-weight:500;color:var(--text);">파일을 여기에 끌어다 놓으세요</div>' +
        // 받는 형식은 accept 가 정한다 — 안내 문구가 따로 놀면 한쪽만 고쳐진다.
        '<div style="font-size:13px;color:var(--text-3);margin-top:6px;">지원 형식: ' +
          esc(accept.split(",").join(", ")) + ' (최대 30MB)</div>' +
        '<button type="button" class="btn btn-primary" data-act="openFile" data-arg="' + opts.slot + '" style="margin-top:16px;">파일 선택</button>' +
      '</div>';
    }
    return '<div class="dropzone' + (f ? '' : ' drop-hover') + '" data-drop="' + opts.slot + '"' + navAttr +
      // 점선은 전용 토큰(--line-dashed). --line-2 는 표·행을 가르는 경계선이라
      // 흰 배경에서 거의 안 보였고, 같은 앱의 폴더 검토·체크리스트 드롭존은
      // 처음부터 --line-dashed 를 써서 여기만 점선이 없는 것처럼 보였다.
      ' style="min-width:0;height:100%;box-sizing:border-box;display:flex;flex-direction:column;justify-content:center;overflow:hidden;border:1px dashed ' + (f ? "transparent" : "var(--line-dashed)") + ';border-radius:var(--r-lg);background:' + (f ? "var(--panel)" : "var(--bg)") + ';transition:border-color .2s var(--ease-out),background .2s var(--ease-out),color .2s var(--ease-out),box-shadow .2s var(--ease-out),opacity .2s var(--ease-out),transform .2s var(--ease-out);' + (f ? "padding:20px;border:1px solid var(--line);" : "") + '" ' +
      // hover 채움은 --state-hover-brand. 중립 hover 면은 목록·메뉴용이라 이곳에
      // 쓰면 테두리만 신호를 지고 배경 반응은 약해진다. 점선 카드는 어느 표면에
      // 놓이든(흰 패널 위든 회색 페이지 위든)
      // 같은 값으로 읽히도록 검토 기준 카드와 맞춘다.
      //
      // hover 는 .drop-hover 가 진다(빈 상태에만 클래스를 단다 — 파일이 붙은
      // 상태는 카드지 드롭 대상이 아니다). 바탕이 인라인이라 클래스 쪽이
      // !important 로 이긴다(index.html 주석).
      '>' +
      input + body + '</div>';
  }

  // ---- templates ----------------------------------------------------------
  // 결과 목록에 막 들어왔을 때만 카드가 순차적으로 올라온다 (필터/선택 렌더에는 안 붙는다).
  // 파일이 붙어 시작 버튼이 열리는 연출. 진입 창이 지나면 아무것도 안 준다 —
  // 그래야 그 뒤의 재렌더(프로필 메뉴·검색 등)에서 버튼이 다시 안 튄다.
  function readyAnim(v) {
    if (!v.anim.readyEntered) return "";
    return "animation:fadeUp var(--dur-2) var(--ease-out) backwards;animation-delay:-" +
           v.anim.readyElapsed + "ms;";
  }

  function enterAnim(v, i) {
    if (!v.anim.listEntered) return "";
    var delay = Math.min(i * 30, 300) - v.anim.enterElapsed;
    return "animation:listIn var(--dur-3) var(--ease-out) backwards;animation-delay:" + delay + "ms;";
  }
  // 탭·선택 상세는 내용만 짧게 교체한다. 첫 페이지 진입과 데이터 갱신에는
  // 겹쳐 재생하지 않고, 도중에 DOM을 다시 만들어도 같은 시점부터 이어 간다.
  var contentMotions = {};
  function contentAnim(slot, key) {
    var now = Date.now(), last = contentMotions[slot];
    if (!last || last.page !== prev.visit) {
      last = contentMotions[slot] = { page: prev.visit, key: key, at: null };
    } else if (last.key !== key) {
      last.key = key; last.at = now;
    }
    var elapsed = last.at === null ? 150 : now - last.at;
    return elapsed < 150
      ? "animation:contentIn var(--dur-1) var(--ease-out) backwards;animation-delay:-" + elapsed + "ms;" : "";
  }
  function popoverAnim(openedAt) {
    var elapsed = openedAt == null ? 150 : Date.now() - openedAt;
    return elapsed < 150
      ? "animation:popoverIn var(--dur-1) var(--ease-out) backwards;animation-delay:-" + elapsed + "ms;" : "";
  }
  // 상세 영역. 방금 펼친 카드만 높이 전환을 재생한다.
  function expand(justOpened, inner) {
    return '<div class="expand"' + (justOpened ? ' style="animation:expandIn var(--dur-2) var(--ease-out);"' : "") +
      '><div>' + inner + '</div></div>';
  }

  // justDone 은 이 렌더에서 **방금** 완료로 넘어간 단계에만 선다(renderVals 의
  // doneStage/cdoneStage — 다음 렌더에는 -1 이라 체크 그리기가 반복되지 않는다).
  function timelineItem(s) {
    var stateClass = s.done ? " is-done" : (s.active ? " is-active" : " is-wait");
    return '<div class="progress-stage-row' + stateClass + (s.justDone ? " is-settling" : "") + '">' +
        '<span class="progress-stage-marker' + (s.justDone ? " is-fresh" : "") +
          '" aria-hidden="true">' + (s.done ? ICONS.check : '') + '</span>' +
        '<div class="progress-stage-copy' + (s.justOpened ? " is-opening" : "") + '">' +
          '<div class="progress-stage-title">' + esc(s.label) + '</div>' +
          (s.desc ? '<div class="progress-stage-desc">' + esc(s.desc) + '</div>' : '') +
          (s.detail ? '<div class="progress-stage-detail mono">' + esc(s.detail) + '</div>' : '') +
        '</div>' +
        '<span class="progress-stage-status">' + esc(s.statusLabel) + '</span>' +
      '</div>';
  }

  function sidebar(v) {
    var items = v.features.map(function (f) {
      return '<button type="button" class="nav' + (f.on ? " on" : "") + '"' +
        (f.on ? ' aria-current="page"' : '') + ' data-act="setMode" data-arg="' + f.k + '">' +
        '<span style="width:18px;text-align:center;font-size:14px;">' + f.icon + '</span>' +
        '<span>' + esc(f.label) + '</span></button>';
    }).join("");
    // 브랜드 머리와 오른쪽 전역 헤더는 60px 한 줄로 정확히 잇는다. 별도의 선은
    // 두 경계를 겹쳐 보이게 하므로, 오른쪽은 app-sidebar의 옅은 음영으로만 나눈다.
    return '<aside class="app-sidebar" style="width:216px;flex:none;background:var(--panel);display:flex;flex-direction:column;">' +
      // 로고 클릭 = 홈. 거의 모든 서비스의 불문율인데 여기만 장식이었다
      // (2026-09-01). 화면마다 홈 버튼을 다는 대신 이 관례 하나로 채운다.
      '<div class="sidebar-brand" data-act="setMode" data-arg="home" role="button" tabindex="0" title="홈으로">' +
        // 마크 30 → 34. 워드마크를 키우자 글자 덩어리가 두 줄 합쳐 36.8px 이 되어
        // 마크가 혼자 작아 보였다. 34 면 덩어리 높이와 맞아 셋이 한 묶음으로 읽힌다.
        // (로그인 계열의 32px 마크는 그대로 둔다 — 거기는 22px 제목 한 줄이라 비율이 다르다.)
        '<div style="width:34px;height:34px;flex:none;display:flex;align-items:center;justify-content:center;color:var(--accent-ink);">' + ICONS.logoMark + '</div>' +
        // 워드마크 15 → 18. 15/11 은 네 단 차이뿐이라 제품 이름과 부제가 거의
        // 같은 무게로 붙어 있었다. 18 은 크기 사다리의 바로 다음 칸이다(15 다음이
        // 18 · 16·17 은 없다 — index.html 서체 주석).
        // 부제는 11 에 둔다. 더 줄여 달라는 요구였지만 11 이 사다리의 바닥이고,
        // --text-3 로 이미 5.38:1 이라 여기서 더 내리면 대비가 기준에 걸린다.
        // 위계는 부제를 깎아서가 아니라 이름을 키워서 벌린다(차이 4 → 7).
        '<div style="line-height:1.2;min-width:0;">' +
          '<div class="brand-wordmark" style="font-size:18px;">Doc<span style="color:var(--accent-ink);">Suree</span></div>' +
          '<div style="margin-top:2px;font-size:12px;font-weight:500;color:var(--text-3);">문서 검토 서비스</div>' +
        '</div>' +
      '</div>' +
      '<div style="padding:12px;display:flex;flex-direction:column;gap:2px;">' + items + '</div>' +
      // 팀이 있을 때만 바닥 구획을 낸다 — 없는데 구분선만 남기면 빈 칸이 뜬다.
      (teamLabel(state.user && state.user.team) ?
        // margin-top:auto 를 구분선이 지므로 아래 구획 전체가 바닥에 붙는다.
        '<div style="margin-top:auto;height:1px;margin-left:16px;margin-right:16px;flex:none;background:var(--line);"></div>' +
        '<div style="padding:16px 20px;display:flex;flex-direction:column;gap:12px;">' +
          '<div style="margin-left:-4px;margin-right:-4px;padding:10px 12px;background:var(--bg);border:1px solid var(--line);border-radius:var(--r-md);display:flex;flex-direction:column;gap:4px;box-shadow:inset 0 2px 4px rgba(0,0,0,0.02);">' +
            '<div style="font-size:12px;font-weight:600;color:var(--text-3);display:flex;align-items:center;gap:4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>소속 팀</div>' +
            '<div style="font-size:13px;font-weight:600;color:var(--text);">' + esc(teamLabel(state.user.team)) + '</div>' +
          '</div>' +
        '</div>'
      : '') +
    '</aside>';
  }

  // ---- 검색 --------------------------------------------------------------
  // 뒤지는 것은 **이미 받아 둔 목록** 둘뿐이다: 검토 기록(제목)과 등록된
  // 체크리스트(이름). 서버에 새로 물을 것이 없어서 색인도 엔드포인트도 없다.
  //
  // 공백을 다 지우고 맞춘다. 한글은 "사업 계획서"와 "사업계획서"가 같은 말인데
  // 띄어쓰기만 다른 경우가 흔해서, 공백을 남기면 사람이 친 대로만 걸린다.
  function searchNorm(s) {
    return String(s == null ? "" : s).replace(/\s+/g, "").toLowerCase();
  }

  // 한 줄. 왼쪽 아이콘 · 제목 · 그 아래 부연, 오른쪽 꼬리표.
  function searchRow(act, arg, iconHtml, title, sub, tail) {
    return '<div class="pick" data-act="' + act + '" data-arg="' + esc(arg) + '" ' +
      'style="padding:12px 16px;background:var(--panel);border:1px solid var(--line);' +
      'border-radius:var(--r-sm);display:flex;align-items:center;gap:12px;cursor:pointer;">' +
      '<span style="flex:none;display:flex;color:var(--text-2);">' + iconHtml + '</span>' +
      '<span style="flex:1;min-width:0;">' +
        '<span style="display:block;font-size:13px;font-weight:600;color:var(--text);' +
          'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(title) + '</span>' +
        (sub ? '<span style="display:block;font-size:12px;color:var(--text-3);' +
               'margin-top:2px;">' + esc(sub) + '</span>' : "") +
      '</span>' +
      (tail || "") +
    '</div>';
  }

  function searchGroup(label, rows, hidden) {
    if (!rows.length) return "";
    return '<div style="margin-bottom:18px;">' +
      '<div class="eyebrow" style="color:var(--text-3);margin-bottom:8px;">' + esc(label) + '</div>' +
      '<div style="display:flex;flex-direction:column;gap:6px;">' + rows.join("") + '</div>' +
      // **자른 건수를 드러낸다.** 조용히 8건만 보이면 "그게 전부"로 읽힌다.
      (hidden > 0
        ? '<div style="margin-top:8px;font-size:12px;color:var(--text-3);">' +
          '맞는 것이 ' + hidden + '건 더 있습니다 — 더 적어서 좁혀 보세요.</div>'
        : "") +
    '</div>';
  }

  var SEARCH_MAX = 8;

  function searchResultsHtml() {
    var q = searchNorm(state.searchQ);
    var hist = state.history || [];
    var lists = (state.clib && state.clib.list) || [];

    var histIcon = ICONS.fileText, listIcon = ICONS.list;
    var histRow = function (h) {
      var result = historyResult(h);
      var tail = '<span style="flex:none;font-size:12px;font-weight:600;padding:4px 10px;' +
        'border-radius:999px;font-variant-numeric:tabular-nums;background:' +
        "var(--neutral-weak)" + ';color:' + result.tone + ';">' +
        historyResultContent(h) + '</span>';
      var kind = h.kind === "compare" ? "비교 검토"
               : h.kind === "case" ? "폴더 검토"
               : h.kind === "checklist" ? "기준 판정"
               : h.kind === "evaluation" ? "체크리스트 검토" : "단일 검토";
      return searchRow("openHistory", h.id, histIcon, h.title,
                       kind + " · " + ago(h.at), tail);
    };
    var listRow = function (c) {
      return searchRow("openChecklist", c.id, listIcon, c.name,
                       (c.item_count || 0) + "개 항목", "");
    };

    // 아직 안 친 상태. 빈 화면을 두느니 최근 것을 낸다 — 진짜 이력이라 지어낸
    // "최근 검색 항목"과 다르다(우리는 검색어를 저장하지 않는다).
    if (!q) {
      if (state.history === null) {
        return '<div style="padding:36px 0;text-align:center;font-size:13px;' +
          'color:var(--text-3);">검토 기록을 불러오는 중…</div>';
      }
      if (!hist.length && !lists.length) {
        return '<div style="padding:36px 0;text-align:center;font-size:13px;' +
          'color:var(--text-3);">아직 검토한 문서도 등록된 추가 기준도 없습니다.</div>';
      }
      return searchGroup("최근 검토", hist.slice(0, 5).map(histRow), 0);
    }

    var mh = hist.filter(function (h) { return searchNorm(h.title).indexOf(q) >= 0; });
    var ml = lists.filter(function (c) { return searchNorm(c.name).indexOf(q) >= 0; });

    if (!mh.length && !ml.length) {
      return '<div style="padding:36px 0;text-align:center;">' +
        '<div style="font-size:14px;font-weight:500;color:var(--text-2);">맞는 것이 없습니다</div>' +
        '<div style="margin-top:6px;font-size:12px;color:var(--text-3);line-height:1.6;">' +
          '검토 기록 ' + hist.length + '건과 추가 기준 ' + lists.length + '건의 ' +
          '이름을 찾았습니다.</div></div>';
    }
    return searchGroup("검토 기록", mh.slice(0, SEARCH_MAX).map(histRow),
                       mh.length - SEARCH_MAX) +
           searchGroup("추가 기준", ml.slice(0, SEARCH_MAX).map(listRow),
                       ml.length - SEARCH_MAX);
  }

  // 검색 모달은 앱 본문 **밖**(#search-layer)에 산다. 예전엔 헤더 HTML 에 섞여
  // 있어서, 돋보기를 누르면 열려고 화면 전체를 innerHTML 로 다시 그렸다 —
  // 홈의 애니메이션이 0프레임부터 다시 돌고 PDF 뷰어가 깜빡여서 새로고침처럼
  // 보였다. 겹쳐 뜨는 것을 열자고 밑을 다시 그릴 이유가 없다.
  function searchModalHtml() {
    if (!state.searchOpen) return "";
    return '<div style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.28);backdrop-filter:blur(16px);z-index:999;display:flex;align-items:flex-start;justify-content:center;padding-top:12vh;" onclick="if(event.target===this) document.getElementById(\'searchCloseBtn\').click();">' +
      '<div data-sheet="search" data-sheet-close="toggleSearch" data-sheet-dim="0.28" data-sheet-blur="16" style="width:600px;max-width:92vw;background:var(--panel);border-radius:var(--r-lg);box-shadow:var(--sh-3);overflow:hidden;will-change:transform;">' +
        // 손잡이만 잡힌다 — 아래 입력칸까지 grip 에 넣으면 글자를 못 고른다.
        sheetGrip() +
        '<div style="padding:10px 24px 16px;border-bottom:1px solid var(--line-2);display:flex;align-items:center;gap:12px;">' +
          '<span style="font-size:20px;color:var(--text-2);">' + ICONS.search + '</span>' +
          // data-search-q 가 app.js 의 input 리스너와 짝이다. 그쪽은 render()를
          // 부르지 않고 결과 목록만 갈아끼운다 — 여기서 다시 그리면 입력 중
          // 포커스와 한글 조합이 날아간다(data-reason 입력과 같은 수법).
          '<input type="text" data-search-q autocomplete="off" ' +
            'placeholder="검토한 문서 이름 · 추가 기준 이름" ' +
            'value="' + esc(state.searchQ || "") + '" ' +
            'style="flex:1;border:none;outline:none;font-size:15px;color:var(--text);font-family:inherit;background:transparent;" autofocus>' +
          '<button type="button" id="searchCloseBtn" class="icon-btn" data-act="toggleSearch" aria-label="검색 닫기" style="color:var(--text-3);">' + ICONS.x + '</button>' +
        '</div>' +
        '<div id="searchResults" data-scroll="search" style="padding:20px 24px;background:var(--bg);min-height:200px;max-height:52vh;overflow-y:auto;">' +
          searchResultsHtml() +
        '</div>' +
        // **무엇을 안 뒤지는지도 말한다.** 문서 본문은 안 뒤진다 — 원본은 서버에
        // 있고 전문 검색 색인이 없다. 안 밝히면 "본문에 있는 말인데 안 나온다"를
        // 검색 고장으로 읽는다.
        '<div style="padding:10px 24px;border-top:1px solid var(--line-2);font-size:12px;' +
          'color:var(--text-3);line-height:1.6;">' +
          '검토 기록과 추가 기준의 <b style="font-weight:700;">이름</b>을 찾습니다. ' +
          '문서 본문은 찾지 않습니다.</div>' +
      '</div>' +
    '</div>';
  }


  function header(v) {
    var leftContent = "";
    if (v.hasSteps) {
      leftContent = '<nav style="display:flex;gap:20px;align-items:center;">' + v.steps.map(function (s) {
        return '<span class="tab' + (s.on ? " on" : "") + '" data-act="' + s.act + '" data-arg="' + s.k + '" tabindex="0" role="button">' + esc(s.label) + '</span>';
      }).join("") + '</nav>';
    } else {
      // 날짜·아이콘의 회색은 토큰이어야 한다. #6B7280 을 박아 두면 다크에서
      // 어두운 헤더 위에 어두운 회색이 남아 안 읽힌다(--text-2 는 테마마다 뒤집힌다).
      leftContent = '<div style="color:var(--text-2);font-size:14px;font-weight:500;display:flex;align-items:center;gap:8px;">' + ICONS.calendar + ' ' + new Date().toLocaleDateString('ko-KR', {year:'numeric', month:'long', day:'numeric', weekday:'long'}) + '</div>';
    }
    var uName = state.user ? state.user.name : "홍길동";
    var uEmail = state.user ? state.user.email : "user@surereview.ai";
    var dropMenu = "";
    if (state.profileMenuOpen) {
      // 소속 팀이 곧 검사 기준이다 — 로그인할 때 이 팀의 기준을 걸어놓고 돈다
      // (app.js doLogin). 그런데 정작 "내가 어느 팀으로 로그인해 있는지"를
      // 확인할 자리가 어디에도 없었다. 팀이 비어 있으면 팀 기준 수십 건이
      // 조용히 빠지므로, 비었다는 사실도 눈에 띄어야 한다.
      var uTeam = teamLabel(state.user && state.user.team);
      var teamRow = '<div style="padding:12px 16px;border-bottom:1px solid var(--line-2);display:flex;align-items:center;gap:8px;">' +
        '<span style="font-size:12px;color:var(--text-3);flex:none;">소속 팀</span>' +
        (uTeam
          ? '<span style="margin-left:auto;min-width:0;font-size:12px;font-weight:600;color:var(--accent-ink);background:var(--accent-weak);padding:4px 10px;border-radius:999px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(uTeam) + '</span>'
          // 칩을 안 씌운다 — 값이 있는 것처럼 보이면 안 된다.
          : '<span style="margin-left:auto;font-size:12px;color:var(--text-3);">미지정 · 팀 기준이 안 걸립니다</span>') +
      '</div>';
      // 등급은 **관리자일 때만** 적는다. 일반 계정에 "일반"이라 적어두면 없는
      // 위계를 화면이 만들어 낸다 — 이 도구에서 등급은 계정 관리 하나를 가른다.
      // 화면 표시는 신호일 뿐이고 판정은 서버가 한다(/api/admin/* 403).
      var roleRow = (state.user && state.user.role === "admin")
        ? '<div style="padding:12px 16px;border-bottom:1px solid var(--line-2);display:flex;align-items:center;gap:8px;">' +
            '<span style="font-size:12px;color:var(--text-3);flex:none;">권한</span>' +
            '<span style="margin-left:auto;font-size:12px;font-weight:600;color:var(--accent-ink);' +
              'background:var(--accent-weak);padding:4px 10px;border-radius:999px;">관리자</span>' +
          '</div>'
        : '';
      dropMenu = '<div id="profileMenu" style="position:absolute;top:60px;right:48px;width:240px;background:var(--panel);border:1px solid var(--line);border-radius:var(--r-md);box-shadow:var(--sh-3);z-index:100;transform-origin:top right;overflow:hidden;' + popoverAnim(state.profileOpenedAt) + '">' +
        '<div style="padding:16px;border-bottom:1px solid var(--line-2);display:flex;align-items:center;gap:12px;">' +
          '<div class="profile-menu-avatar">' + esc(uName.charAt(0)) + '</div>' +
          '<div style="min-width:0;flex:1;">' +
            '<div style="font-size:14px;font-weight:700;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(uName) + '</div>' +
            '<div style="font-size:12px;color:var(--text-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(uEmail) + '</div>' +
          '</div>' +
        '</div>' +
        teamRow + roleRow +
        '<div style="padding:8px;">' +
          // "요금제 관리 / Pro Plan" 은 뺐다 — 사내망 도구라 요금제가 없다.
          // 있지도 않은 것을 흉내내면 나머지 항목까지 목업으로 읽힌다.
          '<div class="menu-item" data-act="openProfileSettings">내 프로필 설정</div>' +
          (state.user && state.user.role === "admin"
            ? '<div class="menu-item" data-act="goAccounts">계정 관리</div>'
            : '') +
          // 도움말 = 가운데 문서 모달. 하던 화면은 뒤에 흐리게 남는다.
          '<div class="menu-item" data-act="openHelp">도움말</div>' +
        '</div>' +
        '<div style="padding:8px;border-top:1px solid var(--line-2);">' +
          // setMode("login") 이 아니다 — 그건 화면만 바꾸고 앞사람의 검토 상태를 그대로 둔다.
          '<div class="menu-item pick-danger" data-act="doLogout" style="display:flex;align-items:center;gap:8px;">' + ICONS.logout + ' 로그아웃</div>' +
        '</div>' +
      '</div>';
    }

    // 알림. **이 세션에서 앱이 직접 본 사건만** 담는다(api.js 의 notify).
    //
    // 예전에는 여기 목업 둘("결제 모듈 명세서의 정밀 검토가 완료되었습니다" ·
    // "김개발님이 보안 심의 요청서를 공유했습니다")이 박혀 있었고, 종에는 안 읽은
    // 알림이 있다는 빨간 점이 늘 떠 있었다. 그건 지웠다.
    //
    // 대신 진짜 사건이 있다: 검사를 걸어놓고 다른 화면으로 옮겨도 스트림은 계속
    // 돌아서(setMode 가 안 끊는다) **끝나도 그 화면에 없으면 조용히 끝난다.**
    // 그때만 쌓인다 — 진행 화면을 지켜본 사람에게는 안 쌓는다.
    //
    // 서버 알림함이 아니라는 것을 화면이 말해야 한다. 새로고침하면 비워지는데
    // 그걸 안 밝히면 "알림이 사라졌다"가 고장으로 읽힌다.
    // 알림 = 서버가 가진 검토 작업(state.jobs ← GET /api/jobs). 진행 중인 것과
    // 최근에 끝난 것이 함께 온다. 예전에는 브라우저 메모리라 새로고침하면
    // 비워졌고, 화면이 그 사실을 변명해야 했다 — 이제 검토가 서버의 일이라
    // (src/app/jobs.py) 창을 닫았다 열어도 그대로다.
    var jobs = state.jobs || [];
    var jobRunning = jobs.filter(function (j) { return j.status === "running"; }).length;
    var dropNoti = "";
    if (state.notiOpen) {
      // 열린 채로 다시 그려질 때(진행 이벤트·5초 폴링) 등장 연출이 되감겨 창이
      // 불규칙하게 깜빡였다(2026-09-04). screenIn 과 같은 수법 — 열린 뒤 흐른
      // 시간만큼 음수 지연을 주고, 연출 시간(--dur-1 150ms)이 지났으면 아예 안 건다.
      var notiElapsed = Date.now() - (state.notiOpenedAt || 0);
      var notiEnter = notiElapsed < 150
        ? 'animation:popoverIn var(--dur-1) var(--ease-out) forwards;animation-delay:-' + notiElapsed + 'ms;'
        : '';
      // 스피너도 같은 이유 — 매번 0도에서 다시 돌면 그릴 때마다 움찔한다.
      var spinPhase = 'style="animation-delay:-' + (Date.now() % 900) + 'ms;"';
      var JOB_TONE = {
        running: ["검토 중", "var(--accent-ink)"],
        done: ["검토 완료", "var(--band-good-fg)"],
        error: ["검토 실패", "var(--sev-crit-fg)"],
        // 사람이 멈춘 것은 실패가 아니다 — 붉게 칠하면 도구가 잘못한 것처럼 읽힌다.
        cancelled: ["검토 취소함", "var(--text-3)"]
      };
      var notiRows = jobs.length
        ? jobs.map(function (j) {
            // 멈추라고 한 검토는 더 이상 "검토 중"이 아니다 — 머리줄이 그렇게
            // 말하는데 아래에서 "멈추는 중"이라 하면 두 말이 어긋난다.
            var tone = j.cancelling && j.status === "running"
              ? ["멈추는 중", "var(--text-3)"]
              : (JOB_TONE[j.status] || JOB_TONE.done);
            // 끝났고 이력에 남았으면 누르면 결과가 열린다. 진행 중인 것과
            // 저장 못 한 것은 갈 데가 없어 누르는 시늉을 안 한다.
            // 진행 중은 진행 화면으로(openJob), 끝난 것은 결과로. 저장 못 한 것과
            // 실패·취소는 갈 데가 없어 누르는 시늉을 안 한다.
            var go = (j.status === "done" && j.history_id)
              ? ' data-act="openHistory" data-arg="' + esc(j.history_id) + '"'
              : (j.status === "running" ? ' data-act="openJob" data-arg="' + esc(j.id) + '"' : '');
            // 아래 한 줄이 상태마다 다른 말을 한다 — 진행 중이면 지금 단계,
            // 실패면 이유, 끝났는데 저장이 안 됐으면 그 사실.
            // 취소는 즉시가 아니다. 검사는 진행을 알릴 때 멈추므로 지금 하던
            // 한 조각(LLM 이면 한 번의 왕복)은 마치고 선다 — 그 사실을 적어야
            // 안 멈추는 것으로 안 읽힌다.
            var note = j.status === "running"
              ? (j.cancelling ? "지금 하던 것을 마치는 대로 멈춥니다"
                              : (j.stage ? esc(j.stage) : "시작하는 중"))
              : j.status === "error" ? esc(j.error || "알 수 없는 오류")
              : j.status === "cancelled" ? "결과를 남기지 않았습니다"
              : (j.history_id ? "" : "이력에 저장되지 않아 다시 열 수 없습니다");
            var when = j.status === "running" ? j.started_at : (j.finished_at || j.started_at);
            return '<div class="noti-row"' + go + ' style="padding:12px 16px;border-bottom:1px solid var(--line-2);' +
              (go ? 'cursor:pointer;' : '') + '">' +
              '<div style="display:flex;justify-content:space-between;gap:10px;margin-bottom:4px;">' +
                '<span style="display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:' + tone[1] + ';">' +
                  (j.status === "running"
                    ? '<span class="job-spin" aria-hidden="true" ' + spinPhase + '></span>' : '') +
                  tone[0] + '</span>' +
                '<span style="flex:none;font-size:12px;color:var(--text-3);">' +
                  esc(ago(new Date((when || 0) * 1000).toISOString())) + '</span>' +
              '</div>' +
              '<div style="font-size:13px;color:var(--text);line-height:1.4;overflow:hidden;' +
                'text-overflow:ellipsis;white-space:nowrap;">' + esc(j.title) + '</div>' +
              // 아래 줄과 멈추기가 한 줄에 선다. 진행 화면으로 돌아가지 않아도
              // 멈출 수 있어야 한다 — 새로고침한 뒤에는 그 화면이 없고, 5분짜리
              // 검토를 세울 길이 알림밖에 없다.
              (note || j.status === "running"
                ? '<div style="display:flex;align-items:center;gap:10px;margin-top:4px;">' +
                    '<span style="flex:1;min-width:0;font-size:12px;color:var(--text-3);' +
                      'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + note + '</span>' +
                    (j.status === "running" && !j.cancelling
                      ? '<button type="button" class="btn btn-sm btn-ghost btn-danger-ghost" ' +
                          'data-act="cancelJobById" data-arg="' + esc(j.id) + '" ' +
                          // 알림은 320px 팝오버다. .btn-sm(34px·14px)은 옆의 12px
                          // 안내줄보다 커서 한 줄을 혼자 밀어냈다 — 줄 눈금에 맞춘다.
                          'style="flex:none;min-height:26px;padding:2px 8px;font-size:12px;">멈추기</button>'
                      : '') +
                  '</div>'
                : '') +
            '</div>';
          }).join("")
        : '<div style="padding:28px 16px;text-align:center;font-size:13px;color:var(--text-3);">' +
          '아직 알릴 일이 없습니다.</div>';
      dropNoti = '<div id="notiMenu" style="position:absolute;top:52px;right:92px;width:320px;background:var(--panel);border:1px solid var(--line);border-radius:var(--r-md);box-shadow:var(--sh-3);z-index:100;transform-origin:top right;' + notiEnter + 'overflow:hidden;">' +
        '<div style="padding:14px 16px;border-bottom:1px solid var(--line-2);display:flex;justify-content:space-between;align-items:center;">' +
          '<div style="font-size:13px;font-weight:600;color:var(--text);">알림' +
            (jobRunning ? '<span style="margin-left:6px;font-weight:500;color:var(--text-3);">' +
                          jobRunning + '건 진행 중</span>' : '') + '</div>' +
          '<div data-act="toggleNoti" class="hover-accent" style="color:var(--text-3);cursor:pointer;display:flex;font-size:15px;">' + ICONS.x + '</div>' +
        '</div>' +
        '<div data-scroll="notiList" style="max-height:300px;overflow-y:auto;">' + notiRows + '</div>' +
        '<div style="padding:10px 16px;border-top:1px solid var(--line-2);font-size:12px;' +
          'line-height:1.6;color:var(--text-3);">' +
          '검토는 서버에서 돕니다. 다른 화면을 보거나 창을 닫아도 계속되고, ' +
          '끝나면 여기에 남습니다.</div>' +
      '</div>';
    }



    var profileSettingsModal = "";
    if (state.profileSettingsOpen) {
      var sEmail = state.user ? state.user.email : "";
      var sName = state.user ? state.user.name : "";
      
      profileSettingsModal = '<div style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.28);backdrop-filter:blur(12px);z-index:999;display:flex;align-items:center;justify-content:center;" onclick="if(event.target===this) document.getElementById(\'closeProfileBtn\').click();">' +
        '<div data-sheet="profile" data-sheet-close="closeProfileSettings" data-sheet-dim="0.28" data-sheet-blur="12" ' +
          'style="width:400px;background:var(--panel);border-radius:var(--r-lg);box-shadow:var(--sh-3);padding:0 24px 24px;will-change:transform;">' +
          sheetGrip('<div class="headline" style="font-size:18px;margin:12px 0 20px;">내 프로필 설정</div>') +
          '<div style="margin-bottom:16px;">' +
            '<div style="font-size:12px;color:var(--text-3);margin-bottom:6px;">이메일 (변경 불가)</div>' +
            '<input type="text" value="' + esc(sEmail) + '" disabled style="width:100%;padding:10px;border:1px solid var(--line);border-radius:var(--r-sm);background:var(--bg);color:var(--text-3);font-size:14px;box-sizing:border-box;">' +
          '</div>' +
          '<div style="margin-bottom:16px;">' +
            '<div style="font-size:12px;color:var(--text-3);margin-bottom:6px;">이름</div>' +
            '<input id="psName" type="text" value="' + esc(sName) + '" style="width:100%;padding:10px;border:1px solid var(--line);border-radius:var(--r-sm);background:var(--panel);color:var(--text);font-size:14px;box-sizing:border-box;">' +
          '</div>' +
          '<div style="display:flex;gap:12px;margin-bottom:24px;">' +
            '<div style="flex:1;">' +
              '<div style="font-size:12px;color:var(--text-3);margin-bottom:6px;">부서</div>' +
              selectField("psDept", "소속 부서", DEPTS) +
            '</div>' +
            '<div style="flex:1;" id="psTeamWrapper">' +
              '<div style="font-size:12px;color:var(--text-3);margin-bottom:6px;">팀 (검사 기준)</div>' +
              selectField("psTeam", "소속 팀", teamOptions()) +
            '</div>' +
          '</div>' +
          '<div style="display:flex;gap:10px;justify-content:flex-end;">' +
            '<button id="closeProfileBtn" class="btn" style="padding:10px 16px;border-radius:var(--r-sm);background:var(--bg);color:var(--text-2);font-weight:600;border:none;cursor:pointer;" data-act="closeProfileSettings">취소</button>' +
            '<button class="btn" style="padding:10px 16px;border-radius:var(--r-sm);background:var(--accent-surface);color:#fff;font-weight:600;border:none;cursor:pointer;" data-act="saveProfileSettings">저장</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    }

    // 전역 뒤로가기 버튼은 뺐다(2026-08-31, 사용자 결정) — 데스크톱 사이드바형
    // 앱의 관례가 아니고, 목적지를 이름으로 말하는 화면별 백링크("목록으로
    // 돌아가기")와 브라우저 뒤로가기(app.js popstate)가 그 역할을 다 진다.
    return '<header class="app-header">' +
      leftContent +
      '<div style="display:flex;align-items:center;gap:18px;position:relative;">' +
        '<button type="button" class="icon-btn' + (state.searchOpen ? ' on' : '') + '" data-act="toggleSearch" aria-label="검색">' + ICONS.search + '</button>' +
        '<button type="button" class="icon-btn' + (state.notiOpen ? ' on' : '') + '" data-act="toggleNoti" aria-label="알림" style="position:relative;">' +
          ICONS.bell +
          // 점은 **안 읽은 것이 있을 때만.** 늘 떠 있으면 아무 뜻도 없다.
          // 점은 **안 읽은 것이 있을 때만.** 진행 중인 검토도 안 읽은 것으로 친다 —
          // 걸어두고 다른 화면을 보는 사람에게 "지금 돌고 있다"는 알릴 값이 있다.
          (jobs.some(function (j) { return !j.seen || j.status === "running"; })
            ? '<span style="position:absolute;top:0;right:2px;width:6px;height:6px;border-radius:50%;background:var(--sev-crit-fg);border:1px solid var(--bg);"></span>'
            : '') +
        '</button>' +
        '<div style="width:1px;height:24px;background:var(--line);"></div>' +
        // hover와 열린 상태는 index.html의 중립 클릭 면 계약이 함께 맡는다.
        // 인라인 이벤트로 색을 칠하면 사이드바·최근 검토와 규칙이 다시 갈라진다.
        '<div class="header-profile' + (state.profileMenuOpen ? ' on' : '') + '" data-act="toggleProfile">' +
          '<div class="header-avatar">' + esc(uName.charAt(0)) + '</div>' +
          '<span style="font-size:13px;font-weight:600;color:var(--text);user-select:none;">' + esc(uName) + '님 ▾</span>' +
        '</div>' +
      '</div>' +
      dropMenu + dropNoti + profileSettingsModal + helpSheetHtml() +
    '</header>';
  }


  // 업로드 화면 하단의 "이 유형의 최근 검토". 줌아웃 뒤 남던 세로 공백을
  // 카드 늘리기로 채웠더니 과했다(2026-09-01 피드백) — 장식 대신 쓸모로
  // 채운다: 같은 유형의 지난 결과 세 건, 누르면 그 결과로 간다. 기록이
  // 없으면 아예 안 낸다(빈 껍데기는 공백보다 나쁘다).
  function recentSection(kind, label) {
    var hist = state.history;
    var body;
    var shownCount = null;
    if (hist === null) {
      var sk = '<div class="record-row record-recent-grid" aria-hidden="true">' +
        '<div style="display:flex;align-items:center;gap:10px;">' +
          '<span class="skel" style="width:30px;height:30px;border-radius:var(--r-sm);flex:none;"></span>' +
          '<span class="skel" style="width:46%;height:13px;"></span></div>' +
        '<span class="skel" style="width:88px;height:14px;"></span>' +
        '<span class="skel" style="width:64px;height:14px;"></span>' +
        '<span class="skel" style="width:48px;height:26px;"></span>' +
      '</div>';
      body = sk + sk;
    } else {
      var list = (hist || []).filter(function (h) { return h.kind === kind; }).slice(0, 3);
      if (!list.length) return "";
      shownCount = list.length;
      body = list.map(function (h) {
        var result = historyResult(h);
        var dot = result.tone;
        return '<div class="record-row record-recent-grid" data-act="openHistory" data-arg="' + esc(h.id) + '" ' +
            'tabindex="0" role="button">' +
          '<div class="record-primary">' + recordShapeIcon(kind, h.title, 30) +
            '<span><strong>' + esc(h.title) + '</strong>' + recordBy(h) + '</span></div>' +
          '<span class="record-result"><i style="background:' + dot + ';"></i>' +
            historyResultContent(h) + '</span>' +
          '<span class="record-muted" title="' + esc(h.at || "") + '">' + esc(ago(h.at)) + '</span>' +
          '<span class="record-actions"><button type="button" class="btn btn-sm btn-ghost btn-ghost-accent"' +
            ' data-act="openHistory" data-arg="' + esc(h.id) + '">열기</button></span>' +
        '</div>';
      }).join("");
    }
    return '<div class="surface-list record-surface setup-recent-records">' +
      '<div class="record-toolbar"><div class="record-view-name">최근 ' + esc(label) +
        (shownCount == null ? '' : ' <b>' + shownCount + '</b>') + '</div>' +
        // solid — 사용자 결정(2026-09-04). 옅은 이동 버튼으로 두자고 했으나 "홈처럼
        // 포인트로 solid 하나"가 목록 쪽에도 있어야 한다는 쪽을 택했다.
        '<button type="button" class="btn btn-sm btn-primary" data-act="setMode" data-arg="history">전체 기록</button>' +
      '</div>' +
      '<div class="record-head record-recent-grid" aria-hidden="true">' +
        '<span>문서</span><span>결과</span><span>검토 일시</span><span>작업</span>' +
      '</div>' + body + '</div>';
  }

  function singleUpload(v) {
    // 자동 검토 기준(YAML: id_pattern·required_sections) picker 는 여기 없다 —
    // 어느 팀 기준을 쓸지는 소속 팀(프로필)·자동 감지가 정한다. 단일 검토는
    // 이제 서버가 늘 돌리는 기본 검토(용어 일관성·미작성 TBD)와, 사용자가
    // 고르는 라이브러리 체크리스트("체크리스트로 평가") 두 갈래뿐이다.
    // 체크리스트를 평가 기준으로 고르는 카드. "안 씀"을 늘 첫 자리에 둬 고른
    // 적 없는 상태(reviewChecklistId === "")도 명시적으로 고를 수 있게 한다 —
    // 그래야 한 번 골랐다가 되돌리는 길이 생긴다.
    var reviewChips = [{ id: "", name: "안 씀", sel: v.reviewChecklistId === "", glyph: ICONS.x }]
      .concat(v.reviewChecklistCards).map(function (c) {
        var iconHtml = '<div style="width:24px;height:24px;border-radius:50%;background:' + (c.sel ? 'var(--accent)' : 'var(--bg)') + ';color:' + (c.sel ? '#fff' : 'var(--text-3)') + ';display:flex;align-items:center;justify-content:center;flex:none;">' + (c.glyph || ICONS.list) + '</div>';
        // hover 는 .chip-select 가 진다(비선택에만). 배경이 인라인이라 클래스가
        // 못 이기므로 선택 상태만 인라인으로 남긴다.
        return '<button class="chip-select' + (c.sel ? ' on' : '') + '" data-act="pickReviewChecklist" data-arg="' + esc(c.id) + '" style="padding:6px 14px 6px 6px;display:inline-flex;align-items:center;gap:8px;font-size:14px;' +
          'font-weight:600;border-radius:var(--r-md);cursor:pointer;border:1px solid ' +
          (c.sel ? "var(--accent)" : "var(--line)") + ';' +
          (c.sel ? 'background:var(--accent-weak);' : '') + 'color:var(--text);transition:border-color .2s var(--ease-out),background .2s var(--ease-out),color .2s var(--ease-out),box-shadow .2s var(--ease-out),opacity .2s var(--ease-out),transform .2s var(--ease-out);">' +
          iconHtml + esc(c.name) +
          (c.count ? ' <span style="color:var(--text-3);font-weight:500;">' + esc(c.count) + '</span>' : '') +
          '</button>';
      }).join("");
    // 라이브러리에 등록한 게 없으면 그 사실을 말한다 — 빈 목록만 보이면 왜 없는지 모른다.
    var reviewChecklistEmpty = (v.reviewChecklistCards.length === 0)
      ? '<div style="font-size:13px;color:var(--text-2);margin-top:8px;">등록된 추가 기준이 없습니다. ' +
        '<span class="link-accent" data-act="goPickChecklist" style="text-decoration:underline;">검토 기준</span>에서 직접 작성할 수 있습니다.</div>'
      : '';
    return '<div class="page-shell page-shell-primary" data-scroll="setup">' +
      '<div class="page-container page-stack">' +
        errorBanner(v.serror) +
        // 제목은 화면 이름, 밑줄이 지금 할 일 — pageHead 주석 참고.
        // pageHead 가 esc 를 진다 — 여기서 또 하면 팀 이름의 괄호·따옴표가 깨진다.
        pageHead("단일 문서 검토",
                 "검토할 문서를 올리세요. 공통 기준" +
                 (setupTeam() ? " + " + setupTeam() + " 기준" : "") +
                 "이 함께 걸립니다.") +
        '<div class="setup-panel">' +
          dropzone({ slot: "single", file: v.files.single, big: true }) +
          pipelineStrip("검토 단계", v.pipelinePreview) +
          // 체크리스트는 별도 대형 카드가 아니라 이 작업의 보조 설정이다. 업로드와
          // 같은 무게로 경쟁하지 않게 패널 아래 컨텍스트 행으로 붙인다.
          '<div class="setup-context">' +
            '<div class="setup-context-row">' +
              '<div>' +
                '<h3 class="setup-section-title">추가 검토 기준</h3>' +
                '<p class="setup-section-sub">기본 검토는 항상 적용됩니다.</p>' +
              '</div>' +
              '<div style="min-width:0;">' +
                '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">' + reviewChips + '</div>' +
                reviewChecklistEmpty +
              '</div>' +
              // 문서 종류(2026-09-15 품질팀: "돌리기 전에 형식을 추가"). 팀 기준은 파일명으로
              // 종류(SRS·RVVR…)를 가리는데, 작업본 이름은 규칙과 달라 못 가리는 일이 흔하고
              // 그러면 그 종류 전용 검사가 통째로 빠진다. 서버가 가린 결과를 보여 주고,
              // 못 가렸으면 검토자가 고른다. 종류 목록이 없는 팀은 이 줄이 없다.
              (v.outputPick && (v.outputPick.outputs || []).length
                ? '<div class="setup-context-row">' +
                    '<div>' +
                      '<h3 class="setup-section-title">문서 종류</h3>' +
                      '<p class="setup-section-sub">' +
                        (v.outputPick.detected
                          ? '파일명으로 보아 <b>' + esc(v.outputPick.detected) + '</b> 입니다. 다르면 고르세요.'
                          : '파일명으로는 종류를 알 수 없습니다. 골라 주면 그 종류의 검사까지 돕니다.') +
                      '</p>' +
                    '</div>' +
                    // 앱 공용 셀렉트(selectField) — 결과 화면의 정렬·검사 셀렉트와 같은 모양.
                    '<div style="min-width:0;max-width:280px;">' +
                      selectField("outputKey",
                        v.outputPick.detected ? '파일명대로 (' + v.outputPick.detected + ')' : '고르지 않음 — 종류별 검사 없이 진행',
                        v.outputPick.outputs.map(function (o) { return { id: o.key, name: o.key }; }),
                        { value: v.outputPick.key, ariaLabel: "문서 종류" }) +
                    '</div>' +
                  '</div>'
                : '') +
            '</div>' +
            // 파일을 올려야 버튼이 열린다 — 폴더 검토와 같은 관용구(2026-09-01
            // 합의: 빈 채로 누를 수 있는 버튼보다 단계가 열리는 쪽이 낫다).
            // 버튼은 기준·문서 종류 격자 **밖** 오른쪽 줄에 — 격자 안에 두면 첫 열에 떨어져
            // 왼쪽 아래에 붙었다(2026-09-17 지적; 비교·체크리스트 검토는 오른쪽 아래다).
            '<div style="display:flex;justify-content:flex-end;align-items:center;margin-top:18px;">' +
              (v.files.single
                ? '<button class="btn btn-lg btn-primary" data-act="startReview" style="white-space:nowrap;' + readyAnim(v) + '">검토 시작 ' + ICONS.arrowRight + '</button>'
                : '<span style="font-size:12px;color:var(--text-3);">문서를 올리면 검토를 시작할 수 있습니다</span>') +
            '</div>' +
          '</div>' +
        '</div>' +
        recentSection("review", "단일 검토") +
      '</div>' +
    '</div>';
  }

  function progressPctHtml(pct) {
    return pct == null
      ? ''
      : '<strong>' + Math.max(0, Math.min(100, pct)) + '%</strong><span>전체 진행</span>';
  }

  // 세 검토 방식이 공유하는 상태 머리말. 상단은 상태와 숫자 요약만 맡고 실제
  // 진행 바는 아래 단계에만 둔다. 전체·세부 바가 동시에 움직이면 어느 쪽을
  // 따라야 하는지 모호해지기 때문이다.
  // 이 세션의 검토가 서버에서 "멈추는 중"인가(알림 창에서 멈추기를 눌렀을 때).
  // 취소는 즉시가 아니다 — 검사가 다음 진행을 알릴 때 선다. 그동안 진행 화면이
  // 여전히 "검토 중"이라 하면 알림 창과 두 말이 어긋난다(2026-09-04).
  function jobStopping(which) {
    var id = state.jobId && state.jobId[which];
    if (!id) return false;
    return (state.jobs || []).some(function (j) {
      return j.id === id && j.status === "running" && j.cancelling;
    });
  }
  var CANCEL_WHICH = { cancelReview: "single", cancelCompare: "compare", cancelCase: "case",
                       cancelEvaluate: "evaluate" };

  function progressHead(done, count, running, pct, unreviewed, opts) {
    opts = opts || {};
    var which = CANCEL_WHICH[opts.cancelAction];
    // 멈춘 직후 한 박자(app.js stopThen): 머리말이 "멈췄습니다"를 말하고 나서 돌아간다.
    var stopped = !done && !!(which && state.stopped && state.stopped[which]);
    var stopping = !done && !stopped && jobStopping(which);
    if (stopped) running = ["검토를 멈췄습니다", "시작 화면으로 돌아갑니다"];
    else if (stopping) running = ["검토를 멈추고 있습니다", "지금 하던 것을 마치는 대로 멈춥니다"];
    var title = done ? "검토 완료" : running[0];
    var sub = done
      ? (count > 0
          ? '수정 사항 ' + count + '건' + (unreviewed ? ' · 미검토 ' + unreviewed + '건' : '')
          : (unreviewed ? '수정 사항 없음 · 일부 기준 미검토'
                        : '수정 사항 없음 · 모든 자동 검사 완료')) +
        ' · 결과는 검토 결과 탭에 있습니다'
      : running[1];
    var pctValue = done ? 100 : pct;
    var pctId = opts.pctId ? ' id="' + opts.pctId + '"' : '';
    var titleId = opts.titleId ? ' id="' + opts.titleId + '"' : '';
    var subId = opts.subId ? ' id="' + opts.subId + '"' : '';
    var elapsed = opts.elapsed
      ? '<div class="progress-summary-metric progress-elapsed"><strong' +
          (opts.elapsedId ? ' id="' + opts.elapsedId + '"' : '') + '>' + esc(opts.elapsed) +
          '</strong></div>'
      : '';
    var cancel = !done && opts.cancelAction
      ? (stopped ? ''
          : stopping
          ? '<span class="progress-stopping mono">멈추는 중…</span>'
          : '<button type="button" class="btn btn-sm btn-ghost btn-ghost-accent" data-act="' +
              opts.cancelAction + '">' + esc(opts.cancelLabel || "검토 취소") + '</button>')
      : '';
    var loadingClass = !done && !stopped && opts.animateState ? ' is-loading' : '';
    // Stage events may rebuild the DOM; keep the same rotation phase.
    var motionStyle = loadingClass && opts.motionStartedAt
      ? ' style="--progress-motion-delay:-' + (Math.max(0, Date.now() - opts.motionStartedAt) % 2800) + 'ms;"'
      : '';
    var documents = opts.documents
      ? '<dl class="progress-documents">' + opts.documents.map(function (doc) {
          return '<dt>' + esc(doc.label) + '</dt><dd>' + esc(doc.name) + '</dd>';
        }).join('') + '</dl>'
      : (opts.docName ? '<p class="progress-document' + (opts.docIcon ? ' progress-document-file' : '') + '">' +
          (opts.docIcon ? '<span class="progress-document-icon" aria-hidden="true">' + opts.docIcon + '</span>' : '') +
          '<span class="progress-document-name">' + esc(opts.docName) + '</span></p>' : '');
    return '<div class="progress-summary' + (done ? ' is-done' : '') + '">' +
        '<h2 class="headline progress-summary-title"' + titleId + '>' + esc(title) + '</h2>' +
        documents +
        '<div class="progress-summary-row">' +
          '<span class="progress-status-mark' + loadingClass +
            (done ? ' is-done review-complete-check' : (stopped ? ' is-stopped' : '')) +
            '" data-progress-state-icon="' + (done ? 'done' : (stopped ? 'stopped' : 'running')) + '" aria-hidden="true"' + motionStyle + '>' +
            (done ? ICONS.check : (stopped ? ICONS.x : ICONS.hourglass)) + '</span>' +
          '<div class="progress-summary-copy">' +
            '<p class="progress-summary-sub' + (done ? ' review-complete-copy' : '') + '"' + subId + '>' + esc(sub) + '</p>' +
          '</div>' +
        '</div>' +
          '<div class="progress-summary-side">' +
            '<div class="progress-summary-metric"' + pctId + '>' + progressPctHtml(pctValue) + '</div>' +
            elapsed + cancel +
          '</div>' +
      '</div>';
  }

  function progressFrame(opts) {
    return '<div class="page-shell page-shell-primary page-shell-progress" data-scroll="' + opts.scroll + '">' +
      '<div class="page-container progress-page-container"><div class="page-stack">' +
        '<div class="progress-workspace" data-progress-phase="' + (opts.phase || 'reviewing') +
          '" data-progress-run="' + esc(opts.runKey || '') + '">' + opts.head +
          '<div class="progress-grid">' +
            '<section class="progress-main">' +
              '<div class="progress-section-head"><h3 class="progress-section-title">검토 단계</h3>' +
                '<span class="progress-section-meta">실시간 자동 갱신</span></div>' +
              opts.main + (opts.footer || '') +
            '</section>' +
            '<details class="progress-settings-disclosure" data-progress-settings="' + opts.scroll + '"' +
              (state.progressSettings && state.progressSettings[opts.scroll] ? ' open' : '') +
              '><summary>이번 검토의 적용 기준과 설정</summary>' + opts.settings + '</details>' +
          '</div>' +
        '</div>' +
      '</div></div>' +
    '</div>' + (opts.after || '');
  }

  // 작업 레인. 카운터 하나가 실제 규칙 검사 또는 LLM 호출 하나다.
  // 레인의 순수 지표(폭·카운터). laneMosaic 와 app.js 부분 갱신이 함께 쓴다 —
  // step 마다 폭·카운터만 제자리로 고쳐 shimmer·width 트랜지션을 안 끊는다.
  function laneMetrics(lane) {
    var pct = lane.total > 0 ? (lane.doneCount / lane.total * 100) : 0;
    var counter = lane.status === "empty" ? "항목 없음"
      : (lane.status === "wait" ? (lane.doneCount ? lane.doneCount + "/" + lane.total + " · 대기" : "대기")
      : (lane.status === "done" ? "완료" : lane.doneCount + "/" + lane.total + " · 검사 중"));
    return { pct: pct, counter: counter, status: lane.status };
  }

  // 상태가 바뀐 레인만 갱신한다. fresh 는 "이 노드가 방금 상태 전환으로 다시
  // 그려졌다"는 뜻이다 — app.js 의 부분 갱신만 true 를 넘기고, 전체 렌더를 타는
  // laneMosaic 는 false 다. 등장 연출을 여기에만 거는 이유: 진행 화면은 폴링마다
  // 다시 그려지므로 노드 생성에 연출을 걸면 1회 연출이 상시 반복이 된다.
  function laneInner(lane, fresh) {
    var m = laneMetrics(lane);
    var freshMark = fresh ? " is-fresh" : "";
    var pct = m.pct, counter = m.counter;
    // data-lane-* 훅: app.js repaintProgress 가 이 안의 폭·카운터만 갈아끼운다.
    // 실제 수치만 scaleX로 반영한다. 완료 후에도 같은 파란 계열을 유지한다.
    var bar = '<div class="progress-stage-track"><i data-lane-fill class="review-lane-fill"' +
      ' style="transform:scaleX(' + (pct / 100) + ');background:' +
      (lane.status === "done" ? "var(--progress-complete)" :
        (lane.status === "run" ? "var(--accent)" : "var(--neutral)")) + ';"></i></div>';

    var scope = lane.scope
      ? '<span style="font-size:12px;color:' + (lane.limited ? "var(--sev-min-fg)" : "var(--text-3)") + ';">' +
        esc(lane.scope) + '</span>' : "";
    return '<span class="progress-stage-marker review-lane-check' + freshMark + '" aria-hidden="true">' +
        (lane.status === "done" ? ICONS.check : '') + '</span>' +
      '<div class="progress-stage-copy' +
          (fresh && lane.status === "run" ? " is-opening" : "") + '">' +
        '<div class="progress-stage-title">' + esc(lane.label) + '</div>' +
        (lane.description ? '<div class="progress-stage-desc">' + esc(lane.description) + '</div>' : '') +
        (scope ? '<div class="progress-stage-detail">' + scope + '</div>' : '') +
      '</div>' +
      '<span data-lane-counter class="progress-stage-status mono">' + esc(counter) + '</span>' +
      bar;
  }

  function laneMosaic(lane, i) {
    return '<div class="progress-stage-row" data-lane-idx="' + i + '" data-lane-status="' + lane.status + '">' +
      laneInner(lane, false) +
    '</div>';
  }

  // 진행 중에는 잣대를 바꿀 수 없다. 이 패널은 선택기가 아니라 이번 요청에
  // 고정된 설정의 영수증이다. 바꾸는 UI를 두면 이미 시작된 서버 작업까지
  // 바뀌는 것처럼 보이므로, 적용 층과 실행 방식만 읽기 전용으로 보여준다.
  function criteriaPanel(review) {
    var s = state.server;
    var c = review.criteria || { layers: [], counts: {}, total: 0 };
    var docName = ((window.DOCREVIEW || {}).doc || {}).name || "문서";
    var row = function (k, v) {
      return '<div style="display:flex;gap:10px;padding:10px 0;border-top:1px solid var(--line-2);">' +
        '<span style="font-size:12px;font-weight:600;color:var(--text-2);flex:none;width:74px;">' + esc(k) + '</span>' +
        '<span style="font-size:12px;color:var(--text-2);line-height:1.4;word-break:break-word;">' + esc(v) + '</span>' +
      '</div>';
    };
    var layers = (c.layers || []).map(function (L) {
      return '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;">' +
        '<span style="font-size:12px;font-weight:700;padding:4px 6px;border-radius:var(--r-xl);' +
          'background:var(--accent-weak);color:var(--accent-ink);">' + esc(scopeLabel(L.scope)) + '</span>' +
        '<span style="flex:1;min-width:0;font-size:12px;color:var(--text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(L.name) + '</span>' +
        '<span class="mono" style="font-size:12px;color:var(--text-3);">' + L.items.length + '개</span>' +
      '</div>';
    }).join("");
    var countLine = function (label, n) {
      return '<div style="display:flex;justify-content:space-between;gap:8px;padding:4px 0;font-size:12px;">' +
        '<span style="color:var(--text-3);">' + esc(label) + '</span>' +
        '<span class="mono" style="color:var(--text-2);">' + n + '개</span></div>';
    };
    var whole = (review.lanes || []).filter(function (l) { return l.label === "문서 전체 점검"; })[0];
    var criteriaBody = c.busy && !c.loaded
      ? '<div style="font-size:13px;color:var(--text-2);padding:8px 0;">적용 기준을 읽는 중…</div>'
      : (c.error
        ? '<div style="font-size:14px;color:var(--sev-crit-fg);padding:8px 0;line-height:1.4;">기준을 불러오지 못했습니다.<br>' + esc(c.error) + '</div>'
        : (layers || '<div style="font-size:13px;color:var(--text-2);padding:8px 0;">공통 또는 팀 기준이 없습니다.</div>'));

    return '<aside class="progress-settings">' +
      '<h3 class="progress-settings-title">이번 검토 설정</h3>' +
      '<p class="progress-settings-sub">시작할 때 확정된 읽기 전용 설정입니다.</p>' +
      '<div style="padding:10px 0;border-top:1px solid var(--line-2);">' +
        '<div style="font-size:12px;font-weight:600;color:var(--text-2);margin-bottom:6px;">검토 대상</div>' +
        '<div class="mono" title="' + esc(docName) + '" style="font-size:12px;color:var(--text-2);' +
          'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(docName) + '</div>' +
      '</div>' +
      '<div style="padding:10px 0;border-top:1px solid var(--line-2);">' +
        '<div style="font-size:12px;font-weight:600;color:var(--text-2);margin-bottom:6px;">적용 기준</div>' + criteriaBody +
        ((!c.busy && !c.error && c.loaded) ?
          '<button class="btn btn-sm btn-ghost btn-ghost-accent" data-act="openReviewCriteria" style="width:100%;justify-content:center;margin-top:8px;">적용 기준 ' + c.total + '개 보기</button>' : '') +
      '</div>' +
      '<div style="padding:10px 0;border-top:1px solid var(--line-2);">' +
        '<div style="font-size:12px;font-weight:600;color:var(--text-2);margin-bottom:6px;">검사 방식</div>' +
        countLine("규칙 자동 검사", c.counts.rule || 0) +
        countLine("표현 점검", c.counts.expression || 0) +
        countLine("문서 전체 점검", c.counts.whole || 0) +
        countLine("직접 확인", c.counts.manual || 0) +
        (c.counts.disabled ? countLine("AI 꺼짐 · 미검토", c.counts.disabled) : "") +
      '</div>' +
      row("모델", state.llm === "off" ? "사용 안 함" : shortModel(s && s.llm_model)) +
      row("이미지", state.llm !== "off" && s && s.vlm_enabled ? "해석 포함" : "해석 안 함") +
      (whole && whole.scope ? row("전체 범위", whole.scope) : "") +
      '<div style="font-size:13px;color:var(--text-2);line-height:1.6;padding-top:10px;border-top:1px solid var(--line-2);">기준을 바꾸려면 검토를 취소하고 시작 화면에서 변경하세요.</div>' +
    '</aside>';
  }

  function reviewCriteriaDialog(review) {
    var c = review.criteria || {};
    if (!c.open) return "";
    var body = c.busy && !c.loaded
      ? '<div style="padding:36px;text-align:center;color:var(--text-3);font-size:13px;">적용 기준을 읽는 중…</div>'
      : (c.error ? errorBanner(c.error)
        : ((c.layers || []).length
          ? '<div style="display:flex;flex-direction:column;gap:10px;">' +
              c.layers.map(function (L) { return criteriaLayerCard(L, !!state.clayers.open[L.id]); }).join("") +
            '</div>'
          : '<div style="padding:36px;text-align:center;color:var(--text-3);font-size:13px;">적용된 기준이 없습니다.</div>'));
    return '<div style="position:fixed;inset:0;z-index:90;display:flex;align-items:center;justify-content:center;padding:28px;background:rgba(0,0,0,.45);backdrop-filter:blur(20px);">' +
      '<button data-act="closeReviewCriteria" aria-label="적용 기준 닫기" style="position:absolute;inset:0;border:0;background:transparent;cursor:default;"></button>' +
      '<div role="dialog" aria-modal="true" aria-label="이번 검토에 적용된 기준" data-sheet="criteria" data-sheet-close="closeReviewCriteria" data-sheet-dim="0.45" data-sheet-blur="20" style="position:relative;z-index:1;width:min(820px,100%);max-height:min(760px,88vh);display:flex;flex-direction:column;background:var(--panel);border:1px solid var(--line);border-radius:var(--r-lg);box-shadow:var(--sh-3);will-change:transform;">' +
        sheetGrip(
          '<div style="display:flex;align-items:flex-start;gap:16px;padding:10px 24px 22px;border-bottom:1px solid var(--line);">' +
            '<div style="flex:1;min-width:0;"><div class="headline" style="font-size:18px;">이번 검토에 적용된 기준</div>' +
              '<div style="font-size:13px;color:var(--text-2);margin-top:6px;">공통 → 팀별 → 선택한 추가 기준 순으로 합쳐진 ' + (c.total || 0) + '개 항목 · 진행 중 변경 불가</div></div>' +
            '<button class="btn btn-sm btn-ghost" data-act="closeReviewCriteria" aria-label="닫기">닫기</button>' +
          '</div>') +
        (c.counts && c.counts.disabled ? '<div style="margin:16px 24px 0;padding:10px 12px;border-radius:var(--r-sm);background:var(--sev-min-bg);color:var(--sev-min-fg);font-size:14px;">AI 검토를 꺼서 LLM 기준 ' + c.counts.disabled + '개는 이번 검토에서 실행되지 않습니다.</div>' : '') +
        '<div data-scroll="review-criteria" style="padding:18px 24px 24px;overflow:auto;">' + body + '</div>' +
      '</div>' +
    '</div>';
  }

  // 진행 화면에서 step 마다 바뀌는 조각들(레인·노트·퍼센트·경과). 전체 렌더
  // 없이 이 조각만 교체하려고 따로 뽑았다 — app.js repaintProgress 와 아래
  // singleProgress 가 함께 쓴다. 전체를 다시 그리면 '검토 취소' 버튼 DOM 이
  // step 마다 재생성돼 hover(:hover)가 깜빡인다.
  function progressFragments(v) {
    var r = v.review;
    var lanes = r.lanes.map(laneMosaic).join("");
    // 아직 작업량을 못 받았거나(체커가 아직 신고 전) 단위 없는 체커가 도는 중.
    // 문서를 읽는 동안의 실시간 문장은 위 준비 행에서 말하고, 이 자리는 그 다음에
    // 무엇이 나타날지 알려준다. 같은 문장을 두 군데 반복하면 단계 구조가 흐려진다.
    var warmupCopy = r.prepReady
      ? (r.note || "문서 읽기를 마쳤습니다. 적용 기준으로 검사 항목과 작업량을 구성하고 있습니다")
      : "문서 준비가 끝나면 실제 검사 단계와 작업량이 여기에 표시됩니다";
    var note = !lanes
      ? '<div class="progress-warmup" role="status">' +
          '<div class="progress-warmup-copy">' +
            esc(warmupCopy) + '</div>' +
        '</div>'
      : ""; // 검사 중 임시 안내는 머리말의 기존 설명 자리에서 갱신한다.
    var prepDesc = r.note || (r.prepReady ? "문서 준비 완료 · 검사 단계 대기 중" :
      "파일을 열어 페이지·표·문단 구조를 정리하고 있습니다");
    var preparation = r.prepReady && r.lanes.length
      ? '<div class="progress-prep-row progress-stage-row" data-lane-status="done">' +
          '<span class="progress-stage-marker" aria-hidden="true">' + ICONS.check + '</span>' +
          '<div class="progress-stage-copy"><div class="progress-stage-title">문서 준비</div>' +
            '<div class="progress-stage-desc">' + esc(r.prep) + '</div></div>' +
          '<span class="progress-stage-status mono">' +
            (r.prepMs ? (r.prepMs / 1000).toFixed(1) + '초' : '완료') + '</span></div>'
      : '<p id="pg-prep-desc" class="progress-stage-desc progress-preparation-note">' + esc(prepDesc) + '</p>';
    return { lanes: lanes, note: note, preparation: preparation, pct: progressPctHtml(r.pct),
             prepDesc: prepDesc,
             elapsed: r.elapsed ? esc(r.elapsed) + ' 경과' : '시작하는 중' };
  }

  function singleProgressPhase(r) {
    if (!r.prepReady) {
      return {
        title: "문서를 읽고 있습니다",
        sub: "본문과 표를 추출하는 단계입니다. 아직 기준 검사는 시작되지 않았습니다."
      };
    }
    if (!r.lanes.length) {
      return {
        title: "검토 항목을 준비하고 있습니다",
        sub: "문서 읽기를 마쳤습니다. 적용 기준으로 검사 순서와 작업량을 구성하고 있습니다"
      };
    }
    var labels = r.lanes.map(function (l) { return l.label; });
    var hasExpression = labels.indexOf("표현 점검") >= 0;
    var hasWhole = labels.indexOf("문서 전체 점검") >= 0;
    return {
      title: "문서를 검토하고 있습니다",
      sub: r.note || (hasExpression && hasWhole
        ? "표현은 문서 조각별로, 일관성은 문서 전체를 비교하여 확인합니다"
        : (labels.length === 1 && labels[0] === "규칙 검사"
          ? "필수 항목과 서식을 자동 규칙으로 확인합니다"
          : "선택된 기준에 따라 문서를 확인합니다"))
    };
  }

  function singleProgress(v) {
    var r = v.review;
    var phase = singleProgressPhase(r);

    // 자주 바뀌는 조각은 id 로 감싸 둔다 — api.js가 step 마다 이 안쪽만 갈아끼우고
    // 전체(특히 '검토 취소' 버튼)는 그대로 둔다. 그래야 버튼이 재생성 안 돼 hover 유지.
    var frag = progressFragments(v);

    return progressFrame({
      scroll: "progress",
      phase: v.done ? "done" : (r.lanes.length ? "reviewing" : "preparing"),
      runKey: (state.rev || {}).startedAt,
      head: progressHead(v.done, v.issueCount, [phase.title, phase.sub], r.pct,
        v.unreviewedCount, { pctId: "pg-pct", titleId: "pg-status-title", subId: "pg-status-sub",
          elapsed: frag.elapsed, elapsedId: "pg-elapsed", cancelAction: "cancelReview",
          docName: ((state.files.single || {}).name || ((window.DOCREVIEW || {}).doc || {}).name || ""),
          docIcon: ICONS.fileText,
          animateState: true, motionStartedAt: (state.rev || {}).startedAt }),
      main: '<div id="pg-preparation">' + frag.preparation + '</div>' +
        '<div class="progress-stage-list"><div id="pg-note">' + (r.prepReady ? frag.note : '') +
        '</div><div id="pg-lanes">' + frag.lanes + '</div></div>' +
        '<ol class="progress-step-guide" aria-label="전체 검토 단계">' +
          ["문서 읽기", "기준 검사", "결과 정리"].map(function (label, i) {
            return '<li' + (i === (v.done ? 2 : (r.prepReady ? 1 : 0)) ? ' aria-current="step"' : '') +
              '>' + (i + 1) + ' ' + label + '</li>';
          }).join("") + '</ol>',
      settings: criteriaPanel(r),
      after: reviewCriteriaDialog(r)
    });
  }

  // AI 검토 켜고 끄기. 검토를 시작하는 자리에 둔다 — 설정 화면 깊숙이 두면
  // 검토자는 자기가 무엇으로 검토하는지 모른 채 버튼을 누른다.
  // 고를 수 있는 건 켜고 끄는 것뿐이다. 어떤 모델을 쓸지는 서버가 정한다.
  function aiToggle(v) {
    if (!v.llmChips.length) {
      return '<div style="font-size:13px;color:var(--text-2);">' + esc(v.llmNote) + '</div>';
    }
    var chips = v.llmChips.map(function (l) {
      return toolbarChip("setLlm", l.k, l.label, l.on);
    }).join("");
    var hint = v.llm === "on"
      ? "표현 불일치·모순까지 봅니다 · 1분 남짓"
      : "규칙 검사만 — 몇 초면 끝납니다";
    return '<div>' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">' +
        '<span style="font-size:13px;font-weight:600;color:var(--text);">AI 검토</span>' + chips +
      '</div>' +
      '<div style="font-size:13px;color:var(--text-2);">' + hint + '</div>' +
    '</div>';
  }

  // 서버가 답한 모델 이름을 그대로 쓰되 벤더 접두어만 뗀다.
  function shortModel(m) {
    if (!m) return "AI 모델";
    var parts = String(m).split("/");
    return parts[parts.length - 1];
  }

  function toolbarChip(act, arg, label, on, extra) {
    var st = on
      ? "background:var(--accent-weak);color:var(--accent-ink);"
      : "background:transparent;color:var(--text-2);";
    return '<span class="chip" data-act="' + act + '" data-arg="' + arg + '" style="' + st + 'font-size:12px;font-weight:600;padding:6px 12px;border-radius:var(--r-sm);">' + esc(label) + (extra || "") + '</span>';
  }

  // 체크리스트 기준 검토의 상단 완료 현황. 101개 중 몇 개가 지적/이상없음/사람
  // 확인필요로 갈렸는지 — 이게 없으면 항목별 목록만 보고는 몇 개가 아직
  // 사람 손을 기다리는지 알 수 없다.
  function checklistCompletenessLine(summary) {
    return '<div style="padding:2px 0 16px;font-size:12px;font-weight:600;color:var(--text-2);">' +
      '자동 판정 ' + esc(summary.flagged) + ' · 이상 없음 ' + esc(summary.clean) +
      // "응답 없음"은 서버가 안 붙었거나 죽은 것이라 고칠 곳이 설정·장비다.
      // "검사 안 됨"은 기준값이 비었거나(규칙) 그 기준 판정만 안 온 것(LLM)이라
      // 고칠 곳이 다르다. 왜인지는 항목 안에 붙는다 — 규칙은 INFO 지적으로,
      // LLM 은 note 로. 뭉치면 검토자가 무엇을 해야 하는지 알 수 없다.
      (summary.noanswer ? ' · 응답 없음 ' + esc(summary.noanswer) : '') +
      (summary.unreviewed ? ' · 검사 안 됨 ' + esc(summary.unreviewed) : '') +
      // "해당 없음"은 고칠 것이 없다 — 있을 때만 보여주고, "검사 안 됨"과 가른다.
      // 뭉치면 검토자가 정상인 것을 보고 장비·설정을 뒤진다.
      (summary.na ? ' · 해당 없음 ' + esc(summary.na) : '') +
      // 생성 기능·이력 관리는 이 문서를 볼 항목이 아니다. "사람 확인 필요" 에
      // 섞으면 검토자가 자기 일이 아닌 것까지 떠안은 줄 안다.
      (summary.outofscope ? ' · 검토 대상 아님 ' + esc(summary.outofscope) : '') +
      ' · 사람 확인 필요 ' + esc(summary.manual) + '</div>';
  }

  // 항목 하나: [번호 · 항목 텍스트] 뒤에 상태를 붙이고, flagged면 그 항목에서
  // 나온 지적을 findingCardInner로 그대로 그린다(평면 목록과 같은 카드 —
  // 같은 finding dict 를 참조하므로 번호·형광펜도 같다).
  // 보통 단일 검토의 "기준 판정" 탭. 상태별 구역으로 나누고 **사람 확인 필요만 펼친다.**
  // 해당 없음·이상 없음·지적·검사 안 됨은 건수 한 줄로 접어 둔다 — 항목 104개짜리
  // 팀에서 다 펼치면 고칠 것이 묻힌다(2026-09-16). 펼친 구역은 팀 기준의 group 으로
  // 묶어 소제목을 단다.
  var CRITERIA_SECTIONS = [
    ["manual", "사람 확인 필요", "문서만으로는 도구가 판정할 수 없어 검토자가 직접 보는 항목"],
    ["flagged", "지적 있음", "수정 사항 탭의 지적이 걸린 항목"],
    ["unreviewed", "검사 안 됨", "검사기가 붙었지만 이번에 판정을 못 낸 항목 — 검토 상태 탭에 사유"],
    ["clean", "이상 없음", "검사했고 걸린 것이 없는 항목"],
    ["na", "해당 없음", "이 문서 종류를 대상으로 하지 않는 항목"],
    ["outofscope", "검토 대상 아님", "문서를 보는 항목이 아닌 것(생성·이력 관리)"],
    ["noanswer", "응답 없음", "LLM 서버가 답하지 않은 항목"]
  ];
  function criteriaJudgementsHtml(v) {
    var R = v.criteriaReview, open = v.criteriaSections || {};
    var out = '<p class="single-result-empty-note" style="margin:0 0 10px;">팀 기준 ' + R.summary.total +
      '개 항목의 판정입니다. 사람 확인 항목만 펼쳐 두었습니다.</p>';
    CRITERIA_SECTIONS.forEach(function (sec) {
      var key = sec[0], items = R.items.filter(function (it) { return it.status === key; });
      if (!items.length) return;
      var isOpen = !!open[key];
      out += '<div class="criteria-section' + (isOpen ? ' is-open' : '') + '">' +
        '<button type="button" class="criteria-section-head" data-act="toggleCriteriaSection" data-arg="' + key + '" aria-expanded="' + (isOpen ? 'true' : 'false') + '">' +
          '<span class="criteria-section-caret" aria-hidden="true">' + (isOpen ? '▾' : '▸') + '</span>' +
          '<b>' + esc(sec[1]) + '</b><span class="criteria-section-count pill pill-neutral">' + items.length + '</span>' +
          // 설명은 제목 아랫줄 — 오른쪽에 붙이니 좁은 패널에서 두 줄로 구겨졌다(2026-09-16).
          '<span class="criteria-section-sub">' + esc(sec[2]) + '</span>' +
        '</button>';
      if (isOpen) {
        // 펼친 항목은 머리와 **한 상자** 안에 — 머리만 상자고 항목이 밖으로 흘러내리니
        // 윗동만 남은 모양이 됐다(2026-09-16).
        out += '<div class="criteria-section-body">';
        // group(표지·개정·목차 / 참조문서 …) 순서는 처음 나온 차례대로.
        var groups = [], byGroup = {};
        items.forEach(function (it) {
          var g = it.group || "";
          if (!byGroup.hasOwnProperty(g)) { byGroup[g] = []; groups.push(g); }
          byGroup[g].push(it);
        });
        // 층(공통/팀별) 태그는 구역 안에 층이 섞일 때만 — 전부 "팀별"이면 아무것도 안 가른다.
        var layers = {};
        items.forEach(function (it) { layers[it.layer || ""] = true; });
        var mixedLayers = Object.keys(layers).length > 1;
        groups.forEach(function (g) {
          if (g && groups.length > 1) out += '<div class="criteria-group-head">' + esc(g) + '</div>';
          out += byGroup[g].map(function (it) {
            // terse: 구역 설명이 이미 "왜 사람 몫인가"를 말하니 항목마다 같은 문장을 되풀이하지
            // 않는다(64줄이 같은 말이었다, 2026-09-16). 이유는 상태 알약의 툴팁에 남는다.
            var item = Object.assign({}, it, { group: groups.length > 1 ? "" : it.group,
              layer: mixedLayers ? it.layer : "", terse: true,
              findings: (it.findings || []).filter(function (f) { return !f.unreviewed && f.sev !== "info"; }) });
            return checklistItemGroup(item, v);
          }).join("");
        });
        out += '</div>';
      }
      out += '</div>';
    });
    return out;
  }

  // 사람 몫인 이유 한 줄(툴팁·설명 공용). 기준이 mode: 사람 이라고 적었으면 문서만으로
  // 못 보는 것이고, 아니면 아직 검사기가 없는 것이다 — 검토자가 할 일이 다르다.
  function manualWhy(it) {
    if (it.mode !== "사람") return "";
    return it.mode_declared
      ? "이 기준은 문서만으로 판정할 수 없어 사람이 확인합니다."
      : "이 기준에 붙은 검사기가 아직 없어 사람이 확인합니다.";
  }
  function checklistItemGroup(it, v) {
    // 분류(IS22 의 Consistency·Correctness 등)를 항목 앞에 옅게 단다 — 이 항목이
    // 왜 그 검사에 걸렸는지 검토자가 알아보게. 없으면(무분류) 생략한다.
    // 분류(IS22 의 Consistency·Correctness 등)·층(공통/팀별/업로드)은 알약 부품으로 —
    // 결과 카드의 분류 알약과 같은 옷이다(2026-09-16). 층은 채우지 않은 테두리 알약이라
    // 분류와 급이 달라 보인다.
    var groupTag = it.group ? '<span class="pill pill-neutral crit-tag">' + esc(it.group) + '</span>' : '';
    var layerTag = it.layer ? '<span class="pill pill-outline crit-tag">' + esc(it.layer) + '</span>' : '';
    // 번호는 검토자가 **원본 체크리스트와 대조하는 길**이다(엑셀 1~4, 올린
    // 파일의 No.1~2). 그래서 출처가 있는 번호만 보여준다 — "C-" 로 시작하는
    // 것은 우리가 지어낸 것이라 대조할 원본이 없고, 사용자에겐 뜻이 없다.
    var showNo = it.no && it.no.indexOf("C-") !== 0;
    var label = (showNo ? esc(it.no) + ' · ' : '') + esc(it.text);
    // 상태는 알약 하나. 지적 있음(주황)·이상 없음(초록)만 색이 있고 나머지는 회색 —
    // 사람이 볼 것과 도구가 끝낸 것만 색으로 갈리면 된다.
    var head = it.status === "flagged"
        ? '<span class="pill pill-maj">지적 ' + esc(it.findings.length) + '건</span>'
      : it.status === "noanswer" ? '<span class="pill pill-outline">응답 없음</span>'
      : it.status === "unreviewed" ? '<span class="pill pill-outline">검사 안 됨</span>'
      : it.status === "na" ? '<span class="pill pill-outline">해당 없음</span>'
      : it.status === "outofscope" ? '<span class="pill pill-outline">검토 대상 아님</span>'
      : it.status === "manual" ? '<span class="pill pill-neutral" title="' + esc(manualWhy(it)) + '">사람 확인 필요</span>'
        : '<span class="pill pill-good">이상 없음</span>';
    // 확인 방법(세부 기준). 본문이 "아래 양식으로"에서 끊겨 있어도 여기 있다 —
    // 원본 엑셀은 사내 파일이라 앱에 없어서, 이걸 안 보여주면 검토자가 무엇을
    // 확인하라는 건지 알 길이 없다.
    var noteHtml = it.note
      ? '<div style="margin-top:4px;font-size:13px;color:var(--text-2);line-height:1.6;white-space:pre-wrap;">' +
          esc(it.note) + '</div>'
      : '';
    // "왜 사람 확인 필요인가"의 답. 도구가 검사한 것과 애초에 검사할 수 없는
    // 것은 다른 말인데, 상태만 보면 둘이 같아 보인다.
    var why = it.terse ? '' : (it.status === "outofscope")
      // 생성 기능(수식 도출·이미지·표 그리기)과 이력 관리다. 문서를 보는
      // 검사가 아니라서 이 화면에 판정이 있을 수 없다.
      ? '<div style="margin-top:4px;font-size:13px;color:var(--text-2);">' +
          '이 기준은 문서를 검토하는 항목이 아닙니다 — 산출물을 만들거나 이력을 관리하는 기능입니다.</div>'
      : (it.status === "na")
      // 고칠 것이 없다는 뜻이다. "검사 안 됨"으로 읽히면 검토자가 장비·설정을
      // 뒤지게 되므로 여기서 분명히 말한다.
      ? '<div style="margin-top:4px;font-size:13px;color:var(--text-2);">' +
          '이 기준이 이 문서를 대상으로 하지 않습니다 — 고칠 것이 없습니다.</div>'
      // 사람 몫인 이유는 둘이고 검토자가 할 일이 다르다.
      //   기준이 mode: 사람 이라고 **적었다** → 문서만으로는 못 본다(스캔 품질·
      //     책갈피 동작처럼). 검사기를 만들 일이 아니라 사람이 볼 일이다.
      //   아무도 안 적었다 → 그냥 아직 검사기가 없는 것이다. 업로드 체크리스트는
      //     엑셀에 mode 칸이 없어 **전부** 이쪽인데, 예전에는 화면이 그것들까지
      //     "문서만으로 판정할 수 없다"고 말했다 — "PDF 필드오류 문자열이 있는가"
      //     처럼 기계가 그대로 볼 수 있는 항목에도 그렇게 말했으니 거짓말이다.
      // mode 가 규칙인데 manual 인 항목은 note 가 이미 이유를 말한다(orchestrator
      // 의 note_suffix) — 여기서 또 말하면 같은 문장이 두 번 뜬다.
      : (it.status === "manual" && it.mode === "사람")
      ? '<div style="margin-top:4px;font-size:13px;color:var(--text-2);">' + esc(manualWhy(it)) + '</div>'
      : '';
    // 기준 아래의 들여쓰기와 기준 사이 간격으로 소속을 구분한다.
    var findingsHtml = it.findings.length
      ? '<div style="margin-top:10px;padding-left:12px;">' +
          it.findings.map(function (f) {
            return findingCardHtml(f, v, "margin-bottom:8px;");
          }).join("") +
        '</div>'
      : '';
    return '<div class="crit-item">' +
      '<div class="crit-item-head">' +
        '<span class="crit-item-title">' + layerTag + groupTag + label + '</span>' +
        '<span class="crit-item-status">' + head + '</span>' +
      '</div>' +
      noteHtml + why +
      findingsHtml +
    '</div>';
  }

  // 내려받기 아이콘(Lucide download). icons.js 에 없어 여기 둔다 — 단일 검토의
  // 내보내기 메뉴와 체크리스트 검토의 Excel 버튼이 같은 것을 쓴다.
  var dlIcon = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';

  function singleResults(v) {
    // 문서 미리보기. pdf(브라우저 blob) 또는 docx/hwpx(서버 변환)면 PDF iframe으로,
    // 이력·미지원·변환 실패는 엔진이 읽은 텍스트로. hwpx는 재현본이라 라벨로 구분한다.
    var kind = v.viewerKind;
    // docx·hwp·hwpx 는 LibreOffice로 원본을 직접 변환해 레이아웃이 살아 있다
    // (hwp/hwpx는 H2Orestart 필터). 그래서 pdf.js 뷰어로 연다. 변환 안 되는 포맷·
    // 이력·변환 실패만 엔진이 읽은 텍스트 폴백으로 간다.
    var convertible = (kind === "DOCX" || kind === "HWPX" || kind === "HWP");
    var showPdf = v.hasOrigFile && (kind === "PDF" || convertible) && !v.convertError;
    var baseLabel = "원본";
    var headMeta = showPdf
      ? (kind === "PDF" ? "원본 PDF" : kind + " 변환본 · 원본과 배치·쪽수가 다를 수 있음")
      : (v.convertError ? "변환 실패 — 텍스트로 표시"
         : (v.isPdf ? "이력에는 원본이 없어 텍스트로 표시"
            : (v.sections.length ? v.sections.length + "개 절 · 엔진이 읽은 본문" : "본문 없음")));
    // 헤더(문서명·쪽수·형광펜·줌·전체화면)는 공용 viewerHeadHtml — 폴더
    // 검토(caseDocView)와 같은 것을 쓴다. 복사하면 한쪽만 고쳐진다.
    var docName = (v.doc && v.doc.name) ? v.doc.name : "Document";
    var markPending = v.viewerMode === "marked" && v.annot.busy && !v.annot.viewUrl && showPdf;
    var viewerPending = !!(v.converting || v.loadingOrig || markPending);
    var viewerHead = viewerHeadHtml(docName, showPdf, headMeta, viewerPending);
    // 보관 한도로 사라진 원본(originalGone)에는 재시도 버튼을 달지 않는다 —
    // 몇 번을 눌러도 404 라, 버튼이 있으면 "고칠 수 있는 오류"로 읽힌다.
    if (v.originalError) viewerHead += '<div class="viewer-source-error" role="alert"><span>' +
      esc(v.originalError) + '</span>' +
      (v.originalGone ? '' :
        '<button type="button" class="btn btn-sm btn-ghost btn-ghost-accent" data-act="retryOriginal">원본 다시 불러오기</button>') +
      '</div>';
    var docViewer = '<div style="flex:1;background:var(--bg);display:flex;flex-direction:column;position:relative;overflow:hidden;">' +
      // 준비 중·표시 중도 문서와 같은 카드(viewerWrap) 안에 그린다. 카드 없이
      // 회색 캔버스에 스켈레톤만 띄우면 "작은 문서가 회색 위에 떠 있는" 그림이
      // 되고, 문서가 뜨는 순간 카드가 생겨 틀이 바뀐다(2026-09-04).
      (v.converting || v.loadingOrig
        ? viewerWrap(true, viewerHead + pdfPendingHtml(v.loadingOrig ? "원본을 불러오는 중…" : "원본을 PDF로 준비하는 중…"))
        // 표시본을 굽는 동안은 원본을 대신 띄우지 않는다. 화면 전환이 곧 iframe
        // 재로드라, 원본을 잠깐 띄웠다 바꾸면 로드를 두 번 하며 깜빡인다.
        // 실제 문서에서 0.2초대라 기다리는 편이 눈에 편하다.
        : markPending
          ? viewerWrap(true, viewerHead + pdfPendingHtml("수정 사항을 문서에 표시하는 중…"))
        : showPdf
          // 제목·토글·PDF를 하나의 세로 카드로 묶어 회색 캔버스에 크게(viewerWrap).
          ? viewerWrap(true, viewerHead +
              '<div id="pdf-mount" style="flex:1;overflow:hidden;"></div>')
          // 재현본(hwpx·텍스트 폴백)도 PDF와 같은 카드 구조(viewerWrap)를 쓴다 —
          // 예전엔 헤더를 카드 위에 깔고 스크롤 컨테이너에 padding:32px 을 줘서,
          // 문서 시작이 오른쪽 "검토 결과" 패널(margin-top:4px)보다 ~65px 아래에서
          // 시작했다. hwpx 는 늘 이 분기라(docx만 PDF로 변환된다) 주력 포맷에서
          // 항상 어긋나 보였다. 헤더가 카드 안에 있으니 스크롤도 PDF와 같다 —
          // 헤더는 고정되고 본문만 흐른다. 문서 여백(40/44px)은 스크롤 컨테이너가 갖는다.
          : viewerWrap(false, viewerHead +
              '<div id="doc-scroll" data-scroll="doc" style="flex:1;overflow:auto;padding:40px 44px;">' +
                docBody(v) +
              '</div>')) +
    '</div>';

    // 분포 바·범례는 issuesShell 이 그린다 — 폴더 검토도 같은 것을 쓴다.

    // 내보내기 메뉴의 헤더 드롭다운. 항목을 고르면 handler가 닫는다.
    var historyId = window.DOCREVIEW.historyId || "";
    var exportMenu = state.exportMenuOpen
      ? '<div id="exportMenu" style="position:absolute;top:44px;right:0;width:248px;background:var(--panel);border:1px solid var(--line);border-radius:var(--r-md);box-shadow:var(--sh-3);z-index:120;overflow:hidden;transform-origin:top right;' + popoverAnim(state.exportOpenedAt) + '">' +
          // PDF면 원본에 형광펜을 얹어 돌려줄 수 있다. 그 밖의 포맷은 HTML 산출물뿐.
          // 색으로 서열을 매기지 않는다. 글자색은 하나로 두고 아이콘 칩과
          // 한 줄 설명으로 무엇을 받는지 구분한다.
          (v.isPdf
            ? '<button data-act="downloadMarked" class="mi"' + (v.annot.busy ? ' disabled' : '') + ' style="border-bottom:1px solid var(--line-2);">' +
                '<span class="mi-ico">' + dlIcon + '</span>' +
                '<span><span>' + (v.annot.busy ? '표시본 만드는 중…' : '표시본 PDF') + '</span>' +
                '<span class="mi-sub" style="display:block;">수정 사항을 형광펜·번호로 얹은 원본</span></span>' +
              '</button>'
            : '') +
          '<button data-act="exportAs" data-arg="html" class="mi">' +
            '<span class="mi-ico">' + dlIcon + '</span>' +
            '<span><span>검토 결과 문서</span>' +
            '<span class="mi-sub" style="display:block;">수정 사항 전체를 담은 HTML</span></span>' +
          '</button>' +
          // 엑셀은 서버가 이력에서 만든다(review_xlsx). 검토자는 날짜 붙은 파일로
          // 회차를 관리한다(2026-09-14 품질팀) — 이력에 없는 검토는 못 만든다.
          '<button data-act="exportXlsx" class="mi"' + (historyId ? '' : ' disabled') + '>' +
            '<span class="mi-ico">' + dlIcon + '</span>' +
            '<span><span>Excel</span>' +
            '<span class="mi-sub" style="display:block;">' +
              (historyId ? '구분·검사·위치·근거를 표로. 파일명에 검토일' : '이력에 저장되지 않아 만들 수 없음') +
            '</span></span>' +
          '</button>' +
          '<div style="display:flex;gap:4px;padding:6px;border-top:1px solid var(--line-2);">' +
            [["json", "JSON"], ["md", "Markdown"], ["csv", "CSV"]].map(function (e) {
              return '<button data-act="exportAs" data-arg="' + e[0] + '" class="mi-mini">' + e[1] + '</button>';
            }).join("") +
          '</div>' +
          // 결과가 별로면 여기서 바로 지운다(2026-09-14 품질팀). 기록 목록의 삭제와
          // 같은 확인창·API 를 쓴다.
          (historyId
            ? '<button data-act="askDeleteCurrent" class="mi" style="border-top:1px solid var(--line-2);color:var(--sev-maj-fg);">' +
                '<span class="mi-ico">' + ICONS.trash + '</span>' +
                '<span><span>이 검토 기록 삭제</span>' +
                '<span class="mi-sub" style="display:block;">결과와 원본을 기록에서 지움</span></span>' +
              '</button>'
            : '') +
        '</div>'
      : "";
    var confirmModal = state.confirmDelete
      ? confirmDialog({ title: "검토 기록 삭제", content: historyDeleteContent(state.confirmDelete),
                        act: "deleteHistory", arg: state.confirmDelete.id })
      : "";

    // 단일 결과만 B안으로 구성한다. 원문 뷰어와 다른 검토의 공용 패널은 유지한다.
    var reviewTab = reviewTabNow();
    var statusFindings = (window.DOCREVIEW.findings || []).filter(function (f) {
      return f.unreviewed || f.sev === "info";
    });
    var issueFindings = v.tableFindings.filter(function (f) {
      return !f.unreviewed && (f.sev === "major" || f.sev === "minor") && !f.hidden;
    });
    var dismissedFindings = v.tableFindings.filter(function (f) {
      return !f.unreviewed && (f.sev === "major" || f.sev === "minor") && f.hidden;
    });
    var resultTabs = [];
    if (v.lineage) resultTabs.push(["lineage", lineageTabLabel(v.lineage)]);
    resultTabs.push(["findings", "수정 사항", v.issueCount]);
    if (statusFindings.length) resultTabs.push(["status", "검토 상태", statusFindings.length]);
    // 팀 기준 항목별 판정. 숫자는 **사람이 봐야 할 항목 수**만 — 나머지(해당 없음·이상
    // 없음)는 탭 안에서 접혀 있다. 결과 첫인상이 지적 목록 그대로이게.
    if (v.criteriaReview) resultTabs.push(["criteria", "기준 판정", v.criteriaReview.summary.manual]);
    var tabBar = '<div class="single-result-tabs" role="group" aria-label="검토 결과 영역">' +
      resultTabs.map(function (t) {
        // 미검토가 있으면 검토 상태 탭이 경고 표식을 단다. 탭 줄은 어느 탭을 보든 늘
        // 보이므로 "검사를 못 했다"가 탭 밖에서도 보인다 — 위의 경고 띠를 이걸로 대신한다
        // (2026-09-16). 미검토 0 이면 표식 없이 건수만.
        var warn = t[0] === "status" && v.unreviewedCount
          ? '<span class="single-result-tab-warn" aria-hidden="true">' + ICONS.alert + '</span>' : '';
        return '<button type="button" id="tab-' + t[0] + '" class="single-result-tab' +
          (reviewTab === t[0] ? ' is-active' : '') + (warn ? ' has-warn' : '') +
          '" data-act="setReviewTab" data-arg="' + t[0] + '" aria-pressed="' + (reviewTab === t[0] ? 'true' : 'false') +
          (warn ? '" title="완료하지 못한 검사 ' + v.unreviewedCount + '건' : '') + '">' +
          warn + esc(t[1]) + (t.length > 2 ? '<b>' + t[2] + '</b>' : '') + '</button>';
      }).join("") + '</div>';

    function resultSelect(act, label, options) {
      var filtered = act === "setChecker" && options.some(function (o) { return o.on && o.k !== "all"; });
      var selected = options.filter(function (o) { return o.on; })[0];
      var id = act === "setChecker" ? "singleResultChecker" : "singleResultSort";
      return '<div class="single-result-select' + (filtered ? ' is-filtered' : '') +
        '" data-result-control="' + act + '"><span>' + label + '</span>' +
        selectField(id, label, options.map(function (o) { return { id: o.k, name: o.label }; }),
          { value: selected ? selected.k : "", cls: "sel-sm", ariaLabel: label }) + '</div>';
    }
    var filterBar = "";
    if (reviewTab === "findings" && !v.checklistReview && v.issueCount > 0) {
      // 확실/확인 필요 보기 버튼은 뺐다(SEV 주석) — 묶음이 하나면 "전체"와 같다.
      filterBar = '<div class="single-result-tools"><div class="single-result-toolbar">' +
          (v.checkerChips.length > 2 ? resultSelect("setChecker", "검사", v.checkerChips) : '') +
          resultSelect("setSort", "정렬", v.sortChips) +
          '<span class="single-result-shown" aria-live="polite">' + issueFindings.length + '건 표시</span>' +
        '</div></div>';
    }
    var resultHeader = '<div class="single-results-head">' +
      '<div class="single-result-title"><h2>검토 결과</h2><div class="single-result-actions">' +
        '<button type="button" class="result-icon-btn' + (state.exportMenuOpen ? ' is-active' : '') +
          '" data-act="toggleExportMenu" title="내보내기" aria-label="검토 결과 내보내기">' + dlIcon + '</button>' +
        '<button type="button" class="result-icon-btn" data-act="toggleIssues" title="패널 접기" aria-label="검토 결과 패널 접기">' + ICON_PANEL_CLOSE + '</button>' +
      '</div></div>' + exportMenu +
      // "완료하지 못한 검사 N건" 띠는 뺐다 — 같은 사실을 검토 상태 탭의 경고 표식이 말한다.
      tabBar + '</div>' + filterBar +
      (v.annot.msg ? '<div class="single-result-note">' + esc(v.annot.msg) + '</div>' : '');

    var resultBody;
    if (reviewTab === "lineage") {
      resultBody = lineageHtml(v.lineage, v.lineageCandidate);
    } else if (reviewTab === "status") {
      // 상태 보고에는 원문 이동·수정안 생성 버튼을 붙이지 않는다. 검사 실패는 문서 결함이 아니다.
      resultBody = statusFindings.map(function (f) {
        // 종류는 알약이 말한다(미검토 = 테두리, 과정 보고 = 회색). 바탕색으로 가르던 것을
        // 뺐다 — 왼쪽 위 글자가 이미 같은 말을 하는데 회색 바탕이 "왜?"만 남겼다(2026-09-16).
        return '<article class="single-status-card">' +
          '<div class="single-status-meta"><span class="pill ' + (f.unreviewed ? 'pill-outline' : 'pill-neutral') + '">' +
            (f.unreviewed ? '미검토' : '검토 과정 보고') + '</span><span>' + esc(f.label || '') + '</span></div>' +
          // 보고가 여러 줄이면(뺀 지적 목록) 줄을 살린다 — 한 문단으로 뭉치면 목록이 벽이 된다.
          '<p>' + String(f.message || "").split("\n").map(esc).join("<br>") + '</p>' +
          (f.suggestion ? '<div class="single-status-guidance">' + esc(f.suggestion) + '</div>' : '') +
          '</article>';
      }).join("") + '<p class="single-result-empty-note">미검토는 ‘이상 없음’을 의미하지 않습니다.</p>';
    } else if (reviewTab === "criteria" && v.criteriaReview) {
      resultBody = criteriaJudgementsHtml(v);
    } else if (v.checklistReview) {
      // 기존 항목별 기준·직접 확인 안내는 보존하고, 상태 보고만 별도 탭에서 보여준다.
      resultBody = checklistCompletenessLine(v.checklistReview.summary) +
        v.checklistReview.items.map(function (it) {
          var item = Object.assign({}, it, { findings: (it.findings || []).filter(function (f) {
            return !f.unreviewed && f.sev !== "info";
          }) });
          return checklistItemGroup(item, v);
        }).join("");
    } else {
      resultBody = issueFindings.length
        ? issueFindings.map(function (f, i) { return findingCardHtml(f, v, enterAnim(v, i)); }).join("")
        : '<div class="single-result-empty">' +
            (v.issueCount ? '선택한 조건에 해당하는 수정 사항이 없습니다.' : '확인된 수정 사항이 없습니다.') +
            (v.issueCount ? '<p>검사 분류와 결과 종류를 바꾸거나 전체 결과를 확인하세요.</p>' +
              '<button type="button" class="btn btn-sm btn-ghost btn-ghost-accent" data-act="resetResultFilters">필터 초기화</button>' : '') +
            (v.unreviewedCount ? '<p>완료하지 못한 검사가 있습니다. 검토 상태를 확인해 주세요.</p>' : '') +
          '</div>';
      // 검토자가 뺀 지적. 목록에서는 내리되 **한 줄로 남긴다** — 펼치면 되돌릴 수 있다.
      if (v.dismissedCount) {
        resultBody += '<div class="dismissed-row">' +
          '<button type="button" data-act="toggleDismissed" aria-expanded="' + (state.showDismissed ? 'true' : 'false') + '">' +
            '검토자가 제외한 지적 <b>' + v.dismissedCount + '건</b> · ' + (state.showDismissed ? '접기' : '보기') +
          '</button></div>' +
          (state.showDismissed
            ? dismissedFindings.map(function (f) { return findingCardHtml(f, v, "opacity:.72;"); }).join("")
            : '');
      }
    }
    var issuesPanel = issuesShell({
      id: "issuesPanel", title: "검토 결과", count: v.issueCount,
      hidden: state.issuesCollapsed, header: resultHeader, body: resultBody,
      bodyMotion: contentAnim("single-result", reviewTab)
    });

    // 접었을 때 오른쪽 끝에 남는 얇은 레일. 클릭하면 다시 펼친다 — 몇 건인지도 세로로 보여준다.
    var issuesRail = '<div id="issuesRail" class="rail" data-act="toggleIssues" tabindex="0" role="button" title="검토 결과 펼치기" style="margin:4px 0 12px 0;display:' + (state.issuesCollapsed ? "flex" : "none") + ';">' +
      '<div class="rail-ico">' + ICON_PANEL_OPEN + '</div>' +
      '<div class="rail-label">검토 결과 ' + v.issueCount + '건</div>' +
    '</div>';

    // 백링크는 비교 화면처럼 전체 폭 상단 바로. 그래야 그 아래에서 문서 뷰어와
    // "검토 결과" 패널이 같은 높이에서 시작한다(예전엔 백링크가 왼쪽 컬럼에만 있어
    // 문서를 밀어, 패널 헤더가 문서보다 위에서 시작했다).
    // 패널·레일을 둘 다 DOM에 두고 display만 토글한다 — 접기 때 render()로 문서 뷰어를
    // 다시 그리면 PDF iframe이 리로드되므로(=새로고침), 뷰어는 건드리지 않는다.
    // 껍질과 백링크 줄은 비교 결과와 같은 클래스를 쓴다 — 여백을 인라인으로
    // 박아 두면 두 화면이 서로도, 나머지 화면과도 어긋난다(index.html .results-shell).
    return '<div class="results-shell" style="width:100%;">' +
      '<div class="results-head">' + resultsBackLink() + newReviewLink() + '</div>' +
      '<div id="results-row" style="' + resultsRowCss(state.viewerFull) + '">' +
        '<div style="flex:1;min-width:0;display:flex;flex-direction:column;">' + docViewer + '</div>' +
        issuesPanel + issuesRail +
      '</div>' + confirmModal +
    '</div>';
  }

  // 문서 카드(뷰어 헤더 + PDF/재현본)의 스타일. 전체화면이어도 카드 자체는 그대로다
  // — 화면을 덮는 건 카드가 아니라 아래 resultsRowCss가 맡는다.
  function viewerCardCss(isPdf) {
    return "display:flex;flex-direction:column;overflow:hidden;background:var(--panel);" +
      "border:1px solid var(--line);border-radius:var(--r-md);" +
      // PDF: 주어진 자리를 폭·높이 모두 꽉 채운다. 페이지 배율은 pdfview 가 폭에
      // 맞춰 정한다. 예전에는 aspect-ratio 로 높이에서 폭을 파생시켜, 오른쪽 패널을
      // 접어도 좌우 여백만 늘고 문서는 안 커졌다.
      // 문서 카드는 페이지에 얹힌 판이라 그림자 없이 선으로만(2026-09-04).
      // PDF 쪽에 남아 있던 --sh-3 도 같은 이유로 뺐다 — 팝오버가 아니다.
      (isPdf ? "height:100%;width:100%;"
             : "width:100%;max-width:820px;");
  }

  // 뷰어 카드 공용 래퍼 — 회색 캔버스 위 카드. 시작 높이(padding-top 4px)가
  // 오른쪽 issuesShell(margin-top 4px)과 맞는다. 단일 PDF·재현본·폴더 검토
  // 셋이 같은 것을 써야 화면마다 문서 시작 높이가 안 갈라진다.
  function viewerWrap(isPdf, inner) {
    return '<div style="flex:1;overflow:hidden;display:flex;justify-content:center;padding:4px 32px 12px;">' +
      '<div style="' + viewerCardCss(isPdf) + '">' + inner + '</div>' +
    '</div>';
  }

  // 뷰어 카드의 슬림 헤더 — 단일 검토와 폴더 검토가 같은 것을 쓴다.
  // showPdf 면 쪽수(#pdf-where)·형광펜·줌·전체화면 단추가 붙고, 아니면
  // 상태 문구(headMeta)만 남는다. 단추들은 전역 id(#pdf-mount 의 pdfview,
  // #results-row)에 붙으므로 어느 화면에서든 같은 액션으로 동작한다.
  function viewerHeadHtml(docName, showPdf, headMeta, pending) {
    var converted = showPdf && /\.(docx|hwp|hwpx)$/i.test(docName || "");
    var sourceNote = converted ? '<div class="viewer-source-note">변환 PDF · 원본과 배치·쪽수가 다를 수 있습니다.</div>' : '';
    // 도구줄은 "행동"이 아니라 "보기 조절"이다 — 버튼 두 옷(주·보조)과 다른 종류.
    // PDF 뷰어·문서 편집기 관례대로 **조용한 아이콘 버튼**: 테두리·면 없음, 회색,
    // 올리면 옅은 회색 면, **켜진 것만** 메인색(형광펜은 토글이라 눌려 있음이 보여야
    // 한다). 확대·축소는 `− 100% +` 한 묶음이고 가운데 숫자를 누르면 폭 맞춤.
    // 모양은 index.html .viewer-tool 이 진다 — 인라인으로 덮지 말 것(2026-09-08).
    var viewerWhere = showPdf
      ? '<span id="pdf-where" class="mono viewer-where"></span>'
      : "";
    var markBtn = showPdf
      ? '<button type="button" data-act="toggleMarks" class="viewer-tool viewer-mark-tool" aria-pressed="' +
        (state.marksOn === false ? "false" : "true") + '" title="' +
        (state.marksOn === false ? "형광펜 켜기" : "형광펜 끄기") + '">' + ICONS.marker + '<span>형광펜</span></button>'
      : "";
    var viewerToggle = showPdf
      ? '<span class="viewer-tool-group">' +
          '<button type="button" class="viewer-tool" data-act="zoom" data-arg="-0.2" title="축소">−</button>' +
          '<button type="button" id="pdf-zoom" class="viewer-tool" data-act="zoom" data-arg="fit" title="폭 맞춤"></button>' +
          '<button type="button" class="viewer-tool" data-act="zoom" data-arg="0.2" title="확대">+</button>' +
        '</span>'
      : '<span class="viewer-where">' + headMeta + '</span>';
    // 문서를 화면 전체로. 카드가 폭에 맞춰 배율을 정하는 탓에 오른쪽 패널을
    // 접어도 문서는 안 커진다 — 크게 보는 유일한 길이라 전체화면을 따로 둔다.
    var fullBtn = '<button type="button" id="viewerFullBtn" class="viewer-tool" data-act="toggleViewerFull" ' +
      'title="' + (state.viewerFull ? "원래 크기로 (Esc)" : "전체화면") + '">' +
      (state.viewerFull ? ICONS.minimize : ICONS.maximize) + '</button>';
    // 준비 중에는 아직 동작하지 않는 형광펜·배율 버튼을 진짜 버튼처럼 내지 않는다.
    // 대신 같은 폭의 뼈대를 두어 PDF가 열린 뒤에도 헤더 배치가 움직이지 않게 한다.
    var pendingTools = pending && showPdf
      ? '<span class="viewer-pending-tools" aria-hidden="true">' +
          '<span class="skel" style="width:42px;"></span>' +
          '<span class="skel" style="width:58px;"></span>' +
          '<span class="skel" style="width:96px;"></span>' +
          '<span class="skel" style="width:28px;"></span></span>'
      : "";
    return '<div style="flex:none;padding:10px 16px;display:flex;justify-content:space-between;align-items:center;gap:10px;border-bottom:1px solid var(--line);">' +
      '<span style="display:flex;align-items:center;gap:4px;min-width:0;font-size:12px;font-weight:600;color:var(--text-2);"><span style="flex:none;">' + docShapeIcon(docName, 16, "accent") + '</span>' +
        '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(docName) + '</span></span>' +
      '<span style="flex:none;display:flex;align-items:center;gap:8px;">' +
        (pendingTools || (viewerWhere + markBtn + viewerToggle + fullBtn)) + '</span>' +
    '</div>' + sourceNote;
  }

  // 결과 화면의 2단 행(문서 뷰어 + "검토 결과" 패널). 전체화면이면 이 **행**을
  // 화면 전체로 덮어 사이드바·상단 헤더·백링크 바를 가린다.
  //
  // 덮는 대상이 문서 카드가 아니라 행인 게 핵심이다. 카드만 덮으면 문서는 커지지만
  // 지적 목록이 사라져, 정작 "지적이 문서 어디냐"를 보려던 사람이 둘을 번갈아 봐야
  // 한다. 행을 덮으면 패널이 남는데도 문서는 거의 안 작아진다 — PDF 카드는
  // aspect-ratio로 높이에서 폭을 정하므로, 오른쪽 400px은 어차피 남던 좌우 여백에서
  // 빠질 뿐이다.
  //
  // 전체화면을 **제자리 스타일 변경**으로만 구현하는 것도 핵심이다. 노드를 body 밑으로
  // 옮겨 띄우는 흔한 방법을 쓰면 안 된다 — iframe은 DOM에서 옮기는 순간 브라우저가
  // 문서를 다시 읽어서(app.js makePdfFrame 위 주석) 읽던 쪽을 잃는다. position:fixed는
  // 시각적으로만 흐름에서 빼내므로 리로드가 없고, 조상에 걸어도 마찬가지다.
  //
  // app.js의 toggleViewerFull도 이 함수로 cssText를 통째로 갈아끼운다. 개별 속성을
  // 지웠다 폈다 하면(style.position = "") 원래 인라인 값까지 날아간다.
  function resultsRowCss(full) {
    // z-index는 "검토 결과" 패널(10)·내보내기 메뉴(120)보다 위여야 셸을 다 덮는다.
    // 배경을 깔지 않으면 가린 사이드바·헤더가 비쳐 보인다.
    if (full) return "display:flex;position:fixed;inset:0;z-index:300;background:var(--bg);";
    return "display:flex;flex:1;min-height:0;width:100%;";
  }

  // 기준 고르기(칩). 비교 화면에는 이게 아예 없어서 서버 기본값에 갇혀 있었다 —
  // 추적성은 체크리스트의 id_pattern에 전부 기대므로 가장 위험한 구멍이었다.
  // 비교 검토의 기준 표시(표시 전용). 비교가 기준에서 실제로 쓰는 것은 요건 ID
  // 형식(추적성 매개변수)뿐이고, 어느 팀 기준을 쓸지는 소속 팀(프로필)·자동
  // 감지가 정한다 — 화면에서 손으로 고르는 칩은 없앴다. 남의 팀 기준으로 재는
  // 실수(실측: AX 문서를 시험인증팀 잣대로 검토)의 입구였다.
  // 줄 자체를 없애지 않는 이유: 이 형식이 어디서 왔는지, 없어서 추적성이 안
  // 도는 상태인지를 돌리기 **전에** 화면이 말해야 한다. 요건 ID 감지 개수는
  // 이제 슬롯마다 보여준다(slotDetectLine) — 상·하위 둘 다에서 찾아야 추적
  // 대조가 돌기 때문에, 마지막 파일 것 하나만 말하는 전역 띠로는 모자랐다.
  function compareCriteriaLine(v) {
    var sel = null;
    v.checklistCards.forEach(function (c) { if (c.sel) sel = c; });
    var text = sel
      ? '요건 ID 형식 출처: <b>' + esc(sel.name) + '</b> 기준 — 소속 팀·자동 감지로 적용됩니다.'
      : '적용할 팀 기준이 없습니다 — 요건 ID 형식이 없어 추적성 검사가 돌지 않습니다. 설정에서 소속 팀을 지정하세요.';
    return '<div style="margin-top:16px;font-size:12px;color:var(--text-2);">' + text + '</div>';
  }

  function compareSetup(v) {
    // 슬롯별 요건 ID 감지 상태. 추적 대조는 양쪽 문서 모두에서 ID 를 찾아야
    // 도는데, 이걸 문서마다 보여주지 않으면 "0개짜리 문서"를 넣고 돌린 뒤에야
    // 헛돈 것을 안다. "0개"와 "아직 모름"은 다른 상태다 — 섞지 않는다.
    function slotDetectLine(slot) {
      var d = v.cslotDetect[slot];
      if (!d) return '';
      var body;
      if (d.busy) {
        body = '<span style="display:inline-block;animation:spin 1s linear infinite;">' + ICONS.refresh + '</span> 요건 ID 감지 중…';
      } else if (d.error) {
        body = '<span style="color:var(--text-3);">요건 ID 감지 실패 — 검토는 가능하지만 개수를 미리 확인하지 못했습니다.</span>';
      } else if (d.unknown) {
        body = '<span style="color:var(--text-3);">기준을 고르면 요건 ID 개수를 잽니다.</span>';
      } else if (!d.scored) {
        body = '<span style="color:var(--text-3);">현재 기준에 요건 ID 형식이 없어 이 문서를 잴 수 없습니다.</span>';
      } else if (d.count === 0) {
        body = '<span style="color:var(--sev-maj-fg);font-weight:600;">요건 ID 0개 — 이 문서는 추적 대조에서 아무것도 못 찾습니다. 기준(ID 형식)이 맞는지 확인하세요.</span>';
      } else {
        body = '<span style="color:var(--band-good-fg);">' + ICONS.check + '</span> 요건 ID <b>' + d.count + '개</b> 감지' +
          (d.example ? ' <code style="color:var(--text-3);">' + esc(d.example) + '</code>' : '');
      }
      return '<div style="margin-top:8px;font-size:12px;line-height:1.4;color:var(--text-2);display:flex;align-items:center;gap:6px;">' + body + '</div>';
    }
    // 라벨을 둘로 나눈다. 예전엔 "상위 문서 — 근거가 되는 쪽 (예: 요구사항명세서)"
    // 전부가 11px 꼬리표 한 줄이었다 — 이 화면에서 **가장 먼저 읽어야 할 말**인데
    // 화면에서 가장 작고 흐린 글씨였다(2026-09-02 지적). 무엇을 넣는 칸인지는
    // 굵게 크게, 왜 그런지는 조용히. 위계는 크기·굵기가 만든다.
    // 예시는 **이 문서에서 실제로 찾은 ID** 로 낸다. 지어낸 예(RQ-AA-001)는
    // 자기 문서와 안 닮아 "우리 건 이런 게 아닌데"로 읽힌다. 못 찾았으면
    // 형식만 말하고 값은 안 지어낸다.
    // 요건 ID 의 구조. "조각을 적으라"는 말은 조각이 무엇인지 알아야 통한다 —
    // 기준이 사람 말로 적어 둔 구조(id_format)와 예시를 나란히 보여준다. 기준에
    // 없으면 안 그린다(지어내지 않는다). 어느 슬롯이든 같은 기준이라 하위 쪽을 본다.
    // 문서를 올리기 전에도 보인다 — 구조는 문서가 아니라 **기준**의 것이라
    // 서버가 지금 적용 중인 기준(state.server, /api/health)에서 바로 읽는다.
    function idInfo(v) {
      var d = v.cslotDetect.compareB || v.cslotDetect.compareA || {};
      var srv = state.server || {};
      return { format: d.format || srv.id_format || "",
               example: d.example || srv.id_example || "" };
    }
    function idFormatLine(v) {
      var info = idInfo(v);
      if (!info.format) return "";
      return '<div style="margin-top:6px;font-size:12px;color:var(--text-2);line-height:1.6;">' +
        '요건 ID 구조: <span class="mono">' + esc(info.format) + '</span>' +
        (info.example ? ' · 예 <code>' + esc(info.example) + '</code>' : '') + '</div>';
    }
    // "조각"이 무엇인지 예시 ID 의 가운데 토막으로 보여준다(RQ-SFR-PR-01-001 → PR).
    // 정규식 표기([13] 같은 것)는 안 쓴다 — 검토자가 읽을 말이 아니다. 실제로는
    // 두 문서를 올리면 후보 버튼이 뜨므로 직접 칠 일이 드물다(scopeCalc).
    function scopePieceExample(v) {
      var parts = idInfo(v).example.split("-");
      if (parts.length < 4) return "";
      var piece = parts[2];
      return ' 예: ID 마다 <code>' + esc(piece) + '</code> 이 들어 있으면 <code>-' + esc(piece) + '-</code>';
    }
    function scopeHint(v) {
      var d = v.cslotDetect.compareB;
      var ex = d && d.example;
      if (!ex) return "맡은 요건 ID 의 한 조각 (예: -01-)";
      var i = ex.lastIndexOf("-");
      return "예: " + (i > 0 ? ex.slice(0, i) : ex) + " — 이 문서에서 찾은 ID 를 줄인 것";
    }


    function docSlot(title, desc, slot, file) {
      // 높이를 고정한다 — 파일이 붙으면 컴팩트 행으로 줄어 옆 슬롯과 키가
      // 어긋났고, 드롭 가능한 영역도 그만큼 좁아졌다. 단일 검토와 같은 big
      // 드롭존을 쓰고, 전·후 모두 같은 상자를 채운다.
      return '<div style="flex:1;min-width:0;">' +
        '<div style="margin-bottom:12px;">' +
          '<div style="font-size:15px;font-weight:700;color:var(--text);letter-spacing:var(--tr-body);">' + esc(title) + '</div>' +
          '<div style="margin-top:2px;font-size:13px;font-weight:500;line-height:1.4;color:var(--text-3);">' + esc(desc) + '</div>' +
        '</div>' +
        '<div style="height:280px;">' + dropzone({ slot: slot, file: file, big: true }) + '</div>' +
        slotDetectLine(slot) +
      '</div>';
    }
    return '<div class="page-shell page-shell-primary" data-scroll="csetup">' +
      '<div class="page-container page-stack">' +
        errorBanner(v.cerror) +
        pageHead("문서 비교",
                 "맞대어 볼 문서 두 개를 올리세요. 상위 요건이 하위 문서에 반영됐는지, " +
                 "빠진 것과 근거 없는 것을 찾습니다.") +
        '<div class="setup-panel">' +
          '<div style="display:flex;gap:32px;align-items:center;">' +
            docSlot("상위 문서", "근거가 되는 쪽 · 예: 요구사항명세서", "compareA", v.files.compareA) +
            '<div style="flex:none;width:56px;height:56px;border-radius:50%;background:var(--bg);border:2px solid var(--line);display:flex;align-items:center;justify-content:center;color:var(--accent-ink);font-size:24px;box-shadow:var(--sh-2);">' + ICONS.arrowLeftRight + '</div>' +
            docSlot("하위 문서", "상위를 구현한 쪽 · 예: 상세설계서", "compareB", v.files.compareB) +
          '</div>' +
          compareCriteriaLine(v) +
          // "담당 요건 범위"가 무슨 말인지 모르겠다는 지적(2026-09-02). 이름은
          // 데이터 종류를 말하고 있었고(범위·패턴), 정작 **무엇이 달라지는지**는
          // 안 말했다. 게다가 예시가 정규식(RQ-[A-Z]+-PR-01)이라 그걸 쓸 줄 아는
          // 사람만 채울 수 있었다 — 앞부분만 적어도 그대로 통한다.
          // 감지된 요건 ID 가 있으면 그 문서의 **진짜 ID** 를 예로 보여준다.
          '<div style="margin-top:16px;">' +
            '<div style="margin-bottom:8px;">' +
              '<span style="font-size:13px;font-weight:700;color:var(--text);">이 하위 문서가 맡은 요건만 검사</span>' +
              '<span style="margin-left:6px;font-size:12px;font-weight:500;color:var(--text-3);">선택</span>' +
            '</div>' +
            '<input data-cscope value="' + esc(state.cscope || "") + '" ' +
              'placeholder="' + esc(scopeHint(v)) + '" ' +
              'style="width:100%;padding:8px 12px;font-size:14px;border:1px solid var(--line);border-radius:var(--r-sm);background:var(--bg);color:var(--text);box-sizing:border-box;">' +
            scopeCalc(v) +
            idFormatLine(v) +
            // 줄글 한 덩어리는 안 읽힌다(2026-09-07 지적). 상황 둘 → 할 일 둘로 가른다.
            '<ul style="margin:8px 0 0;padding-left:18px;font-size:12px;color:var(--text-3);line-height:1.6;">' +
              '<li>이 설계서가 요구사항 <b style="color:var(--text-2);">전체</b>를 다루면 → 비워 두세요.</li>' +
              '<li><b style="color:var(--text-2);">일부</b>만 맡았으면 → 맡은 요건 ID 에 공통인 조각을 적으세요.' +
                scopePieceExample(v) + '<br>남의 몫까지 "누락"으로 세지 않게 됩니다.</li>' +
              '<li>어느 조각이 담당 단위인지는 과제 계획서의 산출물 분담표가 정합니다.</li>' +
            '</ul>' +
          '</div>' +
          '<div style="display:flex;justify-content:flex-end;align-items:center;margin-top:18px;">' +
            // 두 문서가 다 있어야 버튼이 열린다(단일·폴더와 같은 관용구).
            // 슬롯이 둘이라, 그 전에는 무엇이 남았는지 조용히 말해준다.
            (v.files.compareA && v.files.compareB
              ? '<button class="btn btn-lg btn-primary" data-act="startCompare" style="' + readyAnim(v) + '">비교 시작 ' + ICONS.arrowRight + '</button>'
              : '<span style="font-size:12px;color:var(--text-3);">상위·하위 문서를 모두 올리면 비교를 시작할 수 있습니다</span>') +
          '</div>' +
        '</div>' +
        recentSection("compare", "비교 검토") +
      '</div>' +
    '</div>';
  }


  // 체크리스트 검토 업로드. 비교 검토와 같은 두 칸이지만 오른쪽은 문서가 아니라
  // 팀 평가 체크리스트 xlsx 다 — 시트가 곧 "어느 단계·어느 표준으로 볼 것인가"라
  // 올리면 시트 목록을 보여주고 하나를 고르게 한다.
  function evaluateSetup(v) {
    var ev = v.evalv || {};
    var f = v.files || {};
    var sheets = ev.sheets || [];
    var picked = sheets.filter(function (s) { return s.index === ev.sheetIndex; })[0];
    var needKind = !!(picked && (picked.documents || []).length);
    var canStart = !!(f.evalDoc && f.evalSheet && picked && !picked.error && !ev.busy &&
                      (!needKind || ev.documentKind));
    function slot(title, desc, key, file, accept) {
      return '<div style="flex:1;min-width:0;">' +
        '<div style="margin-bottom:12px;">' +
          '<div style="font-size:15px;font-weight:700;color:var(--text);letter-spacing:var(--tr-body);">' + esc(title) + '</div>' +
          '<div style="margin-top:2px;font-size:13px;font-weight:500;line-height:1.4;color:var(--text-3);">' + esc(desc) + '</div>' +
        '</div>' +
        '<div style="height:280px;">' + dropzone({ slot: key, file: file, big: true, accept: accept }) + '</div>' +
      '</div>';
    }
    var sheetList = "";
    if (ev.busy && !sheets.length) {
      // 읽는 동안도 같은 통(sheet-book) 모양으로 — 빈 격자 뼈대 + 탭 자리 뼈대 + 돌아가는
      // 표시. 글자 한 줄만 있으면 멈춘 것처럼 보였다(2026-09-17). 서버 쪽은 0.3초지만
      // 검토 작업과 겹치면 수 초가 걸린다.
      var skelRows = "";
      for (var r = 0; r < 5; r++) {
        skelRows += '<tr><td class="sheet-peek-no">' + (r + 1) + '</td>' +
          '<td colspan="6"><span class="draft-skel" style="width:' + (40 + ((r * 23) % 45)) + '%;"></span></td></tr>';
      }
      sheetList = '<div style="margin-top:16px;">' +
        '<div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:8px;">시트 선택 ' +
          '<span style="font-weight:500;color:var(--text-3);">— 체크리스트의 시트를 읽는 중</span></div>' +
        '<div class="sheet-book is-busy" aria-busy="true">' +
          '<div class="sheet-peek-band"><span style="display:inline-block;animation:spin 1s linear infinite;">' + ICONS.refresh + '</span> ' +
            '시트를 읽는 중… <span class="mono" id="eval-sheets-elapsed"></span></div>' +
          '<div class="sheet-peek-scroll"><table class="sheet-peek"><tbody>' + skelRows + '</tbody></table></div>' +
          '<div class="sheet-tabs">' +
            '<span class="sheet-tab is-skel"></span><span class="sheet-tab is-skel"></span><span class="sheet-tab is-skel"></span>' +
          '</div>' +
        '</div>' +
      '</div>';
    } else if (sheets.length) {
      // 엑셀처럼 보이게 — 고른 시트의 앞 몇 행이 격자로 뜨고, 그 아래 엑셀 하단
      // 탭 모양의 시트 탭이 줄지어 있다(2026-09-17 요청). 항목 수 목록만으로는
      // "어느 시트인지" 감이 안 왔다. 읽을 수 없는 시트도 탭으로 남기고 이유를
      // 툴팁·격자 자리에 적는다 — 빼면 "왜 내 시트가 없지"가 된다.
      // 격자는 **올린 파일 그대로**다 — 서버가 앞 8행×8열을 정리하지 않고 잘라 준다.
      // 열 글자(A, B, …)와 행 번호를 붙여 엑셀 첫 화면처럼 그린다. 읽을 수 없는
      // 시트도 그대로 보여 주고 이유를 위에 띠로 단다 — 헤더가 왜 다른지 눈으로 안다.
      var peek;
      if (!picked) {
        peek = '<div class="sheet-peek-empty">읽을 수 있는 시트가 없습니다.</div>';
      } else {
        var raw = picked.rows || [];
        var ncol = raw.reduce(function (m, r) { return Math.max(m, r.length); }, 0);
        var letters = [];
        for (var ci = 0; ci < ncol; ci++) letters.push(String.fromCharCode(65 + ci));
        var grid = raw.length
          ? '<div class="sheet-peek-scroll"><table class="sheet-peek">' +
              '<thead><tr><th class="sheet-peek-no"></th>' +
                letters.map(function (L) { return '<th>' + L + '</th>'; }).join("") + '</tr></thead>' +
              '<tbody>' + raw.map(function (r, i) {
                var cells = letters.map(function (_L, c) {
                  var t = r[c] || "";
                  return '<td' + (t ? "" : ' class="sheet-peek-blank"') + '>' + esc(t) + '</td>';
                }).join("");
                return '<tr><td class="sheet-peek-no">' + (i + 1) + '</td>' + cells + '</tr>';
              }).join("") +
              '</tbody></table></div>'
          : '<div class="sheet-peek-empty">미리 볼 내용이 없습니다 — 체크리스트를 다시 올려 보세요.</div>';
        var band = picked.error
          ? '<div class="sheet-peek-band is-dead">읽을 수 없음 — ' + esc(picked.error) + '</div>'
          : '<div class="sheet-peek-band">' + picked.item_count + '개 항목' +
              (picked.documents && picked.documents.length ? ' · 문서 ' + picked.documents.length + '종' : '') + '</div>';
        peek = band + grid;
      }
      sheetList = '<div style="margin-top:16px;">' +
        '<div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:8px;">시트 선택 <span style="font-weight:500;color:var(--text-3);">— 검토 단계·표준에 맞는 시트 하나. 아래 탭을 누르세요</span></div>' +
        '<div class="sheet-book">' + peek +
          '<div class="sheet-tabs" role="tablist">' +
          sheets.map(function (s) {
            var on = s.index === ev.sheetIndex;
            return '<button type="button" data-act="setEvalSheet" data-arg="' + s.index + '" ' +
              'role="tab" aria-selected="' + (on ? "true" : "false") + '" ' +
              'class="sheet-tab' + (on ? " is-on" : "") + (s.error ? " is-dead" : "") + '"' +
              (s.error ? ' title="읽을 수 없음 — ' + esc(s.error) + '" aria-disabled="true"' : ' title="' + s.item_count + '개 항목"') + '>' +
              esc(s.label) + '</button>';
          }).join("") + '</div>' +
        '</div>' +
        (needKind
          ? '<div style="margin-top:12px;">' +
              '<div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:6px;">문서 종류 <span style="font-weight:500;color:var(--text-3);">— 이 시트는 문서마다 행이 갈린다</span></div>' +
              // 앱 공용 셀렉트. 고른 값은 selPick 의 evalDocKind 분기가 state 에 넣는다
              // (단일 검토의 outputKey 와 같은 길) — 내려받기·드롭다운이 둘로 갈리지 않게.
              '<div style="min-width:0;max-width:280px;">' +
                selectField("evalDocKind", "문서 종류를 고르세요",
                  picked.documents.map(function (d) { return { id: d, name: d }; }),
                  { value: ev.documentKind || "", ariaLabel: "문서 종류" }) +
              '</div>' +
            '</div>'
          : "") +
      '</div>';
    }
    return '<div class="page-shell page-shell-primary" data-scroll="esetup">' +
      '<div class="page-container page-stack">' +
        errorBanner(ev.error) +
        pageHead("체크리스트 검토",
                 "검토 대상 문서와 과제 평가 체크리스트를 올리세요. 항목마다 문서에서 근거를 찾아 " +
                 "평가표 초안을 만듭니다 — 판정은 검토자가 합니다.") +
        '<div class="setup-panel">' +
          '<div style="display:flex;gap:32px;align-items:flex-start;">' +
            slot("검토 대상 문서", "SRS·SDD 등 · pdf / docx / hwpx", "evalDoc", f.evalDoc, null) +
            slot("과제 평가 체크리스트", "IS22 평가 체크리스트 같은 xlsx", "evalSheet", f.evalSheet, ".xlsx") +
          '</div>' +
          sheetList +
          // 단일·비교와 같은 관용구: 입력이 다 갖춰져야 큰 버튼이 **나타난다**(2026-09-01 합의 —
          // 빈 채로 누를 수 있는 잠긴 버튼보다 단계가 열리는 쪽이 낫다). 그 전에는 무엇이
          // 남았는지 한 줄로 말한다.
          '<div style="display:flex;justify-content:flex-end;align-items:center;margin-top:18px;">' +
            (canStart
              ? '<button class="btn btn-lg btn-primary" data-act="startEvaluate" style="' + readyAnim(v) + '">초안 만들기 ' + ICONS.arrowRight + '</button>'
              : '<span style="font-size:12px;color:var(--text-3);">' +
                  esc(!f.evalDoc ? "검토 대상 문서를 올리면 초안을 만들 수 있습니다"
                    : !f.evalSheet ? "평가 체크리스트(xlsx)를 올리면 초안을 만들 수 있습니다"
                    : ev.busy ? "시트를 읽는 중…"
                    : !picked || picked.error ? "읽을 수 있는 시트를 고르면 초안을 만들 수 있습니다"
                    : needKind ? "문서 종류를 고르면 초안을 만들 수 있습니다"
                    : "초안을 만들 수 있습니다") + '</span>') +
          '</div>' +
        '</div>' +
        // 단일·비교·폴더 업로드 화면과 같은 자리. kind 는 "evaluation" 이다 —
        // "checklist" 는 체크리스트를 사람이 직접 채우는 다른 기능이라 섞으면
        // 남의 기록이 여기 뜬다(src/app/history.py 의 kind 목록).
        recentSection("evaluation", "체크리스트 검토") +
      '</div>' +
    '</div>';
  }

  // 서버가 흘리는 키(ingestion·draft·report)와 화면 이름. 서버가 쓰는 키 그대로다.
  var EVAL_STAGES = [["ingestion", "문서 파싱"], ["draft", "작성중"], ["report", "마무리"]];

  // 서버 detail "항목 n/N" → {n, total}. 다른 문구(끝났을 때 "항목 49건 · …")면 null.
  function draftCount(detail) {
    var m = /항목\s+(\d+)\s*\/\s*(\d+)/.exec(String(detail || ""));
    return m ? { n: Number(m[1]), total: Number(m[2]) } : null;
  }

  // 작성중 종이: 부록 B 표 모양에 **진짜 초안이** 한 줄씩 써진다. 서버가 항목이
  // 끝날 때마다 그 행(ID·항목 문장·판정·문장)을 실어 보내고(api.js 가
  // state.evalv.written 에 모은다), 화면은 가장 최근 행을 타자 치듯 한 글자씩 쓴다.
  // 끝난 행은 문장이 다 보이고 판정 알약이 찍힌다. 아직 안 온 항목은 흐린 뼈대다.
  // 행은 항목 순서(i)로 놓고, 최근 행 둘레 여덟 줄만 창처럼 보여 준다.
  var DRAFT_WINDOW = 8;
  // 알약 색은 결과 화면의 행 알약과 같은 토큰을 쓴다(둘이 다르면 같은 판정이 다른 색이 된다).
  function draftRowPill(r) {
    if (r.status === "drafted") {
      return countPill("제안 " + (r.verdict || ""), r.verdict === "Satisfied" ? "band-good" : "sev-min");
    }
    return r.status === "unreviewed" ? countPill("검토 못 함", "sev-maj") : countPill("근거 없음", "sev-info");
  }
  // 타자기 상태는 **행 번호**로 잰다(요소로 잡지 않는다). 항목이 끝날 때마다 종이를
  // 다시 그리므로 요소는 매번 새것이다 — 번호별로 "몇 글자까지 썼나(pos)"와 "다 썼나
  // (done)"만 기억하고, 틱마다 그 번호의 요소를 다시 찾아 쓴다. 다시 그려도 이어서 쳐진다.
  var _typer = { timer: null, cur: -1, queue: [], pos: {}, done: {} };
  var TYPE_BACKLOG = 2;
  function draftTypingText(r) {
    if (_typer.done[r.i]) return null;                 // null = 다 쓴 행
    return (r.comment || "").slice(0, _typer.pos[r.i] || 0);
  }
  function draftRowHtml(r, partial) {
    var text = r.comment || "";
    var typing = partial !== null;
    // 커서는 지금 치는 행 하나만. 줄 선 행은 항목 문장만 보이고 칸은 비어 있다(커서 여럿 금지).
    var cls = !typing ? "is-done" : (r.i === _typer.cur ? "is-now" : "is-queued");
    return '<div class="draft-row ' + cls + '" data-row="' + r.i + '">' +
      '<span class="draft-cell draft-id" title="' + esc(r.id) + '">' + (r.i + 1) + '</span>' +
      '<span class="draft-cell draft-item">' + esc(r.item || "") + '</span>' +
      '<span class="draft-cell draft-comment">' +
        '<span class="draft-text" data-full="' + esc(text) + '">' + esc(typing ? partial : text) + '</span>' +
        '<span class="draft-pill"' + (typing ? ' hidden' : '') + '>' + draftRowPill(r) + '</span>' +
      '</span>' +
    '</div>';
  }
  // live=false(전체 렌더)면 온 행을 다 쓴 채로, live=true(patch)면 타자 진행 상태대로.
  function draftPaperRows(written, total, live) {
    if (!total) return "";
    var byIndex = {};
    (written || []).forEach(function (r) { byIndex[r.i] = r; });
    // 창은 **끝난 행 수** 기준으로 잡는다(단조 증가라 앞으로만 간다). 동시 실행이라 행이
    // 뒤섞여 오는데, 방금 온 행이나 가장 앞선 번호 기준이면 창이 튄다(실측 2026-09-17).
    var n = (written || []).length;
    var start = Math.max(0, Math.min(n - 5, total - DRAFT_WINDOW));
    var end = Math.min(total, start + DRAFT_WINDOW);
    var out = "";
    for (var i = start; i < end; i++) {
      var r = byIndex[i];
      if (r) { out += draftRowHtml(r, live ? draftTypingText(r) : null); continue; }
      out += '<div class="draft-row is-todo" data-row="' + i + '">' +
        '<span class="draft-cell draft-id">' + (i + 1) + '</span>' +
        '<span class="draft-cell draft-item"><span class="draft-skel" style="width:' + (55 + ((i * 37) % 40)) + '%;"></span></span>' +
        '<span class="draft-cell draft-comment"><span class="draft-skel" style="width:60%;"></span></span>' +
      '</div>';
    }
    if (end < total) out += '<div class="draft-row is-more">⋮ ' + (total - end) + '개 더</div>';
    return out;
  }

  // 온 행은 줄을 서고 한 행씩 쳐진다. 서버가 화면보다 빠르면(실측: 행이 0.7초마다, 타자는
  // 행당 2초) 줄이 길어지므로 셋 이상 밀리면 오래된 것부터 단번에 끝내 따라잡는다.
  // 타이머는 api.js 의 공유 timers 와 따로 둔다(그쪽 정리에 안 휘말리게).
  function draftQueueRow(r) {
    if (_typer.done[r.i] || _typer.cur === r.i || _typer.queue.indexOf(r.i) >= 0) return;
    _typer.queue.push(r.i);
    while (_typer.queue.length > TYPE_BACKLOG) draftFinishRow(_typer.queue.shift());
    if (_typer.cur < 0) draftTypeNext();
  }
  function draftRowEl(i) {
    return typeof document === "undefined" ? null : document.querySelector('#eval-draft-rows .draft-row[data-row="' + i + '"]');
  }
  function draftTypeNext() {
    if (_typer.timer) { clearTimeout(_typer.timer); _typer.timer = null; }
    var i = _typer.queue.shift();
    if (i === undefined) { _typer.cur = -1; return; }
    _typer.cur = i;
    var el = draftRowEl(i);
    var span = el && el.querySelector(".draft-text");
    var full = span ? span.getAttribute("data-full") || "" : "";
    var reduce = typeof window !== "undefined" && window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!span || !full || reduce) { draftFinishRow(i); draftTypeNext(); return; }
    (function step() {
      var k = Math.min(full.length, (_typer.pos[i] || 0) + 1 + ((_typer.pos[i] || 0) % 3 === 0 ? 1 : 0));
      _typer.pos[i] = k;
      var now = draftRowEl(i), sp = now && now.querySelector(".draft-text");
      if (sp) sp.textContent = full.slice(0, k);            // 다시 그려졌어도 새 요소에 이어 쓴다
      if (k < full.length) _typer.timer = setTimeout(step, 14);
      else { _typer.timer = null; draftFinishRow(i); draftTypeNext(); }
    })();
  }
  function draftFinishRow(i) {
    _typer.done[i] = true;
    if (_typer.cur === i) { if (_typer.timer) clearTimeout(_typer.timer); _typer.timer = null; _typer.cur = -1; }
    var el = draftRowEl(i);
    if (!el) return;
    var span = el.querySelector(".draft-text");
    if (span) span.textContent = span.getAttribute("data-full") || "";
    var pill = el.querySelector(".draft-pill");
    if (pill) pill.hidden = false;
    el.classList.remove("is-now"); el.classList.add("is-done");
  }
  function draftTyperReset() {
    if (_typer.timer) clearTimeout(_typer.timer);
    _typer = { timer: null, cur: -1, queue: [], pos: {}, done: {} };
  }

  // 진행 캡션 — 방금 끝난 행의 ID.
  function draftBubble(written, cnt) {
    var last = written.length ? written[written.length - 1] : null;
    if (!cnt.total || !last) return "";
    return "방금 쓴 항목 " + last.id;
  }

  // 체크리스트 검토 진행 — 단일·비교 검토와 **같은 틀**(progressFrame: 머리말·단계 목록·
  // 설정 접힘). 한 화면만 다르게 생기면 그게 튄다(2026-09-17). 이 화면 고유한 것은 단계
  // 목록 아래의 두 장면뿐이다: 파싱 때 올린 PDF 쪽 넘김, 작성중 때 실제 초안이 써지는 종이.
  var EVAL_STAGE_DESC = {
    ingestion: "문서를 절 단위로 읽어 둡니다. 스캔 문서는 OCR 때문에 수 분 걸릴 수 있습니다.",
    draft: "항목마다 문서에서 근거를 찾아 대조하고 한 줄씩 씁니다.",
    report: "초안을 묶어 기록에 남기고 엑셀을 준비합니다."
  };
  // 지난 렌더에서 완료였던 단계들. renderVals 의 doneStage 와 같은 역할인데,
  // 이 화면은 단계가 인덱스가 아니라 키별 상태라 집합으로 비교한다.
  // runKey(startedAt)를 같이 들고 있어야 하는 이유: **이 검토를 전에도 그린 적이
  // 있어야만** "방금 끝났다"를 말할 수 있다. 안 그러면 이미 끝난 검토를 기록에서
  // 다시 열 때 첫 렌더에서 완료 단계가 전부 한꺼번에 그어진다.
  var prevEvalDone = {}, prevEvalRun = null;
  function evalPipeline(stage, detail, runKey) {
    var seen = runKey != null && runKey === prevEvalRun;
    var seenRunning = false;
    var nowDone = {};
    var rows = EVAL_STAGES.map(function (s) {
      var st = stage[s[0]] || "";
      var active = st === "running" && !seenRunning;
      if (active) seenRunning = true;
      // 서버의 running 문구("문서 파싱 중 — …")는 설명(desc)과 같은 말이라 한 번만 보인다.
      var det = detail[s[0]] || "";
      if (st === "running" && s[0] === "ingestion") det = "";
      var done = st === "done";
      if (done) nowDone[s[0]] = true;
      return { key: s[0], label: s[1], desc: EVAL_STAGE_DESC[s[0]], detail: det,
               done: done, active: active,
               justDone: done && seen && !prevEvalDone[s[0]],
               statusLabel: done ? "완료" : (st === "running" ? "진행 중" : "대기") };
    });
    prevEvalDone = nowDone;
    prevEvalRun = runKey;
    // 이번 렌더에서 한 단계가 닫혔으면 진행 중인 단계가 방금 열린 것이다.
    if (rows.some(function (r) { return r.justDone; })) {
      rows.forEach(function (r) { if (r.active) r.justOpened = true; });
    }
    return rows;
  }
  function evaluateSettingsPanel(v) {
    var ev = v.evalv || {}, f = v.files || {};
    var row = function (label, value) {
      return '<div style="display:flex;gap:10px;padding:4px 0;font-size:12px;">' +
        '<span style="flex:none;width:52px;color:var(--text-3);">' + esc(label) + '</span>' +
        '<span class="mono" style="min-width:0;color:var(--text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(value) + '</span></div>';
    };
    var picked = (ev.sheets || []).filter(function (x) { return x.index === ev.sheetIndex; })[0];
    var ai = state.llm === "on"
      ? shortModel(state.server && (state.server.llm_label || state.server.llm_model)) + " · 사내"
      : "끔";
    return '<aside class="progress-settings">' +
      '<h3 class="progress-settings-title">이번 검토 설정</h3>' +
      '<p class="progress-settings-sub">시작할 때 확정된 읽기 전용 설정입니다.</p>' +
      '<div style="padding:10px 0;border-top:1px solid var(--line-2);">' +
        '<div style="font-size:12px;font-weight:600;color:var(--text-2);margin-bottom:4px;">입력</div>' +
        row("문서", (f.evalDoc && f.evalDoc.name) || "") +
        row("체크리스트", (f.evalSheet && f.evalSheet.name) || "") +
        row("시트", picked ? picked.label + (picked.item_count ? " · " + picked.item_count + "개 항목" : "") : "") +
        (ev.documentKind ? row("문서 종류", ev.documentKind) : "") +
      '</div>' +
      '<div style="padding:10px 0;border-top:1px solid var(--line-2);">' +
        '<div style="font-size:12px;font-weight:600;color:var(--text-2);margin-bottom:6px;">AI 초안</div>' +
        '<div style="font-size:12px;color:var(--text-2);">' + esc(ai) + ' · 판정은 검토자가 합니다</div>' +
      '</div>' +
    '</aside>';
  }
  function evaluateProgress(v) {
    var ev = v.evalv || {};
    var stage = ev.stage || {}, detail = ev.detail || {};
    var drafting = stage.draft === "running";
    var cnt = draftCount(detail.draft) || { n: 0, total: 0 };
    // 진행률: 파싱은 한 단계, 작성중은 항목 비율, 마무리는 거의 끝.
    var pct = stage.report === "done" ? 100 : drafting && cnt.total ? Math.round(30 + cnt.n * 65 / cnt.total)
            : stage.ingestion === "done" ? 30 : 5;
    draftTyperReset();
    (ev.written || []).forEach(function (r) { _typer.done[r.i] = true; });
    var f = v.files || {};
    var elapsed = ev.startedAt ? fmtElapsed(Date.now() - ev.startedAt) + " 경과" : "시작하는 중";
    var head = progressHead(false, 0,
      // 부제는 한 줄짜리로 — 긴 설명(OCR 이 왜 오래 걸리나)은 단계 목록의 문서 파싱 행이
      // 이미 말한다. 같은 문장이 위아래 두 번 있으면서 위쪽은 한 줄을 넘쳤다(2026-09-17).
      drafting ? ["초안을 쓰고 있습니다", "항목마다 근거를 찾아 한 줄씩 씁니다"]
               : ["문서를 읽고 있습니다", "절 단위로 읽어 둡니다 — 스캔 문서는 수 분 걸립니다"],
      pct, 0, { elapsed: elapsed, elapsedId: "eval-elapsed", cancelAction: "cancelEvaluate",
        documents: [{ label: "문서", name: (f.evalDoc && f.evalDoc.name) || "" },
                    { label: "체크리스트", name: (f.evalSheet && f.evalSheet.name) || "" }],
        animateState: true, motionStartedAt: ev.startedAt, cancelLabel: "검토 취소" });
    // 이 화면 고유의 장면 — 단계 목록 아래에 붙는다(footer).
    var scene = drafting
      ? '<div class="draft-paper" id="eval-draft-paper">' +
          '<div class="draft-paper-head"><span class="draft-cell draft-id">#</span>' +
            '<span class="draft-cell draft-item">Evaluation Item</span>' +
            '<span class="draft-cell draft-comment">Evaluation result and Comment</span></div>' +
          '<div id="eval-draft-rows">' + draftPaperRows(ev.written || [], cnt.total, false) + '</div>' +
        '</div>' +
        '<div class="draft-progress"><div class="draft-progress-bar" id="eval-progress-bar" style="width:' + (cnt.total ? Math.round(cnt.n * 100 / cnt.total) : 0) + '%"></div></div>' +
        '<div class="mono" style="display:flex;gap:14px;font-size:12px;color:var(--text-3);">' +
          '<span id="eval-progress-count">' + cnt.n + ' / ' + cnt.total + ' 항목</span>' +
          '<span id="eval-type-bubble">' + esc(draftBubble(ev.written || [], cnt)) + '</span></div>'
      : '';
    return progressFrame({
      scroll: "eprogress",
      // 문서를 읽는 동안은 단일 검토와 같은 좁고 가운데인 카드다 — 그 동안에는
      // 단계 목록에 말할 것이 "읽는 중" 하나뿐이라, 넓은 판을 펴 두면 빈 표처럼
      // 보인다. 작성중부터 목록이 실제로 채워지므로 그때 넓은 판으로 내려온다.
      phase: stage.ingestion === "done" ? "reviewing" : "preparing",
      head: head,
      // 종이는 작성중 단계 행 바로 아래 — 그 단계의 상세로 읽힌다(단계 목록 밑에 따로
      // 붙이면 장식이 한 벌 더 있는 것처럼 보였다, 2026-09-17).
      main: '<div class="progress-stage-list">' + evalPipeline(stage, detail, ev.startedAt).map(function (st) {
        return timelineItem(st) + (st.key === "draft" && scene ? '<div class="eval-scene">' + scene + '</div>' : '');
      }).join("") + '</div>',
      settings: evaluateSettingsPanel(v)
    });
  }

  // 항목 하나가 끝날 때마다 화면을 통째로 다시 그리면 종이의 애니메이션이 매번
  // 처음부터 다시 시작해 덜컥거린다. 종이가 떠 있으면 행·막대·숫자만 바꾼다.
  // 바꿀 자리가 없으면(파싱→작성 전환 등) false 를 돌려 호출자가 render() 하게 한다.
  function patchEvaluateProgress(evalv) {
    if (typeof document === "undefined") return false;
    var paper = document.getElementById("eval-draft-rows");
    if (!paper || (evalv.stage || {}).draft !== "running") return false;
    var cnt = draftCount((evalv.detail || {}).draft);
    if (!cnt) return false;
    var written = evalv.written || [];
    paper.innerHTML = draftPaperRows(written, cnt.total, true);
    written.forEach(draftQueueRow);                    // 이미 줄 섰거나 끝난 행은 그대로
    var bar = document.getElementById("eval-progress-bar");
    if (bar) bar.style.width = (cnt.total ? Math.round(cnt.n * 100 / cnt.total) : 0) + "%";
    var num = document.getElementById("eval-progress-count");
    if (num) num.textContent = cnt.n + " / " + cnt.total + " 항목";
    var det = document.getElementById("eval-stage-draft");
    if (det) det.textContent = evalv.detail.draft || "";
    var bub = document.getElementById("eval-type-bubble");
    if (bub) bub.textContent = draftBubble(written, cnt);
    return true;
  }

  // 행이 무엇인지는 status 가 진다 — 사유 **문장**을 읽어 갈래를 정하지 않는다
  // (agent_generate 가 문구 한 글자만 바꾸면 조용히 틀린다). "0건 통과"와 "검토를
  // 못 했다"를 섞지 않는다. status 가 없는 옛 기록(2026-09-16 전)은 Not found 가
  // 둘을 함께 뜻했으므로 "검토 못 함" 으로 읽는다 — 통과로 보이게 두지 않는다.
  function rowStatus(r) {
    return r.status || (r.verdict_hint === "Not found" ? "unreviewed" : "drafted");
  }

  // 부록 B 표의 행 하나 — 열이 엑셀과 같아야 검토자가 둘을 맞춰 본다.
  // 원문은 셀 안 버튼이 연다(표에서는 그게 관례다). prev 는 바로 위 항목 —
  // 같은 분류면 칸을 비운다(엑셀의 병합 셀 느낌).
  function evaluateRow(it, r, prev, idx) {
    var st = rowStatus(r);
    // 숫자로 못 읽는 쪽수는 0 으로 떨어뜨린다 — 그대로 속성에 박으면 마크업이 샌다.
    var page = Number(((r.quotes || [])[0] || {}).page) || 0;
    var reason = r.reason || "";
    // 색은 이 알약에만 실린다 — 본문 글자에는 안 칠한다(2026-09-15 색 규칙).
    // 판정은 검토자 몫이라 언제나 "제안:" 을 달고, 편집 UI 는 두지 않는다.
    var pill = st === "drafted"
      ? countPill("제안: " + r.verdict_hint, r.verdict_hint === "Satisfied" ? "band-good" : "sev-min")
      : st === "unreviewed" ? countPill("검토 못 함", "sev-maj") : countPill("근거 못 찾음", "sev-info");
    var note = 'style="font-size:12px;color:var(--text-3);margin-top:4px;"';
    var body = st !== "drafted"
      ? '<div ' + note + '>' + esc((st === "unreviewed" ? "검토하지 못함" : "근거를 찾지 못함") +
          (reason ? " — " + reason : "") + " — 검토자 확인 필요") + '</div>'
      : (r.comment ? '<div style="margin-top:6px;">' + esc(r.comment) + '</div>' : '') +
        ((r.sections || []).length ? '<div ' + note + '>' + esc(r.sections.join(" · ")) + '</div>' : '') +
        (r.quotes || []).map(function (q) {
          return '<div class="single-evidence-quote"><mark class="sev-info">' + esc(q.quote) + '</mark>' +
            (q.page ? ' <span style="font-size:12px;color:var(--text-3);">' + q.page + '쪽</span>' : '') + '</div>';
        }).join("");
    // 인용에 쪽수가 있어야 갈 곳이 있다. 없으면 빈 칸으로 둔다 — 아무 일도
    // 안 하는 버튼을 놓지 않는다.
    // 쪽수 버튼은 **열린 원문 창 안에서** 이 행의 인용 자리로 옮긴다(창을 새로 띄우지 않는다 —
    // 머리의 "원문 ↗" 이 여는 길이다). arg = "E|행번호|쪽".
    var rowNo = Number(idx) >= 0 ? Number(idx) : "";
    var orig = page
      ? '<button type="button" class="lnk" data-act="evalRowOriginal" data-arg="E|' + rowNo + '|' + page +
        '" title="원문 창에서 ' + page + '쪽의 이 인용으로 이동">' + page + '쪽</button>'
      : '';
    var sameClass = !!prev && (prev.characteristic || "") === (it.characteristic || "");
    return '<tr>' +
      '<td>' + esc(sameClass ? "" : (it.characteristic || "")) + '</td>' +
      '<td>' + esc(sameClass && (prev.detail || "") === (it.detail || "") ? "" : (it.detail || "")) + '</td>' +
      '<td class="mono">' + esc(it.raw_id || it.id) + '</td>' +
      '<td>' + esc(it.item) + '</td>' +
      '<td>' + pill + body + '</td>' +
      '<td>' + orig + '</td>' +
    '</tr>';
  }

  function evaluateRows(v) {
    var p = (v.evalv || {}).payload || {};
    var items = p.items || [], rows = {};
    (p.rows || []).forEach(function (r) { rows[r.item_id] = r; });
    return items.map(function (it, i) {
      // 행이 없는 항목은 초안이 통째로 빠진 것이다 — 통과로 보이지 않게 미검토로 둔다.
      // i 는 항목 순번 — 원문 창의 형광펜 id("e<i>", app.js openEvalDoc)와 같은 번호다.
      return evaluateRow(it, rows[it.id] ||
        { verdict_hint: "Not found", status: "unreviewed",
          reason: "초안에 이 항목이 없습니다" }, items[i - 1], i);
    }).join("");
  }

  // 건수 알약. 색을 실어 나르는 유일한 자리다 — 문장에는 색을 안 칠한다.
  function countPill(label, tone) {
    return '<span style="display:inline-flex;align-items:center;font-size:12px;font-weight:600;' +
      'color:var(--' + tone + '-fg);background:var(--' + tone + '-bg);' +
      'padding:4px 10px;border-radius:var(--r-xl);white-space:nowrap;">' + esc(label) + '</span>';
  }

  // 부록 B 초안. 읽기 전용이다 — 검토자는 엑셀을 내려받아 워드 부록에 붙이고 거기서
  // 고친다(2026-09-16 결정). 화면에 뷰어를 박지 않는다 — 원문은 새 창이 연다.
  function evaluateResults(v) {
    var p = (v.evalv || {}).payload || {};
    var unfound = p.unfound || 0, unreviewed = p.unreviewed || 0;
    if (p.unreviewed === undefined) {
      // 옛 기록(2026-09-16 전)은 둘을 unfound 한 수에 섞어 저장했다 — 표와 머리가
      // 다른 말을 하지 않게 행 상태로 다시 센다.
      unfound = 0;
      (p.rows || []).forEach(function (r) {
        var st = rowStatus(r);
        if (st === "not_found") unfound++;
        else if (st === "unreviewed") unreviewed++;
      });
    }
    var saved = !!(p.history || {}).saved;
    var head =
      '<div class="issues-head" style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">' +
        '<div style="min-width:0;">' +
          '<div style="font-size:15px;font-weight:700;">평가표 초안</div>' +
          '<div style="font-size:12px;color:var(--text-3);margin-top:2px;line-height:1.4;">' +
            esc(p.sheet || "") + ' · 항목 ' + (p.items || []).length + '건 · 판정은 제안입니다' +
          '</div>' +
          // 색은 작은 알약에만(2026-09-15 결과 화면 색 규칙) — 본문 글자에는 안
          // 칠한다. 완전 알약이라 읽는 라벨이고 누르는 것이 아니다(index.html
          // .result-filter 주석의 규칙).
          '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;">' +
            (unfound ? countPill('근거 없음 ' + unfound + '건', "sev-min") : '') +
            (unreviewed ? countPill('검토 못 함 ' + unreviewed + '건', "sev-maj") : '') +
          '</div>' +
        '</div>' +
        '<div style="display:flex;gap:6px;flex:none;">' +
          // 원문은 **새 창**이다(2026-09-16 재설계). 비교 검토의 원문 보기와 같은
          // 관용구 — 화면에 뷰어를 박으면 단일 검토와 상태를 나눠 쓰게 된다.
          // 비교 검토의 원문 버튼과 같은 옷(trace-source-action, "원문 ↗"). 창을 여는 길은
          // 이것 하나다 — 행의 쪽수는 열린 창 안에서 자리만 옮긴다(2026-09-17 정리).
          '<button type="button" class="trace-source-action" data-act="openEvalOriginal"' +
            (saved ? "" : ' disabled title="이력에 저장되지 않아 원문을 열 수 없습니다"') +
            '>원문 ↗</button>' +
          // 엑셀은 서버가 이력에서 만든다 — 이력에 없으면 못 만들고, 버튼이 그 말을 한다.
          '<button type="button" class="btn btn-sm btn-primary" data-act="exportEvaluationXlsx"' +
            (saved ? "" : ' disabled title="이력에 저장되지 않아 엑셀을 만들 수 없습니다"') +
            '>' + dlIcon + ' Excel</button>' +
        '</div>' +
      '</div>';
    // 표가 폭을 다 쓴다 — 오른쪽에 뷰어가 없다. 항목 원문이 길어서 좁은 패널에
    // 넣으면 서너 글자마다 꺾였다.
    return '<div class="page-shell" data-scroll="eresults" style="display:flex;flex-direction:column;min-height:0;">' +
      // 단일·비교 결과와 같은 머리: 뒤로 + "새 문서 검토"(다른 문서를 새로 올리는 길).
      '<div class="results-head">' + resultsBackLink() + newReviewLink("evaluate") + '</div>' +
      '<div style="flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden;' +
        'margin:4px 32px 12px;background:var(--panel);border:1px solid var(--line);' +
        'border-radius:var(--r-md);">' +
        head +
        '<div id="evalRows" data-scroll="evalRows" style="flex:1;min-height:0;overflow:auto;">' +
          '<table class="eval-table"><thead><tr>' +
            '<th scope="col">Classification</th>' +
            '<th scope="col">Detail Characteristic</th>' +
            '<th scope="col">ID</th>' +
            '<th scope="col" class="eval-col-item">Evaluation Item</th>' +
            '<th scope="col" class="eval-col-comment">Evaluation result and Comment</th>' +
            '<th scope="col">쪽</th>' +
          '</tr></thead><tbody>' + evaluateRows(v) + '</tbody></table>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  // 비교 진행의 오른쪽 설정 패널 — 단일(criteriaPanel)·폴더(caseSettingsPanel)와
  // 같은 관용구·같은 자리. 브라우저가 이미 아는 값만 적는다.
  function compareSettingsPanel(nameA, nameB) {
    var row = function (label, value) {
      return '<div style="display:flex;gap:10px;padding:4px 0;font-size:12px;">' +
        '<span style="flex:none;width:34px;color:var(--text-3);">' + esc(label) + '</span>' +
        '<span class="mono" style="min-width:0;color:var(--text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(value) + '</span></div>';
    };
    var team = teamLabel(state.checklist || "");
    var ai = state.llm === "on"
      ? shortModel(state.server && (state.server.llm_label || state.server.llm_model)) + " · 사내"
      : "끔 — 규칙 검사만";
    return '<aside class="progress-settings">' +
      '<h3 class="progress-settings-title">이번 검토 설정</h3>' +
      '<p class="progress-settings-sub">시작할 때 확정된 읽기 전용 설정입니다.</p>' +
      '<div style="padding:10px 0;border-top:1px solid var(--line-2);">' +
        '<div style="font-size:12px;font-weight:600;color:var(--text-2);margin-bottom:4px;">문서 쌍</div>' +
        row("상위", nameA) + row("하위", nameB) +
      '</div>' +
      '<div style="padding:10px 0;border-top:1px solid var(--line-2);">' +
        '<div style="font-size:12px;font-weight:600;color:var(--text-2);margin-bottom:6px;">적용 기준</div>' +
        (team
          ? '<div style="display:flex;align-items:center;gap:8px;padding:2px 0;">' +
              '<span style="font-size:12px;font-weight:700;padding:4px 6px;border-radius:var(--r-xl);' +
                'background:var(--accent-weak);color:var(--accent-ink);">팀</span>' +
              '<span style="min-width:0;font-size:12px;color:var(--text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(team) + '</span>' +
            '</div>'
          : '<div style="font-size:13px;color:var(--text-2);">기준 미선택 — 기본 검사만 돕니다</div>') +
      '</div>' +
      '<div style="padding:10px 0;border-top:1px solid var(--line-2);">' +
        '<div style="font-size:12px;font-weight:600;color:var(--text-2);margin-bottom:6px;">AI 검토</div>' +
        '<div style="font-size:12px;color:var(--text-2);">' + esc(ai) + '</div>' +
      '</div>' +
    '</aside>';
  }

  function compareProgress(v) {
    var nameA = (v.cmp.docA && v.cmp.docA.name) || (v.files.compareA && v.files.compareA.name) || "상위 문서";
    var nameB = (v.cmp.docB && v.cmp.docB.name) || (v.files.compareB && v.files.compareB.name) || "하위 문서";
    var elapsed = state.compareStartedAt
      ? fmtElapsed(Date.now() - state.compareStartedAt) + " 경과" : "시작하는 중";
    return progressFrame({
      scroll: "cmp-progress",
      // 첫 단계(문서 읽기) 동안은 단일·체크리스트와 같은 좁고 가운데인 카드다.
      // 그 동안 단계 목록은 "읽는 중" 하나만 말하므로 넓은 판이 빈 표로 보인다.
      phase: v.cdone ? "done" : (state.cstageIndex > 0 ? "reviewing" : "preparing"),
      head: progressHead(v.cdone, v.cTotalCount,
        ["두 문서를 비교하고 있습니다", "두 문서를 맞대어 어긋난 곳과 누락을 찾습니다"],
        null, v.cUnreviewedCount, { elapsed: elapsed, elapsedId: "cmp-elapsed", cancelAction: "cancelCompare",
          documents: [{ label: "상위 문서", name: nameA }, { label: "하위 문서", name: nameB }],
          animateState: true, motionStartedAt: state.compareStartedAt,
          cancelLabel: "검토 취소" }),
      main: '<div class="progress-stage-list">' +
        v.cpipeline.map(timelineItem).join("") + '</div>',
      settings: compareSettingsPanel(nameA, nameB)
    });
  }

  // 마지막으로 그린 추적표에서 **화면에 보이는** 행. 키보드 이동이 이것을
  //: 따라야 필터를 켰을 때 감춘 행으로 넘어가지 않는다. 그리는 김에 적는다 —
  //: 따로 계산하면 정렬·필터 규칙이 두 곳에 생겨 반드시 갈린다.
  var _rtmVisible = { keys: [], vkey: {} };

  // 비교 검토의 "기준 판정" 탭 — 문서쌍 전체에 거는 팀 기준. 요건 ID로 연결되는 결과는 이미
  // 각 요건의 자동 확인·내용 대조에 있으므로 여기서 반복하지 않는다.
  // 모양은 단일 검토의 "기준 판정" 탭과 같다(상태별 상자 + 항목 줄 + 상태 알약) — 네 열짜리
  // 표는 읽기 어려웠고, 화면 맨 아래 접힌 띠에 매달아 두니 있는 줄도 몰랐다(2026-09-16).
  // 그래서 요건 판정과 나란한 **탭**이다.
  function compareAdditionalSection(v) {
    var extra = v.cmpAdditional;
    if (!extra || !extra.total) return "";
    var out = "";
    var layers = {};
    (extra.items || []).forEach(function (it) { layers[it.layer || ""] = true; });
    var mixedLayers = Object.keys(layers).length > 1;
    CRITERIA_SECTIONS.forEach(function (sec) {
      var key = sec[0], items = (extra.items || []).filter(function (it) { return it.status === key; });
      if (!items.length) return;
      // 접힘은 브라우저가 기억할 필요가 없어 <details> 로 — 사람 확인만 펼쳐 둔다.
      out += '<details class="criteria-section"' + (key === "manual" ? ' open' : '') + '>' +
        '<summary class="criteria-section-head">' +
          '<span class="criteria-section-caret" aria-hidden="true"></span>' +
          '<b>' + esc(sec[1]) + '</b><span class="criteria-section-count pill pill-neutral">' + items.length + '</span>' +
          '<span class="criteria-section-sub">' + esc(sec[2]) + '</span>' +
        '</summary><div class="criteria-section-body">' +
        items.map(function (it) {
          return checklistItemGroup(Object.assign({}, it, {
            layer: mixedLayers ? it.layer : "", terse: true, findings: it.findings || [] }), v);
        }).join("") +
        '</div></details>';
    });
    // 요건 ID 에 붙일 수 없는 비교 결과(중복 ID · 형식 등). 한 상자로.
    if ((extra.findings || []).length) {
      out += '<details class="criteria-section" open>' +
        '<summary class="criteria-section-head">' +
          '<span class="criteria-section-caret" aria-hidden="true"></span>' +
          '<b>요건에 연결되지 않은 결과</b><span class="criteria-section-count pill pill-neutral">' + extra.findings.length + '</span>' +
          '<span class="criteria-section-sub">어느 요건 하나에 붙일 수 없는 비교 결과</span>' +
        '</summary><div class="criteria-section-body">' +
        extra.findings.map(function (f) {
          // 한 줄에 다 싣는다: 제목 · 알약 · 출처. 안내문만 있을 때 둘째 줄.
          return '<div class="crit-item"><div class="crit-item-head">' +
            '<span class="crit-item-title">' + esc(f.message) + '</span>' +
            '<span class="crit-item-status"><span class="pill pill-maj">' + esc(f.typeLabel) + '</span>' +
              (f.origin ? '<span class="mut">' + esc(f.origin) + '</span>' : '') + '</span></div>' +
            (f.suggestion ? '<div style="margin-top:2px;font-size:13px;color:var(--text-2);line-height:1.6;">' + esc(f.suggestion) + '</div>' : '') +
          '</div>';
        }).join("") +
        '</div></details>';
    }
    return '<div class="cmp-criteria" data-scroll="cmpCriteria">' +
      '<p class="single-result-empty-note" style="margin:0 0 10px;">요건별이 아니라 두 문서 전체에 거는 팀 기준 ' +
        extra.total + '개 항목의 판정입니다.</p>' + out + '</div>';
  }

  // 비교 원문 뷰어 — 폴더 검토(caseDocView)와 같은 껍데기·부품(viewerHeadHtml·
  // viewerWrap·issuesShell·pdf-mount). 형광펜은 요건 ID 를 짚는다.
  // 파서가 표 행을 `| 라벨 | 값 |` 로 직렬화한다. 그대로 뿌리면 파이프가 늘어선
  // 덤프가 되어(실측 피드백) 정작 읽어야 할 설명이 안 보인다. 라벨·값으로 갈라
  // 정의 목록으로 그린다 — 원문 글자는 한 자도 바꾸지 않는다(파이프만 구분자로
  // 쓰고 버린다). 표가 아닌 줄은 문단 그대로 둔다.
  // 요건 원장에서 부수 칸(ID·우선순위·검증방법·출처·이력)은 접어 둔다 — "하위에 반영됐나"를
  // 볼 때 필요한 건 제목·설명이고, 일곱 줄을 다 펴니 정작 설명이 묻혔다(2026-09-16).
  // 모르는 라벨은 접지 않는다(팀마다 칸 이름이 다르다).
  var STATEMENT_MINOR = { "ID": 1, "우선순위": 1, "검증방법": 1, "출처": 1, "이력": 1 };
  function statementHtml(text, ownId) {
    var main = "", minor = "", minorLabels = [];
    // 옛 기록엔 다음 요건의 머리줄("… [ID: RQ-…]")이 서술 끝에 붙어 있다(서버는 고쳤지만 저장된
    // 기록은 그대로다). 이 요건의 ID 가 아닌 "[ID:" 줄은 그리지 않는다.
    var foreignHead = function (t) {
      return /\[\s*ID\s*[:：]/.test(t) && !(ownId && t.indexOf(ownId) >= 0);
    };
    var row = function (label, value) {
      return '<div class="trace-statement-row">' +
        '<span class="trace-statement-label">' + esc(label) + '</span>' +
        '<span class="trace-statement-value">' + esc(value) + '</span></div>';
    };
    String(text || "").split("\n").forEach(function (line) {
      var t = line.trim();
      if (!t || foreignHead(t)) return;
      if (t.indexOf("|") < 0) { main += '<div class="trace-statement-line">' + esc(t) + '</div>'; return; }
      var cells = t.split("|").map(function (c) { return c.trim(); }).filter(function (c) { return c !== ""; });
      if (!cells.length) return;
      if (cells.length === 1) { main += '<div class="trace-statement-line">' + esc(cells[0]) + '</div>'; return; }
      // 라벨·값 짝으로 읽는다. 홀수면 마지막 칸은 값만 있는 줄이다.
      for (var i = 0; i < cells.length; i += 2) {
        var label = cells[i], value = cells[i + 1];
        if (value === undefined) { main += row("", label); continue; }
        if (STATEMENT_MINOR[label]) { minor += row(label, value); minorLabels.push(label); }
        else main += row(label, value);
      }
    });
    var more = minor
      ? '<details class="trace-statement-more"><summary>' + esc(minorLabels.join(" · ")) + '</summary>' + minor + '</details>'
      : '';
    return '<div class="trace-statement">' + (main || (minor ? '' : '<div class="trace-statement-line">(내용 없음)</div>')) + more + '</div>';
  }

  function compareDocView(v) {
    var cv = state.cview;
    var sideLabel = cv.side === "A" ? "상위 문서" : "하위 문서";
    var head = viewerHeadHtml(cv.name || sideLabel, true, "", v.converting);
    var body;
    if (v.convertError) {
      body = head + '<div style="flex:1;display:flex;align-items:center;justify-content:center;padding:20px;font-size:14px;color:var(--sev-crit-fg);">' + esc(v.convertError) + '</div>';
    } else if (v.converting) {
      // HWP·DOCX 는 서버가 PDF 로 바꾼다 — 50쪽이면 처음 한 번은 1분 가까이 걸리고,
      // 그동안 뜨는 회색 자리표시가 "빈 종이"로 읽혔다(2026-09-08). 무엇을 왜
      // 기다리는지 적는다. 변환본은 서버가 이력에 저장해 두 번째부터는 바로 뜬다.
      var ext = String(cv.name || "").split(".").pop().toLowerCase();
      body = head + pdfPendingHtml(ext === "pdf"
        ? "문서를 여는 중…"
        : ext.toUpperCase() + " 문서를 PDF 로 바꾸는 중 — 처음 한 번은 1분쯤 걸립니다. 다음부터는 바로 뜹니다.");
    } else {
      body = head + '<div id="pdf-mount" style="flex:1;overflow:hidden;"></div>';
    }
    var markNos = {};
    (((state.marks || {}).items) || []).forEach(function (it) {
      if (it.no) markNos[it.id] = it.no;
    });
    var sorted = (cv.findings || []).slice().sort(function (a, b) {
      return (a.sev === "major" ? 0 : 1) - (b.sev === "major" ? 0 : 1);
    });
    var cards = sorted.length
      ? sorted.map(function (f, ci) {
          return '<div data-case-finding="' + esc(f.id) + '" style="padding:12px 2px;' +
            (ci ? "border-top:1px solid var(--line-2);" : "") + '">' +
            '<div style="display:flex;gap:8px;align-items:flex-start;">' +
              '<span data-case-number="' + esc(f.id) + '" style="flex:none;display:inline-flex;align-items:center;gap:4px;">' +
                numberChip(markNos[f.id] || "", null, f.id, true) + '</span>' +
              '<span style="min-width:0;font-size:13px;line-height:1.4;">' + esc(f.message) + '</span>' +
            '</div>' +
          '</div>';
        }).join("")
      : '<div style="padding:14px;font-size:13px;color:var(--text-2);">이 문서를 가리키는 추적 항목이 없습니다.</div>';
    // **판정 작업대.** 추적표에서 한 요건을 펼친 채로 원문을 열면, 뷰어 옆에
    // 그 요건이 따라온다 — 문서를 보면서 바로 판정하고 다음으로 넘어가는 것이
    // 이 화면의 일이다(V&V ③문서 검증 → ④검토 결과 관리).
    //
    // 상위 문서는 뷰어를 안 띄운다. 요건은 대개 문단 하나라 글로 충분하고,
    // 표·그림 안에 설계가 숨는 것은 하위 문서 쪽이다. PDF 둘을 반반 나누면
    // 1600px 화면에서 656px 씩이라 설계서 표가 양쪽 다 안 읽힌다(실측).
    // 상위 원본이 꼭 필요하면 위 토글이 그 자리로 데려간다.
    var focused = null;
    // 상위·하위 어느 창이든 짚은 요건이 있으면 오른쪽에 그 요건을 둔다. 예전엔 하위만
    // 이었고 상위 창은 창 머리 한 줄로 때웠는데, 긴 서술이 한 줄에 눌려 안 읽혔다(2026-09-08).
    if (state.crtmOpenKey) {
      v.rtmForwardMain.concat(v.rtmReverse).forEach(function (r) {
        if (r.key === state.crtmOpenKey) focused = r;
      });
    }
    var focusPanel = "";
    if (focused) {
      var f = focused;
      focusPanel =
        '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px;">' +
          '<span class="rtm-status rtm-status-neutral">' + esc(f.label) + '</span>' +
          '<span class="mono" style="font-size:13px;font-weight:700;color:var(--text);">' +
            esc(f.upperId) + '</span>' +
          (f.loc !== "—" ? '<span style="font-size:12px;color:var(--text-3);">' + esc(f.loc) + '</span>' : '') +
        '</div>' +
        (f.text
          ? '<div style="font-size:12px;font-weight:600;color:var(--text-3);margin-bottom:4px;">상위 문서의 서술' +
              // 누르면 형광펜 자리로 되돌아간다 — 스크롤하다 잃어버린 자리를 다시 찾는 손잡이.
              // 하위 창의 누락 행은 갈 자리가 없다(설계 서술이 없다) — 버튼을 안 낸다.
              ((cv.side === "A" ? !!f.text : f.lowerIds !== "—")
                ? '<button type="button" class="btn btn-sm btn-ghost btn-ghost-accent" style="margin-left:8px;min-height:26px;padding:2px 8px;font-size:12px;" data-act="openCompareDoc" data-arg="' +
                    esc(cv.side + '|' + f.key + '|' + ((cv.side === "A" ? f.page : f.childPage) || "") + '|' + f.key) + '">형광펜 자리로 ↧</button>'
                : '') + '</div>' +
            '<div style="background:var(--bg);border:1px solid var(--line-2);border-radius:var(--r-sm);' +
              'padding:10px 12px;margin-bottom:12px;">' + statementHtml(f.text) + '</div>'
          : '') +
        // 후보를 누르면 **같은 뷰어**가 그 절로 옮겨 간다 — 화면을 새로 열지
        // 않으므로 판정 흐름이 안 끊긴다. 후보는 하위 문서의 것이라 하위 창에서만.
        (cv.side === "B" && f.probes && f.probes.length
          ? '<div style="font-size:12px;font-weight:600;color:var(--text-3);margin-bottom:6px;">' +
              '하위 문서에서 비슷한 곳 — 눌러서 그 자리로</div>' +
            f.probes.map(function (h, hi) {
              // 후보의 형광펜 id 는 pr<행>-<번호> 다(app.js openCompareDoc 이 그렇게 만든다).
              // 절 id 를 focus 로 주면 짝이 없어 쪽만 옮기고 형광펜이 안 켜졌다(2026-09-08).
              var pid = "p" + f.key + "-" + hi;
              var on = cv.focus === pid;
              return '<div class="hover-accent" data-act="openCompareDoc" tabindex="0" role="button"' +
                ' data-arg="B|' + esc(pid) + '|' + (h.page || "") + '|' + esc(f.key) + '"' +
                ' style="padding:8px 10px;margin-bottom:6px;border-radius:var(--r-sm);cursor:pointer;border:1px solid ' +
                (on ? 'var(--accent)' : 'var(--line-2)') + ';background:' + (on ? 'var(--accent-weak)' : 'var(--panel)') + ';">' +
                '<div style="display:flex;align-items:baseline;gap:6px;flex-wrap:wrap;">' +
                  '<span style="font-size:12px;font-weight:700;color:var(--text);">' +
                    esc(h.section || ("§" + (h.anchor_section || ""))) + '</span>' +
                  // 파서의 절 id(§23 · §18.1)는 문서에 없는 번호다 — 제목이 있으면 안 적는다.
                  (h.page ? '<span style="font-size:12px;color:var(--text-3);">' + h.page + '쪽</span>' : '') +
                '</div>' +
                (h.shared && h.shared.length
                  ? '<div style="margin-top:4px;font-size:13px;color:var(--text-2);">겹친 말: ' +
                      esc(h.shared.slice(0, 6).join(" · ")) + '</div>'
                  : '') +
              '</div>';
            }).join("")
          : '') +
        // 판정이 이 자리의 목적이다. 추적표 줄에 있는 것과 **같은 액션**이라
        // 어느 쪽에서 눌러도 같은 값이 저장된다.
        (f.vkey
          ? '<div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--line-2);">' +
              '<div style="font-size:12px;font-weight:600;color:var(--text-3);margin-bottom:6px;">판정' +
                (f.carried ? ' ' + CARRIED_TAG : '') + '</div>' + f.priorHtml +
              '<div style="display:flex;gap:6px;flex-wrap:wrap;">' +
                ["만족함", "수정필요", "해당사항없음"].map(function (w) {
                  var on = f.verdict === w;
                  return '<button data-act="setRtmVerdict" data-arg="' + esc(f.vkey) + '|' + w + '" ' +
                    'style="padding:6px 12px;font-size:14px;font-weight:600;border-radius:var(--r-sm);cursor:pointer;border:1px solid ' +
                    (on ? 'var(--accent)' : 'var(--line)') + ';background:' + (on ? 'var(--accent-weak)' : 'var(--panel)') + ';color:var(--text);">' + w + '</button>';
                }).join("") +
              '</div>' +
              '<input data-cvnote="' + esc(f.vkey) + '" value="' + esc(f.vnote) + '" placeholder="비고 (근거를 함께 적습니다)" ' +
                'style="width:100%;margin-top:8px;padding:6px 10px;font-size:14px;border:1px solid var(--line);border-radius:var(--r-sm);background:var(--bg);color:var(--text);box-sizing:border-box;">' +
            '</div>'
          : '');
    }

    // 상·하위 전환 토글 — 두 PDF 를 반반 나란히 띄우면 설계서 표가 양쪽 다
    // 안 읽히는 크기가 된다. 같은 행 맥락(focus)을 유지한 채 즉시 전환하는
    // 쪽이 한 화면에서 실효가 크다. 반대쪽 원본이 없으면(이력) 토글을 안 그린다.
    // 원문 창은 창마다 문서가 하나라 전환할 게 없다 — 라벨만. 한 화면 뷰어(이력에
    // 없는 결과)에서만 두 칸짜리 세그먼트로 그린다(도구줄과 같은 옷).
    var sideToggle;
    if (state.popup) {
      sideToggle = '<span class="viewer-side-label">' +
        (cv.side === "E" ? "검토 문서 · 평가표 초안" : cv.side === "A" ? "상위 · 요구사항" : "하위 · 설계") + '</span>';
    } else {
      sideToggle = '<span class="viewer-tool-group">' + ["A", "B"].map(function (sd) {
        var slot2 = sd === "A" ? state.files.compareA : state.files.compareB;
        if (!slot2 || !slot2.file) return "";
        var on = cv.side === sd;
        // 하위 문서의 유사 위치 후보(pr… id)는 상위 문서에 없다. 문서 쪽을
        // 바꿀 때는 후보가 속한 추적 행으로 돌아가야 상위 요건을 정확히 짚는다.
        var toggleFocus = sd !== cv.side && /^pr\d+-\d+$/.test(cv.focus || "")
          ? (state.crtmOpenKey || cv.focus) : cv.focus;
        return '<button type="button" class="viewer-tool" aria-pressed="' + (on ? "true" : "false") + '" ' +
          'data-act="openCompareDoc" data-arg="' + sd + '|' + esc(toggleFocus || "") + '">' +
          (sd === "A" ? "상위 문서" : "하위 문서") + '</button>';
      }).join("") + '</span>';
    }
    return '<div style="height:100%;box-sizing:border-box;display:flex;flex-direction:column;">' +
      '<div style="display:flex;align-items:center;gap:10px;flex:none;padding:10px 32px 4px;">' +
        // 새 창(팝업)은 "돌아갈 곳"이 없다 — 뒤로가기 화살표에 "창 닫기"를 붙이면 말과 그림이
        // 어긋난다(2026-09-17 지적). 팝업은 ✕ 로 닫고, 한 화면 뷰어만 화살표로 돌아간다.
        '<div class="hover-accent" data-act="closeCompareDoc" tabindex="0" role="button" ' +
          'style="display:inline-flex;align-items:center;gap:6px;font-size:14px;font-weight:500;' +
          'color:var(--text-3);cursor:pointer;padding:8px;margin-left:-8px;">' +
          (state.popup ? ICONS.x + ' 창 닫기' : ICONS.arrowLeft + ' 추적표로 돌아가기') + '</div>' +
        '<div style="display:flex;gap:6px;">' + sideToggle + '</div>' +
      '</div>' +
      '<div id="results-row" style="' + resultsRowCss(state.viewerFull) + '">' +
        viewerWrap(true, body) +
        // 추적표에서 한 요건을 펼친 채로 왔으면, 옆에 **그 요건**을 둔다.
        // 문서를 보면서 바로 판정하고 다음으로 넘어가는 것이 이 화면의 일이다 —
        // 예전엔 "이 문서의 추적 항목" 목록이 있었는데, 그건 추적표가 이미 하는
        // 말이라 여기서 또 하면 판정할 자리가 없어졌다(2026-09-02).
        // 원문 창에서 짚은 요건이 없으면(상위 문서 창) 옆 패널을 안 둔다 — 번호 달린
        // 추적 항목 목록은 한 화면 시절의 것이라 새 창에선 뜻이 없다(2026-09-08).
        (state.popup && !focused ? '' : focused
          ? issuesShell({ title: "판정", count: null, noSummary: true, body: focusPanel })
          : issuesShell({
              title: "이 문서의 추적 항목",
              count: (cv.findings || []).length,
              noun: "표시",   // 반영됨까지 다 세는 숫자라 "지적"이라 부르면 거짓말이 된다
              body: cards
            })) +
      '</div>' +
    '</div>';
  }

  // 이어받은 판정 표시. 반영 확인 패널의 `지난 판정` 과 같은 옷.
  var CARRIED_TAG = '<span style="font-size:12px;font-weight:600;padding:2px 8px;' +
    'border-radius:var(--r-sm);background:var(--accent-weak);color:var(--accent-ink);">지난 판정</span>';

  function compareResults(v) {
    if (state.cview) return compareDocView(v);

    // **한 화면의 일은 하나다** — 요건 하나 보고, 하위 근거 보고, 버튼 하나.
    // 예전 화면은 띠가 넷(뒤로가기·상태바·묻기·툴바)이고 오른쪽은 안내문이
    // 내용보다 컸으며, 정작 산출물인 판정 버튼은 스크롤 밖이었다(2026-09-08
    // 실측 스크린샷). 라벨·안내문을 걷고 원문 서술과 판정만 남긴다.
    //   왼쪽  요건 목록 — 점 하나(상태) + ID + 제목
    //   오른쪽 상위·하위 서술 나란히. 원문은 새 창(openDocWindow)
    //   아래   판정 독 — 스크롤과 무관하게 늘 보인다
    // 점은 항목 상태, ⚠ 는 결과에 붙는 주의 — 이 둘만 쓴다.
    _rtmVisible = { keys: [], vkey: {} };
    var cmp = v.cmp;
    var rtmAllRows = v.rtmForwardMain.concat(v.rtmReverse);
    var rtmHidden = state.crtmOnlyTodo
      ? rtmAllRows.filter(function (r) { return !!r.verdict; }).length : 0;
    var rtmAll = state.crtmOnlyTodo
      ? rtmAllRows.filter(function (r) { return !r.verdict; })
      : rtmAllRows;
    var active = null;
    rtmAll.forEach(function (r) { if (r.key === state.crtmCursor) active = r; });
    if (!active && rtmAll.length) { active = rtmAll[0]; state.crtmCursor = active.key; }
    var remaining = Math.max(0, v.rtmJudgeable - v.rtmJudged);
    var searches = cmp.rtmSearches || {};

    // ── 상단 한 줄 ──────────────────────────────────────────────────────
    var strip = '<div id="compareStatusBar" class="results-head cmp-strip">' +
      resultsBackLink() +
      '<span class="cmp-strip-docs"><span>' + esc((cmp.docA || {}).name || "상위 문서") + '</span>' +
        '<i>' + ICONS.arrowRight + '</i><span>' + esc((cmp.docB || {}).name || "하위 문서") + '</span></span>' +
      '<span class="cmp-strip-stat"><b>' + (remaining ? '남은 판정 ' + remaining : '판정 완료') + '</b>' +
        '<em>/ ' + v.rtmJudgeable + '</em></span>' +
      (cmp.stats.missing
        ? '<span class="pill pill-maj">누락 ' + cmp.stats.missing + '</span>' +
            // 범위를 안 적어 남의 몫까지 셌을 수 있다 — 같은 높이의 테두리 알약으로 옆에.
            // 알약 안에 아이콘과 함께 끼워 넣으니 알약 하나만 모양이 달라 튀었다(2026-09-16).
            (v.cmpScopeWarn ? '<span class="pill pill-outline" title="' + esc(v.cmpScopeWarn + ' ' + v.cmpScopeHow) + '">범위 미입력</span>' : '')
        : '') +
      (cmp.stats.extra ? '<span class="pill pill-min">근거 없음 ' + cmp.stats.extra + '</span>' : '') +
      (cmp.stats.mismatch ? '<span class="pill pill-maj">내용 확인 ' + cmp.stats.mismatch + '</span>' : '') +
      // 지난 회차와 이었으면 말한다 — 안 말하면 열자마자 채워진 판정이 기계 것으로 보인다.
      // 지난 회차에서 **이어받은 판정이 있을 때만** 말한다 — 그때 채워진 판정이
      // 기계 것으로 보이지 않게. 이어받은 게 없으면 알릴 것도 없다.
      (v.rtmLineage && v.rtmCarriedCount
        ? '<span class="pill pill-info">지난 비교(' + esc(String(v.rtmLineage.at || "").slice(0, 10)) +
            (v.rtmLineage.by ? ' · ' + esc(v.rtmLineage.by) : '') + ')에서 이어받은 판정 ' +
            v.rtmCarriedCount + '</span>'
        : '') +
      (state.cverdictSaveError ? '<span class="cmp-strip-err">' + esc(state.cverdictSaveError) + '</span>' : '') +
      '<span class="grow"></span>' +
      '<button type="button" class="btn btn-sm btn-ghost btn-ghost-accent" data-act="exportRtmXlsx">추적성 분석표 Excel</button>' +
      // 단축키 안내는 안 적는다 — 판정 버튼의 1 2 3 표시로 충분하고, 행 이동은
      // 화살표로도 된다(J/K 는 아는 사람만 쓰면 된다).
      // 다음 행동. 이걸 빼자 결과에서 새 비교로 갈 손잡이가 없어졌다(2026-09-08 지적).
      newReviewLink("compare") +
    '</div>';

    // ── 요건 목록 ───────────────────────────────────────────────────────
    function dotOf(r) {
      return r.status === "orphan" ? "min" : (r.status === "missing" ? "maj" : "good");
    }
    function queueHtml(rows, activeKey) {
      rows.forEach(function (r) {
        _rtmVisible.keys.push(r.key);
        _rtmVisible.vkey[r.key] = r.vkey || "";
      });
      return '<div class="trace-queue-list" role="listbox" aria-label="요건 목록">' +
        rows.map(function (r) {
          var id = r.upperId !== "—" ? r.upperId : r.lowerIds;
          var on = activeKey === r.key;
          // 두 줄: 윗줄 점·ID·판정 알약, 아랫줄 제목 전체. 한 줄에 넣으니 판정이 붙는 순간
          // 제목이 세 글자로 잘려 훑는 의미가 없었다(2026-09-16). data-vkey 는 판정 직후
          // 그 행을 잠깐 밝히는 손잡이(app.js setRtmVerdict).
          return '<button type="button" id="rtm-' + r.key + '" class="trace-queue-item' +
              (on ? ' is-active' : '') + (r.verdict ? ' is-done' : '') +
              '" data-act="selectRtmRow" data-arg="' + esc(r.key) + '" data-vkey="' + esc(r.vkey || "") + '" role="option" aria-selected="' + (on ? 'true' : 'false') +
              '" title="' + esc(r.title || r.text || id) + '">' +
            '<i class="tq-dot tq-dot-' + dotOf(r) + '" aria-hidden="true"></i>' +
            '<span class="mono trace-queue-id">' + esc(id) + '</span>' +
            (r.verdict ? '<span class="pill tq-verdict ' + (r.verdict === "해당사항없음" ? 'pill-outline' : r.verdict === "수정필요" ? 'pill-maj' : 'pill-good') + '">' + esc(r.verdict) + '</span>' : '<span></span>') +
            '<span class="trace-queue-title">' + esc(r.title || r.text || id) + '</span>' +
          '</button>';
        }).join("") + '</div>';
    }
    var queueHead = '<div class="trace-queue-head"><div><strong>' +
        (state.crtmOnlyTodo ? '판정 대기' : '요건') + '</strong><span>' + rtmAll.length + '건</span>' +
        // 점 범례 — 색만으로는 무슨 뜻인지 모른다.
        '<span class="tq-legend"><i class="tq-dot tq-dot-good"></i>연결됨 <i class="tq-dot tq-dot-maj"></i>없음' +
          (v.rtmReverse.length ? ' <i class="tq-dot tq-dot-min"></i>상위에 없음' : '') + '</span></div>' +
        // 보기 전환은 단일 검토의 필터 알약과 같은 부품(전체 | 미판정) — 글자 링크 하나로는
        // 필터인 줄 몰랐다(2026-09-16). 켜진 쪽이 채워진다.
        '<div class="result-filter-group tq-filter" role="group" aria-label="요건 보기">' +
          '<button type="button" class="result-filter' + (state.crtmOnlyTodo ? '' : ' is-active') + '" data-act="setRtmOnlyTodo" data-arg="all" aria-pressed="' + (state.crtmOnlyTodo ? 'false' : 'true') + '">전체</button>' +
          '<button type="button" class="result-filter' + (state.crtmOnlyTodo ? ' is-active' : '') + '" data-act="setRtmOnlyTodo" data-arg="todo" aria-pressed="' + (state.crtmOnlyTodo ? 'true' : 'false') + '">미판정</button>' +
        '</div></div>';

    // ── 오른쪽: 서술 두 장 ─────────────────────────────────────────────
    var STATUS_LINE = { linked: "반영됨", missing: "누락 — 하위 문서에 이 ID 가 없음",
                        orphan: "근거 없음 — 상위 문서에 이 ID 가 없음", rolled_up: "부모 수준 검증",
                        out_of_scope: "범위 밖" };
    function docTarget(side, r) {
      if (side === "A") return r.upperId !== "—" ? 'A|' + r.key + '|' + (r.page || "") + '|' + r.key : "";
      return r.lowerIds !== "—" ? 'B|' + r.key + '|' + (r.childPage || (r.status === "orphan" ? r.page : "") || "") + '|' + r.key : "";
    }
    // 원문은 새 창이다 — 검토자는 대개 모니터가 둘이고, 한 화면에 원문을 끼우면
    // 표·서술·판정이 다 좁아진다. 같은 쪽 창은 하나만 열리고 행을 옮기면 따라간다.
    function docBtn(target) {
      return target
        ? '<button type="button" class="trace-source-action" data-act="openDocWindow" data-arg="' + esc(target) + '">원문 ↗</button>'
        : '';
    }
    function cellsHtml(text) {
      var t = String(text || "");
      if (t.indexOf("|") < 0) return '<q class="ai-quote">' + esc(t) + '</q>';
      var cells = t.split("|").map(function (c) { return c.trim(); }).filter(function (c) { return c !== ""; });
      return '<span class="ai-cells">' + cells.map(function (c) { return '<span class="ai-cell">' + esc(c) + '</span>'; }).join("") + '</span>';
    }
    // AI 가 다른 말로 찾아본 결과(missing_judge.Judgment). 라벨은 안 건드린다 —
    // 찾은 문장을 보여줄 뿐이고 판정은 아래 독에서 검토자가 한다.
    function journeyHtml(s) {
      var hits = s.hits || {};
      var words = (s.words || []).filter(function (w) { return w !== s.hint; });
      var parts = [];
      if (s.hint) parts.push('힌트 "' + esc(s.hint) + '"');
      if (words.length) parts.push('떠올린 말: ' + words.map(function (w) {
        return esc(w) + (hits[w] ? ' <b>' + hits[w] + '곳</b>' : '');
      }).join(' · '));
      if ((s.read || []).length) parts.push('읽은 절: ' + s.read.map(esc).join(' · '));
      return parts.length ? '<div class="ai-journey">' + parts.join('<br>') + '</div>' : '';
    }
    function aiBlock(r) {
      var s = searches[r.vkey];
      var busy = !!(state.csearchBusy || {})[r.vkey];
      var hint = (state.chint || {})[r.vkey] || "";
      var head, body = "", found = false;
      if (busy) {
        head = '<b>AI 가 찾는 중…</b>';
      } else if (!s) {
        // 결과가 없는 이유는 둘이다 — 이 기능이 생기기 전의 이력이거나, 비교 때
        // AI 를 껐거나. 서버가 껐다고 기록한 때만 그렇게 말한다. 나머지는 짐작하지 않는다.
        // 아직 안 찾았으면 말을 안 한다 — 위 문장("같은 번호가 없다…")과 아래 입력창이면 충분하다.
        // "아직 찾아보지 않았다 / 아래에서 찾을 수 있다 / 다시 찾기" 세 줄이 한 일을 하고 있었다(2026-09-16).
        var off = cmp.content_match_state === "disabled" || cmp.content_match_state === "unavailable";
        head = off ? '<span class="mut">비교 때 AI 가 꺼져 있었다</span>' : '';
      } else if (s.verdict === "설계있음") {
        found = true;
        head = '<span class="pill pill-good">AI 가 찾은 자리</span><b>번호 없이 적힌 것으로 보인다</b>' +
          // s.section 은 절 **제목**이다(missing_judge.Judgment). 파서 §번호가 아니라 그대로 보여 준다.
          (s.section || s.page
            ? '<button type="button" class="lnk" data-act="openDocWindow" data-arg="B||' + (s.page || "") + '|' + esc(r.key) + '">' +
                esc(s.section || "") + (s.section && s.page ? ' · ' : '') + (s.page ? s.page + '쪽' : '') + ' ↗</button>'
            : '');
        body = '<div class="ai-found-quote">' + cellsHtml(s.quote) + '</div>' + journeyHtml(s);
      } else if (s.verdict === "설계없음") {
        head = '<b>AI 가 다른 말로도 찾아봤다 — 없음</b>';
        body = journeyHtml(s);
      } else {
        head = '<b>AI 가 판정하지 못했다</b>' + (s.reason ? ' <span class="mut">' + esc(s.reason) + '</span>' : '');
        body = journeyHtml(s);
      }
      // 검토자가 아는 말을 주면 AI 가 헛돌지 않는다. 없어도 되고, 있으면 빠르다.
      // 입력창엔 이 요건의 제목을 미리 넣는다 — 상관없는 예시("성능 로그 전달")보다 한 번에 눌러 찾게.
      var again = '<div class="ai-again"><span>' + (s ? '다른 말로 다시 찾기' : 'AI 로 찾기') + '</span>' +
        '<input data-hint="' + esc(r.vkey) + '" value="' + esc(hint || (s ? "" : (r.title || ""))) + '" placeholder="찾을 말"' + (busy ? ' disabled' : '') + '>' +
        '<button type="button" class="btn btn-sm btn-ghost btn-ghost-accent" data-act="searchMissing" data-arg="' + esc(r.vkey) + '"' + (busy ? ' disabled' : '') + '>찾기</button></div>';
      return { found: found,
               html: '<div class="ai-block' + (found ? ' is-found' : '') + '">' + (head ? '<div class="ai-head">' + head + '</div>' : '') + body + again + '</div>' };
    }
    function candHtml(r) {
      if (!r.probes || !r.probes.length) return '';
      return '<div class="sub">비슷한 곳 — 눌러서 원문으로</div>' + r.probes.map(function (h, hi) {
        return '<button type="button" class="cand" data-act="openDocWindow" data-arg="B|p' + esc(r.key) + '-' + hi + '|' + (h.page || "") + '|' + esc(r.key) + '">' +
          '<span class="loc">' + esc(h.section_title || h.section || (h.page ? "" : "위치 정보 없음")) +
            ((h.section_title || h.section) && h.page ? ' · ' : '') + (h.page ? h.page + '쪽' : '') + '</span>' +
          '<span class="cand-text">' + esc(String(h.text || "").slice(0, 300)) + '</span>' +
          (h.shared && h.shared.length ? '<span class="shared">겹친 말: ' + esc(h.shared.slice(0, 6).join(' · ')) + '</span>' : '') +
        '</button>';
      }).join("");
    }
    function upperCard(r) {
      var body = r.status === "orphan"
        ? '<div class="none"><b>상위 문서에 이 ID 가 없다.</b> 신규 설계인지 잘못된 ID 인지 확인한다.</div>'
        : (r.text ? statementHtml(r.text, r.upperId) : '<div class="none">서술을 읽지 못했다.</div>');
      return '<section class="trace-source">' +
        '<header><h4 class="trace-source-title">상위<span>요구사항</span>' +
          (r.loc !== "—" ? '<span class="loc">' + esc(r.loc) + (r.page ? ' · ' + r.page + '쪽' : '') + '</span>'
            : r.page ? '<span class="loc">' + r.page + '쪽</span>' : '') + '</h4>' +
          docBtn(docTarget("A", r)) + '</header>' +
        '<div class="trace-source-body">' + body + '</div></section>';
    }
    function lowerCard(r) {
      var loc = r.lowerIds !== "—"
        ? '<span class="loc">' + (r.childSectionTitle ? esc(r.childSectionTitle) : esc(r.lowerIds)) + (r.childPage ? ' · ' + r.childPage + '쪽' : '') + '</span>'
        : '<span class="pill pill-outline">이 ID 없음</span>';   // 머리 알약이 이미 누락을 말한다 — 여긴 회색
      var body;
      if (r.status === "orphan") body = statementHtml(r.childText || r.text);
      else if (r.lowerIds !== "—" && r.childText && r.childText !== r.text) body = statementHtml(r.childText);
      else if (r.status === "missing") {
        var ai = r.vkey ? aiBlock(r) : { found: false, html: "" };
        var none = '<div class="none"><b>같은 번호가 없다.</b>' +
          (r.thinText ? ' 상위 요건 서술을 못 읽어 비슷한 곳도 짚지 못했다.' : (r.probes && r.probes.length ? '' : ' 낱말이 겹치는 곳도 없다.')) + '</div>';
        // 찾은 게 있으면 그 문장이 맨 위. 없으면 후보가 먼저, AI 한 줄이 그 아래.
        body = ai.found ? none + ai.html + candHtml(r) : none + candHtml(r) + ai.html;
      } else body = r.childText ? statementHtml(r.childText) : '<div class="none">매핑된 하위 서술을 읽지 못했다.</div>';
      return '<section class="trace-source' + (r.status === "missing" ? ' is-missing' : '') + '">' +
        '<header><h4 class="trace-source-title">하위<span>설계</span>' + loc + '</h4>' + docBtn(docTarget("B", r)) + '</header>' +
        '<div class="trace-source-body">' + body + '</div></section>';
    }
    function detailHead(r, rows) {
      var at = rows.indexOf(r);
      var contentMessage = r.contentStatus === "conflict" && r.contentFindings.length
        ? String(r.contentFindings[0].message || "").replace(/^\[[^\]]+\]\s*/, "") : "";
      return '<header class="td-head">' +
        '<span class="mono rid-big">' + esc(r.upperId !== "—" ? r.upperId : r.lowerIds) + '</span>' +
        '<span class="pill pill-' + (dotOf(r) === "good" ? "good" : dotOf(r)) + '">' + esc(STATUS_LINE[r.status] || r.label) + '</span>' +
        (r.contentStatus === "conflict" ? '<span class="pill pill-maj" title="' + esc(contentMessage) + '">내용 확인 필요</span>' : '') +
        (r.lowerIds !== "—" && r.upperId !== "—" ? '<span class="mut">→ ' + esc(r.lowerIds) + '</span>' : '') +
        '<span class="grow"></span><span class="mut">' + (at + 1) + ' / ' + rows.length + '</span>' +
      '</header>';
    }
    // 판정 독 — 아래 고정. 이 화면의 산출물이라 스크롤 밖에 있으면 안 된다.
    function dockHtml(r, rows) {
      var at = rows.indexOf(r);
      return '<footer class="trace-dock">' +
        (r.priorHtml ? '<span class="dock-prior">' + r.priorHtml + '</span>' : '') +
        '<span class="grow"></span>' +
        (r.vkey
          ? ["만족함", "수정필요", "해당사항없음"].map(function (w, i) {
              return '<button type="button" class="dock-v' + (r.verdict === w ? ' is-on' : '') + '" data-act="setRtmVerdict" data-arg="' + esc(r.vkey) + '|' + w + '">' +
                '<kbd>' + (i + 1) + '</kbd>' + w + '</button>';
            }).join("") +
            '<input class="dock-note" data-cvnote="' + esc(r.vkey) + '" value="' + esc(r.vnote) + '" placeholder="비고 — 근거를 함께">'
          : '<span class="mut">이 항목에는 저장할 판정 키가 없습니다.</span>') +
        (at + 1 < rows.length
          ? '<button type="button" class="btn btn-sm btn-primary" data-act="selectRtmRow" data-arg="' + esc(rows[at + 1].key) + '">다음 →</button>'
          : '') +
      '</footer>';
    }

    var workbench;
    if (!rtmAll.length) {
      workbench = '<div class="trace-empty trace-empty-main">' +
        (state.crtmOnlyTodo && rtmHidden
          ? '아직 판정하지 않은 항목이 없습니다.<br><button type="button" data-act="toggleRtmOnlyTodo" class="rtm-more">전체 항목 보기</button>'
          : v.rtmOos.length
            ? '현재 검토 범위에 표시할 항목이 없습니다.'
            : '비교할 요구사항을 찾지 못했습니다.<br>검토 기준의 요건 ID 형식이 두 문서와 맞는지 확인해 주세요.') +
        '</div>';
    } else {
      workbench = '<aside class="trace-queue">' + queueHead + queueHtml(rtmAll, active.key) +
          (rtmHidden ? '<div class="trace-queue-hidden">판정 완료 ' + rtmHidden + '건을 숨겼습니다.</div>' : '') +
          (v.rtmOos.length ? '<div class="trace-oos">' +
            '<button type="button" data-act="toggleRtmOos">' + (state.crtmOosOpen ? '▾' : '▸') + ' 범위 밖 ' + v.rtmOos.length + '건</button>' +
            (state.crtmOosOpen ? '<div>' + v.rtmOos.map(function (r) {
              return '<span><b class="mono">' + esc(r.upperId) + '</b>' + esc(r.title || r.text || '') + '</span>';
            }).join("") + '</div>' : '') + '</div>' : '') +
        '</aside>' +
        '<div class="trace-main">' + detailHead(active, rtmAll) +
          '<div class="trace-detail" data-scroll="traceDetail"><div class="trace-evidence-grid" style="' + contentAnim("trace-detail", active.key) + '">' +
            upperCard(active) + lowerCard(active) + '</div></div>' +
          dockHtml(active, rtmAll) +
        '</div>';
    }

    // 탭 둘: 요건 판정(작업대) · 기준 판정(문서쌍 전체 기준). 단일 검토 결과 패널과 같은 탭 부품.
    var extraN = (v.cmpAdditional && v.cmpAdditional.total) || 0;
    var cmpTab = extraN && state.cmpTab === "criteria" ? "criteria" : "rtm";
    var cmpTabs = extraN
      ? '<div class="cmp-tabs single-result-tabs" role="group" aria-label="비교 결과 영역">' +
          [["rtm", "요건 판정", rtmAll.length], ["criteria", "기준 판정", extraN]].map(function (t) {
            return '<button type="button" class="single-result-tab' + (cmpTab === t[0] ? ' is-active' : '') +
              '" data-act="setCmpTab" data-arg="' + t[0] + '" aria-pressed="' + (cmpTab === t[0] ? 'true' : 'false') + '">' +
              t[1] + '<b>' + t[2] + '</b></button>';
          }).join("") + '</div>'
      : '';
    return '<div class="results-shell">' + strip +
      '<div class="cmp-results-workspace"><div class="rtm-list-shell">' + cmpTabs +
        (cmpTab === "criteria"
          ? compareAdditionalSection(v)
          : '<div id="traceWorkbench" class="rtm-list-body">' + workbench + '</div>') +
      '</div></div>' +
    '</div>';
  }

  // 검토 기준 3층. 검토는 공통 ∪ 팀 ∪ 업로드를 합쳐 돌지만(resolve_criteria),
  // 화면에는 어디서 온 기준인지 갈라 보여야 한다 — 팀에 "이건 우리 기준이고
  // 저건 전사 공통"이라고 말할 수 있어야 하고, 고칠 수 있는 층도 업로드뿐이다.
  //
  // 항목마다 howChecked 를 단다. 기준은 수십 건인데 검사기가 실제로 받는 것은
  // 그중 일부다. 그 차이가 안 보이면 검토자는 "기준에 있으니 검사됐겠지"라고
  // 읽는다 — 이 도구가 낼 수 있는 최악의 거짓말이다.
  // [배경, 글자, 테두리]. 셋째 칸이 있는 이유는 **색만으로는 안 갈렸기** 때문이다 —
  // 웜 뉴트럴(규칙 · 자동)과 회색(사람이 확인)이 11px 칩에서 거의 같은 회색으로
  // 보였다. 그래서 색이 아니라 **꼴**로 가른다: 자동으로 도는 것은 면이 차고,
  // 사람 몫은 테두리만 남은 빈 칩이다(아직 아무도 안 채운 칸). 남은 색차도 같이
  // 벌렸다 — 규칙은 웜 브라운, 사람은 쿨 슬레이트다.
  // 글자는 --neutral-ink 다. --neutral-strong(Slate 200)은 **면** 색이라
  // 흰 바탕에서 1.14:1 로 사실상 안 보였다(팔레트 주석도 쓰지 말라고 적어 뒀다).
  var HOW_TONE = {
    "규칙 · 자동": ["var(--neutral-weak)", "var(--neutral-ink)", "transparent"],
    "LLM · 자동": ["var(--accent-weak)", "var(--accent-ink)", "transparent"],
    "사람이 확인": ["transparent", "var(--sev-info-fg)", "var(--sev-info-bd)"],
    "AI 꺼짐 · 미검토": ["var(--sev-min-bg)", "var(--sev-min-fg)", "transparent"]
  };

  var HOW_ORDER = ["규칙 · 자동", "LLM · 자동", "사람이 확인", "AI 꺼짐 · 미검토"];
  var ICON_CHEV = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';

  function howChip(label, n) {
    var t = HOW_TONE[label] || HOW_TONE["사람이 확인"];
    return '<span class="clay-chip" style="background:' + t[0] + ';color:' + t[1] +
        ';border-color:' + t[2] + ';">' +
      esc(label) + (n == null ? "" : '<b>' + n + '</b>') + '</span>';
  }

  // 항목 한 줄. 접히면 제목만, 펼치면 상세 전문까지 보여 준다.
  // 담당 Agent·검사기 이름·출처(요구사항 xlsx 행 번호)는 여기 없다 — 셋 다 이
  // 화면을 보는 사람의 것이 아니었다(앞 둘은 코드 안 이름이고 오른쪽 칩이 이미
  // "자동인가 사람 몫인가"를 말한다, 출처는 기준을 **관리하는** 쪽이 되짚는
  // 값이다). 검증 대상은 줄마다 되풀이하는 대신 소제목이 진다(itemsHtml).
  // 값은 전부 yaml 에 그대로 있다.
  // 예전에는 note 의 **첫 줄만** 그렸다 — 기준 본문이 번호 매긴 여러 줄인데
  // 화면에는 1번만 보이고 나머지는 아무 데도 없었다. 검토자가 "이 기준이 무엇을
  // 요구하나"를 알 수 없으면 이 화면은 목록 흉내만 내는 셈이다.
  //: 규칙 이름 → 사람 말. "규칙 · 자동"만으로는 **무엇을** 검사하는지 알 수 없다 —
  //: 100 줄짜리 목록에서 검토자가 제일 궁금한 것이 그것이다(약어를 보나, 파일명을
  //: 보나). 모르는 이름은 안 그린다: 없는 설명을 지어내면 목록이 거짓말을 한다.
  var CHECK_LABEL = {
    placeholder: "미작성 표시(TBD 등)",
    required_sections: "필수 장절 유무",
    field_presence: "표·결재란 칸 값",
    filename: "파일명 규칙",
    abbrev: "약어 목록 ↔ 본문",
    reflist: "참조문서 목록 ↔ 본문",
    text_pattern: "표기 규칙(날짜·단위 등)",
    header_footer: "머릿말·꼬리말",
    fontsize: "글꼴 크기",
    rtm_forward: "문서 간 · 누락",
    rtm_reverse: "문서 간 · 근거 없음",
    rtm_content: "문서 간 · 내용 대조"
  };

  function criteriaItemRow(it, key, open) {
    var head = (it.text || "").trim();
    var note = (it.note || "").trim();
    // 접힌 줄은 **제목 한 줄**이다. 그래야 203 건이 한눈에 훑히는 체크리스트가
    // 되고, 기준 본문은 필요할 때 편다.
    //
    // "왜 어떤 줄은 눌리고 어떤 줄은 안 눌리나" — 실측(2026-08-20) 203 건 중
    // 114 건은 note 가 아예 없어 펼 것이 없다. 그 차이를 **화살표로 드러낸다**:
    // 화살표가 있으면 더 있는 것, 없으면 그게 전부다. 눌림 여부가 데이터에
    // 숨어 있으면 변덕으로 보이지만, 손잡이가 보이면 규칙으로 읽힌다.
    // (한때 본문 두 줄을 미리 보여주고 접었는데, 짧은 본문은 접어도 다 보여서
    //  누르면 줄만 바뀌었다. 제목만 남기면 그 어중간함이 사라진다.)
    var open = !!note && open;
    // 세부 목록도 검토 기록·추가 기준과 같은 레코드 문법을 쓴다. 번호는 별도
    // 좁은 열로 떼지 않고 기준명의 식별표로 붙이고, group은 실제 '검증 대상'
    // 열에 둔다. 중간의 그룹 띠가 사라져도 각 행만 읽으면 맥락이 완결된다.
    var tone = HOW_TONE[it.howChecked] || HOW_TONE["사람이 확인"];
    var checkLabel = CHECK_LABEL[it.check] || "직접 확인";
    return '<div class="record-row record-criteria-grid clay-row criteria-record-row' +
        (note ? " is-fold" : "") + '"' +
        (note
          ? ' data-act="toggleCriteriaItem" data-arg="' + esc(key) + '"' +
            ' role="button" tabindex="0" aria-expanded="' + (open ? "true" : "false") + '"'
          : "") + '>' +
      '<div class="record-primary criteria-record-main">' +
        '<span class="record-criterion-no mono">' + esc(it.no || "—") + '</span>' +
        '<span><strong>' + esc(head || "기준 내용 없음") + '</strong></span>' +
      '</div>' +
      '<span class="record-muted">' + esc((it.group || "").trim() || "전체 문서") + '</span>' +
      '<span class="record-result criteria-record-check"><i style="background:' + tone[1] + ';"></i>' +
        esc(checkLabel) + '</span>' +
      '<span class="criteria-record-how">' + howChip(it.howChecked) + '</span>' +
      (note ? '<span class="criteria-row-chevron">' + ICON_CHEV + '</span>' : '<span></span>') +
      (open ? '<div class="clay-note criteria-detail-note">' + '<span class="criteria-note-label">세부 기준</span>' +
        '<div class="criteria-note-copy">' + esc(note) + '</div></div>' : "") +
    '</div>';
  }



  // 기준 파일의 순서는 그대로 두되, 검증 대상은 중간 소제목 띠가 아니라 고정
  // 열에 둔다. 다른 레코드 목록처럼 헤더 하나 아래에서 곧바로 훑을 수 있다.
  function itemsHtml(L, items) {
    // 검색·방식 필터 뒤의 배열 위치를 쓰면 펼친 기준의 식별자가 바뀐다.
    var original = ((state.clayers.list || []).filter(function (layer) { return layer.id === L.id; })[0] || L).items;
    return '<div class="record-head record-criteria-grid criteria-record-head" aria-hidden="true">' +
        '<span>기준</span><span>검증 대상</span><span>검사 항목</span><span>확인 방식</span><span></span>' +
      '</div>' + items.map(function (it, i) {
        var index = original.indexOf(it);
        var key = L.id + "|" + (it.no || "") + "|" + (index < 0 ? i : index);
        return criteriaItemRow(it, key, !!state.clayers.openItem[key]);
      }).join("");
  }

  // how: 고른 검사 방식 필터("" = 전체). 검토 진행 중 모달도 이 카드를 쓰는데,
  // 거기엔 필터가 없어 인자를 안 넘긴다.
  function criteriaLayerCard(L, open, how) {
    var counts = {};
    L.items.forEach(function (i) { counts[i.howChecked] = (counts[i.howChecked] || 0) + 1; });
    var automatic = (counts["규칙 · 자동"] || 0) + (counts["LLM · 자동"] || 0);
    var manual = counts["사람이 확인"] || 0;
    var unreviewed = counts["AI 꺼짐 · 미검토"] || 0;
    var items = how ? L.items.filter(function (i) { return i.howChecked === how; }) : L.items;
    var body = items.length
      ? itemsHtml(L, items)
      : '<div style="font-size:13px;color:var(--text-2);padding:10px 0;border-top:1px solid var(--line);">' +
          '이 층에는 ‘' + esc(how) + '’ 항목이 없습니다.</div>';
    return '<div class="criteria-layer clay-card' + (open ? " is-open" : "") + '">' +
      '<div class="criteria-layer-toggle clay-head" data-act="toggleCriteriaLayer" data-arg="' + esc(L.id) + '"' +
          ' role="button" tabindex="0" aria-expanded="' + (open ? "true" : "false") + '">' +
        '<span class="clay-scope">' + esc(scopeLabel(L.scope)) + '</span>' +
        '<span class="criteria-layer-title"><strong class="clay-name">' + esc(L.name) + '</strong>' +
          (L.editable ? "" : '<small>읽기 전용</small>') + '</span>' +
        '<span class="criteria-layer-count"><b>' + L.items.length + '</b>개</span>' +
        '<span class="criteria-layer-coverage">' +
          '<span><i class="is-auto"></i>자동 ' + automatic + '</span>' +
          '<span><i class="is-manual"></i>직접 ' + manual + '</span>' +
          (unreviewed ? '<span><i class="is-off"></i>미검토 ' + unreviewed + '</span>' : "") +
        '</span>' +
        '<span class="clay-chev">' + ICON_CHEV + '</span>' +
      '</div>' +
      (open ? '<div class="criteria-layer-body clay-items">' + body + '</div>' : "") +
    '</div>';
  }

  function criteriaLayersSection(v) {
    var s = v.clayers;
    if (s.busy) return '<div style="font-size:13px;color:var(--text-2);padding:8px 0;">검토 기준을 읽는 중…</div>';
    if (s.error) return errorBanner(s.error);
    if (!s.list) return "";
    var readOnly = s.list.filter(function (L) { return !L.editable; });
    if (!readOnly.length) {
      return '<div style="font-size:13px;color:var(--text-2);padding:4px 0;">' +
        '고른 팀이 없어 팀 기준을 못 보여줍니다. 로그인하면 소속 팀 기준이 자동으로 걸립니다.</div>';
    }
    // 층을 가로지르는 합계. "공통 12 + 팀 30" 을 사람이 더하게 두지 않는다.
    var counts = {}, total = 0;
    readOnly.forEach(function (L) {
      L.items.forEach(function (i) { counts[i.howChecked] = (counts[i.howChecked] || 0) + 1; total++; });
    });
    var q = (s.q || "").trim();
    var search = '<label class="criteria-search">' + ICONS.search +
      '<input data-criteria-q value="' + esc(s.q || "") + '" ' +
        'placeholder="기준 검색 — 예: 약어, 날짜, 추적"></label>';
    var filters = '<button class="clay-fchip' + (s.how ? "" : " on") + '" data-act="setCriteriaHow" data-arg="">' +
        '전체 <b>' + total + '</b></button>' +
      HOW_ORDER.filter(function (k) { return counts[k]; }).map(function (k) {
        var t = HOW_TONE[k];
        return '<button class="clay-fchip' + (s.how === k ? " on" : "") + '" data-act="setCriteriaHow" data-arg="' + esc(k) + '">' +
          '<span class="dot" style="background:' + t[1] + ';"></span>' + esc(k) +
          ' <b>' + counts[k] + '</b></button>';
      }).join("");
    // 필터를 걸면 층을 **자동으로 편다**. 접힌 채로 두면 칩을 눌러도 화면이
    // 그대로라 필터가 죽은 것처럼 보인다.
    // 검색어가 있으면 층을 펴고 걸린 항목만 남긴다. 한 건도 없으면 그렇게 말한다 —
    // 빈 카드만 늘어놓으면 검색이 고장 난 것처럼 보인다.
    var shown = readOnly.map(function (L) {
      if (!q) return L;
      var hit = L.items.filter(function (i) {
        return ((i.text || "") + " " + (i.note || "") + " " + (i.no || "") + " " +
                (CHECK_LABEL[i.check] || "")).toLowerCase().indexOf(q.toLowerCase()) >= 0;
      });
      return { id: L.id, scope: L.scope, name: L.name, editable: L.editable, items: hit };
    });
    var hits = shown.reduce(function (n, L) {
      return n + L.items.filter(function (it) { return !s.how || it.howChecked === s.how; }).length;
    }, 0);
    var layerHtml = shown.filter(function (L) { return !q || L.items.length; }).map(function (L) {
      return criteriaLayerCard(L, !!s.open[L.id] || !!s.how || !!q, s.how);
    }).join("");
    return '<div class="criteria-browser">' +
      '<div class="criteria-tools">' + search +
        '<div class="criteria-filters" aria-label="확인 방식 필터">' + filters + '</div>' +
      '</div>' +
      (q ? '<div class="criteria-query-result">‘' + esc(q) + '’ 검색 결과 <b>' + hits + '</b>건</div>' : "") +
      '<div class="criteria-catalog">' +
        '<div class="criteria-layer-headings" aria-hidden="true">' +
          '<span>범위</span><span>기준 세트</span><span>항목</span><span>검토 분담</span><span></span>' +
        '</div>' +
        (layerHtml || '<div class="criteria-empty">검색 조건에 맞는 기준이 없습니다.</div>') +
      '</div>' +
    '</div>';
  }

  // 관리 화면은 세트 중첩 대신 항목 목록과 독립 상세 영역을 쓴다.
  // 실행 전 상태는 판정이 아니다. 설정을 검증하지 않았으면 준비됨을 약속하지 않는다.
  function criteriaCatalogModel() {
    var s = state.clayers;
    var rows = [];
    (s.list || []).forEach(function (L) {
      var scope = L.editable ? "추가" : (L.scope === "공통" ? "공통" : "팀");
      (L.items.length ? L.items : [null]).forEach(function (it, i) {
        rows.push({ key: L.id + "|" + i, layer: L, scope: scope, item: it,
          text: it ? it.text : L.name, how: it ? (it.howChecked || "사람이 확인") : "" });
      });
    });
    var q = (s.q || "").trim().toLowerCase();
    // 범위(scope)를 뺀 나머지 거르개. 범위 탭이 "이걸 누르면 몇 개가 남나"를
    // 말하려면 검색·확인방식은 이미 걸린 채로 세어야 한다. 예전엔 탭이 rows 를
    // 통째로 세어서, 검색을 치면 탭 숫자와 실제 목록 수가 갈렸다.
    var rest = function (r) {
      return (!s.how || r.how === s.how) &&
        (!q || [r.text, r.layer.name, r.item && r.item.note, r.item && r.item.group,
          r.item && r.item.no].join(" ").toLowerCase().indexOf(q) >= 0);
    };
    var shown = rows.filter(function (r) {
      return (!s.scope || s.scope === r.scope) && rest(r);
    });
    return { rows: rows, shown: shown, rest: rest,
      selected: shown.filter(function (r) { return r.key === s.selected; })[0] || null };
  }

  function criteriaReadiness(r) {
    if (r.layer.error) return { label: "조회 실패", tone: "needs", note: r.layer.error };
    if (!r.item) return { label: "항목 없음", tone: "manual", note: "등록된 기준 항목이 없습니다." };
    if (r.how === "사람이 확인") return { label: "직접 확인", tone: "manual",
      note: "자동으로 판정하지 않는 기준입니다. 원문을 보고 검토자가 확인해야 합니다." };
    if (r.how === "AI 꺼짐 · 미검토") return { label: "AI 꺼짐", tone: "needs",
      note: "AI 검토가 꺼져 있어 이번 설정으로는 실행되지 않습니다." };
    return { label: "실행 시 확인", tone: "manual",
      note: "검사 방식이 연결된 기준입니다. 실제 실행 여부는 적용 설정과 문서를 읽은 뒤 확인합니다. 이 표시는 검토 완료나 이상 없음을 뜻하지 않습니다." };
  }

  function criteriaWorkspaceParts() {
    var s = state.clayers, m = criteriaCatalogModel();
    var initial = !s.list, loading = initial && s.busy;
    var scopes = ["", "공통", "팀", "추가"];
    var tabs = scopes.map(function (scope) {
      var n = m.rows.filter(function (r) { return (!scope || r.scope === scope) && m.rest(r); }).length;
      var on = (!s.scope && !scope) || s.scope === scope;
      return '<button type="button" class="record-filter' + (on ? ' is-on' : '') +
        '" data-act="setCriteriaScope" data-arg="' + scope + '" aria-pressed="' + on + '">' +
        (scope || "전체") + ' <b>' + (initial ? '—' : n) + '</b></button>';
    }).join("");
    var rows = m.shown.map(function (r) {
      var status = criteriaReadiness(r);
      // 포인터는 행 전체, 키보드는 제목의 네이티브 버튼을 사용한다.
      // 표 의미를 유지하고 같은 행에 불필요한 탭 정지점을 두 개 만들지 않는다.
      return '<tr data-act="selectCriterion" data-arg="' + esc(r.key) + '"' +
        (m.selected && m.selected.key === r.key ? ' class="is-selected"' : '') + '>' +
        '<td><button type="button" class="criteria-title-button" data-act="selectCriterion" data-arg="' +
          esc(r.key) + '" aria-controls="criteriaInspector" aria-pressed="' + !!(m.selected && m.selected.key === r.key) + '">' +
          esc(r.text || "기준 내용 없음") + '</button><div class="criteria-row-context">' +
          '<span class="criteria-scope-label">' + esc(r.scope) + '</span>' +
          (r.item && r.item.no ? '<span class="criteria-reference">' + esc(r.item.no) + '</span>' : '') +
          '<span>' + esc(r.item ? (r.item.group || "전체 문서") : r.layer.name) + '</span></div></td>' +
        '<td class="criteria-method">' + esc(r.how || "—") + '</td>' +
        '<td><span class="criteria-preparation ' + status.tone + '"><i aria-hidden="true"></i>' +
          esc(status.label) + '</span></td></tr>';
    }).join("");
    if (loading) rows = [76, 91, 64, 84, 70, 88, 60].map(function (width) {
      return '<tr class="criteria-skeleton-row" aria-hidden="true"><td>' +
        '<span class="skel criteria-skeleton-line" style="width:' + width + '%"></span>' +
        '<span class="skel criteria-skeleton-context"></span></td>' +
        '<td><span class="skel criteria-skeleton-line"></span></td>' +
        '<td><span class="skel criteria-skeleton-line"></span></td></tr>';
    }).join("");
    var filtered = !!(s.q || s.scope || s.how);
    var summary = '<div class="criteria-list-meta"><span role="' + (s.error ? 'alert' : 'status') + '">' +
      (s.busy ? (initial ? '검토 기준을 불러오는 중…' : '목록 갱신 중') : s.error ?
        (initial ? '검토 기준을 불러오지 못했습니다. ' : '갱신하지 못해 이전 목록을 표시합니다. ') + esc(s.error) :
        m.shown.length + '개 표시' + (filtered ? ' · 전체 ' + m.rows.length + '개' : '')) +
      '</span>' + (s.error ? '<button type="button" data-act="retryCriteriaCatalog">다시 불러오기</button>' :
        filtered ? '<button type="button" data-act="resetCriteriaCatalog">필터 초기화</button>' : '') + '</div>';
    var body =
      '<div class="criteria-table-scroll" data-scroll="criteria-catalog-list"><table class="criteria-work-table">' +
        '<thead><tr><th scope="col">기준 / 검증 대상</th><th scope="col">확인 방식</th><th scope="col">실행 전 상태</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table>' +
        (!rows && !s.busy && !s.error ? '<div class="criteria-catalog-empty">' +
          (filtered ? '조건에 맞는 기준이 없습니다.' : '등록된 검토 기준이 없습니다.') + '</div>' : '') + '</div>';
    var records = '<div id="criteriaCatalogBody" aria-busy="' + !!s.busy + '">' + body +
      '</div><div id="criteriaCatalogStatus">' + summary + '</div>';
    var r = m.selected;
    var detail = '<div class="criteria-inspector-empty"><h2>기준 상세</h2>' +
      '<p>목록에서 확인할 기준을 선택하세요.</p><span>세부 기준·확인 방법·출처가 이곳에 표시됩니다.</span></div>';
    if (r) {
      var status = criteriaReadiness(r), it = r.item || {};
      var actions = r.layer.editable
        ? '<div class="criteria-inspector-actions">' +
            (state.checklistPickReturn
              ? '<button type="button" class="btn btn-primary" data-act="selectChecklistForReview" data-arg="' + esc(r.layer.id) + '">' +
                (state.reviewChecklistId === r.layer.id ? '선택됨' : '이 기준 선택') + '</button>'
              : '<button type="button" class="btn btn-primary" data-act="startChecklistRun" data-arg="' + esc(r.layer.id) +
                '"' + (!r.item || r.layer.error ? ' disabled' : '') + '>항목별로 직접 판정</button>') +
            '<p>이 항목이 포함된 ‘' + esc(r.layer.name) + '’ 전체에 적용합니다.</p>' +
            '<details class="criteria-set-actions"><summary>추가 기준 관리</summary>' +
              '<button type="button" class="btn btn-sm btn-primary" data-act="askDeleteChecklist" data-arg="' + esc(r.layer.id) +
                '">추가 기준 전체 삭제</button></details></div>' : '';
      detail = '<div class="criteria-detail-label"><span>기준 상세' + (it.no ? ' · ' + esc(it.no) : '') +
        '</span><button type="button" data-act="closeCriterion">닫기</button></div>' +
        '<h2 tabindex="-1" id="criterion-detail-title">' + esc(r.text || "기준 내용 없음") + '</h2>' +
        '<p class="criteria-detail-context">' + esc(r.scope + " 기준 · " + (it.group || "전체 문서")) + '</p>' +
        '<section><h3>세부 기준</h3><p>' + esc(it.note || it.text || status.note) + '</p></section>' +
        '<section><h3>확인 방법</h3><p>' + esc(CHECK_LABEL[it.check] || r.how || "직접 확인") + '</p></section>' +
        '<div class="criteria-readiness-note"><strong>' + esc(status.label) + '</strong><p>' + esc(status.note) + '</p></div>' +
        '<dl><dt>기준 세트</dt><dd>' + esc(r.layer.name) + '</dd><dt>출처</dt><dd>' +
          esc(it.source || "등록된 출처 없음") + '</dd><dt>확인 방식</dt><dd>' + esc(r.how || "—") +
          '</dd></dl>' + actions +
        '<footer>' + (r.layer.editable ? '추가 기준 — 검토할 때 선택합니다.' :
          '읽기 전용 · 공통·팀 기준 변경은 기준 관리자에게 요청하세요.') + '</footer>';
    }
    detail = '<div data-motion="criteria-detail" style="' + contentAnim("criteria-detail", r ? r.key : "") + '">' + detail + '</div>';
    return { tabs: tabs, records: records, body: body, summary: summary, detail: detail,
      detailKey: JSON.stringify([r, !!state.checklistPickReturn, state.reviewChecklistId || ""]) };
  }

  function criteriaHowSelect() {
    var methods = ["", "규칙 · 자동", "LLM · 자동", "사람이 확인", "AI 꺼짐 · 미검토"];
    return selectField("criteriaHow", "모든 확인 방식", methods.map(function (how) {
      return { id: how || "all", name: how || "모든 확인 방식" };
    }), { value: state.clayers.how || "all", cls: "sel-sm criteria-how-select", ariaLabel: "확인 방식" });
  }

  function criteriaWorkspace() {
    var s = state.clayers, p = criteriaWorkspaceParts();
    return '<div class="record-tools criteria-list-tools"><label class="record-search criteria-catalog-search">' + ICONS.search +
        '<input type="search" data-criteria-q value="' + esc(s.q || "") + '" aria-label="기준 검색" placeholder="기준명·검증 대상 검색"></label>' +
      '<div class="criteria-workspace-filters">' +
        criteriaHowSelect() + '</div></div>' +
      '<section class="criteria-workspace record-surface" aria-label="검토 기준 목록과 상세">' +
      // 숫자는 범위 탭이 진다 — 「기준 목록 N」과 「전체 N」이 같은 수를 두 번
      // 말하고 있었다(2026-09-18). 검토 기록 화면은 처음부터 거르개 숫자만 둔다.
      '<div class="record-toolbar criteria-workspace-tools"><div class="record-view-name">기준 목록</div>' +
        '<div id="criteriaScopeTabs" class="record-filters criteria-scope-tabs" aria-label="기준 범위">' + p.tabs + '</div></div>' +
      '<div class="criteria-workspace-body"><div id="criteriaCatalogRecords" class="criteria-catalog-records">' + p.records +
        '</div><aside id="criteriaInspector" class="criteria-inspector" aria-label="선택한 기준 상세" data-scroll="criteria-inspector">' +
          p.detail + '</aside></div></section>';
  }

  function checklistsView(v) {
    // 추가 기준은 수기 등록만 남았다(2026-09-16) — 체크리스트 xlsx 는 "체크리스트
    // 검토"(부록 B 초안)로 간다. 두 화면이 같은 파일을 받으면 어느 쪽이 맞는지
    // 헷갈린다. 진입이 하나뿐이라 접는 메뉴도 뺐다.
    var listing = !state.cdraft && !v.clibDetail;
    var header = pageHead("검토 기준", "문서에 적용하는 기준과 확인 방법을 살펴봅니다.",
      listing
        ? '<button type="button" class="btn btn-primary" data-act="writeChecklist">기준 추가</button>'
        : "");

    // 단일 검토에서 "고르러" 왔으면 그 사실과 돌아가는 길을 위에 띄운다.
    // 고르면 곧장 돌아가지 않고 여기서 "선택됨"을 확인시킨 뒤, 돌아가기는
    // 사람이 누른다 — 버튼 누르자마자 화면이 튀면 순간이동처럼 어색하다.
    var pickedChecklist = (v.clib.list || []).filter(function (c) {
      return c.id === v.reviewChecklistId; })[0];
    var pickBanner = v.checklistPickReturn
      ? (pickedChecklist
          // 골랐을 때만 강조색을 칠한다 — 선택이 됐다는 신호다.
          ? '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;' +
              'padding:12px 16px;border-radius:var(--r-md);background:var(--accent-weak);border:1px solid var(--accent);">' +
              '<span style="font-size:13px;color:var(--accent-ink);font-weight:600;min-width:0;">' +
                '‘' + esc(pickedChecklist.name) + '’ 선택됨 — 이 기준으로 검토합니다.</span>' +
              '<button data-act="backToReviewFromChecklist" style="font-size:14px;background:var(--accent-surface);' +
                'color:#fff;border:none;border-radius:var(--r-sm);padding:8px 16px;cursor:pointer;font-weight:700;' +
                'white-space:nowrap;">검토로 돌아가기 →</button>' +
            '</div>'
          // 아직 안 골랐으면 색 없이 담백한 안내만 — 강조는 선택 신호로 아껴 둔다.
          : '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;' +
              'padding:12px 16px;border-radius:var(--r-md);background:transparent;border:1px solid var(--line);">' +
              '<span style="font-size:13px;color:var(--text-3);">' +
                '추가 기준을 선택한 뒤 ‘검토로 돌아가기’를 눌러 주세요.</span>' +
              '<button type="button" class="btn btn-sm btn-ghost" data-act="backToReviewFromChecklist">← 검토로 돌아가기</button>' +
            '</div>')
      : '';


    return '<div class="page-shell page-shell-primary" data-scroll="clib">' +
      '<div class="page-container page-stack">' +
        pickBanner + header + errorBanner(v.clib.error) +
        (state.cdraft ? draftCard(v)
          : v.clibDetail ? clibDetailCard(v)
          : criteriaWorkspace()) +
      '</div>' +
    '</div>' + (state.confirmChecklist ? confirmDialog({
      title: "추가 기준 전체 삭제",
      body: '<b>' + esc(state.confirmChecklist.name) + '</b>의 ' + state.confirmChecklist.count +
        '개 항목을 모두 삭제할까요?<br>이 작업은 되돌릴 수 없습니다.',
      act: "deleteChecklist", arg: state.confirmChecklist.id
    }) : '');
  }

  // 추가 기준 직접 작성(과제 층). 파일 업로드와 다른 점은 **검사 방식과 과제
  // 설정값을 함께 적는다**는 것이다 — 파일에는 그 열이 없어 올린 항목이 전부
  // "사람 확인"으로 떨어졌다. 규칙 검사기 연결(check)은 여기 두지 않는다:
  // 쓰는 일이 드물고 이름을 외워야 해서, 필요해지면 그때 넣는다.
  // 두 문서를 올렸으면 "이 문서가 맡은 범위" 를 계산해 짚어 준다.
  //
  // 예전에는 "공통 앞부분을 적으세요" 라는 말만 있었다. 어디서 잘라야 하는지는
  // 이 설계서가 무엇을 맡았는지 알아야 정해지는데, 그걸 알려고 이 도구를 쓴다.
  // 게다가 검사는 re.search 라 앞부분이 아니라 **아무 자리**가 걸린다 —
  // 실측(PRJX)의 정답은 네 번째 마디 `-01-` 이었다.
  //
  // app.js 의 input 리스너가 이 블록만 갈아끼운다(data-scopecalc) — render()
  // 를 부르면 <input> 이 새로 만들어져 커서와 한글 조합이 날아간다.
  function scopeCalc(v) {
    var up = (v.cslotDetect.compareA && v.cslotDetect.compareA.ids) || [];
    var low = (v.cslotDetect.compareB && v.cslotDetect.compareB.ids) || [];
    var typed = (state.cscope || "").trim();
    var body = "";
    if (!up.length || !low.length) {
      body = '<div class="cscope-note">문서 두 개를 올리면 이 문서가 맡은 범위를 짚어 드립니다.</div>';
    } else {
      var cands = H.scopeCandidates(up, low);
      var chips = cands.map(function (c) {
        return '<button class="cscope-chip' + (typed === c.pattern ? " on" : "") +
          '" data-act="pickScope" data-arg="' + esc(c.pattern) + '">' +
          '<span class="mono cscope-chip-p">' + esc(c.pattern) + '</span>' +
          '<span class="cscope-chip-n">요건 ' + c.inScope + ' · 범위 밖 ' + c.outScope + '</span>' +
        '</button>';
      }).join("");
      chips += '<button class="cscope-chip' + (typed ? "" : " on") +
        '" data-act="pickScope" data-arg=""><span class="cscope-chip-p">전체</span>' +
        '<span class="cscope-chip-n">요건 ' + up.length + '</span></button>';
      body = '<div class="cscope-lead">이 하위 문서에서 찾은 요건으로 만든 후보</div>' +
             '<div class="cscope-chips">' + chips + '</div>';
      var n = H.scopeCount(up, typed);
      if (n && n.bad) {
        body += '<div class="cscope-now bad">이 형식을 읽지 못했습니다 — 위 후보를 누르거나 다시 적어 주세요.</div>';
      } else if (n && typed) {
        body += '<div class="cscope-now">지금 적은 범위 — 상위 요건 <b>' + n.inScope +
                '개</b>가 검사 대상, ' + n.outScope + '개는 범위 밖</div>';
      }
    }
    return '<div class="cscope-calc" data-scopecalc>' + body + '</div>';
  }

  // 적은 예시를 무엇으로 읽었는지 그 자리에서 돌려준다. 이 화면엔 문서가 없어
  // "몇 곳 걸립니다"를 못 세므로(감지는 문서를 올린 비교 화면의 몫이다),
  // 되읽기가 검토자의 유일한 확인 수단이다. 틀리게 적으면 여기서 보인다.
  //
  // app.js 의 input 리스너가 이 마크업만 갈아끼운다 — render() 를 부르면
  // <input> 이 통째로 새로 만들어져 한글 조합과 커서가 날아간다.
  function idReadback(d) {
    var adv = (d.idPattern || "").trim();
    var made = adv ? null : H.idPatternFrom(d.idExample);
    var body;
    if (adv) {
      body = '직접 쓴 형식을 씁니다 — <span class="mono">' + esc(adv) + '</span>';
    } else if (!made) {
      body = '예시를 적으면 어떤 형식으로 읽었는지 여기에 보여 드립니다.';
    } else {
      body = '이렇게 읽었습니다 — <b>' + esc(made.say) + '</b>';
    }
    return '<div class="cdraft-read' + (made ? "" : " off") + '" data-idread>' +
      body + '</div>';
  }

  function draftCard(v) {
    var d = state.cdraft;
    var MODES = [["사람", "사람이 확인"], ["LLM-조각", "AI · 문장 단위"],
                 ["LLM-문서", "AI · 문서 전체"]];
    var rows = d.items.map(function (it, i) {
      var modes = MODES.map(function (m) {
        return '<button class="cdraft-mode' + (it.mode === m[0] ? " on" : "") +
          '" data-act="draftSetMode" data-arg="' + i + '|' + m[0] + '">' + m[1] + '</button>';
      }).join("");
      return '<div class="cdraft-row">' +
        '<span class="mono cdraft-no">' + (i + 1) + '</span>' +
        '<div style="flex:1;min-width:0;">' +
          '<input class="cdraft-in" data-draft="item:' + i + '" value="' + esc(it.text) + '" ' +
            'placeholder="검토 항목 — 예: 표 제목이 표 위에 있는가">' +
          '<div class="cdraft-modes">' + modes + '</div>' +
        '</div>' +
        '<button class="btn btn-sm btn-ghost" data-act="draftDel" data-arg="' + i + '" style="flex:none;">삭제</button>' +
      '</div>';
    }).join("");

    function field(key, label, placeholder, help) {
      return '<div class="cdraft-f">' +
        '<label class="cdraft-lbl" for="cdraft-' + key + '">' + label + '</label>' +
        '<input class="cdraft-in" id="cdraft-' + key + '" data-draft="' + key + '" ' +
          'value="' + esc(d[key] || "") + '" placeholder="' + placeholder + '">' +
        '<div class="cdraft-help">' + help + '</div>' +
      '</div>';
    }

    return '<div class="cdraft">' +
      '<div class="cdraft-h">추가 기준 직접 작성</div>' +
      '<div class="cdraft-sub">' +
        '공통·팀 기준에 더해 이번 과제에만 적용할 기준입니다. 같은 값이 팀 기준에도 있으면 <b>여기 적은 값이 이깁니다</b>.' +
      '</div>' +
      (d.error ? '<div style="margin-top:14px;">' + errorBanner(d.error) + '</div>' : '') +
      field("name", "이름", "예: PRJX 2세부 과제 기준", "기준 목록에서 이 이름으로 고릅니다.") +
      '<div class="cdraft-sec">' +
        '<div class="cdraft-sec-h">과제 설정값</div>' +
        '<div class="cdraft-sec-sub">' +
          '과제마다 달라 팀 기준에 넣을 수 없는 값입니다. 여기 적어 두면 검토·비교마다 다시 입력하지 않아도 됩니다.' +
        '</div>' +
        // **정규식을 요구하지 않는다.** 비교 화면이 남긴 교훈이다 — 예시가
        // 정규식이면 그걸 쓸 줄 아는 사람만 채운다. 여기는 문서가 없어
        // 감지(/api/detect)를 못 하므로, 대신 적은 예시를 되읽어 돌려준다.
        '<div class="cdraft-f">' +
          '<label class="cdraft-lbl" for="cdraft-idExample">요건 ID 예시</label>' +
          '<input class="cdraft-in" id="cdraft-idExample" data-draft="idExample" ' +
            'value="' + esc(d.idExample || "") + '" placeholder="문서에서 요건 번호 하나를 그대로 옮겨 적으세요 — 예: RQ-SFR-PR-01-001">' +
          '<div class="cdraft-help">문서 간 비교의 추적성 검사가 이 형식으로 요건을 찾습니다. 비우면 팀 기준의 값을 씁니다.</div>' +
          idReadback(d) +
          '<details class="cdraft-adv"' + ((d.idPattern || "").trim() ? " open" : "") + '>' +
            '<summary>형식을 직접 쓰기 (정규식)</summary>' +
            '<input class="cdraft-in" data-draft="idPattern" value="' + esc(d.idPattern || "") + '" ' +
              'placeholder="예: RQ-[A-Z]{2,4}-[A-Z]{2}-\\d{2}-\\d{3}">' +
            '<div class="cdraft-help">적으면 위 예시 대신 이 형식을 씁니다. 종류 코드 길이가 문서마다 다를 때처럼, 예시 하나로는 못 담는 경우에 씁니다.</div>' +
          '</details>' +
        '</div>' +
        field("scope", "하위 문서가 맡은 요건 범위", "예: RQ-SFR-PR-01",
              "상세설계서 한 권이 요구사항 전체를 담는 일은 드뭅니다. 맡은 요건 ID 에 공통으로 든 조각 하나를 적으면 그것만 검사합니다. " +
              "여기 적은 값은 <b>기본값</b>이고, 비교할 때 문서쌍마다 바꿀 수 있습니다.") +
      '</div>' +
      '<div class="cdraft-sec">' +
        '<div style="display:flex;align-items:baseline;gap:10px;">' +
          '<span class="cdraft-sec-h">검토 항목</span>' +
          '<span style="font-size:12px;color:var(--text-3);">AI 로 정한 항목은 다음 검토부터 자동으로 걸립니다.</span>' +
        '</div>' +
        rows +
        '<button class="btn btn-sm btn-ghost btn-ghost-accent" data-act="draftAdd" style="margin-top:10px;">+ 항목 추가</button>' +
      '</div>' +
      '<div class="cdraft-acts">' +
        '<button class="btn btn-ghost" data-act="cancelDraft">취소</button>' +
        '<button class="btn btn-primary" data-act="saveDraft">' + (d.busy ? "저장 중…" : "저장") + '</button>' +
      '</div>' +
    '</div>';
  }

  // 등록된 체크리스트 상세. 이름과 개수만으로는 무엇이 등록됐는지 알 수 없고,
  // 열을 틀리게 골라 등록한 것도 열어봐야 드러난다.
  function clibDetailCard(v) {
    var c = v.clibDetail;
    var rows = (c.items || []).map(function (it) {
      return '<div class="record-row record-criteria-grid criteria-record-row">' +
        '<div class="record-primary criteria-record-main">' +
          '<span class="record-criterion-no mono">' + esc(it.no || "—") + '</span>' +
          '<span><strong>' + esc(it.text || "기준 내용 없음") + '</strong></span>' +
        '</div>' +
        '<span class="record-muted">' + esc(it.group || "전체 문서") + '</span>' +
        '<span class="record-result criteria-record-check"><i style="background:var(--sev-info-fg);"></i>직접 판정</span>' +
        '<span class="criteria-record-how">' + howChip("사람이 확인") + '</span>' +
        '<span></span>' +
      '</div>';
    }).join("");
    return '<div class="surface-list record-surface criteria-detail-surface">' +
      '<div class="record-toolbar">' +
        '<span class="record-view-name">' + esc(c.name) + ' <b>' + (c.items || []).length + '</b></span>' +
        '<span class="record-muted">추가 기준 상세</span>' +
        '<button class="btn btn-sm btn-ghost btn-ghost-accent" data-act="closeChecklist" style="margin-left:auto;">목록으로</button>' +
      '</div>' +
      '<div class="record-head record-criteria-grid criteria-record-head" aria-hidden="true">' +
        '<span>기준</span><span>검증 대상</span><span>판정</span><span>확인 방식</span><span></span>' +
      '</div>' + (rows || '<div class="record-empty">등록된 기준 항목이 없습니다.</div>') +
    '</div>';
  }

  var VERDICT_CHOICES = ["Satisfied", "Modification Required", "Not Satisfied", "N/A"];

  // 검토 전에 고르는 자리. **이름을 분명히 갈라야 한다** — 같은 화면에 이미
  // "자동 검토 기준"(엔진이 쓰는 id_pattern·required_sections)이 있다.
  // 이건 사람이 직접 항목을 채우는 것이라 "직접 확인할 체크리스트"로 부른다.
  // 항목 목록 렌더(독립 체크리스트 화면 checklistRunScreen 안에서 쓴다).
  // 자동 검토(rev)와 독립이라 LLM 을 기다리지 않는다 — 등록된 체크리스트를
  // 라이브러리에서 "검토 시작"한 순간 바로 항목이 뜬다.
  function checklistRunView(v) {
    if (!v.crun) return '<div style="padding:24px;color:var(--text-3);">검토 기준을 고르면 항목이 나옵니다.</div>';
    var head = '<div style="display:flex;align-items:center;gap:12px;padding:14px 20px;border-bottom:1px solid var(--line);">' +
      '<div style="font-weight:700;">' + esc(v.crun.name) + '</div>' +
      '<div style="font-size:13px;color:' + (v.crun.unjudged ? "var(--sev-crit-fg)" : "var(--text-3)") + ';">' +
        (v.crun.unjudged ? ('미판정 ' + v.crun.unjudged + '개 남음') : '전부 판정함') + '</div>' +
      // 저장 성공을 말로 남긴다 — 버튼이 "저장 중…"에서 되돌아오기만 하면
      // 저장됐는지 알 수 없다. 판정·이유를 다시 고치면 지워진다(app.js).
      (v.crun.saved && !v.crun.saving
        ? '<span style="margin-left:auto;font-size:12px;font-weight:600;color:var(--band-good-fg);">저장됨 ✓</span>'
        : '') +
      '<button class="btn btn-sm btn-ghost btn-ghost-accent" data-act="saveChecklistRun" style="' +
        (v.crun.saved && !v.crun.saving ? '' : 'margin-left:auto;') + '">' +
        (v.crun.saving ? '저장 중…' : '저장') + '</button>' +
      '<button class="btn btn-sm btn-ghost btn-ghost-accent" data-act="exportChecklistCsv">CSV 내보내기</button>' +
    '</div>';

    var rows = v.crun.items.map(function (it) {
      // data-arg/data-reason 은 it.no 가 아니라 it.idx(배열 위치)를 싣는다 —
      // no 는 비어 있거나(전부 "") 겹칠 수 있고 "|" 를 포함할 수도 있어 식별자로
      // 쓸 수 없다. 화면에 보이는 번호(it.no)는 그대로 둔다.
      var choices = VERDICT_CHOICES.map(function (w) {
        var on = it.verdict === w;
        return '<button data-act="setVerdict" data-arg="v|' + esc(it.idx) + '|' + esc(w) + '" style="padding:4px 10px;font-size:14px;font-weight:600;border-radius:var(--r-sm);cursor:pointer;border:1px solid ' +
          (on ? "var(--accent)" : "var(--line)") + ';background:' + (on ? "var(--accent-weak)" : "var(--panel)") + ';">' + esc(w) + '</button>';
      }).join("");
      return '<div style="padding:12px 20px;border-bottom:1px solid var(--line);">' +
        '<div style="font-size:13px;margin-bottom:6px;">' +
          '<span style="color:var(--text-3);margin-right:8px;">' + esc(it.no || "-") + '</span>' + esc(it.text) + '</div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;">' + choices + '</div>' +
        '<input data-reason="' + esc(it.idx) + '" value="' + esc(it.reason) + '" placeholder="이유 (결론과 근거를 함께 적습니다)" ' +
          'style="width:100%;padding:6px 10px;font-size:14px;border:1px solid var(--line);border-radius:var(--r-sm);background:var(--bg);color:var(--text);">' +
      '</div>';
    }).join("");

    return '<div data-scroll="crun" style="height:100%;overflow:auto;background:var(--panel);">' + head + rows + '</div>';
  }

  // 체크리스트를 채우는 독립 화면. 라이브러리 "검토 시작"(startChecklistRun)
  // 또는 기록에서 이어서(openHistory, kind==="checklist") 열 때 둘 다 여기로
  // 온다 — 자동 검토(단일 검토 결과 화면)와 완전히 분리했다. checklistRunView가
  // 저장·CSV·미판정개수를 이미 갖춘 자기 완결형이라 여기선 뒤로가기와 헤더만
  // 얹는다.
  function checklistRunScreen(v) {
    var c = v.crun;
    // 라이브러리에서 왔으면 라이브러리로, 기록에서 이어서 열었으면 기록으로
    // — 다른 곳으로 돌아가면 "뒤로"라는 말이 거짓말이 된다.
    var fromHistory = !!(c && c.from === "history");
    var docName = c && c.documentName;
    return '<div class="page-shell" data-scroll="checklistrun">' +
      '<div class="page-container page-stack" style="max-width:820px;min-height:0;">' +
        backLink(fromHistory ? "history" : "checklists", fromHistory ? "기록으로" : "검토 기준으로") +
        errorBanner(c && c.error) +
        '<div style="background:var(--panel);border:1px solid var(--line);border-radius:var(--r-lg);padding:20px 24px;flex:none;">' +
          '<div style="font-weight:700;font-size:18px;margin-bottom:6px;">' + esc(c ? c.name : "") + '</div>' +
          '<div style="font-size:13px;color:var(--text-2);margin-bottom:12px;">검토 대상 문서: ' + (docName ? esc(docName) : "(지정 안 함)") + '</div>' +
          '<input data-checklist-doc value="' + esc(docName || "") + '" placeholder="검토 대상 문서명 (선택)" ' +
            'style="width:100%;padding:8px 12px;font-size:14px;border:1px solid var(--line);border-radius:var(--r-sm);background:var(--bg);color:var(--text);box-sizing:border-box;">' +
        '</div>' +
        '<div style="flex:1;min-height:0;border:1px solid var(--line);border-radius:var(--r-lg);overflow:hidden;">' + checklistRunView(v) + '</div>' +
      '</div>' +
    '</div>';
  }

  // 검토자. 기록이 같은 팀에 공유되므로(2026-09-09) 누가 돌렸는지가 목록에 보여야
  // 한다. 소유자 없는 옛 기록은 빈 값이라 줄 자체를 안 그린다.
  function recordBy(h) {
    return h.by ? '<small class="record-by">' + esc(h.by) + '</small>' : '';
  }

  // 점 색은 **두 단계**뿐이다: 손댈 것이 있으면 주황, 없으면 초록(요약이 없으면 회색).
  // 예전엔 수정 사항·미검토·근거 없음·검토 못 함을 네 색으로 갈랐는데 범례가 없어
  // 사용자는 "주황 = 뭔가 안 좋음" 이상을 읽지 못했다(2026-09-17). 무엇이 남았는지는
  // 옆 글자가 말한다 — 색은 "열어 봐야 하나"만 답한다.
  // 손댈 것 있음은 주황이 아니라 **노랑**(확인 필요 색) — 8px 점에 주황은 경고처럼 읽혔다
  // (2026-09-18). 결과 화면의 지적 알약(주황)과 같은 계열이라 크게 어긋나지 않는다.
  var DOT_TODO = "var(--sev-min-dot)", DOT_OK = "var(--band-good-fg)", DOT_NA = "var(--text-3)";
  function historyResult(h) {
    var s = h.summary;
    if (s && s.unavailable) return { issues: 0, label: "요약 확인 필요", note: "", tone: DOT_NA };
    if (h.kind === "evaluation") {
      // 검토를 못 한 건수가 먼저다 — 그것이 있으면 "근거 없음 0건"은 거짓말이 된다.
      var unfound = s ? s.unfound || 0 : h.findings || 0;
      var notSeen = s ? s.unreviewed || 0 : 0;
      return { issues: 0,
        label: notSeen ? "검토 못 함 " + notSeen + "건"
          : unfound ? "근거 없음 " + unfound + "건" : "초안 완료",
        note: notSeen && unfound ? "근거 없음 " + unfound + "건" : "",
        tone: notSeen || unfound ? DOT_TODO : DOT_OK };
    }
    if (h.kind === "checklist") {
      var pending = s ? s.unjudged || 0 : h.findings || 0;
      return { issues: 0, label: pending ? "미판정 " + pending + "건" : "판정 완료", note: "",
        tone: pending ? DOT_TODO : DOT_OK };
    }
    var issues = s ? s.issues || 0 : h.findings || 0;
    var unreviewed = s && s.unreviewed || 0, info = s && s.info || 0;
    var notes = [];
    if (unreviewed) notes.push("미검토 " + unreviewed + "건");
    if (info) notes.push("과정 보고 " + info + "건");
    // 과정 보고만 있는 것은 손댈 것이 아니다 — 초록.
    return { issues: issues, label: issues ? "수정 사항 " + issues + "건" : "수정 사항 없음",
      note: notes.join(" · "), tone: issues || unreviewed ? DOT_TODO : DOT_OK };
  }

  function historyResultContent(h) {
    var result = historyResult(h);
    return '<span class="history-result-copy">' + esc(result.label) +
      (result.note ? '<small>' + esc(result.note) + '</small>' : '') + '</span>';
  }

  // 서버 페이지(kind_counts)가 없을 때 쓰는 폴백. 아는 종류는 그대로, 모르는 것만
  // 단일 검토로 접는다 — 새 종류를 여기 안 들이면 그 기록이 단일 검토에 섞이고
  // 제 탭은 0건으로 뜬다(2026-09-16 evaluation 이 그랬다). 세 자리가 같은 판단을
  // 하도록 함수 하나로 묶는다.
  function historyKindKey(h) {
    return h.kind === "compare" || h.kind === "case" || h.kind === "checklist" ||
      h.kind === "evaluation" ? h.kind : "review";
  }

  function historyView(v) {
    var hp = state.historyPage;
    function moreActions(h) {
      var id = h ? 'history-more-row-' + h.id : 'history-more-all';
      var label = h ? h.title + ' 작업 더보기' : '검토 기록 관리';
      return '<span class="history-actions-wrap" data-act="toggleHistoryActions" data-arg="' + esc(id) + '">' +
        '<button type="button" id="' + esc(id) + '" class="history-more-button" data-act="toggleHistoryActions" data-arg="' + esc(id) +
          '" aria-label="' + esc(label) + '" title="' + esc(label) + '" aria-expanded="false" aria-controls="' + esc(id) + '-menu">' +
          '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>' +
        '</button><span id="' + esc(id) + '-menu" class="history-actions-menu" hidden>' +
          '<button type="button" class="menu-item history-menu-delete" ' +
            (h ? 'data-act="askDeleteHistory" data-arg="' + esc(h.id) + '"' : 'data-act="askDeleteAll"') + '>' +
            (h ? '이 기록 삭제' : (hp ? '현재 페이지 ' + (hp.entries || []).length :
              '불러온 기록 ' + (state.history || []).length) + '건 삭제') + '</button>' +
        '</span></span>';
    }
    // 공용 페이지 헤더에 동작 버튼을 얹는다. 예전엔 같은 꼴을 손으로 베껴
    // 뒀는데 규격이 바뀔 때 여기만 뒤처졌다 — pageHead 주석 참고.
    var header = pageHead("검토 기록",
      "검토한 문서와 결과를 찾고, 해당 검토 결과를 다시 엽니다.",
      '<button class="btn btn-ghost btn-ghost-accent" data-act="reloadHistory">새로고침 ⟳</button>' +
      // solid 는 "새 검토" 하나(2026-09-04) — 기록 화면에서 다음에 할 일은 결국
      // 새 검토다. 레퍼런스들의 오른쪽 위 "+ New" 자리.
      '<button class="btn btn-primary" data-act="newReview" data-arg="single">+ 새 검토</button>');

    var historyAll = hp ? (hp.entries || []) : (state.history || []);
    // API가 불러온 최근 기록만 검색한다. 검색어를 정규식으로 해석하지 않는다.
    var words = String(state.historyQ || '').normalize('NFC').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    var searched = hp ? historyAll : historyAll.filter(function (h) {
      var title = String(h.title || '').normalize('NFC').toLocaleLowerCase();
      return words.every(function (word) { return title.indexOf(word) >= 0; });
    });
    var kindMeta = [
      ["", "전체"], ["review", "단일 검토"], ["compare", "비교 검토"],
      ["case", "폴더 검토"], ["checklist", "기준 판정"], ["evaluation", "체크리스트 검토"]
    ];
    var knownKinds = {};
    historyAll.forEach(function (h) { knownKinds[historyKindKey(h)] = true; });
    var kindCounts = { "": searched.length };
    searched.forEach(function (h) {
      var key = historyKindKey(h);
      kindCounts[key] = (kindCounts[key] || 0) + 1;
    });
    if (hp) kindCounts = hp.kind_counts || {};
    var historyShown = hp ? historyAll : searched.filter(function (h) {
      if (!state.historyKind) return true;
      return historyKindKey(h) === state.historyKind;
    });
    // 종류 필터 줄. "검토 기록 N" 머리는 뺐다 — 고른 종류의 건수를 옆 탭이 이미 말해 중복이었다.
    // 0건인 종류도 숨긴다(자리만 차지). "전체"와 지금 고른 종류는 0건이어도 남긴다 — 고른
    // 것을 풀 길이 있어야 한다(2026-09-18).
    var filters = hp || state.history && historyAll.length
      ? '<div class="record-toolbar"><div class="record-filters">' +
          kindMeta.filter(function (m) {
              if (m[0] === "" || (state.historyKind || "") === m[0]) return true;
              if (hp) return (kindCounts[m[0]] || 0) > 0;
              return !!knownKinds[m[0]];
            })
            .map(function (m) {
              return '<button type="button" class="record-filter' +
                ((state.historyKind || '') === m[0] ? ' is-on' : '') +
                '" data-act="setHistoryKind" data-arg="' + m[0] + '" aria-pressed="' +
                ((state.historyKind || '') === m[0] ? 'true' : 'false') + '">' +
                m[1] + ' <b>' + (kindCounts[m[0]] || 0) + '</b></button>';
            }).join("") +
        '</div></div>'
      : "";

    // 서버에 저장된 진짜 이력만 조밀한 레코드 행으로 그린다.
    var rows = (function () {
      var empty = function (msg) {
        return '<div class="record-empty" style="padding:56px 24px;text-align:center;color:var(--text-3);' +
          'font-size:14px;background:var(--panel);"><svg viewBox="0 0 100 100" style="width:100px;height:100px;margin:0 auto 16px;display:block;opacity:0.8;">  <defs>    <linearGradient id="emGrad" x1="0%" y1="0%" x2="100%" y2="100%">      <stop offset="0%" stop-color="var(--line-2)" />      <stop offset="100%" stop-color="var(--line)" />    </linearGradient>  </defs>  <rect x="25" y="20" width="50" height="60" rx="6" fill="url(#emGrad)" opacity="0.3"/>  <rect x="25" y="20" width="50" height="60" rx="6" fill="none" stroke="var(--text-3)" stroke-width="3" stroke-dasharray="6 4"/>  <circle cx="50" cy="45" r="14" fill="none" stroke="var(--text-3)" stroke-width="3" />  <line x1="60" y1="55" x2="68" y2="63" stroke="var(--text-3)" stroke-width="4" stroke-linecap="round" /></svg>' + msg + '</div>';
      };
      // 로딩은 글자 대신 스켈레톤 — 곧 올 목록의 뼈대를 보여주면 화면이 덜컥
      // 갈아끼워지지 않고, "비었다"와도 안 헷갈린다.
      if (hp ? hp.busy : state.history === null) {
        var skelRow = '<div class="record-row record-history-grid" aria-hidden="true">' +
          '<span style="display:flex;align-items:center;gap:10px;"><span class="skel" style="width:34px;height:34px;border-radius:var(--r-sm);flex:none;"></span>' +
            '<span class="skel" style="width:46%;height:14px;"></span></span>' +
          '<span class="skel" style="width:70px;height:22px;"></span>' +
          '<span class="skel" style="width:84px;height:14px;"></span>' +
          '<span class="skel" style="width:64px;height:14px;"></span>' +
          '<span class="skel" style="width:32px;height:26px;"></span>' +
        '</div>';
        return skelRow + skelRow + skelRow + skelRow;
      }
      // 홈과 같은 구분이다(appHomeView). 못 읽은 것을 빈 목록으로 그리면 이 화면은
      // 존재하는 기록을 "없다"고 말한다 — 여기는 기록이 전부인 화면이라 더 나쁘다.
      if (hp ? hp.error : state.historyError) {
        return empty('검토 기록을 불러오지 못했습니다.<br>' +
          '<span style="font-size:13px;">기록이 없는 것이 아니라, 지금 읽지 못한 것입니다.</span>' +
          '<br><button class="btn btn-ghost btn-ghost-accent" data-act="reloadHistory" ' +
            'style="margin-top:14px;font-size:14px;padding:8px 16px;">다시 시도</button>');
      }
      if (hp ? !hp.available_total : !state.history.length) {
        return empty("아직 검토한 문서가 없습니다.<br>" +
          '<span style="font-size:13px;">단일 검토나 비교 검토를 실행하면 결과가 여기에 남습니다.</span>');
      }
      if (!historyShown.length) {
        return '<div class="history-empty"><strong>조건에 맞는 검토 기록이 없습니다.</strong>' +
          '<p>문서명이나 검토 유형을 바꿔서 다시 찾아보세요.</p>' +
          '<button type="button" class="btn btn-sm btn-ghost btn-ghost-accent" data-act="resetHistoryFilters">검색·필터 초기화</button></div>';
      }
      return historyShown.map(function (h) {
        var isCompare = h.kind === "compare";
        // 사이드바·검색과 같은 이름을 쓴다. 예전엔 compare 아니면 전부 "단일
        // 정밀 검토"라 폴더 검토·체크리스트 기록까지 단일로 표기됐다.
        var kind = isCompare ? "비교 검토"
                 : h.kind === "case" ? "폴더 검토"
                 : h.kind === "checklist" ? "기준 판정"
                 : h.kind === "evaluation" ? "체크리스트 검토" : "단일 검토";
        var result = historyResult(h);
        // 미검토가 남으면 0건이어도 통과색을 쓰지 않는다.
        var dot = result.tone;
        // 행 전체가 결과로 가는 클릭 대상이다 — 홈의 최근 검토 행(.hrow)과 같은 규칙.
        // 예전엔 삭제 버튼 오클릭이 걱정돼 행 클릭을 뺐는데, 그러면 홈에서 행을 눌러
        // 들어오던 사용자가 여기선 클릭이 씹혀 "모두 보기"가 막다른 길이 됐다.
        // 핸들러가 closest("[data-act]")로 누른 지점부터 위로 올라가므로(app.js:780)
        // 더보기/삭제 버튼은 행보다 먼저 잡힌다. 결과 열기는 행 클릭 하나로
        // 통일하고, 호버·키보드 포커스 시 문서명 밑줄로 이동 가능함을 알린다.
        //
        // background 를 인라인으로 두지 않는다 — 인라인이 :hover 클래스를 이기므로
        // 호버 배경이 죽는다. 배경은 index.html의 .hrow-flush:hover가 칠한다.
        // 유형 불문 같은 글리프 세트(kindShapeIcon) — 단일만 파란 문서고 나머지가
        // 회색 상자면 목록이 두 세트로 갈라져 보인다.
        var iconHtml = recordShapeIcon(h.kind, h.title, 34, (h.summary || {}).documents);

        return '<div class="record-row record-history-grid" data-act="openHistory" data-arg="' + esc(h.id) +
            '" tabindex="0" role="button">' +
          '<div class="record-primary">' + iconHtml + '<span><strong title="' + esc(h.title) + '">' + esc(h.title) +
            '</strong>' + recordBy(h) + '</span></div>' +
          '<span><span class="record-tag">' + kind + '</span></span>' +
          '<span class="record-result"><i style="background:' + dot + ';"></i>' +
            historyResultContent(h) + '</span>' +
          '<span class="record-muted" title="' + esc(h.at || "") + '">' + esc(ago(h.at)) + '</span>' +
          '<span class="record-actions">' +
            moreActions(h) +
          '</span>' +
        '</div>';
      }).join("");
    })();

    // 삭제 확인 모달. 행의 삭제 버튼(askDeleteHistory)이 state.confirmDelete를 채우면 뜬다.
    var confirmModal = "";
    if (state.confirmDelete) {
      var cd = state.confirmDelete;
      confirmModal = confirmDialog({
        title: "검토 기록 삭제",
        content: historyDeleteContent(cd),
        act: "deleteHistory", arg: cd.id });
    }

    return '<div class="page-shell page-shell-primary" data-scroll="history"><div class="page-container page-stack">' +
      header +
      '<div class="record-tools history-tools"><label class="record-search history-search">' + ICONS.search +
        '<input type="search" data-history-q value="' + esc(state.historyQ || '') +
          '" placeholder="전체 기록에서 문서명 검색" aria-label="전체 보관 검토 기록의 문서명 검색" maxlength="200" autocomplete="off">' +
        '</label><span id="historySearchScope" class="history-search-scope">' +
          (hp ? (hp.busy ? '기록 검색 중…' : hp.error ? '검토 기록을 불러오지 못했습니다' :
            '전체 보관 기록 ' + hp.available_total + '건에서 검색') :
            (state.history === null ? '검토 기록을 불러오는 중' : state.historyError ? '검토 기록을 불러오지 못했습니다' :
            '불러온 최근 기록 ' + historyAll.length + '건에서 검색')) + '</span>' +
        '<span id="historyBulkActions">' +
        (historyAll.length && !(hp ? hp.busy || hp.error : state.historyError) ? moreActions(null) : '') + '</span></div>' +
      '<div id="historyRecords" class="surface-list record-surface">' + filters +
        '<span class="sr-only" role="status" aria-live="polite">' +
          (hp && hp.busy ? '기록을 불러오는 중' : hp && hp.error ? '검토 기록 조회 실패' :
            historyShown.length + '건 표시' + (hp ? ', 전체 ' + hp.total + '건' : '')) + '</span>' +
        '<div class="record-head record-history-grid" aria-hidden="true">' +
          '<span>문서</span><span>검토 유형</span><span>결과</span><span>검토 일시</span><span>작업</span>' +
        '</div>' +
        rows +
        (hp && !hp.error ? '<div class="history-pagination" aria-label="검토 기록 페이지">' +
          '<span>' + (hp.busy ? '불러오는 중…' : hp.total ? ((hp.offset || 0) + 1) + '–' +
            ((hp.offset || 0) + historyShown.length) + ' / ' + hp.total + '건' : '검색 결과 0건') + '</span>' +
          '<div><button type="button" class="btn btn-sm btn-ghost" data-act="setHistoryPage" data-arg="' +
            Math.max(0, (hp.offset || 0) - (hp.limit || 20)) + '"' +
            (hp.busy || !hp.offset || state.hbusy ? ' disabled' : '') + '>이전</button>' +
          '<span>' + (Math.floor((hp.offset || 0) / (hp.limit || 20)) + 1) + ' / ' +
            Math.max(1, Math.ceil((hp.total || 0) / (hp.limit || 20))) + ' 페이지</span>' +
          '<button type="button" class="btn btn-sm btn-ghost" data-act="setHistoryPage" data-arg="' +
            ((hp.offset || 0) + (hp.limit || 20)) + '"' +
            (hp.busy || (hp.offset || 0) + (hp.limit || 20) >= (hp.total || 0) || state.hbusy ? ' disabled' : '') +
            '>다음</button></div></div>' : '') +
      '</div>' +
      confirmModal +
    '</div></div>';
  }
  // 되돌릴 수 없는 일을 묻는 대화상자. 바깥을 누르거나 취소로 닫는다.
  // 한 곳에 둬야 두 화면의 물건이 조금씩 달라지지 않는다(검토 기록 삭제·계정 삭제).
  // 시트 손잡이. **끌 수 있다는 걸 말하는 유일한 장치다** — 없으면 끌린다는
  // 사실을 아무도 모르고, 그러면 없는 기능이다. 이 요소(data-sheet-grip)를
  // 잡은 것만 끌린다: 본문까지 잡히면 스크롤과 싸운다.
  // touch-action:none 이 있어야 터치에서 브라우저가 스크롤로 가로채지 않는다.
  function sheetGrip(inner) {
    return '<div data-sheet-grip style="cursor:grab;touch-action:none;">' +
      '<div style="display:flex;justify-content:center;padding:10px 0 2px;">' +
        '<div style="width:36px;height:4px;border-radius:999px;background:var(--line-2);"></div>' +
      '</div>' + (inner || '') + '</div>';
  }

  function historyDeleteContent(cd) {
    var title = String(cd.title || "이 기록");
    var kind = cd.kind || "review";
    var kinds = { review: "단일 검토", compare: "비교 검토", case: "폴더 검토", checklist: "기준 판정" };
    // 이력 API의 비교 제목 구분자를 사용한다. 불명확한 제목은 임의 분해하지 않는다.
    var pair = kind === "compare" ? title.split(" ↔ ") : [];
    var paired = pair.length === 2 && pair.every(function (name) { return !!name.trim(); });
    var targets = paired ? pair.map(function (name, i) {
      return { label: i === 0 ? "기준 문서" : "대조 문서", name: name, kind: "review" };
    }) : [{ label: "검토 대상", name: title, kind: kind }];
    return '<div class="history-delete-content">' +
      '<p class="history-delete-question" id="confirmDescription">' +
        (cd.all ? '아래 검토 기록을 모두 삭제할까요?' : '이 검토 기록을 삭제할까요?') + '</p>' +
      (cd.all ? '<div class="history-delete-batch">' + esc(title) + '</div>' :
        '<section class="history-delete-targets" aria-label="삭제할 검토 기록">' +
          '<div class="history-delete-meta">' + esc(kinds[kind] || "검토 기록") + ' · 기록 1건</div>' +
          targets.map(function (target) {
            return '<div class="history-delete-document"><span aria-hidden="true">' +
              recordShapeIcon(target.kind, target.name, 30) + '</span><div>' +
              '<span class="history-delete-label">' + target.label + '</span>' +
              '<p class="history-delete-name">' + esc(target.name) + '</p></div></div>';
          }).join('') + '</section>') +
      '<p class="history-delete-warning" id="confirmWarning">삭제한 기록은 복구할 수 없습니다.</p></div>';
  }

  function confirmDialog(o) {
    return '<div style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.28);' +
        'backdrop-filter:blur(12px);z-index:1000;display:flex;align-items:center;justify-content:center;" ' +
        'onclick="if(event.target===this){var b=document.getElementById(\'cancelDeleteBtn\');if(b)b.click();}">' +
        '<div data-sheet="confirm" data-sheet-close="cancelDelete" data-sheet-dim="0.28" data-sheet-blur="12" ' +
          (o.content ? 'class="history-delete-confirm" role="dialog" aria-modal="true" aria-labelledby="confirmTitle" aria-describedby="confirmDescription confirmWarning" ' : '') +
          'style="background:var(--panel);border:1px solid var(--line);border-radius:var(--r-lg);' +
          'box-shadow:0 24px 60px rgba(0,0,0,0.24);width:' + (o.content ? '480' : '400') + 'px;max-width:90vw;padding:0 28px 26px;' +
          'will-change:transform;">' +
          sheetGrip(
            '<div style="display:flex;align-items:center;gap:12px;margin:12px 0 14px;">' +
              '<span style="display:flex;align-items:center;justify-content:center;width:40px;height:40px;' +
                'border-radius:var(--r-md);background:var(--sev-crit-bg);color:var(--sev-crit-fg);font-size:20px;flex:none;">' +
                ICONS.alert + '</span>' +
              '<h3 id="confirmTitle" class="headline" style="margin:0;font-size:18px;">' +
                esc(o.title) + '</h3>' +
            '</div>') +
          (o.content || '<p style="margin:0 0 22px;font-size:14px;line-height:1.6;color:var(--text-2);">' + o.body + '</p>') +
          '<div style="display:flex;gap:10px;justify-content:flex-end;">' +
            '<button id="cancelDeleteBtn" data-act="cancelDelete" class="btn btn-lg btn-ghost btn-ghost-accent">취소</button>' +
            '<button type="button" class="btn btn-lg btn-danger" data-act="' + o.act + '" data-arg="' + esc(o.arg) + '">삭제</button>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function settingsView(v) {
    var onAccounts = state.settingsTab === "accounts"
      && v.user && v.user.role === "admin";
    var header = onAccounts
      ? pageHead("계정 관리", "가입한 계정의 권한을 바꾸거나 계정을 삭제합니다.")
      : pageHead("환경 설정", "기본 동작 방식, AI 엔진 옵션 및 외부 연동을 설정합니다.");

    var toggleOn = '<div style="width:40px;height:24px;background:var(--accent);border-radius:999px;position:relative;cursor:pointer;"><div style="width:18px;height:18px;background:#FFF;border-radius:50%;position:absolute;top:3px;right:3px;box-shadow:0 2px 4px rgba(0,0,0,0.2);"></div></div>';
    var toggleOff = '<div style="width:40px;height:24px;background:var(--line-2);border-radius:999px;position:relative;cursor:pointer;"><div style="width:18px;height:18px;background:#FFF;border-radius:50%;position:absolute;top:3px;left:3px;box-shadow:0 2px 4px rgba(0,0,0,0.1);"></div></div>';

    var llm = "";
    if (!v.llmChips.length) {
      llm = '<span style="font-size:12px;color:var(--text-3);">' + esc(v.llmNote) + '</span>';
    } else {
      var aiOn = false;
      var modelName = "";
      for (var i = 0; i < v.llmChips.length; i++) {
        if (v.llmChips[i].k === "on") {
          aiOn = v.llmChips[i].on;
          modelName = v.llmChips[i].label;
        }
      }
      var toggleHtml = aiOn ? toggleOn : toggleOff;
      var nextState = aiOn ? "off" : "on";
      llm = '<div style="display:flex;align-items:center;gap:12px;cursor:pointer;" data-act="setLlm" data-arg="' + nextState + '">' + toggleHtml + '<span style="font-size:13px;font-weight:600;color:var(--text-2);">' + esc(modelName) + '</span></div>';
    }

    function sectionGroup(title, rows) {
      return '<div>' +
        '<div class="eyebrow" style="color:var(--text-3);margin-bottom:12px;padding-left:4px;">' + esc(title) + '</div>' +
        '<div class="surface-list">' + rows.join('<div style="height:1px;background:var(--line-2);"></div>') + '</div>' +
      '</div>';
    }

    function settingRow(label, desc, control) {
      return '<div class="settings-row">' +
        '<div class="settings-row-copy">' +
          '<div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:4px;">' + esc(label) + '</div>' +
          '<div style="font-size:13px;color:var(--text-2);">' + esc(desc) + '</div>' +
        '</div>' +
        '<div class="settings-row-control">' + control + '</div>' +
      '</div>';
    }

    var lchip = state.theme === "light" ? "background:var(--accent-weak);color:var(--accent-ink);" : "background:var(--bg);color:var(--text-3);";
    var dchip = state.theme === "dark" ? "background:var(--accent-weak);color:var(--accent-ink);" : "background:var(--bg);color:var(--text-3);";
    
    var generalRows = [
      settingRow('테마 모드', '화면의 기본 밝기 테마를 설정합니다.', '<div style="display:flex;gap:4px;"><span class="chip" data-act="setTheme" data-arg="light" style="' + lchip + 'font-size:14px;font-weight:600;padding:6px 12px;border-radius:var(--r-sm);cursor:pointer;">라이트</span><span class="chip" data-act="setTheme" data-arg="dark" style="' + dchip + 'font-size:14px;font-weight:600;padding:6px 12px;border-radius:var(--r-sm);cursor:pointer;">다크</span></div>'),
      settingRow('언어', '현재 한국어를 지원합니다. 영어는 준비 중입니다.',
        selectField('settingsLanguage', '언어 선택', [
          { id: 'ko', name: '한국어' }, { id: 'en', name: 'English · 준비 중', disabled: true }
        ], { value: 'ko', cls: 'sel-sm settings-language', ariaLabel: '인터페이스 언어' }))
    ];

    var aiRows = [
      settingRow('AI 검토', '끄면 규칙 검사만 돌아 훨씬 빠릅니다. 켜면 표현 불일치·모순까지 봅니다. 모델은 서버가 정합니다.', '<div style="display:flex;gap:6px;align-items:center;">' + llm + '</div>'),
      settingRow('문서 파싱 청크 크기', '한 번에 분석할 텍스트 덩어리의 크기입니다.', '<div style="display:flex;align-items:center;gap:8px;"><input type="text" value="4000" style="width:60px;padding:6px;text-align:center;border-radius:var(--r-sm);border:1px solid var(--line);background:var(--bg);font-family:inherit;font-size:14px;color:var(--text);font-weight:600;"><span style="font-size:12px;color:var(--text-3);">chars</span></div>')
    ];

    var intRows = [
      settingRow('이메일 리포트 수신', '검토가 완료되면 계정 이메일로 결과를 전송합니다.', toggleOn),
      settingRow('Slack 알림 연동', 'Workspace의 지정된 슬랙 채널로 상태 알림을 보냅니다.', toggleOff)
    ];

    // 계정 관리는 **사람을 다루는 화면**이다 — 테마·청크 크기와 같은 줄에 두면
    // 목록이 설정 항목처럼 읽히고, 맨 아래까지 스크롤해야 나온다. 앱 공용 .tab
    // 으로 가른다(폴더 검토 리포트·검토 결과와 같은 관용구).
    var isAdmin = !!(v.user && v.user.role === "admin");
    // 관리자가 아니면 탭 자체가 없다 — 한 장뿐인 화면에 탭 줄을 그으면
    // 고를 것이 없는 손잡이만 남는다.
    var tab = isAdmin && state.settingsTab === "accounts" ? "accounts" : "app";
    var tabBar = isAdmin
      ? '<div style="display:flex;gap:18px;border-bottom:1px solid var(--line);margin-bottom:4px;">' +
          [["app", "환경 설정"], ["accounts", "계정 관리"]].map(function (t) {
            return '<span class="tab' + (tab === t[0] ? " on" : "") +
              '" data-act="setSettingsTab" data-arg="' + t[0] + '" tabindex="0" role="button">' +
              esc(t[1]) + '</span>';
          }).join("") + '</div>'
      : '';

    return '<div class="page-shell page-shell-primary" data-scroll="settings"><div class="page-container page-stack">' +
      header + tabBar + '<div class="page-stack" data-motion="settings-tab" style="' + contentAnim("settings-tab", tab) + '">' +
      (tab === "accounts"
        ? adminSection(v)
        : sectionGroup('일반 설정 (General)', generalRows) +
          sectionGroup('AI 검토 엔진 (AI Engine)', aiRows) +
          sectionGroup('알림 및 연동 (Integrations)', intRows)) + '</div>' +
      (state.confirmAccount
        ? confirmDialog({
            title: "계정 삭제",
            body: '<b style="color:var(--text);">' + esc(state.confirmAccount) + '</b>' +
                  ' 계정을 삭제할까요?<br>그 사람의 로그인이 즉시 끊기고, 되돌릴 수 없습니다.' +
                  '<br>검토 기록은 남습니다.',
            act: "deleteAccount", arg: state.confirmAccount })
        : '') +
    '</div></div>';
  }

  // 계정 관리 — 관리자에게만 보인다. **보이지 않는 것은 권한이 아니다**:
  // 진짜 관문은 서버(/api/admin/*)에 있고 여기는 그 위에 얹는 편의다. 그래서
  // 화면이 role 을 잘못 알아도(예: 묵은 state) 서버가 403 으로 끊는다.
  function adminSection(v) {
    if (!v.user || v.user.role !== "admin") return "";
    var a = state.admin || {};
    var body;
    if (a.busy) {
      body = '<div style="padding:20px 24px;font-size:13px;color:var(--text-2);">계정을 읽는 중…</div>';
    } else if (a.error) {
      body = '<div style="padding:16px 24px;">' + errorBanner(a.error) + '</div>';
    } else if (!a.list || !a.list.length) {
      body = '<div style="padding:20px 24px;font-size:13px;color:var(--text-2);">계정이 없습니다.</div>';
    } else {
      body = a.list.map(function (u) {
        var me = v.user && u.email === v.user.email;
        // 자기 자신은 등급을 못 내리고 못 지운다(서버도 같은 규칙) — 마지막
        // 관리자가 스스로 잠기면 서버 CLI 로만 풀 수 있다.
        return '<div class="record-row record-account-grid">' +
          '<div class="record-primary"><span class="record-avatar">' +
            esc((u.name || u.email || "?").charAt(0)) + '</span><span><strong>' +
            esc(u.name || u.email) + (me ? ' <em>나</em>' : '') +
            '</strong><small>' + esc(u.email) + '</small></span></div>' +
          '<span class="record-muted">' + esc([u.dept, u.team].filter(Boolean).join(" · ") || "—") + '</span>' +
          '<span>' + (me
            ? '<span class="record-tag">관리자</span>'
            // .sel-sm — 목록 행에 앉는 작은 셀렉트다. 기본 .sel 은 회원가입
            // 폼용(14px 패딩·15px 글자)이라 행 하나가 그것 때문에 키가 컸다.
            : selectField("arole-" + u.email, "권한",
                [{ id: "user", name: "일반" }, { id: "admin", name: "관리자" }],
                { value: u.role, cls: "sel-sm" })) + '</span>' +
          '<span class="record-actions">' + (me ? '' :
            '<button type="button" class="btn btn-sm btn-primary" data-act="askDeleteAccount"' +
              ' data-arg="' + esc(u.email) + '">삭제</button>') + '</span>' +
        '</div>';
      }).join("");
    }
    return '<div>' +
      '<div class="surface-list record-surface">' +
        '<div class="record-head record-account-grid" aria-hidden="true">' +
          '<span>계정</span><span>소속</span><span>권한</span><span>작업</span>' +
        '</div>' + body + '</div>' +
      '<div style="font-size:13px;color:var(--text-2);margin:8px 0 0 4px;line-height:1.6;">' +
        '계정을 지우면 그 사람의 로그인도 즉시 끊깁니다. 검토 기록은 남습니다.<br>' +
        '자기 계정의 권한과 삭제는 여기서 다룰 수 없습니다 — 마지막 관리자가 스스로 ' +
        '잠기면 서버에서만 풀 수 있습니다.</div>' +
    '</div>';
  }


  function appHomeView(v) {
    // 메뉴 이동은 body()의 짧은 페이드 하나로 끝낸다.
    // 카드마다 순차 등장을 겹치지 않아 홈의 내용과 조작부가 즉시 보인다.

    // 우하단 빠른 메뉴가 쓰는 선형 아이콘 원본. 최근 검토 목록은 이것보다 정보
    // 밀도가 필요해 아래에서 내부 채움이 있는 30px 기록형 글리프를 쓴다.
    var quickReviewIcon = function (kind) {
      return kind === "compare" ? ICONS.compare
           : kind === "case" ? ICONS.folder
           : kind === "checklist" ? ICONS.list : ICONS.single;
    };

    // 최근 검토: 서버에 저장된 진짜 이력이다.
    //
    // 예전에는 여기에 그럴듯한 목업 4건(B2B 플랫폼 요구사항 정의서.pdf 등)이 박혀
    // 있었다. 한 번도 검토한 적 없는 문서들이 "완료"로 떠 있었던 셈이다. 없는 것을
    // 지어내 보여주느니 "아직 없다"고 말하는 편이 낫다.
    var HOME_ROWS = 8;
    var recentItems = (function () {
      var empty = function (msg) {
        // 아이콘이 옅은 브랜드 면 위에 앉는다. 예전엔 회색 아이콘을 opacity .3 으로
        // 흐려 놨는데, 그러면 "아직 안 했다"가 아니라 "고장났다"로 읽힌다 —
        // 빈 화면은 죽은 화면과 구별되어야 한다.
        // 초록(이상 없음)이나 주황을 쓰면 빈 목록이 판정처럼 보인다 — 아무것도
        // 안 한 상태는 판정이 아니다. 그래서 상태색이 아니라 브랜드색을 옅게 쓴다.
        return '<div class="home-empty">' +
          '<div class="home-empty-icon">' +
            ICONS.fileText.replace('width="1em" height="1em"', 'width="26" height="26"') + '</div>' +
          '<div class="home-empty-copy">' + msg + '</div>' +
          '</div>';
      };
      // 홈 최근 검토도 스켈레톤으로 — 기록 화면과 같은 관용구.
      if (state.history === null) {
        var homeSkel = '<div class="record-row home-recent-grid home-recent-row" aria-hidden="true">' +
          '<div class="record-primary"><span class="skel" style="width:30px;height:30px;border-radius:var(--r-sm);flex:none;"></span>' +
          '<span style="flex:1;display:flex;flex-direction:column;gap:6px;">' +
            '<span class="skel" style="width:46%;height:13px;"></span>' +
            '<span class="skel" style="width:28%;height:11px;"></span>' +
          '</span></div><span class="skel" style="width:88px;height:14px;"></span>' +
          '<span class="skel" style="width:54px;height:12px;"></span><span></span>' +
        '</div>';
        return homeSkel + homeSkel + homeSkel;
      }
      // **못 읽은 것과 없는 것은 다른 말이다.** 실패를 빈 목록으로 그리면, 검토를
      // 스무 건 한 사람에게 화면이 "아직 없습니다"라고 거짓말한다. 다시 시도할
      // 길도 같이 준다 — 상태만 말하고 손잡이가 없으면 새로고침밖에 답이 없다.
      if (state.historyError) {
        return '<div style="padding:40px 0;text-align:center;">' +
          '<div style="font-size:14px;font-weight:500;color:var(--text-2);">' +
            '검토 기록을 불러오지 못했습니다</div>' +
          '<div style="margin-top:6px;font-size:13px;color:var(--text-2);">' +
            '기록이 없는 것이 아니라, 지금 읽지 못한 것입니다.</div>' +
          '<button class="btn btn-ghost btn-ghost-accent" data-act="reloadHistory" ' +
            'style="margin-top:14px;font-size:14px;padding:8px 14px;">다시 시도</button>' +
        '</div>';
      }
      var running = (state.jobs || []).filter(function (j) { return j.status === "running"; });
      if (!state.history.length && !running.length) {
        // 첫 방문 — 기록 대신 "이렇게 일합니다" 네 단계(도움말과 같은 말). 검토 방법 타일을
        // 뺀 뒤(2026-09-18) 처음 온 사람에게만 여기서 한 번 말한다.
        var step = function (n, title, desc) {
          return '<div class="home-step"><div class="home-step-n"><span>' + n + '</span></div>' +
            '<b>' + esc(title) + '</b><span>' + esc(desc) + '</span></div>';
        };
        return empty("아직 검토한 문서가 없습니다.") +
          '<div style="margin-top:-32px;text-align:center;font-size:12px;' +
            'color:var(--text-3);padding-bottom:12px;">위에서 검토를 시작하면 여기에 남습니다.</div>' +
          '<div class="home-steps" data-home-first>' +
            step(1, "PDF · Word · HWP", "파일을 그대로 올립니다") +
            step(2, "공통 + 소속 팀 기준", "우리 팀 규칙으로 검사합니다") +
            step(3, "문서 그 자리에 형광펜", "고칠 곳이 바로 보입니다") +
            step(4, "판정은 검토자가", "남은 판정이 이 목록에 표시됩니다") +
          '</div>';
      }

      // 진행 중인 검토가 맨 위 — "어디까지 됐지"가 홈에 오는 첫째 이유다. 끝나면 기록 줄이 된다.
      var runningRows = running.map(function (j) {
        var kindName = j.kind === "compare" ? "비교 검토" : j.kind === "case" ? "폴더 검토"
                     : j.kind === "evaluation" ? "체크리스트 검토" : "단일 검토";
        return '<div class="record-row home-recent-grid home-recent-row is-running" data-act="openJob"' +
            ' data-arg="' + esc(j.id) + '" tabindex="0" role="button">' +
          '<div class="record-primary"><span class="home-recent-glyph">' + recordShapeIcon(j.kind, j.title || "", 30) + '</span>' +
            '<span><strong>' + esc(j.title || "") + '</strong><small>' + kindName + '</small></span></div>' +
          '<span class="record-result"><span class="pill pill-neutral"><span class="home-spin">' + ICONS.refresh + '</span> 진행 중</span></span>' +
          '<span class="record-muted">' + esc(j.stage_label || j.detail || "") + '</span>' +
          '<span class="home-recent-open">' + ICONS.arrowRight + '</span>' +
        '</div>';
      }).join("");

      // 판정이 남은 기록 — 앱 안에서 검토자가 누르는 판정이 비어 있는 줄. 비교 검토(요건마다
      // 만족함·수정필요)와 기준 판정 화면(항목마다) 둘뿐이다. 체크리스트 검토는 결과가 읽기 전용이라
      // 여기 안 든다(판정은 엑셀을 받아 워드에서, 2026-09-18). 라벨이 브랜드색 알약이 되고(노랑은 경고로 읽혔다), 누르면
      // 그 판정이 있는 탭으로 간다(비교는 판정 대기 필터를 켠 채로).
      var todoOf = function (h) {
        var sm = h.summary || {}, n;
        if (sm.unavailable) return null;
        if (h.kind === "compare" && (n = sm.pending || 0) > 0) return { label: "미판정 " + n + "건", act: "openTodo" };
        if (h.kind === "checklist" && (n = sm.unjudged || 0) > 0) return { label: "미판정 " + n + "건", act: "openHistory" };
        return null;
      };
      var rows = state.history;
      // 최대 8행(2026-09-18) — 아래 섹션이 없어져 둘째 줄이 화면 끝까지 늘어나므로, 자리가 남는 만큼
      // 기록을 더 보인다(안 맞으면 목록이 잘라 낸다). 진행 중이 그 수를 나눠 쓴다.
      return runningRows + rows.slice(0, Math.max(1, HOME_ROWS - running.length)).map(function (h) {
        var isCompare = h.kind === "compare";
        // 기록 화면·검색과 같은 이름을 쓴다 — 여기만 옛 라벨이 남아 있었다.
        var kind = isCompare ? "비교 검토"
                 : h.kind === "case" ? "폴더 검토"
                 : h.kind === "checklist" ? "기준 판정"
                 : h.kind === "evaluation" ? "체크리스트 검토" : "단일 검토";
        var result = historyResult(h);
        // 홈은 한 줄 요약만. 상세 수치는 기록 화면에 남기되, 미검토를
        // '수정 사항 없음' 뒤에 숨겨 성공으로 오해하게 만들지는 않는다.
        var unreviewed = h.summary && !h.summary.unavailable && h.summary.unreviewed || 0;
        var label = unreviewed && !result.issues ? '미검토 ' + unreviewed + '건' : result.label;
        var resultDetails = result.label + (result.note ? ' · ' + result.note : '');
        var todo = todoOf(h);
        if (todo) { label = todo.label; resultDetails = todo.label + ' · ' + resultDetails; }
        var glyph = recordShapeIcon(h.kind, h.title, 30, (h.summary || {}).documents);
        var fresh = state.homeFreshHistoryId != null &&
                    String(state.homeFreshHistoryId) === String(h.id);

        return '<div class="record-row home-recent-grid home-recent-row' +
            (fresh ? ' is-fresh' : '') + '"' +
            (fresh ? ' data-fresh-history="true"' : '') + ' data-act="' + (todo ? todo.act : 'openHistory') + '"' +
            ' data-arg="' + esc(h.id) + '" tabindex="0" role="button">' +
          '<div class="record-primary"><span class="home-recent-glyph">' + glyph + '</span>' +
            '<span><strong>' + esc(h.title) + '</strong><small>' + kind +
              (h.by ? ' · ' + esc(h.by) : '') + '</small></span></div>' +
          // 미검토가 있으면 점 대신 노란 주의 표시(확인 필요 색). 숫자까지 적으니 번잡해서 라벨은
          // 하나만 — 상세는 툴팁과 검토 기록 화면(2026-09-16).
          // 표식 없이 글자만 — "수정 사항 N건"·"수정 사항 없음"·"미검토 N건"이 다 말한다. 자세한 수치는
          // 툴팁과 검토 기록 화면(2026-09-16).
          '<span class="record-result" title="' + esc(resultDetails) + '" aria-label="' + esc(resultDetails) + '">' +
            '<span class="home-result-label' + (todo ? ' pill pill-cat' : '') + '">' + esc(label) + '</span></span>' +
          '<span class="record-muted" title="' + esc(h.at || "") + '">' + esc(ago(h.at)) + '</span>' +
          '<span class="home-recent-open">' + ICONS.arrowRight + '</span>' +
        '</div>';
      }).join("");
    })();

    // "모두 보기"는 홈이 못 보여준 게 실제로 있을 때만 낸다. 이력이 HOME_ROWS 이하면 기록 화면은
    // 같은 목록이다 — 눌러도 새 정보가 없는 헛걸음이라, 없는 "더"를 약속하지 않는다.
    var seeAllLink = (state.history && (state.historyAvailable || state.history.length) > HOME_ROWS)
      ? '<button type="button" class="btn btn-sm btn-primary home-see-all" data-act="setMode" data-arg="history">모두 보기 ' + ICONS.arrowRight + '</button>'
      : '';

    // 검토 기준: 서버가 "지금 적용 중"이라고 답한 값만 보여준다.
    //
    // 예전에는 여기에 목업 3종(Generic / PRD / API Spec)이 박혀 있었다. 서버가
    // 실제로는 데모용 체크리스트(id_pattern: SR-\d+)를 쓰고 있어도 화면은 그럴듯한
    // 카드를 띄웠고, 결과는 조용히 0건이 나왔다. 무슨 잣대로 재는 중인지 화면에서
    // 확인할 방법이 없었던 것이 문제의 핵심이었다.

    // 벤토 격자 — 크기와 자리가 곧 우선순위다. 위 한 줄은 **시작하는 것** 셋,
    // 아래는 매번 보는 최근 검토가 두 줄을 먹고 그 옆에 기준·흐름이 쌓인다.
    // 높이가 다 같으면 그건 격자가 아니라 줄이다.
    //
    // 예전에는 큰 흰 카드 넷이 세로로 쌓여 있어 무엇부터 봐야 하는지 안 보였다.
    // 검토 셋은 **같은 크기**다. 무엇을 고를지는 문서가 몇 개냐일 뿐이라
    // 하나만 크게 두면 나머지가 곁다리로 보인다.
    // 시작 타일은 **가로형**으로 낮게 깐다 — 홈의 주인은 매번 보는 최근 검토라,
    // 시작 셋이 세로로 크면 홈이 대시보드가 아니라 기능 선택 화면으로 읽힌다.
    // (.tile 의 flex-direction:column 을 인라인 row 로 뒤집는다.)
    var startTile = function (act, arg, title, desc, icon) {
      return '<button type="button" class="tile act qs grow b3" data-act="' + act + '"' +
        (arg ? ' data-arg="' + arg + '"' : "") +
        '>' +
        '<span class="qs-icon">' + icon + '</span>' +
        // 유령 아이콘 — 오른쪽 아래에 숨어 있다 올리면 밀려 올라온다(2026-09-18). 뜻은 없고 손맛만.
        '<span class="qs-ghost" aria-hidden="true">' + icon + '</span>' +
        '<span class="qs-copy">' +
          '<span class="tile-h" style="display:block;">' + esc(title) + '</span>' +
          '<span class="tile-sub" style="display:block;margin-top:2px;">' + esc(desc) + '</span>' +
        '</span>' +
        '<span class="qs-arrow">' + ICONS.arrowRight + '</span>' +
      '</button>';
    };

    // 기준 세 겹. **홈에서는 건수를 말하지 않는다.**
    //
    // 여기까지 세 번 돌아왔다. 층을 6초짜리 슬라이드로 돌렸고(도는 글은 읽는
    // 물건이 아니라 뺐다), items 의 `agent` 로 종류를 갈라 세웠고(실측해 보니
    // 일곱 팀 중 여섯이 공통과 3~4종을 공유해 거의 같은 목록이 반복됐다),
    // 묶음 이름 + 건수 목록으로 줄였다. 마지막까지 남아 있던 것이 **숫자**인데,
    // 홈에 선 사람에게 "공통 7건 · 팀 13건"은 아무 결정도 바꾸지 않는다.
    // 건수가 궁금해지는 순간은 기준 화면에 들어간 뒤다.
    //
    // 그래서 홈은 **어느 겹이 걸리는가** 하나만 그림으로 말한다.
    //   공통    씨앗. 늘 걸린다.
    //   팀별    씨앗. 소속 팀이 있으면 걸린다.
    //   체크리스트  검사를 시작할 때 고른 것만 걸린다
    //              (server.py 의 compose_review_preset(seed, picked, team) 중 picked).
    // 걸리지 않은 층은 흐리게 두고 상태 글자를 붙인다. 색만으로 상태를 말하지 않는다.
    var layers = (state.homeCriteria && state.homeCriteria.layers) || null;
    var uTeam = teamLabel(state.user && state.user.team);

    // 선택은 설명을 바꿀 뿐 실제 검토 설정을 바꾸지 않는다. 항목 목록은 모두 보기에서 읽는다.
    function critSheet(key, name, status, on, active) {
      return '<button type="button" class="crit-sheet' + (on ? "" : " is-off") + (active ? " is-active" : "") +
        '" data-act="homeCriteriaExplain" data-arg="' + key + '" aria-pressed="' + active +
        '" aria-controls="crit-description-' + key + '" aria-label="' + esc(name + " 설명 보기") + '">' +
        '<span class="crit-sheet-name">' + esc(name) + '</span>' +
        '<span class="crit-sheet-lines" aria-hidden="true"><em></em><em></em><em></em></span>' +
        '<span class="crit-sheet-state">' + esc(status) + '</span></button>';
    }
    function critDescription(key, name, status, text, active) {
      return '<section class="crit-description" id="crit-description-' + key + '" aria-label="' + esc(name + ' 설명') +
        '"' + (active ? '' : ' hidden') + '><div class="crit-description-head"><h3 class="crit-description-title">' +
          esc(name) + '</h3><span class="crit-description-status">' + esc(status) + '</span></div>' +
        '<p>' + esc(text) + '</p></section>';
    }

    var critTile = (function () {
      var ls = layers || [];
      var find = function (sc) {
        return ls.filter(function (L) { return L.scope === sc; })[0] || null;
      };
      var common = find("공통"), team = find("팀별");
      var ups = ls.filter(function (L) { return L.scope === "업로드"; });
      // 돋보기 빛(data-glow)은 숨은 마스코트를 찾는 장치였다 — 마스코트가
      // 우하단 런처로 나오면서 함께 은퇴했다(2026-09-01).
      var head = '<div class="tile crit grow b6 stat">' +
        '<div class="home-tile-head">' +
          '<span class="tile-h home-tile-title"><span class="home-tile-ico">' + ICONS.list + '</span>검토 기준</span>' +
          // 색면을 걷은 뒤 흰 반전 버튼은 흰 카드 위에서 사라졌다 — 최근 검토
          // 타일과 같은 솔리드로 맞춘다(2026-09-02). 홈의 "모두 보기"는 둘 다
          // 같은 일을 하므로 같은 모양이어야 한다.
          '<button type="button" class="btn btn-sm btn-primary home-see-all"' +
            ' data-act="setMode" data-arg="checklists">모두 보기 ' +
            ICONS.arrowRight + '</button>' +
        '</div>';
      if (!ls.length) {
        // 큰 0 을 띄우지 않는다. 기준이 0건인 것과 아직 못 불러온 것은 다른 말이다.
        return head + '<div class="crit-loading">' +
          (uTeam ? "기준을 불러오는 중…" : "로그인하면 소속 팀 기준이 함께 걸립니다") +
          '</div></div>';
      }
      var focus = ["common", "team", "upload"].indexOf(state.homeCriteriaFocus) >= 0 ? state.homeCriteriaFocus : "common";
      // 무엇을 보는가 — 두 줄의 칩. ① 알아보는 산출물 종류(팀 yaml outputs 의 key, 서버가 준다)
      // ② 검사 갈래(팀+공통 항목의 agent 를 세어 있는 것만, 화면의 분류 알약과 같은 색).
      var docs = (team && team.documents) || [];
      var AGENT_CAT = { "형식·완전성": ["form", "형식"], "표현·내용품질": ["expr", "표현"],
                        "정합성·추적성": ["trace", "추적"], "표준·체크리스트": ["process", "기준"] };
      var agentCount = {};
      [common, team].forEach(function (L) {
        ((L && L.items) || []).forEach(function (it) { if (it.agent) agentCount[it.agent] = (agentCount[it.agent] || 0) + 1; });
      });
      var agentChips = Object.keys(AGENT_CAT).filter(function (k) { return agentCount[k]; }).map(function (k) {
        return '<span class="pill pill-cat cat-' + AGENT_CAT[k][0] + '" title="' + esc(k) + ' ' + agentCount[k] + '건">' +
          AGENT_CAT[k][1] + ' <i>' + agentCount[k] + '</i></span>';
      }).join("");
      var chipRows = (docs.length ? '<dt>알아보는 문서</dt><dd>' +
          docs.slice(0, 6).map(function (d) { return '<span class="pill pill-neutral">' + esc(d) + '</span>'; }).join("") +
          (docs.length > 6 ? '<span class="pill pill-neutral" title="' + esc(docs.slice(6).join(" · ")) + '">+' + (docs.length - 6) + '</span>' : '') +
        '</dd>' : '') +
        (agentChips ? '<dt>검사 갈래</dt><dd>' + agentChips + '</dd>' : '');
      // 두 줄을 한 격자에 — 라벨 열이 맞아야 가운데 정렬해도 줄이 흔들리지 않는다.
      if (chipRows) chipRows = '<dl class="crit-chips">' + chipRows + '</dl>';
      return head +
        '<div class="crit-editorial">' +
          '<div class="crit-figure">' +
            '<div class="crit-art"><div class="crit-deck' + (v.anim.homeEntered ? " scope-enter" : "") + '"' +
              (v.anim.homeEntered ? ' style="--plane-delay:' + (420 - v.anim.homeEnterElapsed) + 'ms;"' : "") + '>' +
              critSheet("common", "공통 기준", common ? "항상 적용" : "못 읽음", !!common, focus === "common") +
              critSheet("team", "팀 기준", team ? "자동 적용" : "미적용", !!team, focus === "team") +
              critSheet("upload", "추가 기준", ups.length ? "선택 가능" : "등록 없음", ups.length > 0, focus === "upload") +
            '</div></div>' +
            '<div class="crit-info">' +
              '<div class="crit-descriptions" aria-live="polite" aria-atomic="true">' +
                critDescription("common", "공통 기준", common ? "항상 적용" : "불러오지 못함",
                  common ? "모든 문서에 기본으로 적용되는 기준입니다. 따로 선택하지 않아도 함께 검토합니다." :
                    "모든 문서에 기본으로 적용되는 기준입니다. 지금은 기준 정보를 불러오지 못했습니다.", focus === "common") +
                critDescription("team", "팀 기준", team ? "자동 적용" : "소속 팀 기준 없음",
                  team ? team.name + "에서 사용하는 기준입니다. 공통 기준에 더해 자동으로 적용됩니다." :
                    "소속 팀에서 사용하는 기준을 공통 기준에 더해 검토합니다. 현재 등록된 팀 기준은 없습니다.", focus === "team") +
                critDescription("upload", "추가 기준", ups.length ? "선택 가능 " + ups.length + "개" : "등록된 추가 기준 없음",
                  "과제에 맞춰 더하는 기준입니다. 검토를 시작할 때 필요한 기준을 고릅니다.", focus === "upload") +
              '</div>' +
            '</div>' +
          '</div>' +
          chipRows +
        '</div>' +
      '</div>';
    })();

    // 최근 검토 — 두 줄을 먹는 제일 큰 타일. 매번 보는 것이 제일 커야 한다.
    // 머리줄의 "5건에서 146건 수정 사항"은 뺐다 — 다른 문서(같은 문서의 재검토 포함)의 지적을
    // 더한 수라 아무 판단으로도 이어지지 않았다(2026-09-16). 남는 건 주의 표시의 범례뿐.
    var loaded = (state.history || []).slice(0, 5);
    // 미검토 주의 표시도 뺐다(2026-09-16). 지적이 없고 못 본 게 있으면 라벨이 "미검토 N건"이라
    // 이미 말하고, 지적이 있는 행은 어차피 열어서 보는데 열면 첫 탭에 ⚠ 가 있다.
    var recentMeta = '';   // 머리줄 칩(판정 남음 N)은 뺐다(2026-09-18) — 줄의 노랑 알약이 이미 말한다.
    // 무엇이든 물어보세요(2026-09-18) — 오른쪽 기둥의 셋째 줄. 최근 검토 아래 이어지는 작은 카드.
    // 입력 한 줄 + 예시 칩. 치거나 칩을 누르면 문맥 없는 새 대화로 두수리 화면이 열리고 첫 말이 바로 간다.
    var askChips = ["최근 검토에서 자주 나온 지적이 뭐야?", "지난주에 검토한 문서를 결과와 함께 요약해 줘", "'표기 규칙' 지적이 있었던 검토를 찾아 줘"];
    var askTile = (state.server && state.server.chat_enabled)
      ? '<div class="tile home-ask-tile">' +
          '<div class="home-tile-head"><span class="tile-h home-tile-title"><span class="home-tile-ico">' + ICONS.chat + '</span>무엇이든 물어보세요</span></div>' +
          '<div class="home-ask-note">DoSuree 가 검토 기록 · 팀 기준 · 문서 본문을 읽고 답합니다. 읽기만 하고 판정은 바꾸지 않습니다.</div>' +
          '<div class="home-ask">' +
            '<input id="homeAsk" type="text" maxlength="4000" autocomplete="off" placeholder="예: 이번 주 검토 중 미검토가 남은 건 뭐야?">' +
            '<button type="button" class="btn btn-sm btn-primary" data-act="homeAsk" aria-label="물어보기">' + ICONS.arrowRight + '</button>' +
          '</div>' +
          '<div class="home-ask-chips">' + askChips.map(function (t) {
            return '<button type="button" class="home-ask-chip" data-act="homeAskChip" data-arg="' + esc(t) + '">' + esc(t) + '</button>';
          }).join("") + '</div>' +
        '</div>'
      : '';

    var recentTile = '<div class="tile grow home-recent-tile">' +
      '<div class="home-tile-head">' +
        '<span class="tile-h home-tile-title"><span class="home-tile-ico">' + ICONS.history + '</span>최근 검토</span>' +
        '<span class="home-tile-actions">' +
          recentMeta + seeAllLink + '</span>' +
      '</div>' +
      '<div class="home-recent-list">' + recentItems + '</div>' +
    '</div>';

    // 검토 방법(4단계 설명) 타일은 뺐다(2026-09-18) — 매일 오는 작업 화면에 자기소개가
    // 자리를 차지했다. 같은 내용은 도움말 "이렇게 일합니다"에 있다.

    // 홈에서 사용자 이름과 `님`만 브랜드색·700으로 묶는다. 쉼표와 환영 문구는
    // 차콜로 남겨 전부 링크처럼 보이지 않게 하고, hover·밑줄은 붙이지 않는다.
    var uName = esc(state.user ? state.user.name : "");
    var greeting = uName
      ? '<span class="home-greeting-name">' + uName + ' 님</span>, 환영합니다'
      : '환영합니다';

    return '<div class="home-scroll" data-scroll="home">' +
      '<div class="home-layout">' +
        '<div class="home-greeting">' +
          '<div class="home-greeting-copy">' +
            '<h1 class="headline home-greeting-title"><span>' + greeting + '</span>' +
              // 인사 손짓은 진입 때 한 번만 흔든다. 재렌더에서 처음부터 다시 돌지
              // 않도록 흐른 시간만큼 음수 지연을 준다(기준 도식과 같은 수법).
              '<span class="home-greeting-wave' + (v.anim.homeEntered ? " wave-enter" : "") +
                '" aria-hidden="true"' +
                (v.anim.homeEntered
                  ? ' style="--wave-delay:' + (400 - v.anim.homeEnterElapsed) + 'ms;"' : "") +
                '>' + ICONS.wave + '</span></h1>' +
            '<p class="home-greeting-sub">' +
              '검토 기준에 따라 문서의 문제를 찾습니다.</p>' +
          '</div>' +
        '</div>' +
        '<div class="bento">' +
          // 이름은 사이드 메뉴와 같은 말이다(2026-09-18). 넷째는 체크리스트 검토.
          // 드롭존 하나로 갈음해 봤지만(시안 5251Tpa5) 검토마다 받는 파일 수·종류가 달라 문 넷이 낫다.
          // 홈은 이 넷 + 최근 검토 + 검토 기준으로 끝낸다(2026-09-18) — 채팅 띠는 채팅이 메인처럼 읽혀 뺐다.
          startTile("newReview", "", "단일 검토",
                    "문서 하나를 기준에 따라 검토합니다", ICONS.single) +
          startTile("setMode", "compare", "비교 검토",
                    "두 문서 사이의 차이와 누락을 찾습니다", ICONS.compare) +
          startTile("setMode", "case", "폴더 검토",
                    "산출물 묶음의 일관성을 함께 검토합니다", ICONS.folder) +
          startTile("setMode", "evaluate", "체크리스트 검토",
                    "과제 체크리스트로 평가표 초안을 씁니다", ICONS.checklist) +
          // 벤토(2026-09-18): 왼쪽 6칸에 시작 넷이 2×2, 그 아래 기준. 오른쪽 6칸은 최근 검토가
          // 세 줄을 통째로 — 크기가 셋으로 갈린다(최근 검토 > 기준 > 시작 타일).
          // 오른쪽 기둥(2026-09-18): 최근 검토가 남는 높이를 다 쓰고, 물어보기 카드는 제 내용만큼만.
          // 왼쪽 셋째 줄(기준)과 밑선이 어긋나도 된다 — 높이가 갈리는 게 벤토다.
          '<div class="home-col b6 r3">' + recentTile + askTile + '</div>' +
          critTile +
        '</div>' +
      '</div>' +
    '</div>';
  }


  // ── 산출물 세트 검토 ────────────────────────────────────────────────────────────
  // 검사 1건이 문서 하나가 아니라 산출물 세트다. 폴더째 올리고, 무엇이 무엇인지
  // 확인받은 뒤 검사한다.
  //
  // 고른 값은 전부 state(kase)에 있다 — DOM 에 들고 있으면 render() 한 번에
  // 날아간다(회원가입 폼이 그렇게 아팠다).

  // 카드는 앱 공용 card() 를 그대로 쓴다. 예전에 radius 만 14px 로 따로 잡아
  // 놓아서 같은 화면에 8px 카드와 14px 카드가 섞여 있었다.
  var caseCard = card;

  // 폴더 드롭존. dropzone() 과 같은 두 상태를 갖는다 — 비었을 때는 안내, 담겼을
  // 때는 **담긴 것**과 "첨부 완료".
  //
  // 예전에는 상태가 하나뿐이라 폴더를 놓아도 드롭존이 "폴더를 끌어다 놓거나..."
  // 그대로였다. 단일 검토는 같은 자리가 문서 카드로 바뀌는데 여기만 안 바뀌니,
  // 파일 목록이 아래 붙는 것을 못 본 사람은 업로드가 안 된 줄 알고 다시 놓았다.
  //
  // dropzone() 함수 자체는 못 쓴다 — 그쪽은 파일 하나에 slot 이 있고 여기는
  // 폴더 통째다. 겉모습(52px 그림 · 15px 제목 · 13px 보조줄 · 칩 + 버튼)만 맞춘다.
  function caseDropzone(k) {
    var n = k.files.length;
    // 세로 가운데 정렬은 여기(공유 스타일)서 진다 — 옆의 "검사 단계" 패널이 더
    // 클 때 드롭존이 stretch 로 늘어나는데, 빈 상태에만 정렬이 빠져 있어 그림과
    // 안내가 위에 붙어 있었다(단일 검토 dropzone() 은 처음부터 갖고 있던 정렬).
    var box = 'flex:1;min-width:0;border-radius:var(--r-lg);box-sizing:border-box;' +
      'display:flex;flex-direction:column;align-items:center;justify-content:center;' +
      'transition:border-color .2s var(--ease-out),background .2s var(--ease-out),color .2s var(--ease-out),box-shadow .2s var(--ease-out),opacity .2s var(--ease-out),transform .2s var(--ease-out);text-align:center;';
    // 폴더 그림. 담겼을 때는 채움을 올려 "빈 자리"가 아니라 "든 것"으로 읽히게 한다.
    function folder(fill, stroke) {
      return '<svg viewBox="0 0 100 100" style="width:52px;height:52px;margin-bottom:12px;">' +
        '<defs><linearGradient id="upFolderGrad" x1="0%" y1="0%" x2="100%" y2="100%">' +
        '<stop offset="0%" stop-color="var(--accent-strong)" /><stop offset="100%" stop-color="var(--accent)" /></linearGradient></defs>' +
        '<path d="M18 30 A4 4 0 0 1 22 26 L40 26 L47 34 L78 34 A4 4 0 0 1 82 38 L82 74 A4 4 0 0 1 78 78 L22 78 A4 4 0 0 1 18 74 Z" fill="url(#upFolderGrad)" opacity="' + fill + '" />' +
        '<path d="M18 30 A4 4 0 0 1 22 26 L40 26 L47 34 L78 34 A4 4 0 0 1 82 38 L82 74 A4 4 0 0 1 78 78 L22 78 A4 4 0 0 1 18 74 Z" fill="none" stroke="url(#upFolderGrad)" stroke-width="2" opacity="' + stroke + '" />' +
        // 담겼으면 화살표(=올려라) 대신 문서 세 장(=들었다).
        (n
          ? '<path d="M35 46 H65 M35 56 H65 M35 66 H54" stroke="var(--accent)" stroke-width="4" stroke-linecap="round" fill="none" />'
          : '<path d="M50 45 L50 65 M41 54 L50 45 L59 54" stroke="var(--accent)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none" />') +
        '</svg>';
    }
    if (!n) {
      // 문서가 아니라 폴더를 받는다 — dropzone() 의 문서 그림에 폴더 탭을
      // 붙이고 같은 화살표를 넣는다. 그라디언트 id 는 이 화면에만 있다.
      return '<div class="drop-hover" data-casedrop style="' + box + 'border:1px dashed var(--line-dashed);background:var(--bg);padding:40px 20px;cursor:pointer;" data-act="pickCaseFolder">' +
        '<span style="display:block;width:40px;height:40px;margin:0 auto 12px;font-size:40px;line-height:1;color:var(--text-3);">' + ICONS.folder + '</span>' +
        '<div style="font-size:14px;font-weight:500;color:var(--text);">폴더를 여기에 끌어다 놓으세요</div>' +
        '<div style="font-size:13px;color:var(--text-2);margin-top:6px;">하위 폴더까지 모읍니다 · 지원 형식: .hwpx, .hwp, .docx, .pdf, .md, .txt</div>' +
        '<button type="button" class="btn btn-primary" data-act="pickCaseFolder" style="margin-top:16px;">폴더 선택</button>' +
      '</div>';
    }
    var bytes = k.files.reduce(function (sum, f) { return sum + (f.size || 0); }, 0);
    // 담긴 뒤에도 data-casedrop 은 남긴다 — 더 놓으면 이어서 담는다(addCaseFiles
    // 가 이름으로 중복을 거른다). 다만 클릭으로 창을 다시 여는 것은 뺀다.
    // dropzone() 도 파일이 붙으면 클릭을 안 받는다 — 아래 "파일만 고르기" 가 그 몫이다.
    return '<div data-casedrop style="' + box + 'border:1px solid var(--line);background:var(--panel);padding:28px 20px;">' +
      folder("0.15", "0.40") +
      '<div style="font-weight:700;font-size:15px;color:var(--text);">문서 ' + n + '개</div>' +
      '<div class="mono" style="font-size:13px;color:var(--text-3);margin-top:6px;">' + esc(fmtSize(bytes)) + '</div>' +
      '<div style="display:flex;gap:16px;align-items:center;margin-top:20px;">' +
        '<span style="display:flex;align-items:center;gap:4px;font-size:12px;font-weight:600;color:var(--band-good-fg);background:var(--band-good-bg);padding:6px 12px;border-radius:var(--r-xl);">' + ICONS.check + ' 첨부 완료</span>' +
        '<button class="btn btn-ghost btn-ghost-accent" data-act="clearCaseFiles">제거</button>' +
      '</div>' +
    '</div>';
  }

  function caseUpload(v) {
    var k = v.kase;
    var list = k.files.length
      ? '<div data-scroll="caseUploadFiles" style="margin-top:14px;max-height:220px;overflow:auto;border:1px solid var(--line);border-radius:var(--r-md);">' +
          k.files.map(function (f, i) {
            return '<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;' +
              (i ? "border-top:1px solid var(--line-2);" : "") + 'font-size:12px;">' +
              '<span style="color:var(--text-3);width:22px;">' + (i + 1) + '</span>' +
              '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(f.name) + '</span>' +
              '<span class="mono" style="color:var(--text-3);">' + Math.max(1, Math.round(f.size / 1024)) + ' KB</span>' +
              '</div>';
          }).join("") + '</div>'
      : "";
    var err = k.error
      ? '<div style="margin-top:14px;padding:12px 14px;background:var(--sev-crit-bg);border:1px solid var(--sev-crit-bd);border-radius:var(--r-sm);color:var(--sev-crit-fg);font-size:14px;">' + esc(k.error) + '</div>'
      : "";
    return '<div class="page-shell page-shell-primary" data-scroll="case-upload">' +
      '<div class="page-container page-stack">' +
      // 단일 검토·문서 비교와 같은 관용구 — 카드 밖 pageHead + 카드 안 작업 영역.
      pageHead("폴더 검토",
               "산출물 폴더를 통째로 올리세요. 한 의뢰의 문서들을 함께 놓고 " +
               "문서 안의 값과 문서 간 일관성을 확인합니다.") +
      '<div class="setup-panel">' +
        '<div style="margin-bottom:16px;">' +
          '<h2 class="setup-section-title">산출물 폴더</h2>' +
          '<p style="margin:4px 0 0;color:var(--text-2);font-size:13px;line-height:1.6;">' +
            '같은 의뢰번호의 산출물이 담긴 폴더를 올리세요. 하위 폴더까지 모아 문서 안의 값과 문서 간 일관성을 확인합니다. 문서 두 개만 대조하려면 비교 검토를 사용하세요.</p>' +
        '</div>' +
        // 단일 업로드와 같은 관용구 — 전체 폭 드롭존 + 아래 단계 띠. 폴더 통째
        // 업로드라 dropzone() 함수 자체는 못 쓰지만(파일 목록이 아래 붙고 slot 이
        // 없다) 겉모습은 맞춘다.
        caseDropzone(k) +
        pipelineStrip("검토 단계", CASE_STAGES) +
        // "비우기" 는 뺐다 — 드롭존 안의 "제거" 와 같은 일을 한다. 둘을 나란히
        // 두면 어느 쪽이 무엇을 지우는지(고른 파일? 인식 결과?) 읽히지 않는다.
        list + err +
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:16px;">' +
          '<button class="btn btn-ghost" data-act="pickCaseFiles">파일만 고르기</button>' +
          (k.files.length
            ? '<button class="btn btn-lg btn-primary" data-act="classifyCase">' +
                k.files.length + '개 파일 인식하기 ' + ICONS.arrowRight + '</button>'
            : "") +
        '</div>' +
      '</div>' +
      recentSection("case", "폴더 검토") +
      '</div>' +
    '</div>';
  }

  function caseRecognize(v) {
    var k = v.kase, r = k.recog || { recognized: [], unclassified: [], ignored: [], missing: [], outputKeys: [] };
    function row(cells, warn) {
      return '<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-top:1px solid var(--line-2);font-size:13px;' +
        (warn ? "" : "") + '">' + cells + '</div>';
    }
    var recognized = r.recognized.map(function (x) {
      var stale = x.formNo && x.formNo.stale;
      return row(
        '<span style="width:170px;flex:none;font-weight:600;">' + esc(x.key) + '</span>' +
        '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-2);">' + esc(x.file) + '</span>' +
        (stale
          ? '<span class="mono" style="color:var(--text-2);font-weight:600;font-size:12px;flex:none;">구 양식 ' + esc(x.formNo.found) + ' → ' + esc(x.formNo.expected) + '</span>'
          : '<span style="color:var(--text-3);font-size:12px;flex:none;">최신</span>'), stale);
    }).join("");

    // 미분류는 사람이 지정하거나 뺀다. 추측해 배정하면 엉뚱한 필드맵으로 검사해
    // 거짓 지적이 난다 — 그래서 여기서 멈춰 묻는다.
    var unclassified = r.unclassified.map(function (name, i) {
      var picked = k.assign[name] || "";
      var excluded = !!k.exclude[name];
      // 앱 커스텀 셀렉트(.sel)를 쓴다 — 이 화면만 OS 네이티브 목록이라 혼자
      // 다른 앱처럼 보였다. id 는 파일명이 아니라 위치(asg-i)다: 파일명의
      // | · 따옴표가 selPick 의 data-arg 파싱을 깬다(app.js asg- 분기).
      // 제외한 행은 고를 것이 없으니 셀렉트 대신 흐린 글만 남긴다.
      var pickCol = excluded
        ? '<span style="flex:none;width:180px;font-size:12px;color:var(--text-3);text-align:center;">제외됨</span>'
        : '<div style="flex:none;width:180px;">' +
            selectField("asg-" + i, "— 지정 안 함 —",
              [{ id: "", name: "— 지정 안 함 —" }].concat(
                r.outputKeys.map(function (key) { return { id: key, name: key }; })),
              { value: picked }) +
          '</div>';
      return row(
        '<span style="width:170px;flex:none;color:var(--text-3);">미분류</span>' +
        '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' +
          (excluded ? "text-decoration:line-through;color:var(--text-3);" : "") + '">' + esc(name) + '</span>' +
        pickCol +
        '<button class="btn btn-sm btn-ghost" data-act="toggleExclude" data-arg="' + esc(name) + '" style="flex:none;">' +
          (excluded ? "되돌리기" : "제외") + '</button>', !excluded && !picked);
    }).join("");

    var ignored = r.ignored.map(function (x) {
      return row('<span style="width:170px;flex:none;color:var(--text-3);">건너뜀</span>' +
        '<span style="flex:1;color:var(--text-3);">' + esc(x.file) + '</span>' +
        '<span style="color:var(--text-3);font-size:12px;flex:none;">' + esc(x.reason || "") + '</span>');
    }).join("");

    // 업로드 화면과 같은 껍데기(24px 패널). 예전엔 이 화면만 공용 card() 8px 를
    // 써서, 한 흐름의 2단계인데 앞뒤 화면과 카드 모양이 갈렸다.
    function panel(inner, pad) {
      // 앞뒤 화면(업로드 히어로 카드)과 같은 --r-lg — 이 화면만 24px 였다.
      return '<div class="surface-work" style="padding:' + (pad || "24px") + ';border-radius:var(--r-lg);">' + inner + '</div>';
    }
    var missing = r.missing.length
      ? panel('<div style="font-size:13px;font-weight:600;margin-bottom:8px;">안 올라온 산출물 ' + r.missing.length + '종</div>' +
          '<div style="font-size:13px;color:var(--text-2);line-height:1.6;">' + r.missing.map(esc).join(" · ") + '</div>' +
          '<div style="font-size:13px;color:var(--text-2);margin-top:8px;">없는 문서가 필요한 대조는 <b>미검토</b>로 남습니다 — 지적 0건과 다릅니다.</div>', "24px 32px")
      : "";

    return '<div class="page-shell page-shell-primary" data-scroll="case-recognize">' +
      '<div class="page-container page-stack">' +
      // 페이지 제목은 여전히 "폴더 검토"다 — 인식 확인은 그 안의 한 단계라서,
      // 단계 이름(인식 결과 N/M종)은 카드 안 섹션 제목(본문 서체 700)이 진다.
      pageHead("폴더 검토",
               "문서 유형이 맞게 잡혔는지 확인하세요. 잘못 배정된 채로 넘어가면 " +
               "엉뚱한 기준으로 검사합니다.") +
      panel(
        '<div class="headline" style="font-size:18px;margin-bottom:6px;">인식 결과 — 산출물 ' + r.recognized.length + '/' + r.outputKeys.length + '종</div>' +
        '<p style="margin:0 0 20px 0;color:var(--text-3);font-size:14px;line-height:1.6;">잘못 배정되면 엉뚱한 기준으로 검사합니다.</p>' +
        // overflow:hidden 을 걷었다 — 커스텀 셀렉트(.sel-menu)가 절대배치로
        // 아래에 펼쳐지는데, 숨김이면 목록이 상자 테두리에서 잘린다.
        '<div style="border:1px solid var(--line);border-radius:var(--r-md);">' +
          recognized + unclassified + ignored +
        '</div>') +
      missing +
      // CTA는 다른 화면과 같은 관용구(우측 정렬 btn-lg + 화살표)다. 예전엔 이
      // 화면만 화면 폭을 다 먹는 버튼이라 같은 앱으로 안 보였다.
      '<div style="display:flex;align-items:center;justify-content:space-between;">' +
        '<button class="btn btn-ghost" data-act="backToCaseUpload">뒤로</button>' +
        '<button class="btn btn-lg btn-primary" data-act="runCase">검토 시작 ' + ICONS.arrowRight + '</button>' +
      '</div>' +
      '</div>' +
    '</div>';
  }



  // ── 산출물 세트 검토 리포트 ──────────────────────────────────────────────────────────
  // 네 부분이다: 요약(+산출물 인식표) · 산출물별 값 · 산출물 간 대조 · 기타.
  //
  // 인식표가 지적보다 앞에 온다. 산출물 하나가 안 올라온 걸 모르고 "지적 없음"을
  // 보면 검토자가 통과로 읽는다.

  // 검토를 막는 숫자와 참고용 숫자를 크기로 가른다. 일곱을 같은 크기로 늘어놓으면
  // "지적 3"과 "건너뜀 1"이 같은 무게로 읽혀 무엇을 먼저 볼지가 사라진다.
  // (큰 숫자는 800 — Wanted 의 ExtraBold. Gmarket 자리가 아니라서 실제로 있다.
  //  작은 숫자(18px)는 700 — 800 은 20px 넘는 숫자 전용이다.)
  function caseStat(n, label, tone, small) {
    return '<div style="' + (small ? "flex:0 0 92px;" : "flex:1;") + 'text-align:center;padding:14px 8px;">' +
      '<div class="mono" style="font-size:' + (small ? "18px;font-weight:700" : "28px;font-weight:800;letter-spacing:var(--tr-display)") +
        ';line-height:1.2;font-variant-numeric:tabular-nums;color:' +
        (tone || "var(--text)") + ';">' + n + '</div>' +
      '<div style="font-size:' + (small ? "12px" : "13px") + ';font-weight:600;color:var(--text-3);margin-top:4px;">' + esc(label) + '</div></div>';
  }

  // 누를 수 있는 행에는 앱 공용 .row 를 붙인다 — cursor 만 바뀌고 hover 가
  // 없으면 눌리는 줄인지 대 보기 전에는 모른다(다른 표는 전부 .row 다).
  function caseRow(cells, act, arg) {
    return '<div' + (act ? ' class="row" data-act="' + esc(act) + '" data-arg="' + esc(arg || "") +
        '" tabindex="0" role="button"' : "") +
      ' style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-top:1px solid var(--line-2);font-size:14px;">' +
      cells + '</div>';
  }

  // 전체 지적을 어느 검사 층이 냈는지. 상단의 숫자 하나만 보여주면 사용자는
  // 산출물 표의 "지적 3건"과 전체 "지적 8건"이 왜 다른지 알 수 없다.
  function caseFindingCounts(p) {
    var out = { output: 0, case_wide: 0, pair: 0, manual_input: 0,
                unreviewed: 0, total: 0 };
    (p.findings || []).forEach(function (f) {
      if (f.unreviewed) { out.unreviewed++; return; }
      if (f.sev === "info") return;
      out[f.kind] = (out[f.kind] || 0) + 1;
      out.total++;
    });
    return out;
  }

  function caseFindingBadge(f) {
    var labels = {
      output: "문서 단독 검사",
      case_wide: "전체 필드 대조",
      pair: "두 문서 대조",
      manual_input: "외부 기준값 대조"
    };
    return sevBadge({
      unreviewed: !!f.unreviewed,
      sev: f.sev,
      label: labels[f.kind] || f.label || "검토 결과"
    });
  }

  function caseFindingSummary(p) {
    var c = caseFindingCounts(p);
    return '<div' +
      ' style="display:flex;align-items:center;gap:16px;padding:12px 14px;margin-bottom:14px;' +
      'border:1px solid var(--line);border-radius:var(--r-md);background:var(--panel);">' +
        '<div style="flex:none;">' +
          '<div class="mono" style="font-size:22px;font-weight:800;color:var(--text);">' + c.total + '</div>' +
          '<div style="font-size:14px;color:var(--text-2);">전체 수정 사항</div>' +
        '</div>' +
        '<div style="flex:1;min-width:0;">' +
          '<div style="font-size:14px;font-weight:600;color:var(--text);">' +
            '문서 단독 검사 ' + c.output + ' · 문서 간 불일치 ' + (c.case_wide + c.pair) +
            (c.manual_input ? ' · 외부 기준값 불일치 ' + c.manual_input : '') +
          '</div>' +
          '<div style="font-size:14px;color:var(--text-2);margin-top:4px;">' +
            (c.unreviewed ? '별도로 미검토 ' + c.unreviewed + '건이 남아 있습니다. ' : '') +
            '수정하거나 확인할 문제를 한 목록에서 봅니다.</div>' +
        '</div>' +
        '<button class="btn btn-sm btn-ghost" data-act="setCaseTab" data-arg="compare" style="flex:none;">' +
          '전체 수정 사항 보기 ' + ICONS.arrowRight + '</button>' +
      '</div>';
  }

  function caseMatrixSummary(p) {
    var rows = p.matrix || [];
    var counts = { "일치": 0, "불일치": 0, "미검토": 0 };
    rows.forEach(function (m) { counts[m.status] = (counts[m.status] || 0) + 1; });
    return '<div style="display:flex;align-items:center;gap:16px;padding:12px 14px;margin-bottom:14px;' +
      'border:1px solid var(--line);border-radius:var(--r-md);background:var(--panel);">' +
        '<div style="flex:none;">' +
          '<div class="mono" style="font-size:22px;font-weight:800;color:var(--text);">' +
            (counts["일치"] + counts["불일치"]) + '/' + rows.length + '</div>' +
          '<div style="font-size:14px;color:var(--text-2);">전체 필드 대조</div>' +
        '</div>' +
        '<div style="flex:1;min-width:0;">' +
          '<div style="font-size:14px;font-weight:600;color:var(--text);">' +
            '불일치 ' + counts["불일치"] + ' · 일치 ' + counts["일치"] +
            ' · 미검토 ' + counts["미검토"] + '</div>' +
          '<div style="font-size:14px;color:var(--text-2);margin-top:4px;">' +
            '여러 문서에서 같은 필드 값을 맞대본 결과입니다.</div>' +
        '</div>' +
        '<button class="btn btn-sm btn-ghost" data-act="setCaseTab" data-arg="matrix" style="flex:none;">' +
          '대조표 보기 ' + ICONS.arrowRight + '</button>' +
      '</div>';
  }

  function caseOutputTable(p) {
    var rows = (p.outputs || []).map(function (o) {
      var stale = o.formNo && o.formNo.stale;
      // 구 양식은 고쳐야 하는 것 — minor 틴트를 입는다. 회색 글자이던 때는
      // "최신"과 같은 무게라 훑어서는 안 걸렸다.
      var badge = stale
        ? '<span class="mono" style="font-size:12px;font-weight:600;flex:none;padding:2px 8px;' +
          'border-radius:var(--r-sm);background:var(--sev-min-bg);color:var(--sev-min-fg);' +
          'box-shadow:inset 0 0 0 1px var(--sev-min-bd);">구 양식 ' + esc(o.formNo.found) + ' → ' + esc(o.formNo.expected) + '</span>'
        : '<span style="font-size:12px;color:var(--text-3);flex:none;">최신</span>';
      // 이 행은 문서 단독 검사뿐 아니라 이 문서가 걸린 문서 간 지적도 말한다.
      // 예전에는 시험기록서에 온도 불일치가 있어도 자체 지적이 0이라 정상으로
      // 표시했다. 전체 숫자와 문서 행이 서로 반대말을 한 셈이다.
      var chip = function (text, bg, fg) {
        return '<span style="font-size:12px;font-weight:600;flex:none;padding:2px 8px;' +
          'border-radius:var(--r-sm);background:' + bg + ';color:' + fg + ';">' + text + '</span>';
      };
      var related = (p.findings || []).filter(function (f) {
        return docSides(f.document).indexOf(o.key) >= 0;
      });
      var cross = related.filter(function (f) {
        return !f.unreviewed && f.sev !== "info" && (f.kind === "case_wide" || f.kind === "pair");
      }).length;
      var manualInput = related.filter(function (f) {
        return !f.unreviewed && f.sev !== "info" && f.kind === "manual_input";
      }).length;
      var pending = related.filter(function (f) { return !!f.unreviewed; }).length;
      var marks = [];
      if (o.status !== "reviewed") {
        marks.push(chip("검사 안 됨", "var(--neutral-weak)", "var(--text-3)"));
      } else {
        if (o.findings) marks.push(chip("문서 단독 검사 " + esc(o.findings),
          "var(--accent-weak)", "var(--accent-ink)"));
        if (cross) marks.push(chip("문서 간 불일치 " + esc(cross),
          "var(--sev-maj-bg)", "var(--sev-maj-fg)"));
        if (manualInput) marks.push(chip("외부 기준값 불일치 " + esc(manualInput),
          "var(--sev-maj-bg)", "var(--sev-maj-fg)"));
        if (pending) marks.push(chip("관련 미검토 " + esc(pending),
          "var(--neutral-weak)", "var(--text-3)"));
        if (!o.findings && !cross && !manualInput && !pending) marks.push(chip(
          "관련 수정 사항 없음", "var(--band-good-bg)", "var(--band-good-fg)"));
      }
      return caseRow(
        '<span style="width:150px;flex:none;font-weight:600;">' + esc(o.key) + '</span>' +
        '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-2);">' + esc(o.file) + '</span>' +
        '<span style="flex:none;display:inline-flex;gap:6px;justify-content:flex-end;">' + marks.join("") + '</span>' +
        badge +
        '<button class="btn btn-sm btn-ghost" data-act="openCaseDoc" data-arg="' + esc(o.key) + '" style="flex:none;">' +
          '문서에서 보기</button>');
    }).join("");
    var missing = (p.missing || []).map(function (key) {
      return caseRow(
        '<span style="width:150px;flex:none;font-weight:600;color:var(--text-2);">' + esc(key) + '</span>' +
        '<span style="flex:1;color:var(--text-3);">올라오지 않았습니다 — 이 문서가 필요한 대조는 미검토로 남습니다</span>');
    }).join("");
    return '<div style="border:1px solid var(--line);border-radius:var(--r-md);overflow:hidden;">' + rows + missing + '</div>';
  }

  function caseFieldsPanel(p, sel) {
    var out = (p.outputs || []).filter(function (o) { return o.key === sel; })[0]
      || (p.outputs || [])[0];
    if (!out) return '<div style="font-size:14px;color:var(--text-2);">산출물이 없습니다.</div>';
    var chips = (p.outputs || []).map(function (o) {
      var on = o.key === out.key;
      return '<button class="chip" data-act="pickCaseOutput" data-arg="' + esc(o.key) + '" style="padding:6px 12px;border-radius:var(--r-sm);font-size:14px;font-weight:600;border:1px solid ' +
        (on ? "var(--accent)" : "var(--line)") + ';background:' + (on ? "var(--accent-weak)" : "var(--panel)") +
        ';color:' + (on ? "var(--accent-ink)" : "var(--text)") + ';">' +
        esc(o.key) + '</button>';
    }).join("");
    var fields = (out.fields || []).length
      ? (out.fields || []).map(function (f) {
          var val = f.selected && f.selected.length
            ? f.selected.join(" · ")
            : (f.found ? (f.value === "" ? "(빈 값)" : f.value) : "");
          return caseRow(
            '<span style="width:150px;flex:none;color:var(--text-2);">' + esc(f.name) + '</span>' +
            // 못 찾은 값은 대조표의 ? 와 같은 minor 톤이다 — 회색이던 때는
            // 정상 값과 같은 무게라 문제로 안 읽혔다.
            '<span class="mono" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' +
              (f.found ? esc(val)
                : '<span style="font-weight:600;color:var(--sev-min-fg);">찾지 못했습니다</span>' +
                  '<span style="color:var(--text-3);"> — 필드맵을 확인하십시오</span>') + '</span>' +
            '<span class="mono" style="flex:none;font-size:12px;color:var(--text-3);">' + esc(f.at || "") + '</span>',
            );
        }).join("")
      : caseRow('<span style="color:var(--text-3);">' + esc(out.reason || "값이 없습니다") + '</span>');
    return '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">' + chips + '</div>' +
      '<div style="font-size:14px;color:var(--text-2);margin-bottom:8px;">' + esc(out.reason || "") + '</div>' +
      '<div style="border:1px solid var(--line);border-radius:var(--r-md);overflow:hidden;">' + fields + '</div>';
  }


  // 필드 × 산출물 매트릭스. 팀이 xlsx No.13 에서 "비교용 엑셀"이라고 부른 것이다.
  //
  // **격자로 그린다** — 가로가 산출물, 세로가 항목. 어디서 틀어졌는지 교차점 하나로
  // 보인다. 지적 목록만으로는 맞은 곳이 안 보여서 "6곳 다 봤고 1곳이 틀렸다"를
  // 말할 수 없다.
  //
  // 어느 칸이 틀렸나는 **서버가 정한다**(cell.ok). 버전 무시 같은 정규화가 거기
  // 있어서, 화면이 다시 계산하면 두 곳의 판정이 어긋난다.
  function caseMatrix(p, focus) {
    var rows = p.matrix || [];
    if (!rows.length) return '<div style="font-size:14px;color:var(--text-2);">전 산출물 대조 기준이 없습니다.</div>';

    // 열은 기준에 나온 산출물 전부. 기준 파일에 적힌 순서를 지킨다(작성 순서다).
    var cols = [], seen = {};
    rows.forEach(function (m) {
      (m.cells || []).forEach(function (c) {
        if (!seen[c.output]) { seen[c.output] = 1; cols.push(c.output); }
      });
    });

    // 셀 상태 중 **문제만 색을 받는다** — 검토자는 붉은 칩만 훑으면 된다.
    // 다른 값은 값 자체를 칩에 싣는다. "다르다(⚠)"만 찍고 값을 툴팁에 숨기면
    // 무엇이 어떻게 다른지 보러 문서를 또 열어야 했다. 같음 표시는 유니코드
    // ✔ 대신 다른 화면과 같은 선형 체크 아이콘을 쓴다.
    function mark(c) {
      if (!c) return { h: '<span style="color:var(--line);">–</span>',
                       tip: "이 항목의 대조 대상이 아닙니다" };
      if (!c.present) return { h: '<span style="color:var(--text-3);">·</span>',
                               tip: "올라오지 않았습니다" };
      if (c.configured === false) return {
        h: '<span style="font-size:12px;color:var(--text-3);">설정 없음</span>',
        tip: "이 문서의 필드 추출 규칙이 없습니다" };
      if (!c.found) return { h: '<span style="font-weight:700;color:var(--sev-min-fg);">?</span>',
                             tip: "값을 찾지 못했습니다" };
      if (c.ok === false) return {
        h: '<span class="mono" style="display:inline-block;max-width:100%;overflow:hidden;' +
           'text-overflow:ellipsis;white-space:nowrap;vertical-align:middle;font-size:12px;' +
           'font-weight:600;padding:2px 8px;border-radius:var(--r-sm);background:var(--sev-crit-bg);' +
           'color:var(--sev-crit-fg);box-shadow:inset 0 0 0 1px var(--sev-crit-bd);">' +
           esc(c.value || "다름") + '</span>',
        tip: c.value || "값이 다릅니다" };
      return { h: '<span style="display:inline-flex;vertical-align:middle;color:var(--text-2);">' +
                  ICONS.check + '</span>', tip: c.value || "" };
    }

    // 머리행은 기록 목록의 머리행과 같은 관용구(옅은 바닥면 + 12px 600) — 맨
    // 글자만 띄우면 표 전체가 선 긋기로만 서서 딱딱하게 읽힌다.
    var head = '<div style="display:flex;background:var(--bg);border-bottom:1px solid var(--line);">' +
      '<div style="width:150px;flex:none;padding:8px 10px;font-size:12px;font-weight:600;color:var(--text-3);">항목</div>' +
      cols.map(function (k) {
        return '<div style="flex:1;min-width:0;padding:8px 4px;font-size:12px;font-weight:600;color:var(--text-3);text-align:center;' +
          'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + esc(k) + '">' + esc(k) + '</div>';
      }).join("") +
      '<div style="width:132px;flex:none;padding:8px 10px;font-size:12px;font-weight:600;color:var(--text-3);text-align:right;">판정</div>' +
    '</div>';

    // 행의 판정은 오른쪽 칩이 진다 — 심각도 칩과 같은 어휘(면+글자+안선)라
    // 불일치는 지적 카드의 빨강, 미검토는 과정 보고의 슬레이트, 일치는 통과
    // 초록으로, 다른 화면과 같은 말을 한다. 항목 이름은 중립으로 돌아간다 —
    // 이름까지 붉히면 한 상태를 두 번 말하는 것이다.
    function statusChip(m) {
      var pal = m.status === "불일치"
        ? { bg: "var(--sev-crit-bg)", fg: "var(--sev-crit-fg)", bd: "var(--sev-crit-bd)" }
        : m.status === "일치"
          ? { bg: "var(--band-good-bg)", fg: "var(--band-good-fg)", bd: "transparent" }
          : { bg: "var(--sev-info-bg)", fg: "var(--sev-info-fg)", bd: "var(--sev-info-bd)" };
      return '<span style="display:inline-flex;align-items:center;padding:2px 8px;font-size:12px;' +
        'font-weight:600;border-radius:var(--r-sm);background:' + pal.bg + ';color:' + pal.fg +
        ';box-shadow:inset 0 0 0 1px ' + pal.bd + ';">' + esc(m.status) + '</span>';
    }

    var body = rows.map(function (m) {
      var byOut = {};
      (m.cells || []).forEach(function (c) { byOut[c.output] = c; });
      var related = (p.findings || []).filter(function (f) { return f.ruleId === m.id; })[0];
      var open = focus === m.id;
      // 행 전체가 같은 상세를 여는 한 동작이다. 체크·값 칸은 상태 표시일 뿐이라
      // 별도 클릭 대상으로 만들지 않는다. 원문 이동은 펼친 상세의 명시적인
      // "문서에서 보기" 버튼이 맡는다.
      var row = '<div class="case-matrix-row' + (open ? ' is-open' : '') + '"' +
          ' data-matrix-row="' + esc(m.id) + '" data-act="openMatrixDetail" data-arg="' + esc(m.id) + '"' +
          ' tabindex="0" role="button" aria-expanded="' + (open ? 'true' : 'false') + '"' +
          ' title="' + esc(m.field + " 대조 상세 보기") + '">' +
        '<div class="case-matrix-field"' +
          ' style="width:150px;flex:none;padding:8px 10px;font-size:14px;font-weight:600;color:var(--text);' +
          'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"' +
          '>' +
          '<span style="display:inline-flex;align-items:center;gap:6px;">' +
            // 유니코드 ▸ 는 앱의 아이콘(선형 SVG)과 다른 세 번째 어휘였다.
            // 여닫이 회전은 index.html .case-matrix-disclosure 가 진다.
            '<span class="case-matrix-disclosure"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg></span>' +
            esc(m.field) + '</span></div>' +
        cols.map(function (k) {
          var c = byOut[k], mk = mark(c);
          return '<div style="flex:1;min-width:0;padding:8px 6px;text-align:center;font-size:14px;"' +
            ' title="' + esc(k + " — " + mk.tip) + '">' + mk.h + '</div>';
        }).join("") +
        '<div style="width:132px;flex:none;padding:8px 10px;display:flex;align-items:center;' +
          'justify-content:flex-end;gap:8px;">' + statusChip(m) +
          '<span class="mono" style="font-size:12px;color:var(--text-3);font-variant-numeric:tabular-nums;">' +
          m.seen + '/' + m.total + '</span></div>' +
      '</div>';

      if (!open) return row;
      var details = (m.cells || []).map(function (c) {
        var stateText = !c.present ? "문서가 올라오지 않음"
          : c.configured === false ? "추출 규칙 없음"
          : !c.found ? "값을 찾지 못함"
          : c.ok === false ? "불일치 값"
          : "확인한 값";
        return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px solid var(--line-2);">' +
          '<span style="width:150px;flex:none;font-weight:600;color:var(--text-2);">' + esc(c.output) + '</span>' +
          '<span class="mono" style="flex:1;min-width:0;color:' +
            (c.ok === false ? 'var(--sev-crit-fg)' : 'var(--text-2)') + ';">' +
            esc(c.found ? (c.value || "(빈 값)") : stateText) + '</span>' +
          '<span style="flex:none;font-size:12px;color:var(--text-3);">' + esc(stateText) + '</span>' +
          (c.found
            ? '<button class="btn btn-sm btn-ghost" data-act="openCaseDoc" data-arg="' +
              esc(c.output + (related ? "|" + related.id : "")) + '">문서에서 보기</button>'
            : '') +
        '</div>';
      }).join("");
      var reason = m.status === "불일치"
        ? "문서에서 읽은 값이 서로 다릅니다. 어느 값이 맞는지는 원문과 기준을 확인해야 합니다."
        : m.status === "미검토"
          ? "필요한 문서값을 모두 확보하지 못해 대조를 끝내지 못했습니다."
          : "대상 문서에서 읽은 값이 모두 일치합니다.";
      return row + '<div class="case-matrix-detail" data-matrix-detail="' + esc(m.id) + '"' +
          ' role="region" aria-label="' + esc(m.field + " 대조 상세") + '">' +
          '<div class="case-matrix-detail-head">' +
            '<span class="case-matrix-detail-title">' + esc(m.field) + ' 대조 상세</span>' +
            '<span class="case-matrix-detail-reason">' + esc(reason) + '</span>' +
            '<button class="btn btn-sm btn-ghost" data-act="openCriteria" data-arg="' + esc(m.id) +
              '" style="margin-left:auto;flex:none;">이 기준 보기</button>' +
          '</div>' + details +
        '</div>';
    }).join("");

    return '<div style="border:1px solid var(--line);border-radius:var(--r-md);overflow:hidden;">' + head + body + '</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:8px 14px;margin-top:10px;font-size:12px;color:var(--text-3);align-items:center;">' +
        '<span style="display:inline-flex;align-items:center;gap:4px;">' +
          '<span style="display:inline-flex;color:var(--text-2);">' + ICONS.check + '</span> 같음</span>' +
        '<span style="display:inline-flex;align-items:center;gap:4px;">' +
          '<span class="mono" style="font-weight:600;padding:2px 6px;border-radius:var(--r-sm);' +
          'background:var(--sev-crit-bg);color:var(--sev-crit-fg);box-shadow:inset 0 0 0 1px var(--sev-crit-bd);">값</span>' +
          ' 다름 — 그 문서의 값</span>' +
        '<span><b style="color:var(--sev-min-fg);">?</b> 값을 못 찾음</span>' +
        '<span>설정 없음 — 추출 규칙 없음</span>' +
        '<span><b>·</b> 안 올라옴</span>' +
        '<span><b style="color:var(--line);">–</b> 대조 대상 아님</span>' +
      '</div>';
  }

  function caseFindingList(p) {
    if (!(p.findings || []).length) {
      return '<div style="font-size:14px;color:var(--text-2);">대조에서 나온 것이 없습니다.</div>';
    }
    return '<div style="border:1px solid var(--line);border-radius:var(--r-md);overflow:hidden;">' +
      p.findings.map(function (f) {
        // 심각도 색은 그 지적의 등급을 따른다 — 주황을 박아 두면 minor·info 도
        // "주의"로 읽힌다(caseDocView 도 같은 자리를 고쳤다).
        // 인용은 단일 검토 카드와 같은 형광펜(mark.sev-*)으로 칠한다 — 회색
        // mono 만이던 때는 같은 근거가 화면마다 다른 옷을 입었다. 등급이 없는
        // 줄(미검토)은 심각도 색을 빌리지 않는다.
        var ev = (f.evidence || []).map(function (e) {
          return '<div style="display:flex;gap:8px;font-size:14px;color:var(--text);margin-top:4px;">' +
            '<span class="mono" style="flex:none;width:74px;">' + esc(e.at) + '</span>' +
            '<span class="mono" style="min-width:0;">' +
              (f.sev && !f.unreviewed
                ? '<mark class="sev-' + esc(f.sev) + '">' + esc(e.quote) + '</mark>'
                : esc(e.quote)) + '</span></div>';
        }).join("");
        return '<div style="padding:12px 14px;border-top:1px solid var(--line-2);">' +
          '<div style="display:flex;gap:8px;align-items:center;">' +
            // 단일 검토와 같은 뱃지. 기준 id 는 안 낸다 — 뱃지가 무엇이 잡았는지를
            // 이미 사람 말로 말한다(caseDocView 도 같은 자리를 뺐다).
            caseFindingBadge(f) +
            '<span style="font-size:12px;color:var(--text-3);margin-left:auto;flex:none;">' + esc(f.document || "") + '</span>' +
          '</div>' +
          '<div style="font-size:14px;margin-top:4px;">' + esc(f.message) + '</div>' + ev +
          (f.unreviewed ? "" : '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;">' +
            docSides(f.document).map(function (side) {
              return '<button class="btn btn-sm btn-ghost" data-act="openCaseDoc" data-arg="' + esc(side + "|" + f.id) + '">' +
                esc(side) + ' 문서에서 보기</button>';
            }).join("") +
            (f.kind === "case_wide"
              ? '<button class="btn btn-sm btn-ghost" data-act="openMatrixDetail" data-arg="' +
                esc(f.ruleId || "") + '">대조표에서 보기</button>'
              : '') +
            (f.ruleId
              ? '<button class="btn btn-sm btn-ghost" data-act="openCriteria" data-arg="' +
                esc(f.ruleId) + '">기준 보기</button>'
              : '') + '</div>') +
        '</div>';
      }).join("") + '</div>';
  }

  function caseOtherPanel(p) {
    function block(title, items, note) {
      if (!items.length) return "";
      return '<div style="margin-bottom:14px;">' +
        '<div style="font-size:14px;font-weight:600;margin-bottom:6px;">' + esc(title) + ' ' + items.length + '건</div>' +
        (note ? '<div style="font-size:14px;color:var(--text-2);margin-bottom:6px;">' + esc(note) + '</div>' : "") +
        '<div style="border:1px solid var(--line);border-radius:var(--r-md);overflow:hidden;">' +
          items.map(function (x) {
            return caseRow('<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(x.file) + '</span>' +
              (x.reason ? '<span style="flex:none;font-size:12px;color:var(--text-3);">' + esc(x.reason) + '</span>' : ""));
          }).join("") + '</div></div>';
    }
    var body = block("분류가 필요한 파일", p.unclassified || [],
        "양식번호가 없어 산출물을 정하지 못했습니다. 추측해 배정하면 엉뚱한 기준으로 검사합니다.") +
      block("참고자료 제외", p.ignored || [], "검토 대상이 아닌 참고자료로 분류되어 검사에서 제외했습니다.");
    return body || '<div style="font-size:14px;color:var(--text-2);">분류가 필요한 파일이나 제외된 참고자료가 없습니다.</div>';
  }


  // 지적을 누르면 그 산출물을 뷰어로 연다. 단일 검토와 같은 부품을 쓴다 —
  // render-pdf 로 PDF 를 만들고 locate 로 인용문 위치를 받아 형광펜을 얹는다.
  //
  // 대조 지적은 문서 **둘**을 가리킨다. 여기서는 연 문서 쪽 근거만 짚고, 반대쪽은
  // 오른쪽 목록에 값으로 보여 준다 — 나란히 띄우는 것은 그다음이다.
  // 검토 결과 패널의 껍데기. **단일 검토와 폴더 검토가 같은 것을 쓴다.**
  //
  // 예전엔 둘이 따로였다 — 단일은 400px 에 그림자·40px 큰 숫자·분포 바·범례,
  // 폴더는 340px 에 13px 한 줄("이 문서의 지적 3건")이었다. 같은 일을 하는 자리가
  // 이만큼 다르면 두 화면이 다른 도구처럼 읽힌다.
  //
  // 카드까지 합치지는 않는다 — 폴더 검토 카드는 지적이 걸친 문서 여럿과
  // "저 문서에서 보기" 버튼을 진다. 단일 검토에는 그 개념 자체가 없어서, 합치면
  // 분기투성이 함수가 되고 한쪽을 고칠 때마다 다른 쪽을 깨뜨린다.
  //
  // opts: {id, title, count, sub, noClean, filters, chips, actions, overlay, note, body, hidden}
  //   chips  [{sev,label,count,on}] — on 이 있으면 눌러서 거르는 범례, 없으면 그냥 범례
  //   actions 헤더 오른쪽 버튼들(내보내기·접기). 없으면 자리도 안 만든다
  function issuesShell(opts) {
    var total = opts.count || 0;
    var chips = opts.chips || [];
    var interactiveLegend = chips.some(function (c) { return c.on !== undefined; });
    var legend = chips.map(function (c) {
      // 거를 수 있으면 누를 수 있게, 아니면 글자만. 폴더 검토에는 필터 상태가
      // 없으므로(state.kase 에 sevFilter 가 없다) 누르는 시늉을 하지 않는다.
      //
      // 읽기 전용 범례는 색 점으로 등급을 연결한다. 반면 결과 보기 버튼은
      // `확실·확인 필요`라는 이름과 선택된 솔리드 면이 이미 상태를 말하므로 점을
      // 반복하지 않는다. 좁은 결과 패널에서도 다섯 보기가 한 줄을 지키게 한다.
      var pal = SEV[c.sev] || SEV.unknown;
      var dot = c.sev === "all" ? "" : '<i style="background:' + pal.dot + ';"></i>';
      if (c.on !== undefined) {
        return '<button type="button" class="result-filter' + (c.on ? ' is-active' : '') +
          '" data-act="setSevFilter" data-arg="' + c.sev + '" aria-pressed="' +
          (c.on ? 'true' : 'false') + '" title="' + esc(c.label) + ' 결과만 보기">' +
          '<span>' + esc(c.label) + '</span><b>' + c.count + '</b></button>';
      }
      return '<span class="result-legend">' + dot + '<span>' + esc(c.label) +
        '</span><b>' + c.count + '</b></span>';
    }).join("");

    // 폭은 화면을 따라간다. 400px 고정이면 27인치에서는 지적 문장이 서너 글자마다
    // 꺾이고, 13인치에서는 같은 400px 이 문서를 절반 가까이 먹는다 — 둘 다 400 이
    // "적당했던" 한 화면 크기에서만 맞는 값이었다. 아래위 한계는 두어야 한다:
    // 360 아래로는 뱃지 줄이 두 줄로 접히고, 480 위로는 문서가 밀린다.
    return '<div' + (opts.id ? ' id="' + opts.id + '"' : "") +
      ' style="width:clamp(360px, 26vw, 480px);flex:none;margin:4px 32px 12px 0;background:var(--panel);' +
      'border:1px solid var(--line);border-radius:var(--r-md);' +
      'display:' + (opts.hidden ? "none" : "flex") + ';flex-direction:column;overflow:hidden;z-index:10;">' +
      (opts.header || ('<div class="issues-head">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">' +
          '<span style="font-weight:700;font-size:15px;color:var(--text-title);letter-spacing:var(--tr-body);">' + esc(opts.title) + '</span>' +
          (opts.actions ? '<div style="display:flex;align-items:center;gap:6px;">' + opts.actions + '</div>' : "") +
        '</div>' +
        (opts.overlay || "") +
        // 큰 자리에는 **실제로 센 것**만 둔다 — 지적 건수. 예전에는 점수가 있었으나
        // 눈금에 근거가 없어 뺐다(CLAUDE.md "기능 방침 — 점수").
        //
        // 0건일 때만 판정 칩을 붙인다. "지적 없음"은 검사 결과로 말할 수 있지만
        // "위험"은 말할 근거가 없다 — 그래서 --band-warn/bad 는 같이 지웠다.
        // noSummary: 큰 숫자 줄을 아예 안 그린다 — 비교 원문 창의 판정 패널은 셀 게
        // 없다("0건 수정 사항 · 이상 없음"이 요건 하나짜리 패널에 붙어 있었다).
        (opts.noSummary ? '' :
        '<div style="display:flex;align-items:baseline;gap:10px;margin-bottom:12px;">' +
          '<span class="issues-count">' + total + '</span>' +
          '<span style="font-size:14px;font-weight:600;color:var(--text-3);">건 ' + esc(opts.noun || "수정 사항") + '</span>' +
          // sub: 큰 숫자에 안 섞은 것들(참고·미검토)의 건수. 지적이 아니라서
          // 따로 말하되, 숨기지는 않는다.
          (opts.sub ? '<span style="font-size:12px;font-weight:600;color:var(--text-3);">· ' + esc(opts.sub) + '</span>' : '') +
          // noClean: 0건이어도 미검토가 남았으면 "이상 없음"이라 말하지 않는다.
          (total === 0 && !opts.noClean
            ? '<span style="margin-left:auto;font-size:12px;font-weight:600;color:var(--band-good-fg);background:var(--band-good-bg);padding:6px 12px;border-radius:var(--r-xl);">이상 없음</span>'
            : '') +
        '</div>') +
        // **한 가지 등급뿐이면 범례를 안 그린다.** `Major 12` 칩 하나는 위의 큰
        // 숫자 12 를 한 번 더 말하는 것뿐이다. 폴더 검토가 그렇다 — 규칙만
        // 돌아서 지적이 전부 MAJOR 다. CRITICAL 을 지운 것과 같은 이유다
        // (shared/models.py Severity). 이 판단은 chips.length > 1 가 진다.
        //
        // 분포 바는 지웠다 — 칩의 건수들이 이미 다 말하는 비율을 채도 높은
        // 원색 띠로 한 번 더 그렸고, 패널에서 제일 시끄러운 색이 정보가 아니라
        // 장식이었다. 색은 의미가 실리는 자리(칩·형광펜)에만 남긴다.
        (chips.length > 1
          ? (interactiveLegend
            ? '<div class="result-filter-block"><span class="result-filter-label">결과 보기</span>' +
                '<div class="result-filter-group" role="group" aria-label="결과 보기">' + legend + '</div></div>'
            : '<div class="result-legend-group">' + legend + '</div>')
          : "") +
        // filters: 정렬·검사기 칩(단일 검토만 넘긴다). 범례 아래 한 줄.
        (opts.filters ? '<div style="margin-top:8px;">' + opts.filters + '</div>' : "") +
        (opts.note || "") +
        // 탭은 스크롤 밖, **헤더의 마지막 줄**에 산다. body 안에 넣으면 카드를
        // 내리는 순간 "지금 어느 탭을 보고 있는지"가 함께 사라지고, 헤더 밖에
        // 따로 줄을 두면 헤더 경계선과 탭 경계선이 이중으로 생겨 다른 화면의
        // 탭(전역 헤더의 스텝 탭 — 경계선 하나 위에 앉는다)과 어긋난다.
        // 음수 마진이 헤더의 아래 패딩(16px)을 지워 밑줄이 경계선에 붙는다.
        (opts.tabs ? '<div style="margin:14px 0 -16px;">' + opts.tabs + '</div>' : "") +
      '</div>')) +
      // 스크롤은 바깥(패딩 0)에서 → 스크롤바가 카드 가장자리에 붙는다. 안쪽 래퍼가
      // 좌우 대칭 여백(바깥에 padding-right 를 주면 스크롤바 오른쪽에 빈 채널이 생긴다).
      '<div data-scroll="issues" style="flex:1;overflow-y:auto;"><div style="padding:14px 16px;' + (opts.bodyMotion || '') + '">' + opts.body + '</div></div>' +
    '</div>';
  }

  // 지적 목록 → 범례용 칩. on 을 안 주면 거르기 없는 범례가 된다.
  function sevChipsOf(findings, sevFilter) {
    var counts = {};
    (findings || []).forEach(function (f) { counts[f.sev] = (counts[f.sev] || 0) + 1; });
    return sevGroupCounts(counts, sevFilter).filter(function (c) { return c.count > 0; });
  }

  function caseDocView(v) {
    var k = v.kase, view = k.view, p = k.payload;
    var out = (p.outputs || []).filter(function (o) { return o.key === view.key; })[0] || {};
    var mine = (p.findings || []).filter(function (f) {
      return !f.unreviewed && f.sev !== "info" && (f.document || "").indexOf(view.key) >= 0;
    });
    var markNos = {};
    (((state.marks || {}).items) || []).forEach(function (it) {
      if (it.no) markNos[it.id] = it.no;
    });

    // 단일 검토와 같은 뷰어 크롬(viewerHeadHtml) — 문서명·쪽수·형광펜·줌·
    // 전체화면. 준비 중·실패 상태에서도 헤더는 남긴다(단일 검토와 같은 짜임).
    var head = viewerHeadHtml(out.file || view.key, true, "", v.converting || !k.view);
    var body;
    if (v.convertError) {
      body = head + '<div style="flex:1;display:flex;align-items:center;justify-content:center;padding:20px;font-size:14px;color:var(--sev-crit-fg);">' + esc(v.convertError) + '</div>';
    } else if (v.converting || !k.view) {
      body = head + pdfPendingHtml("문서를 PDF로 준비하는 중…");
    } else {
      body = head + '<div id="pdf-mount" style="flex:1;overflow:hidden;"></div>';
    }

    var cards = mine.length
      ? mine.map(function (f, ci) {
          var sides = docSides(f.document);
          // 근거 줄과 문서를 짝지을 수 있을 때만 이름을 단다. 개수가 다르면
          // i 번째 근거가 i 번째 문서의 것이라는 보장이 없다 — 억지로 맞추면
          // 남의 문서 이름이 붙은 인용이 나온다.
          var paired = sides.length > 1 && (f.evidence || []).length === sides.length;
          var ev = (f.evidence || []).map(function (e, i) {
            var side = e.document || (paired ? sides[i] : "");
            var here = side === view.key;
            // 인용은 단일 검토 카드와 같은 형광펜(mark.sev-*) — PDF 위 형광펜과
            // 카드 근거가 같은 색으로 같은 문장을 가리킨다. 다른 문서의 인용은
            // 칠하지 않는다(이 화면의 형광펜은 지금 보는 문서 것이다).
            return '<div style="display:flex;gap:8px;font-size:12px;margin-top:4px;' +
              (here || !paired ? "" : "color:var(--text-3);") + '">' +
              '<span style="flex:none;width:52px;">' + esc(side) + '</span>' +
              '<span class="mono" style="flex:none;width:70px;color:var(--text-3);">' + esc(e.at) + '</span>' +
              '<span class="mono" style="min-width:0;">' +
                (f.sev && (here || !paired)
                  ? '<mark class="sev-' + esc(f.sev) + '">' + esc(e.quote) + '</mark>'
                  : esc(e.quote)) + '</span></div>';
          }).join("");
          // 이 지적이 걸친 **나머지 문서 전부**. 하나만 가정하면 전체 대조
          // (문서 3~4개)에서 세 이름이 붙은 버튼 하나가 나오고, 그 이름의
          // 산출물이 없어 눌러도 아무 일이 없었다.
          var others = sides.filter(function (x) { return x && x !== view.key; });
          // 첫 칸에는 구분선을 안 얹는다 — 패널 안쪽 여백 위에 선이 떠 보인다.
          return '<div data-case-finding="' + esc(f.id) + '" style="padding:12px 2px;' +
            (ci ? "border-top:1px solid var(--line-2);" : "") + '">' +
            '<div style="display:flex;gap:8px;align-items:center;">' +
              '<span data-case-number="' + esc(f.id) + '" style="display:inline-flex;align-items:center;gap:4px;">' +
                numberChip(markNos[f.id] || "", null, f.id, true) + '</span>' +
              // 심각도 뱃지는 **형광펜과 짝이다.** PDF 위 형광펜이 심각도 색으로
              // 칠해지므로(pdfview.js _SEV), 카드에서 등급을 빼면 노란 형광펜을
              // 보고도 왜 노란지 알 길이 없어진다.
              //
              // 폴더 검토는 규칙만 돌아 지금은 전부 MAJOR 라 뱃지가 늘 같다. 그래도
              // 남긴다 — 여기서 뱃지가 하는 일은 "등급을 가른다"가 아니라 "형광펜
              // 색이 무엇을 뜻하는지 말한다"이다. 분포 바·범례는 그 짝이 없으므로
              // 한 등급뿐일 때 그리지 않는다(issuesShell).
              caseFindingBadge(f) +
              // 기준 id(`F-성적서번호` · `W-작성일자-순서` · `1-7/대표자`)는 **화면에
              // 안 낸다.** 셋이 규칙도 출처도 달라(코드 생성 · 팀 yaml 의 case_wide ·
              // 팀 yaml 의 pairs) 검토자가 읽을 값이 아니다. 뱃지가 무엇이 잡았는지를
              // 이미 사람 말로 말한다 — id 는 그 옆에서 자리만 차지했다.
              //
              // 값 자체는 payload 에 남는다(ruleId) — CSV·리포트가 되짚을 때 쓴다.
            '</div>' +
            '<div style="font-size:13px;margin-top:4px;">' + esc(f.message) + '</div>' + ev +
            (others.length
              ? '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;">' +
                others.map(function (o) {
                  return '<button class="btn btn-ghost" data-act="openCaseDoc" data-arg="' + esc(o + "|" + f.id) +
                    '" style="padding:4px 10px;font-size:14px;">' + esc(o) + ' 에서 보기</button>';
                }).join("") + '</div>'
              : "") +
          '</div>';
        }).join("")
      : '<div style="padding:14px;font-size:13px;color:var(--text-2);">이 문서를 가리키는 수정 사항이 없습니다.</div>';

    // 단일 검토 결과와 같은 행 구조 — id(results-row)와 스타일이 같아야
    // 전체화면(toggleViewerFull)·Esc 가 이 화면에서도 같은 손잡이로 동작한다.
    // 파일명은 상단 바가 아니라 뷰어 헤더가 말한다(단일 검토와 같은 자리).
    return '<div style="height:100%;box-sizing:border-box;display:flex;flex-direction:column;">' +
      // 돌아가기는 단일 검토의 백링크와 같은 관용구(hover-accent + 화살표) —
      // 여기만 ghost 버튼이면 같은 동작이 화면마다 다른 손잡이로 보인다.
      '<div style="display:flex;align-items:center;gap:10px;flex:none;padding:10px 32px 4px;">' +
        '<div class="hover-accent" data-act="closeCaseDoc" tabindex="0" role="button" ' +
          'style="display:inline-flex;align-items:center;gap:6px;font-size:14px;font-weight:500;' +
          'color:var(--text-3);cursor:pointer;padding:8px;margin-left:-8px;">' +
          ICONS.arrowLeft + ' 리포트로 돌아가기</div>' +
        '<span style="font-size:14px;font-weight:700;">' + esc(view.key) + '</span>' +
      '</div>' +
      '<div id="results-row" style="' + resultsRowCss(state.viewerFull) + '">' +
        viewerWrap(true, body) +
        // 단일 검토와 같은 껍데기(issuesShell). 제목만 다르다 — 여기서는 폴더 안
        // 문서 하나를 보는 중이라 "이 문서의" 를 붙여야 무엇을 센 숫자인지 읽힌다.
        // chips 를 안 넘긴다 — 이 목록은 지적만 담고(미검토는 걸러진다) 폴더
        // 검토는 규칙만 돌아 전부 MAJOR 다. 한 칸짜리 분포 바와 `● Major 3`
        // 한 줄은 위의 큰 숫자를 두 번 더 말하는 것뿐이다.
        issuesShell({
          title: "이 문서의 검토 결과",
          count: mine.length,
          body: cards
        }) +
      '</div>' +
    '</div>';
  }


  function caseManual(v, p) {
    var k = v.kase, manual = p.manual || [];
    if (!manual.length) return "";
    var savedResults = p.manualResults || [];
    var rows = manual.map(function (m) {
      var on = !!k.checked[m.id];
      var value = (k.manualInputs || {})[m.id] || "";
      var result = savedResults.filter(function (r) { return r.id === m.id; })[0];
      var status = result && result.status;
      var statusTone = status === "일치" ? "color:var(--band-good-fg);background:var(--band-good-bg);"
        : status === "수정 필요" ? "color:var(--sev-maj-fg);background:var(--sev-maj-bg);"
        : "color:var(--text-3);background:var(--neutral-weak);";
      var compared = result && result.input
        ? (result.cells || []).map(function (c) {
            return '<span style="font-size:14px;color:' +
              (c.ok === true ? 'var(--band-good-fg)' : c.ok === false ? 'var(--sev-maj-fg)' : 'var(--text-3)') +
              ';">' + esc(c.output) + ': ' + esc(c.found ? c.value : '값 못 찾음') + '</span>';
          }).join('<span style="color:var(--line);"> · </span>')
        : "";
      var affected = result && result.affectedCount
        ? '<div data-manual-result style="margin:8px 0 0 28px;padding:10px 12px;border-radius:var(--r-sm);' +
            'background:var(--sev-maj-bg);color:var(--sev-maj-fg);font-size:14px;">' +
            '<div style="font-weight:700;">일괄 수정 필요 · 올바른 값 ' +
              '<span class="mono">' + esc(result.correctValue) + '</span> · 대상 ' +
              esc(result.affectedCount) + '개 문서</div>' +
            '<div style="display:flex;flex-wrap:wrap;gap:4px 12px;margin-top:6px;">' +
              (result.affected || []).map(function (a) {
                return '<span>' + esc(a.output) + ': <span class="mono">' +
                  esc(a.currentValue) + '</span> → <span class="mono">' +
                  esc(a.correctValue) + '</span></span>';
              }).join('') +
            '</div></div>'
        : "";
      return '<div data-manual-row="' + esc(m.id) + '" style="padding:12px;border-top:1px solid var(--line-2);font-size:14px;">' +
        '<div style="display:flex;align-items:center;gap:10px;">' +
        '<button type="button" aria-label="' + esc(m.text) + ' 확인" data-act="toggleManual" data-arg="' + esc(m.id) + '" ' +
          (v.kase.confirming ? "disabled " : "") +
          'style="width:18px;height:18px;padding:0;flex:none;border-radius:4px;border:1px solid ' +
          (on ? "var(--accent)" : "var(--line)") + ';background:' + (on ? "var(--accent)" : "var(--panel)") +
          ';color:#fff;display:flex;align-items:center;justify-content:center;font-size:14px;">' + (on ? ICONS.check : "") + '</button>' +
        '<span style="flex:1;' + (on ? "" : "color:var(--text-2);") + '">' + esc(m.text) + '</span>' +
        '<span style="flex:none;font-size:12px;color:var(--text-3);">대조 원천: ' + esc(m.against || "") + '</span>' +
        (status ? '<span data-manual-result style="flex:none;font-size:14px;font-weight:600;padding:4px 8px;border-radius:var(--r-sm);' +
          statusTone + '">' + esc(status) + '</span>' : '') +
        '</div>' +
        '<div class="case-manual-entry">' +
          '<input type="text" data-manual-input="' + esc(m.id) + '" value="' + esc(value) + '" ' +
            (v.kase.confirming ? "disabled " : "") +
            'placeholder="' + esc((m.against || "외부 원천") + '의 기준값 입력') + '" ' +
            'style="padding:8px 10px;border:1px solid var(--line);border-radius:var(--r-sm);' +
            'background:var(--panel);color:var(--text);font-size:14px;">' +
          '<span style="font-size:13px;color:var(--text-2);">입력값과 문서의 ' + esc((result && result.field) || String(m.id).replace(/^M-/, "")) + ' 값을 대조합니다.</span>' +
        '</div>' +
        affected +
        (compared ? '<div data-manual-result style="display:flex;flex-wrap:wrap;gap:4px;margin:8px 0 0 28px;">' + compared + '</div>' : '') +
      '</div>';
    }).join("");
    var done = manual.filter(function (m) { return k.checked[m.id]; }).length;
    return caseCard(
      '<div style="display:flex;align-items:baseline;gap:8px;">' +
        '<span style="font-size:14px;font-weight:600;">직접 확인 ' + done + '/' + manual.length + '</span>' +
        '<span style="font-size:13px;color:var(--text-2);">외부 원천을 확인해 체크하고 값을 입력하면, 저장된 문서값과 추가 대조합니다.</span>' +
      '</div>' +
      '<div style="border:1px solid var(--line);border-radius:var(--r-md);overflow:hidden;margin-top:10px;">' + rows + '</div>' +
      '<div style="display:flex;align-items:center;gap:10px;margin-top:12px;">' +
        '<button class="btn btn-primary" data-act="confirmCase"' + (v.kase.confirming ? " disabled" : "") +
          ' style="flex:1;padding:10px;font-size:14px;font-weight:600;">' +
          (v.kase.confirming ? "추가 대조·저장 중…" : "추가 대조 후 점검 확정 · 이력 저장") + '</button>' +
        // 누른 결과는 누르는 자리 옆에 둔다. 떨어져 있으면 눌렸는지 확인하러
        // 다른 데를 봐야 한다.
        (k.confirmedAt ? '<span id="case-confirmed-at" style="flex:none;font-size:12px;color:var(--text-3);">확정 ' +
          esc(String(k.confirmedAt).replace("T", " ").replace("+00:00", " UTC")) +
          (k.confirmedBy ? ' · ' + esc(k.confirmedBy) : '') + '</span>' : "") +
      '</div>', "20px");
  }

  function caseReport(v) {
    var k = v.kase, p = k.payload, st = p.stats || {};
    var actualCounts = caseFindingCounts(p);
    st = Object.assign({}, st, { findings: actualCounts.total, unreviewed: actualCounts.unreviewed });
    if (k.view) return caseDocView(v);
    var tab = k.tab || "summary";
    var manual = p.manual || [];
    var done = manual.filter(function (m) { return k.checked[m.id]; }).length;
    var excluded = (st.unclassified || 0) + (st.ignored || 0);
    // 헤더 숫자는 앱이 이미 정한 뜻색으로 말한다 — 지적>0 은 심각도 주황,
    // 0 은 통과 초록. 미검토는 심각도가 아니라 "검토 과정 보고"라 info 와 같은
    // 슬레이트다(섞으면 안 되는 구분을 색이 지킨다). 직접 확인은 남았으면
    // 할 일(브랜드 잉크), 다 끝냈으면 통과다.
    var findingsN = st.findings || 0, unrevN = st.unreviewed || 0;
    var fTone = findingsN ? "var(--sev-maj-fg)" : "var(--band-good-fg)";
    var uTone = unrevN ? "var(--sev-info-fg)" : "var(--text-3)";
    var mTone = !manual.length ? "var(--text-3)"
      : done === manual.length ? "var(--band-good-fg)" : "var(--accent-ink)";
    // "이상 없음"은 단일 검토 결과 패널(issuesShell)과 같은 규칙·같은 칩인데,
    // 폴더 검토는 조건이 하나 더 있다: **못 본 것이 있으면 말하지 않는다.**
    // 미검토 수가 0이어도 안 올라온 산출물·미분류 파일이 있으면 그 대조 자체가
    // 안 돌았다 — 그때 초록 칩은 이 제품이 막으려는 "조용한 0건" 그 자체다.
    var cleanPill = findingsN === 0 && unrevN === 0 && !(st.missing || 0) && !(st.unclassified || 0)
      ? '<span style="font-size:12px;font-weight:600;color:var(--band-good-fg);background:var(--band-good-bg);padding:6px 12px;border-radius:var(--r-xl);white-space:nowrap;">이상 없음</span>'
      : "";
    var tabs = [["summary", "요약"], ["compare", "수정 사항 " + (st.findings || 0)],
                ["matrix", "필드 대조 " + (st.wideTotal || 0)], ["outputs", "추출된 값"],
                ["manual", "직접 확인 " + done + "/" + manual.length],
                ["other", "검토 제외 " + excluded], ["criteria", "검토 기준"]];
    // 앱 공용 .tab — 밑줄·글자 모두 --accent-ink 다. 여기만 --accent(채움색)로
    // 밑줄을 그으면 다른 화면 탭과 색이 갈린다.
    //
    // 탭은 카드의 고정 머리줄이다 — 스크롤은 탭 아래 내용만 한다(아래 return
    // 참고). 한때 sticky 로 붙였는데, 화면 상단에 걸리는 순간 카드 테두리에서
    // 떨어져 나온 흰 띠처럼 보였다(좌우 1px 테두리는 스크롤되는데 띠는 테두리
    // 없이 남는다). 구조로 고정하면 그런 이음새 자체가 없다.
    var tabBar = '<div style="display:flex;flex-wrap:wrap;gap:18px;border-bottom:1px solid var(--line);">' +
      tabs.map(function (t) {
        return '<span class="tab' + (tab === t[0] ? " on" : "") + '" data-act="setCaseTab" data-arg="' + t[0] + '" tabindex="0" role="button">' +
          esc(t[1]) + '</span>';
      }).join("") + '</div>';

    var panel = "";
    if (tab === "summary") {
      panel = caseFindingSummary(p) + caseMatrixSummary(p) +
        '<div style="font-size:14px;font-weight:600;margin-bottom:8px;">문서별 결과</div>' +
        '<div style="font-size:13px;color:var(--text-2);margin-bottom:10px;">' +
          '문서 행은 상태 요약입니다. 원문은 각 행의 ‘문서에서 보기’ 버튼으로 엽니다.</div>' +
        caseOutputTable(p);
    } else if (tab === "matrix") {
      panel = '<div style="font-size:13px;color:var(--text-2);margin-bottom:10px;">' +
        '항목 이름을 누르면 비교한 값과 판정 이유가 이 화면에서 펼쳐집니다. ' +
        '검토 기준은 상세 안의 ‘이 기준 보기’ 버튼으로 확인합니다.</div>' +
        caseMatrix(p, k.matrixFocus || "");
    } else if (tab === "outputs") {
      panel = caseFieldsPanel(p, k.selOutput);
    } else if (tab === "compare") {
      panel = '<div style="font-size:13px;color:var(--text-2);margin-bottom:10px;">' +
        '수정 사항과 검토 상태를 구분합니다. 미검토·과정 보고는 수정 사항 건수에 포함하지 않습니다.</div>';
      var groups = [
        ["수정 사항", (p.findings || []).filter(function (f) { return !f.unreviewed && f.sev !== "info"; })],
        ["미검토", (p.findings || []).filter(function (f) { return !!f.unreviewed; })],
        ["검토 과정 보고", (p.findings || []).filter(function (f) { return !f.unreviewed && f.sev === "info"; })]
      ];
      groups.forEach(function (group, index) {
        if (index && !group[1].length) return;
        panel += '<section style="margin-bottom:20px;"><h3 style="font-size:14px;font-weight:600;margin:0 0 8px;">' +
          group[0] + ' ' + group[1].length + '건</h3>' +
          (group[1].length ? caseFindingList({ findings: group[1] }) :
            '<p style="font-size:13px;color:var(--text-2);">수정 사항이 없습니다. 미검토 항목이 있다면 아래에서 확인하세요.</p>') + '</section>';
      });
    } else if (tab === "manual") {
      panel = caseManual(v, p);
    } else if (tab === "criteria") {
      panel = caseCriteria(v);
    } else {
      panel = caseOtherPanel(p);
    }
    if (k.error) {
      panel = '<div role="alert" style="margin-bottom:12px;padding:10px 12px;border-radius:var(--r-sm);' +
        'background:var(--sev-maj-bg);color:var(--sev-maj-fg);font-size:13px;">' +
        esc(k.error) + '</div>' + panel;
    }

    // 페이지 전체가 아니라 **탭 아래만** 스크롤한다 — 단일 검토의 결과 패널과
    // 같은 구조다(머리줄·탭 고정, 내용만 흐른다). 스크롤 위치 복원(data-scroll)
    // 은 실제로 스크롤하는 안쪽 칸이 진다.
    return '<div class="page-shell" style="display:flex;overflow:hidden;">' +
      '<div class="page-container page-stack" style="display:flex;flex-direction:column;min-height:0;">' +
      // 단일·비교 결과와 같은 백링크 줄 — 왼쪽 "목록으로", 오른쪽 "새 검토".
      // 기록에서 연 리포트가 여기만 돌아갈 길이 없어 사이드바로 빠져나가야 했고,
      // "새 점검"은 카드 안 버튼이라 다른 결과 화면과 자리부터 달랐다.
      '<div style="flex:none;display:flex;align-items:center;justify-content:space-between;">' +
        resultsBackLink() +
        '<div class="hover-accent" data-act="clearCaseFiles" tabindex="0" role="button" ' +
          'title="다른 폴더를 새로 올려 검토합니다" ' +
          'style="display:inline-flex;align-items:center;gap:6px;font-size:14px;font-weight:500;' +
          'color:var(--text-3);cursor:pointer;padding:8px;">' + ICON_DOC_PLUS + ' 새 폴더 검토</div>' +
      '</div>' +
      caseCard(
        // 제목 줄은 기록 화면의 행과 같은 관용구다 — 44px 아이콘 칩 + 제목 +
        // 부제. 팀 이름만 회색으로 떠 있으면 그게 무엇인지(검토 기준) 안 읽힌다.
        '<div style="display:flex;align-items:center;gap:14px;margin-bottom:16px;">' +
          '<div style="width:44px;height:44px;border-radius:50%;background:var(--accent-weak);color:var(--accent-ink);display:flex;align-items:center;justify-content:center;flex:none;font-size:20px;">' + ICONS.folder + '</div>' +
          '<div style="min-width:0;">' +
            '<h1 style="margin:0;font-size:22px;font-weight:700;letter-spacing:var(--tr-title);color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(p.caseId || "점검") + '</h1>' +
            (p.team ? '<div style="margin-top:4px;font-size:13px;color:var(--text-2);">' + esc(p.team) + ' 기준으로 검토했습니다</div>' : "") +
          '</div>' +
          '<div style="margin-left:auto;display:flex;align-items:center;gap:10px;">' +
            cleanPill +
            // "새 점검"은 위 백링크 줄의 "새 폴더 검토"로 올라갔다 — 단일 결과의
            // "새 문서 검토"와 같은 자리·같은 관용구다.
            '<button class="btn btn-ghost" data-act="caseCsv"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>CSV 내려받기</button>' +
          '</div>' +
        '</div>' +
        // 결과와 검토 범위를 가른다. 전에는 산출물·대조율·지적·미검토·합산값을
        // 같은 크기로 일곱 칸에 늘어놓아 무엇이 문제 수인지 알 수 없었다.
        // 면은 카드 위 옅은 바닥(--bg)이다 — 맨 테두리 상자만 있으면 표처럼
        // 딱딱하게 읽힌다(업로드 화면 오른쪽 "검사 단계" 패널과 같은 면).
        '<div style="display:flex;align-items:stretch;margin-top:12px;background:var(--bg);border:1px solid var(--line);border-radius:var(--r-md);">' +
          caseStat(findingsN, "전체 수정 사항", fTone) +
          caseStat(unrevN, "미검토", uTone) +
          caseStat(done + "/" + manual.length, "직접 확인", mTone) +
          '<div style="flex:none;align-self:stretch;width:1px;background:var(--line);margin:10px 0;"></div>' +
          '<div style="flex:1.5;display:flex;flex-direction:column;justify-content:center;padding:10px 16px;">' +
            '<div style="font-size:12px;font-weight:600;color:var(--text-3);margin-bottom:6px;">검토 범위</div>' +
            '<div style="display:flex;flex-wrap:wrap;gap:6px 14px;font-size:12px;color:var(--text-2);font-variant-numeric:tabular-nums;">' +
              '<span>산출물 인식 <b>' + (st.outputs || 0) + "/" + ((st.outputs || 0) + (st.missing || 0)) + '</b></span>' +
              '<span>전체 필드 대조 판정 <b>' + (st.wideChecked || 0) + "/" + (st.wideTotal || 0) + '</b></span>' +
              '<span>분류가 필요한 파일 <b>' + (st.unclassified || 0) + '</b></span>' +
              '<span>참고자료 제외 <b>' + (st.ignored || 0) + '</b></span>' +
            '</div>' +
          '</div>' +
        '</div>', "20px") +
      // 탭 카드만은 caseCard 를 안 쓴다 — 껍데기는 같은 값(패널면·선·모서리)
      // 이지만 안이 머리줄(고정)과 스크롤 칸으로 갈라져야 한다.
      '<div style="flex:1;min-height:0;display:flex;flex-direction:column;' +
        'background:var(--panel);border:1px solid var(--line);border-radius:var(--r-sm);">' +
        '<div style="flex:none;padding:20px 20px 0;">' + tabBar + '</div>' +
        '<div data-scroll="case-results" style="flex:1;overflow-y:auto;padding:16px 20px 20px;"><div data-motion="case-tab" style="' + contentAnim("case-tab", tab) + '">' + panel + '</div></div>' +
      '</div>' +
      '</div>' +
    '</div>';
  }

  // 검토 기준 — **판정에 쓰이는 그대로** 보여준다. 요약하면 실제로 도는 규칙과
  // 화면이 갈리고, 검토자가 "왜 이게 지적이지?"를 물었을 때 답이 안 된다.
  //
  // 필드로 묶는다. 산출물별로 늘어놓으면 같은 필드가 반복된다 — 실측: 48줄인데
  // 실제 필드는 20개고 의뢰번호 하나가 7번 나온다. 리포트에서 넘어오는 것도
  // "시험항목명 0/4" 라는 **필드**다.
  function caseCriteria(v) {
    var k = v.kase, c = k.criteria;
    if (!c) {
      // 셋을 구분한다 — 부르는 중 · 실패(사유와 다시 시도) · 아직 안 부름.
      // 하나로 뭉치면 검토자가 뭘 해야 할지 모른다.
      if (k.criteriaError) {
        return '<div style="font-size:14px;color:var(--sev-maj-fg);">' +
          esc(k.criteriaError) + '</div>' +
          '<button class="btn btn-ghost" data-act="loadCriteria" style="margin-top:10px;">다시 불러오기</button>';
      }
      return '<div style="font-size:13px;color:var(--text-2);">검토 기준을 불러오는 중…</div>';
    }
    var focus = k.criteriaFocus || "";
    var fieldFocus = focus.indexOf("F-") === 0 ? focus.slice(2) : "";
    var wideById = {};
    (c.caseWide || []).forEach(function (w) { wideById[w.id] = w; });
    var pairById = {};
    (c.pairs || []).forEach(function (pr) { pairById[pr.id] = pr; });

    function chip(text, tone) {
      return '<span class="mono" style="flex:none;font-size:12px;padding:2px 6px;border-radius:5px;' +
        'background:' + (tone || "var(--accent-weak)") + ';color:var(--text-2);">' + esc(text) + '</span>';
    }

    // 이 산출물에서 값을 어떻게 집는지. 이름만 보여주면 산출물 탭과 다를 게 없다.
    function how(w) {
      if (w.from === "table_rows") return "표에서 열 " + (w.columns || []).join(" · ") + " 을(를) 찾습니다";
      if (w.from === "checkbox_group") return "선택지 " + (w.options || []).join(" · ");
      if (w.from === "header" || w.from === "footer") return "머릿말/꼬리말 — 아직 못 읽습니다";
      return "라벨 " + (w.labels || []).map(function (l) { return '"' + l + '"'; }).join(" 또는 ") +
             " 의 " + (w.at === "below" ? "아래" : "오른쪽") + " 칸";
    }

    function rules(w) {
      var out = [];
      if (w.required) out.push(chip("필수"));
      if (w.pattern) out.push(chip("형식 " + w.pattern));
      if (w.format) out.push(chip(w.format === "date_range" ? "기간" : "날짜"));
      if (w.equals) out.push(chip("고정 " + w.equals));
      if (w.select === "one") out.push(chip("하나만"));
      (w.requiredColumns || []).forEach(function (col) { out.push(chip(col + " 필수")); });
      return out.join("");
    }

    var fields = (c.fields || []).map(function (f) {
      var wide = wideById[f.caseWide];
      var on = (f.caseWide && f.caseWide === focus) ||
        (fieldFocus && f.name === fieldFocus) ||
        ((f.pairs || []).indexOf(focus) >= 0);
      // 이 필드가 어느 대조에 쓰이나. "라벨은 이것"(추출)과 "N곳에서 같아야
      // 한다"(대조)가 한 자리에 있어야 왜 미검토인지 짚을 수 있다.
      var note = wide
        ? wide.outputs.length + "곳에서 같아야 합니다 — " + wide.outputs.join(" · ")
        : (f.pairs.length
            ? f.pairs.map(function (id) {
                var pr = pairById[id];
                return pr ? (pr.left + " ↔ " + pr.right + " (쌍 " + id + ")") : id;
              }).join(" · ")
            : "이 산출물 안에서만 봅니다");

      var body = f.where.length
        ? f.where.map(function (w) {
            return caseRow(
              '<span style="width:150px;flex:none;color:var(--text-2);">' + esc(w.output) + '</span>' +
              '<span style="flex:1;min-width:0;color:var(--text-2);">' + esc(how(w)) + '</span>' +
              '<span style="flex:none;display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end;">' +
                rules(w) + '</span>');
          }).join("")
        : caseRow('<span style="color:var(--text-2);">어느 산출물에서도 이 값을 뽑는 기준이 없습니다 — ' +
                  '그래서 늘 미검토로 남습니다</span>');

      return '<div' + (on ? ' data-criteria-focused="true"' : '') +
        ' style="margin-bottom:14px;' + (on ? "outline:2px solid var(--accent);outline-offset:4px;border-radius:var(--r-sm);" : "") + '">' +
        '<div style="display:flex;align-items:baseline;gap:8px;margin-bottom:6px;">' +
          '<span style="font-size:14px;font-weight:600;">' + esc(f.name) + '</span>' +
          '<span style="font-size:12px;color:var(--text-3);">' + esc(note) + '</span>' +
          '<span style="margin-left:auto;flex:none;font-size:12px;color:var(--text-3);">' +
            esc(f.where.length + "곳") + '</span>' +
        '</div>' +
        '<div style="border:1px solid var(--line);border-radius:var(--r-md);overflow:hidden;">' + body + '</div>' +
      '</div>';
    }).join("");

    // 산출물별로만 있는 기준 — 고정 문구와 서명란. 필드가 아니라 문서 단위다.
    var perOutput = (c.outputs || []).map(function (o) {
      var lines = "";
      if ((o.fixedText || []).length) {
        lines += caseRow('<span style="width:150px;flex:none;color:var(--text-2);">고정 문구</span>' +
          '<span style="flex:1;min-width:0;color:var(--text-2);">' +
          esc(o.fixedText.length + "개 — " + o.fixedText[0].slice(0, 44) + "…") + '</span>');
      }
      (o.signatures || []).forEach(function (s) {
        lines += caseRow('<span style="width:150px;flex:none;color:var(--text-2);">서명 ' + esc(s.role) + '</span>' +
          '<span style="flex:1;min-width:0;color:var(--text-2);">' +
          esc('"' + s.placeholder + '" 가 그대로면 미작성 (' + (s.at === "below" ? "아래" : "오른쪽") + ' 칸)') + '</span>');
      });
      if (!lines) return "";
      return '<div style="margin-bottom:14px;">' +
        '<div style="display:flex;align-items:baseline;gap:8px;margin-bottom:6px;">' +
          '<span style="font-size:14px;font-weight:600;">' + esc(o.key) + '</span>' +
          '<span class="mono" style="font-size:12px;color:var(--text-3);">' + esc(o.formNo) + '</span>' +
        '</div>' +
        '<div style="border:1px solid var(--line);border-radius:var(--r-md);overflow:hidden;">' + lines + '</div>' +
      '</div>';
    }).join("");

    var skips = (c.ignore || []).map(function (i) {
      return caseRow(
        '<span style="width:150px;flex:none;" class="mono">' + esc(i.pattern) + '</span>' +
        '<span style="flex:1;color:var(--text-2);">' + esc(i.reason) + '</span>');
    }).join("");

    function block(title, note, body) {
      if (!body) return "";
      return '<div style="margin-bottom:20px;">' +
        '<div style="font-size:14px;font-weight:600;margin-bottom:4px;">' + esc(title) + '</div>' +
        (note ? '<div style="font-size:13px;color:var(--text-2);margin-bottom:10px;">' + esc(note) + '</div>' : "") +
        body + '</div>';
    }

    return '<div style="font-size:13px;color:var(--text-2);margin-bottom:16px;">' +
        esc(c.team + " 검토 기준입니다. 지금 판정에 쓰이는 규칙 그대로입니다. " +
            "팀이 준 요구사항 " + c.itemCount + "항목 중 검사로 옮긴 부분입니다.") +
      '</div>' +
      block("값 " + (c.fields || []).length + "개 — 어디서 어떻게 뽑고, 어디끼리 맞추나", "", fields) +
      block("문서 단위 기준", "필드가 아니라 문서 전체에 걸리는 것입니다.", perOutput) +
      block("건너뛰는 파일", "이 규칙에 걸리는 파일은 검사하지 않습니다.",
            skips ? '<div style="border:1px solid var(--line);border-radius:var(--r-md);overflow:hidden;">' + skips + '</div>' : "");
  }

  // CSV — **전 항목을 내보낸다.** 판정한 것만 내보내면 받아 본 사람은 그게 전부라고
  // 읽는다(preset/export.py 와 같은 원칙). 판정 못 한 것은 "미판정"으로 남긴다.
  function caseCsvText(p) {
    function cell(x) {
      var s = String(x == null ? "" : x);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }
    var rows = [["번호", "분류", "항목", "판정", "이유", "문서", "위치", "값"]];
    (p.outputs || []).forEach(function (o) {
      var stale = o.formNo && o.formNo.stale;
      rows.push([o.key, "산출물 인식", "양식번호가 최신 개정본인가",
                 o.formNo && o.formNo.found ? (stale ? "불일치" : "일치") : "미판정",
                 stale ? o.formNo.found + " ≠ " + o.formNo.expected
                       : (o.formNo && o.formNo.found ? "" : "파일명에 양식번호가 없습니다"),
                 o.file, ""]);
      rows.push([o.key, "산출물 검사", "단일 문서 검사", "미판정", o.reason || "", o.file, ""]);
    });
    (p.missing || []).forEach(function (key) {
      rows.push([key, "산출물 인식", "산출물이 제출되었는가", "불일치",
                 "올라오지 않았습니다", "", ""]);
    });
    (p.matrix || []).forEach(function (m) {
      (m.cells || []).forEach(function (c) {
        rows.push([m.id, "전 산출물 대조", m.field,
                   m.status === "미검토" ? "미판정" : m.status,
                   c.present
                     ? (c.configured === false ? "필드 추출 규칙이 없습니다"
                        : (c.found ? "" : "값을 찾지 못했습니다"))
                     : "올라오지 않았습니다",
                   c.output, c.at || "", c.found ? c.value : ""]);
      });
    });
    (p.manualResults || []).forEach(function (r) {
      var unresolved = ["확인 전", "입력 없음", "입력값 오류", "미검토"]
        .indexOf(r.status) >= 0;
      rows.push([r.id, "외부 기준값 대조", r.field,
                 unresolved ? "미판정" : r.status,
                 "대조 원천: " + (r.against || ""),
                 (r.cells || []).map(function (c) { return c.output; }).join(" · "),
                 (r.cells || []).map(function (c) { return c.at || ""; }).join(" / "),
                 r.input || ""]);
    });
    (p.findings || []).forEach(function (f) {
      // 전 산출물 대조는 위 매트릭스가 칸마다 이미 냈다. 여기서는 **왜 어긋났는지**
      // 한 줄만 더한다 — 판정을 두 번 세면 합계가 부풀어 오른다.
      var at = (f.evidence || []).map(function (e) { return e.at; }).join(" / ");
      var kind = f.kind === "case_wide" ? "전 산출물 대조 — 사유"
        : f.kind === "output" ? "칸 값 검사"
        : f.kind === "manual_input" ? "외부 기준값 대조"
        : "산출물 간 대조";
      rows.push([f.ruleId, kind, f.ruleId,
                 f.unreviewed ? "미판정" : "불일치", f.message, f.document || "", at, ""]);
    });
    (p.unclassified || []).forEach(function (x) {
      rows.push(["", "미분류", "산출물 판별", "미판정",
                 "양식번호가 없어 판별하지 못했습니다", x.file, ""]);
    });
    (p.ignored || []).forEach(function (x) {
      rows.push(["", "건너뜀", "검사 대상 여부", "해당없음", x.reason || "", x.file, ""]);
    });
    return rows.map(function (r) { return r.map(cell).join(","); }).join("\n");
  }

  // 서버가 내는 단계는 넷이다 (src/app/case.py) — classify 한 번, 그다음
  // output·case_wide·pair 가 항목마다 반복된다. 반복이라 dict 에는 넷만 남고
  // detail 만 계속 바뀐다. 그래서 "지금 무엇을 보고 있나"가 detail 이고,
  // 단계 자체는 처음부터 넷으로 고정이다 — 단일 검토와 같은 타임라인이 된다.
  var CASE_STAGES = [
    { key: "classify",  label: "산출물 판별", desc: "양식번호로 무엇이 무엇인지 가려냅니다" },
    { key: "output",    label: "낱장 검사",   desc: "산출물마다 칸 값을 뽑아 규칙에 겁니다" },
    { key: "case_wide", label: "전 산출물 대조", desc: "여러 문서에 걸친 값이 서로 같은지 봅니다" },
    { key: "pair",      label: "문서 쌍 대조", desc: "짝지어진 두 문서를 맞대 봅니다" }
  ];

  function caseProgressMeta(k) {
    var last = -1;
    CASE_STAGES.forEach(function (s, i) { if (k.stage[s.key] != null) last = i; });
    return { last: last, pct: Math.round((last + 1) / CASE_STAGES.length * 100),
             reached: Math.max(0, last + 1), total: CASE_STAGES.length };
  }

  // 진행 화면에서 단계마다 갈아끼우는 조각. api.js 의 repaintCaseStages 가
  // 같은 함수를 불러 전체 render 없이 이 안쪽만 바꾼다 — 그래야 취소 버튼이
  // 재생성되지 않아 hover 가 유지된다(단일 검토가 쓰는 방식과 같다).
  // 지난 렌더의 도달 단계. evalPipeline 의 prevEvalRun 과 같은 이유로 runKey 를
  // 같이 들고 있는다 — 끝난 폴더 검토를 다시 열면 첫 렌더에 완료 단계가 한꺼번에
  // 들어오는데, 거기에 연출이 붙으면 "방금 끝났다"는 거짓말이 된다.
  var prevCaseLast = -1, prevCaseRun = null;
  function caseStageList(k) {
    // 도달한 마지막 단계가 '진행 중', 그 앞은 '완료'. 서버가 총량을 안 주므로
    // 지어내지 않는다 — 남은 단계는 '대기'로 흐리게 둔다.
    var last = caseProgressMeta(k).last;
    var activeIndex = Math.max(0, last);
    var seen = k.startedAt != null && k.startedAt === prevCaseRun;
    // 방금 완료로 넘어간 단계 (없으면 -1) — mkTimeline 의 doneStage 와 같은 뜻.
    var justDone = seen && last !== prevCaseLast ? last - 1 : -1;
    prevCaseLast = last; prevCaseRun = k.startedAt;
    return CASE_STAGES.map(function (s, i) {
      var done = i < last, active = i === activeIndex;
      return timelineItem({
        label: s.label, desc: s.desc,
        detail: k.stage[s.key] || "",
        done: done, active: active,
        justDone: done && i === justDone,
        justOpened: active && justDone >= 0,
        statusLabel: done ? "완료" : (active ? "진행 중" : "대기")
      });
    }).join("");
  }

  // 폴더 검토 진행 화면의 오른쪽 설정 패널 — 단일 검토(criteriaPanel)와 같은
  // 관용구·같은 자리다. 이게 없으면 두 진행 화면이 다른 앱처럼 읽혔다. 값은
  // 브라우저가 이미 아는 것만 적는다(팀·올린 문서·인식 결과) — 지어내지 않는다.
  function caseSettingsPanel(k) {
    var r = k.recog || null;
    var sent = (k.files || []).filter(function (f) { return !k.exclude[f.name]; }).length;
    var line = function (label, n) {
      return '<div style="display:flex;justify-content:space-between;gap:8px;padding:4px 0;font-size:12px;">' +
        '<span style="color:var(--text-3);">' + esc(label) + '</span>' +
        '<span class="mono" style="color:var(--text-2);">' + esc(n) + '</span></div>';
    };
    var team = teamLabel(k.team || (state.user && state.user.team) || "");
    return '<aside class="progress-settings">' +
      '<h3 class="progress-settings-title">이번 검토 설정</h3>' +
      '<p class="progress-settings-sub">시작할 때 확정된 읽기 전용 설정입니다.</p>' +
      '<div style="padding:10px 0;border-top:1px solid var(--line-2);">' +
        '<div style="font-size:12px;font-weight:600;color:var(--text-2);margin-bottom:6px;">적용 기준</div>' +
        (team
          ? '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;">' +
              '<span style="font-size:12px;font-weight:700;padding:4px 6px;border-radius:var(--r-xl);' +
                'background:var(--accent-weak);color:var(--accent-ink);">팀</span>' +
              '<span style="min-width:0;font-size:12px;color:var(--text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(team) + '</span>' +
            '</div>'
          : '<div style="font-size:14px;color:var(--sev-crit-fg);padding:6px 0;">팀 기준이 비어 있습니다</div>') +
      '</div>' +
      '<div style="padding:10px 0;border-top:1px solid var(--line-2);">' +
        '<div style="font-size:12px;font-weight:600;color:var(--text-2);margin-bottom:6px;">검토 대상</div>' +
        line("올린 문서", sent + "개") +
        (r ? line("산출물 인식", r.recognized.length + "/" + r.outputKeys.length + "종") : "") +
        (r && r.missing.length ? line("안 올라온 산출물", r.missing.length + "종") : "") +
      '</div>' +
      '<div style="padding:10px 0;border-top:1px solid var(--line-2);">' +
        '<div style="font-size:12px;font-weight:600;color:var(--text-2);margin-bottom:6px;">검사 방식</div>' +
        '<div style="font-size:12px;color:var(--text-2);line-height:1.6;">규칙 자동 검사 · AI 호출 없음</div>' +
      '</div>' +
    '</aside>';
  }

  function caseProgress(v) {
    var k = v.kase;
    var meta = caseProgressMeta(k);
    var err = k.error
      ? '<div style="margin-top:14px;padding:12px 14px;background:var(--sev-crit-bg);border:1px solid var(--sev-crit-bd);border-radius:var(--r-sm);color:var(--sev-crit-fg);font-size:14px;">' + esc(k.error) + '</div>'
      : "";
    var elapsed = k.startedAt ? fmtElapsed(Date.now() - k.startedAt) + " 경과" : "시작하는 중";
    return progressFrame({
      scroll: "case-progress",
      head: progressHead(false, 0,
        ["폴더를 검토하고 있습니다", "낱장을 먼저 보고, 그다음 문서끼리 맞춰봅니다"],
        null, 0, { pctId: "kase-pct", docName: (k.caseId || "폴더 검토") + " · " +
          (k.files || []).filter(function (f) { return !(k.exclude || {})[f.name]; }).length + "개 문서",
          elapsed: elapsed, elapsedId: "kase-elapsed", cancelAction: "cancelCase" }),
      main: '<div id="kase-stages" class="progress-stage-list">' + caseStageList(k) +
        '</div>' + err +
        '<div class="progress-footer"><span id="kase-stage-count">' + meta.total +
          '단계 중 ' + meta.reached + '단계 도달</span></div>',
      settings: caseSettingsPanel(k)
    });
  }

  function body(v) {
    var inner = "";
    if (v.isHome) inner = appHomeView(v);
    else if (v.sUpload) inner = singleUpload(v);
    else if (v.sProgress) inner = singleProgress(v);
    else if (v.sResults) inner = singleResults(v);
    else if (v.kUpload) inner = caseUpload(v);
    else if (v.kRecognize) inner = caseRecognize(v);
    else if (v.kProgress) inner = caseProgress(v);
    else if (v.kResults) inner = caseReport(v);
    else if (v.cSetup) inner = compareSetup(v);
    else if (v.cProgress) inner = compareProgress(v);
    else if (v.cResults) inner = compareResults(v);
    else if (v.eSetup) inner = evaluateSetup(v);
    else if (v.eProgress) inner = evaluateProgress(v);
    else if (v.eResults) inner = evaluateResults(v);
    else if (v.isChecklists) inner = checklistsView(v);
    else if (v.isChecklistRun) inner = checklistRunScreen(v);
    else if (v.isHistory) inner = historyView(v);
    else if (v.isSettings) inner = settingsView(v);
    // 화면이 바뀌면 **어느 화면이든 같은 방식으로** 들어온다. 화면마다 따로
    // 붙이면 어떤 화면은 연출이 있고 어떤 화면은 없는 채로 갈린다 — 실제로
    // 홈과 검토 진행 화면만 있고 나머지는 툭 바뀌던 상태였다. 한 자리에서 씌운다.
    //
    // 음수 지연은 enterAnim 과 같은 이유다: 진입 창(250ms) 안에 다시 그려져도
    // 처음부터 되감기지 않고 이미 흐른 만큼 건너뛴 자리에서 이어 붙는다.
    // 홈도 카드별 순차 등장 없이 이 전환 하나만 적용한다.
    //
    // 관용구는 screenIn 이다. 팝오버가 쓰는 fadeIn 과 딱 하나가 다르다 —
    // **투명도 0 이 아니라 .85 에서 시작한다.** 화면 전환은 없던 것이 생기는
    // 게 아니라 있던 것이 바뀌는 일이라, 0 에서 시작하면 한 프레임이 통째로
    // 비어 깜빡인다(index.html @keyframes screenIn 주석).
    //
    // 한때 원근을 넣어 판이 세워지듯 꺾어 봤는데, 타일 한 장이면 몰라도
    // 화면 전체가 그러면 이동할 때마다 큰 사건이 된다. 매번 보는
    // 화면에서 연출은 **있다는 것만 알면 되지 쳐다보게 만들면 안 된다.**
    var enter = v.anim.entered
      ? 'animation:screenIn var(--dur-page) var(--ease-out) backwards;animation-delay:-' + v.anim.enterElapsed + 'ms;'
      : '';
    // 기록 하나를 여는 데 실패한 것(openHistory). 어느 화면에서든 부를 수 있어
    // (기록·홈·검색·알림) 한 자리에서 띄운다 — 안 띄우면 "눌렀는데 아무 일도
    // 없다"로 남는다. 화면을 옮기면 지운다(setMode).
    var herr = state.herror
      ? '<div style="margin:16px 32px 0;padding:12px 16px;background:var(--sev-crit-bg);border:1px solid var(--sev-crit-bd);border-radius:var(--r-sm);color:var(--sev-crit-fg);font-size:14px;">' + esc(state.herror) + '</div>'
      : '';
    return '<div id="main-scroll" data-scroll="main" style="flex:1;min-height:0;overflow:auto;' + enter + '">' + herr + inner + '</div>';
  }

  // 도움말 문서. 가운데 모달(helpSheetHtml)에 들어가는 글 — 문서 모양이다: 한 열, 제목·본문·그림뿐,
  // 카드 그리드 없음(템플릿처럼 보였다, 2026-09-16). 로그인 없이 보는 /intro 페이지도 있었는데
  // 모달이 생기며 뺐다 — 같은 글의 껍데기 둘은 유지비뿐. 링크용 페이지가 필요해지면 이 글에
  // 껍데기만 다시 씌운다.
  // 결과 예시는 실제 캡처가 아니라 가짜 내용을 넣은 진짜 부품이다 — 사내 문서 내용이 담긴
  // 캡처는 저장소에도 링크에도 실을 수 없다(CLAUDE.md 금지).
  function introDoc() {
    // 절마다 머리(아이콘 원 + 제목 + 한 줄 요약)와 굵은 구분선을 둔다(2026-09-18) — 제목 글자만
    // 굵던 때는 절이 어디서 갈리는지 안 보였다. 절 안의 부품은 내용의 성격을 따른다:
    // 검토 넷 = 2×2 카드, 절차 = 번호 줄, 결과 = 진짜 부품 그림, 연결 = 상자 넷, 원칙 = 셋 나란히, 시작 = 회색 표.
    var sec = function (id, ico, title, sub, body) {
      return '<section class="idoc-sec" id="help-' + id + '">' +
        '<div class="idoc-sec-head"><span class="idoc-sec-ico">' + ico + '</span>' +
          '<div><h2>' + esc(title) + '</h2>' + (sub ? '<span>' + esc(sub) + '</span>' : '') + '</div></div>' +
        body + '</section>';
    };
    var tocItems = [["reviews", "네 가지 검토"], ["how", "이렇게 일합니다"], ["result", "결과 화면"],
                    ["dosuree", "DoSuree"], ["not", "하지 않는 것"], ["start", "시작하기"]];
    var toc = '<nav class="idoc-toc" aria-label="도움말 차례">' + tocItems.map(function (t) {
      return '<button type="button" data-act="helpJump" data-arg="help-' + t[0] + '">' + esc(t[1]) + '</button>';
    }).join("") + '</nav>';
    var card = function (ico, title, desc) {
      return '<div class="idoc-card"><span class="idoc-ico">' + ico + '</span><div><b>' + esc(title) + '</b><span>' + esc(desc) + '</span></div></div>';
    };
    var mockDoc = '<div class="idoc-figure-label">문서 (원문 뷰어)</div><div class="intro-paper">' +
        '<div class="intro-paper-head">입력 신호 정의 <small>12쪽</small></div>' +
        '<p>입력 신호 TEMP_VALUE는 온도 센서에서 받는다.</p>' +
        '<p><span class="intro-paper-no">3</span><mark class="sev-minor">입력 신호 TEMP_VALUE의 설정 범위는 0~100이다.</mark></p>' +
        '<p>측정 주기는 1초로 한다.</p>' +
      '</div>';
    var mockCard = '<div class="idoc-figure-label">지적 카드 (오른쪽 목록)</div><div class="fcard intro-mock-card">' +
        '<div class="finding-card-head"><span class="finding-card-tags">' +
          '<span class="nchips"><span class="nchip">3</span></span>' +
          '<span class="pill pill-cat cat-expr" title="표현 검사">표현</span><span class="finding-kind">모순</span></span>' +
          '<span class="finding-card-aside"><span>12쪽</span></span></div>' +
        '<div class="fmsg">같은 신호의 설정 범위가 두 곳에서 다르게 적혀 있습니다.</div>' +
        '<div class="intro-mock-quote"><mark class="sev-minor">입력 신호 TEMP_VALUE의 설정 범위는 0~100이다.</mark></div>' +
      '</div>';
    var steps = [
      ["PDF · Word · HWP 를 그대로 올립니다", "글자가 있는 문서는 바로 읽고, 스캔본과 그림 속 글자는 비전 모델로 읽어 시간이 더 걸립니다."],
      ["공통 + 소속 팀 기준으로 검사합니다", "로그인한 팀의 기준이 자동으로 걸리고, 추가 기준은 시작할 때 고릅니다. 검토 기준 화면에서 기준 전문을 볼 수 있습니다."],
      ["문서 그 자리에 형광펜이 칠해집니다", "오른쪽에 지적 카드가 서고, 카드와 형광펜이 같은 번호를 답니다. 형광펜은 근거 인용이 문서에서 실제로 찾아진 자리입니다."],
      ["판정은 검토자가 합니다", "지적 아님으로 제외하거나, 비교 검토의 요건을 만족함·수정필요로 정하거나, 같은 문서를 다시 검토했을 때 반영 여부를 확인합니다."]
    ].map(function (st, i) {
      return '<div class="idoc-step"><span class="idoc-step-n">' + (i + 1) + '</span><div><b>' + esc(st[0]) + '</b><span>' + esc(st[1]) + '</span></div></div>';
    }).join("");
    return '<div class="idoc">' +
      // 머리 한 줄: 마스코트 + 한 문장. "무엇을 하는 도구인가" 절 제목 대신 — 첫인상이 서야 한다(2026-09-16).
      '<div class="idoc-lead"><img src="public/mascot-investigator-192.png?v=20260820" alt="">' +
        '<div><b>문서를 올리면 팀 기준으로 검사하고,<br>고칠 곳을 문서 그 자리에 표시합니다.</b>' +
        '<span>요구사항·설계·시험 문서를 검토하는 사내 도구. 규칙 검사와 사내 AI 를 함께 쓰고, 모든 지적은 원문 인용으로 근거를 댑니다. ' +
        '문서는 사내망 밖으로 나가지 않습니다.</span></div></div>' +
      toc +
      sec("reviews", ICONS.list, "네 가지 검토", "문서를 몇 개, 무엇에 대고 보느냐로 갈립니다",
        '<div class="idoc-grid">' +
        card(ICONS.single, "단일 검토", "문서 하나를 공통·팀 기준으로 검토합니다. 형식·표현·추적 검사와 기준 항목별 판정.") +
        card(ICONS.compare, "비교 검토", "요구사항과 설계서처럼 위아래로 이어지는 두 문서를 맞대어 요건의 누락과 어긋남을 찾습니다.") +
        card(ICONS.folder, "폴더 검토", "한 의뢰의 산출물 폴더를 통째로 올려 문서 안의 값과 문서 사이의 일관성을 확인합니다.") +
        card(ICONS.checklist, "체크리스트 검토", "문서와 과제 평가 체크리스트(xlsx)를 올리면 항목마다 문서에서 근거를 찾아 평가표 초안을 씁니다.") +
        '</div>') +
      sec("how", ICONS.refresh, "이렇게 일합니다", "올리고, 검사하고, 표시하고, 판정합니다",
        '<div class="idoc-steps">' + steps + '</div>') +
      sec("result", ICONS.marker, "결과는 이렇게 보입니다", "형광펜의 번호와 지적 카드의 번호가 같은 지적입니다",
        '<div class="idoc-figure">' + mockDoc + mockCard + '</div>' +
        '<p>실제 화면에서는 왼쪽이 문서, 오른쪽이 지적 목록입니다. 지적은 무엇이 잘못됐는지 한 문장이고, 어느 검사에서 나왔는지는 분류 알약(형식·표현·추적·과정)이 말합니다. ' +
          '근거는 원문에서 글자 그대로 인용한 문장이며 문서 위 같은 자리에 형광펜이 칠해집니다. ' +
          '검사하지 못한 항목은 "검토 상태" 탭에 따로 적습니다. 지적 0건은 "문제 없음"이 아닙니다.</p>') +
      sec("dosuree", ICONS.chat, "DoSuree 에게 물어보기", "검토 결과와 문서를 읽고 답하는 어시스턴트. 읽기만 합니다",
        // 연결 그림 — 검토는 DocSuree 가 하고 기록에 남기며, DoSuree 는 그 기록과 본문을 **읽기만**
        // 해서 답한다. 판정은 사람. (개발자용 구조도는 docs/dosuree-connection.md)
        '<div class="idoc-flow" role="img" aria-label="문서를 DocSuree 가 검토해 기록에 남기고, DoSuree 는 그 기록과 본문을 읽어 답하며, 판정은 검토자가 합니다">' +
          '<div class="idoc-flow-box"><b>문서</b><span>올린 파일</span></div>' +
          '<div class="idoc-flow-box is-doc"><b>DocSuree</b><span>기준으로 검토 · 지적과 본문을 기록에 저장</span></div>' +
          '<div class="idoc-flow-box is-dsr"><b>DoSuree</b><span>그 기록과 본문을 <em>읽기만</em> 해서 답함</span></div>' +
          '<div class="idoc-flow-box"><b>검토자</b><span>판정은 여기서만 바뀜</span></div>' +
        '</div>' +
        '<p>결과 화면 오른쪽 아래 마스코트를 누르면 지금 보는 검토를 안고 대화가 열립니다. 홈의 "무엇이든 물어보세요"에서는 문맥 없이 시작합니다. ' +
          'DoSuree 는 그 검토의 지적·근거·문서 본문과 지난 검토 기록을 읽어 답합니다. ' +
          '"이 지적이 왜 나왔는지 원문 보여 줘", "누락 요건 중 인터페이스 관련만 추려 줘", "지난 검토들에도 같은 지적이 있었어?" 같은 질문에 씁니다. ' +
          '체크리스트 검토에서는 근거를 못 찾은 항목을 다른 말로 다시 찾게 할 수 있습니다.</p>' +
        '<p>DoSuree 는 읽기만 합니다. 지적을 만들거나 판정을 바꾸거나 기록에 쓰지 않습니다. 문서를 인용할 때는 도구로 읽은 문장을 그대로 씁니다.</p>') +
      sec("not", ICONS.x, "하지 않는 것", "일부러 안 하는 셋",
        '<div class="idoc-grid idoc-grid-3">' +
          '<div class="idoc-card is-not"><div><b>점수를 매기지 않습니다</b><span>100점 만점 같은 단일 숫자는 근거가 없습니다. 심각도별 건수만 말합니다.</span></div></div>' +
          '<div class="idoc-card is-not"><div><b>근거 없는 지적을 내지 않습니다</b><span>인용이 원문에 글자 그대로 없으면 그 지적은 버리고, 버린 건수를 드러냅니다.</span></div></div>' +
          '<div class="idoc-card is-not"><div><b>판정을 대신하지 않습니다</b><span>반영됐는지, 만족하는지는 검토자가 누릅니다. 도구는 근거를 놓아 줄 뿐입니다.</span></div></div>' +
        '</div>') +
      sec("start", ICONS.user, "시작하기", "",
        '<dl class="idoc-dl">' +
          '<dt>계정</dt><dd>로그인 화면의 회원가입에서 소속 팀을 골라 만듭니다. 팀이 곧 검사 기준입니다.</dd>' +
          '<dt>지원 형식</dt><dd>PDF · Word(docx) · HWP · HWPX · 텍스트(md, txt). 체크리스트는 xlsx.</dd>' +
          '<dt>기록</dt><dd>검토 결과는 같은 팀이 함께 봅니다. 올린 원본은 30일 뒤 지워지고, 그 뒤엔 텍스트 재현본으로 열립니다.</dd>' +
          '<dt>내보내기</dt><dd>단일 검토 결과, 비교 검토의 추적성 매트릭스, 체크리스트 검토의 평가표 초안을 엑셀로 받습니다. 파일명에 검토한 날짜가 붙습니다.</dd>' +
          '<dt>문의</dt><dd>담당 이용호</dd>' +
        '</dl>') +
    '</div>';
  }
  // "도움말" — 가운데 문서 모달. 하던 화면은 뒤에 흐리게 남는다.
  function helpSheetHtml() {
    if (!state.helpOpen) return '';
    var closing = state.helpClosing ? ' is-closing' : '';
    return '<div class="help-backdrop' + closing + '" data-act="closeHelp"></div>' +
      '<aside class="help-sheet' + closing + '" role="dialog" aria-label="도움말">' +
        '<div class="help-sheet-head"><b>도움말</b>' +
          '<button type="button" class="result-icon-btn" data-act="closeHelp" aria-label="닫기">' + ICONS.x + '</button></div>' +
        '<div class="help-sheet-body">' + introDoc() + '</div>' +
      '</aside>';
  }

  function loginView() {
    var lastEmail = localStorage.getItem("dr_last_email") || "";
    var inputStyle = "width:100%;padding:14px 16px;border:1px solid var(--line);border-radius:var(--r-md);font-size:15px;color:var(--text);background:var(--bg);transition:border-color .2s var(--ease-out),background .2s var(--ease-out),color .2s var(--ease-out),box-shadow .2s var(--ease-out),opacity .2s var(--ease-out),transform .2s var(--ease-out);box-sizing:border-box;";
    var labelStyle = "display:block;font-size:14px;font-weight:500;color:var(--text-2);margin-bottom:8px;";
    
    return '<div class="auth-canvas" style="width:100vw;height:100vh;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;position:relative;overflow:hidden;">' +
      authBlobs() +
      '<div style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:0;opacity:0.04;mix-blend-mode:overlay;background-image:url(\'data:image/svg+xml,%3Csvg viewBox=%220 0 200 200%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Cfilter id=%22noiseFilter%22%3E%3CfeTurbulence type=%22fractalNoise%22 baseFrequency=%220.8%22 numOctaves=%223%22 stitchTiles=%22stitch%22/%3E%3C/filter%3E%3Crect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23noiseFilter)%22/%3E%3C/svg%3E\');"></div>' +
      // 유리(--panel-glass + blur)를 걷고 솔리드 패널로 — 앱의 마지막 반투명
      // 면이었다(2026-09-01 지적: 솔리드·반투명 혼용이 통일감을 깬다.
      // Graphio 레퍼런스는 전면 솔리드다).
      '<div class="login-modal" style="position:relative;z-index:1;display:flex;width:100%;max-width:1320px;min-height:790px;background:var(--panel);border-radius:calc(var(--r-xl) + 4px);overflow:hidden;box-shadow:' + AUTH_SHADOW + ';animation:fadeUp var(--dur-3) var(--ease-out) forwards;">' +
        // 면 색(방사형 그라데이션 3겹)은 인라인이 아니라 index.html 의 .login-brand 가
        // 쥔다 — 다크에서 알파만 갈아 끼워야 하는데 인라인 style 은 테마를 못 탄다.
        '<div class="login-brand" style="flex:1;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;padding:56px 48px;color:white;position:relative;overflow:hidden;">' +
          brandBackdrop() +
          // 그래인은 배경 도형 **위에** 와야 한 면으로 읽힌다 — 도형보다 먼저 그리면
          // 렌즈·문서만 매끈하게 남아 따로 얹은 판처럼 보인다.
          '<div style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:0;opacity:0.05;mix-blend-mode:overlay;background-image:url(\'data:image/svg+xml,%3Csvg viewBox=%220 0 200 200%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Cfilter id=%22noiseFilter%22%3E%3CfeTurbulence type=%22fractalNoise%22 baseFrequency=%220.8%22 numOctaves=%223%22 stitchTiles=%22stitch%22/%3E%3C/filter%3E%3Crect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23noiseFilter)%22/%3E%3C/svg%3E\');"></div>' +
          '<div class="hero-stage" data-hero-scene>' +
            '<span class="hero-doc hero-doc-left" aria-hidden="true"></span>' +
            '<span class="hero-doc hero-doc-right" aria-hidden="true"></span>' +
            // ?v= 는 index.html 의 favicon·스크립트가 이미 쓰는 규칙인데 여기만
            // 빠져 있었다. 파일명을 그대로 두고 그림만 갈면 브라우저는 옛 그림을
            // 계속 쓴다 — 실제로 돋보기 색을 바꾸고도 화면이 안 바뀌어 한참 헤맸다.
            // 마스코트를 갈 때마다 이 값도 같이 바꿀 것.
            '<img class="hero-mascot" src="public/login_hero.png?v=20260813-hero-2d" alt="DocSuree 문서 검토 마스코트">' +
          '</div>' +
          '<h1 class="brand-wordmark" style="margin:0 0 18px 0;line-height:1;">Doc<span style="color:var(--brand-accent);">Suree</span></h1>' +
          // 줄바꿈은 "퇴근을 앞당기는 / 가장 확실한 문서 검토" 로 끊는다. 예전엔
          // 관형어(가장 확실한)만 첫 줄 끝에 남고 꾸밈받는 말(문서 검토)이 다음
          // 줄로 넘어가, 한 덩어리인 말이 문법이 아닌 자리에서 갈라졌다.
          '<p style="font-size:18px;line-height:1.6;color:rgba(255,255,255,0.95);margin:0;font-weight:700;letter-spacing:var(--tr-title);">퇴근을 앞당기는<br>가장 확실한 문서 검토</p>' +
        '</div>' +
        '<div class="login-form" style="flex:1;display:flex;flex-direction:column;justify-content:center;background:var(--panel);padding:56px 52px;">' +
        '<div style="width:100%;max-width:400px;margin:0 auto;opacity:0;animation:fadeUp var(--dur-3) var(--ease-out) .1s forwards;">' +
          '<h2 class="headline login-form-title" style="margin:0 0 8px 0;">환영합니다</h2>' +
          '<p style="font-size:15px;color:var(--text-3);margin:0 0 36px 0;">사내 계정으로 로그인하여 시작하세요.</p>' +
          // 회원가입·비밀번호 찾기를 마치고 돌아온 안내. 한 번 보여주고 지운다(setMode).
          (state.authNotice
            ? '<div class="auth-notice" style="margin:-16px 0 20px;">' + ICONS.check + '<span>' + esc(state.authNotice) + '</span></div>'
            : '') +
          // 로그인 실패 배너 자리. app.js authError 가 글만 채운다 — render() 를
          // 부르면 입력이 날아가는 화면이라 자리를 미리 두는 방식이다.
          '<div id="authError" class="auth-error" hidden style="margin:-16px 0 20px;">' + ICONS.alert + '<span id="authErrorText"></span></div>' +
          // 제출은 **막기만** 한다 — 버튼이 type="submit" 이라 Enter 는 브라우저가
          // 알아서 그 버튼을 클릭해 주고(암묵적 제출), 그 클릭은 data-act
          // 델리게이션이 받는다. 여기서 다시 .click() 을 부르면 마우스로 누를 때
          // 두 번 돈다 — 서버 로그인이 된 뒤 그 두 번째 완료가 2초 뒤 사람을
          // 홈으로 끌어갔다.
          '<form action="javascript:void(0);" onsubmit="return false;">' +
          '<div style="margin-bottom:24px;">' +
            '<label style="' + labelStyle + '">이메일 주소</label>' +
            '<input id="loginEmail" name="email" type="email" autocomplete="username" value="' + lastEmail + '" placeholder="name@company.com" style="' + inputStyle + '" onfocus="this.style.borderColor=\'var(--accent)\';this.style.background=\'var(--panel)\'" onblur="this.style.borderColor=\'var(--line)\';this.style.background=\'var(--bg)\'">' +
          '</div>' +
          '<div style="margin-bottom:32px;">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
              '<label style="display:block;font-size:14px;font-weight:500;color:var(--text-2);margin:0;">비밀번호</label>' +
              '<span class="link-accent" style="font-size:13px;" data-act="setMode" data-arg="forgot">비밀번호 찾기</span>' +
            '</div>' +
            '<input id="loginPwd" name="password" type="password" autocomplete="current-password" placeholder="••••••••" style="' + inputStyle + '" onfocus="this.style.borderColor=\'var(--accent)\';this.style.background=\'var(--panel)\'" onblur="this.style.borderColor=\'var(--line)\';this.style.background=\'var(--bg)\'">' +
          '</div>' +
          '<div style="display:flex;align-items:center;margin-bottom:24px;">' +
            '<input type="checkbox" id="rememberId" ' + (lastEmail ? 'checked' : '') + ' style="margin-right:8px;width:16px;height:16px;cursor:pointer;accent-color:var(--accent-ink);">' +
            // 이름이 하는 일과 같아야 한다. 예전엔 "이메일 아이디 저장" 이라
            // 적혀 있었는데 실제로는 꺼도 30일 로그인이 유지됐다 — 공용 PC 에서
            // 쓰는 사람에게는 거짓말이다. 이제 이 칸이 세션 수명을 진다
            // (켜면 30일 · 끄면 브라우저를 닫을 때까지).
            '<label for="rememberId" style="font-size:14px;color:var(--text-2);cursor:pointer;user-select:none;">로그인 상태 유지</label>' +
          '</div>' +
          '<button type="submit" id="loginBtn" class="btn btn-primary" data-act="doLogin" style="width:100%;padding:14px;border-radius:var(--r-md);font-size:15px;margin-bottom:16px;">로그인</button>' +
          '</form>' +
          '<div style="text-align:center;font-size:14px;color:var(--text-3);">' +
            '계정이 없으신가요? <span class="link-accent" style="font-weight:700;" data-act="setMode" data-arg="signup">회원가입</span>' +
          '</div>' +

        '</div>' +
      '</div>' +
      '</div>' +
    '</div>';
  }


  // 로그인 계열 모달의 그림자. 예전엔 사진 배경 위에 떠 있어서 짙은 남색 그림자를
  // 크게 깔았는데, 바탕이 앱과 같은 밝은 캔버스로 바뀌면서 그 그림자는 화면에
  // 구멍을 뚫어 놓은 것처럼 무거워졌다. 그림자색은 앱 카드와 같은 계열로 맞춘다.
  var AUTH_SHADOW = "0 18px 50px rgba(17,24,39,0.10), 0 4px 12px rgba(17,24,39,0.05)";

  // 로그인 계열 화면의 배경 도형. 크기·위치·곡률은 index.html 의 .auth-blob 이 쥔다.
  function authBlobs() {
    return '<div class="auth-blob b1"></div><div class="auth-blob b2"></div>' +
           '<div class="auth-blob b3"></div><div class="auth-blob b4"></div>';
  }

  // 파란 브랜드 면 안쪽 배경. 바깥 캔버스(authBlobs)는 유기적인 덩어리지만 여기선
  // 제품의 어휘를 쓴다 — 가장자리에서 잘려 나가는 문서 면. 장식이라 스크린리더에서
  // 숨긴다. 크기·위치·움직임은 index.html 의 .bp-doc 이 쥔다.
  // (배경용 거대 돋보기도 한 번 넣었다가 지웠다 — index.html 쪽 주석 참고.)
  function brandBackdrop() {
    return '<span class="bp-doc bp-doc-tl" aria-hidden="true"></span>' +
           '<span class="bp-doc bp-doc-br" aria-hidden="true"></span>';
  }

  // 로그인 계열 화면(모달)의 뒤로가기. 모양·hover 는 index.html 의 .backlink 가 쥔다.
  function authBack(label) {
    return '<div class="backlink" data-act="setMode" data-arg="login">' + ICONS.arrowLeft + esc(label) + '</div>';
  }

  // 커스텀 셀렉트. 네이티브 <select> 는 펼친 목록을 OS 가 그려서 앱과 안 어울린다.
  // 값은 wrapper 의 data-value 에 담아두고 app.js 의 selToggle/selPick 이 여닫는다
  // (회원가입 폼 입력은 state 가 아니라 DOM 에 있어서 render() 를 못 부른다).
  var DEPTS = ["에너지인프라시스템실", "AX안전신뢰실", "우주항공국방기술실"];
  
  function getTeamsForDept(dept) {
    var all = teamOptions();
    if (!dept) return all;
    var validNames = [];
    if (dept === "AX안전신뢰실") {
      validNames = ["AX품질팀", "AI신뢰성1팀", "AI신뢰성2팀", "AI시험인증1팀", "AI시험인증2팀"];
    } else if (dept === "에너지인프라시스템실") {
      validNames = ["에너지검증1팀", "에너지검증2팀", "에너지검증3팀", "에너지검증 1팀", "에너지검증 2팀", "에너지검증 3팀"];
    } else if (dept === "우주항공국방기술실") {
      validNames = ["우주항공SW기술팀", "미래국방SW기술팀", "미래국방SW검증팀"];
    }
    if (validNames.length === 0) return all; // fallback for others
    return all.filter(function(t) {
      var n = t.name || t;
      return validNames.indexOf(n) !== -1;
    });
  }

  // 팀 목록은 서버(GET /api/health)가 준 것만 쓴다. 여기 손으로 적어두면 기준이
  // 없는 팀을 고를 수 있고, 그 사용자는 로그인해도 팀 기준이 안 붙은 채 공통
  // 기준만으로 검토한다 — "기준을 골랐는데 안 걸렸다"가 되고, 그건 이 프로젝트가
  // 계속 막으려던 조용한 0건이다.
  //
  // 아래 목록은 **file:// 목업 전용**이다. 거기엔 서버가 아예 없어서 검토도
  // 비교도 안 돌고 화면만 본다 — 빈 드롭다운을 보여줄 이유가 없다. 서버 위에서
  // 돌 때는 절대 쓰지 않는다: /api/health 가 아직 안 왔으면 빈 목록이 맞다.
  // 없는 기준을 지어내느니 아무것도 안 보여주는 편이 낫다.
  var MOCKUP_TEAMS = ["에너지검증 1팀", "에너지검증 2팀", "에너지검증 3팀", "AX품질팀",
                      "AI신뢰성1팀", "AI신뢰성2팀", "AI시험인증1팀", "AI시험인증2팀",
                      "우주항공SW기술팀", "미래국방SW기술팀", "미래국방SW검증팀"];

  function teamOptions() {
    if (window.location.protocol.indexOf("http") !== 0) return MOCKUP_TEAMS;
    return (state.server && state.server.checklists) || [];
  }

  // 팀 id → 화면에 쓰는 이름. state.user.team 에는 기준 파일명("ai-test-cert-1")이
  // 들어 있어 그대로 보여주면 사람이 읽을 것이 아니다. 목업 목록은 문자열이라
  // (id 와 이름이 같다) 그쪽도 같은 함수로 받는다.
  //
  // 못 찾으면 id 를 그대로 돌려준다 — /api/health 가 아직 안 왔을 뿐인데 빈칸을
  // 보여주면 "팀 미지정"으로 읽혀 실제 미지정과 구분이 안 된다.
  // 업로드 화면 부제에 쓰는 팀 이름. 이번 검토에 고른 기준(state.checklist)이
  // 먼저고, 아직 안 골랐으면 로그인한 소속 팀이다 — 그게 실제로 걸릴 기준이다.
  function setupTeam() {
    return teamLabel(state.checklist || (state.user && state.user.team) || "");
  }

  function teamLabel(id) {
    if (!id) return "";
    var opts = teamOptions();
    for (var i = 0; i < opts.length; i++) {
      var o = opts[i];
      if (typeof o === "string") { if (o === id) return o; }
      else if (o && o.id === id) return o.name;
    }
    return id;
  }

  var ICON_CARET = '<svg class="sel-caret" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';

  // options 는 문자열 배열이거나 {id, name} 배열이다. 팀은 보이는 이름과 값이
  // 다르다 — 화면엔 "에너지검증 2팀", 서버로 가는 값은 기준 파일명 "EV2" 다.
  // 문자열이면 둘이 같다(부서 등 기존 사용처).
  // opt: { value: 이미 고른 값, cls: 덧붙일 클래스 }. 회원가입 폼은 안 넘긴다
  // (아직 고른 게 없는 새 폼이라 placeholder 로 시작한다).
  function selectField(id, placeholder, options, opt) {
    opt = opt || {};
    var picked = opt.value || "", label = placeholder, hasPick = false;
    var items = options.map(function (o) {
      var val = o.id || o, name = o.name || o;
      var on = picked && val === picked;
      if (on) { label = name; hasPick = true; }
      return '<button type="button" class="sel-opt" role="option" aria-selected="' +
        (on ? "true" : "false") + '" ' +
        (o.disabled ? 'disabled aria-disabled="true" ' : '') +
        'data-act="selPick" data-arg="' + esc(id + "|" + val) + '">' +
        '<span>' + esc(name) + '</span>' +
        '<span class="sel-check">' + ICONS.check + '</span>' +
      '</button>';
    }).join("");
    return '<div class="sel' + (opt.cls ? " " + opt.cls : "") + '" id="' + esc(id) +
      '" data-value="' + esc(picked) + '">' +
      '<button type="button" class="sel-btn" data-act="selToggle" data-arg="' + esc(id) + '" ' +
        (opt.ariaLabel ? 'aria-label="' + esc(opt.ariaLabel) + '" ' : '') +
        'aria-controls="' + esc(id) + '-options" ' +
        'aria-haspopup="listbox" aria-expanded="false">' +
        '<span class="sel-label"' + (hasPick ? "" : ' data-ph="1"') + '>' + esc(label) + '</span>' +
        ICON_CARET +
      '</button>' +
      '<div class="sel-menu" id="' + esc(id) + '-options" role="listbox"' +
        (opt.ariaLabel ? ' aria-label="' + esc(opt.ariaLabel) + '"' : '') + '>' + items + '</div>' +
    '</div>';
  }

  function signupView() {
    var inputStyle = "width:100%;padding:14px 16px;border:1px solid var(--line);border-radius:var(--r-md);font-size:15px;color:var(--text);background:var(--bg);transition:border-color .2s var(--ease-out),background .2s var(--ease-out),color .2s var(--ease-out),box-shadow .2s var(--ease-out),opacity .2s var(--ease-out),transform .2s var(--ease-out);box-sizing:border-box;";
    var labelStyle = "display:block;font-size:14px;font-weight:500;color:var(--text-2);margin-bottom:8px;";
    
    var fOn = "this.style.borderColor='var(--accent)';this.style.background='var(--panel)'";
    var fOff = "this.style.borderColor='var(--line)';this.style.background='var(--bg)'";

    return '<div class="auth-canvas" style="width:100vw;height:100vh;display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden;">' +
      authBlobs() +
      '<div style="position:relative;z-index:10;width:100%;max-width:520px;background:var(--panel);border-radius:var(--r-xl);box-shadow:' + AUTH_SHADOW + ';padding:48px;animation:fadeUp var(--dur-3) var(--ease-out) forwards;">' +
        authBack("돌아가기") +
        '<div style="display:flex;align-items:center;gap:12px;margin-bottom:32px;">' +
          '<div style="width:32px;height:32px;display:flex;align-items:center;justify-content:center;color:var(--accent-ink);">' + ICONS.logoMark + '</div>' +
          '<h2 style="font-size:22px;font-weight:700;color:var(--text);margin:0;letter-spacing:var(--tr-title);">Doc<span style="color:var(--accent-ink);">Suree</span> 계정 생성</h2>' +
        '</div>' +
        // 오류 배너 자리 — 로그인 화면과 같은 방식(app.js authError 가 채운다).
        '<div id="authError" class="auth-error" hidden style="margin:-12px 0 20px;">' + ICONS.alert + '<span id="authErrorText"></span></div>' +
        // 폼으로 감싼다. 감싸지 않으면 브라우저가 "Password field is not
        // contained in a form" 을 띄우고 비밀번호 관리자가 새 계정을 저장하지
        // 못한다 — 로그인 화면은 처음부터 폼이었고 여기만 빠져 있었다.
        // 제출은 **막기만** 한다 — 버튼이 type="submit" 이라 Enter 는 브라우저가
        // 알아서 그 버튼을 클릭해 주고(암묵적 제출), 그 클릭은 data-act
        // 델리게이션이 받는다. 여기서 다시 .click() 을 부르면 마우스로 누를 때
        // 두 번 돈다 — 서버 로그인이 된 뒤 그 두 번째 완료가 2초 뒤 사람을
        // 홈으로 끌어갔다.
        '<form action="javascript:void(0);" onsubmit="return false;">' +
        '<div style="margin-bottom:20px;">' +
          '<label style="' + labelStyle + '">이름</label>' +
          '<input id="signupName" name="name" type="text" autocomplete="name" placeholder="홍길동" style="' + inputStyle + '" onfocus="' + fOn + '" onblur="' + fOff + '">' +
        '</div>' +
        '<div style="display:flex;gap:16px;margin-bottom:20px;">' +
          '<div style="flex:1;min-width:0;">' +
            '<label style="' + labelStyle + '">소속 부서</label>' +
            selectField("signupDept", "부서 선택", DEPTS) +
          '</div>' +
          '<div style="flex:1;min-width:0;" id="signupTeamWrapper">' +
            '<label style="' + labelStyle + '">팀</label>' +
            selectField("signupTeam", "팀 선택", teamOptions()) +
          '</div>' +
        '</div>' +
        '<div style="margin-bottom:20px;">' +
          '<label style="' + labelStyle + '">이메일 주소</label>' +
          '<input id="signupEmail" name="email" type="email" autocomplete="username" placeholder="name@company.com" style="' + inputStyle + '" onfocus="' + fOn + '" onblur="' + fOff + '">' +
        '</div>' +
        '<div style="margin-bottom:40px;">' +
          '<label style="' + labelStyle + '">비밀번호</label>' +
          '<input id="signupPwd" name="password" type="password" autocomplete="new-password" placeholder="••••••••" style="' + inputStyle + '" onfocus="' + fOn + '" onblur="' + fOff + '" onkeyup="if(event.key===\'Enter\') document.getElementById(\'signupBtn\').click();">' +
          // 규칙은 서버가 지지만(auth.py MIN_PASSWORD_LEN), 눌러본 뒤에 알려주면
          // 다시 치게 만든다 — 미리 적는다.
          '<div style="font-size:12px;color:var(--text-3);margin-top:8px;">8자 이상</div>' +
        '</div>' +
        '<button type="submit" id="signupBtn" class="btn btn-primary" data-act="doSignup" style="width:100%;padding:16px;border-radius:var(--r-md);font-size:15px;">회원가입 완료</button>' +
        '</form>' +
      '</div>' +
    '</div>';
  }


  function forgotView() {
    var inputStyle = "width:100%;padding:14px 16px;border:1px solid var(--line);border-radius:var(--r-md);font-size:15px;color:var(--text);background:var(--bg);transition:border-color .2s var(--ease-out),background .2s var(--ease-out),color .2s var(--ease-out),box-shadow .2s var(--ease-out),opacity .2s var(--ease-out),transform .2s var(--ease-out);box-sizing:border-box;";
    var labelStyle = "display:block;font-size:14px;font-weight:500;color:var(--text-2);margin-bottom:8px;";
    
    return '<div class="auth-canvas" style="width:100vw;height:100vh;display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden;">' +
      authBlobs() +
      '<div style="position:relative;z-index:10;width:100%;max-width:480px;background:var(--panel);border-radius:var(--r-xl);box-shadow:' + AUTH_SHADOW + ';padding:48px;animation:fadeUp var(--dur-3) var(--ease-out) forwards;">' +
        authBack("로그인으로 돌아가기") +
        '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">' +
          '<div style="width:32px;height:32px;display:flex;align-items:center;justify-content:center;color:var(--accent-ink);">' + ICONS.logoMark + '</div>' +
          '<h2 style="font-size:22px;font-weight:700;color:var(--text);margin:0;letter-spacing:var(--tr-title);">비밀번호 찾기</h2>' +
        '</div>' +
        // 사내 메일 발송 경로가 아직 없다. "보내드립니다"는 지킬 수 없는 약속이라
        // 화면이 먼저 사실을 말한다 — 누르면 doForgot 이 같은 말을 다시 한다.
        '<p style="font-size:15px;color:var(--text-3);margin:0 0 32px 0;">비밀번호 재설정은 아직 준비 중입니다. 계정 관리자에게 문의해 주세요.</p>' +
        // 오류 배너 자리 — 로그인 화면과 같은 방식(app.js authError 가 채운다).
        '<div id="authError" class="auth-error" hidden style="margin:-12px 0 20px;">' + ICONS.alert + '<span id="authErrorText"></span></div>' +
        // 제출은 **막기만** 한다 — 버튼이 type="submit" 이라 Enter 는 브라우저가
        // 알아서 그 버튼을 클릭해 주고(암묵적 제출), 그 클릭은 data-act
        // 델리게이션이 받는다. 여기서 다시 .click() 을 부르면 마우스로 누를 때
        // 두 번 돈다 — 서버 로그인이 된 뒤 그 두 번째 완료가 2초 뒤 사람을
        // 홈으로 끌어갔다.
        '<form action="javascript:void(0);" onsubmit="return false;">' +
        '<div style="margin-bottom:32px;">' +
          '<label style="' + labelStyle + '">이메일 주소</label>' +
          '<input id="forgotEmail" name="email" type="email" autocomplete="username" placeholder="name@company.com" style="' + inputStyle + '" onfocus="this.style.borderColor=\'var(--accent)\';this.style.background=\'var(--panel)\'" onblur="this.style.borderColor=\'var(--line)\';this.style.background=\'var(--bg)\'" onkeyup="if(event.key===\'Enter\') document.getElementById(\'forgotBtn\').click();">' +
        '</div>' +
        '<button type="submit" id="forgotBtn" class="btn btn-primary" data-act="doForgot" style="width:100%;padding:16px;border-radius:var(--r-md);font-size:15px;">문의 방법 보기</button>' +
        '</form>' +
      '</div>' +
    '</div>';
  }


  function view(v) {
    // 원문 창(새 창). 사이드바·헤더 없이 문서만 — 옆 모니터에 두고 보는 창이다.
    // 로그인 판정보다 먼저 본다: 세션 확인이 끝나기 전 첫 그림이 로그인/홈 화면으로
    // 번쩍이던 것이 이 순서 때문이었다(2026-09-08). 세션이 없으면 문서 자체가
    // 안 열리고 그 사실은 대기 화면이 말한다.
    if (state.popup) {
      // 문서가 열리기 전(이력 읽는 중·원본 받는 중)에는 홈이나 결과 화면을 잠깐이라도
      // 그리지 않는다 — 원문 버튼을 누르면 홈이 번쩍했다가 문서가 뜨는 게 그 때문이었다.
      if (!state.cview) {
        return '<div class="dr-app dr-popup"><div class="popup-wait">' +
          '<span style="display:inline-block;animation:spin 1s linear infinite;">' + ICONS.refresh + '</span> 원문을 여는 중…' +
          (state.cerror ? '<div class="popup-wait-err">' + esc(state.cerror) + '</div>' : '') +
        '</div></div>';
      }
      return '<div class="dr-app dr-popup">' +
        '<div style="flex:1;min-width:0;display:flex;flex-direction:column;background:var(--bg);">' + body(v) + '</div>' +
      '</div>';
    }
    if (v.isLogin) return loginView();
    if (v.isSignup) return signupView();
    if (v.isForgot) return forgotView();
    if (v.isAssistant) return assistantView(v);   // DoSuree 의 얼굴 — DocSuree 껍데기 없이
    return '<div class="dr-app">' + sidebar(v) +
      '<div style="flex:1;min-width:0;display:flex;flex-direction:column;background:var(--bg);">' + header(v) + body(v) + '</div>' +
      launcherHtml(v) +
    '</div>';
  }


    return {
      renderVals: renderVals, view: view, selectedSection: selectedSection,
      reviewHtml: reviewHtml, reviewJson: reviewJson,
      reviewMd: reviewMd, reviewCsv: reviewCsv, doAnnotate: doAnnotate,
      // 내보내기가 화면과 같은 판정을 싣게 한다.
      lineageView: lineageView,
      // app.js가 카드 하나만 갈아끼울 때 쓴다(전체 렌더 없이 = PDF 리로드 없이).
      findingCardClass: findingCardClass, findingCardInner: findingCardInner,
      // 번호 칩. 여러 곳을 문 지적은 번호마다 누를 수 있어야 한다.
      numberChip: numberChip,
      // 기록 목록 글리프 — 유형별로 갈리는지 테스트가 본다(web/tests/).
      recordShapeIcon: recordShapeIcon,
      // 진행 화면 step 마다 레인·퍼센트·경과만 부분 갱신할 때 쓴다(버튼 hover 유지).
      progressFragments: progressFragments, singleProgressPhase: singleProgressPhase,
      jobStopping: jobStopping,
      progressHead: progressHead,
      laneMetrics: laneMetrics, laneInner: laneInner,
      caseProgressMeta: caseProgressMeta,
      reviewCriteriaInfo: reviewCriteriaInfo,
      // 검토 기준 3층. node 로 돌려 본문 전문·필터·여닫힘이 실제로 붙는지 본다.
      criteriaLayersSection: criteriaLayersSection,
      criteriaCatalogModel: criteriaCatalogModel, criteriaWorkspaceParts: criteriaWorkspaceParts,
      criteriaWorkspace: criteriaWorkspace, criteriaHowSelect: criteriaHowSelect,
      resultsRowCss: resultsRowCss,
      // 체크리스트 검토 화면. node 로 돌려 시트 목록·진행·초안 표가 붙는지 본다.
      evaluateSetup: evaluateSetup, evaluateProgress: evaluateProgress,
      // 항목마다 종이의 행·막대만 바꾼다(전체 렌더 없이 = 애니메이션이 안 끊기게).
      patchEvaluateProgress: patchEvaluateProgress,
      evaluateResults: evaluateResults,
      // 검색 결과 목록만 따로 그린다. app.js 의 input 리스너가 이것만 갈아끼워야
      // 입력 중 포커스와 한글 조합이 안 날아간다 — render()를 부르면 <input> 이
      // 통째로 새로 만들어진다.
      // 지금 **화면에 보이는** 순서의 행 키. 키보드 이동이 이것을 따라야
      // 필터를 켰을 때 감춘 행으로 넘어가지 않는다.
      _rtmKeys: function () { return _rtmVisible.keys.slice(); },
      _rtmVkey: function (key) { return _rtmVisible.vkey[key] || ""; },
      searchResultsHtml: searchResultsHtml,
      searchModalHtml: searchModalHtml,
      selectField: selectField, getTeamsForDept: getTeamsForDept,
      // 기준 작성 화면의 되읽기 줄. app.js 의 input 리스너가 이것만 갈아끼운다 —
      // render() 를 부르면 <input> 이 새로 만들어져 한글 조합이 날아간다.
      idReadback: idReadback,
      // 담당 범위 계산 블록. app.js 의 input 리스너가 이것만 갈아끼운다.
      scopeCalc: scopeCalc,
      // 반영 확인 패널. node 로 돌려 판정이 제대로 붙는지 확인한다.
      lineageCardHtml: lineageCardHtml,
      // 반영 확인 패널. 뜻풀이가 살아 있는지 node 로 확인한다.
      lineageHtml: lineageHtml, lineagePanelHtml: lineagePanelHtml,
      chatLogHtml: chatLogHtml, assistantView: assistantView, launcherHtml: launcherHtml,
      lineageMarkIds: lineageMarkIds, hiddenFindingIds: hiddenFindingIds, confirmDialog: confirmDialog,
      lineageNaIds: lineageNaIds,
      // 탭 기본값이 두 곳에 있으면 화면과 로직이 다른 탭을 본다.
      reviewTabNow: reviewTabNow, lineageSummaryText: lineageSummaryText,
      lineageTabLabel: lineageTabLabel,
      // 산출물 세트 검토 리포트 CSV. app.js 의 액션이 내려받기를 건다.
      caseCsvText: caseCsvText,
      // 진행 화면 타임라인. api.js 가 단계마다 이 안쪽만 갈아끼운다 —
      // 여기서 안 내주면 부분 갱신이 옛 마크업을 다시 그려 화면이 갈린다.
      caseStageList: caseStageList,
      // 수정안이 '어느 기준에 맞추는 것인지'를 함께 보내려면 필요하다.
      criterionTextFor: criterionTextFor
    };
  };
})();
