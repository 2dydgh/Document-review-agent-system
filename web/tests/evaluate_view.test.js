// 체크리스트 검토(부록 B 초안) 화면 — 순수 렌더 함수만 Node 로 돌린다.
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
  win.DOCREVIEW = { doc: { name: "SRS.pdf", type: "PDF" }, sections: [], findings: [], stages: [],
    images: [], compare: { stages: [], findings: [], docA: {}, docB: {}, stats: {} },
    sevMeta: {}, typeMeta: {} };
  global.window = win;
  return win.DR.views({ state: st, props: { accent: "#356998" }, render: () => {},
    backend: { errorBanner: (e) => (e ? "<b>" + e + "</b>" : ""), ago: () => "1분 전",
               fmtElapsed: () => "0:03" } });
}

function evalv(over) {
  return Object.assign({ sheets: null, sheetIndex: 0, documentKind: "", error: null,
    busy: false, stage: {}, detail: {}, startedAt: 0, payload: null }, over || {});
}

test("업로드 화면은 문서·체크리스트 두 칸이고 시트가 없으면 시작 버튼이 잠긴다", () => {
  const views = build({ mode: "evaluate", estep: "setup", files: { evalDoc: null, evalSheet: null },
    evalv: evalv(), user: { team: "EV1" }, server: {} });
  const html = views.evaluateSetup({ files: { evalDoc: null, evalSheet: null }, evalv: evalv() });
  assert.ok(html.includes('id="file-evalDoc"') && html.includes('id="file-evalSheet"'));
  assert.ok(html.includes('accept=".xlsx"'));
  // 입력이 갖춰지기 전엔 버튼이 없고(단일·비교 관용구) 무엇이 남았는지 말한다.
  assert.ok(!html.includes('data-act="startEvaluate"') && html.includes("검토 대상 문서를 올리면"));
});

// 시트 고르기는 엑셀처럼 — 고른 시트의 앞 행이 격자로, 시트들은 하단 탭으로(2026-09-17).
// 격자는 올린 파일의 원본 셀 그대로(서버가 앞 8행×8열을 잘라 준다) — 정리한 열이 아니다.
const SHEETS = [
  { index: 0, label: "B-1 (요건BTP)", item_count: 46, documents: [], error: "",
    rows: [["문서 검토(요건 단계)", "", "", "Rev.06"],
           ["Characteristic", "Detail Characteristic", "ID", "Evaluation Item"],
           ["Functional Characteristic", "Accuracy", "VR01-01", "Accuracy requirements should be provided."]] },
  { index: 1, label: "NUREG", item_count: 0, documents: [], error: "없는 열 Evaluation Item",
    rows: [["Rules", "Guideline"], ["2.1", "Avoid goto."]] },
];

test("시트 탭과 고른 시트의 원본 셀 격자를 열 글자·행 번호와 함께 보여준다", () => {
  const views = build({ mode: "evaluate", estep: "setup", files: {}, evalv: evalv() });
  const ev = evalv({ sheets: SHEETS, sheetIndex: 0 });
  // 실제 뷰모델은 anim 을 늘 갖는다(버튼 등장 애니메이션 readyAnim 이 읽는다).
  const html = views.evaluateSetup({ files: { evalDoc: { name: "SRS.pdf" }, evalSheet: { name: "chk.xlsx" } }, evalv: ev,
    anim: { readyEntered: false } });
  assert.ok(html.includes('role="tablist"'));
  assert.ok(/data-act="setEvalSheet" data-arg="0"[^>]*aria-selected="true"/.test(html));
  assert.ok(/data-act="setEvalSheet" data-arg="1"[^>]*aria-disabled="true"/.test(html));
  assert.ok(html.includes('title="46개 항목"') && html.includes("없는 열 Evaluation Item"));
  // 엑셀 첫 화면: 열 글자 A~D, 행 번호, 제목 행·병합 빈 칸까지 원본 그대로
  assert.ok(html.includes('<table class="sheet-peek">'));
  assert.ok(html.includes("<th>A</th>") && html.includes("<th>D</th>") && !html.includes("<th>E</th>"));
  assert.ok(html.includes("문서 검토(요건 단계)") && html.includes("Rev.06"));
  assert.ok(html.includes('class="sheet-peek-blank"'));
  assert.ok(html.includes("VR01-01") && html.includes("Accuracy requirements should be provided."));
  assert.ok(html.includes("46개 항목"));
  assert.ok(/class="btn btn-lg btn-primary" data-act="startEvaluate"/.test(html));
});

