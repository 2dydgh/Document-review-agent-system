// 시트의 수명 — 등장·유지·퇴장. 계산부(sheet.test.js)와 달리 여기서 보는 건
// **render() 가 DOM 을 갈아치워도 시트가 살아남는가** 하나다. 이 앱은 매 렌더
// innerHTML 을 통째로 바꾸고, 검토 중에는 1초마다 그린다(api.js) — 그 사이
// 카드가 사라지거나 끌던 자리가 튀면 시트는 못 쓴다.
// 실행: node --test web/tests/
const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

// ---- 아주 작은 가짜 DOM --------------------------------------------------
// 진짜가 필요한 건 네 가지뿐이다: 속성 읽기 · 자식 훑기 · 붙였다 떼기 · 사각형.
function el(attrs = {}, children = []) {
  const n = {
    _attrs: attrs,
    style: {},
    children,
    parentNode: null,
    _rect: { top: 100, height: 300 },
    getAttribute: (k) => (k in n._attrs ? n._attrs[k] : null),
    getBoundingClientRect: () => n._rect,
    addEventListener: () => {},
    appendChild(c) {
      if (c.parentNode) c.parentNode.removeChild(c);
      c.parentNode = n;
      n.children.push(c);
      return c;
    },
    removeChild(c) {
      const i = n.children.indexOf(c);
      if (i >= 0) n.children.splice(i, 1);
      c.parentNode = null;
      return c;
    },
    querySelectorAll: (sel) => walk(n, sel),
    querySelector: (sel) => walk(n, sel)[0] || null,
  };
  children.forEach((c) => { c.parentNode = n; });
  return n;
}

function walk(root, sel) {
  const key = sel.replace(/[[\]]/g, "");
  const out = [];
  (function rec(node) {
    for (const c of node.children) {
      if (c.getAttribute(key) !== null) out.push(c);
      rec(c);
    }
  })(root);
  return out;
}

// rAF 는 직접 돌린다 — 프레임을 우리가 세야 결과가 매번 같다.
let frames = [];
globalThis.requestAnimationFrame = (fn) => frames.push(fn);
globalThis.cancelAnimationFrame = () => {};
globalThis.matchMedia = () => ({ matches: false });
globalThis.innerHeight = 800;
globalThis.document = { querySelector: () => null };

function pump(n = 200) {
  let t = 0;
  for (let i = 0; i < n && frames.length; i++) {
    const q = frames;
    frames = [];
    t += 16;
    q.forEach((fn) => fn(t));
  }
}

const sheet = require(path.join(__dirname, "..", "sheet.js"));

// scrim > panel(data-sheet) > grip 한 벌.
function makeSheet(key) {
  const grip = el({ "data-sheet-grip": "" });
  const panel = el({ "data-sheet": key, "data-sheet-close": "closeIt" }, [grip]);
  return { scrim: el({}, [panel]), panel };
}

test("새로 뜬 시트는 아래에서 올라와 제자리에 안착한다", () => {
  frames = [];
  const { scrim, panel } = makeSheet("a");
  const root = el({}, [scrim]);
  sheet.sync(root, {}, el());

  assert.match(panel.style.transform, /translate3d/, "등장은 아래에서 시작한다");
  pump();
  assert.strictEqual(panel.style.transform, "", "안착하면 transform 이 없다");
});

test("렌더가 DOM 을 갈아도 끌던 자리는 되살아난다 — 1초 틱에 카드가 튀면 안 된다", () => {
  frames = [];
  const first = makeSheet("b");
  const root = el({}, [first.scrim]);
  sheet.sync(root, {}, el());
  pump();                                   // 등장 끝, y = 0

  // 손으로 120px 끌어 내린 상태를 만든다.
  const live = sheet.keep(root);
  assert.ok(live.b, "keep 은 scrim 째 들고 있는다");

  // render() 가 새 노드로 갈아치웠다. 같은 key 가 그대로 있다.
  const second = makeSheet("b");
  const root2 = el({}, [second.scrim]);
  sheet.sync(root2, live, el());

  // 새 노드에 상태가 다시 걸렸고, 등장 연출을 **다시 하지 않는다**.
  assert.strictEqual(second.panel.style.transform, "", "이미 있던 시트는 다시 등장하지 않는다");
  assert.strictEqual(frames.length, 0, "새 스프링이 돌면 안 된다");
});

test("사라진 시트는 레이어로 옮겨 끝까지 내려간 뒤 지워진다", () => {
  frames = [];
  const { scrim, panel } = makeSheet("c");
  const root = el({}, [scrim]);
  const layer = el();
  sheet.sync(root, {}, layer);
  pump();

  const live = sheet.keep(root);
  root.removeChild(scrim);                  // render() 가 지웠다
  const root2 = el({});
  sheet.sync(root2, live, layer);

  assert.strictEqual(scrim.parentNode, layer, "지워지지 않고 레이어로 옮겨진다");
  assert.ok(frames.length > 0, "내려가는 스프링이 돈다");
  pump();
  assert.strictEqual(scrim.parentNode, null, "다 내려간 뒤에 지워진다");
  assert.ok(parseFloat(panel.style.transform.match(/,\s*([\d.]+)px/)[1]) > 300,
    "화면 밖까지 내려간다 — 카드 높이만큼이 아니라");
});

test("움직임을 줄여 달라고 하면 스프링을 돌리지 않는다", () => {
  frames = [];
  globalThis.matchMedia = () => ({ matches: true });
  try {
    const { panel } = makeSheet("d");
    const root = el({}, [panel.parentNode]);
    sheet.sync(root, {}, el());
    assert.strictEqual(panel.style.transform, "", "즉시 제자리");
    assert.strictEqual(frames.length, 0, "rAF 를 아예 안 쓴다");
  } finally {
    globalThis.matchMedia = () => ({ matches: false });
  }
});

test("나가는 중에 같은 모달을 다시 열면 새 카드는 제자리에서 시작한다", () => {
  frames = [];
  const first = makeSheet("e");
  const root = el({}, [first.scrim]);
  const layer = el();
  sheet.sync(root, {}, layer);
  pump();                                   // 등장 끝

  const live = sheet.keep(root);
  root.removeChild(first.scrim);
  sheet.sync(el({}), live, layer);          // 닫는 중(아직 안 끝남)
  pump(3);                                  // 몇 프레임만 — 아직 화면에 있다
  assert.strictEqual(first.scrim.parentNode, layer, "아직 나가는 중이어야 한다");

  // 여기서 다시 열었다.
  const second = makeSheet("e");
  sheet.sync(el({}, [second.scrim]), {}, layer);

  // 새 카드는 등장 위치(28px)에서 시작해야 한다 — 나가던 자리를 물려받으면
  // 화면 밖 300px 어딘가에서 뜬다.
  const y = parseFloat(second.panel.style.transform.match(/,\s*([\d.]+)px/)[1]);
  assert.ok(y < 40, `나가던 자리를 물려받았다: ${y}px`);
  pump();
  assert.strictEqual(second.panel.style.transform, "", "새 카드는 제자리에 안착한다");
  assert.strictEqual(first.scrim.parentNode, null, "옛 카드는 끝까지 나가고 지워진다");
});
