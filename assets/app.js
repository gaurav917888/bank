/* ============================================================
   Full Mock Test - app logic
   - loads a question bank (data/*.json) and caches it in
     localStorage for fast, offline-friendly reuse
   - two sections (tabs), each palette split into subsections
   - instant solution reveal on answering
   ============================================================ */
(function () {
  "use strict";

  var LS_BANK = "mockbank_v1";
  var LS_STATE = "mockstate_v1";
  var OPT = ["A", "B", "C", "D", "E", "F"];

  /* ---------------- tiny helpers ---------------- */
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function readLS(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function writeLS(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function fmtClock(s) { s = Math.max(0, Math.floor(s)); return pad(Math.floor(s / 3600)) + ":" + pad(Math.floor(s / 60) % 60) + ":" + pad(s % 60); }
  function fmtShort(s) { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ":" + pad(s % 60); }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

  /* ---------------- app state ---------------- */
  var bank = null;        // { title, subtitle, sections, groups, questions }
  var bySection = {};     // sectionId -> [questions]
  var qById = {};
  var state = null;
  var tickQid = null;     // question whose timer is running
  var globalTimer = null;
  var saveThrottle = 0;

  /* ============================================================
     LOADING
     ============================================================ */
  function setDataMsg(msg, ok) {
    var box = $("#datastate");
    if (!box) return;
    box.innerHTML = (ok ? '<span class="okdot"></span>' : '<div class="spinner"></div>') +
      '<span id="dataMsg">' + msg + "</span>";
  }

  function fetchJSON(url) {
    return fetch(url, { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error(url + " -> " + r.status);
      return r.json();
    });
  }

  function loadBank() {
    var cache = readLS(LS_BANK);
    return fetchJSON("data/manifest.json")
      .then(function (manifest) {
        if (cache && cache.version === manifest.version && cache.questions && cache.questions.length) {
          setDataMsg("Question bank loaded from this browser (cached) \u2014 " + cache.questions.length + " questions.", true);
          return cache;
        }
        return fetchAll(manifest).then(function (b) {
          writeLS(LS_BANK, b);
          setDataMsg("Question bank downloaded & saved in this browser \u2014 " + b.questions.length + " questions.", true);
          return b;
        });
      })
      .catch(function (err) {
        if (cache && cache.questions && cache.questions.length) {
          setDataMsg("Offline \u2014 using the saved question bank (" + cache.questions.length + " questions).", true);
          return cache;
        }
        setDataMsg("Could not load the question bank. If you opened this file directly, host it on GitHub Pages (or any web server) so the data files can be read.", false);
        throw err;
      });
  }

  function fetchAll(manifest) {
    return Promise.all(manifest.files.map(fetchJSON)).then(function (files) {
      var groups = {};
      var questions = [];
      files.forEach(function (file) {
        (file.groups || []).forEach(function (g) { groups[g.id] = g; });
        (file.questions || []).forEach(function (q) {
          if (!q.source && file.source) q.source = file.source;
          questions.push(q);
        });
      });
      return {
        version: manifest.version,
        savedAt: new Date().toISOString(),
        title: manifest.title || "Full Mock Test",
        subtitle: manifest.subtitle || "",
        sections: manifest.sections || [],
        groups: groups,
        questions: questions
      };
    });
  }

  /* ============================================================
     STATE
     ============================================================ */
  function freshState() {
    var pos = {}, ans = {}, times = {};
    return {
      started: false,
      submitted: false,
      activeSection: bank.sections.length ? bank.sections[0].id : null,
      answers: ans,
      times: times,
      pos: pos,
      elapsed: 0,
      reviewFilter: "all",
      reviewIdx: 0
    };
  }

  function saveState() {
    if (!state) return;
    writeLS(LS_STATE, state);
    flashSaved();
  }
  function flashSaved() {
    var t = $("#savedTip");
    if (!t) return;
    t.classList.add("show");
    clearTimeout(t._h);
    t._h = setTimeout(function () { t.classList.remove("show"); }, 900);
  }

  function loadState() {
    var s = readLS(LS_STATE);
    if (s && s.answers) {
      // keep only answers that still exist in the bank
      Object.keys(s.answers).forEach(function (k) { if (!qById[k]) delete s.answers[k]; });
      if (!s.pos) s.pos = {};
      if (!s.times) s.times = {};
      if (typeof s.elapsed !== "number") s.elapsed = 0;
      return s;
    }
    return null;
  }

  /* ============================================================
     INDICES
     ============================================================ */
  function buildIndices() {
    bySection = {}; qById = {};
    bank.sections.forEach(function (s) { bySection[s.id] = []; });
    bank.questions.forEach(function (q) {
      if (!bySection[q.section]) bySection[q.section] = [];
      bySection[q.section].push(q);
      qById[q.id] = q;
    });
  }
  function sectionMeta(id) {
    for (var i = 0; i < bank.sections.length; i++) if (bank.sections[i].id === id) return bank.sections[i];
    return null;
  }
  function subName(sectionId, subId) {
    var s = sectionMeta(sectionId);
    if (!s) return subId;
    for (var i = 0; i < s.subsections.length; i++) if (s.subsections[i].id === subId) return s.subsections[i].name;
    return subId;
  }
  function attemptedCount() { return Object.keys(state.answers).length; }
  function sectionQ(sectionId) { return bySection[sectionId] || []; }

  /* ============================================================
     TIMERS
     ============================================================ */
  function startGlobalTimer() {
    if (globalTimer) return;
    globalTimer = setInterval(function () {
      if (state.started && !state.submitted && !$("#scrTest").classList.contains("hidden")) {
        state.elapsed++;
        $("#tTotal").textContent = fmtClock(state.elapsed);
        if (tickQid && !state.answers[tickQid]) {
          state.times[tickQid] = (state.times[tickQid] || 0) + 1;
          var cur = currentQ();
          if (cur && cur.id === tickQid) $("#qTime").innerHTML = "\u23F1 " + fmtShort(state.times[tickQid]) + " on this question";
        }
        saveThrottle++;
        if (saveThrottle >= 5) { saveThrottle = 0; writeLS(LS_STATE, state); }
      }
    }, 1000);
  }

  /* ============================================================
     CURRENT QUESTION
     ============================================================ */
  function currentQ() {
    var list = sectionQ(state.activeSection);
    if (!list.length) return null;
    var i = state.pos[state.activeSection] || 0;
    if (i < 0) i = 0;
    if (i >= list.length) i = list.length - 1;
    return list[i];
  }
  function currentIndex() { return state.pos[state.activeSection] || 0; }

  /* ============================================================
     RENDER: header, tabs, palette
     ============================================================ */
  function renderTabs() {
    var tabs = $("#tabs");
    tabs.innerHTML = "";
    bank.sections.forEach(function (s) {
      var list = sectionQ(s.id);
      var att = list.filter(function (q) { return state.answers[q.id]; }).length;
      var b = el("button", "tab" + (s.id === state.activeSection ? " on" : ""));
      b.innerHTML = '<span class="dot"></span>' + s.name + '<span class="cnt">' + att + "/" + list.length + "</span>";
      b.addEventListener("click", function () { switchSection(s.id); });
      tabs.appendChild(b);
    });
  }

  function switchSection(id) {
    if (state.activeSection === id) return;
    state.activeSection = id;
    if (state.pos[id] == null) state.pos[id] = 0;
    saveState();
    renderTabs();
    renderPalette();
    renderQuestion();
  }

  function renderPalette() {
    var wrap = $("#palette");
    wrap.innerHTML = "";
    var s = sectionMeta(state.activeSection);
    var list = sectionQ(state.activeSection);
    var cur = currentQ();
    var numbered = {}; list.forEach(function (q, i) { numbered[q.id] = i + 1; });

    (s.subsections || []).forEach(function (sub) {
      var qs = list.filter(function (q) { return q.subsection === sub.id; });
      if (!qs.length) return;
      var sec = el("div", "subsec");
      sec.appendChild(el("h4", null, sub.name + " \u00B7 " + qs.length));
      var grid = el("div", "pgrid");
      qs.forEach(function (q) {
        var b = el("button", "pbtn", String(numbered[q.id]));
        if (cur && cur.id === q.id) b.classList.add("cur");
        if (state.answers[q.id]) b.classList.add(state.answers[q.id] === q.answer ? "ok" : "no");
        b.addEventListener("click", function () { jumpTo(q.id); });
        grid.appendChild(b);
      });
      sec.appendChild(grid);
      wrap.appendChild(sec);
    });

    $("#palCount").textContent = list.filter(function (q) { return state.answers[q.id]; }).length + "/" + list.length;
    $("#progTxt").textContent = attemptedCount() + " attempted";
    $("#progFill").style.width = (bank.questions.length ? (attemptedCount() / bank.questions.length * 100) : 0) + "%";
    $("#tAtt").textContent = attemptedCount();
  }

  function jumpTo(qid) {
    var q = qById[qid];
    if (!q) return;
    if (q.section !== state.activeSection) {
      state.activeSection = q.section;
      renderTabs();
    }
    var list = sectionQ(q.section);
    state.pos[q.section] = list.indexOf(q);
    saveState();
    renderPalette();
    renderQuestion();
    closeDrawer();
  }

  /* ============================================================
     RENDER: question
     ============================================================ */
  function renderQuestion() {
    var q = currentQ();
    var card = $("#qcard");
    if (!q) { card.innerHTML = "<p>No questions in this section.</p>"; return; }

    var list = sectionQ(state.activeSection);
    var idx = currentIndex();
    $("#qTag").innerHTML = "Question " + (idx + 1) + " of " + list.length +
      ' <span style="color:var(--mut);font-weight:600">\u00B7 ' + subName(q.section, q.subsection) + "</span>";

    // passage / group
    var pass = $("#passage");
    pass.innerHTML = "";
    if (q.group && bank.groups[q.group]) {
      var g = bank.groups[q.group];
      var box = el("div", "passage");
      box.innerHTML = (g.label ? '<div class="plabel">' + g.label + "</div>" : "") +
        (g.text || "") + (g.image ? '<img class="qimg" src="' + g.image + '" alt="">' : "");
      pass.appendChild(box);
    }

    $("#qText").innerHTML = (q.question || "") + (q.image ? '<img class="qimg" src="' + q.image + '" alt="">' : "");

    // options + feedback
    renderOptions(q);
    renderFeedback(q);

    // chips
    $("#qTime").innerHTML = "\u23F1 " + fmtShort(state.times[q.id] || 0) + " on this question";
    updateStateChip(q);

    // tick the current unanswered question
    tickQid = state.answers[q.id] ? null : q.id;

    // nav buttons
    $("#btnPrev").disabled = idx <= 0;
    $("#btnNext").disabled = idx >= list.length - 1;

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function updateStateChip(q) {
    var c = $("#qAnsState");
    c.className = "chip";
    if (!state.answers[q.id]) { c.textContent = "Not answered"; c.classList.add("chip"); }
    else if (state.answers[q.id] === q.answer) { c.textContent = "Correct"; c.classList.add("state-ok"); }
    else { c.textContent = "Wrong"; c.classList.add("state-no"); }
  }

  function renderOptions(q) {
    var box = $("#feedback");
    var opts = el("div", "opts");
    var picked = state.answers[q.id];
    var revealed = !!picked;
    (q.options || []).forEach(function (text, i) {
      var letter = OPT[i];
      var b = el("button", "opt");
      b.innerHTML = '<span class="key">' + letter + '</span><span>' + text + "</span>";
      if (revealed) {
        b.disabled = true;
        if (letter === q.answer) { b.classList.add("correct"); b.appendChild(el("span", "mk", "Correct \u2713")); }
        else if (letter === picked) { b.classList.add("wrongpick"); b.appendChild(el("span", "mk", "Your answer \u2717")); }
      } else {
        b.addEventListener("click", function () { answer(q.id, letter); });
      }
      opts.appendChild(b);
    });
    // place options before feedback
    var fb = $("#feedback");
    var old = $("#optsBlock");
    if (old) old.remove();
    opts.id = "optsBlock";
    $("#qText").parentNode.insertBefore(opts, fb);
  }

  function renderFeedback(q) {
    var fb = $("#feedback");
    fb.innerHTML = "";
    var picked = state.answers[q.id];
    if (!picked) return;
    var ok = picked === q.answer;
    var head = el("div", "fbhead " + (ok ? "ok" : "no"));
    head.innerHTML = '<span class="ico">' + (ok ? "\u2713" : "\u2717") + "</span>" +
      (ok ? "Correct!" : "Not quite \u2014 correct answer is " + q.answer) +
      '<span class="sub">' + subName(q.section, q.subsection) + "</span>";
    fb.appendChild(head);

    var sol = el("div", "sol");
    sol.innerHTML = '<div class="solhead">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/></svg>' +
      "Step-by-step solution</div>" +
      '<div class="solbody">' + (q.solution || "No solution provided.") +
      (q.solutionImage ? '<img class="qimg" src="' + q.solutionImage + '" alt="">' : "") + "</div>";
    fb.appendChild(sol);
  }

  /* ============================================================
     ANSWERING
     ============================================================ */
  function answer(qid, letter) {
    if (state.submitted) return;
    state.answers[qid] = letter;
    tickQid = null; // stop per-question timer
    saveState();
    var q = qById[qid];
    renderOptions(q);
    renderFeedback(q);
    updateStateChip(q);
    renderPalette();
    renderTabs();
  }

  function clearResponse() {
    var q = currentQ();
    if (!q) return;
    delete state.answers[q.id];
    saveState();
    renderOptions(q);
    renderFeedback(q);
    updateStateChip(q);
    renderPalette();
    renderTabs();
    tickQid = q.id;
  }

  function go(delta) {
    var list = sectionQ(state.activeSection);
    var i = currentIndex() + delta;
    if (i < 0 || i >= list.length) return;
    state.pos[state.activeSection] = i;
    saveState();
    renderPalette();
    renderQuestion();
  }

  /* ============================================================
     SUBMIT / RESULT
     ============================================================ */
  function computeResult() {
    var res = { total: bank.questions.length, correct: 0, wrong: 0, skipped: 0, bySection: {} };
    bank.sections.forEach(function (s) {
      res.bySection[s.id] = { name: s.name, total: 0, correct: 0, wrong: 0, skipped: 0, subs: {} };
      (s.subsections || []).forEach(function (sub) {
        res.bySection[s.id].subs[sub.id] = { name: sub.name, total: 0, correct: 0, wrong: 0, skipped: 0 };
      });
    });
    bank.questions.forEach(function (q) {
      var a = state.answers[q.id];
      var bucket = res.bySection[q.section];
      if (bucket) {
        bucket.total++;
        var sb = bucket.subs[q.subsection];
        if (sb) sb.total++;
      }
      if (!a) { res.skipped++; if (bucket) { bucket.skipped++; if (bucket.subs[q.subsection]) bucket.subs[q.subsection].skipped++; } }
      else if (a === q.answer) { res.correct++; if (bucket) { bucket.correct++; if (bucket.subs[q.subsection]) bucket.subs[q.subsection].correct++; } }
      else { res.wrong++; if (bucket) { bucket.wrong++; if (bucket.subs[q.subsection]) bucket.subs[q.subsection].wrong++; } }
    });
    return res;
  }

  function showResult() {
    state.submitted = true;
    saveState();
    var r = computeResult();
    $("#scrTest").classList.add("hidden");
    $("#hud").style.display = "none";
    $("#scrWelcome").classList.add("hidden");
    $("#scrResult").classList.remove("hidden");

    $("#rScore").textContent = r.correct;
    $("#rOutOf").textContent = "out of " + r.total;
    var pct = r.total ? Math.round(r.correct / r.total * 100) : 0;
    $("#rSub").textContent = "You scored " + pct + "% of the full paper \u00B7 " + r.correct + " correct, " + r.wrong + " wrong, " + r.skipped + " skipped.";
    $("#rTime").textContent = fmtClock(state.elapsed);
    $("#rCorrect").textContent = r.correct;
    $("#rWrong").textContent = r.wrong;
    $("#rSkip").textContent = r.skipped;
    var att = r.correct + r.wrong;
    $("#rAcc").textContent = att ? Math.round(r.correct / att * 100) + "%" : "0%";
    $("#rAvg").textContent = fmtShort(r.total ? state.elapsed / r.total : 0);

    // ring
    var C = 534;
    var arc = $("#ringArc");
    arc.setAttribute("stroke-dashoffset", C);
    setTimeout(function () { arc.setAttribute("stroke-dashoffset", String(C - C * (pct / 100))); }, 60);

    // breakdown table
    var t = $("#brkTable");
    var rows = '<thead><tr><th>Part</th><th>Total</th><th>Correct</th><th>Wrong</th><th>Skipped</th><th>Accuracy</th><th class="barcell">Correct / Wrong</th></tr></thead><tbody>';
    bank.sections.forEach(function (s) {
      var b = r.bySection[s.id];
      rows += rowHtml(s.name, b, true);
      (s.subsections || []).forEach(function (sub) {
        var sb = b.subs[sub.id];
        if (sb && sb.total) rows += rowHtml("&nbsp;&nbsp;&nbsp;\u21B3 " + sub.name, sb, false);
      });
    });
    rows += "</tbody>";
    t.innerHTML = rows;

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function rowHtml(label, b, strong) {
    var att = b.correct + b.wrong;
    var acc = att ? Math.round(b.correct / att * 100) + "%" : "\u2013";
    var cw = b.correct + b.wrong;
    var gp = cw ? (b.correct / cw * 100) : 0;
    return "<tr>" +
      "<td style='" + (strong ? "font-weight:700" : "color:var(--mut)") + "'>" + label + "</td>" +
      "<td>" + b.total + "</td>" +
      "<td style='color:var(--green);font-weight:700'>" + b.correct + "</td>" +
      "<td style='color:var(--red);font-weight:700'>" + b.wrong + "</td>" +
      "<td>" + b.skipped + "</td>" +
      "<td>" + acc + "</td>" +
      "<td><div class='minibar'><i class='bg' style='width:" + gp + "%'></i><i class='br' style='width:" + (100 - gp) + "%'></i></div></td>" +
      "</tr>";
  }

  /* ============================================================
     REVIEW
     ============================================================ */
  function reviewList() {
    var f = state.reviewFilter;
    return bank.questions.filter(function (q) {
      var a = state.answers[q.id];
      if (f === "wrong") return a && a !== q.answer;
      if (f === "correct") return a && a === q.answer;
      if (f === "skipped") return !a;
      return true;
    });
  }

  function renderReview() {
    var list = reviewList();
    if (!list.length) {
      $("#rvTag").textContent = "Nothing in this filter";
      $("#rvPassage").innerHTML = "";
      $("#rvText").innerHTML = "<p style='color:var(--mut)'>No questions match this filter.</p>";
      $("#rvFeedback").innerHTML = "";
      return;
    }
    if (state.reviewIdx >= list.length) state.reviewIdx = 0;
    var q = list[state.reviewIdx];
    $("#rvTag").innerHTML = "Review " + (state.reviewIdx + 1) + " of " + list.length +
      ' <span style="color:var(--mut);font-weight:600">\u00B7 ' + sectionMeta(q.section).name + " / " + subName(q.section, q.subsection) + "</span>";

    var rp = $("#rvPassage");
    rp.innerHTML = "";
    if (q.group && bank.groups[q.group]) {
      var g = bank.groups[q.group];
      var box = el("div", "passage");
      box.innerHTML = (g.label ? '<div class="plabel">' + g.label + "</div>" : "") + (g.text || "") +
        (g.image ? '<img class="qimg" src="' + g.image + '" alt="">' : "");
      rp.appendChild(box);
    }
    $("#rvText").innerHTML = (q.question || "") + (q.image ? '<img class="qimg" src="' + q.image + '" alt="">' : "");

    var picked = state.answers[q.id];
    var opts = el("div", "opts");
    (q.options || []).forEach(function (text, i) {
      var letter = OPT[i];
      var b = el("button", "opt");
      b.disabled = true;
      b.innerHTML = '<span class="key">' + letter + '</span><span>' + text + "</span>";
      if (letter === q.answer) { b.classList.add("correct"); b.appendChild(el("span", "mk", "Correct \u2713")); }
      else if (letter === picked) { b.classList.add("wrongpick"); b.appendChild(el("span", "mk", "Your answer \u2717")); }
      opts.appendChild(b);
    });

    var fb = $("#rvFeedback");
    fb.innerHTML = "";
    fb.appendChild(opts);
    var sol = el("div", "sol");
    sol.style.marginTop = "16px";
    sol.innerHTML = '<div class="solhead">Step-by-step solution</div><div class="solbody">' +
      (q.solution || "No solution provided.") + "</div>";
    fb.appendChild(sol);

    $("#rvPrev").disabled = state.reviewIdx <= 0;
    $("#rvNext").disabled = state.reviewIdx >= list.length - 1;
  }

  /* ============================================================
     SCREENS
     ============================================================ */
  function showWelcome() {
    $("#scrWelcome").classList.remove("hidden");
    $("#scrTest").classList.add("hidden");
    $("#scrResult").classList.add("hidden");
    $("#scrReview").classList.add("hidden");
    $("#hud").style.display = "none";
    $("#progresswrap").style.display = "none";
    refreshWelcomeButtons();
  }

  function refreshWelcomeButtons() {
    var started = state && state.started;
    var any = state && attemptedCount() > 0;
    $("#btnStart").classList.toggle("hidden", started || any);
    $("#btnResume").classList.toggle("hidden", !(started || any));
    $("#btnFresh").classList.toggle("hidden", !any && !started);
    $("#statQ").textContent = bank ? bank.questions.length : 0;
  }

  function startTest(resume) {
    if (!resume) { /* keep state */ }
    state.started = true;
    state.submitted = false;
    state.activeSection = state.activeSection || bank.sections[0].id;
    if (state.pos[state.activeSection] == null) state.pos[state.activeSection] = 0;
    saveState();

    $("#scrWelcome").classList.add("hidden");
    $("#scrResult").classList.add("hidden");
    $("#scrReview").classList.add("hidden");
    $("#scrTest").classList.remove("hidden");
    $("#hud").style.display = "flex";
    $("#progresswrap").style.display = "flex";

    $("#tTotal").textContent = fmtClock(state.elapsed);
    $("#tTot").textContent = bank.questions.length;
    renderTabs();
    renderPalette();
    renderQuestion();
    startGlobalTimer();
  }

  function restartTest() {
    confirmModal("Retake the test?", "This clears your saved answers and timers and starts a fresh attempt.", function () {
      state = freshState();
      saveState();
      startTest(false);
    });
  }

  /* ============================================================
     DRAWER + MODAL + TOAST
     ============================================================ */
  function openDrawer() { $("#sidebar").classList.add("open"); $("#scrim").classList.add("on"); }
  function closeDrawer() { $("#sidebar").classList.remove("open"); $("#scrim").classList.remove("on"); }

  var modalYes = null;
  function confirmModal(title, body, onYes) {
    $("#mTitle").textContent = title;
    $("#mBody").textContent = body;
    modalYes = onYes;
    $("#modal").classList.remove("hidden");
  }
  function closeModal() { $("#modal").classList.add("hidden"); modalYes = null; }

  var toastH;
  function toast(msg) {
    var t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastH);
    toastH = setTimeout(function () { t.classList.remove("show"); }, 1800);
  }

  /* ============================================================
     EVENTS
     ============================================================ */
  function bind() {
    $("#btnStart").addEventListener("click", function () { startTest(false); });
    $("#btnResume").addEventListener("click", function () { startTest(true); });
    $("#btnFresh").addEventListener("click", function () {
      confirmModal("Start over?", "This clears your saved answers and timers.", function () {
        state = freshState(); saveState(); showWelcome();
      });
    });
    $("#btnHome").addEventListener("click", function () { showWelcome(); });
    $("#btnSubmit").addEventListener("click", function () {
      var unatt = bank.questions.length - attemptedCount();
      confirmModal("Submit test?", unatt ? (unatt + " question(s) are still unanswered. Submit anyway?") : "You have answered every question. Submit now?", function () {
        closeModal(); showResult();
      });
    });
    $("#btnPrev").addEventListener("click", function () { go(-1); });
    $("#btnNext").addEventListener("click", function () { go(1); });
    $("#btnClear").addEventListener("click", clearResponse);

    $("#btnReview").addEventListener("click", function () {
      $("#scrResult").classList.add("hidden");
      $("#scrReview").classList.remove("hidden");
      state.reviewIdx = 0;
      renderReview();
    });
    $("#btnRestart").addEventListener("click", restartTest);
    $("#rvBack").addEventListener("click", function () {
      $("#scrReview").classList.add("hidden");
      $("#scrResult").classList.remove("hidden");
    });
    $("#rvPrev").addEventListener("click", function () { state.reviewIdx--; renderReview(); });
    $("#rvNext").addEventListener("click", function () { state.reviewIdx++; renderReview(); });
    $$("#rvFilters .fbtn").forEach(function (b) {
      b.addEventListener("click", function () {
        $$("#rvFilters .fbtn").forEach(function (x) { x.classList.remove("on"); });
        b.classList.add("on");
        state.reviewFilter = b.getAttribute("data-f");
        state.reviewIdx = 0;
        renderReview();
      });
    });

    $("#palToggle").addEventListener("click", openDrawer);
    $("#scrim").addEventListener("click", closeDrawer);
    $("#mNo").addEventListener("click", closeModal);
    $("#mYes").addEventListener("click", function () { if (modalYes) modalYes(); });

    $("#btnReload").addEventListener("click", reloadBank);

    // keyboard shortcuts
    document.addEventListener("keydown", function (e) {
      if ($("#scrTest").classList.contains("hidden")) return;
      if (e.target && /input|textarea/i.test(e.target.tagName)) return;
      var q = currentQ(); if (!q) return;
      var k = e.key.toUpperCase();
      var i = OPT.indexOf(k);
      if (i > -1 && i < (q.options || []).length && !state.answers[q.id]) { answer(q.id, k); }
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else if (/^[1-5]$/.test(e.key)) { var j = parseInt(e.key, 10) - 1; if (j < (q.options || []).length && !state.answers[q.id]) answer(q.id, OPT[j]); }
    });

    window.addEventListener("beforeunload", function () { if (state) writeLS(LS_STATE, state); });
  }

  /* ============================================================
     INIT
     ============================================================ */
  function applyBank(b) {
    bank = b;
    $("#brandTitle").textContent = bank.title;
    $("#heroTitle").textContent = bank.title;
    if (bank.subtitle) { $("#brandSub").textContent = bank.subtitle; }
    document.title = bank.title + " | Reasoning + Quant";
    buildIndices();
  }

  function reloadBank() {
    try { localStorage.removeItem(LS_BANK); } catch (e) {}
    setDataMsg("Reloading question bank\u2026", false);
    loadBank().then(function (b) {
      applyBank(b);
      var saved = loadState();
      state = saved || freshState();
      if (!state.activeSection || !bySection[state.activeSection]) state.activeSection = bank.sections[0].id;
      saveState();
      refreshWelcomeButtons();
      if (!$("#scrTest").classList.contains("hidden")) { renderTabs(); renderPalette(); renderQuestion(); }
      else if (state.submitted) { showResult(); }
    }).catch(function () {});
  }

  function init() {
    loadBank().then(function (b) {
      applyBank(b);
      var saved = loadState();
      state = saved || freshState();
      if (!state.activeSection || !bySection[state.activeSection]) state.activeSection = bank.sections[0].id;

      bind();
      startGlobalTimer();
      refreshWelcomeButtons();

      if (state.submitted) { showResult(); }
      else { showWelcome(); }  // offers Resume when an attempt exists
    }).catch(function () {
      /* message already shown */
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
