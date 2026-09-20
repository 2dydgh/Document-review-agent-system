// 소개 페이지(/intro) — 로그인 없이 보는 한 장. 다섯 절과 들어가는 문 둘(로그인 링크·도움말).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
global.localStorage = { getItem: () => '', setItem: () => {} };   // 로그인 화면이 마지막 이메일을 읽는다

function build(over) {
  const st = Object.assign({
    mode: 'intro', screen: 'upload', stageIndex: -1, done: false, reviewed: false,
    sevFilter: { major: true, minor: true, info: true, unreviewed: true }, checkerFilter: 'all', sort: 'severity',
    rev: { startedAt: 0, prepAt: 0, prep: {}, lanes: [], done: {}, note: '' },
    kase: { step: 'upload', checked: {}, tab: 'summary' }, cstep: 'setup', cstageIndex: -1, cdone: false,
    files: {}, annot: { busy: false, msg: '', numbers: {} },
    viewer: { baseBlob: null, mode: 'orig', converting: false, convertError: null },
    marks: null, selected: null, theme: 'light', user: { name: '검토자', team: 'ax-quality' },
    server: { chat_enabled: true, checklists: [], checklist: '', scope_label: '', llm_provider: 'local',
              llm_model: 'qwen', placeholder_markers: [], teams: [] },
    history: [], historyKind: '', historyQ: '', detect: null,
    crun: { checklist: null, results: {}, name: '', documentName: '' },
    clib: { list: [], detail: null }, checklist: '', homeCriteria: null,
    chat: { sessions: [], current: null, msgs: [], busy: false, error: '', since: 0,
            pendingReview: '', pendingReviewTitle: '' },
  }, over);
  const win = { DR: {}, location: { protocol: 'http:', href: 'http://test/' } };
  for (const file of ['icons.js', 'helpers.js', 'views.js']) {
    new Function('window', fs.readFileSync(path.join(__dirname, '..', file), 'utf8'))(win);
  }
  win.DOCREVIEW = { doc: { name: '문서.pdf', type: 'PDF' }, sections: [], findings: [], stages: [], images: [],
    compare: { stages: [], findings: [], docA: {}, docB: {}, stats: {} }, sevMeta: {}, typeMeta: {} };
  global.window = win;
  const views = win.DR.views({ state: st, props: {}, render: () => {},
    backend: { errorBanner: () => '', ago: () => '2일 전', fmtElapsed: () => '' } });
  return { views, st, html: () => views.view(views.renderVals()) };
}

test('사용자 메뉴의 도움말은 가운데 문서 모달로 뜬다', () => {
  const menu = build({ mode: 'home', profileMenuOpen: true }).html();
  assert.match(menu, /class="menu-item" data-act="openHelp">도움말</);
  const open = build({ mode: 'home', helpOpen: true }).html();
  assert.match(open, /class="help-sheet" role="dialog"[^]*idoc-lead[^]*네 가지 검토[^]*체크리스트 검토[^]*idoc-step-n[^]*DoSuree 에게 물어보기[^]*하지 않는 것[^]*시작하기/);
  assert.match(open, /help-backdrop" data-act="closeHelp"/);
  assert.match(open, /intro-mock-card[^]*pill pill-cat cat-expr/);   // 결과 모양은 진짜 부품으로
  assert.doesNotMatch(open, /intro-tiles|intro-cards|페이지로 열기/);  // 카드 그리드·별도 페이지 없음
  assert.doesNotMatch(build({ mode: 'home', helpOpen: false }).html(), /help-sheet/);
});

test('로그인 화면에는 소개 링크가 없다 — 소개는 로그인 뒤 도움말이 맡는다', () => {
  const html = build({ mode: 'login', user: null }).html();
  assert.doesNotMatch(html, /intro/);
  assert.match(html, /id="loginBtn"/);
});

test('도움말은 사실과 맞는 말만 한다 — 없는 기능·옛 이름을 말하지 않는다', () => {
  const page = build({ mode: 'home', helpOpen: true }).html();
  const open = page.slice(page.indexOf('class="idoc"'), page.indexOf('<dt>문의</dt>'));   // 도움말 본문만 본다
  assert.doesNotMatch(open, /세 가지 검토|문서 비교 검토|스캔한 문서도 읽습니다/);   // 검토는 넷, 메뉴 이름 그대로
  assert.match(open, /HWPX/);                                                       // 실제 accept 목록
  assert.match(open, /30일/);                                                       // 원본 보관 기한
  assert.match(open, /읽기만 합니다/);                                               // DoSuree 경계
  assert.match(open, /idoc-flow[^]*<b>문서<\/b>[^]*<b>DocSuree<\/b>[^]*<b>DoSuree<\/b>[^]*읽기만[^]*<b>검토자<\/b>/, "연결 그림이 없다");
});

test('DoSuree 화면에도 도움말 문이 있고 같은 모달이 뜬다', () => {
  const st = { mode: 'assistant', chat: { sessions: [], current: null, msgs: [], busy: false, error: '', since: 0,
    pendingReview: '', pendingReviewTitle: '' } };
  const closed = build(st).html();
  assert.match(closed, /assistant-help" data-act="openHelp"/);
  assert.doesNotMatch(closed, /help-sheet/);
  const open = build(Object.assign({ helpOpen: true }, st)).html();
  assert.match(open, /class="help-sheet" role="dialog"/);
});

