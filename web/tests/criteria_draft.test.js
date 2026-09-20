// 추가 기준 직접 작성 카드. **검토자에게 정규식을 요구하지 않는다** — 비교
// 화면이 남긴 교훈이다("예시가 정규식이라 그걸 쓸 줄 아는 사람만 채울 수
// 있었다"). 이 화면은 문서가 없어 감지를 못 하므로, 적은 예시를 되읽어 돌려주는
// 것이 유일한 확인 수단이다. 실행: node --test "web/tests/*.test.js"
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

function read(name) {
  return fs.readFileSync(path.join(__dirname, "..", name), "utf8");
}

function views(cdraft) {
  const win = { DR: {}, location: { protocol: "http:", href: "http://x/" } };
  win.DR.ICONS = new Proxy({}, { get: () => "<svg/>" });
  // 진짜 helpers 를 쓴다 — idPatternFrom 이 이 화면의 본체라 흉내 내면 뜻이 없다.
  new Function("window", read("helpers.js"))(win);
  win.DR.helpers.rgba = () => "";
  win.DR.helpers.fmtSize = () => "1KB";
  win.DR.helpers.download = () => {};
  win.DR.helpers.downloadBlob = () => {};
  win.DR.helpers.docSides = () => ({});
  win.DR.helpers.sentences = (s) => [String(s == null ? "" : s)];
  new Function("window", read("views.js"))(win);
  return win.DR.views({
    state: { cdraft: cdraft }, props: { accent: "#356998" }, render: () => {},
    backend: { errorBanner: (e) => "<err>" + e + "</err>", ago: () => "",
               fmtElapsed: () => "" },
  });
}

const EMPTY = { name: "", idExample: "", idPattern: "", scope: "",
                items: [{ text: "", mode: "사람" }] };
const draft = (over) => Object.assign({}, EMPTY, over);

test("아직 안 적었으면 무엇을 적으라는지 말한다", () => {
  const out = views(draft()).idReadback(draft());

  assert.ok(out.includes("예시를 적으면"), out);
  // 빈 상태에서 "정규식"이라는 말이 먼저 보이면 안 된다 — 그 낱말이 이 화면을
  // 못 쓰게 만들었다.
  assert.ok(!out.includes("정규식"), "빈 되읽기에 정규식이라는 말이 새어 나온다");
});

test("예시를 적으면 무엇으로 읽었는지 사람 말로 돌려준다", () => {
  const out = views(draft()).idReadback(draft({ idExample: "RQ-SFR-PR-01-001" }));

  assert.ok(out.includes("이렇게 읽었습니다"), out);
  assert.ok(out.includes("영문 3자"), out);
  assert.ok(out.includes("숫자 3자"), out);
  // 정규식을 사람에게 들이밀지 않는다.
  assert.ok(!out.includes("[A-Z]"), "되읽기에 정규식이 그대로 새어 나온다");
});

test("정규식을 직접 쓰면 그쪽을 쓴다고 말한다", () => {
  const out = views(draft()).idReadback(
    draft({ idExample: "RQ-SFR-PR-01-001", idPattern: "RQ-[A-Z]{2,4}-\\d+" }));

  assert.ok(out.includes("직접 쓴 형식"), out);
  assert.ok(out.includes("RQ-[A-Z]{2,4}"), "직접 쓴 형식을 보여 주지 않는다");
});

test("되읽기 줄에 갈아끼울 표식이 있다", () => {
  // app.js 가 이 표식으로 이 줄만 바꾼다. 없으면 타이핑마다 render() 가 돌아
  // 한글 조합과 커서가 날아간다.
  const out = views(draft()).idReadback(draft({ idExample: "RQ-A-01" }));

  assert.match(out, /data-idread/);
});
