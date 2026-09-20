const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const records = [
  {id:'a',title:'요구사항 명세서.HWPX',kind:'review',findings:3,at:'2026-09-07'},
  {id:'b',title:'요구사항 설계 비교',kind:'compare',findings:2,at:'2026-09-06'},
  {id:'c',title:'시험 계획서.pdf',kind:'case',findings:0,at:'2026-09-05'},
];
function build(over) {
  const st = Object.assign({
    mode:'history',screen:'upload',stageIndex:-1,done:false,reviewed:false,
    sevFilter:{major:true,minor:true,info:true,unreviewed:true},checkerFilter:'all',sort:'severity',
    rev:{startedAt:0,prepAt:0,prep:{},lanes:[],done:{},note:''},
    kase:{step:'upload',checked:{},tab:'summary'},cstep:'setup',cstageIndex:-1,cdone:false,
    files:{},annot:{busy:false,msg:'',numbers:{}},viewer:{baseBlob:null,mode:'orig',converting:false,convertError:null},
    marks:null,selected:null,theme:'light',user:{name:'검토자',team:'team'},
    server:{checklists:[],checklist:'',scope_label:'',llm_provider:'local',llm_model:'qwen',placeholder_markers:[],teams:[]},
    history:records,historyKind:'',historyQ:'',detect:null,crun:{checklist:null,results:{},name:'',documentName:''},
    clib:{list:[],detail:null},checklist:'',homeCriteria:null,
  },over);
  const win={DR:{},location:{protocol:'http:',href:'http://test/'}};
  for(const file of ['icons.js','helpers.js','views.js'])new Function('window',fs.readFileSync(path.join(__dirname,'..',file),'utf8'))(win);
  win.DOCREVIEW={doc:{name:'문서.pdf',type:'PDF'},sections:[],findings:[],stages:[],images:[],
    compare:{stages:[],findings:[],docA:{},docB:{},stats:{}},sevMeta:{},typeMeta:{}};
  global.window=win;
  const views=win.DR.views({state:st,props:{},render:()=>{},backend:{errorBanner:()=>'',ago:()=> '1일 전',fmtElapsed:()=>''}});
  return views.view(views.renderVals());
}
const rowIds=html=>Array.from(html.matchAll(/class="record-row record-history-grid" data-act="openHistory" data-arg="([^"]+)"/g),m=>m[1]);

