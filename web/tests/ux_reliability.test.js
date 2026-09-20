const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const app=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
const api=fs.readFileSync(path.join(__dirname,'..','api.js'),'utf8');
function action(name,deps){
  const match=app.match(new RegExp('^    '+name+': function \\(([^)]*)\\) \\{([\\s\\S]*?)\\n    \\},','m'));
  assert.ok(match,name);
  return new Function(...Object.keys(deps),'let viewerFor; return function('+match[1]+'){'+match[2]+'\n};')(...Object.values(deps));
}
function originalLoader(deps){
  const at=app.indexOf('  function pullOriginal(');
  const code=app.slice(at,app.indexOf('\n  }',at)+4);
  return new Function(...Object.keys(deps),code+';return pullOriginal;')(...Object.values(deps));
}
test('삭제 확인은 선택한 기록의 유형과 제목을 보존하며 실제 삭제는 실행하지 않는다',()=>{
  const state={historyPage:{entries:[{id:'pair',kind:'compare',title:'기준.hwp ↔ 대조.pdf'}]},history:[]};
  let renders=0;
  const ask=action('askDeleteHistory',{state,render:()=>renders++,closeHistoryActions:()=>{}});
  ask('pair');
  assert.deepEqual(state.confirmDelete,{id:'pair',kind:'compare',title:'기준.hwp ↔ 대조.pdf'});
  assert.equal(renders,1);
  ask('missing');assert.equal(renders,1);
});
test('기록 조회 HTTP 오류와 잘못된 응답은 빈 목록 성공으로 처리하지 않는다',async()=>{
  for(const res of [{ok:false,status:503},{ok:true,json:async()=>({})},{ok:true,json:async()=>({entries:null})}]){
    const state={mode:'history',history:null};const win={DR:{helpers:{esc:String}},location:{protocol:'http:'}};
    new Function('window','fetch',api)(win,async()=>res);
    const backend=win.DR.backend({state,render:()=>{}});await backend.loadHistory();
    assert.equal(state.historyError,true);assert.deepEqual(state.history,[]);
  }
});
test('정상적인 빈 목록은 조회 실패가 아니다',async()=>{
  const state={mode:'history',history:null};const win={DR:{helpers:{esc:String}},location:{protocol:'http:'}};
  new Function('window','fetch',api)(win,async()=>({ok:true,json:async()=>({entries:[]})}));
  await win.DR.backend({state,render:()=>{}}).loadHistory();assert.equal(state.historyError,false);
});
test('삭제는 HTTP 실패·네트워크 실패를 성공 건수에 섞지 않는다',async()=>{
  const state={history:[{id:'ok'},{id:'http-error'},{id:'network-error'}]};const notices=[];
  const remove=action('deleteHistory',{state,render:()=>{},loadHistory:()=>Promise.resolve(),toast:(...args)=>notices.push(args),
    fetch:async url=>{if(url.endsWith('network-error'))throw new Error('offline');return {ok:url.endsWith('/ok')}}});
  await remove('*');assert.equal(state.hbusy,false);assert.deepEqual(state.history.map(h=>h.id),['http-error','network-error']);
  assert.match(state.herror,/1건 삭제 완료/);assert.match(state.herror,/2건은 삭제를 확인하지 못했습니다/);
  assert.ok(!notices.some(n=>n[0].includes('3건을 삭제했습니다')));
});
test('삭제가 모두 실패하면 성공 안내를 하지 않는다',async()=>{
  const state={history:[{id:'a'}]};const notices=[];
  await action('deleteHistory',{state,render:()=>{},loadHistory:()=>Promise.resolve(),toast:m=>notices.push(m),fetch:async()=>({ok:false})})('a');
  assert.deepEqual(state.history,[{id:'a'}]);assert.match(notices[0],/삭제를 확인하지 못했습니다/);
});
test('페이지 일괄 삭제는 확인받은 ID만 삭제하고 바뀐 페이지는 건드리지 않는다',async()=>{
  const state={history:[{id:'home'}],historyPage:{entries:[{id:'a'},{id:'b'}]}};
  action('askDeleteAll',{state,render:()=>{},closeHistoryActions:()=>{}})();
  assert.equal(state.confirmDelete.title,'현재 페이지 기록 2건');
  state.historyPage.entries=[{id:'new-page'}];const urls=[];
  await action('deleteHistory',{state,render:()=>{},loadHistory:()=>Promise.resolve(),toast:()=>{},
    fetch:async url=>{urls.push(url);return {ok:true}}})('*');
  assert.deepEqual(urls,['api/history/a','api/history/b']);
  assert.deepEqual(state.history,[{id:'home'}]);
});
test('찾을 수 없는 근거 번호를 눌러도 첫 근거로 잘못 이동하지 않는다',()=>{
  const moves=[],notices=[];const state={marks:{items:[{id:'f1',marks:[{no:1,page:5,rect:[1,2,3,4]}]}]}};
  const go=action('goMark',{state,toast:m=>notices.push(m),window:{DR:{pdfview:{highlight:()=>{},goTo:(...args)=>moves.push(args)}}}});
  go('f1|99');assert.equal(moves.length,0);assert.equal(notices.length,1);
  go('f1|1');assert.equal(moves[0][0],5);
});
test('이전 원본 요청이 늦게 실패해도 새 문서의 로딩 상태를 바꾸지 않는다',async()=>{
  let reject;const oldDoc={name:'old.pdf'},newDoc={name:'new.pdf'};
  const state={mode:'single',screen:'results',viewer:{loadingOrig:true},files:{}};
  const win={DOCREVIEW:{doc:oldDoc}};let renders=0;
  const load=originalLoader({state,window:win,fetch:()=>new Promise((_,r)=>{reject=r}),render:()=>renders++,File:class{}});
  const task=load('old','old.pdf',oldDoc);state.viewer={loadingOrig:true};win.DOCREVIEW.doc=newDoc;reject(new Error('offline'));await task;
  assert.equal(state.viewer.loadingOrig,true);assert.equal(state.viewer.originalError,undefined);assert.equal(renders,0);
});
// 404 는 예전엔 조용히 텍스트 재현본으로 떨어졌다. 결과는 멀쩡한데 원문만 텍스트라
// "PDF 변환이 깨졌다"는 보고가 올라왔다(2026-09-08) — 둘 다 사실을 말하되, 다시 해도
// 없는 404 에만 재시도를 빼는 것으로 바꿨다.
test('원본 404와 서버 장애를 둘 다 말하되 404 에는 재시도를 권하지 않는다',async()=>{
  for(const status of [404,503]){
    const doc={name:'a.pdf'},state={mode:'single',screen:'results',viewer:{loadingOrig:true},files:{}};
    await originalLoader({state,window:{DOCREVIEW:{doc}},fetch:async()=>({ok:false,status}),render:()=>{},File:class{}})('a','a.pdf',doc);
    assert.equal(state.viewer.loadingOrig,false);
    assert.ok(state.viewer.originalError,`${status} 를 조용히 넘긴다`);
    assert.equal(Boolean(state.viewer.originalGone),status===404);
  }
});
test('단일 기록을 열 때 이전 문서의 계보·저장 대상·필터를 지운다',async()=>{
  const record={id:'new-history',kind:'review',payload:{doc:{name:'new.pdf'},findings:[],stages:[]}};
  const state={mode:'history',viewer:{},annot:{},files:{},reviewTab:'status',sevFilter:{major:false},checkerFilter:'expr',marks:{items:[{id:'old'}]}};
  const win={DOCREVIEW:{lineage:{old:true},lineageCandidate:{old:true},historyId:'old-history',images:[{old:true}]}};
  const pulled=[];
  const open=action('openHistory',{state,window:win,render:()=>{},clearTimers:()=>{},fetch:async()=>({ok:true,json:async()=>record}),
    pullOriginal:(...args)=>pulled.push(args),errMessage:String,URL:{revokeObjectURL:()=>{}}});
  open('new-history');await new Promise(r=>setImmediate(r));
  assert.equal(win.DOCREVIEW.historyId,'new-history');assert.equal(win.DOCREVIEW.lineage,null);assert.deepEqual(win.DOCREVIEW.images,[]);
  assert.equal(state.reviewTab,null);assert.equal(state.checkerFilter,'all');assert.equal(state.sevFilter.major,true);assert.equal(state.marks,null);
  assert.equal(pulled[0][0],'new-history');
});

