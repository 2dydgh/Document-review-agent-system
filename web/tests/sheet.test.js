// 잡아끌어 닫는 시트의 계산부. 화면 없이 검증할 수 있는 건 전부 여기서 본다 —
// 손끝 느낌은 사람이 봐야 하지만, "세게 던졌는데 안 닫힌다"는 숫자로 잡힌다.
// 실행: node --test web/tests/   (pytest 가 tests/test_frontend_js.py 로 감싼다)
const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

const sheet = require(path.join(__dirname, "..", "sheet.js"));

test("착지 지점은 Apple 지수감쇠식이다 — v²/2a 가 아니다", () => {
  // (v/1000) * d / (1-d) → 1000px/s 는 0.998 에서 499px 를 더 간다.
  assert.strictEqual(Math.round(sheet.project(1000, 0.998)), 499);
  assert.strictEqual(sheet.project(0), 0);
  // 위로 던지면 위로 간다(부호 보존).
  assert.ok(sheet.project(-500) < 0);
  // 감속이 셀수록 덜 간다.
  assert.ok(sheet.project(1000, 0.99) < sheet.project(1000, 0.998));
});

test("살짝 끌고 세게 던지면 닫힌다 — 놓은 자리가 아니라 가려던 자리로 정한다", () => {
  const H = 400;
  // 40px 밖에 안 끌었지만 손은 초당 1200px 로 아래로 가는 중.
  assert.strictEqual(sheet.decide(40, 1200, H), "dismiss");
  // 같은 자리에서 손을 그냥 놓으면 되돌아온다.
  assert.strictEqual(sheet.decide(40, 0, H), "return");
});

test("많이 끌었어도 도로 밀어 올리는 중이면 안 닫힌다 — 속도의 부호가 이긴다", () => {
  const H = 400;
  assert.strictEqual(sheet.decide(300, 0, H), "dismiss");
  assert.strictEqual(sheet.decide(300, -1500, H), "return");
});

test("경계 밖은 저항한다 — 끌수록 덜 따라오고, 방향은 유지한다", () => {
  const H = 400;
  const a = sheet.rubberband(-50, H);
  const b = sheet.rubberband(-200, H);
  assert.ok(a < 0 && b < 0, "위로 끌면 위로는 간다");
  assert.ok(Math.abs(a) < 50, "손보다 덜 따라온다");
  assert.ok(Math.abs(b) < 200);
  assert.ok(Math.abs(b) > Math.abs(a), "더 끌면 더 가긴 한다");
  // 저항 비율은 멀수록 커진다 — 그래야 "끝이 있다"로 읽힌다.
  assert.ok(Math.abs(b) / 200 < Math.abs(a) / 50);
  assert.strictEqual(sheet.rubberband(0, H), 0);
});

// 스프링을 60fps 로 돌려 본다.
function settle(spring, maxFrames = 600) {
  let peak = spring.x;
  let frames = 0;
  while (!spring.settled() && frames < maxFrames) {
    spring.step(1 / 60);
    peak = Math.max(peak, spring.x);
    frames++;
  }
  return { peak, frames, settled: spring.settled() };
}

test("감쇠비 1.0 은 목표를 넘지 않는다 — 메뉴가 튕기면 안 된다", () => {
  const s = new sheet.Spring({ from: 0, to: 100, damping: 1.0, response: 0.4 });
  const r = settle(s);
  assert.ok(r.settled, "안착한다");
  assert.ok(r.peak <= 100.5, `목표를 넘었다: ${r.peak}`);
  assert.ok(Math.abs(s.x - 100) < 1);
});

test("감쇠비 0.8 은 살짝 넘어갔다 온다 — 던진 것에만 쓴다", () => {
  const s = new sheet.Spring({ from: 0, to: 100, damping: 0.8, response: 0.3 });
  const r = settle(s);
  assert.ok(r.settled);
  assert.ok(r.peak > 100, `튕겨야 하는데 안 튕겼다: ${r.peak}`);
  assert.ok(r.peak < 120, `너무 튕긴다: ${r.peak}`);
});

test("놓는 순간의 속도를 이어받는다 — 이음매가 없어야 한다", () => {
  const still = new sheet.Spring({ from: 0, to: 100, damping: 1.0, response: 0.4 });
  const thrown = new sheet.Spring({ from: 0, to: 100, damping: 1.0, response: 0.4, velocity: 800 });
  still.step(1 / 60);
  thrown.step(1 / 60);
  assert.ok(thrown.x > still.x, "던진 쪽이 먼저 나간다");
  // 속도를 받은 쪽이 더 빨리 닿는다.
  assert.ok(settle(thrown).frames < settle(still).frames);
});

test("목표를 바꿔도 속도는 끊기지 않는다 — 방향을 뒤집을 때 벽에 부딪히지 않게", () => {
  const s = new sheet.Spring({ from: 0, to: 400, damping: 1.0, response: 0.3 });
  for (let i = 0; i < 10; i++) s.step(1 / 60);
  const vBefore = s.v;
  assert.ok(vBefore > 0, "아래로 가는 중이어야 한다");
  s.retarget(0);                       // 손이 도로 잡아 올렸다
  assert.strictEqual(s.v, vBefore, "속도가 0 으로 끊기면 안 된다");
  assert.ok(settle(s).settled);
  assert.ok(Math.abs(s.x) < 1, "되돌아와 안착한다");
});

test("프레임이 길게 밀려도 발산하지 않는다 — 탭을 가렸다 돌아온 경우", () => {
  const s = new sheet.Spring({ from: 0, to: 100, damping: 1.0, response: 0.3 });
  s.step(0.5);                         // 500ms 한 방
  assert.ok(Number.isFinite(s.x) && Math.abs(s.x) < 1000, `발산했다: ${s.x}`);
  assert.ok(settle(s).settled);
});
