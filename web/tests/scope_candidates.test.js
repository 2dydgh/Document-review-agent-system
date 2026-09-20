// 하위 문서가 맡은 요건 범위를 화면이 짚어 준다.
//
// 검토자는 "공통 앞부분을 적으세요" 라는 말만 보고는 어디서 잘라야 하는지 알 수
// 없다. 두 문서를 이미 올렸으니 계산해 준다. 검사는 re.search 라 **앞부분이
// 아니라 아무 자리**가 걸린다 — 실측(PRJX)의 정답은 네 번째 마디였다.
// 실행: node --test "web/tests/*.test.js"
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

// 실측 그대로: 상위 요구사항명세서는 -01- 과 -03- 이 섞였고, 하위 상세설계서
// (S2-1)는 -01- 만 맡는다.
const UPPER = [
  "RQ-SFR-PR-01-001", "RQ-SFR-PR-01-002", "RQ-SER-PR-01-001", "RQ-SQR-PR-01-001",
  "RQ-SFR-PR-03-001", "RQ-SFR-PR-03-002", "RQ-ECR-PR-03-001", "RQ-SQR-PR-03-001",
];
const LOWER = ["RQ-SFR-PR-01-001", "RQ-SER-PR-01-001", "RQ-SQR-PR-01-002"];

test("네 번째 마디를 후보로 짚는다 — 앞부분이 아니다", () => {
  const got = H.scopeCandidates(UPPER, LOWER);

  const four = got.filter((c) => c.pattern === "-01-")[0];
  assert.ok(four, "네 번째 마디 후보가 없다: " + JSON.stringify(got));
  assert.strictEqual(four.inScope, 4);
  assert.strictEqual(four.outScope, 4);
});

test("아무것도 못 걸러내는 후보는 안 낸다", () => {
  const got = H.scopeCandidates(UPPER, LOWER);

  // 접두사 RQ 는 상위 전부에 있다 — "전체" 와 같은 말이라 보여 줄 값이 없다.
  assert.ok(!got.some((c) => c.pattern === "RQ-"), JSON.stringify(got));
  // PR 도 마찬가지.
  assert.ok(!got.some((c) => c.pattern === "-PR-"), JSON.stringify(got));
});

test("하위에서 값이 갈리는 마디는 후보가 아니다", () => {
  // 두 번째 마디가 SFR·SER·SQR 로 갈린다 — 그걸로 가르면 자기 요건이 밀려난다.
  const got = H.scopeCandidates(UPPER, LOWER);

  assert.ok(!got.some((c) => c.pattern.indexOf("SFR") >= 0), JSON.stringify(got));
});

test("넓은 것부터 보여준다", () => {
  const got = H.scopeCandidates(
    UPPER, ["RQ-SFR-PR-01-001", "RQ-SFR-PR-01-002"]);

  for (let i = 1; i < got.length; i++) {
    assert.ok(got[i - 1].inScope >= got[i].inScope, JSON.stringify(got));
  }
});

test("문서가 없으면 후보도 없다", () => {
  assert.deepStrictEqual(H.scopeCandidates([], LOWER), []);
  assert.deepStrictEqual(H.scopeCandidates(UPPER, []), []);
  assert.deepStrictEqual(H.scopeCandidates(null, null), []);
});

// ── 직접 적는 사람에게도 같은 숫자를 보여준다 ─────────────────────────────

test("적어 둔 범위로 몇 개가 대상인지 센다", () => {
  const got = H.scopeCount(UPPER, "-01-");

  assert.strictEqual(got.inScope, 4);
  assert.strictEqual(got.outScope, 4);
  assert.strictEqual(got.bad, false);
});

test("비우면 전부 대상이다", () => {
  const got = H.scopeCount(UPPER, "");

  assert.strictEqual(got.inScope, UPPER.length);
  assert.strictEqual(got.outScope, 0);
});

test("정규식이 깨졌으면 숫자를 지어내지 않는다", () => {
  // 0건으로 보여 주면 "이 범위엔 요건이 없다" 는 거짓말이 된다.
  const got = H.scopeCount(UPPER, "RQ-[");

  assert.strictEqual(got.bad, true);
  assert.strictEqual(got.inScope, undefined);
});
