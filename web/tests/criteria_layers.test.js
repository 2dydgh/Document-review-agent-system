// 검토 기준 화면(공통·팀별 층). 항목 줄은 기준 본문 **전문**을 품고, 여닫힘은
// 글자가 아니라 클래스로 말한다 — 예전엔 note 의 첫 줄만 그리고 "펼치기 ▼" 를
// 적어 뒀다. 실행: node --test "web/tests/*.test.js"
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

function views(state) {
  const win = { DR: {}, location: { protocol: "http:", href: "http://x/" } };
  win.DR.ICONS = new Proxy({}, { get: () => "<svg/>" });
  win.DR.helpers = {
    esc: (s) => String(s == null ? "" : s), rgba: () => "", fmtSize: () => "1KB",
    download: () => {}, downloadBlob: () => {}, docSides: () => ({}),
    sentences: (s) => [String(s == null ? "" : s)],
  };
  new Function("window", fs.readFileSync(path.join(__dirname, "..", "views.js"), "utf8"))(win);
  return win.DR.views({
    state: state, props: { accent: "#356998" }, render: () => {},
    backend: { errorBanner: (e) => "<err>" + e + "</err>", ago: () => "", fmtElapsed: () => "" },
  });
}

const NOTE = "1. 본문 내 신호값 추출\n2. 표에 기재된 인터페이스 추출\n3. 그림의 신호 추출";
function layers() {
  return [{
    scope: "팀별", id: "EV1", name: "에너지검증 1팀", editable: false,
    items: [
      { no: "3", text: "일관성 분석 데이터 추출", note: NOTE, group: "신호 데이터 추출",
        agent: "문서작성·생성", source: "EIS문서검증 No.3", mode: "규칙", check: "",
        howChecked: "사람이 확인" },
      { no: "12(팀별)", text: "요건 ID 형식", note: "SRS-XXX-000 형태", group: "형식",
        agent: "형식·완전성", source: "EIS문서검증 No.12", mode: "규칙", check: "req_id",
        howChecked: "규칙 · 자동" },
    ],
  }];
}
function st(over) {
  return { clayers: Object.assign(
    { list: layers(), busy: false, error: null, open: {}, openItem: {}, how: "" }, over || {}) };
}

test("최초 로딩은 장식용 스켈레톤이며 0건이나 빈 목록으로 표시하지 않는다", () => {
  const p = views(st({ list: null, busy: true })).criteriaWorkspaceParts();
  // 불러오는 중에는 숫자 대신 —. 0 을 내면 "기준이 없다"는 거짓말이 된다.
  assert.ok(p.tabs.includes('전체 <b>—</b>'), p.tabs);
  assert.equal((p.records.match(/class="criteria-skeleton-row" aria-hidden="true"/g) || []).length, 7);
  assert.ok(p.records.includes('aria-busy="true"'));
  assert.ok(p.records.includes('검토 기준을 불러오는 중'));
  assert.ok(!p.records.includes('data-act="selectCriterion"'));
  assert.ok(!p.records.includes('등록된 검토 기준이 없습니다'));
  assert.ok(!p.tabs.includes('<b>0</b>'));
});

test("재조회는 기존 행을 유지하며 갱신 문구와 표 본문을 따로 갱신한다", () => {
  const s = st(), v = views(s), loaded = v.criteriaWorkspaceParts();
  s.clayers.busy = true;
  const refreshing = v.criteriaWorkspaceParts();
  assert.equal(refreshing.body, loaded.body);
  assert.ok(refreshing.tabs.includes('전체 <b>2</b>'), refreshing.tabs);
  assert.ok(refreshing.summary.includes('목록 갱신 중'));
  assert.ok(!refreshing.body.includes('criteria-skeleton-row'));
  s.clayers.busy = false; s.clayers.error = '네트워크 오류';
  const failed = v.criteriaWorkspaceParts();
  assert.equal(failed.body, loaded.body);
  assert.ok(failed.summary.includes('이전 목록을 표시합니다'));
  assert.ok(failed.summary.includes('data-act="retryCriteriaCatalog"'));
});