test("시트를 읽는 동안은 같은 통 모양의 뼈대와 돌아가는 표시가 뜨고 시작이 잠긴다", () => {
  const views = build({ mode: "evaluate", estep: "setup", files: {}, evalv: evalv() });
  const html = views.evaluateSetup({ files: { evalDoc: null, evalSheet: { name: "chk.xlsx" } }, evalv: evalv({ busy: true, sheets: null }) });
  assert.ok(html.includes('class="sheet-book is-busy"') && html.includes("시트를 읽는 중"));
  assert.ok(html.includes('id="eval-sheets-elapsed"') && html.includes('class="sheet-tab is-skel"'));
  assert.ok(!html.includes('data-act="startEvaluate"'));
});

test("읽을 수 없는 시트도 원본 격자는 보여주되 이유 띠를 달고 시작을 잠근다", () => {
  const views = build({ mode: "evaluate", estep: "setup", files: {}, evalv: evalv() });
  const ev = evalv({ sheets: SHEETS, sheetIndex: 1 });
  const html = views.evaluateSetup({ files: { evalDoc: { name: "SRS.pdf" }, evalSheet: { name: "chk.xlsx" } }, evalv: ev });
  assert.ok(html.includes("읽을 수 없음 — 없는 열 Evaluation Item"));
  assert.ok(html.includes('<table class="sheet-peek">') && html.includes("Avoid goto."));
  assert.ok(!html.includes('data-act="startEvaluate"') && html.includes("읽을 수 있는 시트를 고르면"));
});

test("Documents 열이 있는 시트를 고르면 문서 종류 선택이 뜬다", () => {
  const views = build({ mode: "evaluate", estep: "setup", files: {}, evalv: evalv() });
  const ev = evalv({ sheets: [{ index: 0, label: "A-1", item_count: 90, documents: ["SMP", "SVVP"], error: "" }] });
  const html = views.evaluateSetup({ files: { evalDoc: { name: "SMP.pdf" }, evalSheet: { name: "chk.xlsx" } }, evalv: ev });
  // 앱 공용 셀렉트(selectField)를 쓴다 — 고른 값은 selPick 이 evalDocKind 분기로
  // state 에 넣는다(app.js). 화면에는 select id 와 후보가 떠야 한다.
  assert.ok(html.includes('id="evalDocKind"') && html.includes("SVVP"));
  assert.ok(!html.includes('data-act="startEvaluate"') && html.includes("문서 종류를 고르면"), "문서 종류를 고르기 전에는 버튼이 없다");
});

