// 홈 화면 — 검토자가 "어떻게 검토하고 무엇으로 재는지"를 알 수 있어야 한다.
// 실행: node --test web/tests/   (pytest 가 tests/test_frontend_js.py 로 감싼다)
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

function build(st) {
  const win = { DR: {}, location: { protocol: "http:", href: "http://x/" } };
  win.DR.ICONS = new Proxy({}, { get: () => "<svg/>" });
  win.DR.helpers = {
    esc: (s) => String(s == null ? "" : s), rgba: () => "", fmtSize: () => "1KB",
    download: () => {}, downloadBlob: () => {}, docSides: () => ({}),
    sentences: (s) => [String(s == null ? "" : s)],
  };
  new Function("window", fs.readFileSync(path.join(__dirname, "..", "views.js"), "utf8"))(win);
  const views = win.DR.views({
    state: st, props: { accent: "#356998" }, render: () => {},
    backend: { errorBanner: () => "", ago: () => "1분 전", fmtElapsed: () => "0:03" },
  });
  win.DOCREVIEW = {
    doc: { name: "문서.pdf", type: "PDF" }, sections: [], findings: [], stages: [],
    images: [], compare: { stages: [], findings: [], docA: {}, docB: {}, stats: {} },
    sevMeta: { major: { label: "치명", kr: "치명", order: 0 },
               minor: { label: "주의", kr: "주의", order: 1 },
               info: { label: "참고", kr: "참고", order: 2 } },
    typeMeta: { missing: { label: "누락" }, mismatch: { label: "불일치" },
                extra: { label: "초과" } },
  };
  global.window = win;
  return views;
}

function state(criteria) {
  return {
    mode: "home", screen: "upload", stageIndex: -1, done: false, reviewed: false,
    sevFilter: { major: true, minor: true, info: true },
    checkerFilter: "all", sort: "severity", exportMenuOpen: false,
    rev: { startedAt: 0, prepAt: 0, prep: {}, lanes: [], done: {}, note: "" },
    kase: { step: "upload", checked: {}, tab: "summary" },
    cstep: "setup", cstageIndex: -1, cdone: false,
    files: {}, annot: { busy: false, msg: "", numbers: {} },
    viewer: { baseBlob: null, mode: "orig", converting: false, convertError: null },
    marks: null, selected: null, theme: "light",
    user: { name: "김검토", team: "ai-test-cert-1" },
    server: { checklists: [], checklist: "", scope_label: "", llm_provider: "local",
              llm_model: "qwen", placeholder_markers: ["TBD"], chat_enabled: true,   // 마스코트 = DoSuree 얼굴
              teams: [{ id: "ai-test-cert-1", name: "AI시험인증1팀" }] },
    history: [], detect: null,
    crun: { checklist: null, results: {}, name: '', documentName: '' }, clib: { list: [] }, checklist: "",
    homeCriteria: criteria,
  };
}

// 기준 항목 n 건 중 auto 건이 저절로 돈다. `agent` 는 presets/criteria 가 들고
// 서버가 /api/criteria 로 그대로 내보내는 값이라, 여기서도 진짜 이름을 쓴다.
const items = (agent, n, auto) =>
  Array.from({ length: n }, (_, i) => ({
    agent, howChecked: i < auto ? "LLM · 자동" : "사람이 확인",
  }));

// 꼬리표 세 가지(전부 자동 · 일부만 자동 · 아무것도 자동 아님)가 다 나오게 짰다.
// 공통 7건(자동 4) · 팀 13건(자동 6) — 합 20건, 자동 10.
const LAYERS = [
  { scope: "공통", id: "common", name: "공통 기준",
    items: [...items("형식·완전성", 4, 4),      // 전부 자동
            ...items("정합성·추적성", 2, 0),    // 전부 사람
            ...items("표현·내용품질", 1, 0)] },
  { scope: "팀별", id: "ai-test-cert-1", name: "AI시험인증1팀",
    items: [...items("문서작성·생성", 6, 3),    // 일부만 자동
            ...items("표준·체크리스트", 3, 2),
            ...items("형식·완전성", 2, 1),
            ...items("검토의견·이력", 2, 0)] },
];