test('원본 재시도는 현재 기록을 대상으로 하고 중복 요청을 막는다',async()=>{
  const doc={name:'new.pdf'},state={viewer:{loadingOrig:false,originalError:'failed'}};
  const calls=[];
  const retry=action('retryOriginal',{state,window:{DOCREVIEW:{historyId:'new',doc}},render:()=>{},pullOriginal:(...args)=>calls.push(args)});
  retry();retry();assert.equal(calls.length,1);assert.deepEqual(calls[0],['new','new.pdf',doc]);
  assert.equal(state.viewer.originalError,null);assert.equal(state.viewer.loadingOrig,true);
});

test('체크리스트 삭제는 추가 기준 전체를 명시한 확인부터 받고 공통 기준은 거절한다',()=>{
  const state={clayers:{list:[{id:'up',name:'추가 기준',editable:true,items:[{},{}]},
    {id:'common',name:'공통 기준',editable:false,items:[{}]}]}};
  const ask=action('askDeleteChecklist',{state,render:()=>{}});
  ask('common');assert.equal(state.confirmChecklist,undefined);
  ask('up');assert.deepEqual(state.confirmChecklist,{id:'up',name:'추가 기준',count:2});
});

test('체크리스트 삭제 실패 시 기준을 제거하거나 새 목록으로 덮지 않는다',async()=>{
  const state={clib:{},clayers:{selected:'up|0',list:[{id:'up'}]}};
  let loads=0;
  const remove=action('deleteChecklist',{state,render:()=>{},errMessage:e=>e.message,
    actions:{loadChecklists:()=>loads++,loadCriteriaLayers:()=>loads++},fetch:async()=>({ok:false,status:503})});
  await remove('up');assert.equal(loads,0);assert.equal(state.clib.deleting,false);
  assert.match(state.clib.error,/503/);assert.equal(state.clayers.selected,'up|0');
  assert.deepEqual(state.clayers.list,[{id:'up'}]);
});