test("진행 화면은 단계 셋과 항목 진행을 보여준다", () => {
  const views = build({ mode: "evaluate", estep: "progress", files: {}, evalv: evalv() });
  const html = views.evaluateProgress({ evalv: evalv({ stage: { ingestion: "done", draft: "running" },
    detail: { draft: "항목 12/46" }, startedAt: 1 }), elapsed: "0:03" });
  assert.ok(html.includes("문서 파싱") && html.includes("작성중") && html.includes("마무리"));
  assert.ok(html.includes("항목 12/46"));
  assert.ok(html.includes('data-act="cancelEvaluate"'));
  // 단일·비교 검토와 같은 진행 틀 — 머리말·단계 목록·설정 접힘.
  assert.ok(html.includes('class="progress-summary') && html.includes('class="progress-stage-list"') &&
            html.includes('progress-settings-disclosure') && html.includes('id="eval-elapsed"'));
  assert.ok(html.includes('class="progress-stage-row is-done"') && html.includes('class="progress-stage-row is-active"'));
  // 작성중 종이: 온 행은 진짜 초안(항목 문장·판정 알약·문장)으로, 안 온 행은 뼈대로.
  assert.ok(html.includes('id="eval-draft-paper"') && html.includes('id="eval-draft-rows"'));
  assert.ok(html.includes('class="draft-row is-todo"'));
  assert.ok(/id="eval-progress-bar" style="width:26%"/.test(html));
  assert.ok(html.includes("12 / 46 항목"));
  // 종이는 작성중 단계 행 바로 아래에 붙는다(그 단계의 상세).
  assert.ok(html.indexOf("작성중") < html.indexOf('id="eval-draft-paper"') && html.indexOf('id="eval-draft-paper"') < html.indexOf("마무리"));
  // 캐릭터는 없다(연출처럼 보여 뺐다). 방금 쓴 항목 캡션 자리만 있다.
  assert.ok(!html.includes("scene-mascot") && html.includes('id="eval-type-bubble"'));
});

test("작성중 종이는 서버가 보낸 행을 항목 순서로 놓고 판정 알약을 찍는다", () => {
  const views = build({ mode: "evaluate", estep: "progress", files: {}, evalv: evalv() });
  const written = [
    { i: 1, id: "VR01-02", item: "Accuracy stated numerically.", status: "not_found", verdict: "Not found",
      comment: "떠올린 말이 문서에 없습니다", sections: [] },
    { i: 0, id: "VR01-01", item: "Accuracy requirements should be provided.", status: "drafted", verdict: "Satisfied",
      comment: "Section 3.2.4 provides accuracy requirements.", sections: ["3.2.4 Accuracy"] },
  ];
  const html = views.evaluateProgress({ evalv: evalv({ stage: { ingestion: "done", draft: "running" },
    detail: { draft: "항목 2/46" }, written, startedAt: 1 }), elapsed: "0:03" });
  // 전체 렌더는 온 행을 다 쓴 채로(타자는 patch 때만) — 두 행 다 is-done, 알약 보임
  const r0 = html.indexOf('data-row="0"'), r1 = html.indexOf('data-row="1"'), r2 = html.indexOf('data-row="2"');
  assert.ok(r0 > -1 && r1 > r0 && r2 > r1, "항목 순서로 놓인다");
  assert.ok(html.includes("Accuracy requirements should be provided.") && html.includes("Section 3.2.4 provides"));
  assert.ok(html.includes("제안 Satisfied") && html.includes("근거 없음"));
  assert.ok(!html.includes('class="draft-row is-now"'));
  assert.ok(html.includes('class="draft-row is-todo" data-row="2"'));
});

test("파싱 중에는 단일 검토와 같은 진행 틀만 있고 종이·그림은 없다", () => {
  const views = build({ mode: "evaluate", estep: "progress", files: {}, evalv: evalv() });
  const html = views.evaluateProgress({ evalv: evalv({ stage: { ingestion: "running" }, detail: {}, startedAt: 1 }), files: {}, elapsed: "0:01" });
  assert.ok(html.includes("문서를 읽고 있습니다") && html.includes('class="progress-stage-list"'));
  // 읽는 동안은 단일 검토와 같은 좁고 가운데인 카드 — 단계 목록은 CSS 가 감춘다.
  assert.ok(html.includes('data-progress-phase="preparing"'));
  assert.ok(!html.includes("scan-doc") && !html.includes('id="eval-draft-paper"') && !html.includes("eval-scene"));
});

