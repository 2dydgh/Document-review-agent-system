const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const app=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
function fn(name,deps){
  const start=app.indexOf('  function '+name+'(');
  const code=app.slice(start,app.indexOf('\n  }',start)+4);
  return new Function(...Object.keys(deps),code+';return '+name)(...Object.values(deps));
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
class Form {append(){}}

test('이전 문서 변환이 늦게 끝나도 새 PDF와 지문을 덮지 않는다',async()=>{
  let resolve;
  const old={},state={viewer:old};let renders=0;
  const convert=fn('maybeConvert',{state,viewerSource:()=>({name:'a.hwpx',file:{}}),
    FormData:Form,fetch:()=>new Promise(r=>resolve=r),render:()=>renders++,
    URL:{createObjectURL:()=>{throw Error('stale URL must not be created')}}});
  convert();state.viewer={baseBlob:'new'};
  resolve({ok:true,headers:{get:()=> 'old-hash'},blob:async()=> 'old-pdf'});
  await tick();assert.deepEqual(state.viewer,{baseBlob:'new'});assert.equal(renders,0);
});

test('변환 PDF 지문을 보존하고 같은 문서일 때만 화면에 반영한다',async()=>{
  const state={viewer:{}};
  fn('maybeConvert',{state,viewerSource:()=>({name:'a.hwpx',file:{}}),
    FormData:Form,fetch:async()=>({ok:true,headers:{get:()=> 'hash'},blob:async()=> 'pdf'}),
    render:()=>{},URL:{createObjectURL:()=> 'blob:pdf'}})();
  await tick();assert.equal(state.viewer.pdfSha256,'hash');assert.equal(state.viewer.baseBlob,'pdf');
});

test('뷰어 PDF와 다른 PDF의 좌표는 적용하지 않는다',async()=>{
  const state={viewer:{baseBlob:'pdf',pdfSha256:'shown'},marks:null};const notices=[];
  fn('loadMarks',{state,viewerSource:()=>({name:'a.hwpx',historyId:'h',findings:[{}],images:[]}),
    FormData:Form,fetch:async()=>({ok:true,json:async()=>({pdf_sha256:'other',items:[]})}),
    toast:msg=>notices.push(msg)})('pdf');
  await tick();assert.equal(state.marks,null);assert.equal(notices.length,1);
  assert.match(notices[0],/PDF와 위치 정보가 달라/);
});

test('변환 안내는 단일·비교·폴더 공용 헤더에 있고 근사 쪽수로 점프하지 않는다',()=>{
  const views=fs.readFileSync(path.join(__dirname,'..','views.js'),'utf8');
  const start=views.indexOf('  function viewerHeadHtml('),end=views.indexOf('\n  }',start);
  assert.match(views.slice(start,end),/viewer-source-note/);
  assert.match(views.slice(start,end),/원본과 배치·쪽수가 다를 수/);
  assert.ok(!app.includes('window.DR.pdfview.goTo(state.cview.page)'));
});
