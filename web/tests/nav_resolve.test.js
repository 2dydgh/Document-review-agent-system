// 브라우저 뒤로가기(popstate)의 목적지 계산. 실행: node --test web/tests/
//
// 히스토리 항목은 "그 화면에 있었다"는 기록일 뿐, 지금도 갈 수 있다는 보장이
// 아니다 — 그 사이 새 검토가 결과를 비웠을 수 있다. 가드가 무너지면 빈 결과
// 화면(예전엔 가짜 지적 11건)이 뜬다. 그게 이 파일이 지키는 것이다.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const win = {};
new Function("window", fs.readFileSync(path.join(__dirname, "..", "helpers.js"), "utf8"))(win);
const { resolveNav } = win.DR.helpers;

test("결과가 있으면 결과 화면으로 돌아간다", () => {
  const to = resolveNav({ mode: "single", screen: "results" }, { loggedIn: true, reviewed: true });
  assert.equal(to.mode, "single");
  assert.equal(to.screen, "results");
});

test("결과가 비워졌으면 업로드로 받는다 — 빈 결과 화면을 안 띄운다", () => {
  const to = resolveNav({ mode: "single", screen: "results" }, { loggedIn: true, reviewed: false });
  assert.equal(to.screen, "upload");
});

test("로그인한 채 로그인 계열 화면으로는 안 돌아간다", () => {
  for (const m of ["login", "signup", "forgot"]) {
    assert.equal(resolveNav({ mode: m }, { loggedIn: true }).mode, "home",
      `로그아웃처럼 보이면 안 된다: ${m}`);
  }
  // 로그인 전이면 그대로 간다(회원가입 → 뒤로 → 로그인).
  assert.equal(resolveNav({ mode: "signup" }, { loggedIn: false }).mode, "signup");
});

test("로그아웃 뒤 묵은 항목으로는 앱 화면에 못 들어간다", () => {
  // 로그아웃(새로고침) 뒤 뒤로가기 — 로그인 없이 홈이 뜨면 안 된다.
  assert.equal(resolveNav({ mode: "home" }, { loggedIn: false }).mode, "login");
  assert.equal(resolveNav({ mode: "single", screen: "results" }, { loggedIn: false }).mode, "login");
});

test("비교도 끝낸 적 없으면 결과 항목을 설정으로 받는다", () => {
  const ctx = { loggedIn: true };
  assert.equal(resolveNav({ mode: "compare", cstep: "results" }, ctx).cstep, "setup");
  assert.equal(resolveNav({ mode: "compare", cstep: "results" }, { ...ctx, compared: true }).cstep, "results");
});

test("폴더 검토는 도달한 단계까지만 — recog·payload 없이 뒤 단계로 못 간다", () => {
  const ctx = { loggedIn: true };
  assert.equal(resolveNav({ mode: "case", kstep: "results" }, ctx).kstep, "upload");
  assert.equal(resolveNav({ mode: "case", kstep: "recognize" }, { ...ctx, hasRecog: true }).kstep, "recognize");
  assert.equal(resolveNav({ mode: "case", kstep: "results" }, { ...ctx, hasRecog: true, hasPayload: true }).kstep, "results");
  // progress 는 지나가는 화면 — 결과가 있으면 결과로, 없으면 인식 확인으로.
  assert.equal(resolveNav({ mode: "case", kstep: "progress" }, { ...ctx, hasRecog: true, hasPayload: true }).kstep, "results");
  assert.equal(resolveNav({ mode: "case", kstep: "progress" }, { ...ctx, hasRecog: true }).kstep, "recognize");
});

test("채우던 체크리스트가 없으면 checklistrun 대신 라이브러리로", () => {
  assert.equal(resolveNav({ mode: "checklistrun" }, { loggedIn: true, hasCrun: false }).mode, "checklists");
  assert.equal(resolveNav({ mode: "checklistrun" }, { loggedIn: true, hasCrun: true }).mode, "checklistrun");
});

test("빈 항목도 어디로든 가긴 간다 — 로그인했으면 홈, 아니면 로그인", () => {
  assert.equal(resolveNav(null, { loggedIn: true }).mode, "home");
  assert.equal(resolveNav(null, {}).mode, "login");
});