test('작업 셀의 빈 공간은 결과로 이동하지 않고 더보기·삭제·행 클릭은 유지한다',()=>{
  const app=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
  const start=app.indexOf('    document.addEventListener("click", function (e) {');
  const end=app.indexOf('\n    document.addEventListener("change"',start);
  let handler;
  const calls=[];
  new Function('document','actions','state','closeHistoryActions','closeSelects',
    'let reasonRenderPending=false;'+app.slice(start,end))(
      {addEventListener:(_,fn)=>{handler=fn}},
      Object.fromEntries(['openHistory','toggleHistoryActions','askDeleteHistory'].map(name=>
        [name,arg=>calls.push([name,arg])])),{},()=>{},()=>{});
  function click(act,inCell){
    const actionEl={tagName:act==='openHistory'?'DIV':'BUTTON',
      getAttribute:key=>key==='data-act'?act:'sample'};
    handler({target:{closest:selector=>selector==='[data-act]'?actionEl:
      selector==='#historyRecords .record-actions'&&inCell?{}:null}});
  }
  click('openHistory',true); // 셀 자체·여백: closest는 부모 행을 반환한다.
  assert.deepEqual(calls,[]);
  click('toggleHistoryActions',true);
  click('askDeleteHistory',true);
  click('openHistory',false);
  assert.deepEqual(calls,[['toggleHistoryActions','sample'],['askDeleteHistory','sample'],['openHistory','sample']]);
  const css=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  assert.match(css,/#historyRecords \.record-row > \.record-actions \{\s*align-self: stretch; cursor: default; background: transparent;/);
  assert.ok(!css.includes(':hover:has(.record-actions:hover) {'));
});

test('비교 기록 삭제는 두 문서와 기록 1건을 구분하고 전체 파일명을 보존한다',()=>{
  const first='SAMPLE-AN-002_요구사항명세서_작성파트_정리_v2.0.hwp';
  const second='SAMPLE-DS-005_상세설계서_예측기술_상세화면_v1.0.pdf';
  const html=build({confirmDelete:{id:'b',kind:'compare',title:first+' ↔ '+second}});
  const content=html.slice(html.indexOf('<div class="history-delete-content">'));
  assert.equal((content.match(/class="history-delete-document"/g)||[]).length,2);
  assert.match(content,/비교 검토 · 기록 1건/);
  assert.match(content,/기준 문서/);assert.match(content,/대조 문서/);
  assert.ok(content.includes(first));assert.ok(content.includes(second));
  assert.ok(!content.includes(first+' ↔ '+second));
  assert.match(content,/삭제한 기록은 복구할 수 없습니다/);
  assert.match(content,/data-act="deleteHistory" data-arg="b"/);
  assert.match(html,/aria-describedby="confirmDescription confirmWarning"/);
});

test('단일·폴더·모호한 비교 제목은 임의 분해하지 않고 안전한 텍스트로 표시한다',()=>{
  for(const kind of ['review','case','compare']) {
    const title='<img src=x onerror=alert(1)> A ↔ B ↔ C';
    const html=build({confirmDelete:{id:'a',kind,title}});
    const content=html.slice(html.indexOf('<div class="history-delete-content">'));
    assert.equal((content.match(/class="history-delete-document"/g)||[]).length,1);
    assert.ok(!content.includes('<img src=x'));
    assert.ok(content.includes('&lt;img'));
    assert.ok(content.includes('A ↔ B ↔ C'));
  }
});

test('일괄 삭제 확인은 파일 두 개처럼 꾸미지 않고 대상 기록 건수와 범위를 표시한다',()=>{
  const html=build({confirmDelete:{id:'*',title:'현재 페이지 기록 3건',all:true,ids:['a','b','c']}});
  assert.match(html,/<div class="history-delete-batch">현재 페이지 기록 3건<\/div>/);
  assert.ok(!html.includes('history-delete-document'));
  assert.match(html,/아래 검토 기록을 모두 삭제할까요/);
  assert.match(html,/data-act="deleteHistory" data-arg="\*"/);
});

test('검토 기록 삭제 진입은 일반 메뉴 항목이고 최종 삭제만 공통 위험 버튼이다',()=>{
  const html=build({confirmDelete:{id:'a',title:'문서'}});
  const openers=html.match(/<button[^>]+data-act="(?:askDeleteHistory|askDeleteAll)"[^>]*>/g);
  assert.ok(openers.length>0);
  for(const button of openers) {
    assert.match(button,/class="menu-item history-menu-delete"/);
    assert.doesNotMatch(button,/btn-primary|btn-danger/);
  }
  assert.match(html,/class="btn btn-lg btn-danger" data-act="deleteHistory"/);
  const css=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  assert.ok(css.includes('width: max-content; min-width: 140px; padding: 4px'));
  assert.ok(!css.includes('.history-actions-menu .btn-primary'));
});

test('기록은 지속 선택 대신 문서별 결과로 이동하는 동작을 표시한다',()=>{
  const html=build();
  assert.ok(!html.includes('history-open-label'));
  assert.ok(!html.includes('history-open-result'));
  assert.match(html,/<span>검토 일시<\/span>/);
  assert.ok(!html.includes('criteriaInspector'));
  assert.ok(!/class="record-row record-history-grid[^\"]*is-selected/.test(html));
  assert.deepEqual(rowIds(html),['a','b','c']);
});

test('결과 열기는 행 클릭으로 통일하고 별도 안내·버튼·탭 정지점을 만들지 않는다',()=>{
  const html=build();
  assert.equal((html.match(/class="record-row record-history-grid" data-act="openHistory"[^>]*tabindex="0" role="button"/g)||[]).length,records.length);
  assert.doesNotMatch(html,/<button[^>]*data-act="openHistory"/);
  assert.ok(!html.includes('검토 결과 열기'));
  const menus=html.match(/<span[^>]*class="history-actions-menu" hidden>[\s\S]*?<\/span>/g)||[];
  assert.equal(menus.length,records.length+1);
  for(const menu of menus) {
    assert.equal((menu.match(/<button /g)||[]).length,1);
    assert.match(menu,/data-act="askDelete(?:History|All)"/);
  }
  assert.ok(!html.includes('결과 보기'));
  assert.match(html,/class="history-more-button"[^>]*data-act="toggleHistoryActions"/);
  assert.match(html,/data-act="askDeleteHistory"/);
  const css=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  assert.ok(!css.includes('.record-row:hover .record-actions > .btn'));
  assert.ok(css.includes(':hover:not(:has(.record-actions:hover)) .record-primary strong'));
  assert.ok(css.includes(':focus-visible .record-primary strong'));
  // 문서명 칸을 낮추고 유형·결과·일시·작업을 넓혔다(2026-09-17) — 폭이 바뀌면 여기도 같이.
  assert.ok(css.includes('minmax(220px, 1fr) 136px 184px 112px 80px'));
});

test('문서명 검색은 대소문자·한글 정규화를 지원하고 검색어를 모두 대조한다',()=>{
  assert.deepEqual(rowIds(build({historyQ:'명세서 hwpx'})),['a']);
  assert.deepEqual(rowIds(build({historyQ:'요구사항'.normalize('NFD')})),['a','b']);
  assert.deepEqual(rowIds(build({historyQ:'   '})),['a','b','c']);
});
test('검색과 검토 유형을 함께 적용하고 0건 유형도 선택지에 남긴다',()=>{
  const html=build({historyQ:'요구사항',historyKind:'compare'});
  assert.deepEqual(rowIds(html),['b']);
  assert.match(html,/폴더 검토 <b>0<\/b>/);
  assert.match(html,/data-arg="compare" aria-pressed="true"/);
});
test('검색 결과가 없으면 초기화 경로를 제공하고 전체 기록 수와 구분한다',()=>{
  const html=build({historyQ:'없는 이름'});
  assert.deepEqual(rowIds(html),[]);
  assert.match(html,/data-act="resetHistoryFilters"/);
  assert.match(html,/불러온 최근 기록 3건에서 검색/);
  assert.match(html,/불러온 기록 3건 삭제/);
});
test('삭제는 닫힌 더보기 안에 있고 검색어는 HTML로 실행되지 않는다',()=>{
  const html=build({historyQ:'"><img src=x onerror=alert(1)>'});
  assert.ok(!html.includes('<img src=x'));
  const base=build();
  assert.match(base,/class="history-actions-menu" hidden/);
  assert.ok(!base.includes('>전체 삭제</button>'));
  assert.match(base,/이 기록 삭제/);
  assert.match(base,/class="history-more-button"/);
});
test('미로딩·실패·빈 목록은 검색 결과 없음과 구분한다',()=>{
  assert.match(build({history:null}),/검토 기록을 불러오는 중/);
  assert.match(build({history:[],historyError:true}),/검토 기록을 불러오지 못했습니다/);
  assert.match(build({history:[]}),/아직 검토한 문서가 없습니다/);
});

test('서버 페이지 결과는 클라이언트 최근 목록으로 다시 거르지 않는다',()=>{
  const html=build({historyQ:'과거',historyPage:{entries:[{id:'old',title:'과거 문서',kind:'review',
    summary:{issues:0,unreviewed:2,info:1}}],offset:100,limit:20,total:101,available_total:150,
    kind_counts:{'':101,review:101},busy:false}});
  assert.deepEqual(rowIds(html),['old']);
  assert.match(html,/전체 보관 기록 150건에서 검색/);
  assert.match(html,/101–101 \/ 101건/);
  assert.match(html,/미검토 2건/);assert.match(html,/과정 보고 1건/);
  assert.match(html,/data-act="setHistoryPage" data-arg="80"/);
  assert.match(html,/data-act="setHistoryPage" data-arg="120" disabled/);
  assert.match(html,/현재 페이지 1건 삭제/);
});

test('체크리스트 미판정은 수정 사항으로 표시하지 않는다',()=>{
  const html=build({history:[{id:'check',title:'서명 점검',kind:'checklist',findings:9,
    summary:{issues:0,unjudged:9,unreviewed:0,info:0}}]});
  assert.match(html,/미판정 9건/);assert.ok(!html.includes('수정 사항 9건'));
});

test('서버 오류는 이전 페이지 행 대신 오류와 재시도를 표시한다',()=>{
  const html=build({historyPage:{entries:records,total:3,available_total:3,error:'503',kind_counts:{}}});
  assert.deepEqual(rowIds(html),[]);assert.match(html,/다시 시도/);
  assert.ok(!html.includes('data-act="askDeleteAll"'));
});

test('폴더 결과의 수정 사항·미검토·과정 보고는 별도 그룹이며 과거 합계를 보정한다',()=>{
  const payload={caseId:'case',team:'team',stats:{findings:3,unreviewed:0},outputs:[],matrix:[],manual:[],
    findings:[{id:'f1',sev:'minor',kind:'output',message:'수정 근거',document:''},
      {id:'f2',sev:'info',kind:'output',message:'진행 기록',document:''},
      {id:'f3',sev:'info',kind:'output',message:'검사 불가',unreviewed:true,document:''}]};
  const html=build({mode:'case',kase:{step:'results',tab:'compare',checked:{},payload}});
  assert.match(html,/수정 사항 1건<\/h3>/);
  assert.match(html,/미검토 1건<\/h3>/);
  assert.match(html,/검토 과정 보고 1건<\/h3>/);
  for(const msg of ['수정 근거','진행 기록','검사 불가'])assert.equal(html.split(msg).length-1,1);
  assert.equal(payload.stats.findings,3); // 저장 원본은 표시 보정으로 바꾸지 않는다.
});

test('검토 기록 목록은 검토자 이름을 보여준다 — 기록이 팀에 공유되므로',()=>{
  const html=build({history:[
    {id:'a',title:'명세서.HWPX',kind:'review',findings:1,at:'2026-09-07',owner:'kim@x.io',by:'김검토'},
    {id:'b',title:'옛 기록.pdf',kind:'review',findings:0,at:'2026-09-06',owner:'',by:''},
  ]});
  assert.match(html,/<small class="record-by">김검토<\/small>/);
  assert.equal((html.match(/record-by/g)||[]).length,1); // 소유자 없는 기록엔 안 그린다
});

test('초안 기록은 단일 검토에 섞이지 않고 제 탭으로 센다',()=>{
  // 서버 페이지가 없을 때의 폴백. evaluation 을 모르는 종류로 두면 단일 검토 필터에
  // 초안이 섞이고 제 탭은 0건으로 뜬다(2026-09-16).
  const recs=[{id:'a',title:'명세서.HWPX',kind:'review',findings:1,at:'2026-09-07'},
    {id:'d',title:'SRS.pdf',kind:'evaluation',findings:0,at:'2026-09-16',
     summary:{issues:0,unreviewed:2,info:0,unfound:0,unjudged:0}}];
  const html=build({history:recs});
  assert.match(html,/체크리스트 검토 <b>1<\/b>/);
  assert.match(html,/단일 검토 <b>1<\/b>/);
  assert.deepEqual(rowIds(build({history:recs,historyKind:'review'})),['a']);
  assert.deepEqual(rowIds(build({history:recs,historyKind:'evaluation'})),['d']);
});

test('초안 기록 라벨은 검토 못 한 건수를 근거 없음보다 먼저 말한다',()=>{
  // "근거 없음 0건"이 보이면 검토자는 다 봤다고 읽는다 — 못 본 것이 있으면 그것부터.
  const one=k=>[{id:'d',title:'SRS.pdf',kind:'evaluation',findings:0,at:'2026-09-16',summary:k}];
  assert.match(build({history:one({issues:0,unreviewed:2,unfound:3,info:0,unjudged:0})}),
    /검토 못 함 2건/);
  assert.match(build({history:one({issues:0,unreviewed:2,unfound:3,info:0,unjudged:0})}),
    /<small>근거 없음 3건<\/small>/);
  assert.match(build({history:one({issues:0,unreviewed:0,unfound:3,info:0,unjudged:0})}),
    /근거 없음 3건/);
  const clean=build({history:one({issues:0,unreviewed:0,unfound:0,info:0,unjudged:0})});
  assert.match(clean,/초안 완료/);
  assert.ok(!clean.includes('근거 없음'));
});

test('종류 필터 줄은 건수 머리를 두지 않고, 0건 종류는 숨기되 전체와 고른 종류는 남긴다', () => {
  // 기록 셋: review·compare·case 하나씩 → 기준 판정·체크리스트 검토는 0건.
  const html = build();
  assert.ok(!html.includes('record-view-name'), '"검토 기록 N" 머리는 옆 탭과 중복이라 뺐다');
  assert.match(html, /data-act="setHistoryKind" data-arg=""/);
  assert.match(html, /data-act="setHistoryKind" data-arg="review"/);
  assert.match(html, /data-act="setHistoryKind" data-arg="case"/);
  assert.doesNotMatch(html, /data-act="setHistoryKind" data-arg="checklist"/);
  assert.doesNotMatch(html, /data-act="setHistoryKind" data-arg="evaluation"/);
  // 0건 종류를 골라 둔 상태(서버 페이지 필터)라면 그 탭은 남는다 — 풀 길이 있어야 한다.
  const picked = build({ historyKind: 'evaluation' });
  assert.match(picked, /data-act="setHistoryKind" data-arg="evaluation"[^>]*aria-pressed="true"/);
});
