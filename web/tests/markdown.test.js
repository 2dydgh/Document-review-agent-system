// 어시스턴트 답 전용 작은 마크다운 — 구조는 입히고 HTML 은 절대 그대로 안 넣는다.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const win = { DR: {} };
new Function('window', fs.readFileSync(path.join(__dirname, '..', 'helpers.js'), 'utf8'))(win);
const md = win.DR.helpers.markdown;

test('표·굵게·목록·인용·코드가 구조로 바뀐다', () => {
  const html = md('## Major 지적 (1건)\n\n| # | 절 | 지적 |\n|---|---|---|\n| f33 | 9절 | 참조번호 **모순** |\n\n- 근거 하나\n- 근거 둘\n\n> "원문 인용"\n\n`get_review` 호출');
  assert.match(html, /<h4>Major 지적 \(1건\)<\/h4>/);
  assert.match(html, /<table><thead><tr><th>#<\/th><th>절<\/th><th>지적<\/th><\/tr><\/thead><tbody><tr><td>f33<\/td><td>9절<\/td><td>참조번호 <strong>모순<\/strong><\/td><\/tr><\/tbody><\/table>/);
  assert.match(html, /<ul><li>근거 하나<\/li><li>근거 둘<\/li><\/ul>/);
  assert.match(html, /<blockquote>&quot;원문 인용&quot;<\/blockquote>/);
  assert.match(html, /<p><code>get_review<\/code> 호출<\/p>/);
});

test('HTML 은 글자로만 남는다', () => {
  const html = md('<script>alert(1)</script> **굵게** <b>x</b>');
  assert.doesNotMatch(html, /<script>|<b>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; <strong>굵게<\/strong> &lt;b&gt;x&lt;\/b&gt;/);
});

test('문단 안 줄바꿈은 <br>, 빈 줄은 문단 나눔', () => {
  assert.equal(md('한 건입니다.\n근거: "x"\n\n둘째'), '<p>한 건입니다.<br>근거: &quot;x&quot;</p><p>둘째</p>');
});

// 마스코트 말풍선 — 지난 판에 돌던 것이 이번 판에 끝났을 때만, 최근 것 하나.
test('막 끝난 검토만 고른다 — 첫 목록·이미 끝나 있던 것·실패는 아니다', () => {
  const nd = win.DR.helpers.newlyDone;
  assert.equal(nd(null, [{ id: 'a', status: 'done' }]), null);
  assert.equal(nd([{ id: 'a', status: 'done' }], [{ id: 'a', status: 'done' }]), null);
  assert.equal(nd([{ id: 'a', status: 'running' }], [{ id: 'a', status: 'error' }]), null);
  const prev = [{ id: 'a', status: 'running' }, { id: 'b', status: 'running' }];
  const next = [{ id: 'a', status: 'done', finished_at: 10 }, { id: 'b', status: 'done', finished_at: 20 }];
  assert.equal(nd(prev, next).id, 'b');
});
