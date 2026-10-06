const APP_VERSION = "1.0.0";
const DATA_URL = "./data/questions.json";
const STORAGE = {
  dataset: "mainslab.dataset.v1",
  attempt: "mainslab.attempt.v1",
  prefs: "mainslab.prefs.v1"
};

const app = document.getElementById("app");
let data = null;
let state = null;
let currentScreen = "home";
let autosaveTimer = null;

const SUBJECTS = {
  quants: { label: "Quants", short: "QUANTS" },
  reasoning: { label: "Reasoning", short: "REASONING" }
};
const SUB_LABELS = {
  miscellaneous: "Miscellaneous",
  di: "DI",
  arithmetic: "Arithmetic",
  "number-system": "Number System",
  "quantity-comparison": "Quantity Comparison",
  "data-sufficiency": "Data Sufficiency",
  puzzle: "Puzzle",
  "seating-arrangement": "Seating Arrangement",
  inequality: "Inequality",
  syllogism: "Syllogism",
  "coding-decoding": "Coding-Decoding",
  "input-output": "Input-Output"
};

function escapeHtml(s){
  return String(s).replace(/[&<>\"]/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[ch]));
}
function formatTime(sec){
  sec = Math.max(0, Math.round(sec || 0));
  const h=Math.floor(sec/3600), m=Math.floor((sec%3600)/60), s=sec%60;
  return h ? `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}` : `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}
function uid(){ return `${Date.now()}-${Math.random().toString(36).slice(2,8)}`; }
function getSet(q){ return q.setId ? data.sets.find(s => s.id===q.setId) : null; }
function questionsFor(subject){ return data.questions.filter(q=>q.subject===subject); }
function categoryOrder(subject){ return data.subcategoryOrder?.[subject] || [...new Set(questionsFor(subject).map(q=>q.subcategory))]; }
function labelSub(id){ return SUB_LABELS[id] || id.replace(/-/g," ").replace(/\b\w/g,m=>m.toUpperCase()); }

function loadPrefs(){
  try{return JSON.parse(localStorage.getItem(STORAGE.prefs)||"{}")}catch{return {}}
}
function savePrefs(p){ try{localStorage.setItem(STORAGE.prefs,JSON.stringify(p));}catch{} }
function loadAttempt(){
  try{return JSON.parse(localStorage.getItem(STORAGE.attempt)||"null")}catch{return null}
}
function saveAttempt(){
  if(!state) return;
  try{
    const payload={...state,lastSavedAt:Date.now()};
    localStorage.setItem(STORAGE.attempt,JSON.stringify(payload));
  }catch(e){ console.warn("Attempt save failed",e); }
}
function clearAttempt(){ try{localStorage.removeItem(STORAGE.attempt)}catch{} }
function saveDatasetLocal(){
  try{localStorage.setItem(STORAGE.dataset,JSON.stringify(data));return true}catch(e){console.warn("Dataset cache failed",e);return false}
}
function loadDatasetLocal(){
  try{return JSON.parse(localStorage.getItem(STORAGE.dataset)||"null")}catch{return null}
}

async function boot(){
  const cached = loadDatasetLocal();
  try{
    const r = await fetch(DATA_URL,{cache:"no-store"});
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    const fresh = await r.json();
    if(!cached || cached.datasetVersion !== fresh.datasetVersion){ data=fresh; saveDatasetLocal(); }
    else data=cached;
  }catch(e){
    data=cached;
    if(!data){
      app.innerHTML=`<div class="page narrow"><div class="empty"><h2>Question bank could not be loaded</h2><p>Run the site through a local web server or deploy it to GitHub Pages.</p></div></div>`;
      return;
    }
  }
  const oldAttempt = loadAttempt();
  if(oldAttempt && oldAttempt.datasetVersion !== data.datasetVersion) clearAttempt();
  registerSW();
  renderHome();
}
function registerSW(){
  if("serviceWorker" in navigator){ navigator.serviceWorker.register("./sw.js").catch(()=>{}); }
}

function initState({subject="quants",mode="practice",count="all",randomize=false}={}){
  const all=questionsFor(subject);
  let pool=[...all];
  if(randomize) pool=pool.sort(()=>Math.random()-.5);
  if(count!=="all") pool=pool.slice(0,Number(count));
  state={
    sessionId:uid(), datasetVersion:data.datasetVersion, subject, mode, questions:pool.map(q=>q.id),
    currentIndex:0, answers:{}, visited:{}, marked:{}, times:{}, startedAt:Date.now(), pausedAt:0,
    questionStartedAt:Date.now(), submitted:false, result:null, reviewIndex:0, reviewFilter:"all", lastSavedAt:Date.now()
  };
  savePrefs({subject,mode,count,randomize});
  saveAttempt();
}
function activeQuestions(){
  const map=new Map(data.questions.map(q=>[q.id,q]));
  return (state?.questions||[]).map(id=>map.get(id)).filter(Boolean);
}
function currentQuestion(){ return activeQuestions()[state.currentIndex]; }
function syncQuestionTime(){
  if(!state || state.submitted) return;
  const now=Date.now();
  if(state.questionStartedAt) state.times[currentQuestion().id]=(state.times[currentQuestion().id]||0)+Math.max(0,Math.round((now-state.questionStartedAt)/1000));
  state.questionStartedAt=now;
}
function scheduleSave(){
  clearTimeout(autosaveTimer); autosaveTimer=setTimeout(saveAttempt,120);
}
function answerSelected(qid){ return state.answers[qid] || null; }
function attemptedCount(){ return Object.keys(state.answers).length; }
function isCorrect(q){ return state.answers[q.id]===q.correctOption; }

function renderHome(){
  currentScreen="home";
  const prefs=loadPrefs();
  const attempt=loadAttempt();
  const qCount=data.questions.length;
  const quants=questionsFor("quants").length, reasoning=questionsFor("reasoning").length;
  const dataCached=!!loadDatasetLocal();
  app.innerHTML=`
    <div class="app-shell">
      <header class="topbar"><div class="topbar-inner">
        <div class="brand-mark">Σ</div><div class="brand-text"><strong>MainsLab</strong><span>IBPS · SBI · RRB mains practice</span></div>
        <div class="top-spacer"></div><div class="top-stat">Pack <b>${escapeHtml(data.datasetVersion)}</b></div>
        <button class="header-btn" id="btnClearData">Clear saved data</button>
      </div></header>
      <main class="page">
        <section class="hero">
          <div class="eyebrow">Offline-first mock platform</div>
          <h1>Practice like a real mains test. Learn like a solution book.</h1>
          <p>Questions, detailed solutions, timings, marked questions and attempt history are cached in this browser. The app is built to scale to 500+ questions without changing the question format.</p>
          <div class="metric-row">
            <div class="metric"><strong>${qCount}</strong><span>questions in current pack</span></div>
            <div class="metric"><strong>${quants}</strong><span>quants</span></div>
            <div class="metric"><strong>${reasoning}</strong><span>reasoning</span></div>
            <div class="metric"><strong>${dataCached?"READY":"LOAD"}</strong><span>local cache status</span></div>
          </div>
        </section>

        <section class="toolbar">
          <div class="toolbar-label">Mode</div>
          <div class="segmented" id="modeSwitch">
            <button class="seg ${prefs.mode!=="mock"?"active":""}" data-mode="practice">Practice + solutions</button>
            <button class="seg ${prefs.mode==="mock"?"active":""}" data-mode="mock">Mock first, solutions after submit</button>
          </div>
          <label class="toggle"><input type="checkbox" id="randomize" ${prefs.randomize?"checked":""}> Randomize order</label>
        </section>

        <div class="section-title"><h2>Select a subject</h2><span>Subsection order is fixed in the data pack.</span></div>
        <section class="subject-grid">
          ${renderSubjectCard("quants",quants,prefs)}
          ${renderSubjectCard("reasoning",reasoning,prefs)}
        </section>

        <div class="section-title"><h2>Designed for your 500-question bank</h2><span>Data file is the only thing you need to replace later.</span></div>
        <section class="info-grid">
          <div class="info-card"><strong>1. JSON data pack</strong><p>Replace <code>data/questions.json</code>. The app reads subjects, subsections, question sets, options and detailed solutions from that one file.</p></div>
          <div class="info-card"><strong>2. Local cache</strong><p>The latest dataset is stored in localStorage. Attempts and time-per-question are stored separately, so the site still works smoothly after a refresh.</p></div>
          <div class="info-card"><strong>3. PDF → JSON workflow</strong><p>For future PDFs, keep the same schema. A group of puzzle/DI questions becomes one shared set plus individual questions.</p></div>
        </section>
        ${attempt ? `<div class="card-actions" style="margin-top:18px"><button class="btn primary" id="resumeBtn">Resume previous attempt</button><button class="btn danger" id="discardBtn">Discard saved attempt</button></div>`:""}
      </main>
    </div>`;
  document.querySelectorAll("#modeSwitch .seg").forEach(b=>b.addEventListener("click",()=>{ document.querySelectorAll("#modeSwitch .seg").forEach(x=>x.classList.remove("active")); b.classList.add("active"); savePrefs({...loadPrefs(),mode:b.dataset.mode}); }));
  document.getElementById("randomize").addEventListener("change",e=>savePrefs({...loadPrefs(),randomize:e.target.checked}));
  document.querySelectorAll(".subject-card").forEach(card=>{
    const start=card.querySelector("[data-start-subject]");
    card.querySelectorAll(".choice").forEach(choice=>choice.addEventListener("click",()=>{
      card.querySelectorAll(".choice").forEach(x=>x.classList.remove("active"));
      choice.classList.add("active");
      start.dataset.count=choice.dataset.count;
      start.textContent=choice.dataset.count==="all"?`Start all ${questionsFor(card.dataset.card).length}`:`Start ${choice.dataset.count} questions`;
    }));
  });
  document.getElementById("btnClearData").addEventListener("click",()=>confirmAction("Clear saved data","This deletes the local question cache, saved attempt and preferences from this browser.",()=>{try{localStorage.removeItem(STORAGE.dataset);localStorage.removeItem(STORAGE.attempt);localStorage.removeItem(STORAGE.prefs)}catch{} location.reload();}));
  if(attempt){ document.getElementById("resumeBtn")?.addEventListener("click",()=>{state=attempt;renderTest();}); document.getElementById("discardBtn")?.addEventListener("click",()=>{clearAttempt();renderHome();}); }
  document.querySelectorAll("[data-start-subject]").forEach(b=>b.addEventListener("click",()=>startFromCard(b.dataset.startSubject, b.dataset.count)));
}
function renderSubjectCard(subject,count,prefs){
  const cats=categoryOrder(subject).filter(c=>questionsFor(subject).some(q=>q.subcategory===c));
  const catText=cats.slice(0,4).map(labelSub).join(" · ");
  const lengths=[25,50,100,"all"].filter(n=>n==="all" || count>=n).map(n=>`<button class="choice ${n==="all"?"active":""}" data-count="${n}">${n==="all"?"All":`${n}Q`}</button>`).join("");
  return `<article class="subject-card" data-card="${subject}"><div class="cap">${SUBJECTS[subject].short}</div><h3>${SUBJECTS[subject].label}</h3><p>${count} question${count===1?"":"s"} loaded · ${catText}</p><div class="subject-meta"><span class="mini-chip">${subject==="quants"?"Miscellaneous first":"Miscellaneous first"}</span><span class="mini-chip">${subject==="quants"?"DI second":"Puzzle second"}</span></div><div class="card-actions"><div class="choice-row">${lengths}</div><button class="btn primary" data-start-subject="${subject}" data-count="all">Start all ${count}</button></div></article>`;
}
function startFromCard(subject,count){
  const prefs=loadPrefs();
  initState({subject,mode:prefs.mode||"practice",count:count||"all",randomize:!!prefs.randomize});
  renderTest();
}

function renderTest(){
  currentScreen="test";
  if(!state){renderHome();return}
  const qs=activeQuestions();
  if(state.currentIndex>=qs.length) state.currentIndex=qs.length-1;
  syncQuestionTime();
  const q=currentQuestion(); state.visited[q.id]=true; scheduleSave();
  const attempted=attemptedCount(); const total=qs.length;
  const pct=Math.round((attempted/total)*100);
  const s=SUBJECTS[state.subject];
  app.innerHTML=`
    <div class="app-shell">
      <header class="topbar"><div class="topbar-inner">
        <div class="brand-mark">Σ</div><div class="brand-text"><strong>MainsLab</strong><span>${s.label} · ${state.mode==="practice"?"practice mode":"mock mode"}</span></div>
        <div class="top-spacer"></div><div class="top-stat">⏱ <b id="liveTimer">${formatTime(totalElapsed())}</b></div>
        <button class="header-btn" id="homeBtn">Home</button>
        <button class="header-btn" id="submitBtn">Submit</button>
      </div></header>
      <div class="drawer-backdrop" id="drawerBackdrop"></div>
      <div class="test-layout">
        <aside class="sidebar" id="sidebar">${renderPalette()}</aside>
        <button class="btn primary mobile-palette-btn" id="mobilePaletteBtn">☰ Palette</button>
        <main class="main-column">
          <div class="test-header"><div><div class="test-title">${s.label} test</div><div class="test-sub">${total} questions · ${state.mode==="practice"?"solution appears after selection":"solutions unlock after submit"}</div></div><div class="hud"><div class="hud-chip">Answered <b>${attempted}/${total}</b></div><div class="hud-chip">Current <b>${state.currentIndex+1}</b></div><div class="hud-chip">Marked <b>${Object.values(state.marked).filter(Boolean).length}</b></div></div></div>
          <div class="progress"><div style="width:${pct}%"></div></div>
          ${renderQuestion(q)}
        </main>
      </div>
    </div>`;
  attachTestEvents();
  startTicker();
}
function totalElapsed(){ return Math.max(0,Math.round((Date.now()-(state.startedAt||Date.now()))/1000)); }
let ticker=null;
function startTicker(){clearInterval(ticker);ticker=setInterval(()=>{const el=document.getElementById("liveTimer"); if(el) el.textContent=formatTime(totalElapsed());},1000)}
function renderPalette(){
  const qs=activeQuestions();
  const order=categoryOrder(state.subject).filter(c=>qs.some(q=>q.subcategory===c));
  const groups=order.map(cat=>{
    const items=qs.map((q,i)=>({q,i})).filter(x=>x.q.subcategory===cat);
    if(!items.length)return "";
    return `<section class="sub-section"><div class="sub-title">${labelSub(cat)} <span>(${items.length})</span></div><div class="q-grid">${items.map(({q,i})=>{
      const a=answerSelected(q.id); const classes=["q-pick",i===state.currentIndex?"current":"",a?(isCorrect(q)?"correct":"wrong"):"",state.marked[q.id]?"marked":""].filter(Boolean).join(" ");
      return `<button class="q-pick ${classes}" data-index="${i}">${i+1}</button>`;
    }).join("")}</div></section>`;
  }).join("");
  return `<div class="panel"><div class="palette-head"><strong>Question Palette</strong><span class="palette-count">${attemptedCount()}/${qs.length} answered</span></div>${groups}<div class="palette-legend"><span class="legend"><i class="dot g"></i>Correct</span><span class="legend"><i class="dot r"></i>Wrong</span><span class="legend"><i class="dot m"></i>Marked</span></div></div>`;
}
function renderQuestion(q){
  const a=answerSelected(q.id); const set=getSet(q); const reveal=state.mode==="practice" ? !!a : !!state.submitted;
  const opts=q.options.map(o=>{
    let cls="option"; if(a===o.id) cls+=" selected"; if(reveal&&o.id===q.correctOption) cls+=" good"; if(reveal&&a===o.id&&a!==q.correctOption) cls+=" bad";
    return `<button class="option ${cls}" data-option="${o.id}"><span class="letter">${o.id}</span><span class="otext">${o.text}</span></button>`;
  }).join("");
  const feedback=reveal ? renderFeedback(q,a) : "";
  const marked=!!state.marked[q.id];
  return `<article class="question-card">
    <div class="q-row"><span class="q-badge">Question ${state.currentIndex+1} of ${activeQuestions().length}</span><div class="q-meta"><span class="meta-chip">${labelSub(q.subcategory)}</span><span class="meta-chip">${q.topic}</span><span class="meta-chip">${formatTime(state.times[q.id]||0)} spent</span></div></div>
    ${set?renderSet(set):""}
    <div class="question-text">${q.questionHtml}</div>
    <div class="options">${opts}</div>
    ${feedback}
    <div class="test-actions"><button class="btn mark-btn ${marked?"marked":""}" id="markBtn">${marked?"★ Marked":"☆ Mark for review"}</button><div class="spacer"></div><span class="save-state">Auto-saved</span></div>
  </article>
  <div class="test-actions"><button class="btn secondary" id="prevBtn">← Previous</button><button class="btn secondary" id="clearBtn">Clear response</button><div class="spacer"></div><button class="btn primary" id="nextBtn">${state.currentIndex===activeQuestions().length-1?"Finish →":"Save & Next →"}</button></div>`;
}
function renderSet(set){
  const v=set.visual;
  let visual="";
  if(v?.type==="table"){
    visual=`<table class="set-table"><caption style="text-align:left;padding:0 0 6px;font-size:11px;font-weight:800;color:#718097">${escapeHtml(v.caption||"")}</caption><thead><tr>${v.headers.map(h=>`<th>${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${v.rows.map(r=>`<tr>${r.map(c=>`<td>${escapeHtml(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  }
  return `<div class="set-card"><h4>${escapeHtml(set.title)}</h4><p>${set.directionsHtml||""}</p>${visual}</div>`;
}
function renderFeedback(q,a){
  if(!a && !state.submitted)return "";
  const correct=a===q.correctOption;
  return `<div class="feedback"><div class="verdict ${correct?"ok":"no"}">${correct?"✓ Correct":"✕ Incorrect"} · Correct answer: ${q.correctOption}</div>${renderSolution(q)}</div>`;
}
function renderSolution(q){
  const s=q.solution||{};
  const steps=(s.steps||[]).map(st=>`<div class="step"><h5>${st.title}</h5><p>${st.bodyHtml||""}</p></div>`).join("");
  const extras=(s.quickMethod||s.trap)?`<div class="solution-extra">${s.quickMethod?`<div class="extra-box"><strong>Quick method</strong><p>${s.quickMethod}</p></div>`:""}${s.trap?`<div class="extra-box"><strong>Common trap</strong><p>${s.trap}</p></div>`:""}</div>`:"";
  return `<section class="solution"><div class="solution-head"><strong>Detailed solution</strong><span>Exam-friendly breakdown</span></div><div class="solution-summary">${s.summary||""}</div><div class="steps">${steps}</div>${extras}<div class="solution-extra"><div class="extra-box final-box"><strong>Final answer</strong><p>${s.finalAnswer||q.correctOption}</p></div></div></section>`;
}
function attachTestEvents(){
  document.getElementById("homeBtn").addEventListener("click",()=>confirmAction("Leave test?","Your attempt is already saved locally. You can resume it from Home.",()=>{syncQuestionTime();saveAttempt();clearInterval(ticker);renderHome();}));
  document.getElementById("submitBtn").addEventListener("click",()=>submitTest());
  document.getElementById("mobilePaletteBtn").addEventListener("click",()=>{document.getElementById("sidebar").classList.add("open");document.getElementById("drawerBackdrop").classList.add("open")});
  document.getElementById("drawerBackdrop").addEventListener("click",closeDrawer);
  document.querySelectorAll(".q-pick").forEach(btn=>btn.addEventListener("click",()=>goTo(Number(btn.dataset.index))));
  document.querySelectorAll(".option").forEach(btn=>btn.addEventListener("click",()=>selectOption(btn.dataset.option)));
  document.getElementById("markBtn").addEventListener("click",()=>{const q=currentQuestion();state.marked[q.id]=!state.marked[q.id];scheduleSave();renderTest();});
  document.getElementById("prevBtn").addEventListener("click",()=>goTo(state.currentIndex-1));
  document.getElementById("nextBtn").addEventListener("click",()=>state.currentIndex===activeQuestions().length-1?submitTest():goTo(state.currentIndex+1));
  document.getElementById("clearBtn").addEventListener("click",()=>{const q=currentQuestion();delete state.answers[q.id];state.questionStartedAt=Date.now();scheduleSave();renderTest();});
}
function closeDrawer(){document.getElementById("sidebar")?.classList.remove("open");document.getElementById("drawerBackdrop")?.classList.remove("open")}
function goTo(i){
  const qs=activeQuestions(); if(i<0||i>=qs.length)return; syncQuestionTime(); state.currentIndex=i; state.questionStartedAt=Date.now(); state.visited[qs[i].id]=true; scheduleSave(); closeDrawer(); renderTest(); window.scrollTo({top:0,behavior:"smooth"});
}
function selectOption(opt){
  const q=currentQuestion(); state.answers[q.id]=opt; state.questionStartedAt=Date.now(); scheduleSave(); renderTest();
}
function submitTest(){
  syncQuestionTime();
  const total=activeQuestions().length, attempted=attemptedCount();
  const unanswered=Math.max(0,total-attempted), correct=activeQuestions().filter(isCorrect).length, wrong=attempted-correct;
  state.submitted=true;state.result={correct,wrong,unanswered,score:correct*data.exam.marking.correct+wrong*data.exam.marking.wrong,time:totalElapsed(),completedAt:Date.now()};
  saveAttempt();clearInterval(ticker);renderResult();
}

function renderResult(){
  currentScreen="result";
  const qs=activeQuestions(),r=state.result; const max=qs.length*data.exam.marking.correct; const angle=Math.max(0,Math.min(360,((r.score/max)||0)*360));
  const cats=[...new Set(qs.map(q=>q.subcategory))];
  const breakdown=cats.map(c=>{const items=qs.filter(q=>q.subcategory===c);const got=items.filter(isCorrect).length;const pct=items.length?Math.round(got/items.length*100):0;return `<div class="break-row"><span>${labelSub(c)}</span><div class="bar"><div style="width:${pct}%"></div></div><b>${got}/${items.length}</b></div>`}).join("");
  app.innerHTML=`<div class="app-shell"><header class="topbar"><div class="topbar-inner"><div class="brand-mark">Σ</div><div class="brand-text"><strong>MainsLab</strong><span>Result analysis</span></div><div class="top-spacer"></div><button class="header-btn" id="resultHome">Home</button></div></header><main class="result"><div class="result-hero"><section class="score-card"><div class="score-ring" style="--score-angle:${angle}deg"><div class="score-inner"><strong>${r.score}</strong><span>net score / ${max}</span></div></div><h2>Test complete</h2><p>${SUBJECTS[state.subject].label} · ${state.mode}</p></section><section class="analysis-card"><h2>Attempt analysis</h2><div class="result-stats"><div class="rstat good"><strong>${r.correct}</strong><span>Correct</span></div><div class="rstat bad"><strong>${r.wrong}</strong><span>Wrong</span></div><div class="rstat amber"><strong>${r.unanswered}</strong><span>Skipped</span></div><div class="rstat"><strong>${r.time<60?formatTime(r.time):formatTime(r.time)}</strong><span>Total time</span></div></div><div class="result-actions"><button class="btn primary" id="reviewBtn">Review solutions</button><button class="btn secondary" id="retryBtn">Retake same set</button><button class="btn ghost" id="newBtn">New test</button></div><div class="breakdown"><h3>Subsection performance</h3>${breakdown}</div></section></div><div class="review-area"><section class="analysis-card"><h2>Question-by-question review</h2><div class="review-list">${qs.map((q,i)=>`<div class="review-item"><h4>Q${i+1} · ${labelSub(q.subcategory)} · ${q.topic}</h4><p>${q.solution?.summary||""}</p><div class="review-answer ${isCorrect(q)?"good":"bad"}">${answerSelected(q.id)?(isCorrect(q)?"Correct":"Wrong")+` · Your answer ${answerSelected(q.id)} · Correct ${q.correctOption}`:"Skipped · Correct "+q.correctOption}</div></div>`).join("")}</div></section></div></main></div>`;
  document.getElementById("resultHome").addEventListener("click",()=>{clearAttempt();renderHome()});
  document.getElementById("retryBtn").addEventListener("click",()=>{const subj=state.subject,mode=state.mode,count=state.questions.length;initState({subject:subj,mode,count,randomize:false});renderTest();});
  document.getElementById("newBtn").addEventListener("click",()=>{clearAttempt();renderHome()});
  document.getElementById("reviewBtn").addEventListener("click",()=>renderReview("all"));
}
function renderReview(filter="all"){
  const qs=activeQuestions().filter(q=>filter==="all"?true:filter==="correct"?isCorrect(q):filter==="wrong"?state.answers[q.id]&& !isCorrect(q):!state.answers[q.id]);
  state.reviewFilter=filter; state.reviewIndex=Math.min(state.reviewIndex||0,Math.max(0,qs.length-1));
  const q=qs[state.reviewIndex];
  if(!q){app.innerHTML=`<div class="page narrow"><div class="empty"><h2>No questions in this filter</h2><button class="btn primary" id="backResult">Back to result</button></div></div>`;document.getElementById("backResult").addEventListener("click",renderResult);return}
  app.innerHTML=`<div class="app-shell"><header class="topbar"><div class="topbar-inner"><div class="brand-mark">Σ</div><div class="brand-text"><strong>MainsLab</strong><span>Solution review</span></div><div class="top-spacer"></div><button class="header-btn" id="reviewBack">Result</button></div></header><main class="page narrow"><div class="toolbar"><div class="toolbar-label">Filter</div><div class="segmented">${["all","wrong","skipped","correct"].map(f=>`<button class="seg ${filter===f?"active":""}" data-filter="${f}">${f[0].toUpperCase()+f.slice(1)}</button>`).join("")}</div></div><div style="margin-top:14px">${renderReviewCard(q)}</div><div class="test-actions"><button class="btn secondary" id="reviewPrev">← Previous</button><div class="spacer"></div><button class="btn primary" id="reviewNext">Next →</button></div></main></div>`;
  document.getElementById("reviewBack").addEventListener("click",renderResult);
  document.querySelectorAll("[data-filter]").forEach(b=>b.addEventListener("click",()=>renderReview(b.dataset.filter)));
  document.getElementById("reviewPrev").addEventListener("click",()=>{state.reviewIndex=Math.max(0,state.reviewIndex-1);renderReview(filter)});
  document.getElementById("reviewNext").addEventListener("click",()=>{state.reviewIndex=Math.min(qs.length-1,state.reviewIndex+1);renderReview(filter)});
}
function renderReviewCard(q){
  const set=getSet(q);const a=answerSelected(q.id);return `<article class="question-card"><div class="q-row"><span class="q-badge">Q${activeQuestions().findIndex(x=>x.id===q.id)+1} · ${labelSub(q.subcategory)}</span><div class="q-meta"><span class="meta-chip">Your answer: ${a||"Skipped"}</span><span class="meta-chip">Correct: ${q.correctOption}</span></div></div>${set?renderSet(set):""}<div class="question-text">${q.questionHtml}</div><div class="options">${q.options.map(o=>`<div class="option ${o.id===q.correctOption?"good":""} ${a===o.id&&a!==q.correctOption?"bad":""}"><span class="letter">${o.id}</span><span class="otext">${o.text}</span></div>`).join("")}</div>${renderSolution(q)}</article>`;
}
function confirmAction(title,body,yes){
  const wrap=document.createElement("div");wrap.className="modal-backdrop";wrap.innerHTML=`<div class="modal"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(body)}</p><div class="modal-actions"><button class="btn secondary" id="mNo">Cancel</button><button class="btn primary" id="mYes">Confirm</button></div></div>`;document.body.appendChild(wrap);wrap.querySelector("#mNo").onclick=()=>wrap.remove();wrap.querySelector("#mYes").onclick=()=>{wrap.remove();yes()};
}

window.addEventListener("beforeunload",()=>{if(state&&!state.submitted){syncQuestionTime();saveAttempt()}});
boot();