test("최초 실패와 정상적인 빈 목록은 구분한다", () => {
  const s = st({ list: null, error: '응답 오류' }), v = views(s);
  let p = v.criteriaWorkspaceParts();
  assert.ok(p.tabs.includes('전체 <b>—</b>'), p.tabs);
  assert.ok(p.summary.includes('role="alert"'));
  assert.ok(!p.body.includes('등록된 검토 기준이 없습니다'));
  s.clayers.list = []; s.clayers.error = null;
  p = v.criteriaWorkspaceParts();
  assert.ok(p.tabs.includes('전체 <b>0</b>'), p.tabs);
  assert.ok(p.body.includes('등록된 검토 기준이 없습니다'));
});

test("접힌 줄은 제목 한 줄이고, 편 줄은 본문 전문을 품는다", () => {
  const shut = st({ open: { EV1: true } });
  let html = views(shut).criteriaLayersSection(shut);
  assert.ok(html.includes("일관성 분석 데이터 추출"), "제목이 없다");
  assert.ok(!html.includes("2. 표에 기재된 인터페이스 추출"), "접힌 줄에 본문이 있다");
  // 본문이 있는 줄에만 손잡이가 붙는다 — 없는 줄은 그게 전부라는 뜻이다.
  assert.equal(html.split('class="criteria-row-chevron"').length - 1, 2, "손잡이 수가 본문 수와 다르다");

  const open = { clayers: { list: layers(), busy: false, error: null,
                            open: { EV1: true }, openItem: { "EV1|3|0": true }, how: "" } };
  html = views(open).criteriaLayersSection(open);
  assert.ok(html.includes("2. 표에 기재된 인터페이스 추출"), "본문 둘째 줄이 없다");
  assert.ok(html.includes("3. 그림의 신호 추출"), "본문 셋째 줄이 없다");
});

test("층이 접혀 있으면 항목을 안 그린다", () => {
  const s = st();
  const html = views(s).criteriaLayersSection(s);
  assert.ok(!html.includes("일관성 분석 데이터 추출"));
  assert.ok(html.includes('aria-expanded="false"'), "여닫힘 상태를 안 말한다");
});

test("검증 대상은 고정 열에 두고 내부 이름은 안 보인다", () => {
  const open = { clayers: { list: layers(), busy: false, error: null,
                            open: { EV1: true }, openItem: {}, how: "" } };
  const html = views(open).criteriaLayersSection(open);
  // 중간 그룹 띠로 열을 끊지 않고 각 행의 검증 대상 열에 둔다.
  assert.ok(html.includes("<span>검증 대상</span>"));
  assert.ok(html.includes('<span class="record-muted">신호 데이터 추출</span>'));
  assert.ok(html.includes('<span class="record-muted">형식</span>'));
  assert.ok(!html.includes('class="clay-group"'));
  // 출처(요구사항 xlsx 행 번호)·담당 Agent·검사기 이름은 이 화면을 보는 사람의
  // 것이 아니다. 화면에서 뺐고, 값은 yaml 에 그대로 있다.
  assert.ok(!html.includes("EIS문서검증 No.3"), "출처가 아직 화면에 있다");
  assert.ok(!html.includes("문서작성·생성"), "담당 Agent 가 아직 화면에 있다");
  assert.ok(!html.includes("req_id"), "검사기 이름이 아직 화면에 있다");
});

test("검사 방식으로 거르면 층이 저절로 펴진다", () => {
  const s = { clayers: { list: layers(), busy: false, error: null,
                         open: {}, openItem: {}, how: "규칙 · 자동" } };
  const html = views(s).criteriaLayersSection(s);
  assert.ok(html.includes("요건 ID 형식"), "필터를 걸었는데 층이 접힌 채다");
  assert.ok(!html.includes("일관성 분석 데이터 추출"), "안 고른 방식이 남아 있다");
});

test("번호 열은 고정 폭이 아니다 — 층이 겹치면 '12(팀별)' 로 늘어난다", () => {
  const s = { clayers: { list: layers(), busy: false, error: null,
                         open: { EV1: true }, openItem: {}, how: "" } };
  const html = views(s).criteriaLayersSection(s);
  assert.ok(html.includes("12(팀별)"));
  assert.ok(!html.includes("flex:none;width:34px"), "번호 열이 고정 폭이다");
});

