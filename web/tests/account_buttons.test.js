const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fixture = fs.readFileSync(path.join(__dirname, 'result_filters.test.js'), 'utf8').split('\ntest(')[0];
const {state, build} = new Function('require', '__dirname', fixture + ';return {state,build};')(require, __dirname);

test('계정 목록은 메인색, 최종 삭제는 위험 버튼이며 자기 계정 삭제는 숨긴다', () => {
  const st = state({mode:'settings', settingsTab:'accounts',
    user:{name:'관리자',email:'admin@example.test',role:'admin'},
    admin:{list:[{name:'관리자',email:'admin@example.test',role:'admin'},
      {name:'사용자',email:'user@example.test',role:'user'}]},
    confirmAccount:'user@example.test'});
  const views = build(st, []);
  const html = views.view(views.renderVals());
  const buttons = html.match(/<button[^>]+data-act="(?:askDeleteAccount|deleteAccount)"[^>]*>/g);
  assert.equal(buttons.length, 2);
  for (const button of buttons) {
    assert.match(button, button.includes('askDeleteAccount')
      ? /class="btn btn-sm btn-primary"/ : /class="btn btn-lg btn-danger"/);
    assert.match(button, /data-arg="user@example.test"/);
    assert.doesNotMatch(button, /btn-ghost|style=/);
  }
  assert.match(html, /data-act="cancelDelete"/);
});

test('체크리스트 삭제 진입도 메인 버튼이며 모든 최종 삭제는 공통 확인창을 쓴다', () => {
  const source = fs.readFileSync(path.join(__dirname, '../views.js'), 'utf8');
  assert.match(source, /class="btn btn-sm btn-primary" data-act="askDeleteChecklist"/);
  for (const action of ['deleteAccount', 'deleteHistory', 'deleteChecklist']) {
    assert.match(source, new RegExp('act: "' + action + '"'));
  }
  const dialog = source.slice(source.indexOf('  function confirmDialog('), source.indexOf('  function settingsView('));
  assert.match(dialog, /type="button" class="btn btn-lg btn-danger"/);
});
