
const BOOK = window.BOOK_DATA;
const STORAGE_KEY = "joy_dikw_science_state_v1";

const defaultState = {
  xp: 0,
  completedLessons: {},
  exerciseAttempts: {},
  hintUsage: {},
  lessonScores: {},
  lessonOrder: BOOK.lessons.map(l => l.id),
  difficulty: "Guided",
  flashcards: BOOK.flashcards.map((c, i) => ({...c, id: i})),
  projectCompletion: {},
  streak: 0
};

let state = loadState();
let currentLessonId = BOOK.lessons[0].id;
let pyodide = null;
let pyReady = false;
let pyLoading = false;

const difficultyOrder = ["Guided","Assisted","Independent","Challenge"];

function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return structuredClone(defaultState);
    const parsed = JSON.parse(raw);
    return {
      ...structuredClone(defaultState),
      ...parsed,
      flashcards: parsed.flashcards?.length ? parsed.flashcards : structuredClone(defaultState.flashcards)
    };
  }catch(e){
    return structuredClone(defaultState);
  }
}
function saveState(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function xpForLesson(lesson){
  return lesson.xp || 20;
}
function difficultyIndex(){
  return difficultyOrder.indexOf(state.difficulty);
}
function adjustDifficulty(result){
  const attempts = state.exerciseAttempts[currentLessonId] || 0;
  const hints = state.hintUsage[currentLessonId] || 0;
  let idx = difficultyIndex();
  if(result === "success" && attempts <= 1 && hints === 0) idx = Math.min(3, idx + 1);
  if(result === "partial" && attempts <= 2 && hints <= 1) idx = Math.min(3, idx + 0);
  if(result === "struggle" || attempts >= 3 || hints >= 3) idx = Math.max(0, idx - 1);
  state.difficulty = difficultyOrder[idx];
}

function updateTopStats(){
  const completed = Object.keys(state.completedLessons).length;
  const pct = Math.round((completed / BOOK.lessons.length) * 100);
  document.getElementById("completedCount").textContent = completed;
  document.getElementById("xpLabel").textContent = `${state.xp} XP`;
  document.getElementById("globalProgress").style.width = `${pct}%`;
  document.getElementById("difficultyBadge").textContent = state.difficulty;
  document.getElementById("hintCount").textContent = Object.values(state.hintUsage).reduce((a,b)=>a+b,0);
  document.getElementById("cardsDue").textContent = dueCards().length;
}

function groupedLessons(filterText=""){
  const groups = {};
  BOOK.lessons.forEach(lesson=>{
    const hay = `${lesson.phase} ${lesson.title} ${(lesson.tags||[]).join(" ")} ${lesson.explainer}`.toLowerCase();
    if(filterText && !hay.includes(filterText.toLowerCase())) return;
    if(!groups[lesson.phase]) groups[lesson.phase] = [];
    groups[lesson.phase].push(lesson);
  });
  return groups;
}

function renderSidebar(filterText=""){
  const nav = document.getElementById("sidebarNav");
  nav.innerHTML = "";
  const groups = groupedLessons(filterText);
  Object.entries(groups).forEach(([phase, lessons])=>{
    const pt = document.createElement("div");
    pt.className = "phase-title";
    pt.textContent = phase;
    nav.appendChild(pt);
    lessons.forEach(lesson=>{
      const btn = document.createElement("button");
      if(lesson.id===currentLessonId) btn.classList.add("active");
      btn.innerHTML = `<span>${lesson.title}</span><span class="check">${state.completedLessons[lesson.id] ? "✓" : ""}</span>`;
      btn.onclick = ()=>{
        currentLessonId = lesson.id;
        showView("lessonView");
        renderSidebar(document.getElementById("searchInput").value.trim());
        renderLesson();
      };
      nav.appendChild(btn);
    });
  });
}

function showView(id){
  document.querySelectorAll(".view").forEach(v=>v.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}

function renderDashboard(){
  const el = document.getElementById("dashboardView");
  const completed = Object.keys(state.completedLessons).length;
  const pct = Math.round((completed / BOOK.lessons.length) * 100);
  const nextLessons = BOOK.lessons.filter(l=>!state.completedLessons[l.id]).slice(0,4);
  const due = dueCards().slice(0,4);
  el.innerHTML = `
    <div class="hero">
      <h2>Build from data to wisdom.</h2>
      <p>This book is an adaptive execution system. Learn Python, statistics, visualization, machine learning, deep learning, ethics, and project-building as one coherent pipeline. Every lesson follows the same order: short explainer, teaching visual, code example, exercise.</p>
      <div class="hero-grid">
        <div class="stat-card">
          <h3>Concept map</h3>
          <div id="conceptMap" class="visual-box"></div>
        </div>
        <div class="stat-card">
          <h3>Your journey</h3>
          <div class="checklist">
            <div class="check-item"><span>●</span><div><strong>${completed}/${BOOK.lessons.length}</strong><div class="small">Lessons completed</div></div></div>
            <div class="check-item"><span>●</span><div><strong>${state.xp}</strong><div class="small">Mastery XP</div></div></div>
            <div class="check-item"><span>●</span><div><strong>${state.difficulty}</strong><div class="small">Current adaptive mode</div></div></div>
            <div class="check-item"><span>●</span><div><strong>${dueCards().length}</strong><div class="small">Flashcards due today</div></div></div>
          </div>
          <div style="margin-top:14px" class="small">Progress grows through execution: code, interpretation, debugging, and project decisions.</div>
        </div>
      </div>

      <div class="section-title"><h3>Continue learning</h3><p>${pct}% of the book completed</p></div>
      <div class="card-grid">
        ${nextLessons.map(l=>`<div class="mini-card"><strong>${l.title}</strong><p class="small">${l.phase}</p><button class="btn primary open-lesson" data-id="${l.id}">Open lesson</button></div>`).join("") || `<div class="mini-card"><strong>All lessons completed.</strong><p class="small">Use flashcards and projects to deepen mastery.</p></div>`}
      </div>

      <div class="section-title"><h3>Flashcards due</h3><p>Adaptive spaced review</p></div>
      <div class="card-grid">
        ${due.map(c=>`<div class="mini-card"><strong>${escapeHtml(c.front)}</strong><p class="small">${(c.tags||[]).join(" · ")}</p><button class="btn secondary review-card" data-id="${c.id}">Review</button></div>`).join("") || `<div class="mini-card"><strong>No cards due right now.</strong><p class="small">Great. Keep learning and new cards will appear.</p></div>`}
      </div>

      <div class="section-title"><h3>Project ladder</h3><p>From micro tasks to independent builds</p></div>
      <div class="project-list">
        ${BOOK.projects.slice(0,6).map((p, idx)=>`<div class="project-card"><div class="tag">${p.layer}</div><h4>${p.title}</h4><p class="small">${p.summary}</p><button class="btn gold open-projects">Open projects</button></div>`).join("")}
      </div>
    </div>
  `;
  drawConceptMap(document.getElementById("conceptMap"));
  el.querySelectorAll(".open-lesson").forEach(btn=>btn.onclick=()=>{
    currentLessonId = btn.dataset.id;
    renderSidebar(document.getElementById("searchInput").value.trim());
    renderLesson();
    showView("lessonView");
  });
  el.querySelectorAll(".review-card").forEach(btn=>btn.onclick=()=>{
    showView("flashcardsView");
    renderFlashcards(Number(btn.dataset.id));
  });
  el.querySelectorAll(".open-projects").forEach(btn=>btn.onclick=()=>{
    showView("projectsView");
    renderProjects();
  });
}

function renderLesson(){
  const lesson = BOOK.lessons.find(l=>l.id===currentLessonId);
  const el = document.getElementById("lessonView");
  const feedbackEl = document.getElementById("exerciseOutput");
  const currentFeedback = feedbackEl ? feedbackEl.textContent : "";
  const attempts = state.exerciseAttempts[lesson.id] || 0;
  const hintsUsed = state.hintUsage[lesson.id] || 0;
  const supported = supportModeMessage();
  el.innerHTML = `
    <div class="lesson-shell">
      <div class="lesson-head">
        <div>
          <div class="small">${lesson.phase}</div>
          <h2>${lesson.title}</h2>
          <div class="tags">${lesson.tags.map(t=>`<span class="tag">${t}</span>`).join("")}</div>
        </div>
        <div class="lesson-meta">
          <div class="pill">${state.completedLessons[lesson.id] ? "Completed ✓" : "Not completed yet"}</div>
          <div class="pill">${xpForLesson(lesson)} XP</div>
          <div class="pill">Mode: ${state.difficulty}</div>
        </div>
      </div>

      <div class="lesson-grid">
        <div class="stack">
          <div class="panel">
            <h3>1. Short explainer</h3>
            <p>${lesson.explainer}</p>
          </div>

          <div class="panel">
            <h3>2. Chart / visual / diagram</h3>
            <div class="visual-box" id="visual-${lesson.id}"></div>
          </div>

          <div class="panel">
            <h3>3. Code example</h3>
            <textarea class="code" id="codeExample">${escapeHtml(lesson.code)}</textarea>
            <div class="row" style="margin-top:10px">
              <button class="btn primary" id="runCodeBtn">Run code</button>
              <button class="btn" id="resetCodeBtn">Reset</button>
              <button class="btn secondary" id="copyCodeBtn">Copy example</button>
              <button class="btn" id="loadPyBtn">${pyReady ? "Python ready ✓" : (pyLoading ? "Loading Python..." : "Load Python runtime")}</button>
            </div>
            <div class="small" style="margin-top:8px">Browser Python uses Pyodide. First load may take a little time and needs network access the first time.</div>
            <pre class="console" id="codeOutput">Output will appear here.</pre>
          </div>

          <div class="panel">
            <h3>4. Exercise</h3>
            <div class="exercise-box">
              <p><strong>Prompt</strong><br/>${lesson.exercise.prompt}</p>
              <textarea class="code" id="exerciseCode">${escapeHtml(lesson.exercise.starter || "")}</textarea>
              <div class="row" style="margin-top:10px">
                <button class="btn primary" id="checkExerciseBtn">Check answer</button>
                <button class="btn" id="runExerciseBtn">Run</button>
                <button class="btn" id="resetExerciseBtn">Reset</button>
                <button class="btn gold" id="completeLessonBtn">Mark lesson complete</button>
              </div>
              <pre class="console" id="exerciseRunOutput">Code output will appear here.</pre>
              <pre class="console" id="exerciseOutput" style="margin-top:10px">Feedback will appear here.</pre>
              <div class="small" style="margin-top:8px">Attempts: ${attempts} · Hints used: ${hintsUsed}</div>
            </div>

            <div class="callout" style="margin-top:12px">
              <strong>Adaptive hint system</strong>
              <div class="small">${supported}</div>
              <div class="hints" id="hintsBox"></div>
              <div class="row" style="margin-top:10px">
                <button class="btn" id="showHintBtn">Reveal next hint</button>
                <button class="btn" id="stuckModeBtn">Stuck Mode</button>
              </div>
            </div>
          </div>
        </div>

        <div class="stack">
          <div class="panel">
            <h3>DIKW lens</h3>
            <p>${lesson.dikw}</p>
          </div>
          <div class="panel">
            <h3>Why this matters in a project</h3>
            <p>${lesson.projectNote}</p>
          </div>
          <div class="panel">
            <h3>Common mistake</h3>
            <p>${lesson.mistake}</p>
          </div>
          <div class="panel">
            <h3>Reflection prompt</h3>
            <p>${lesson.reflection}</p>
          </div>
          <div class="panel">
            <h3>Adaptive state</h3>
            <p><strong>Difficulty tier:</strong> ${state.difficulty}</p>
            <p><strong>Support logic:</strong> repeated failure increases scaffolding, quick success reduces scaffolding, and heavy hint usage keeps support high without penalty to dignity.</p>
          </div>
        </div>
      </div>

      <div class="footer-nav">
        <button class="btn" id="prevLessonBtn">← Previous</button>
        <button class="btn secondary" id="goFlashBtn">Review flashcards</button>
        <button class="btn" id="nextLessonBtn">Next →</button>
      </div>
    </div>
  `;
  renderVisual(`visual-${lesson.id}`, lesson.visual);
  bindLessonEvents(lesson);
  renderHints(lesson);
  if (currentFeedback && currentFeedback !== "Feedback will appear here.") {
    document.getElementById("exerciseOutput").textContent = currentFeedback;
  }
}

function supportModeMessage(){
  switch(state.difficulty){
    case "Guided": return "You get more structure, stronger decomposition help, and more explicit hints.";
    case "Assisted": return "You get nudges and strategic hints, but still do most of the construction yourself.";
    case "Independent": return "You are expected to plan and code with light support.";
    case "Challenge": return "You get minimal scaffolding and are encouraged to generalize beyond the example.";
    default: return "";
  }
}

function bindLessonEvents(lesson){
  const codeArea = document.getElementById("codeExample");
  const exArea = document.getElementById("exerciseCode");
  document.getElementById("runCodeBtn").onclick = ()=>runPython(codeArea.value, "codeOutput");
  document.getElementById("runExerciseBtn").onclick = ()=>runPython(exArea.value, "exerciseRunOutput");
  document.getElementById("resetCodeBtn").onclick = ()=>{ codeArea.value = lesson.code; };
  document.getElementById("resetExerciseBtn").onclick = ()=>{ exArea.value = lesson.exercise.starter || ""; document.getElementById("exerciseRunOutput").textContent = "Code output will appear here."; document.getElementById("exerciseOutput").textContent = "Feedback will appear here."; };
  document.getElementById("copyCodeBtn").onclick = async ()=>{ await navigator.clipboard.writeText(lesson.code); };
  document.getElementById("loadPyBtn").onclick = initPyodide;
  document.getElementById("checkExerciseBtn").onclick = async () => { try { await checkExercise(lesson); } catch(e) { console.error("Check exercise error:", e); document.getElementById("exerciseOutput").textContent = "Error checking exercise: " + e.message; } };
  document.getElementById("showHintBtn").onclick = ()=>revealHint(lesson);
  document.getElementById("stuckModeBtn").onclick = ()=>showStuckMode(lesson);
  document.getElementById("completeLessonBtn").onclick = ()=>completeLesson(lesson, true);
  document.getElementById("prevLessonBtn").onclick = ()=>navigateLesson(-1);
  document.getElementById("nextLessonBtn").onclick = ()=>navigateLesson(1);
  document.getElementById("goFlashBtn").onclick = ()=>{ showView("flashcardsView"); renderFlashcards(); };
}

function navigateLesson(delta){
  const idx = BOOK.lessons.findIndex(l=>l.id===currentLessonId);
  const next = Math.max(0, Math.min(BOOK.lessons.length-1, idx+delta));
  currentLessonId = BOOK.lessons[next].id;
  renderSidebar(document.getElementById("searchInput").value.trim());
  renderLesson();
}

async function initPyodide(){
  if(pyReady || pyLoading) return;
  pyLoading = true;
  renderLesson();
  try{
    pyodide = await loadPyodide();
    pyReady = true;
  }catch(err){
    alert("Could not load the browser Python runtime. Check internet access and try again.");
    console.error(err);
  }finally{
    pyLoading = false;
    renderLesson();
  }
}

async function runPython(code, outputId){
  const out = document.getElementById(outputId);
  if(!pyReady){
    out.textContent = "Python runtime is not loaded yet. Click 'Load Python runtime' first.";
    return;
  }
  try{
    pyodide.setStdout({ batched: (msg) => out.textContent += msg + "\n" });
    pyodide.setStderr({ batched: (msg) => out.textContent += msg + "\n" });
    out.textContent = "";
    await pyodide.runPythonAsync(code);
    if(!out.textContent.trim()) out.textContent = "Code executed with no printed output.";
  }catch(err){
    out.textContent = String(err);
  }
}

async function runPythonForCheck(code){
  if(!pyReady) throw new Error("Python runtime not loaded");
  let output = "";
  try{
    pyodide.setStdout({ batched: (msg) => output += msg + "\n" });
    pyodide.setStderr({ batched: (msg) => output += msg + "\n" });
    await pyodide.runPythonAsync(code);
    return output.trim() || "Code executed with no printed output.";
  }catch(err){
    throw err;
  }
}

async function checkExercise(lesson){
  console.log("Checking exercise for " + lesson.id);
  const code = document.getElementById("exerciseCode").value;
  const tests = lesson.exercise.tests || [];
  state.exerciseAttempts[lesson.id] = (state.exerciseAttempts[lesson.id] || 0) + 1;
  let score = 0;
  let messages = [];
  let output = null;

  // Check for output-based tests
  const hasOutputTests = tests.some(t => t.type === "output_contains");
  if(hasOutputTests){
    try{
      output = await runPythonForCheck(code);
    }catch(e){
      messages.push("• Code execution failed: " + e.message);
    }
  }

  tests.forEach(t=>{
    if(t.type === "contains" && code.includes(t.value)){ score++; messages.push(`✓ contains ${t.value}`); }
    else if(t.type === "not_contains" && !code.includes(t.value)){ score++; messages.push(`✓ avoids ${t.value}`); }
    else if(t.type === "regex" && new RegExp(t.value, "s").test(code)){ score++; messages.push(`✓ structure matched`); }
    else if(t.type === "contains_any" && t.values.some(v=>code.includes(v))){ score++; messages.push(`✓ contains one expected answer`); }
    else if(t.type === "output_contains" && output && output.includes(t.value)){ score++; messages.push(`✓ output contains ${t.value}`); }
    else messages.push(`• check not yet satisfied`);
  });
  const pct = tests.length ? score / tests.length : 1;
  state.lessonScores[lesson.id] = Math.max(state.lessonScores[lesson.id] || 0, pct);
  let msg = `Result: ${Math.round(pct*100)}% checks passed.\n` + messages.join("\n") + `\n\n${lesson.exercise.feedback}`;
  if(pct === 1){
    msg += `\n\nExcellent. You earned ${xpForLesson(lesson)} XP.`;
    completeLesson(lesson, false);
    adjustDifficulty("success");
  } else if(pct >= 0.5){
    msg += `\n\nPartial correctness. You are close. Review the strategy and try again.`;
    adjustDifficulty("partial");
  } else {
    msg += `\n\nNot correct yet. Use a progressive hint or Stuck Mode, then retry with one small change.`;
    adjustDifficulty("struggle");
  }
  const out = document.getElementById("exerciseOutput");
  out.textContent = msg;
  saveState();
  updateTopStats();
  renderSidebar(document.getElementById("searchInput").value.trim());
}

function completeLesson(lesson, manual){
  const already = state.completedLessons[lesson.id];
  state.completedLessons[lesson.id] = true;
  if(!already){
    let gained = xpForLesson(lesson);
    const hints = state.hintUsage[lesson.id] || 0;
    gained = Math.max(5, gained - hints*2);
    state.xp += gained;
  }
  saveState();
  updateTopStats();
  renderSidebar(document.getElementById("searchInput").value.trim());
  renderLesson();
}

function renderHints(lesson){
  const box = document.getElementById("hintsBox");
  const count = state.hintUsage[lesson.id] || 0;
  box.innerHTML = "";
  for(let i=0;i<count;i++){
    const div = document.createElement("div");
    div.className = "hint";
    div.innerHTML = `<strong>Hint ${i+1}</strong><div>${escapeHtml(lesson.exercise.hints[i])}</div>`;
    box.appendChild(div);
  }
  if(count===0){
    box.innerHTML = `<div class="small">No hints revealed yet.</div>`;
  }
}

function revealHint(lesson){
  const used = state.hintUsage[lesson.id] || 0;
  if(used >= lesson.exercise.hints.length) return;
  state.hintUsage[lesson.id] = used + 1;
  state.xp = Math.max(0, state.xp - 1);
  saveState();
  updateTopStats();
  renderLesson();
}

function showStuckMode(lesson){
  const out = document.getElementById("exerciseOutput");
  const used = state.hintUsage[lesson.id] || 0;
  const base = lesson.exercise.hints.slice(0, Math.min(4, lesson.exercise.hints.length)).map((h,i)=>`${i+1}. ${h}`).join("\n");
  out.textContent = `Stuck Mode\n\nHow to start:\n- Restate the task in your own words.\n- Identify the smallest working version.\n- Test one print statement first.\n- Watch for common misunderstanding: ${lesson.mistake}\n\nThinking ladder:\n${base}`;
  state.hintUsage[lesson.id] = Math.max(used, Math.min(4, lesson.exercise.hints.length));
  saveState();
  updateTopStats();
  renderLesson();
}

function dueCards(){
  const nowDay = Math.floor(Date.now() / 86400000);
  return state.flashcards.filter(c => (c.due || 0) <= nowDay);
}

function renderFlashcards(focusId=null){
  const el = document.getElementById("flashcardsView");
  const due = dueCards();
  const idx = focusId !== null ? state.flashcards.findIndex(c=>c.id===focusId) : Math.max(0, state.flashcards.findIndex(c=>due.some(d=>d.id===c.id)));
  const startIndex = idx >= 0 ? idx : 0;
  const card = state.flashcards[startIndex];
  const tags = [...new Set(state.flashcards.flatMap(c=>c.tags || []))].sort();
  el.innerHTML = `
    <div class="flash-shell">
      <div class="flash-toolbar">
        <div>
          <h2 style="margin:0">Flashcards</h2>
          <div class="small">Anki-style review with adaptive resurfacing. Hard cards return sooner; easy cards space farther apart.</div>
        </div>
        <div class="row">
          <select id="tagFilter" class="ghost">
            <option value="">All tags</option>
            ${tags.map(t=>`<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("")}
          </select>
          <button class="btn" id="showDashboardBtn">Dashboard</button>
        </div>
      </div>
      <div class="flashcard-wrap">
        <div>
          <div id="flashcardRoot"></div>
          <div class="row" style="margin-top:14px">
            <button class="btn" id="flipBtn">Flip</button>
            <button class="btn" id="againBtn">Again</button>
            <button class="btn secondary" id="goodBtn">Good</button>
            <button class="btn gold" id="easyBtn">Easy</button>
          </div>
        </div>
        <div class="panel">
          <h3>Review stats</h3>
          <p>Cards due: <strong>${due.length}</strong></p>
          <p>Total cards: <strong>${state.flashcards.length}</strong></p>
          <p>Current card tags: <strong>${card ? (card.tags||[]).join(", ") : "none"}</strong></p>
          <p class="small">Use spaced repetition to keep foundational patterns active while you build projects.</p>
        </div>
      </div>
    </div>
  `;
  let currentCards = state.flashcards.slice();
  let currentIndex = startIndex;

  function redraw(flipped=false){
    const activeTag = document.getElementById("tagFilter").value;
    currentCards = activeTag ? state.flashcards.filter(c=>(c.tags||[]).includes(activeTag)) : state.flashcards.slice();
    if(currentCards.length===0){
      document.getElementById("flashcardRoot").innerHTML = `<div class="panel"><p>No cards in this tag.</p></div>`;
      return;
    }
    currentIndex = Math.min(currentIndex, currentCards.length - 1);
    const c = currentCards[currentIndex];
    document.getElementById("flashcardRoot").innerHTML = `
      <div class="flashcard ${flipped ? "flipped" : ""}" id="activeFlashcard">
        <div class="flashcard-inner">
          <div class="face front"><div class="tag">${(c.tags||[]).slice(0,3).join(" · ")}</div><h3>Front</h3><p>${escapeHtml(c.front)}</p></div>
          <div class="face back"><div class="tag">Answer</div><h3>Back</h3><p>${escapeHtml(c.back)}</p></div>
        </div>
      </div>
    `;
  }

  redraw(false);
  document.getElementById("tagFilter").onchange = ()=>{ currentIndex=0; redraw(false); };
  document.getElementById("flipBtn").onclick = ()=> document.getElementById("activeFlashcard")?.classList.toggle("flipped");
  document.getElementById("showDashboardBtn").onclick = ()=>{ showView("dashboardView"); renderDashboard(); };

  document.getElementById("againBtn").onclick = ()=>scoreCard(currentCards[currentIndex], "again");
  document.getElementById("goodBtn").onclick = ()=>scoreCard(currentCards[currentIndex], "good");
  document.getElementById("easyBtn").onclick = ()=>scoreCard(currentCards[currentIndex], "easy");

  function scoreCard(card, rating){
    const nowDay = Math.floor(Date.now() / 86400000);
    if(rating === "again"){
      card.interval = 1;
      card.ease = Math.max(1.3, (card.ease || 2.5) - 0.2);
      card.due = nowDay + 1;
      state.xp += 1;
    }else if(rating === "good"){
      card.interval = Math.max(2, Math.round((card.interval || 1) * (card.ease || 2.5)));
      card.ease = Math.max(1.3, (card.ease || 2.5));
      card.due = nowDay + card.interval;
      state.xp += 2;
    }else{
      card.ease = (card.ease || 2.5) + 0.15;
      card.interval = Math.max(4, Math.round((card.interval || 2) * card.ease));
      card.due = nowDay + card.interval;
      state.xp += 3;
    }
    card.history = card.history || [];
    card.history.push({ rating, day: nowDay });
    saveState();
    updateTopStats();
    currentIndex = (currentIndex + 1) % currentCards.length;
    redraw(false);
  }
}

function renderProjects(){
  const el = document.getElementById("projectsView");
  el.innerHTML = `
    <div class="project-shell">
      <h2 style="margin-top:0">Projects</h2>
      <p class="small">These projects are integrated into the book. They move from micro tasks to guided builds to realistic mini projects and finally an independent builder framework.</p>
      <div class="project-list">
        ${BOOK.projects.map((p, i)=>`
          <div class="project-card">
            <div class="tag">${p.layer}</div>
            <h3>${p.title}</h3>
            <p class="small">${p.summary}</p>
            <div class="small"><strong>Dataset:</strong> ${p.dataset}</div>
            <div class="small" style="margin-top:8px"><strong>DIKW lens:</strong> ${p.dikw}</div>
            <div style="margin-top:10px"><strong>Deliverables</strong></div>
            <ul>${p.deliverables.map(d=>`<li>${d}</li>`).join("")}</ul>
            <button class="btn ${state.projectCompletion[i] ? "secondary" : ""}" data-project="${i}">${state.projectCompletion[i] ? "Completed ✓" : "Mark complete"}</button>
          </div>
        `).join("")}
      </div>

      <div class="section-title"><h3>Independent builder checklist</h3><p>A framework for real projects</p></div>
      <div class="card-grid">
        ${["define problem","define success metric","identify data needs","collect or simulate data","clean and structure data","analyze and model","visualize findings","interpret responsibly","communicate recommendations","reflect on limitations and ethics"].map(step=>`<div class="mini-card"><strong>${step}</strong><div class="small">Ask: what evidence is needed here?</div></div>`).join("")}
      </div>
    </div>
  `;
  el.querySelectorAll("[data-project]").forEach(btn=>btn.onclick=()=>{
    state.projectCompletion[btn.dataset.project] = !state.projectCompletion[btn.dataset.project];
    if(state.projectCompletion[btn.dataset.project]) state.xp += 10;
    saveState(); updateTopStats(); renderProjects();
  });
}

function drawConceptMap(root){
  if(!root) return;
  root.innerHTML = "";
  const svg = document.createElementNS("http://www.w3.org/2000/svg","svg");
  svg.setAttribute("viewBox","0 0 780 260");
  svg.setAttribute("width","100%");
  svg.setAttribute("height","240");
  const nodes = [
    {x:40,y:95,w:120,h:60,label:"Data"},
    {x:190,y:95,w:150,h:60,label:"Information"},
    {x:380,y:95,w:140,h:60,label:"Knowledge"},
    {x:560,y:95,w:140,h:60,label:"Wisdom"},
  ];
  const extras = [
    {x:100,y:25,label:"Python"},
    {x:250,y:25,label:"Statistics"},
    {x:430,y:25,label:"Modeling"},
    {x:620,y:25,label:"Decision"}
  ];
  nodes.forEach((n,i)=>{
    const rect = document.createElementNS(svg.namespaceURI,"rect");
    rect.setAttribute("x",n.x); rect.setAttribute("y",n.y);
    rect.setAttribute("width",n.w); rect.setAttribute("height",n.h);
    rect.setAttribute("rx","18");
    rect.setAttribute("fill", i%2 ? "rgba(56,208,184,.15)" : "rgba(124,156,255,.18)");
    rect.setAttribute("stroke","rgba(255,255,255,.18)");
    svg.appendChild(rect);
    const text = document.createElementNS(svg.namespaceURI,"text");
    text.setAttribute("x",n.x+n.w/2); text.setAttribute("y",n.y+36); text.setAttribute("text-anchor","middle"); text.setAttribute("font-size","20");
    text.textContent = n.label; svg.appendChild(text);
    if(i < nodes.length-1){
      const line = document.createElementNS(svg.namespaceURI,"line");
      line.setAttribute("x1",n.x+n.w); line.setAttribute("y1",n.y+30);
      line.setAttribute("x2",nodes[i+1].x); line.setAttribute("y2",nodes[i+1].y+30);
      line.setAttribute("stroke","rgba(255,255,255,.35)");
      line.setAttribute("stroke-width","3");
      svg.appendChild(line);
    }
  });
  extras.forEach((e, idx)=>{
    const circle = document.createElementNS(svg.namespaceURI,"circle");
    circle.setAttribute("cx", e.x); circle.setAttribute("cy", e.y); circle.setAttribute("r", "16");
    circle.setAttribute("fill","rgba(247,195,95,.18)");
    circle.setAttribute("stroke","rgba(255,255,255,.18)");
    svg.appendChild(circle);
    const tx = document.createElementNS(svg.namespaceURI,"text");
    tx.setAttribute("x", e.x + 26); tx.setAttribute("y", e.y + 5); tx.setAttribute("font-size","14");
    tx.textContent = e.label; svg.appendChild(tx);
  });
  root.appendChild(svg);
}

function renderVisual(containerId, spec){
  const root = document.getElementById(containerId);
  if(!root) return;
  root.innerHTML = "";
  if(!spec) return;
  if(["dikw-ladder","flow","pipeline","ladder","cycle"].includes(spec.type)){
    const plotRoot = document.createElement("div");
    plotRoot.style.width = "100%";
    plotRoot.style.height = "260px";
    root.appendChild(plotRoot);
    const labels = spec.items || spec.nodes || spec.steps || [];
    const x = labels.map((_,i)=>i+1);
    Plotly.newPlot(plotRoot, [{
      x, y: labels.map((_,i)=>1), text: labels, mode: "markers+text",
      textposition: "top center", marker: {size: 24}
    }], {title: spec.title, xaxis:{visible:false}, yaxis:{visible:false}, margin:{l:20,r:20,t:50,b:20}, paper_bgcolor:"rgba(0,0,0,0)", plot_bgcolor:"rgba(0,0,0,0)"}, {displayModeBar:false});
    return;
  }
  if(spec.type === "decision"){
    root.innerHTML = `<svg viewBox="0 0 600 220" width="100%" height="220">
      <polygon points="300,40 400,100 300,160 200,100" fill="rgba(124,156,255,.18)" stroke="rgba(255,255,255,.2)"></polygon>
      <text x="300" y="105" text-anchor="middle">${spec.question}</text>
      <rect x="70" y="78" width="90" height="44" rx="12" fill="rgba(56,208,184,.18)" stroke="rgba(255,255,255,.2)"></rect>
      <text x="115" y="105" text-anchor="middle">${spec.no}</text>
      <rect x="440" y="78" width="90" height="44" rx="12" fill="rgba(247,195,95,.18)" stroke="rgba(255,255,255,.2)"></rect>
      <text x="485" y="105" text-anchor="middle">${spec.yes}</text>
      <line x1="200" y1="100" x2="160" y2="100" stroke="rgba(255,255,255,.3)" stroke-width="2"></line>
      <line x1="400" y1="100" x2="440" y2="100" stroke="rgba(255,255,255,.3)" stroke-width="2"></line>
    </svg>`;
    return;
  }
  if(spec.type === "table" || spec.type === "chart-picker" || spec.type === "model-grid"){
    const rows = spec.rows || spec.cards || spec.items || [];
    root.innerHTML = `<div class="card-grid">${rows.map(r=>`<div class="mini-card"><strong>${Array.isArray(r)?r[0]:r}</strong><div class="small">${Array.isArray(r)?r[1]||"":""}</div></div>`).join("")}</div>`;
    return;
  }
  if(spec.type === "function-box"){
    root.innerHTML = `<svg viewBox="0 0 640 220" width="100%" height="220">
      <rect x="40" y="70" width="150" height="80" rx="16" fill="rgba(56,208,184,.15)" stroke="rgba(255,255,255,.2)"></rect>
      <rect x="245" y="55" width="160" height="110" rx="18" fill="rgba(124,156,255,.18)" stroke="rgba(255,255,255,.2)"></rect>
      <rect x="460" y="70" width="140" height="80" rx="16" fill="rgba(247,195,95,.15)" stroke="rgba(255,255,255,.2)"></rect>
      <text x="115" y="115" text-anchor="middle">${spec.input}</text>
      <text x="325" y="115" text-anchor="middle">${spec.process}</text>
      <text x="530" y="115" text-anchor="middle">${spec.output}</text>
      <line x1="190" y1="110" x2="245" y2="110" stroke="rgba(255,255,255,.3)" stroke-width="3"></line>
      <line x1="405" y1="110" x2="460" y2="110" stroke="rgba(255,255,255,.3)" stroke-width="3"></line>
    </svg>`;
    return;
  }
  if(spec.type === "oop"){
    root.innerHTML = `<svg viewBox="0 0 620 260" width="100%" height="240">
      <rect x="180" y="30" width="260" height="190" rx="18" fill="rgba(124,156,255,.18)" stroke="rgba(255,255,255,.2)"></rect>
      <line x1="180" y1="75" x2="440" y2="75" stroke="rgba(255,255,255,.2)"></line>
      <line x1="180" y1="145" x2="440" y2="145" stroke="rgba(255,255,255,.2)"></line>
      <text x="310" y="58" text-anchor="middle" font-size="22">${spec.className}</text>
      ${spec.attrs.map((a,i)=>`<text x="210" y="${102+i*24}" font-size="16">${a}</text>`).join("")}
      ${spec.methods.map((m,i)=>`<text x="210" y="${174+i*24}" font-size="16">${m}</text>`).join("")}
    </svg>`;
    return;
  }
  if(spec.type === "tree"){
    root.innerHTML = `<svg viewBox="0 0 620 240" width="100%" height="220">
      <rect x="250" y="20" width="120" height="44" rx="12" fill="rgba(124,156,255,.18)" stroke="rgba(255,255,255,.2)"></rect>
      <text x="310" y="48" text-anchor="middle">${spec.root}</text>
      <line x1="310" y1="64" x2="180" y2="120" stroke="rgba(255,255,255,.3)" />
      <line x1="310" y1="64" x2="440" y2="120" stroke="rgba(255,255,255,.3)" />
      <rect x="100" y="120" width="160" height="44" rx="12" fill="rgba(56,208,184,.18)" stroke="rgba(255,255,255,.2)"></rect>
      <text x="180" y="148" text-anchor="middle">${spec.children[0]}</text>
      <rect x="360" y="120" width="160" height="44" rx="12" fill="rgba(247,195,95,.18)" stroke="rgba(255,255,255,.2)"></rect>
      <text x="440" y="148" text-anchor="middle">${spec.children[1]}</text>
    </svg>`;
    return;
  }
  if(spec.type === "dataframe"){
    root.innerHTML = `<div class="panel" style="width:100%"><table style="width:100%;border-collapse:collapse">
      <thead><tr>${spec.columns.map(c=>`<th style="text-align:left;padding:8px;border-bottom:1px solid rgba(255,255,255,.1)">${c}</th>`).join("")}</tr></thead>
      <tbody>${spec.rows.map(r=>`<tr>${r.map(cell=>`<td style="padding:8px;border-bottom:1px solid rgba(255,255,255,.06)">${cell}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    return;
  }
  if(spec.type === "distribution"){
    const d = document.createElement("div");
    d.style.width="100%"; d.style.height="250px"; root.appendChild(d);
    Plotly.newPlot(d, [{x:[1,2,2,3,3,3,4,4,5,8], type:"histogram"}], {title: spec.title, margin:{l:30,r:10,t:50,b:30}, paper_bgcolor:"rgba(0,0,0,0)", plot_bgcolor:"rgba(0,0,0,0)"}, {displayModeBar:false});
    return;
  }
  if(spec.type === "sampling" || spec.type === "ml-split"){
    root.innerHTML = `<svg viewBox="0 0 640 220" width="100%" height="220">
      <rect x="60" y="70" width="150" height="80" rx="16" fill="rgba(124,156,255,.18)" stroke="rgba(255,255,255,.2)"></rect>
      <text x="135" y="116" text-anchor="middle">${spec.population || spec.boxes?.[0] || "Population"}</text>
      <line x1="210" y1="110" x2="320" y2="110" stroke="rgba(255,255,255,.3)" stroke-width="3"></line>
      <rect x="320" y="70" width="120" height="80" rx="16" fill="rgba(56,208,184,.18)" stroke="rgba(255,255,255,.2)"></rect>
      <text x="380" y="116" text-anchor="middle">${spec.sample || spec.boxes?.[1] || "Sample"}</text>
      <line x1="440" y1="110" x2="560" y2="110" stroke="rgba(255,255,255,.3)" stroke-width="3"></line>
      <rect x="560" y="70" width="60" height="80" rx="16" fill="rgba(247,195,95,.18)" stroke="rgba(255,255,255,.2)"></rect>
      <text x="590" y="116" text-anchor="middle">${spec.estimate || spec.boxes?.[2] || "Test"}</text>
    </svg>`;
    return;
  }
  if(spec.type === "scatter-causation"){
    const d = document.createElement("div"); d.style.width="100%"; d.style.height="250px"; root.appendChild(d);
    Plotly.newPlot(d, [{x:[1,2,3,4,5], y:[2,3,5,6,8], mode:"markers"}], {title: spec.title, xaxis:{title:spec.x}, yaxis:{title:spec.y}, annotations:[{text:`lurking: ${spec.lurking}`,xref:"paper",yref:"paper",x:0.5,y:1.15,showarrow:false}] , margin:{l:40,r:20,t:70,b:40}, paper_bgcolor:"rgba(0,0,0,0)", plot_bgcolor:"rgba(0,0,0,0)"}, {displayModeBar:false});
    return;
  }
  if(spec.type === "confusion"){
    root.innerHTML = `<svg viewBox="0 0 420 240" width="100%" height="220">
      <rect x="90" y="40" width="240" height="160" fill="none" stroke="rgba(255,255,255,.2)"></rect>
      <line x1="210" y1="40" x2="210" y2="200" stroke="rgba(255,255,255,.2)"></line>
      <line x1="90" y1="120" x2="330" y2="120" stroke="rgba(255,255,255,.2)"></line>
      <text x="150" y="90" text-anchor="middle">TP</text>
      <text x="270" y="90" text-anchor="middle">FP</text>
      <text x="150" y="165" text-anchor="middle">FN</text>
      <text x="270" y="165" text-anchor="middle">TN</text>
    </svg>`;
    return;
  }
  if(spec.type === "timeseries"){
    const d = document.createElement("div"); d.style.width="100%"; d.style.height="250px"; root.appendChild(d);
    Plotly.newPlot(d, [{x:[1,2,3,4,5,6,7,8,9,10,11,12], y:[10,12,13,12,14,16,17,18,17,19,21,22], mode:"lines+markers"}], {title: spec.title, margin:{l:30,r:10,t:50,b:30}, paper_bgcolor:"rgba(0,0,0,0)", plot_bgcolor:"rgba(0,0,0,0)"}, {displayModeBar:false});
    return;
  }
  if(spec.type === "neural"){
    root.innerHTML = `<svg viewBox="0 0 620 260" width="100%" height="240">
      ${[120,310,500].map((x,layer)=>spec.layers[layer].map((label,i)=>`<circle cx="${x}" cy="${80+i*90}" r="26" fill="rgba(${layer===0?'124,156,255':layer===1?'56,208,184':'247,195,95'},.18)" stroke="rgba(255,255,255,.2)"></circle><text x="${x}" y="${88+i*90}" text-anchor="middle">${label}</text>`).join("")).join("")}
      <line x1="146" y1="80" x2="284" y2="80" stroke="rgba(255,255,255,.25)"></line>
      <line x1="146" y1="80" x2="284" y2="170" stroke="rgba(255,255,255,.25)"></line>
      <line x1="146" y1="170" x2="284" y2="80" stroke="rgba(255,255,255,.25)"></line>
      <line x1="146" y1="170" x2="284" y2="170" stroke="rgba(255,255,255,.25)"></line>
      <line x1="336" y1="80" x2="474" y2="125" stroke="rgba(255,255,255,.25)"></line>
      <line x1="336" y1="170" x2="474" y2="125" stroke="rgba(255,255,255,.25)"></line>
    </svg>`;
    return;
  }
  if(spec.type === "ethics"){
    root.innerHTML = `<div class="card-grid">${spec.items.map(i=>`<div class="mini-card"><strong>${i}</strong></div>`).join("")}</div>`;
    return;
  }
  root.innerHTML = `<div class="small">Visual unavailable.</div>`;
}

function escapeHtml(str){
  return String(str)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;");
}

function bindTopActions(){
  document.getElementById("searchInput").addEventListener("input", (e)=>{
    renderSidebar(e.target.value.trim());
  });
  document.getElementById("resetProgressBtn").onclick = ()=>{
    if(confirm("Reset all local progress, flashcards, hints, and XP?")){
      state = structuredClone(defaultState);
      saveState();
      updateTopStats();
      renderAll();
    }
  };
}

function renderAll(){
  updateTopStats();
  renderSidebar(document.getElementById("searchInput")?.value.trim() || "");
  renderDashboard();
  renderLesson();
  renderFlashcards();
  renderProjects();
}

bindTopActions();
renderAll();
showView("dashboardView");
initPyodide();