// 업로드 체크리스트까지 있는 경우. 걸리는 방식이 다른 셋을 다 담는다.
const LAYERS3 = [...LAYERS, {
  scope: "업로드", id: "up1", name: "SVVP 체크리스트", editable: true,
  items: [...items("표준·체크리스트", 5, 4), ...items("형식·완전성", 3, 2)],
}];

const home = (criteria) => {
  const views = build(state(criteria));
  return views.view(views.renderVals());
};

test("홈이 없는 기능을 약속하지 않는다", () => {
  // 심각도 패널이 "전체 점수에 반영됩니다"라고 했는데 점수는 **없앤 기능**이다
  // (CLAUDE.md 기능 방침). "4단계"라 적혔지만 실제로 그리는 것은 셋이었다.
  const html = home(null);
  assert.ok(!html.includes("전체 점수"), "없는 점수를 약속한다");
  assert.ok(!html.includes("4단계"), "심각도가 넷이라고 말한다");
  assert.ok(!html.includes("발견된 문제 심각도"), "지운 패널이 남아 있다");
});

test("새 검토는 중복 범위 라벨이 없는 실제 버튼이다", () => {
  const html = home(null);
  assert.ok(!html.includes("빠른 시작"), "카드만으로 분명한 첫 줄에 중복 제목이 생겼다");
  for (const scope of ["한 문서", "두 문서", "한 폴더"]) {
    assert.ok(!html.includes(`<span class="qs-scope">${scope}</span>`),
              `제목을 반복하는 범위 라벨(${scope})이 남아 있다`);
  }
  assert.strictEqual((html.match(/<button type="button" class="tile act qs grow b3"/g) || []).length, 4,
                     "빠른 시작 카드가 키보드로 누를 수 있는 버튼이 아니다");
});

test("무엇으로 재는지를 진짜 기준으로 말한다", () => {
  // 예전에는 서버 설정 세 줄(`적용 중인 검토 기준`)을 보여줬는데, 검토를 이끄는
  // 것은 presets/criteria 의 공통·팀 기준이다.
  const html = home({ team: "ai-test-cert-1", layers: LAYERS });
  assert.ok(!html.includes("적용 중인 검토 기준"), "옛 패널이 남아 있다");
  assert.match(html, /<span class="tile-h home-tile-title">[^]*?검토 기준<\/span>/, "기준 타일 제목이 없다");
  assert.ok(html.includes("공통 기준") && html.includes("AI시험인증1팀"),
            "어느 기준이 걸리는지 안 보여준다");
  // 돋보기 빛(data-glow)은 숨은 마스코트용 장치였다 — 런처 승격과 함께 은퇴.
  assert.ok(!/class="tile crit[^>]*data-glow/.test(html),
            "은퇴한 돋보기 빛이 기준 타일에 되살아났다");
  // 숨은 이스터에그였던 전신 마스코트는 우하단 상주 런처로 승격됐다
  // (2026-09-01 결정 — 훗날 어시스턴트 채팅 자리). 타일 안에는 남지 않는다.
  assert.ok(!html.includes("crit-secret-mark"), "옛 숨은그림 마크가 남아 있다");
  assert.match(html, /class="home-launcher[^"]*"[^>]*aria-label/,
               "우하단 마스코트 런처가 없다");
  assert.match(html, /home-launcher[^]*mascot-investigator-192\.png/,
               "런처가 전신 마스코트를 쓰지 않는다");

  // 기준은 **제 타일**을 갖고, 겹이 몇이든 타일은 하나다 — 이게 격자를 안
  // 흔드는 조건이다. 한때 겹마다 타일을 주는 안을 만들어 비교했는데, 업로드
  // 체크리스트마다 겹이 늘어나 셋이 되는 순간 격자 오른쪽이 통째로 비었다.
  const tiles = html.split(/(?=class="tile[ "])/).slice(1);
  assert.strictEqual(tiles.filter((t) => t.includes("검토 기준")).length, 1,
                     "기준 타일이 겹마다 쪼개졌다 — 격자가 흔들린다");
});