test("결과 화면은 부록 B 와 같은 여섯 열의 표다", () => {
  const views = build({ mode: "evaluate", estep: "results", files: {}, evalv: evalv(),
    viewer: { mode: "orig" }, annot: {}, selected: null });
  const payload = {
    doc: { name: "SRS.pdf", type: "PDF" }, sheet: "B-1 (요건BTP)", unfound: 1, unreviewed: 0, llm_failures: 0,
    history: { saved: true, id: "h1" },
    items: [
      { id: "VR01-01", raw_id: "", item: "Accuracy requirements should be provided.", characteristic: "Functional", detail: "Accuracy" },
      { id: "VR01-02", raw_id: "", item: "Accuracy stated numerically.", characteristic: "Functional", detail: "Accuracy" },
    ],
    rows: [
      { item_id: "VR01-01", verdict_hint: "Satisfied", status: "drafted", comment: "Section 3.2.4 provides accuracy.",
        sections: ["3.2.4 Accuracy"], quotes: [{ quote: "The accuracy shall be within 1%.", page: 12, section: "s1" }], reason: "", words: [] },
      { item_id: "VR01-02", verdict_hint: "Not found", status: "not_found", comment: "", sections: [], quotes: [], reason: "떠올린 말이 문서에 없습니다", words: ["zebra"] },
    ],
  };
  const html = views.evaluateResults({ evalv: evalv({ payload }), doc: payload.doc, sections: [],
    viewerKind: "PDF", hasOrigFile: false, isPdf: true, viewer: { mode: "orig" }, annot: {}, files: {} });
  // 결과물이 부록 B 표(엑셀)다 — 화면도 같은 열로 둬야 둘을 맞춰 본다.
  // ANR No./Status 는 검토자 몫이라 화면에 두지 않는다.
  assert.ok(html.includes("<table"), "카드 목록이 아니라 표여야 한다");
  for (const col of ["Classification", "Detail Characteristic", "ID",
                     "Evaluation Item", "Evaluation result and Comment", "쪽"]) {
    assert.ok(html.includes(">" + col + "<"), `열 머리글 ${col} 가 없다`);
  }
  assert.ok(!html.includes("ANR No.") && !html.includes(">Status<"), "검토자 몫의 열을 화면에 두지 않는다");
  assert.ok(html.includes("제안: Satisfied") && html.includes("3.2.4 Accuracy"));
  // 엑셀처럼 같은 분류는 첫 행에만 쓴다(병합 셀 느낌).
  assert.strictEqual(html.split("Functional").length - 1, 1, "같은 분류를 행마다 되풀이한다");
  assert.ok(html.includes("Accuracy requirements") && html.includes("Accuracy stated numerically"),
            "항목 원문은 행마다 그대로 있어야 한다");
  // 원문은 셀 안 버튼이 연다 — 표에서 행 전체를 누르게 두지 않는다.
  // 쪽수 버튼: arg 는 "E|항목순번|쪽"(첫 항목 = 0). 열은 "쪽". 머리의 원문 버튼은 비교 검토와 같은 옷.
  assert.ok(/<button[^>]*class="lnk" data-act="evalRowOriginal" data-arg="E\|0\|12"/.test(html));
  assert.ok(html.includes('<th scope="col">쪽</th>') && !html.includes('<th scope="col">원문</th>'));
  assert.ok(/class="trace-source-action" data-act="openEvalOriginal"[^>]*>원문 ↗<\/button>/.test(html));
  assert.ok(!/<tr[^>]*data-act="evalRowOriginal"/.test(html), "행 전체를 누르게 두지 않는다");
  assert.ok(!html.includes('data-card='), "초안 행이 지적 카드 앵커를 쓴다");
  assert.ok(html.includes("12쪽"), "쪽수를 행에 남겨야 검토자가 찾는다");
  // 근거를 못 찾은 행은 회색 알약과 그 이유를 단다.
  assert.ok(html.includes("근거 못 찾음") && html.includes("떠올린 말이 문서에 없습니다"));
  assert.ok(html.includes("근거를 찾지 못함") && html.includes("검토자 확인 필요"));
  assert.ok(html.includes("근거 없음 1건") && !html.includes("검토 못 함 1건"));
  assert.ok(html.includes('data-act="exportEvaluationXlsx"'));
  // 단일·비교 결과처럼 "새 문서 검토"로 다른 문서를 새로 올리는 길이 머리에 있다.
  assert.ok(html.includes('data-act="newReview" data-arg="evaluate"'));
  assert.ok(html.includes('data-act="openEvalOriginal"'), "원문 보기 버튼이 없다");
  assert.ok(!html.includes("<textarea") && !html.includes('contenteditable'));
  // 화면 안에 문서 뷰어를 박지 않는다(2026-09-16 재설계) — 원문은 새 창이다.
  assert.ok(!html.includes('id="pdf-mount"') && !html.includes('id="doc-scroll"'));
  assert.ok(!html.includes('id="issuesPanel"'), "단일 검토 패널 껍데기를 쓰면 폭이 좁아진다");
});

