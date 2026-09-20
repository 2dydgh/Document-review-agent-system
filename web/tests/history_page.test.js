const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const api=fs.readFileSync(path.join(__dirname,'..','api.js'),'utf8');
function backend(state,fetch) {
  const win={DR:{helpers:{esc:String}},location:{protocol:'http:'}};
  new Function('window','fetch',api)(win,fetch);
  return win.DR.backend({state,render:()=>{},repaintHistoryRecords:()=>true});
}
const page=(id,over={})=>Object.assign({entries:[{id}],total:1,available_total:150,
  kind_counts:{'':1,review:1},offset:0,limit:20},over);
const response=body=>({ok:true,json:async()=>body});

test('서버 검색은 검색어·유형·페이지를 보내고 홈의 최근 기록을 덮지 않는다',async()=>{
  let url;const recent=[{id:'recent'}];
  const state={mode:'history',history:recent,historyQ:'요건 & 서명',historyKind:'review',historyOffset:20};
  await backend(state,async u=>{url=u;return response(page('old',{offset:20,total:21}))}).loadHistoryPage();
  const query=new URL(url,'http://test/').searchParams;
  assert.equal(query.get('q'),'요건 & 서명');assert.equal(query.get('kind'),'review');
  assert.equal(query.get('offset'),'20');assert.equal(query.get('limit'),'20');
  assert.equal(state.history,recent);assert.equal(state.historyPage.entries[0].id,'old');
});

test('빠르게 검색어를 바꾸면 늦은 이전 응답은 현재 결과를 덮지 않는다',async()=>{
  const waiting=[];const state={mode:'history',historyQ:'old'};
  const b=backend(state,()=>new Promise(resolve=>waiting.push(resolve)));
  const first=b.loadHistoryPage();state.historyQ='new';const second=b.loadHistoryPage();
  waiting[1](response(page('new')));await second;
  waiting[0](response(page('old')));await first;
  assert.equal(state.historyPage.entries[0].id,'new');assert.equal(state.historyPage.busy,false);
});

test('다음 검색 요청을 보내기 전에도 이전 검색어 응답을 거부한다',async()=>{
  let resolve;const state={mode:'history',historyQ:'old'};
  const b=backend(state,()=>new Promise(r=>resolve=r));const request=b.loadHistoryPage();
  state.historyQ='typing';resolve(response(page('old')));await request;
  assert.equal(state.historyPage.entries,undefined);
});

test('계정이 바뀌면 이전 요청 결과를 새 계정 화면에 반영하지 않는다',async()=>{
  let resolve;const state={mode:'history',user:{email:'old'}};
  const request=backend(state,()=>new Promise(r=>resolve=r)).loadHistoryPage();
  state.user={email:'new'};resolve(response(page('old-owner')));await request;
  assert.equal(state.historyPage.entries,undefined);
});

test('실패와 정상 검색 0건을 구별하고 재시도할 수 있다',async()=>{
  const state={mode:'history'};
  await backend(state,async()=>({ok:false,status:503})).loadHistoryPage();
  assert.match(state.historyPage.error,/503/);assert.equal(state.historyPage.busy,false);
  await backend(state,async()=>response(page('',{entries:[],total:0}))).loadHistoryPage();
  assert.equal(state.historyPage.error,null);assert.equal(state.historyPage.total,0);
  await backend(state,async()=>response({entries:[]})).loadHistoryPage();
  assert.match(state.historyPage.error,/응답/);
});

test('삭제 뒤 서버가 보정한 마지막 페이지 위치를 사용한다',async()=>{
  const state={mode:'history',historyOffset:40};
  await backend(state,async()=>response(page('last',{offset:20,total:40}))).loadHistoryPage();
  assert.equal(state.historyOffset,20);
});
