const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
function fn(name) {
  const start = source.indexOf('  function ' + name + '(');
  return source.slice(start, source.indexOf('\n  }', start) + 4);
}
function setup() {
  const state = { phase: 'preparing', run: 'job-1', screen: 'progress', height: 360, width: 480, reduced: false };
  const calls = [], listeners = new Map();
  const card = {
    getAttribute: name => name === 'data-progress-phase' ? state.phase : state.run,
    closest: () => ({ getAttribute: () => state.screen }),
    getBoundingClientRect: () => ({ height: state.height, width: state.width }),
    querySelector: () => ({ animate: () => ({ cancel() {} }) }),
    animate: (frames, options) => {
      const animation = { cancel() { if (this.oncancel) this.oncancel(); } };
      calls.push({ frames, options, animation }); return animation;
    },
  };
  const window = {
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name, fn) => { if (listeners.get(name) === fn) listeners.delete(name); },
  };
  const api = new Function('document', 'window', 'reduceMotion',
    fn('captureProgressExpansion') + fn('animateProgressExpansion') +
    ';return {capture:captureProgressExpansion,animate:animateProgressExpansion};')(
    { querySelector: () => card }, window, () => state.reduced);
  return { state, card, calls, listeners, ...api };
}
test('only preparation-to-review expands both dimensions, without scaling text', () => {
  const t = setup(), before = t.capture();
  t.state.phase = 'reviewing'; t.state.height = 620; t.state.width = 620; t.animate(before);
  assert.equal(t.calls.length, 1);
  assert.equal(t.calls[0].options.duration, 250);
  assert.equal(t.calls[0].options.easing, 'cubic-bezier(.4, 0, .2, 1)');
  assert.deepEqual(t.calls[0].frames.map(f => f.height), ['360px', '620px']);
  assert.deepEqual(t.calls[0].frames.map(f => f.width), ['480px', '620px']);
  assert.ok(t.calls[0].frames.every(f => !('transform' in f)));
  t.calls[0].animation.onfinish();
  t.animate(t.capture());
  assert.equal(t.calls.length, 1);
  assert.equal(t.listeners.size, 0);
});
test('navigation, already-ready state, new jobs and completion do not replay', () => {
  const t = setup();
  t.state.phase = 'reviewing'; t.animate(null); t.animate(t.capture());
  assert.equal(t.calls.length, 0);
  for (const change of [{run:'job-2'}, {screen:'cmp-progress'}, {phase:'done'}]) {
    const v = setup(), before = v.capture();
    Object.assign(v.state, {phase:'reviewing',height:600}, change);
    v.animate(before); assert.equal(v.calls.length, 0);
  }
});
test('width-only growth still animates and unchanged mobile width stays unchanged', () => {
  const t = setup(), before = t.capture();
  Object.assign(t.state, {phase:'reviewing',width:620});t.animate(before);
  assert.equal(t.calls.length,1);
  assert.deepEqual(t.calls[0].frames.map(f=>f.height),['360px','360px']);
  const mobile=setup();mobile.state.width=320;
  const smallBefore=mobile.capture();
  Object.assign(mobile.state,{phase:'reviewing',height:620});mobile.animate(smallBefore);
  assert.deepEqual(mobile.calls[0].frames.map(f=>f.width),['320px','320px']);
});
test('replacement DOM continues the original deadline instead of starting over', () => {
  const t = setup();
  t.state.phase = 'reviewing'; t.state.height = 620;
  t.animate({ phase:'reviewing',screen:'progress',run:'job-1',height:450,width:500,until:Date.now()+100 });
  assert.equal(t.calls.length, 1);
  assert.ok(t.calls[0].options.duration > 0 && t.calls[0].options.duration <= 100);
});
test('reduced motion and resize restore natural layout', () => {
  const t = setup(), before = t.capture();
  Object.assign(t.state, {phase:'reviewing',height:620,reduced:true});
  t.animate(before); assert.equal(t.calls.length, 0);
  t.state.reduced=false; t.animate(before);
  t.listeners.get('resize')();
  assert.equal(t.card._progressExpandAnimation, null);
  assert.equal(t.card._progressExpandUntil, 0);
  assert.equal(t.listeners.size, 0);
});