test("검토하지 못한 항목은 0건 통과로 보이지 않는다", () => {
  const views = build({ mode: "evaluate", estep: "results", files: {}, evalv: evalv(),
    viewer: { mode: "orig" }, annot: {}, selected: null });
  const payload = {
    doc: { name: "SRS.pdf", type: "PDF" }, sheet: "B-1", unfound: 0, unreviewed: 1, llm_failures: 1,
    history: { saved: false },
    items: [{ id: "VR01-01", raw_id: "", item: "x", characteristic: "", detail: "" }],
    rows: [{ item_id: "VR01-01", verdict_hint: "Not found", status: "unreviewed", comment: "",
             sections: [], quotes: [], reason: "LLM 호출 실패: timeout", words: [] }],
  };
  const html = views.evaluateResults({ evalv: evalv({ payload }), doc: payload.doc, sections: [],
    viewerKind: "PDF", hasOrigFile: false, isPdf: true, viewer: { mode: "orig" }, annot: {}, files: {} });
  // "근거 못 찾음"과 "검토 못 함"은 다른 말이다 — 섞으면 0건 통과로 읽힌다.
  assert.ok(html.includes("검토 못 함") && html.includes("LLM 호출 실패: timeout"));
  assert.ok(html.includes("검토하지 못함"), "칸도 같은 말을 해야 한다 — 색만으로 구별하지 않는다");
  assert.ok(!/근거 못 찾음<\/span>[\s\S]{0,80}LLM 호출 실패/.test(html));
  // 머리 알약도 섞지 않는다 — 근거 없음 0건은 여기서 아예 안 뜬다.
  assert.ok(html.includes("검토 못 함 1건") && !html.includes("근거 없음"));
  // 이력에 없으면 엑셀을 못 만든다 — 버튼이 그 사실을 말한다.
  assert.ok(/data-act="exportEvaluationXlsx"[^>]*disabled/.test(html));
});

test("초안에 행이 없는 항목은 누를 수 없다", () => {
  const views = build({ mode: "evaluate", estep: "results", files: {}, evalv: evalv(),
    viewer: { mode: "orig" }, annot: {}, selected: null });
  const payload = {
    doc: { name: "SRS.pdf", type: "PDF" }, sheet: "B-1", unfound: 0, unreviewed: 1, llm_failures: 0,
    history: { saved: true, id: "h1" },
    items: [{ id: "VR01-09", raw_id: "", item: "행이 빠진 항목", characteristic: "", detail: "" }],
    rows: [],
  };
  const html = views.evaluateResults({ evalv: evalv({ payload }), doc: payload.doc, sections: [],
    viewerKind: "PDF", hasOrigFile: false, isPdf: true, viewer: { mode: "orig" }, annot: {}, files: {} });
  assert.ok(html.includes("행이 빠진 항목"), "항목 자체는 표에 남아야 한다");
  assert.ok(html.includes("초안에 이 항목이 없습니다"), "왜 비었는지 말해야 한다");
  assert.ok(html.includes("검토 못 함"), "행이 통째로 빠진 것은 근거 없음이 아니다");
  assert.ok(!html.includes('data-act="evalRowOriginal"'),
            "갈 곳(쪽수) 없는 행을 누를 수 있게 두지 않는다");
});