test("방식 필터나 검색을 바꿔도 펼친 기준의 식별자는 유지된다", () => {
  for (const filter of [{ how: "규칙 · 자동" }, { q: "요건 ID" }]) {
    const s = st(Object.assign({ openItem: { "EV1|12(팀별)|1": true } }, filter));
    const html = views(s).criteriaLayersSection(s);
    assert.ok(html.includes('data-arg="EV1|12(팀별)|1"'));
    assert.ok(html.includes("SRS-XXX-000 형태"));
  }
});

test("같은 번호의 기준도 필터 뒤에 다른 기준의 열림 상태를 물려받지 않는다", () => {
  const list = layers(); list[0].items[1].no = "3";
  const s = st({ list, how: "규칙 · 자동", openItem: { "EV1|3|0": true } });
  const html = views(s).criteriaLayersSection(s);
  assert.ok(!html.includes("SRS-XXX-000 형태"));
});

test("검색 결과 건수는 함께 선택한 확인 방식까지 적용한 수다", () => {
  const list = layers(); list[0].items.forEach(it => { it.text = "공통 검색어 " + it.text; });
  const s = st({ list, q: "공통 검색어", how: "규칙 · 자동" });
  const html = views(s).criteriaLayersSection(s);
  assert.ok(html.includes("검색 결과 <b>1</b>건"));
});

test("작업대는 공통·팀·추가 항목을 같은 목록에서 찾는다", () => {
  const s = st({ list: layers().concat([{ id: "up1", name: "추가 목록", editable: true,
    scope: "업로드", items: [{ no: "1", text: "서명 확인", note: "날인 확인", howChecked: "사람이 확인" }] }]) });
  const v = views(s);
  assert.equal(v.criteriaCatalogModel().rows.length, 3);
  s.clayers.scope = "추가";
  assert.equal(v.criteriaCatalogModel().shown.length, 1);
  s.clayers.q = "날인";
  assert.equal(v.criteriaCatalogModel().shown.length, 1);
  s.clayers.how = "규칙 · 자동";
  assert.equal(v.criteriaCatalogModel().shown.length, 0);
});

test("필터로 숨긴 기준의 상세가 남지 않고 검색 입력은 갱신 영역 밖에 있다", () => {
  const s = st({ selected: "EV1|0", how: "규칙 · 자동" });
  const v = views(s);
  assert.equal(v.criteriaCatalogModel().selected, null);
  assert.ok(!v.criteriaWorkspaceParts().detail.includes(NOTE));
  const html = v.criteriaWorkspace();
  assert.ok(html.indexOf("data-criteria-q") < html.indexOf('id="criteriaCatalogRecords"'));
  assert.ok(html.includes('id="criteriaInspector"'));
});

test("기준 목록은 기록과 검색·필터 툴바를 공유하고 상세 패널을 유지한다", () => {
  const s=st(),v=views(s),html=v.criteriaWorkspace();
  assert.ok(html.includes('class="record-search criteria-catalog-search"'));
  assert.ok(html.indexOf('data-criteria-q')<html.indexOf('<section class="criteria-workspace'));
  assert.ok(html.includes('class="record-toolbar criteria-workspace-tools"'));
  assert.ok(html.includes('class="record-filters criteria-scope-tabs"'));
  assert.ok(html.includes('class="record-filter is-on" data-act="setCriteriaScope" data-arg=""'));
  // 숫자는 범위 탭만 진다(2026-09-18). 예전엔 「기준 목록 N」이 「전체 N」과
  // 같은 수를 두 번 말했고, 아래 meta 줄까지 치면 세 번이었다.
  assert.ok(html.includes('<div class="record-view-name">기준 목록</div>'));
  assert.ok(!html.includes('criteriaCatalogCount'));
  assert.ok(html.includes('data-arg="" aria-pressed="true">전체 <b>2</b>'));
  assert.ok(html.indexOf('class="criteria-list-meta"')>html.indexOf('</table>'));
  assert.ok(html.includes('id="criteriaInspector"'));
  s.clayers.how='규칙 · 자동';
  const parts=v.criteriaWorkspaceParts();
  // 범위 탭은 "이걸 누르면 몇 개가 남나"를 말한다 — 확인방식·검색이 이미 걸린 채로.
  assert.ok(parts.tabs.includes('전체 <b>1</b>'), parts.tabs);
  assert.ok(parts.records.includes('1개 표시 · 전체 2개'));
});

