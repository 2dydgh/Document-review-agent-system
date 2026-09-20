(function () {
  "use strict";
  window.DR = window.DR || {};
  var H = window.DR.helpers = {};
  H.esc = function (v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  // 한 문단으로 뭉친 글을 문장 단위로 끊는다. 지적 문장이 길게 나올 때(모델이
  // 판단 과정을 통째로 쏟을 때) 벽처럼 보이는 걸 화면에서 줄로 나누는 데 쓴다.
  //
  // **마침표로 자르면 안 된다.** 이 제품의 글에는 마침표가 문장 끝이 아닌 자리에
  // 수두룩하다 — `500.00 GB` · `01/12. 01/13` · `v1.2`. 그래서 한국어 종결어미
  // (다·요·죠·까) 뒤의 마침표에서만 끊는다. 위 셋은 앞 글자가 종결어미가 아니라
  // 그대로 남는다.
  //
  // 뒤에 공백이 있어야 끊는다 — 문장 끝이라는 증거다. 원래 있던 줄바꿈도 함께
  // 문장 경계로 본다.
  //
  // 못 끊는 것도 분명히 해둔다: 쉼표와 연결어미(…이나, …으나,)로 이어붙인 한
  // 문장은 아무리 길어도 한 덩어리다. 그건 문장이 길어서가 아니라 글이 그렇게
  // 쓰인 것이고, 기계가 끊으면 뜻이 바뀐다.
  H.sentences = function (text) {
    return String(text == null ? "" : text)
      .replace(/((?:다|요|죠|까)[.?!])\s+/g, "$1\n")
      .split(/\n+/)
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
  }
  // 내려받는 파일 이름의 앞부분: `문서명_YYYYMMDD`. 날짜는 검토한 날(이력의 at)이고
  // 없으면 오늘 — 방금 끝난 검토는 오늘 것이다. 검토자는 파일 이름의 날짜로 회차를
  // 관리한다(2026-09-14 품질팀). 서버 xlsx 도 같은 규칙(server._export_stem).
  H.exportStem = function (name, at) {
    var stem = String(name || "document").replace(/\.[^.]+$/, "");
    var d = at ? new Date(at) : new Date();
    if (isNaN(d.getTime())) d = new Date();
    var pad = function (n) { return (n < 10 ? "0" : "") + n; };
    return stem + "_" + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());
  }
  H.downloadBlob = function (name, blob) {
    try {
      var u = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(u); }, 1000);
    } catch (e) { /* noop */ }
  }
  H.download = function (name, text, mime) {
    try {
      var b = new Blob([text], { type: mime });
      var u = URL.createObjectURL(b);
      var a = document.createElement("a");
      a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(u); }, 1000);
    } catch (e) { /* noop */ }
  }
  H.fmtSize = function (n) {
    if (n == null) return "";
    if (n < 1024) return n + " B";
    if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
    return (n / 1048576).toFixed(1) + " MB";
  }
  // Finding.document → 문서 이름 목록. 백엔드가 세 모양으로 낸다:
  //
  //   "시험계획서"                            낱장      (field_presence · fontsize)
  //   "을지 ↔ 갑지"                           쌍 대조   (pairs)
  //   "시험의뢰서 · 시험계획서 · 시험설계서"    전체 대조 (case_wide)
  //
  // 여기 있는 이유는 **두 곳이 같은 규칙을 써야 하기** 때문이다 — 화면(views.js)이
  // "저 문서에서 보기" 버튼을 그리고, 액션(app.js openCaseDoc)이 그 문서의 근거만
  // 골라 뷰어에 넘긴다. 둘이 갈리면 버튼은 뜨는데 눌러도 아무 일이 없다.
  //
  // 예전에는 양쪽 다 `split(" ↔ ")` 하나만 알아서 전체 대조가 한 덩어리로 남았다.
  // 그러면 세 이름이 붙은 버튼이 뜨고, 그 이름의 산출물이 없어 openCaseDoc 이
  // `if (!out) return` 으로 조용히 끝났다. 작성일자 선후 검사가 이 경로다.
  H.docSides = function (document_) {
    return String(document_ == null ? "" : document_)
      .split(/ ↔ | · /)
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
  }
  // 브라우저 뒤로가기(popstate)로 받은 히스토리 항목을 "지금 갈 수 있는 화면"으로
  // 고친다. 항목은 그 화면에 **있었다**는 기록일 뿐, 지금도 갈 수 있다는 보장이
  // 아니다 — 새 검토를 시작해 결과가 비워졌을 수 있고(reviewed), 폴더 검토의
  // 인식 결과가 없을 수도 있다(recog). 화면 이동 가드(app.js go/goCaseStep)와
  // 같은 규칙을 여기 한 곳에 둔다. 순수 함수라 app.js 밖에서도 검사할 수 있다.
  //
  // nav: {mode, screen, cstep, kstep} — 히스토리에 쌓아둔 항목.
  // ctx: {loggedIn, reviewed, hasRecog, hasPayload, hasCrun} — 지금 상태.
  H.resolveNav = function (nav, ctx) {
    nav = nav || {}; ctx = ctx || {};
    var m = nav.mode || "home";
    var isAuth = m === "login" || m === "signup" || m === "forgot";
    // 로그인한 채 로그인 계열 화면으로 되돌리지 않는다 — 로그아웃된 것처럼 보인다.
    if (ctx.loggedIn && isAuth) m = "home";
    // 반대도 막는다: 로그아웃(새로고침) 뒤 뒤로가기의 묵은 항목으로 앱 화면에
    // 들어가면 로그인 없이 홈이 뜬 것처럼 보인다.
    if (!ctx.loggedIn && !isAuth) m = "login";
    var out = { mode: m, screen: "upload", cstep: "setup", kstep: "upload", estep: "setup" };
    if (m === "single") {
      // progress 는 히스토리에 안 쌓지만(지나가는 화면) 혹시 남았으면 결과로.
      out.screen = ctx.reviewed && (nav.screen === "results" || nav.screen === "progress")
        ? "results" : "upload";
    } else if (m === "compare") {
      // 단일과 같은 가드 — 비교를 끝낸 적 없으면 결과 화면 항목도 설정으로 받는다.
      out.cstep = nav.cstep === "results" && ctx.compared ? "results" : "setup";
    } else if (m === "evaluate") {
      // 단일·비교와 같은 가드 — 초안을 만든 적 없으면 결과 항목도 업로드로 받는다.
      out.estep = nav.estep === "results" && ctx.hasDraft ? "results" : "setup";
    } else if (m === "case") {
      var k = nav.kstep || "upload";
      if (k === "progress") k = ctx.hasPayload ? "results" : "recognize";
      if (k === "results" && !ctx.hasPayload) k = "recognize";
      if (k === "recognize" && !ctx.hasRecog) k = "upload";
      out.kstep = k;
    } else if (m === "checklistrun" && !ctx.hasCrun) {
      out.mode = "checklists";      // 채우던 체크리스트가 없으면 라이브러리로
    }
    return out;
  }

  // 요건 ID **예시 하나**로 검사에 쓸 형식(정규식)을 만든다.
  //
  // 검토자에게 정규식을 쓰라고 요구하면 안 된다. 비교 화면이 이미 그 교훈을
  // 남겼다 — "예시가 정규식이라 그걸 쓸 줄 아는 사람만 채울 수 있었다".
  // 기준 작성 화면은 문서가 없어 감지(/api/detect)를 못 하므로, 대신 적은
  // 예시를 **되읽어 보여준다**: 무엇으로 읽었는지 사람 말로 돌려주면 틀렸을 때
  // 그 자리에서 보인다.
  //
  // 마디는 `-` 로 나눈다. 영문 마디는 길이를 그대로 잠근다([A-Z]{3}) —
  // 넓히면(2~4) 다른 체계의 ID 까지 걸려 "누락"이 부풀고, 좁아서 못 찾는 것은
  // TraceabilityChecker 가 "ID 를 한 건도 찾지 못했습니다" 로 알린다. 조용한
  // 0건이 아니라 드러나는 실패라 이쪽이 안전하다. 넓혀야 하면 정규식 칸을 쓴다.
  H.idPatternFrom = function (example) {
    var raw = String(example == null ? "" : example).trim();
    if (!raw) return null;
    var parts = raw.split("-").map(function (seg, i) {
      // **첫 마디는 접두사다.** 요건 종류를 가르는 고정 글자라(RQ·FR·SR) 자리를
      // 열어 주면 남의 체계까지 걸린다 — ax-quality 의 손으로 쓴 형식도
      // `RQ-` 를 리터럴로 둔다.
      if (i === 0) return { seg: seg, rx: seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
                            say: "'" + seg + "'" };
      if (/^[A-Z]+$/.test(seg)) return { seg: seg, rx: "[A-Z]{" + seg.length + "}",
                                         say: "영문 " + seg.length + "자" };
      if (/^[0-9]+$/.test(seg)) return { seg: seg, rx: "\\d{" + seg.length + "}",
                                         say: "숫자 " + seg.length + "자" };
      // 섞였거나 소문자면 그 글자 그대로 고정한다 — 접두사(RQ·FR)가 여기 온다.
      return { seg: seg, rx: seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
               say: "'" + seg + "'" };
    });
    // 마디가 하나뿐이면 형식이랄 게 없다. 그대로 찾는다.
    return { pattern: parts.map(function (p) { return p.rx; }).join("-"),
             say: parts.map(function (p) { return p.say; }).join(" + "),
             parts: parts };
  };

  // 하위 문서가 맡은 요건 범위의 **후보**를 만든다.
  //
  // 검토자는 "맡은 요건 ID 의 공통 앞부분을 적으세요" 라는 말만 보고는 어디서
  // 잘라야 하는지 알 수 없다 — 그건 이 설계서가 무엇을 맡았는지 알아야 정해지고,
  // 그걸 알려고 이 도구를 쓴다. 두 문서를 이미 올렸으니 계산해서 짚어 준다.
  //
  // **앞부분이 아니다.** 검사는 `re.search` 라 ID 아무 자리나 걸린다
  // (agent_trace/rtm.py in_scope). 실측(2026-09-03, PRJX)에서 정답은 네 번째
  // 마디 `-01-` 이었다 — 앞부분만 받는 줄 알면 영영 못 찾는다. 그래서 마디
  // 자리마다 후보를 만든다.
  //
  // 하위 ID 전부가 그 자리에서 같은 값일 때만 후보다. 하나라도 다르면 그
  // 마디로 가르면 자기 요건까지 범위 밖으로 밀려난다.
  H.scopeCandidates = function (upperIds, lowerIds) {
    var up = (upperIds || []).filter(Boolean);
    var low = (lowerIds || []).filter(Boolean);
    if (!up.length || !low.length) return [];
    var segs = low.map(function (id) { return id.split("-"); });
    var n = Math.min.apply(null, segs.map(function (a) { return a.length; }));
    var out = [];
    for (var i = 0; i < n; i++) {
      var v = segs[0][i];
      var same = segs.every(function (a) { return a[i] === v; });
      if (!same || !v) continue;
      // 자리에 맞게 구분자를 붙인다 — `01` 만 찾으면 `RQ-01-…` 의 다른 자리까지
      // 걸린다. 첫 마디는 앞에, 끝 마디는 뒤에 경계가 없다.
      var pat = (i === 0 ? "" : "-") + v + (i === n - 1 ? "" : "-");
      if (out.some(function (c) { return c.pattern === pat; })) continue;
      var inS = up.filter(function (id) { return id.indexOf(pat) >= 0; }).length;
      // 아무것도 못 걸러내면 "전체" 와 같은 말이라 보여 줄 값이 없다.
      if (inS === 0 || inS === up.length) continue;
      out.push({ pattern: pat, inScope: inS, outScope: up.length - inS });
    }
    // 넓은 것부터 — 좁게 자를수록 "범위 밖" 으로 밀리는 요건이 많아지므로
    // 검토자가 위험한 쪽을 나중에 보게 한다.
    out.sort(function (a, b) { return b.inScope - a.inScope; });
    return out;
  };

  // 적어 둔 범위로 상위 요건이 몇 개나 대상이 되는지 센다. 후보를 안 쓰고
  // 직접 적는 사람에게도 같은 숫자를 보여 주기 위한 것 — 적는 동안 결과가
  // 보여야 "뭘 적으라는 건지" 가 풀린다.
  H.scopeCount = function (upperIds, pattern) {
    var up = (upperIds || []).filter(Boolean);
    var pat = String(pattern == null ? "" : pattern).trim();
    if (!up.length) return null;
    if (!pat) return { inScope: up.length, outScope: 0, bad: false };
    var rx;
    try { rx = new RegExp(pat); } catch (_e) { return { bad: true }; }
    var inS = up.filter(function (id) { return rx.test(id); }).length;
    return { inScope: inS, outScope: up.length - inS, bad: false };
  };

  // 작은 마크다운 — 어시스턴트 답 전용. 답은 표·굵게·목록·코드로 온다(DoSuree 실측).
  // 글자를 **먼저 이스케이프**하고 구조만 입힌다 — 모델 출력이라 HTML 은 절대 그대로
  // 안 넣는다. 링크·이미지·HTML 은 일부러 안 받는다.
  H.markdown = function (src) {
    var esc = function (s) {
      return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    };
    var inline = function (s) {
      s = esc(s);
      s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
      s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
      s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
      return s;
    };
    var lines = String(src || "").replace(/\r/g, "").split("\n");
    var out = [], i = 0;
    var isRow = function (l) { return /^\s*\|.*\|\s*$/.test(l); };
    var isSep = function (l) { return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l); };
    var cells = function (r) {
      return r.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(function (c) { return inline(c.trim()); });
    };
    var blockStart = /^\s*(```|#{1,4}\s|>|[-*]\s|\d+[.)]\s|\|)/;
    var rule = /^\s*(-{3,}|\*{3,})\s*$/;
    while (i < lines.length) {
      var l = lines[i];
      if (/^\s*```/.test(l)) {
        var buf = []; i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]);
        i++;
        out.push("<pre><code>" + esc(buf.join("\n")) + "</code></pre>");
        continue;
      }
      var h = /^\s*(#{1,4})\s+(.*)$/.exec(l);
      if (h) { var lv = Math.min(h[1].length + 2, 5); out.push("<h" + lv + ">" + inline(h[2]) + "</h" + lv + ">"); i++; continue; }
      if (rule.test(l)) { out.push("<hr>"); i++; continue; }
      if (isRow(l) && i + 1 < lines.length && isSep(lines[i + 1])) {
        var head = cells(l); i += 2; var rows = [];
        while (i < lines.length && isRow(lines[i])) rows.push(cells(lines[i++]));
        out.push("<table><thead><tr>" + head.map(function (c) { return "<th>" + c + "</th>"; }).join("") +
          "</tr></thead><tbody>" + rows.map(function (r) {
            return "<tr>" + r.map(function (c) { return "<td>" + c + "</td>"; }).join("") + "</tr>";
          }).join("") + "</tbody></table>");
        continue;
      }
      if (/^\s*>\s?/.test(l)) {
        var q = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ""));
        out.push("<blockquote>" + q.map(inline).join("<br>") + "</blockquote>");
        continue;
      }
      var ul = /^\s*[-*]\s+/, ol = /^\s*\d+[.)]\s+/;
      if (ul.test(l) || ol.test(l)) {
        var ordered = ol.test(l), rx = ordered ? ol : ul, items = [];
        while (i < lines.length && rx.test(lines[i])) items.push(lines[i++].replace(rx, ""));
        out.push((ordered ? "<ol>" : "<ul>") + items.map(function (t) { return "<li>" + inline(t) + "</li>"; }).join("") +
          (ordered ? "</ol>" : "</ul>"));
        continue;
      }
      if (!l.trim()) { i++; continue; }
      var para = [];
      while (i < lines.length && lines[i].trim() && !blockStart.test(lines[i]) && !rule.test(lines[i])) para.push(lines[i++]);
      if (!para.length) { para.push(l); i++; }
      out.push("<p>" + para.map(inline).join("<br>") + "</p>");
    }
    return out.join("");
  };

  // 작업 목록 두 판을 대조해 **이번에 막 끝난** 검토 하나를 고른다(마스코트 말풍선용).
  // 지난 판에서 "running" 이던 것이 이번 판에 "done" 이면 그것. 여럿이면 가장 최근에
  // 끝난 것 하나 — 말풍선은 한 번에 하나다. 처음 받은 목록(prev 없음)은 대상이 아니다:
  // 새로고침할 때마다 옛 완료를 다시 알리면 안 된다.
  H.newlyDone = function (prev, next) {
    var running = {};
    (prev || []).forEach(function (j) { if (j.status === "running") running[j.id] = true; });
    var hit = (next || []).filter(function (j) { return running[j.id] && j.status === "done"; });
    hit.sort(function (a, b) { return (b.finished_at || 0) - (a.finished_at || 0); });
    return hit[0] || null;
  };

})();