test("진행 화면의 경과는 1초마다 갈아끼울 자리를 갖는다", () => {
  // 서버는 ingestion 을 한 번 흘리고 파싱이 끝날 때까지(실측 600초) 조용하다.
  // 렌더가 안 오니, 틱이 글자만 갈아끼울 id 가 없으면 숫자가 굳는다.
  const views = build({ mode: "evaluate", estep: "progress", files: {}, evalv: evalv() });
  // 머리말은 단일·비교와 같은 progressHead — 경과는 startedAt 으로 직접 잰다.
  const html = views.evaluateProgress({ evalv: evalv({ startedAt: Date.now() - 3000 }), files: {} });
  assert.ok(html.includes('id="eval-elapsed"'), "틱이 갈아끼울 자리가 없다");
  assert.ok(/id="eval-elapsed">[^<]*경과</.test(html));
  // 시작 전엔 지어낸 형식("0:00")을 쓰지 않는다 — "시작하는 중" 이다.
  const empty = views.evaluateProgress({ evalv: evalv(), files: {} });
  assert.ok(!empty.includes("0:00") && empty.includes("시작하는 중"));
});

test("결과 머리말의 건수는 알약이고 문장 글자에는 색을 안 칠한다", () => {
  const views = build({ mode: "evaluate", estep: "results", files: {}, evalv: evalv(),
    viewer: { mode: "orig" }, annot: {}, selected: null });
  const payload = {
    doc: { name: "SRS.pdf", type: "PDF" }, sheet: "B-1", unfound: 2, unreviewed: 1, llm_failures: 1,
    history: { saved: true, id: "h1" }, items: [], rows: [],
  };
  const html = views.evaluateResults({ evalv: evalv({ payload }), doc: payload.doc, sections: [],
    viewerKind: "PDF", hasOrigFile: false, isPdf: true, viewer: { mode: "orig" }, annot: {}, files: {} });
  const head = html.slice(html.indexOf("평가표 초안</div>"), html.indexOf("판정은 제안입니다") + 900);
  // 색이 실리는 자리는 배경까지 있는 알약뿐이다.
  assert.ok(/background:var\(--sev-min-bg\);padding:4px 10px;border-radius:var\(--r-xl\)/.test(head));
  assert.ok(/background:var\(--sev-maj-bg\)/.test(head), "검토 못 함도 알약이다");
  // 문장에 색만 칠한 span(배경 없는 색 글자)이 남아 있으면 안 된다.
  assert.ok(!/<span style="color:var\(--sev/.test(head));
  assert.ok(head.includes("근거 없음 2건") && head.includes("검토 못 함 1건"));
});

test("이력에 없는 초안은 원문·엑셀 버튼이 둘 다 잠긴다", () => {
  const views = build({ mode: "evaluate", estep: "results", files: {}, evalv: evalv(),
    viewer: { mode: "orig" }, annot: {}, selected: null });
  const payload = { doc: { name: "SRS.pdf", type: "PDF" }, sheet: "B-1", unfound: 0, unreviewed: 0,
    llm_failures: 0, history: { saved: false }, items: [], rows: [] };
  const html = views.evaluateResults({ evalv: evalv({ payload }), doc: payload.doc, sections: [], files: {} });
  assert.ok(/data-act="openEvalOriginal"[^>]*disabled/.test(html));
  assert.ok(/data-act="exportEvaluationXlsx"[^>]*disabled/.test(html));
});

function results(payload) {
  const views = build({ mode: "evaluate", estep: "results", files: {}, evalv: evalv(),
    viewer: { mode: "orig" }, annot: {}, selected: null });
  return views.evaluateResults({ evalv: evalv({ payload }), doc: payload.doc, sections: [], files: {} });
}

test("모델이 알아볼 수 없는 답을 준 항목은 근거 없음이 아니라 검토 못 함이다", () => {
  // reason 문구가 아니라 status 로 가른다 — 문구가 바뀌어도 이 행은 통과로 안 보인다.
  const html = results({ doc: { name: "SRS.pdf" }, sheet: "B-1", unfound: 0, unreviewed: 1,
    llm_failures: 0, history: { saved: true, id: "h1" },
    items: [{ id: "VR01-01", raw_id: "", item: "x", characteristic: "", detail: "" }],
    rows: [{ item_id: "VR01-01", verdict_hint: "Not found", status: "unreviewed", comment: "",
             sections: [], quotes: [], reason: "응답 형식을 알아볼 수 없습니다", words: ["accuracy"] }] });
  assert.ok(html.includes("검토 못 함 1건"), "머리가 검토 못 함으로 센다");
  assert.ok(html.includes("검토하지 못함 — 응답 형식을 알아볼 수 없습니다"));
  assert.ok(!html.includes("근거 없음"), "LLM 실패가 아니어도 근거 없음은 아니다");
});

test("status 가 없는 옛 기록은 Not found 를 검토 못 함으로 읽는다", () => {
  // 그때는 한 값이 둘을 뜻했다 — 통과로 보이게 두지 않는다. 머리 건수도 행을 다시 센다.
  const html = results({ doc: { name: "SRS.pdf" }, sheet: "B-1", unfound: 2, llm_failures: 1,
    history: { saved: true, id: "h1" },
    items: [{ id: "A", raw_id: "", item: "x", characteristic: "", detail: "" },
            { id: "B", raw_id: "", item: "y", characteristic: "", detail: "" }],
    rows: [{ item_id: "A", verdict_hint: "Not found", comment: "", sections: [], quotes: [],
             reason: "떠올린 말이 문서에 없습니다", words: [] },
           { item_id: "B", verdict_hint: "Satisfied", comment: "ok", sections: ["3.2 X"],
             quotes: [], reason: "", words: [] }] });
  assert.ok(html.includes("검토 못 함 1건") && !html.includes("근거 없음"));
  assert.ok(html.includes("제안: Satisfied"), "판정이 있던 행은 그대로 초안이다");
});

test("검토 기록 목록에서 체크리스트 검토는 단일 검토와 다른 글리프(표 격자)를 쓴다", () => {
  const views = build({ mode: "history", files: {}, evalv: evalv() });
  const ev = views.recordShapeIcon ? views.recordShapeIcon("evaluation", "SRS.pdf", 34) : null;
  const single = views.recordShapeIcon ? views.recordShapeIcon("review", "SRS.pdf", 34) : null;
  assert.ok(ev && single, "recordShapeIcon 이 export 돼야 한다");
  assert.notEqual(ev, single);
  // 클립보드 몸통(집게 탭) + 체크 두 단 + 빈 단(줄만). 단일 검토·기준 판정은 접힌 귀 문서
  // 몸통(M4 0h13l11 11…)이고, 이것만 클립보드(M3 5a2…)다.
  const judge = views.recordShapeIcon("checklist", "IS16.pdf", 34);
  assert.ok(ev.includes('d="M3 5a2') && ev.includes('d="M10 1.5h8'), "클립보드 몸통과 집게");
  assert.ok(!ev.includes('d="M4 0h13'), "문서 몸통이 아니다");
  assert.ok((ev.match(/<path d="M7/g) || []).length === 2 && (ev.match(/<line/g) || []).length === 3);
  assert.ok(single.includes('d="M4 0h13') && judge.includes('d="M4 0h13'));
  assert.notEqual(ev, judge);
});

// 단계 전환 연출은 "이 검토를 전에도 그린 적이 있을 때"만 선다. 기록에서 끝난
// 검토를 다시 열면 첫 렌더에 완료 단계가 전부 들어오는데, 거기에 연출이 붙으면
// 체크 넷이 한꺼번에 그어진다 — 그건 "방금 끝났다"가 아니다.
test("끝난 검토를 다시 열면 체크가 그어지지 않는다", () => {
  const views = build({ mode: "evaluate", estep: "progress", files: {}, evalv: evalv() });
  const html = views.evaluateProgress({
    evalv: evalv({ stage: { ingestion: "done", draft: "done", finalize: "done" }, startedAt: 7 }),
    elapsed: "0:03" });
  assert.ok(!html.includes("is-fresh"), "첫 렌더에서 체크가 그어졌다");
  assert.ok(!html.includes("is-settling"));
});

test("검토가 도는 동안 단계가 닫히면 그 단계만 체크를 긋는다", () => {
  const views = build({ mode: "evaluate", estep: "progress", files: {}, evalv: evalv() });
  const running = evalv({ stage: { ingestion: "running" }, startedAt: 7 });
  views.evaluateProgress({ evalv: running, elapsed: "0:01" });   // 같은 검토를 한 번 그렸다

  const after = views.evaluateProgress({
    evalv: evalv({ stage: { ingestion: "done", draft: "running" }, startedAt: 7 }), elapsed: "0:03" });
  assert.equal(after.split("is-fresh").length - 1, 1, "닫힌 단계 하나만 그어야 한다");
  assert.ok(after.includes("is-settling"), "닫히는 행이 눌리지 않는다");
  assert.ok(after.includes("is-opening"), "다음 단계가 열리지 않는다");

  // 같은 상태로 한 번 더 그리면(폴링) 다시 그어지지 않는다.
  const again = views.evaluateProgress({
    evalv: evalv({ stage: { ingestion: "done", draft: "running" }, startedAt: 7 }), elapsed: "0:04" });
  assert.ok(!again.includes("is-fresh"), "폴링마다 체크가 다시 그어진다");
  assert.ok(!again.includes("is-opening"));
});

test("폴더 검토 글리프는 문서 수가 있으면 건수 배지를 달고, 없으면 폴더만이다", () => {
  const views = build({ mode: "history", files: {}, evalv: evalv() });
  const withN = views.recordShapeIcon("case", "SST-26-999", 34, 10);
  const noN = views.recordShapeIcon("case", "SST-26-999", 34, 0);
  assert.ok(withN.includes("<circle") && /<text[^>]*>10<\/text>/.test(withN));
  assert.ok(!noN.includes("<circle") && !noN.includes("<text"));
  assert.ok(/<text[^>]*>99\+<\/text>/.test(views.recordShapeIcon("case", "x", 34, 120)), "세 자리는 99+");
});

// 업로드 화면 아래의 "최근 체크리스트 검토" — 단일·비교·폴더와 같은 자리.
// kind 를 "checklist"(사람이 직접 채우는 다른 기능)로 잘못 걸면 남의 기록이 뜬다.
test("업로드 화면은 이 유형의 최근 검토를 아래에 보여준다", () => {
  const views = build({ mode: "evaluate", estep: "setup", files: {}, evalv: evalv(),
    user: { team: "EV1" }, server: {},
    history: [{ id: "e1", kind: "evaluation", title: "SRS.pdf", at: "2026-09-17" },
              { id: "c1", kind: "checklist",  title: "남의기록.xlsx", at: "2026-09-17" }] });
  const html = views.evaluateSetup({ files: {}, evalv: evalv() });
  assert.match(html, /최근 체크리스트 검토/);
  assert.match(html, /data-arg="e1"/);
  assert.ok(!html.includes("남의기록"), "체크리스트 채우기 기록이 섞여 들어왔다");
});

test("기록이 없으면 빈 껍데기를 내지 않는다", () => {
  const views = build({ mode: "evaluate", estep: "setup", files: {}, evalv: evalv(),
    user: { team: "EV1" }, server: {}, history: [] });
  const html = views.evaluateSetup({ files: {}, evalv: evalv() });
  assert.ok(!html.includes("최근 체크리스트 검토"));
});
