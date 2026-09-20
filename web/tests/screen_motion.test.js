// 실행: node --test web/tests/screen_motion.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'views.js'), 'utf8');

// 실제 템플릿의 타이밍 함수를 가짜 시계로 검증한다. 타이머·네트워크에 의존하지 않는다.
function harness() {
  let now = 1000;
  const gating = source.slice(source.indexOf('  var ENTER_WINDOW'), source.indexOf('  // 이번 검토에 **실제로 합쳐지는 층만** 추린다.'));
  const helpers = source.slice(source.indexOf('  function enterAnim('), source.indexOf('  // 상세 영역. 방금 펼친 카드'));
  const api = new Function('Date', gating + helpers + ';return {animFlags,enterAnim,contentAnim,popoverAnim};')({ now: () => now });
  const st = { mode: 'home', screen: 'upload', cstep: 'setup', kase: { step: 'upload' }, files: {} };
  return { ...api, st, tick: (ms) => { now += ms; } };
}

test('첫 로드와 다른 검토의 백그라운드 상태 갱신에는 화면을 다시 등장시키지 않는다', () => {
  const h = harness();
  assert.equal(h.animFlags(h.st).entered, false);
  h.tick(700); h.st.screen = 'results'; h.st.cstep = 'progress'; h.st.kase.step = 'progress';
  assert.equal(h.animFlags(h.st).entered, false);
  h.st.mode = 'history'; assert.equal(h.animFlags(h.st).entered, true);
  h.tick(700); h.st.screen = 'upload';
  assert.equal(h.animFlags(h.st).entered, false);
});

test('단일·비교·폴더의 실제 단계 전환은 모두 같은 진입 규칙을 쓴다', () => {
  for (const mode of ['single', 'compare', 'case']) {
    const h = harness(); h.st.mode = mode; h.animFlags(h.st); h.tick(700);
    if (mode === 'single') h.st.screen = 'progress';
    if (mode === 'compare') h.st.cstep = 'progress';
    if (mode === 'case') h.st.kase.step = 'progress';
    assert.equal(h.animFlags(h.st).entered, true, mode);
    h.tick(100);
    assert.equal(h.animFlags(h.st).enterElapsed, 100, mode);
    h.tick(600);
    assert.equal(h.animFlags(h.st).entered, false, mode);
  }
});

test('비교·폴더 결과와 원문 화면 사이 이동도 화면 전환으로 구분한다', () => {
  for (const mode of ['compare', 'case']) {
    const h = harness(); h.st.mode = mode; h.st.cstep = h.st.kase.step = 'results';
    h.animFlags(h.st); h.tick(700);
    if (mode === 'compare') h.st.cview = { side: 'A' }; else h.st.kase.view = { doc: 'A' };
    assert.equal(h.animFlags(h.st).entered, true);
    h.tick(700); h.st.cview = null; h.st.kase.view = null;
    assert.equal(h.animFlags(h.st).entered, true);
  }
});

test('결과 목록은 재렌더 때 되감지 않고 마지막 카드가 끝날 때까지 이어진다', () => {
  const h = harness(); h.animFlags(h.st); h.st.mode = 'single'; h.animFlags(h.st);
  h.tick(110);
  let anim = h.animFlags(h.st);
  assert.match(h.enterAnim({ anim }, 0), /animation-delay:-110ms/);
  assert.match(h.enterAnim({ anim }, 10), /animation-delay:190ms/);
  h.tick(240); anim = h.animFlags(h.st);
  assert.equal(anim.entered, false);
  assert.equal(anim.listEntered, true);
  assert.match(h.enterAnim({ anim }, 10), /animation-delay:-50ms/);
  h.tick(250); assert.equal(h.enterAnim({ anim: h.animFlags(h.st) }, 0), '');
});

test('페이지 페이드는 85%에서 180ms로 정착하며 모달용 시간은 바꾸지 않는다', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(css, /--dur-page:\s*180ms/);
  assert.match(css, /--dur-2:\s*200ms/);
  assert.match(css, /@keyframes screenIn\s*\{\s*0%\s*\{\s*opacity:\s*\.85;/);
  assert.match(source, /animation:screenIn var\(--dur-page\)/);
  assert.ok(!source.includes('tileEnter'));
});

test('탭·상세 교체에만 150ms 모션을 주고 값 갱신과 화면 재진입에는 겹치지 않는다', () => {
  const h = harness(); h.animFlags(h.st);
  assert.equal(h.contentAnim('detail', 'A'), '');
  assert.match(h.contentAnim('detail', 'B'), /animation:contentIn/);
  h.tick(80); assert.match(h.contentAnim('detail', 'B'), /animation-delay:-80ms/);
  h.tick(80); assert.equal(h.contentAnim('detail', 'B'), '');
  h.st.mode = 'history'; h.animFlags(h.st);
  h.st.mode = 'home'; h.animFlags(h.st);
  assert.equal(h.contentAnim('detail', 'C'), '', '재진입은 전체 화면 모션에 맡긴다');
});

test('팝오버는 열린 시점부터 이어지고 데이터 갱신으로 다시 열리지 않는다', () => {
  const h = harness();
  assert.match(h.popoverAnim(1000), /animation-delay:-0ms/);
  h.tick(80); assert.match(h.popoverAnim(1000), /animation-delay:-80ms/);
  h.tick(100); assert.equal(h.popoverAnim(1000), '');
  assert.equal(h.popoverAnim(undefined), '');
});

test('로컬 전환은 위치를 움직이지 않고 reduced-motion 공통 규칙을 따른다', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const frames = css.slice(css.indexOf('@keyframes contentIn'), css.indexOf('@keyframes shimmer'));
  assert.match(frames, /opacity: \.65/);
  assert.ok(!frames.includes('transform'));
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(source, /bodyMotion: contentAnim\("single-result", reviewTab\)/);
  assert.match(source, /contentAnim\("trace-detail", active.key\)/);
  assert.match(source, /contentAnim\("settings-tab", tab\)/);
  assert.match(source, /contentAnim\("case-tab", tab\)/);
});