test('체크리스트 삭제 성공 후 기준 작업대와 선택 목록을 함께 갱신한다',async()=>{
  const state={clib:{},clayers:{selected:'up|0',list:[{id:'up'}]}};let loads=0;
  await action('deleteChecklist',{state,render:()=>{},errMessage:String,
    actions:{loadChecklists:()=>loads++,loadCriteriaLayers:()=>loads++},fetch:async()=>({ok:true})})('up');
  assert.equal(loads,2);assert.equal(state.clayers.selected,null);assert.equal(state.clayers.list,null);
});

// 단일 검토와 체크리스트 초안은 이제 아무것도 나눠 쓰지 않는다(2026-09-16 재설계).
// 초안은 window.DOCREVIEW·state.screen·뷰어를 건드리지 않고, 검토는 state.evalv 를
// 건드리지 않는다. 가드 코드가 아니라 **닿지 않음**이 그것을 지킨다.
function sseOnce(events){
  const bytes=new TextEncoder().encode(events.map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''));
  let sent=false;
  return {ok:true,body:{getReader:()=>({read:async()=>sent?{done:true}:(sent=true,{done:false,value:bytes})})}};
}
function backendFor(state,docreview,stream){
  const win={DR:{helpers:{esc:String}},location:{protocol:'http:'},DOCREVIEW:docreview};
  const fetchStub=async(url)=>/api\/(review|evaluate)$|\/events$/.test(String(url))
    ? stream : {ok:true,json:async()=>({entries:[],jobs:[]})};
  new Function('window','fetch','document',api)(win,fetchStub,{getElementById:()=>null});
  global.window=win;
  return win.DR.backend({state,render:()=>{},pullOriginal:()=>{}});
}
// streamReview·streamEvaluate 는 프로미스를 안 돌려준다 — 몇 틱 흘려 보낸다.
const settle=async()=>{for(let i=0;i<30;i++)await new Promise(r=>setTimeout(r,0));};
const REVIEW_DONE={event:'done',payload:{doc:{name:'새검토.pdf'},findings:[{id:'r1'}],stages:[{}],
  sections:[],images:[],history:{saved:true,id:'h-review'}}};
const DRAFT_DONE={event:'done',payload:{doc:{name:'초안문서.pdf'},rows:[],items:[],sections:[],images:[],
  stages:[],unfound:0,llm_failures:0,history:{saved:true,id:'h-draft',at:'2026-09-16'}}};

