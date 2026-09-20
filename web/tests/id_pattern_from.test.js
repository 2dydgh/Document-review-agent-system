// 요건 ID 예시 하나로 검사 형식을 만든다. 검토자는 정규식을 못 쓴다 — 비교
// 화면이 남긴 교훈("예시가 정규식이라 그걸 쓸 줄 아는 사람만 채울 수 있었다")을
// 기준 작성 화면에도 적용한 것. 실행: node --test "web/tests/*.test.js"
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

function helpers() {
  const win = {};
  new Function("window", fs.readFileSync(
    path.join(__dirname, "..", "helpers.js"), "utf8"))(win);
  return win.DR.helpers;
}

const H = helpers();

test("PRJX 예시가 팀 기준과 같은 자리를 잡는다", () => {
  const got = H.idPatternFrom("RQ-SFR-PR-01-001");

  assert.strictEqual(got.pattern, "RQ-[A-Z]{3}-[A-Z]{2}-\\d{2}-\\d{3}");
  // 만든 형식이 예시 자신을 실제로 잡아야 한다 — 안 그러면 화면이 거짓말을 한다.
  assert.match("RQ-SFR-PR-01-001", new RegExp(got.pattern));
  // 같은 체계의 다른 ID 도 잡는다.
  assert.match("RQ-ECR-PR-03-002", new RegExp(got.pattern));
});

test("사람 말로 되읽어 준다", () => {
  const got = H.idPatternFrom("RQ-SFR-PR-01-001");

  assert.strictEqual(got.say, "'RQ' + 영문 3자 + 영문 2자 + 숫자 2자 + 숫자 3자");
});

test("접두사가 달라도 그대로 고정한다", () => {
  // 팀마다 접두사가 다르다(FR-·SR-·RQ-). 코드가 RQ 를 알고 있으면 안 된다.
  const got = H.idPatternFrom("FR-GC-01");

  assert.strictEqual(got.pattern, "FR-[A-Z]{2}-\\d{2}");
  assert.match("FR-GC-01", new RegExp(got.pattern));
});

test("길이를 잠근다 — 넓히지 않는다", () => {
  // 넓히면(예: [A-Z]{2,4}) 다른 체계까지 걸려 "누락"이 부풀어 오른다.
  // 못 찾는 실패는 TraceabilityChecker 가 드러내므로 좁은 쪽이 안전하다.
  const rx = new RegExp("^" + H.idPatternFrom("RQ-SFR-PR-01-001").pattern + "$");

  assert.ok(!rx.test("RQ-SF-PR-01-001"), "영문 2자를 잡으면 너무 넓다");
  assert.ok(!rx.test("RQ-SFRX-PR-01-001"), "영문 4자를 잡으면 너무 넓다");
});

test("정규식 특수문자가 든 마디는 글자 그대로 고정한다", () => {
  // 접두사에 점·괄호가 든 체계가 있다. 이스케이프를 빠뜨리면 만든 형식이
  // 엉뚱한 것을 잡는다.
  const got = H.idPatternFrom("A.B-01");

  assert.strictEqual(got.pattern, "A\\.B-\\d{2}");
  assert.match("A.B-07", new RegExp("^" + got.pattern + "$"));
  assert.ok(!new RegExp("^" + got.pattern + "$").test("AXB-07"));
});

test("마디가 하나면 그 글자를 그대로 찾는다", () => {
  const got = H.idPatternFrom("SR001");

  assert.strictEqual(got.pattern, "SR001");
});

test("빈 값은 형식이 없다", () => {
  assert.strictEqual(H.idPatternFrom(""), null);
  assert.strictEqual(H.idPatternFrom("   "), null);
  assert.strictEqual(H.idPatternFrom(null), null);
});
