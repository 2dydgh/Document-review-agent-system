const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fixture = fs.readFileSync(path.join(__dirname, 'result_filters.test.js'), 'utf8').split('\ntest(')[0];
const {state, build} = new Function('require', '__dirname', fixture + ';return {state,build};')(require, __dirname);
const app = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');

test('환경설정 언어는 공통 선택 메뉴이며 미지원 영어는 준비 중으로 표시한다', () => {
  const views = build(state({mode:'settings',settingsTab:'app'}), []);
  const html = views.view(views.renderVals());
  assert.match(html, /class="sel sel-sm settings-language" id="settingsLanguage" data-value="ko"/);
  assert.match(html, /aria-label="인터페이스 언어" aria-controls="settingsLanguage-options"/);
  assert.match(html, /aria-selected="true" data-act="selPick" data-arg="settingsLanguage\|ko"/);
  assert.match(html, /disabled aria-disabled="true" data-act="selPick" data-arg="settingsLanguage\|en"/);
  assert.match(html, /English · 준비 중/);
  assert.ok(!html.includes('<select'));
});

test('언어 메뉴 키보드는 지원 옵션만 이동하고 Escape로 트리거에 복귀한다', () => {
  const start = app.indexOf('  function reviewSelectKeydown(');
  const source = app.slice(start, app.indexOf('\n  }', start) + 4);
  let opened=false, closed=0, focused='', prevented=0;
  const option={focus:()=>{focused='ko';document.activeElement=option;}};
  const trigger={focus:()=>{focused='trigger';}};
  const sel={id:'settingsLanguage',classList:{contains:()=>opened},querySelector:()=>trigger,
    querySelectorAll:s=>{assert.equal(s,'.sel-opt:not(:disabled)');return [option];}};
  const document={activeElement:trigger};
  const keydown=new Function('document','actions','closeSelects',source+';return reviewSelectKeydown;')(
    document,{selToggle:id=>{assert.equal(id,'settingsLanguage');opened=true;}},()=>{opened=false;closed++;});
  const event=key=>({key,target:{closest:()=>sel},preventDefault:()=>prevented++});
  keydown(event('ArrowDown'));assert.equal(opened,true);assert.equal(focused,'ko');
  keydown(event('ArrowUp'));assert.equal(focused,'ko');
  keydown(event('Escape'));assert.equal(opened,false);assert.equal(focused,'trigger');
  assert.equal(closed,1);assert.equal(prevented,3);
  keydown({key:'ArrowDown',target:{closest:()=>null}});assert.equal(prevented,3);
});
