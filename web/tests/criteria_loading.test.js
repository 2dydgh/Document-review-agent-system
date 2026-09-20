const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function setup() {
  const state = { mode: 'checklists', user: { email: 'test@example.test', team: 'A' },
    checklist: 'A', clayers: { list: null, busy: false }, rev: {} };
  const requests = [], counts = { render: 0, partial: 0 };
  const deps = { state, render: () => counts.render++, repaintCriteriaLayers: () => { counts.partial++; return true; },
    errMessage: e => e.message, fetchCriteriaLayers: team => new Promise((resolve, reject) => requests.push({ team, resolve, reject })) };
  const match = source.match(/^    loadCriteriaLayers: function \(([^)]*)\) \{([\s\S]*?)\n    \},/m);
  const load = new Function(...Object.keys(deps), 'return function(' + match[1] + '){' + match[2] + '};')(...Object.values(deps));
  return { state, requests, counts, load };
}
const layers = text => [{ id: 'sample', items: [{ text }] }];

test('최초 진입은 부모 렌더 한 번에 맡기고 응답은 목록만 갱신한다', async () => {
  const a = setup(), pending = a.load({ deferRender: true });
  assert.equal(a.state.clayers.busy, true);
  assert.deepEqual(a.counts, { render: 0, partial: 0 });
  a.load({ refresh: true });
  assert.equal(a.requests.length, 1);
  a.requests[0].resolve({ layers: layers('첫 기준') }); await pending;
  assert.deepEqual(a.counts, { render: 0, partial: 1 });
  assert.equal(a.state.clayers.busy, false);
});

test('재방문과 재시도 중에는 캐시를 지우지 않고 실패도 구분한다', async () => {
  const a = setup(); let pending = a.load({ deferRender: true });
  a.requests[0].resolve({ layers: layers('기존 기준') }); await pending;
  const cached = a.state.clayers.list;
  a.load(); assert.equal(a.requests.length, 1);
  pending = a.load({ refresh: true, deferRender: true });
  assert.equal(a.state.clayers.list, cached);
  a.requests[1].reject(new Error('접속 실패')); await pending;
  assert.equal(a.state.clayers.list, cached);
  assert.equal(a.state.clayers.error, '접속 실패');
  pending = a.load({ refresh: true });
  a.requests[2].resolve({ layers: [] }); await pending;
  assert.deepEqual(a.state.clayers.list, []);
  assert.equal(a.state.clayers.error, '');
});

test('팀이 바뀌면 캐시를 분리하고 늦게 온 이전 팀 응답은 무시한다', async () => {
  const a = setup(), old = a.load({ deferRender: true });
  a.state.checklist = 'B';
  const current = a.load({ deferRender: true });
  assert.equal(a.state.clayers.list, null);
  a.requests[1].resolve({ layers: layers('B 기준') }); await current;
  a.requests[0].resolve({ layers: layers('A 기준') }); await old;
  assert.equal(a.state.clayers.list[0].items[0].text, 'B 기준');
  assert.equal(a.counts.partial, 1);
});

test('계정 변경·상태 교체·화면 이동 뒤의 응답은 현재 화면을 다시 만들지 않는다', async () => {
  for (const change of ['account', 'state', 'navigation']) {
    const a = setup(), pending = a.load({ deferRender: true });
    if (change === 'account') a.state.user.email = 'another@example.test';
    if (change === 'state') a.state.clayers = { list: null, busy: false };
    if (change === 'navigation') a.state.mode = 'home';
    a.requests[0].resolve({ layers: layers('늦은 응답') }); await pending;
    assert.deepEqual(a.counts, { render: 0, partial: 0 });
    if (change !== 'navigation') assert.equal(a.state.clayers.list, null);
  }
});

test('잘못된 응답을 정상적인 빈 목록으로 저장하지 않는다', async () => {
  for (const body of [{}, { layers: null }, { layers: [{}] }]) {
    const a = setup(), pending = a.load({ deferRender: true });
    a.requests[0].resolve(body); await pending;
    assert.equal(a.state.clayers.list, null);
    assert.match(a.state.clayers.error, /응답을 읽지 못했습니다/);
    assert.equal(a.state.clayers.busy, false);
  }
});
