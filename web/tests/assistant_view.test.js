// 어시스턴트(A 안 2판) — 메뉴·마스코트·화면은 서버가 켰을 때만, 도구 호출은 사람 말로.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function build(over) {
  const st = Object.assign({
    mode: 'assistant', screen: 'upload', stageIndex: -1, done: false, reviewed: false,
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

test('서버가 안 켰으면 사이드바에도 우하단에도 DoSuree 가 없다', () => {
  const b = build({ mode: 'home', server: { chat_enabled: false, checklists: [], checklist: '', scope_label: '', llm_provider: 'local', llm_model: 'qwen', placeholder_markers: [], teams: [] } });
  const html = b.html();
  assert.doesNotMatch(html, /data-arg="assistant"/);
  assert.doesNotMatch(html, /home-launcher/);               // 얼굴도 없다
});

test('켜져 있으면 사이드바엔 탭이 없고, 마스코트를 누르면 메뉴 없이 바로 대화다', () => {
  const b = build({ mode: 'history' });
  const html = b.html();
  assert.doesNotMatch(html, /data-act="setMode" data-arg="assistant"/);
  assert.match(html, /class="home-launcher" data-act="launcherChat"[^>]*aria-label="DoSuree 와 대화"/);
  assert.doesNotMatch(html, /launcherMenu|launcherGo|toggleLauncher/);   // 메뉴는 없다
});

test('어시스턴트는 DocSuree 껍데기 없이 DoSuree 의 얼굴로 그린다', () => {
  const html = build({}).html();
  assert.match(html, /class="dr-app assistant-app"/);
  assert.match(html, /brand-wordmark" style="font-size:18px;">Do<span style="color:var\(--accent-ink\);">Suree<\/span>/);
  assert.match(html, /data-act="toggleAssistantSide"/);
  assert.match(html, /assistant-head[^]*<button[^>]*assistant-back[^>]*>[^]*DocSuree 로</);   // 나가기는 머리줄 오른쪽(들어온 자리 없음 → 홈)
  assert.doesNotMatch(html, /data-act="setMode" data-arg="history"/);   // DocSuree 사이드바 없음
  assert.doesNotMatch(html, /home-launcher/);                            // 마스코트도 없음
  assert.match(html, /assistant-back[^>]*data-act="assistantBack"/);
  assert.doesNotMatch(html.slice(0, html.indexOf('</aside>')), /assistant-back/);   // 사이드바엔 없다
  assert.doesNotMatch(html, /assistant-mascot/);   // 마스코트는 빈 화면 인사에만
  assert.match(html, /assistant-head-title"><\/div>/);   // 새 대화엔 제목이 없다
});

test('어시스턴트 화면은 목록·문맥 줄·시작 칩을 그린다', () => {
  const b = build({ chat: { sessions: [
      { id: 's1', title: '참조번호 확인', review_id: 'r1', review_title: '명세서.hwpx', updated: 1, missing: false },
      { id: 's2', title: '옛 대화', review_id: '', review_title: '', updated: 1, missing: true },
    ], current: { id: 's1', review_id: 'r1', review_title: '명세서.hwpx' },
    msgs: [{ role: 'user', text: 'q' }, { role: 'assistant', text: 'a', tools: [] }], busy: false, error: '',
    since: 0, pendingReview: '', pendingReviewTitle: '' } });
  const html = b.html();
  assert.match(html, /assistant-item on[^>]*data-arg="s1"/);
  assert.match(html, /assistant-item missing[^>]*data-arg="s2"/);
  assert.match(html, /assistant-chip"[^>]*>[^]*명세서\.hwpx/);
  // 들어온 자리가 이 검토가 아니면 칩 안에 "열기"가 있다(목록에서 옛 대화를 연 경우)
  assert.match(html, /assistant-chip-open[^>]*data-act="openHistory" data-arg="r1"/);
  assert.match(html, /class="dr-app assistant-app"/);
  assert.doesNotMatch(html, /assistant-card/);            // 대화가 있으면 시작 카드는 없다
  assert.match(html, /<textarea id="chatInput"/);
});

test('검토를 안고 왔지만 아직 말 안 했으면 그 사실을 문맥 줄이 말한다', () => {
  const b = build({ chat: { sessions: [], current: null, msgs: [], busy: false, error: '', since: 0,
    pendingReview: 'r9', pendingReviewTitle: '설계서.pdf' } });
  assert.match(b.html(), /설계서\.pdf<\/span><\/span><span class="assistant-ctx-note">첫 말을 보내면/);
});

test('체크리스트 검토를 안고 오면 시작 카드가 초안 행(근거 없음·폐기·다시 찾기) 쪽이다', () => {
  // 초안 기록엔 "지적"이 없다 — 단일 검토 카드("지적 근거 보기")를 그대로 보이면 첫 질문부터 헛돈다.
  const b = build({ chat: { sessions: [], current: null, msgs: [], busy: false, error: '', since: 0,
    pendingReview: 'e1', pendingReviewTitle: '설계서.pdf', pendingReviewKind: 'evaluation' } });
  assert.match(b.html(), /근거 못 찾은 항목/);
  assert.match(b.html(), /다른 말로 다시 찾기/);
  assert.doesNotMatch(b.html(), /지적 근거 보기/);
  const single = build({ chat: { sessions: [], current: null, msgs: [], busy: false, error: '', since: 0,
    pendingReview: 'r1', pendingReviewTitle: '명세서.hwpx', pendingReviewKind: 'review' } });
  assert.match(single.html(), /지적 근거 보기/);
  const pair = build({ chat: { sessions: [], current: null, msgs: [], busy: false, error: '', since: 0,
    pendingReview: 'c1', pendingReviewTitle: '요구.hwp ↔ 설계.hwp', pendingReviewKind: 'compare' } });
  assert.match(pair.html(), /누락 요건 추리기/);
  assert.doesNotMatch(pair.html(), /지적 근거 보기/);
  // 문맥 없이 열면 기록을 가로지르는 질문(자주 나온 지적)이 선다.
  const none = build({ chat: { sessions: [], current: null, msgs: [], busy: false, error: '', since: 0,
    pendingReview: '', pendingReviewTitle: '', pendingReviewKind: '' } });
  assert.match(none.html(), /자주 나온 지적/);
});

test('도구 호출은 이름이 아니라 한 일로, 답은 줄바꿈을 살려 보인다', () => {
  const b = build({});
  const html = b.views.chatLogHtml({ busy: false, msgs: [
    { role: 'user', text: 'major 근거 <보여줘>' },
    { role: 'assistant', text: '한 건입니다.\n근거: "x"', tools: [
      { name: 'mcp__docsuree_get_review', done: true, ok: true },
      { name: 'mcp__docsuree_find_in_document', done: false, ok: true }] },
  ], error: '' });
  assert.match(html, /chat-bubble-user">major 근거 &lt;보여줘&gt;</);
  assert.match(html, /chat-bubble-bot">/);
  assert.match(html, /data-act="chatCopy" data-arg="1"/);
  assert.match(html, /✓ 검토 결과를 읽었습니다/);
  assert.match(html, /… 문서에서 찾았습니다/);
  assert.match(html, /<p>한 건입니다\.<br>근거: &quot;x&quot;<\/p>/);
  assert.match(html, /chat-row-assistant[^]*chat-md/);
  assert.doesNotMatch(html, /mcp__docsuree/);
});

test('결과 화면 옆에는 더 이상 대화 레일이 없다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'views.js'), 'utf8');
  assert.doesNotMatch(src, /chatRail|chatPanelHtml/);
});

test('빈 대화는 인사·시작 카드가 있고, 목록은 날짜로 묶인다', () => {
  const day = 86400;
  const b = build({ chat: { sessions: [
      { id: 'a', title: '오늘 것', review_id: '', review_title: '', updated: Date.now() / 1000 - 60, missing: false },
      { id: 'b', title: '지난주 것', review_id: '', review_title: '', updated: Date.now() / 1000 - 3 * day, missing: false },
      { id: 'c', title: '옛 것', review_id: '', review_title: '', updated: Date.now() / 1000 - 30 * day, missing: false },
    ], current: null, msgs: [], busy: false, error: '', since: 0, pendingReview: '', pendingReviewTitle: '' } });
  const html = b.html();
  assert.match(html, /무엇을 도와드릴까요\?/);
  assert.equal((html.match(/class="assistant-card"/g) || []).length, 4);
  assert.match(html, /assistant-group">오늘<[^]*오늘 것[^]*assistant-group">지난 7일<[^]*지난주 것[^]*assistant-group">이전<[^]*옛 것/);
  assert.match(html, /chat-hello-mascot/);
});

test('같은 도구를 여러 번 부르면 한 줄로 묶고 검색어를 보인다', () => {
  const b = build({});
  const html = b.views.chatLogHtml({ busy: false, msgs: [
    { role: 'user', text: 'q' },
    { role: 'assistant', text: 'a', tools: [
      { name: 'mcp__docsuree_find_in_document', done: true, ok: true, args: { term: '1.4.3.2' } },
      { name: 'mcp__docsuree_find_in_document', done: true, ok: true, args: { term: 'Reference' } },
      { name: 'mcp__docsuree_find_in_document', done: true, ok: true, args: { term: '1.4.3.2' } },
      { name: 'mcp__docsuree_read_section', done: false, ok: true, args: { section_id: '227' } }] },
  ], error: '' });
  assert.equal((html.match(/class="chat-tool"/g) || []).length, 2);
  assert.match(html, /✓ 문서에서 찾았습니다 · ‘1\.4\.3\.2’, ‘Reference’ <span class="chat-tool-n">\(3회\)<\/span>/);
  assert.match(html, /… 절을 읽었습니다 · ‘227’/);
});

test('사이드바를 접으면 목록 대신 레일(펼치기·새 대화·나)이 보인다', () => {
  const b = build({ chat: { sessions: [{ id: 'a', title: '대화', review_id: '', review_title: '', updated: 1, missing: false }],
    current: null, msgs: [], busy: false, error: '', since: 0, pendingReview: '', pendingReviewTitle: '', sideCollapsed: true } });
  const html = b.html();
  assert.match(html, /class="dr-app assistant-app side-collapsed"/);
  assert.match(html, /<div class="assistant-side-full" aria-hidden="true"/);   // 없애지 않고 접는다(애니메이션)
  assert.match(html, /<div class="assistant-rail" aria-hidden="false"[^]*assistant-side-expand[^>]*title="사이드바 펼치기"[^]*data-act="chatNew" title="새 대화"/);
  assert.doesNotMatch(html, /assistant-head[^]*assistant-side-expand/);   // 머리줄엔 펼치기 버튼이 없다
});

test('마스코트 말풍선: 검토 완료 하나만, 결과 보기·물어보기', () => {
  const html = build({ mode: 'history', mascotSay: { id: 'j1', kind: 'review', title: 'SRS.hwp', history_id: 'h1' } }).html();
  assert.match(html, /class="mascot-say" role="status"[^]*<b>SRS\.hwp<\/b> 검토가 끝났어요\./);
  assert.match(html, /data-act="mascotSayOpen">결과 보기</);
  assert.match(html, /data-act="mascotSayAsk">물어보기</);
  assert.match(html, /data-act="mascotSayClose"/);
  // 비교 검토도 어시스턴트가 읽는다(2026-09-16) — 물어보기 붙음. 폴더 검토는 아직 아니다.
  const cmp = build({ mode: 'history', mascotSay: { id: 'j2', kind: 'compare', title: 'A ↔ B', history_id: 'h2' } }).html();
  assert.match(cmp, /mascotSayAsk/);
  const kase = build({ mode: 'history', mascotSay: { id: 'j3', kind: 'case', title: '폴더', history_id: 'h3' } }).html();
  assert.doesNotMatch(kase, /mascotSayAsk/);
  assert.match(kase, /mascotSayOpen/);
  // 아무 일 없으면(그리고 자기소개도 끝났으면) 말풍선도 없다
  assert.doesNotMatch(build({ mode: 'history', chat: { sessions: [], current: null, msgs: [], busy: false, error: '', since: 0, pendingReview: '', pendingReviewTitle: '', seen: true } }).html(), /class="mascot-say" role="status"/);
});

test('마스코트 자기소개: 처음 한 번만 말풍선, 열어 봤거나 닫았으면 없다', () => {
  const fresh = build({ mode: 'history' }).html();
  assert.match(fresh, /class="mascot-say" role="status"[^]*<b>DoSuree<\/b> 예요/);
  assert.match(fresh, /data-act="mascotIntroClose"/);
  assert.match(fresh, /data-act="launcherChat">대화 시작</);
  assert.doesNotMatch(fresh, /home-launcher-text|home-launcher-label/);   // 이름표는 없다
  const seen = build({ mode: 'history', chat: { sessions: [], current: null, msgs: [], busy: false, error: '', since: 0, pendingReview: '', pendingReviewTitle: '', seen: true } }).html();
  assert.doesNotMatch(seen, /class="mascot-say" role="status"/);               // 말풍선 없음
  assert.match(seen, /<\/button><span class="mascot-say mascot-say-hover"[^>]*>DoSuree 와 대화</);   // 호버용은 버튼 바로 뒤
  // 검토 완료가 있으면 그게 우선이다
  const say = build({ mode: 'history', mascotSay: { id: 'j1', kind: 'review', title: 'SRS.hwp', history_id: 'h1' } }).html();
  assert.doesNotMatch(say, /DoSuree<\/b> 예요/);
  assert.match(say, /검토가 끝났어요/);
});

test('대화를 여는 중이면 인사 대신 불러오는 중이 뜨고 입력창은 잠긴다', () => {
  const html = build({ chat: { sessions: [], current: null, msgs: [], busy: false, error: '', since: 0, opening: true,
    pendingReview: 'r1', pendingReviewTitle: 'SRS.hwp', seen: true } }).html();
  assert.match(html, /chat-opening[^]*<svg[^]*대화를 불러오는 중/);
  assert.doesNotMatch(html, /undefined/);
  assert.doesNotMatch(html, /무엇을 도와드릴까요/);
  assert.match(html, /<textarea id="chatInput"[^>]* disabled>/);
});

test('검토를 안고 온 새 대화는 인사 자리에 문서 이름이 서고 카드도 그 검토 것뿐이다', () => {
  const html = build({ chat: { sessions: [], current: null, msgs: [], busy: false, error: '', since: 0,
    pendingReview: 'r1', pendingReviewTitle: 'PLT56_SYSA_RVVR_Rev05.pdf', seen: true } }).html();
  assert.match(html, /chat-hello-doc[^]*PLT56_SYSA_RVVR_Rev05\.pdf[^]*이 검토에 대해 물어보세요/);
  assert.doesNotMatch(html, /무엇을 도와드릴까요|최근 검토 살펴보기/);
  const plain = build({ chat: { sessions: [], current: null, msgs: [], busy: false, error: '', since: 0,
    pendingReview: '', pendingReviewTitle: '', seen: true } }).html();
  assert.match(plain, /무엇을 도와드릴까요[^]*최근 검토 살펴보기/);
  assert.doesNotMatch(plain, /chat-hello-doc/);
});
