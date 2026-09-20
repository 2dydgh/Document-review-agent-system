// 알림 창의 검토 작업 — 진행 중인 것은 눌러서 진행 화면으로 가고, 알림에서
// 멈춘 검토는 진행 화면이 "멈추는 중"을 말한다(2026-09-04).
// 실행: node --test web/tests/
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
  global.Date = Date;
  return views;
}

function state() {
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
              llm_model: "qwen", placeholder_markers: ["TBD"],
              teams: [{ id: "ai-test-cert-1", name: "AI시험인증1팀" }] },
    history: [], detect: null,
    crun: { checklist: null, results: {}, name: '', documentName: '' }, clib: { list: [] }, checklist: "",
    homeCriteria: null,
    jobId: { single: null, compare: null, case: null },
    stopped: { single: false, compare: false, case: false },
    jobs: [],
  };
}

const running = { id: "j1", kind: "review", title: "문서.pdf", status: "running",
                  stage: "표현 점검", started_at: 1700000000 };

test("알림 창에서 진행 중인 검토는 눌러서 진행 화면으로 간다", () => {
  const st = state();
  st.notiOpen = true; st.notiOpenedAt = 0;
  st.jobs = [running, { id: "j2", kind: "review", title: "끝난.pdf", status: "done", history_id: "h2" },
             { id: "j3", kind: "review", title: "실패.pdf", status: "error", error: "x" }];
  const html = build(st).view(build(st).renderVals());
  assert.match(html, /class="noti-row" data-act="openJob" data-arg="j1"/, "진행 중 행이 안 눌린다");
  assert.match(html, /class="noti-row" data-act="openHistory" data-arg="h2"/, "끝난 행이 결과로 안 간다");
  assert.ok(!/data-arg="j3"/.test(html), "실패한 행은 갈 데가 없어야 한다");
  const css = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.match(css, /\.noti-row\[data-act\]:hover/, "누를 수 있는 알림 행에 hover 가 없다");
});

test("알림에서 멈춘 검토는 진행 화면이 멈추는 중이라고 말한다", () => {
  const st = state();
  st.mode = "single"; st.screen = "progress";
  st.jobId.single = "j1";
  st.jobs = [Object.assign({}, running, { cancelling: true })];
  const views = build(st);
  const html = views.view(views.renderVals());
  assert.match(html, /멈추는 중/, "머리말이 여전히 검토 중이라고 한다");
  assert.ok(!/data-act="cancelReview"/.test(html), "멈추는 중인데 취소 버튼이 또 있다");
  assert.strictEqual(views.jobStopping("single"), true);
  assert.strictEqual(views.jobStopping("compare"), false);

  // 멈춘 직후 한 박자: "멈췄습니다"를 말하고, 취소 버튼도 멈추는 중 표시도 없다.
  st.stopped.single = true;
  const stoppedHtml = build(st).view(build(st).renderVals());
  assert.match(stoppedHtml, /검토를 멈췄습니다/);
  assert.ok(!/멈추는 중/.test(stoppedHtml) && !/data-act="cancelReview"/.test(stoppedHtml));
  assert.match(stoppedHtml, /data-progress-state-icon="stopped"/);
  st.stopped.single = false;

  // 취소를 안 눌렀으면 그대로 검토 중.
  st.jobs = [running];
  const plain = build(st).view(build(st).renderVals());
  assert.ok(!/멈추는 중/.test(plain));
  assert.match(plain, /data-act="cancelReview"/);
});