test("홈에서는 기준 건수를 말하지 않는다", () => {
  // 홈에 선 사람에게 "공통 7건 · 팀 13건"은 아무 결정도 바꾸지 않는다. 건수가
  // 궁금해지는 순간은 기준 화면에 들어간 뒤다. 홈은 **어느 겹이 걸리는가**만
  // 그림으로 말한다.
  const html = home({ team: "ai-test-cert-1", layers: LAYERS3 });
  const tile = html.split(/(?=class="tile[ "])/).slice(1)
    .filter((t) => t.includes("검토 기준"))[0];
  // 픽스처는 공통 7 · 팀 13 · 업로드 8 = 28건. 어느 수도 화면에 없어야 한다.
  for (const n of ["7건", "13건", "8건", "28건", "20건"]) {
    assert.ok(!tile.includes(n), `기준 타일에 건수(${n})가 남아 있다`);
  }
});

test("기준 타일은 지금 걸리는 팀 기준만 말하고, 없으면 왜 없는지 말한다", () => {
  // 세 층(공통·팀·추가)을 그리던 그림은 뺐다(2026-09-18) — 구현 사실이지 검토자가 매일 볼 정보가 아니다.
  // 층 구조는 검토 기준 화면에 있다. 홈은 "지금 무엇으로 재는가" 하나만 답한다.
  const full = home({ team: "ai-test-cert-1", layers: LAYERS3 });
  // 그림은 카드 더미 — 세 상자가 늘 셋이고, 안 걸린 것은 흐리게(is-off) 자리를 지킨다.
  const deck = (html) => html.slice(html.indexOf('class="crit-deck'), html.indexOf('crit-sheet-body'));
  assert.strictEqual((deck(full).match(/class="crit-sheet[ "]/g) || []).length, 3, "겹이 셋이 아니다");
  assert.match(full, /선택 가능 1개/, "올려 둔 추가 기준을 현재 적용처럼 말하거나 숨긴다");
  assert.ok(!full.includes("crit-flow-lines") && !full.includes("crit-now"), "순서도나 팀 이름 큰 글씨가 남아 있다");
  const plain = home({ team: "ai-test-cert-1", layers: LAYERS });
  assert.strictEqual((plain.match(/class="crit-sheet is-off/g) || []).length, 1, "안 걸린 추가 기준이 흐리게 서지 않는다");
  assert.match(plain, /검토를 시작할 때 필요한 기준을 고릅니다/, "추가 기준이 없을 때 고르는 것이라는 말이 없다");
  const noTeam = home({ team: "", layers: LAYERS.filter((l) => l.scope !== "팀별") });
  assert.strictEqual((noTeam.match(/class="crit-sheet is-off/g) || []).length, 2, "팀 기준 없음이 흐리게 서지 않는다");
  // 문은 머리줄의 모두 보기 하나 — 진짜 button 이다.
  assert.match(full, /<button type="button"[^>]*data-act="setMode" data-arg="checklists"/);
  // 무엇을 보는가 — 팀 층의 documents 가 문서 칩으로, 항목의 agent 가 검사 갈래 칩으로.
  const withDocs = home({ team: "ai-test-cert-1", layers: LAYERS.map((l) =>
    l.scope === "팀별" ? { ...l, documents: ["RVVR", "SRS", "SDD"],
      items: [{ agent: "형식·완전성" }, { agent: "형식·완전성" }, { agent: "정합성·추적성" }] } : l) });
  assert.match(withDocs, /<dt>알아보는 문서<\/dt><dd>[^]*pill pill-neutral">RVVR<[^]*>SRS<[^]*>SDD</, "문서 칩이 없다");
  // 공통(형식 4 · 추적 2 · 표현 1) + 팀(형식 2 · 추적 1) — 갈래별로 합쳐 센다. 문서작성·검토의견은 갈래가 아니라 안 그린다.
  assert.match(withDocs, /<dt>검사 갈래<\/dt><dd>[^]*cat-form"[^>]*>형식 <i>6<\/i>[^]*cat-expr"[^>]*>표현 <i>1<\/i>[^]*cat-trace"[^>]*>추적 <i>3<\/i>/, "검사 갈래 칩이 없다");
  assert.ok(!/cat-process/.test(withDocs.slice(withDocs.indexOf("검사 갈래"), withDocs.indexOf("crit-note"))), "없는 갈래를 그린다");
  assert.ok(!plain.includes("알아보는 문서"), "documents 가 없는데 빈 줄을 그린다");
});

test("홈 메뉴 진입은 페이지 페이드만 쓰고 카드별 순차 등장을 겹치지 않는다", (t) => {
  let now = 1000;
  t.mock.method(Date, "now", () => now);
  const st = state({ team: "ai-test-cert-1", layers: LAYERS });
  const views = build(st);
  st.mode = "history";
  const first = views.view(views.renderVals());
  assert.ok(!/listIn/.test(first), "첫 화면(새로고침)에 등장 연출이 붙었다");
  assert.ok(!first.includes('animation:screenIn'), "첫 로드에는 화면 이동 연출이 없다");
  st.mode = "home";
  const html = views.view(views.renderVals());
  assert.match(html, /animation:screenIn var\(--dur-page\)/);
  assert.ok(!html.includes('animation:listIn'), "카드별 순차 등장이 페이지 전환과 겹친다");
  now += 100;
  const updated = views.view(views.renderVals());
  assert.match(updated, /animation:screenIn[^;]+;animation-delay:-100ms/);
  assert.ok(!updated.includes('animation:listIn'));
  now += 600;
  const settled = views.view(views.renderVals());
  assert.ok(!settled.includes('animation:screenIn'));
  assert.ok(!settled.includes('animation:listIn'));
});

test("타일 크기가 우선순위를 말한다", () => {
  // 벤토 격자 — 예전에는 큰 흰 카드 넷이 세로로 쌓여 무엇부터 봐야 할지
  // 안 보였다. 검토를 **시작하는 것**이 제일 크고, 흐름은 가로로 넓게 깔린다.
  const html = home({ team: "ai-test-cert-1", layers: LAYERS });
  assert.match(html, /class="bento"/, "격자가 없다");
  // `tile-h`·`tile-sub` 같은 자식 클래스는 타일이 아니다 — 정확히 `tile` 로
  // 시작하고 공백이나 따옴표가 뒤따르는 것만 센다.
  const cls = [...html.matchAll(/class="((?:tile|home-col)(?:\s[^"]*)?)"/g)].map((m) => m[1].split(" "));
  // **크기가 곧 위계다.** 매번 보는 최근 검토가 가장 큰 칸이고, 처음 몇 번만
  // 읽는 흐름은 그보다 작다. 예전에는 둘 다 가로 전체라 화면이 "이게 다 똑같이
  // 중요하다"고 말했다.
  const span = { b3: 3, b4: 4, b6: 6, b8: 8, b12: 12 };
  // 기둥(home-col) 안의 타일은 격자 칸을 안 갖는다 — 기둥이 대신 센다.
  const spanOf = (c) => span[c.filter((x) => span[x])[0]] || 0;
  // 타일 경계로 갈라 잰다. `class="tile-h"` 같은 자식도 `tile` 로 시작하므로
  // 뒤에 공백이나 따옴표가 오는 것만 타일로 본다.
  const chunks = html.split(/(?=class="(?:tile|home-col)[ "])/).slice(1);
  // **폭이 아니라 면적으로 잰다.** 흐름이 제 줄(b6)을 갖게 되면서 폭만 보면
  // 설명이 제일 큰 타일이 됐는데, 실제로는 한 줄짜리 띠라 두 줄을 먹는 최근
  // 검토(b4 r2 = 8칸)가 여전히 더 크다(b6 = 6칸). 폭만 재던 것은 최근 검토를
  // 뺀 전부가 1행이던 시절의 근사치였다.
  const at = (needle) => {
    const t = chunks.filter((x) => x.includes(needle))[0];
    if (!t) return 0;
    const c = t.slice(7, t.indexOf('"', 7)).split(" ");
    return spanOf(c) * (c.includes("r3") ? 3 : c.includes("r2") ? 2 : 1);
  };
  // 최근 검토는 기둥(home-col b6 r3) 안에 산다 — 기둥의 칸으로 잰다.
  assert.ok(at("home-col") > at("검토 기준"),
            "기준 타일이 최근 검토 기둥만큼 크다 — 크기가 위계를 안 말한다");
  // 검토 넷은 **같은 크기**다. 무엇을 고를지는 문서가 몇 개냐일 뿐이라 하나만 크게 두면
  // 나머지가 곁다리로 보인다. 드롭존 하나로 갈음해 봤지만(2026-09-18 시안) 검토마다 받는
  // 파일 수·종류가 달라 문 넷으로 돌아왔다.
  const starts = cls.filter((c) => c.includes("qs"));
  assert.strictEqual(starts.length, 4, `검토 시작 타일이 ${starts.length}개다 (넷이어야 한다)`);
  assert.ok(starts.every((c) => c.includes("b3")), "시작 타일 크기가 갈라졌다");
  assert.strictEqual((html.match(/class="qs-icon"/g) || []).length, 4);
  for (const kind of ["단일 검토", "비교 검토", "폴더 검토", "체크리스트 검토"]) {
    assert.ok(html.includes(kind), `${kind} 가 없다`);
  }
  // 읽기만 하는 타일은 안 들린다 — act 는 누를 수 있는 것(시작 타일 넷)에만 붙는다.
  assert.strictEqual(cls.filter((c) => c.includes("act")).length, 4, "누를 수 있는 타일 수가 다르다");
  const crit = html.split(/(?=class="tile[ "])/).slice(1)
    .filter((t) => t.includes("검토 기준"))[0];
  assert.ok(!/class="tile crit[^"]*\bact\b/.test(html), "기준 타일 전체가 아직 문이다");
  assert.match(crit, /class="tile crit[^"\n]*\bgrow\b/,
               "기준 타일이 최근 검토와 세로 끝선을 맞추지 않는다");
  // 그 하나뿐인 문은 진짜 button 이어야 한다 — span 이면 키보드로 못 닿는다.
  assert.match(crit, /<button type="button"[^>]*data-act="setMode" data-arg="checklists"/,
               "기준 화면으로 갈 길이 없다");
  // 무게는 **크기와 자리**가 말한다 — 그게 벤토다. 색 면도 강조 띠도 대봤는데
  // 둘 다 시끄럽기만 했다. 면은 다 같은 흰색이다.
  assert.ok(!html.includes("lead"), "면에 장식을 다시 붙였다");

  // 줄마다 6칸이 꽉 차야 빈칸이 안 생긴다. 두 줄을 먹는 타일(.r2)은 칸도 두 배로
  // 센다 — 세로 span 을 빼고 세면 꽉 찬 격자가 "6의 배수가 아니다"로 잡힌다.
  const cells = cls.reduce(function (n, c) {
    return n + spanOf(c) * (c.includes("r3") ? 3 : c.includes("r2") ? 2 : 1);
  }, 0);
  assert.strictEqual(cells % 12, 0, `칸 합이 12의 배수가 아니다: ${cells}`);
  // 높이가 다 같으면 그건 격자가 아니라 줄이다 — 오른쪽 기둥이 세 줄을 통째로 갖는다(2026-09-18).
  assert.ok(cls.some((c) => c.includes("home-col") && c.includes("r3")), "타일 높이가 전부 같다");
});

test("기록이 생겨도 격자 칸 합이 맞고 검토 방법 타일은 없다", () => {
  // 검토 방법(4단계 설명) 타일은 2026-09-18 에 뺐다 — 매일 오는 작업 화면에 자기소개가
  // 자리를 차지했다. 같은 내용은 도움말 "이렇게 일합니다"가 맡는다.
  const st = state({ team: "ai-test-cert-1", layers: LAYERS });
  st.history = [{ id: "h1", title: "문서.pdf", at: "2026-08-11T00:00:00Z", findings: 3 }];
  const views = build(st);
  const html = views.view(views.renderVals());
  assert.ok(!html.includes("검토 방법") && !html.includes("flow-step"), "검토 방법 타일이 다시 생겼다");
  const cls = [...html.matchAll(/class="((?:tile|home-col)(?:\s[^"]*)?)"/g)].map((m) => m[1].split(" "));
  const span = { b3: 3, b4: 4, b6: 6, b8: 8, b12: 12 };
  const spanOf = (c) => span[c.filter((x) => span[x])[0]] || 0;
  const cells = cls.reduce((n, c) => n + spanOf(c) * (c.includes("r3") ? 3 : c.includes("r2") ? 2 : 1), 0);
  assert.strictEqual(cells % 12, 0, `칸 합이 12의 배수가 아니다: ${cells}`);
  assert.ok(cls.some((c) => c.includes("home-col") && c.includes("r3")), "최근 검토 기둥이 없다");
  assert.ok(!html.includes("data-home-first"), "기록이 있는데 첫 방문 설명이 보인다");
});

test("첫 방문이면 최근 검토 자리에 네 단계가 서고, 못 읽었을 때는 서지 않는다", () => {
  const st = state({ team: "ai-test-cert-1", layers: LAYERS });
  st.history = []; st.jobs = [];
  let html = build(st).view(build(st).renderVals());
  assert.match(html, /아직 검토한 문서가 없습니다[^]*data-home-first[^]*판정은 검토자가/, "네 단계가 없다");
  // 이력을 못 읽은 것(historyError)은 첫 방문이 아니다 — "없다"로 말하면 안 된다.
  st.historyError = true;
  html = build(st).view(build(st).renderVals());
  assert.ok(!html.includes("data-home-first"), "못 읽은 것을 첫 방문으로 꾸민다");
});

test("판정이 남은 기록은 브랜드색 알약으로 서고, 진행 중은 맨 위에 선다", () => {
  // 할 일을 따로 타일로 두면 최근 검토와 같은 기록이 두 번 보였다(2026-09-18). 한 목록에서
  // 남은 일이 있는 줄만 다르게 — 라벨이 노랑 알약이고, 누르면 그 일이 있는 탭으로 간다.
  const st = state({ team: "ai-test-cert-1", layers: LAYERS });
  st.history = [
    { id: "c1", kind: "compare", title: "A.pdf ↔ B.hwpx", at: "2026-09-15T00:00:00Z", findings: 3,
      by: "석호준", summary: { issues: 3, unreviewed: 0, pending: 12 } },
    { id: "e1", kind: "evaluation", title: "A.pdf", at: "2026-09-17T00:00:00Z", findings: 0,
      summary: { issues: 0, unreviewed: 1, unfound: 3 } },
    { id: "r1", kind: "review", title: "끝난.pdf", at: "2026-09-10T00:00:00Z", findings: 5,
      summary: { issues: 5, unreviewed: 0 } },
  ];
  st.jobs = [{ id: "j1", kind: "review", title: "돌아가는.pdf", status: "running" }];
  let html = build(st).view(build(st).renderVals());
  const rows = html.split(/(?=class="record-row home-recent-grid home-recent-row)/).slice(1);
  assert.strictEqual(rows.length, 4, "진행 1 + 기록 3");
  assert.match(rows[0], /is-running[^]*data-act="openJob" data-arg="j1"[^]*진행 중/, "진행 중이 맨 위가 아니다");
  assert.match(rows[1], /data-act="openTodo" data-arg="c1"[^]*home-result-label pill pill-cat">미판정 12건/, "판정 남은 줄이 알약이 아니다");
  // 체크리스트 검토는 결과가 읽기 전용이라 판정이 남을 수 없다 — 알약을 달지 않는다.
  assert.match(rows[2], /data-act="openHistory" data-arg="e1"/);
  assert.ok(!rows[2].includes("pill pill-cat"), "체크리스트 검토가 판정 남음으로 섰다");
  assert.match(rows[3], /data-act="openHistory" data-arg="r1"[^]*home-result-label">수정 사항 5건/, "끝난 줄이 알약을 달았다");
  assert.ok(!html.includes("home-todo-chip"), "머리줄 칩은 뺐다 — 줄의 알약이 이미 말한다");
});

test("최근 기록은 조밀하게 8건까지 보이고 모두 보기와 지적 상태를 구분한다", () => {
  const st = state({ team: "ai-test-cert-1", layers: LAYERS });
  st.history = Array.from({ length: 10 }, (_, i) => ({
    id: `h${i}`, title: `문서${i}.pdf`, at: "2026-08-11T00:00:00Z", findings: i + 1,
  }));
  const views = build(st);
  const html = views.view(views.renderVals());
  assert.strictEqual((html.match(/class="record-row home-recent-grid home-recent-row"/g) || []).length, 8,
                     "홈 최근 검토가 8건보다 많거나 적다");
  assert.ok(!html.includes("문서8.pdf"), "아홉 번째 기록까지 홈에 노출됐다");
  assert.match(html, /class="btn btn-sm btn-primary home-see-all"[^>]*>모두 보기/,
               "모두 보기가 솔리드 액션 버튼이 아니다");
  assert.match(html, /class="record-result"/, "수정 사항 상태가 사라졌다");
  assert.match(html, /class="home-recent-open"/, "최근 검토 행의 열기 신호가 없다");
  const css = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.match(css, /\.home-recent-row:hover \.home-recent-open \{ background: var\(--accent\)/,
               "호버할 때 솔리드 화살표가 나타나지 않는다");
});

test("방금 완료된 기록 하나만 홈에서 새 결과로 표시한다", () => {
  const st = state({ team: "ai-test-cert-1", layers: LAYERS });
  st.history = [
    { id: "new", title: "새문서.pdf", at: "2026-08-11T00:00:00Z", findings: 1 },
    { id: "old", title: "이전문서.pdf", at: "2026-08-10T00:00:00Z", findings: 0 },
  ];
  st.homeFreshHistoryId = "new";
  const views = build(st);
  const html = views.view(views.renderVals());
  assert.strictEqual((html.match(/data-fresh-history="true"/g) || []).length, 1,
                     "새 결과가 아닌 행까지 강조한다");
  assert.match(html, /home-recent-row is-fresh/,
               "방금 완료된 기록에 한 번짜리 강조 클래스가 없다");
});

test("홈 결과는 한 줄로 요약하되 미검토와 상세 수치는 보존한다", () => {
  const st = state({ team: "ai-test-cert-1", layers: LAYERS });
  st.history = [
    { id:'mixed',title:'검증용.pdf',kind:'review',summary:{issues:3,unreviewed:2,info:4} },
    { id:'pending',title:'미검토.pdf',kind:'review',summary:{issues:0,unreviewed:7,info:1} },
    { id:'unavailable',title:'요약없음.pdf',kind:'review',summary:{unavailable:true} },
    { id:'manual',title:'기준표',kind:'checklist',summary:{unjudged:9} },
  ];
  const views=build(st),html=views.view(views.renderVals());
  assert.ok(!html.includes('history-result-copy'), '홈에 상세 설명 줄이 남아 있다');
  for(const label of ['수정 사항 3건','미검토 7건','요약 확인 필요']) {
    assert.ok(html.includes('class="home-result-label">'+label+'</span>'));
  }
  // 사람 판정이 남은 것은 노랑 알약(확인 필요)이다 — 같은 라벨 클래스에 알약이 얹힌다.
  assert.ok(html.includes('class="home-result-label pill pill-cat">미판정 9건</span>'));
  assert.match(html,/title="수정 사항 3건 · 미검토 2건 · 과정 보고 4건"/);
  // 표식 없이 글자만 — 점도 주의 표시도 없다. 미검토는 툴팁(title)과 "미검토 N건" 라벨이 말한다.
  assert.ok(!html.includes('home-result-warning'), '주의 표시가 남아 있다');
  assert.ok(!/class="record-result"[^>]*><i style="background:/.test(html), '최근 검토에 점이 남아 있다');
  assert.match(html,/data-act="openHistory"[^>]*data-arg="mixed"/);
});

test("못 읽은 것과 없는 것을 섞지 않는다", () => {
  // 예전에는 이력 요청이 실패해도 빈 배열을 넣어서, 서버가 죽었을 때 홈이
  // "아직 검토한 문서가 없습니다"라고 말했다 — 검토를 스무 건 한 사람에게
  // 한 건도 없다고 한 셈이다. CLAUDE.md 의 "모르면 모른다고 말한다"가 막는 것이
  // 검사 결과만이 아니라 화면 전체에 걸린다.
  const st = state(null);
  st.history = []; st.historyError = true;
  const views = build(st);
  const html = views.view(views.renderVals());
  assert.ok(!html.includes("아직 검토한 문서가 없습니다"), "실패를 '없음'으로 말한다");
  assert.match(html, /불러오지 못했습니다/, "못 읽었다고 말하지 않는다");
  // 상태만 말하고 손잡이가 없으면 새로고침밖에 길이 없다.
  assert.match(html, /data-act="reloadHistory"/, "다시 시도할 길이 없다");
});

test("비어 있으면 무엇을 하면 채워지는지 말한다", () => {
  const st = state(null);
  st.history = []; st.historyError = false;
  const views = build(st);
  const html = views.view(views.renderVals());
  assert.match(html, /아직 검토한 문서가 없습니다/);
  assert.match(html, /검토를 시작하면 여기에 남습니다/, "빈 화면이 다음 걸음을 안 알려준다");
});

test("아직 못 읽었으면 지어내지 않는다", () => {
  const html = home(null);
  assert.ok(!html.includes("· 자동 "), "기준도 없이 숫자를 낸다");
  assert.match(html, /불러오는 중…|로그인하면/);
});


test("홈의 인사와 빠른 시작 손잡이를 지킨다", () => {
  const html = home({ team: "ai-test-cert-1", layers: LAYERS });
  // 이름은 강조된다. 이 테스트가 지키는 것은 **강조가 살아 있는가**지 그 수단이
  // 아니다 — 예전에 실제로 흘린 적이 있다.
  //
  // 홈 인사의 이름은 브랜드색으로 구분하되 링크 동작이나 장식 획은 없다.
  assert.match(html, /<span class="home-greeting-name">김검토 님<\/span>, 환영합니다/,
               "이름 강조가 빠졌다");
  // 진입 때는 wave-enter 가 붙어 한 번 흔들린다 — 있어도 없어도 아이콘은 있어야 한다.
  assert.match(html, /class="home-greeting-wave[^"]*" aria-hidden="true"/,
               "인사말의 펼친 손 아이콘이 빠졌다");
  assert.ok(!html.includes("home-greeting-eagle"),
            "chat 안내자로 옮길 홈 마스코트가 아직 인사말에 남아 있다");
  assert.ok(!html.includes('class="mark"'), "인사말에 형광펜 획이 남아 있다");
  // 화살표는 늘 자리를 지키다 호버하면 색이 찬다(.qs:hover .qs-arrow).
  assert.match(html, /class="qs-arrow"/, "화살표가 빠졌다");
});

test("무엇이든 물어보세요 카드는 어시스턴트가 켜졌을 때만 기둥 아래 서고, 칩과 입력이 대화를 연다", () => {
  const st = state({ team: "ai-test-cert-1", layers: LAYERS });
  let html = build(st).view(build(st).renderVals());
  assert.match(html, /home-ask-tile[^]*무엇이든 물어보세요[^]*DoSuree 가 검토 기록/, "물어보기 카드가 없다");
  assert.match(html, /<input id="homeAsk" type="text"/, "입력창이 없다");
  assert.match(html, /data-act="homeAsk"/, "보내기 버튼이 없다");
  assert.ok((html.match(/class="home-ask-chip" data-act="homeAskChip"/g) || []).length >= 3, "예시 칩이 없다");
  st.server.chat_enabled = false;
  html = build(st).view(build(st).renderVals());
  assert.ok(!html.includes("home-ask-tile"), "어시스턴트가 꺼졌는데 카드가 남았다");
});

test("기준 선택은 짧은 적용 설명만 바꾸고 항목 목록은 홈에 싣지 않는다", () => {
  const sampleLayers = LAYERS3.map(layer => ({ ...layer,
    items: layer.items.map(item => ({ ...item, text: '전체 목록에서만 읽는 기준 본문' })),
  }));
  const st = state({ team: "ai-test-cert-1", layers: sampleLayers });
  for (const key of ['common', 'team', 'upload']) {
    st.homeCriteriaFocus = key;
    const html = build(st).view(build(st).renderVals());
    assert.ok(!html.includes('전체 목록에서만 읽는 기준 본문') && !html.includes('crit-preview'));
    assert.match(html, /data-act="setMode" data-arg="checklists"/);
    const panel = html.match(new RegExp('<section class="crit-description" id="crit-description-' + key + '"[^>]*>'))[0];
    assert.ok(!panel.includes(' hidden'), '고른 설명이 숨겨졌다');
    assert.strictEqual((html.match(/class="crit-description"[^>]* hidden>/g) || []).length, 2);
    assert.strictEqual((html.match(/data-act="homeCriteriaExplain"[^>]*aria-pressed="true"/g) || []).length, 1,
      '선택된 종이가 하나가 아니다');
    assert.ok(!html.includes('aria-expanded'), '설명 선택이 상세 펼침으로 바뀌었다');
    assert.ok(!html.includes('crit-tabs'), '제거한 밑줄 탭이 남아 있다');
  }
  st.homeCriteria = { team: 'ai-test-cert-1', layers: LAYERS };
  st.homeCriteriaFocus = 'upload';
  const html = build(st).view(build(st).renderVals());
  assert.match(html, /crit-sheet is-off is-active[^>]*data-arg="upload"/);
  assert.match(html, /등록된 추가 기준 없음/);
  assert.ok(!/data-act="homeCriteriaExplain"[^>]*disabled/.test(html), '미등록 기준의 설명을 읽을 수 없다');
});
