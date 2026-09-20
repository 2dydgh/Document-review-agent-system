// 검토 결과 화면 — 큰 숫자는 진짜 지적(major+minor)만 세고, info·미검토는
// 부제로 따로 말한다. 미검토는 info 칩이 아니라 자기 칩으로 켜고 끈다.
// 실행: node --test web/tests/   (pytest 가 tests/test_frontend_js.py 로 감싼다)
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

function build(st, findings) {
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
    doc: { name: "문서.pdf", type: "PDF" }, sections: [], findings: findings, stages: [],
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

function state(over) {
  return Object.assign({
    mode: "single", screen: "results", stageIndex: -1, done: true, reviewed: true,
    sevFilter: { major: true, minor: true, info: true, unreviewed: true },
    checkerFilter: "all", sort: "severity", exportMenuOpen: false, issuesCollapsed: false,
    rev: { startedAt: 0, prepAt: 0, prep: {}, lanes: [], done: {}, note: "" },
    kase: { step: "upload", checked: {}, tab: "summary" },
    cstep: "setup", cstageIndex: -1, cdone: false,
    files: {}, annot: { busy: false, msg: "", numbers: {} },
    viewer: { baseBlob: null, mode: "orig", converting: false, convertError: null },
    marks: null, selected: null, theme: "light", fix: null,
    user: { name: "김검토", team: "ai-test-cert-1" },
    server: { checklists: [], checklist: "", scope_label: "", llm_provider: "local",
              llm_model: "qwen", placeholder_markers: ["TBD"],
              teams: [{ id: "ai-test-cert-1", name: "AI시험인증1팀" }] },
    history: [], detect: null, runChecklistId: "",
    crun: { checklist: null, results: {}, name: "", documentName: "" },
    clib: { list: [], detail: null }, checklist: "",
  }, over || {});
}

// 진짜 지적 둘 + 검토 과정 보고(info) 하나 + 미검토 보고 하나.
const FINDINGS = [
  { id: "f1", checker: "consistency", label: "표현 점검", sev: "major",
    message: "앞뒤 모순", section: "2.1", evidence: [] },
  { id: "f2", checker: "completeness", label: "필수 항목 확인", sev: "minor",
    message: "항목 누락", section: "3", evidence: [] },
  { id: "f3", checker: "consistency", label: "표현 점검", sev: "info",
    message: "인용 대조 실패 2건 제외", evidence: [] },
  { id: "f4", checker: "consistency_doc", label: "문서 전체 점검", sev: "info",
    unreviewed: true, message: "LLM 무응답", evidence: [] },
];

test("비교 단계는 이전 영문 데이터도 한글로 표시하고 실제 진행 순서를 유지한다", () => {
  const views = build(state({ mode: "compare", cstep: "progress", cstageIndex: 1 }), []);
  const labels = ["Ingestion", "Alignment", "Cross-check", "Report"];
  window.DOCREVIEW.compare.stages = labels.map((label) => ({ label, desc: "설명" }));
  const stages = views.renderVals().cpipeline;
  assert.deepEqual(stages.map((s) => s.label), ["문서 읽기", "요건 연결", "문서 간 대조", "결과 정리"]);
  assert.equal(stages[0].done, true);
  assert.equal(stages[1].active, true);
  assert.equal(stages[2].active, false);
  assert.deepEqual(window.DOCREVIEW.compare.stages.map((s) => s.label), labels);
  window.DOCREVIEW.compare.stages = stages.map((s) => ({ label: s.label, desc: s.desc }));
  assert.deepEqual(views.renderVals().cpipeline.map((s) => s.label), stages.map((s) => s.label));
});

test("단일 검토는 준비와 검사 단계 모두 회전하고 완료·중단 때만 멈춘다", () => {
  const st = state({mode:'single',screen:'progress',done:false,stopped:{}});
  st.rev.startedAt=Date.now()-900;
  const views=build(st,[]);
  let html=views.view(views.renderVals());
  assert.match(html,/data-progress-phase="preparing"/);
  assert.match(html,/progress-status-mark is-loading/);
  st.rev.lanes=[{kind:'rule',label:'규칙 검사',total:10}];
  st.rev.active='규칙 검사';
  html=views.view(views.renderVals());
  assert.match(html,/data-progress-phase="reviewing"/);
  assert.match(html,/progress-status-mark is-loading/);
  assert.match(html,/--progress-motion-delay:-\d+ms/);
  st.done=true;
  html=views.view(views.renderVals());
  assert.doesNotMatch(html,/progress-status-mark is-loading/);
  assert.match(html,/data-progress-state-icon="done"/);
  st.done=false;st.stopped.single=true;
  html=views.view(views.renderVals());
  assert.doesNotMatch(html,/progress-status-mark is-loading/);
  assert.match(html,/data-progress-state-icon="stopped"/);
});

test("단일 진행의 파일명은 아이콘과 전문을 표시하고 경과 시간은 중복하지 않는다", () => {
  const name='TEST-DS-005_상세설계서_(S2-1)_검증용_긴_파일명_v1.0.hwpx';
  const st=state({mode:'single',screen:'progress',done:false,files:{single:{name}},stopped:{}});
  st.rev.startedAt=Date.now()-16000;
  const views=build(st,[]);
  for(const ready of [false,true]) {
    st.rev.lanes=ready?[{kind:'rule',label:'규칙 검사',total:10}]:[];
    const html=views.view(views.renderVals());
    assert.match(html,/class="progress-document progress-document-file"/);
    assert.match(html,/class="progress-document-icon" aria-hidden="true"/);
    assert.ok(html.includes('<span class="progress-document-name">'+name+'</span>'));
    assert.match(html,/id="pg-elapsed">[^<]+ 경과<\/strong>/);
    assert.ok(!html.includes('<span>경과 시간</span>'));
  }
});

test("준비 완료와 임시 실행 안내가 별도 행을 추가했다가 제거하지 않는다", () => {
  const st=state({mode:'single',screen:'progress',done:false,stopped:{}});
  const views=build(st,[]);
  st.rev.prep={ingestion:'본문 추출 완료',normalize:'구조 정리 완료',chunking:'검사 단위 준비 완료'};
  let v=views.renderVals(),html=views.view(v);
  assert.match(html,/data-progress-phase="preparing"/);
  assert.ok(!html.includes('class="progress-prep-row'));
  assert.match(views.progressFragments(v).preparation,/문서 준비 완료 · 검사 단계 대기 중/);
  st.rev.lanes=[{kind:'rule',label:'규칙 검사',total:10}];
  st.rev.note='문서의 필수 항목과 작성 기준을 확인하고 있습니다.';
  v=views.renderVals();html=views.view(v);
  assert.match(html,/id="pg-preparation"><div class="progress-prep-row/);
  assert.equal(views.progressFragments(v).note,'');
  assert.equal(views.singleProgressPhase(v.review).sub,st.rev.note);
  assert.equal(html.split(st.rev.note).length-1,1);
  const before=views.progressFragments(v).preparation;
  st.rev.note='';st.rev.done['규칙 검사']=1;
  v=views.renderVals();
  assert.equal(views.progressFragments(v).preparation,before);
  assert.equal(views.progressFragments(v).note,'');
});

test("비교 진행은 상위·하위 문서를 나누고 회전은 완료·중단 때만 끈다", () => {
  const st = state({ mode: "compare", cstep: "progress", compareStartedAt: Date.now() - 900, stopped: {} });
  const views = build(st, []);
  window.DOCREVIEW.compare.docA = { name: "상위_요구사항명세서_긴_파일명.hwp" };
  window.DOCREVIEW.compare.docB = { name: "하위_상세설계서_긴_파일명.hwpx" };
  let html = views.view(views.renderVals());
  assert.match(html, /<dt>상위 문서<\/dt><dd>상위_요구사항명세서_긴_파일명.hwp<\/dd>/);
  assert.match(html, /<dt>하위 문서<\/dt><dd>하위_상세설계서_긴_파일명.hwpx<\/dd>/);
  assert.match(html, /progress-status-mark is-loading/);
  assert.match(html, /--progress-motion-delay:-\d+ms/);
  st.cdone = true;
  html = views.view(views.renderVals());
  assert.doesNotMatch(html, /progress-status-mark is-loading/);
  assert.match(html, /data-progress-state-icon="done"/);
  st.cdone = false; st.stopped.compare = true;
  html = views.view(views.renderVals());
  assert.doesNotMatch(html, /progress-status-mark is-loading/);
  assert.match(html, /data-progress-state-icon="stopped"/);
});

test("비교 근거의 표·문단·후보는 공통 본문 스타일과 동일한 패널 머리말을 쓴다", () => {
  const st = state({ mode: "compare", cstep: "results", crtmOpenKey: "r0", cverdicts: {} });
  const views = build(st, []);
  window.DOCREVIEW.compare.rtm = [{ upper_id: "REQ-001", lower_ids: ["DES-001"], status: "linked",
    text: "요구사항 | 응답 시간은 2초 이내여야 합니다.\n근거 문장은 그대로 유지합니다.",
    child_text: "응답 시간은 2초 이내로 설계합니다.", page: 3, child_page: 9 }];
  let html = views.view(views.renderVals());
  for (const action of ['exportRtmXlsx']) {
    assert.ok(html.includes('type="button" class="btn btn-sm btn-ghost btn-ghost-accent" data-act="' + action + '"'));
  }
  assert.equal((html.match(/class="trace-source-title"/g) || []).length, 2);
  assert.equal((html.match(/class="trace-source-action"/g) || []).length, 2);
  assert.match(html, /class="trace-statement-label">요구사항/);
  assert.match(html, /class="trace-statement-value">응답 시간은 2초 이내여야 합니다\./);
  assert.match(html, /data-arg="A\|r0\|3\|r0"/);
  assert.match(html, /data-arg="B\|r0\|9\|r0"/);
  window.DOCREVIEW.compare.rtm[0] = { upper_id: "REQ-001", lower_ids: [], status: "missing",
    text: "응답 시간은 2초 이내여야 합니다.", probes: [{text:"확인할 하위 서술",page:7,section:"3.1"}] };
  html = views.view(views.renderVals());
  assert.match(html, /같은 번호가 없다/);
  assert.match(html, /class="cand-text">확인할 하위 서술/);
  assert.match(html, /data-arg="B\|pr0-0\|7\|r0"/);
});

test("원본 조회 오류에는 본문 폴백 안내와 다시 불러오기 버튼을 제공한다", () => {
  const s = state();
  s.viewer.originalError = "원본 파일을 불러오지 못했습니다. 저장된 본문을 표시합니다.";
  const views = build(s, FINDINGS);
  const html = views.view(views.renderVals());
  assert.ok(html.includes('class="viewer-source-error" role="alert"'));
  assert.ok(html.includes('data-act="retryOriginal"'));
  assert.ok(html.includes("저장된 본문을 표시합니다"));
});

test("지적 수는 major+minor 만 — info·미검토는 따로 센다", () => {
  const v = build(state(), FINDINGS).renderVals();
  assert.strictEqual(v.issueCount, 2);
  assert.strictEqual(v.infoCount, 1);
  assert.strictEqual(v.unreviewedCount, 1);
  const unrev = v.sevChips.filter((c) => c.sev === "unreviewed")[0];
  assert.ok(unrev, "미검토 칩이 따로 있다");
  assert.strictEqual(unrev.count, 1);
  const info = v.sevChips.filter((c) => c.sev === "info")[0];
  assert.strictEqual(info.count, 1, "info 칩은 미검토를 세지 않는다");
  // 확실(major)/확인 필요(minor)는 화면에서 `지적` 하나로 묶인다(2026-09-14 품질팀).
  assert.deepStrictEqual(v.sevChips.map((c) => c.sev),
    ["all", "issue", "info", "unreviewed"]);
  assert.strictEqual(v.sevChips[1].count, 2, "지적 칩은 major+minor 를 합쳐 센다");
  assert.strictEqual(v.sevChips[0].on, true, "기본값은 전체 보기다");
  assert.ok(v.sevChips.slice(1).every((c) => !c.on),
    "전체 보기인데 개별 버튼까지 모두 선택 표시된다");
});

test("info 칩을 꺼도 미검토 보고는 남는다", () => {
  const st = state({ sevFilter: { major: true, minor: true, info: false, unreviewed: true } });
  const ids = build(st, FINDINGS).renderVals().tableFindings.map((f) => f.id);
  assert.ok(!ids.includes("f3"), "info 지적은 걸러진다");
  assert.ok(ids.includes("f4"), "미검토 보고는 info 칩과 무관하게 남는다");
});

test("미검토 칩은 미검토만 가린다", () => {
  const st = state({ sevFilter: { major: true, minor: true, info: true, unreviewed: false } });
  const ids = build(st, FINDINGS).renderVals().tableFindings.map((f) => f.id);
  assert.ok(ids.includes("f3"));
  assert.ok(!ids.includes("f4"));
});

test("검사기 칩은 내부 이름이 아니라 검토자용 분류로 묶는다", () => {
  const v = build(state(), FINDINGS).renderVals();
  assert.deepStrictEqual(v.checkerChips.map((c) => c.k), ["all", "form", "expr"]);
  assert.deepStrictEqual(v.checkerChips.map((c) => c.label),
    ["전체", "형식 검사", "표현 검사"]);
});

test("분류 필터는 그 분류의 검사기들을 함께 거른다", () => {
  const st = state({ checkerFilter: "expr" });
  const ids = build(st, FINDINGS).renderVals().tableFindings.map((f) => f.id);
  // consistency(f1,f3)와 consistency_doc(f4) 모두 표현 검사다
  assert.deepStrictEqual(ids.sort(), ["f1", "f3", "f4"]);
});

test("긴 문서 근거 대조도 표현 검사 필터에서 확인할 수 있다", () => {
  const findings = [{ id: "evidence1", checker: "consistency_evidence",
    label: "관련 근거 대조", sev: "minor", message: "동일 신호 값 불일치", evidence: [] }];
  const v = build(state({ checkerFilter: "expr" }), findings).renderVals();
  assert.deepStrictEqual(v.tableFindings.map((f) => f.id), ["evidence1"]);
  assert.deepStrictEqual(v.checkerChips.map((c) => c.k), ["all", "expr"]);
});

test("B안은 수정 사항 필터와 한 줄 정렬·검사 셀렉트를 제공한다", () => {
  const views = build(state(), FINDINGS);
  const html = views.view(views.renderVals());
  assert.ok(html.includes('data-result-control="setSort"'), "정렬 선택");
  assert.ok(html.includes('data-result-control="setChecker"'), "검사기 선택");
  assert.match(html, /class="sel sel-sm" id="singleResultSort"/);
  assert.match(html, /class="sel sel-sm" id="singleResultChecker"/);
  assert.match(html, /data-act="selPick" data-arg="singleResultSort\|section"/);
  assert.ok(!/<select[^>]*data-result-control/.test(html), "OS 기본 메뉴를 쓰지 않는다");
  // 확실/확인 필요 보기 버튼은 뺐다 — 묶음이 하나면 "전체"와 같다(2026-09-14).
  assert.ok(!html.includes("수정 사항 보기"), "수정 사항 탭에는 등급 보기 버튼이 없다");
  assert.ok(html.includes('수정 사항<b>2</b>'), "수정 사항만 센다");
  assert.ok(html.includes('검토 상태<b>2</b>'), "보고와 미검토를 별도 탭에서 센다");
  // 미검토는 탭 밖에서 항상 알린다 — 띠 대신 검토 상태 탭의 경고 표식(어느 탭을 보든 탭 줄은 보인다).
  assert.match(html, /id="tab-status" class="single-result-tab[^"]*has-warn"[^>]*title="완료하지 못한 검사 1건"/);
  assert.ok(!html.includes('single-result-warning'), "경고 띠는 뺐다 — 탭 표식과 같은 말이었다");
  assert.ok(!html.includes('data-card="f3"') && !html.includes('data-card="f4"'));
});

test("검토 상태는 수정 사항 필터와 무관하게 모든 보고를 보여준다", () => {
  const views = build(state({reviewTab: "status", checkerFilter: "form",
    sevFilter: {major: true, minor: false, info: false, unreviewed: false}}), FINDINGS);
  const html = views.view(views.renderVals());
  assert.match(html, /인용 대조 실패 2건 제외/);
  assert.match(html, /LLM 무응답/);
  assert.match(html, /single-result-tab-warn/);
  assert.ok(!html.includes('data-card="f1"'));
  assert.ok(!html.includes('data-result-control="setSort"'));
  assert.ok(!html.includes('data-act="suggestFix"'));
});

test("상태 보고가 0건이면 탭과 경고를 숨기고 이전 상태 선택을 정리한다", () => {
  const views = build(state({reviewTab: "status"}), FINDINGS.slice(0, 2));
  assert.equal(views.reviewTabNow(), "findings");
  const html = views.view(views.renderVals());
  assert.ok(!html.includes('id="tab-status"'));
  assert.ok(!html.includes('single-result-tab-warn'));
  assert.ok(html.includes('data-card="f1"'));
});

test("미검토만 있는 결과에서도 수정 사항 0건과 검사 실패를 구별한다", () => {
  const views = build(state(), [FINDINGS[3]]);
  const html = views.view(views.renderVals());
  assert.match(html, /수정 사항<b>0<\/b>/);
  assert.match(html, /has-warn[^>]*title="완료하지 못한 검사/);
  assert.match(html, /확인된 수정 사항이 없습니다/);
  assert.ok(!html.includes('이상 없음'));
});

test("미검토 플래그는 등급과 무관하게 상태 탭으로 분리한다", () => {
  const report = {...FINDINGS[3], sev: "major"};
  const views = build(state(), [FINDINGS[0], report]);
  const html = views.view(views.renderVals());
  assert.ok(html.includes('data-card="f1"'));
  assert.ok(!html.includes('data-card="f4"'));
});

test("탭 전환은 PDF를 보존하는 부분 갱신을 사용한다", () => {
  const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  const body = app.slice(app.indexOf('setReviewTab: function (t) {'), app.indexOf('setCaseTab: function'));
  assert.match(body, /if \(!repaintSingleIssues\(\)\) render\(\)/);
  assert.match(body, /paintMarks\(\)/);
  assert.match(body, /list.scrollTop = 0/);
});

test("빈 필터 결과는 조건 초기화 경로를 제공한다", () => {
  const views = build(state({checkerFilter: "form", sevFilter: {major:true,minor:false,info:false,unreviewed:false}}), FINDINGS);
  const html = views.view(views.renderVals());
  assert.match(html, /data-act="resetResultFilters"/);
  assert.match(html, /single-result-select is-filtered/);
  assert.ok(!html.includes('data-card="f1"'));
  assert.ok(!html.includes('data-card="f2"'));
});

test("단일 결과의 펼친 카드에 읽기용 근거 영역과 펼침 상태를 제공한다", () => {
  const views = build(state({selected:"f1"}), [{...FINDINGS[0], evidence:[{quote:"원문에 있는 문장",section:"2.1"}]}]);
  const html = views.view(views.renderVals());
  assert.match(html, /aria-expanded="true" class="fcard on"/);
  assert.match(html, /class="single-finding-evidence"/);
  assert.match(html, /class="single-evidence-quote"/);
});

test("지적 0건이어도 미검토가 남았으면 이상 없음이라 말하지 않는다", () => {
  const views = build(state(), [FINDINGS[3]]);
  const html = views.view(views.renderVals());
  assert.ok(!html.includes("이상 없음"));
});

test("지적의 기준 라벨에 층(공통/팀별/업로드)이 붙는다", () => {
  const views = build(state(), FINDINGS);
  global.window.DOCREVIEW.checklist = {
    items: [
      { no: "1", text: "용어 일관성", group: "", status: "flagged", layer: "업로드",
        mode: "LLM-조각", note: "", findings: [{ id: "f1" }] },
      { no: "2", text: "오탈자", group: "", status: "flagged", layer: "공통",
        mode: "LLM-조각", note: "", findings: [{ id: "f2" }] },
    ],
    summary: { flagged: 2, clean: 0, unreviewed: 0, na: 0, outofscope: 0,
               noanswer: 0, manual: 0, total: 2 },
  };
  const v = views.renderVals();
  const byId = {};
  v.tableFindings.forEach((f) => { byId[f.id] = f; });
  assert.strictEqual(byId.f1.criteria, "[업로드] 용어 일관성");
  assert.strictEqual(byId.f2.criteria, "[공통] 오탈자");
  // 수정안 프롬프트로 가는 기준 본문에는 층 표기가 섞이지 않는다
  assert.strictEqual(views.criterionTextFor("f1"), "용어 일관성");
  // 항목별 묶음 화면의 항목 헤더에도 층 태그가 산다
  const html = views.view(v);
  assert.ok(html.includes(">업로드</span>"), "층 태그 렌더");
});

test("펼친 카드의 인용마다 자기 형광펜 번호 칩이 붙는다", () => {
  // 같은 절 인용이 둘이면(용어 모순) 번호 없이는 둘째 인용을 문서에서 못 찾는다.
  const findings = [{ id: "f1", checker: "consistency", label: "표현 점검", sev: "major",
    message: "용어 불일치", section: "22.2",
    evidence: [{ quote: "운영권 조정", section: "22.2" },
               { quote: "운영권조정", section: "22.2" }] }];
  const marks = { items: [{ id: "f1", no: "14, 15", page: 1, marks: [],
                            quote_nos: [14, 15] }], pages: {} };
  const views = build(state({ marks, selected: "f1" }), findings);
  const html = views.view(views.renderVals());
  assert.ok(html.includes('data-arg="f1|14"'));
  assert.ok(html.includes('data-arg="f1|15"'), "둘째 인용도 제 번호로 점프");
});

test("완료 뒤 진행 탭에 돌아와도 검토 중이라 말하지 않는다", () => {
  // 완료 처리(api.js)가 done 을 유지한다 — 예전엔 결과 화면으로 넘어가며 false 로
  // 되돌려서, 진행 탭 재방문이 끝난 검토를 "검토 중…"이라고 보여줬다.
  const views = build(state({ screen: "progress", done: true, stageIndex: -1 }), FINDINGS);
  const html = views.view(views.renderVals());
  assert.ok(html.includes("검토 완료"));
  assert.ok(!html.includes("검토 중…"));
});

test("형광펜 번호가 많으면 접힌 카드는 +N 으로 줄인다", () => {
  const many = Array.from({ length: 18 }, (_, i) => String(i + 1)).join(", ");
  const marks = { items: [{ id: "f1", no: many, page: 1, marks: [] }], pages: {} };
  const closed = build(state({ marks }), FINDINGS);
  assert.ok(closed.view(closed.renderVals()).includes(">+13<"), "18개 → 5개 + '+13'");
  const open = build(state({ marks, selected: "f1" }), FINDINGS);
  const html = open.view(open.renderVals());
  assert.ok(!html.includes(">+13<"), "펼치면 전부 보인다");
  assert.ok(html.includes('data-arg="f1|18"'), "마지막 번호까지 누를 수 있다");
});

// ── 검토자가 뺀 지적(2026-09-15 품질팀) ────────────────────────────────────
// 잘못된 지적은 검토자가 빼고, 뺀 것은 목록·건수에서 내리되 한 줄로 남긴다.

test("뺀 지적은 수정 사항에서 내려가고 건수 한 줄로 남는다", () => {
  const views = build(state(), FINDINGS);
  window.DOCREVIEW.dismissed = ["f1"];
  const v = views.renderVals();
  assert.strictEqual(v.issueCount, 1, "뺀 것은 지적으로 안 센다");
  assert.strictEqual(v.dismissedCount, 1);
  const html = views.view(v);
  assert.ok(html.includes('검토자가 제외한 지적 <b>1건</b>'), "건수 한 줄");
  assert.ok(!html.includes('data-card="f1"'), "접힌 상태에서는 카드가 없다");
  assert.ok(html.includes('data-act="dismissFinding" data-arg="f2"'), "남은 카드엔 '지적 아님' 단추");
});

test("펼치면 뺀 카드가 되돌리기 단추와 함께 보인다", () => {
  const views = build(state({ showDismissed: true }), FINDINGS);
  window.DOCREVIEW.dismissed = ["f1"];
  const html = views.view(views.renderVals());
  assert.ok(html.includes('data-card="f1"'));
  assert.ok(html.includes('data-act="restoreFinding" data-arg="f1"'));
  assert.ok(!html.includes('data-act="dismissFinding" data-arg="f1"'));
});

test("자리를 확정 못 한 지적을 펼치면 후보 ‹ › 이동 줄이 보인다", () => {
  const views = build(state({ selected: "f1", cand: { id: "f1", idx: 1,
    list: [{ page: 1, rect: [0, 0, 1, 1] }, { page: 3, rect: [0, 0, 1, 1] }, { page: 5, rect: [0, 0, 1, 1] }] } }), FINDINGS);
  const html = views.view(views.renderVals());
  assert.ok(html.includes('data-act="candStep" data-arg="-1"'));
  assert.ok(html.includes('같은 문장 <b>2/3</b> 곳'));
});

test("형광펜을 못 얹은 인용은 번호 대신 이유 칩을 단다", () => {
  const F = [{ id: "f1", checker: "consistency", label: "표현 점검", sev: "major", message: "m", section: "17",
    evidence: [{ quote: "있는 문장" }, { quote: "겹치는 문장" }, { quote: "없는 문장" }] }];
  const views = build(state({ selected: "f1",
    marks: { items: [{ id: "f1", no: "4", marks: [{ page: 1, rect: [0, 0, 1, 1], no: 4 }], quote_nos: [4, null, null] }],
             unlocated: [{ id: "f1", quote: "겹치는 문장", reason: "같은 인용이 여러 위치에 있어 원문 위치를 확정하지 못했습니다.",
                           pages: [2, 5], candidates: [{ page: 2, rect: [0, 0, 1, 1] }, { page: 5, rect: [0, 0, 1, 1] }] },
                         { id: "f1", quote: "없는 문장", reason: "이 인용을 PDF 본문에서 찾지 못했습니다.", pages: [], candidates: [] }] } }), F);
  const html = views.view(views.renderVals());
  assert.ok(html.includes('data-act="goUnlocated" data-arg="f1"'));
  assert.ok(html.includes('>후보 2곳</span>'), "여러 곳이면 후보 수");
  assert.ok(html.includes('>위치 못 찾음</span>'), "못 찾았으면 그렇다고");
  assert.ok(html.includes('title="이 인용을 PDF 본문에서 찾지 못했습니다."'), "이유는 툴팁으로");
});

// ── 시작 화면의 문서 종류(2026-09-15 품질팀 "돌리기 전에 형식을 추가") ──────────
test("문서 종류를 못 가렸으면 시작 화면에 고르는 줄이 보인다", () => {
  const views = build(state({ mode: "single", screen: "upload", files: { single: { name: "작업본.pdf", size: 1 } },
    outputPick: { outputs: [{ key: "SRS" }, { key: "RVVR" }], detected: "", why: "못 가림", key: "" },
    reviewChecklistId: "", clib: { list: [], detail: null }, pipelinePreview: [] }), []);
  const html = views.view(views.renderVals());
  assert.ok(html.includes('id="outputKey"'), "앱 공용 셀렉트");
  assert.ok(html.includes('파일명으로는 종류를 알 수 없습니다'));
  assert.ok(html.includes('data-act="selPick" data-arg="outputKey|RVVR"'));
  assert.ok(!/<select[^>]*outputKey/.test(html), "OS 기본 메뉴를 쓰지 않는다");
});

test("문서 종류를 가렸으면 그 결과를 말하고 목록은 그대로 둔다", () => {
  const views = build(state({ mode: "single", screen: "upload", files: { single: { name: "x_RVVR.pdf", size: 1 } },
    outputPick: { outputs: [{ key: "SRS" }, { key: "RVVR" }], detected: "RVVR", why: "", key: "" },
    reviewChecklistId: "", clib: { list: [], detail: null }, pipelinePreview: [] }), []);
  const html = views.view(views.renderVals());
  assert.ok(html.includes('파일명으로 보아 <b>RVVR</b> 입니다'));
  assert.ok(html.includes('파일명대로 (RVVR)'));
});

// ── 보통 단일 검토의 "기준 판정" 탭(2026-09-16) ─────────────────────────────
function withCriteria(views, st) {
  window.DOCREVIEW.criteriaResults = {
    items: [
      { no: "1", text: "표지 필수 칸이 있는가", group: "표지", status: "manual", note: "표지를 본다", findings: [] },
      { no: "2", text: "참조문서 형식", group: "참조문서", status: "manual", note: "", findings: [] },
      { no: "3", text: "SDD 전용 기준", group: "설계", status: "na", note: "", findings: [] },
      { no: "4", text: "약어 대조", group: "형식", status: "clean", note: "", findings: [] },
    ],
    summary: { flagged: 0, clean: 1, unreviewed: 0, na: 1, outofscope: 0, noanswer: 0, manual: 2, total: 4 } };
  window.DOCREVIEW.checklist = null;
  return views.view(views.renderVals());
}

test("팀 기준 판정은 별도 탭이고 숫자는 사람 확인 항목 수다", () => {
  const views = build(state(), FINDINGS);
  const html = withCriteria(views, state());
  assert.ok(html.includes('data-act="setReviewTab" data-arg="criteria"'));
  assert.ok(html.includes('기준 판정<b>2</b>'), "탭 숫자는 사람 확인 2");
  assert.ok(!html.includes("표지 필수 칸이 있는가"), "기본 탭(수정 사항)에는 판정 목록이 안 보인다");
});

test("기준 판정 탭은 사람 확인만 펼치고 나머지는 건수로 접는다", () => {
  const views = build(state({ reviewTab: "criteria" }), FINDINGS);
  const html = withCriteria(views, state());
  assert.ok(html.includes("표지 필수 칸이 있는가") && html.includes("참조문서 형식"), "사람 확인 항목은 펼쳐 있다");
  assert.ok(html.includes('class="criteria-group-head">표지<'), "group 소제목");
  assert.ok(!html.includes("SDD 전용 기준") && !html.includes("약어 대조"), "해당 없음·이상 없음은 접혀 있다");
  assert.ok(html.includes('data-act="toggleCriteriaSection" data-arg="na"'));
  assert.ok(/해당 없음<\/b><span class="criteria-section-count pill pill-neutral">1</.test(html));
});

test("체크리스트 검토에서는 기준 판정 탭을 따로 만들지 않는다", () => {
  const views = build(state(), FINDINGS);
  window.DOCREVIEW.criteriaResults = { items: [], summary: { manual: 0, total: 0 } };
  window.DOCREVIEW.checklist = { items: [], summary: { flagged: 0, clean: 0, unreviewed: 0, na: 0, outofscope: 0, noanswer: 0, manual: 0, total: 0 } };
  const html = views.view(views.renderVals());
  assert.ok(!html.includes('data-arg="criteria"'));
});

test("요건 ID 가 필드에 없어도 문장에 있으면 그 요건에 붙는다 — 기준 판정 탭으로 새지 않는다", () => {
  const st = state({ mode: "compare", cstep: "results", crtmOpenKey: "r0", cverdicts: {} });
  const views = build(st, []);
  window.DOCREVIEW.compare.rtm = [{ upper_id: "REQ-001", lower_ids: [], status: "missing", text: "응답 시간" },
                                  { upper_id: "REQ-0010", lower_ids: [], status: "missing", text: "다른 요건" }];
  // 옛 기록: requirement_id 없이 문장에만 ID 가 있다
  window.DOCREVIEW.compare.findings = [
    { id: "c1", type: "missing", sev: "major", message: "하위문서에 누락된 ID: REQ-001", section: "" }];
  let v = views.renderVals();
  assert.equal(v.cmpAdditional, null, "문장의 ID 로 요건에 붙어야 한다");
  // ID 를 아무 데도 안 적은 지적만 남는다
  window.DOCREVIEW.compare.findings = [
    { id: "c2", type: "mismatch", sev: "major", message: "요건 ID 형식이 문서마다 다르다", section: "" }];
  v = views.renderVals();
  assert.equal(v.cmpAdditional && v.cmpAdditional.total, 1);
  const html = views.view(v);
  assert.match(html, /data-act="setCmpTab" data-arg="criteria"[^>]*>기준 판정<b>1</);
});