test('끝난 단일 검토는 초안 상태를 건드리지 않는다',async()=>{
  const draftPayload={rows:[],items:[],unfound:0};
  const state={mode:'evaluate',estep:'results',screen:'progress',reviewed:false,done:false,
    evalv:{payload:draftPayload,historyId:'h-draft',historyAt:'t',startedAt:0,stage:{},detail:{}},
    files:{single:null},viewer:{},annot:{},jobId:{},rev:{lanes:[],done:{}},stageIndex:-1};
  const globals={doc:{},findings:[],sections:[],images:[],stages:[]};
  backendFor(state,globals,sseOnce([REVIEW_DONE])).streamReview(null,'job-1');await settle();
  // 검토는 제 전역을 받는다(예전 그대로).
  assert.equal(globals.doc.name,'새검토.pdf');
  assert.equal(state.reviewed,true);
  // 초안 쪽은 글자 하나 안 바뀐다 — 가드가 아니라 아예 안 닿는다.
  assert.equal(state.estep,'results');
  assert.equal(state.evalv.payload,draftPayload);
  assert.equal(state.evalv.historyId,'h-draft');
});

test('끝난 초안은 window.DOCREVIEW 도 단일 검토 화면도 건드리지 않는다',async()=>{
  const state={mode:'single',screen:'results',estep:'setup',reviewed:true,done:true,
    evalv:{payload:null,historyId:'',historyAt:'',startedAt:0,stage:{},detail:{}},
    files:{single:{file:{}}},viewer:{origUrl:'blob:keep'},annot:{},jobId:{}};
  const globals={doc:{name:'검토문서.pdf'},findings:[{id:'r1'}],sections:[],images:[],stages:[]};
  backendFor(state,globals,sseOnce([DRAFT_DONE])).streamEvaluate(null,'job-2');await settle();
  // 초안은 제 자리에 담긴다.
  assert.equal(state.evalv.payload.doc.name,'초안문서.pdf');
  assert.equal(state.evalv.historyId,'h-draft');
  assert.equal(state.estep,'results');
  // 단일 검토 쪽은 전역도 화면도 뷰어도 그대로다.
  assert.deepEqual(globals.findings,[{id:'r1'}]);
  assert.equal(globals.doc.name,'검토문서.pdf');
  assert.equal(state.screen,'results');
  assert.equal(state.reviewed,true);
  assert.equal(state.viewer.origUrl,'blob:keep','초안이 단일 검토의 뷰어 blob 을 회수했다');
});

test('초안 완료는 돌고 있는 경과 타이머를 안 끊고, 제 틱은 스스로 멈춘다',async()=>{
  // timers 는 네 틱(단일·비교·폴더·초안)이 함께 쓰는 한 벌이다. 초안이 끝날 때
  // 한 벌을 비우면 마침 단일 검토를 보고 있던 사람의 경과가 같이 굳는다.
  const state={mode:'evaluate',estep:'progress',screen:'progress',reviewed:false,done:false,
    evalv:{payload:null,historyId:'',historyAt:'',startedAt:Date.now(),stage:{},detail:{}},
    files:{single:null},viewer:{},annot:{},jobId:{}};
  const backend=backendFor(state,{doc:{},findings:[],sections:[],images:[],stages:[]},sseOnce([DRAFT_DONE]));
  const realClear=global.clearTimeout,realSet=global.setTimeout;
  let cleared=0;
  global.clearTimeout=h=>{cleared++;return realClear(h);};
  try{
    backend.tickEvaluateElapsed();                 // 경과 틱 하나를 timers 에 건다
    backend.streamEvaluate(null,'job-3');await settle();
    assert.equal(cleared,0,'초안 완료가 남의 타이머까지 끊었다');
    assert.equal(state.estep,'results');
    // 초안 틱은 estep 가드로 스스로 끝난다 — 다시 불러도 새 타이머를 안 건다.
    let queued=0;
    global.setTimeout=(...a)=>{queued++;return realSet(...a);};
    backend.tickEvaluateElapsed();
    assert.equal(queued,0,'estep 이 results 인데 초안 틱이 계속 돈다');
  } finally {
    global.setTimeout=realSet;global.clearTimeout=realClear;backend.clearTimers();
  }
});

test('초안 완료 경로는 뷰어 전역을 아예 안 쓴다',()=>{
  // 소스 수준 가드 — 나중에 누가 다시 window.DOCREVIEW 를 쓰면 여기서 걸린다.
  const draft=api.slice(api.indexOf('function onEvaluateEvent'),api.indexOf('function streamEvaluate'))
    .split('\n').filter(l=>!/^\s*\/\//.test(l)).join('\n');
  assert.ok(!/window\.DOCREVIEW/.test(draft),'초안 이벤트 처리가 전역 뷰어를 건드린다');
  assert.ok(!/state\.(screen|reviewed|viewer|annot|marks)\b/.test(draft),'초안이 단일 검토 상태를 건드린다');
});