test("확인 방식은 공통 선택 메뉴를 쓰며 전체와 개별 선택을 명시한다", () => {
  const s = st(), v = views(s);
  let html = v.criteriaWorkspace();
  assert.ok(!html.includes('<select'));
  assert.ok(html.includes('class="sel sel-sm criteria-how-select" id="criteriaHow" data-value="all"'));
  assert.ok(html.includes('aria-label="확인 방식" aria-controls="criteriaHow-options"'));
  assert.ok(html.includes('aria-selected="true" data-act="selPick" data-arg="criteriaHow|all"'));
  s.clayers.how = '사람이 확인';
  html = v.criteriaHowSelect();
  assert.ok(html.includes('aria-selected="true" data-act="selPick" data-arg="criteriaHow|사람이 확인"'));
  assert.equal((html.match(/role="option"/g) || []).length, 5);
});

test("기준 선택은 상세 패널과 연결되고 번호로 목록과 설명을 대조한다", () => {
  const s=st({selected:'EV1|1'}),v=views(s);
  let p=v.criteriaWorkspaceParts();
  assert.ok(p.records.includes('aria-controls="criteriaInspector" aria-pressed="true"'));
  assert.ok(p.records.includes('class="criteria-reference">12(팀별)</span>'));
  assert.ok(p.detail.includes('기준 상세 · 12(팀별)'));
  assert.ok(!p.records.includes('data-act="openHistory"'));
  s.clayers.selected=null;p=v.criteriaWorkspaceParts();
  assert.ok(p.detail.includes('목록에서 확인할 기준을 선택하세요.'));
  assert.ok(p.detail.includes('세부 기준·확인 방법·출처'));
});

test("세부사항이 없는 기준도 선택할 수 있고 원문과 출처를 읽는다", () => {
  const list = layers(); list[0].items[0].note = "";
  const s = st({ list, selected: "EV1|0" });
  const p = views(s).criteriaWorkspaceParts();
  assert.ok(p.records.includes('data-act="selectCriterion"'));
  assert.ok(p.records.includes('<tr data-act="selectCriterion" data-arg="EV1|0"'));
  assert.ok(p.records.includes('<button type="button" class="criteria-title-button"'));
  assert.ok(!p.records.includes('<tr role="button"'), "표 행의 의미를 바꾸지 않는다");
  assert.ok(p.detail.includes("일관성 분석 데이터 추출"));
  assert.ok(p.detail.includes("EIS문서검증 No.3"));
  assert.ok(p.detail.includes("읽기 전용"));
});

test("자동 기준에 근거 없는 준비됨 상태를 붙이지 않는다", () => {
  const s = st({ selected: "EV1|1" });
  const p = views(s).criteriaWorkspaceParts();
  assert.ok(p.detail.includes("실행 시 확인"));
  assert.ok(!p.records.includes("준비됨"));
  assert.ok(!p.detail.includes('data-act="askDeleteChecklist"'));
});

test("추가 기준의 실행·선택·삭제는 해당 항목이 속한 체크리스트를 대상으로 한다", () => {
  const s = st({ list: [{ id: "up", name: "업로드 기준", editable: true,
    scope: "업로드", items: [{ text: "추가 기준", howChecked: "사람이 확인" }] }], selected: "up|0" });
  let p = views(s).criteriaWorkspaceParts();
  assert.ok(p.detail.includes('data-act="startChecklistRun" data-arg="up"'));
  assert.ok(p.detail.includes("추가 기준 전체 삭제"));
  s.checklistPickReturn = true; s.reviewChecklistId = "up";
  p = views(s).criteriaWorkspaceParts();
  assert.ok(p.detail.includes('data-act="selectChecklistForReview" data-arg="up">선택됨'));
});

test("비어 있거나 읽기 실패한 추가 기준 세트도 사라지지 않는다", () => {
  const s = st({ list: [{ id: "bad", name: "못 읽은 기준", editable: true,
    error: "기준 읽기 실패", items: [] }], selected: "bad|0" });
  const p = views(s).criteriaWorkspaceParts();
  assert.ok(p.records.includes("조회 실패"));
  assert.ok(p.detail.includes('data-act="startChecklistRun" data-arg="bad" disabled'));
});
