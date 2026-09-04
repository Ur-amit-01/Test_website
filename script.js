
/* ============================================================
   STATE
============================================================ */
let questions = [];          // [{id, text, options:{A,B,C,D}, answer}]
let answers = {};            // qid -> 'A'|'B'|'C'|'D'|null
let status = {};             // qid -> 'not-visited'|'not-answered'|'answered'|'marked'|'answered-marked'
let currentIndex = 0;
let testTitle = 'NEET Mock Test';
let candidateName = '';
const BRAND_NAME = 'PW';

function toggleTheme(){
  const html = document.documentElement;
  html.dataset.theme = html.dataset.theme === 'dark' ? 'light' : 'dark';
}
let totalSeconds = 0;
let remainingSeconds = 0;
let timerInterval = null;

/* ============================================================
   PARSING
============================================================ */
function parseQuestions(text){
  const lines = text.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n');
  const blocks = [];
  let current = [];
  for(const line of lines){
    if(line.trim() === ''){
      if(current.length){ blocks.push(current); current = []; }
    } else {
      current.push(line);
    }
  }
  if(current.length) blocks.push(current);

  const optionRe = /^\s*\(?([A-Da-d])\)?[\.\)]\s*(.+)$/;
  const answerRe = /^\s*(?:Answer|Ans|Correct(?:\s*Answer)?)\s*[:\-]?\s*\(?([A-Da-d])\)?\s*$/i;
  const imageRe = /^\s*(?:Image|Img|Figure)\s*:\s*(\S.*)$/i;
  const qNumRe = /^\s*(?:Q\.?\s*)?\d+\s*[\.\)]\s*/;

  const parsed = [];
  let qid = 0;
  for(const block of blocks){
    const questionLines = [];
    const options = {};
    let answer = null;
    let image = null;

    for(const rawLine of block){
      const ansMatch = rawLine.match(answerRe);
      if(ansMatch){ answer = ansMatch[1].toUpperCase(); continue; }

      const imgMatch = rawLine.match(imageRe);
      if(imgMatch){ image = imgMatch[1].trim(); continue; }

      const optMatch = rawLine.match(optionRe);
      if(optMatch){ options[optMatch[1].toUpperCase()] = optMatch[2].trim(); continue; }

      if(Object.keys(options).length === 0){
        questionLines.push(rawLine.trim());
      }
    }

    if(questionLines.length === 0) continue;
    let qText = questionLines.join('\n').trim().replace(qNumRe, '');
    const optCount = Object.keys(options).length;
    if(optCount >= 2 && answer && options[answer] !== undefined){
      qid++;
      parsed.push({ id: qid, text: qText, options, answer, image });
    }
  }
  return parsed;
}

/* ============================================================
   TEST LIBRARY
   Two sources feed the same grouped structure (Institute -> Series
   -> [tests]):
     1. BUNDLED_LIBRARY  - tests shipped inside this file.
     2. A "test series" folder the visitor points the browser at:
          test series/<Institute>/<Series>/<Paper>.txt
        Each paper file uses the plain-text format described in the
        format box further up (Q text / A) B) C) D) / optional
        Image: line / Answer: X). The scan result is cached in this
        browser (IndexedDB) so it reloads automatically next time.
============================================================ */
const BUNDLED_LIBRARY = {};

let remoteLibrary = null;   // tests fetched automatically from tests/manifest.json, or null
let selectedInstitute = null; // which institute the visitor is currently browsing, or null (institute list screen)
let isLaunching = false;      // guards against double-click / double-submit starting two quizzes at once

function computeLibrary(){
  const lib = {};
  const add = (src) => {
    Object.keys(src).forEach(inst => {
      if(!lib[inst]) lib[inst] = {};
      Object.keys(src[inst]).forEach(ser => {
        if(!lib[inst][ser]) lib[inst][ser] = [];
        lib[inst][ser] = lib[inst][ser].concat(src[inst][ser]);
      });
    });
  };
  add(BUNDLED_LIBRARY);
  if(remoteLibrary) add(remoteLibrary);
  return lib;
}

function formatMinutesLabel(mins){
  if(mins < 60) return mins + ' min';
  const h = Math.floor(mins/60), m = mins%60;
  return h + 'h' + (m ? ' ' + m + 'm' : '');
}

function titleizeFilename(name){
  const base = name.replace(/\.[^/.]+$/, '');
  const words = base.replace(/[_\-]+/g, ' ').trim().split(/\s+/);
  const titled = words.map(w => /^[0-9]+$/.test(w) ? w : (w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
  return titled || name;
}

/* ============================================================
   AUTOMATIC TEST LOADING
   Every visitor gets the same library automatically — nobody has
   to pick a folder. On load we:
     1. Fetch tests/manifest.json, a flat list of {institute,
        series, title, file} entries.
     2. Fetch every listed .txt paper (in parallel, each wrapped
        in its own try/catch so one bad/missing file never breaks
        the rest).
     3. Merge everything into remoteLibrary, on top of the
        BUNDLED_LIBRARY that ships inside this script for offline
        use (e.g. if this file is opened directly with no web
        server, fetch() can't run — the bundled test still shows).
   A successful fetch is cached in IndexedDB (this browser only)
   so a later visit with a flaky connection can still fall back to
   the last-known-good list instead of showing nothing.
   To add a new institute or paper: drop a .txt file under
   tests/<Institute>/<Series>/ and add one entry to manifest.json.
   Every visitor then sees it automatically — no action needed on
   their end.
============================================================ */
const DB_NAME = 'neetQuizLibraryDB', DB_STORE = 'kv';
function idbOpen(){
  return new Promise((resolve, reject) => {
    if(!('indexedDB' in window)){ reject(new Error('IndexedDB unavailable')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGet(key){
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const req = tx.objectStore(DB_STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbSet(key, val){
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(val, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function setLoadingState(visible, text){
  const el = document.getElementById('loadingState');
  if(!el) return;
  el.classList.toggle('hidden', !visible);
  if(text) el.querySelector('.loading-text').textContent = text;
}
function setLoadError(message){
  const el = document.getElementById('loadError');
  if(!el) return;
  if(message){
    el.textContent = message;
    el.classList.remove('hidden');
  } else {
    el.classList.add('hidden');
  }
}

async function loadAllTestsAutomatically(){
  setLoadingState(true, 'Loading tests…');
  setLoadError(null);

  let manifest = null;
  try{
    const res = await fetch('tests/manifest.json', { cache: 'no-store' });
    if(res.ok) manifest = await res.json();
  }catch(err){ /* no server / no manifest — bundled tests still work below */ }

  const built = {};
  let loaded = 0, failed = 0;

  if(manifest && Array.isArray(manifest.tests)){
    const results = await Promise.allSettled(manifest.tests.map(async (entry) => {
      if(!entry || !entry.file) throw new Error('manifest entry missing "file"');
      const res = await fetch('tests/' + entry.file, { cache: 'no-store' });
      if(!res.ok) throw new Error('HTTP ' + res.status + ' for ' + entry.file);
      const text = await res.text();
      const parsed = parseQuestions(text);
      if(parsed.length === 0) throw new Error('no questions parsed in ' + entry.file);
      const institute = (entry.institute || 'General').trim() || 'General';
      const series = (entry.series || 'General').trim() || 'General';
      const title = entry.title || titleizeFilename(entry.file.split('/').pop());
      const pdf = (entry.pdf || '').trim() || null;
      return { institute, series, title, raw: text, pdf };
    }));

    results.forEach(r => {
      if(r.status === 'fulfilled'){
        const { institute, series, title, raw, pdf } = r.value;
        if(!built[institute]) built[institute] = {};
        if(!built[institute][series]) built[institute][series] = [];
        built[institute][series].push({ title, raw, pdf });
        loaded++;
      } else {
        failed++; // one bad file — skip it, never let it break the rest of the site
      }
    });
  }

  if(loaded > 0){
    remoteLibrary = built;
    try{ await idbSet('remoteLibrary', { data: built, savedAt: Date.now() }); }catch(err){ /* caching is best-effort */ }
  } else {
    // Nothing fetched this time (offline / no server / no manifest yet).
    // Fall back to whatever was cached from a previous successful visit.
    try{
      const cached = await idbGet('remoteLibrary');
      if(cached && cached.data) remoteLibrary = cached.data;
    }catch(err){ /* no cache yet — bundled library still renders below */ }
  }

  if(failed > 0 && loaded === 0 && !remoteLibrary){
    setLoadError("Some tests couldn't be loaded automatically. Showing what's available.");
  }

  setLoadingState(false);
  renderInstituteList();
}

/* ---------- Screen: institute picker ---------- */
function renderInstituteList(){
  const LIB = computeLibrary();
  const container = document.getElementById('instituteGrid');
  container.innerHTML = '';

  const institutes = Object.keys(LIB);
  let totalTests = 0;
  institutes.forEach(inst => Object.values(LIB[inst]).forEach(arr => totalTests += arr.length));

  document.getElementById('libCount').textContent = totalTests;
  document.getElementById('libCountPlural').textContent = totalTests === 1 ? '' : 's';
  document.getElementById('libInstCount').textContent = institutes.length;
  document.getElementById('libInstCountPlural').textContent = institutes.length === 1 ? '' : 's';

  if(institutes.length === 0){
    container.innerHTML = '<div class="test-empty">No tests are available yet. Check back soon.</div>';
    return;
  }

  institutes.forEach(inst => {
    const instTestCount = Object.values(LIB[inst]).reduce((n, arr) => n + arr.length, 0);
    const card = document.createElement('div');
    card.className = 'institute-card';
    card.innerHTML = `
      <span class="brand-badge">${escapeHtml(inst.slice(0,2).toUpperCase())}</span>
      <div>
        <p class="institute-card-name">${escapeHtml(inst)}</p>
        <div class="institute-card-count"><b>${instTestCount}</b> test${instTestCount===1?'':'s'} available</div>
      </div>
      <button class="institute-select-btn">Select</button>
    `;
    card.querySelector('.institute-select-btn').addEventListener('click', () => selectInstitute(inst));
    container.appendChild(card);
  });
}

function selectInstitute(inst){
  selectedInstitute = inst;
  document.getElementById('screen-institutes').classList.remove('active');
  document.getElementById('screen-tests').classList.add('active');
  document.getElementById('selectedInstituteName').textContent = inst;
  renderTestLibraryForInstitute(inst);
}

function backToInstitutes(){
  selectedInstitute = null;
  document.getElementById('screen-tests').classList.remove('active');
  document.getElementById('screen-institutes').classList.add('active');
}

/* ---------- Screen: tests within the selected institute ---------- */
function renderTestLibraryForInstitute(inst){
  const LIB = computeLibrary();
  const container = document.getElementById('libraryGroups');
  container.innerHTML = '';

  const seriesMap = LIB[inst] || {};
  const seriesNames = Object.keys(seriesMap);

  if(seriesNames.length === 0){
    container.innerHTML = '<div class="test-empty">No tests are available for this institute yet.</div>';
    return;
  }

  seriesNames.forEach(series => {
    const seriesWrap = document.createElement('div');
    seriesWrap.className = 'series-group';
    seriesWrap.innerHTML = `<h3 class="series-heading">${escapeHtml(series)}</h3>`;

    const grid = document.createElement('div');
    grid.className = 'test-grid';

    seriesMap[series].forEach(test => {
      const parsed = parseQuestions(test.raw);
      const card = document.createElement('div');
      card.className = 'test-card';
      card.innerHTML = `
        <div class="test-card-info">
          <p class="test-card-title">${escapeHtml(test.title)}</p>
          <div class="test-card-meta">
            <span><b>${parsed.length}</b> questions</span>
            <span><b>${formatMinutesLabel(parsed.length)}</b></span>
            <span><b>+4 / &minus;1</b> marking</span>
          </div>
        </div>
        <div class="test-card-actions">
          ${test.pdf ? `<a class="pdf-btn" href="${escapeHtml(test.pdf)}" target="_blank" rel="noopener noreferrer">Download PDF</a>` : ''}
          <button class="start-btn" ${parsed.length === 0 ? 'disabled' : ''}>Start test</button>
        </div>
      `;
      card.querySelector('.start-btn').addEventListener('click', (e) => launchTestObj(test, inst, series, e.currentTarget));
      grid.appendChild(card);
    });

    seriesWrap.appendChild(grid);
    container.appendChild(seriesWrap);
  });
}

function launchTestObj(test, institute, series, btnEl){
  // Guard against a double click (or a slow tap registering twice) firing
  // startQuiz() more than once, which would leave two timers running.
  if(isLaunching) return;
  const parsed = parseQuestions(test.raw);
  if(parsed.length === 0) return;
  isLaunching = true;
  if(btnEl) btnEl.disabled = true;
  questions = parsed;
  testTitle = series && series !== 'General' ? `${test.title} — ${series}` : test.title;
  document.title = testTitle;
  startQuiz();
  isLaunching = false;
}

loadAllTestsAutomatically();

/* ============================================================
   QUIZ START / NAVIGATION
============================================================ */
function startQuiz(){
  candidateName = document.getElementById('candidateInput').value.trim();

  answers = {}; status = {};
  questions.forEach(q => { answers[q.id] = null; status[q.id] = 'not-visited'; });
  currentIndex = 0;
  totalSeconds = questions.length * 60;
  remainingSeconds = totalSeconds;

  document.getElementById('screen-tests').classList.remove('active');
  document.getElementById('screen-quiz').classList.add('active');
  document.getElementById('quizTitle').textContent = testTitle;

  renderPalette();
  renderQuestion();
  startTimer();
}

function renderQuestion(){
  const q = questions[currentIndex];
  if(status[q.id] === 'not-visited') status[q.id] = 'not-answered';

  document.getElementById('qNumber').textContent = `Question ${currentIndex+1} of ${questions.length}`;
  document.getElementById('qText').textContent = q.text;

  const qImg = document.getElementById('qImage');
  if(q.image){ qImg.src = q.image; qImg.classList.add('show'); }
  else { qImg.classList.remove('show'); qImg.removeAttribute('src'); }

  const optWrap = document.getElementById('qOptions');
  optWrap.innerHTML = '';
  Object.keys(q.options).sort().forEach(letter => {
    const selected = answers[q.id] === letter;
    const div = document.createElement('div');
    div.className = 'option' + (selected ? ' selected' : '');
    div.innerHTML = `
      <input type="radio" name="opt" id="opt-${letter}" ${selected?'checked':''}>
      <span class="opt-letter">${letter}</span>
      <label for="opt-${letter}">${escapeHtml(q.options[letter])}</label>
    `;
    div.addEventListener('click', () => selectOption(letter));
    optWrap.appendChild(div);
  });

  document.getElementById('prevBtn').disabled = currentIndex === 0;
  document.getElementById('prevBtn').style.opacity = currentIndex === 0 ? 0.4 : 1;
  document.getElementById('saveNextBtn').textContent = currentIndex === questions.length - 1 ? 'Save' : 'Save & next';

  renderPalette();
}

function selectOption(letter){
  const q = questions[currentIndex];
  answers[q.id] = letter;
  if(status[q.id] === 'marked') status[q.id] = 'answered-marked';
  else status[q.id] = 'answered';
  renderQuestion();
}

function clearResponse(){
  const q = questions[currentIndex];
  answers[q.id] = null;
  status[q.id] = (status[q.id] === 'answered-marked') ? 'marked' : 'not-answered';
  renderQuestion();
}

function saveAndNext(){
  goToIndex(Math.min(currentIndex+1, questions.length-1));
}
function markAndNext(){
  const q = questions[currentIndex];
  status[q.id] = answers[q.id] ? 'answered-marked' : 'marked';
  goToIndex(Math.min(currentIndex+1, questions.length-1));
}
function goPrev(){ goToIndex(Math.max(currentIndex-1, 0)); }
function goToIndex(i){ currentIndex = i; renderQuestion(); document.querySelector('.quiz-main').scrollTop = 0; closeSidebarOnMobile(); }

function renderPalette(){
  const wrap = document.getElementById('palette');
  wrap.innerHTML = '';
  questions.forEach((q, i) => {
    const btn = document.createElement('div');
    btn.className = 'pnum ' + status[q.id] + (i === currentIndex ? ' current' : '');
    btn.textContent = i+1;
    btn.addEventListener('click', () => goToIndex(i));
    wrap.appendChild(btn);
  });
}

function toggleSidebar(){ document.getElementById('quizSidebar').classList.toggle('open'); }
function closeSidebarOnMobile(){ document.getElementById('quizSidebar').classList.remove('open'); }

/* ============================================================
   TIMER
============================================================ */
function startTimer(){
  if(timerInterval){ clearInterval(timerInterval); timerInterval = null; }
  updateTimerDisplay();
  timerInterval = setInterval(() => {
    remainingSeconds--;
    updateTimerDisplay();
    if(remainingSeconds <= 0){
      clearInterval(timerInterval);
      submitTest(true);
    }
  }, 1000);
}
function updateTimerDisplay(){
  const el = document.getElementById('timerValue');
  const h = Math.floor(remainingSeconds/3600);
  const m = Math.floor((remainingSeconds%3600)/60);
  const s = remainingSeconds%60;
  el.textContent = (h>0 ? String(h).padStart(2,'0')+':' : '') + String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');
  el.classList.toggle('warn', remainingSeconds <= 300);
}

/* ============================================================
   SUBMIT / SCORING
============================================================ */
function confirmSubmit(){
  const unanswered = questions.filter(q => !answers[q.id]).length;
  const msg = unanswered > 0
    ? `You have ${unanswered} unanswered question${unanswered===1?'':'s'}. Submit anyway?`
    : 'Submit the test now?';
  if(confirm(msg)) submitTest(false);
}

let hasSubmitted = false;
function submitTest(autoSubmitted){
  if(hasSubmitted) return;
  hasSubmitted = true;
  if(timerInterval){ clearInterval(timerInterval); timerInterval = null; }

  let correct = 0, incorrect = 0, skipped = 0, score = 0;
  const reviewData = [];

  questions.forEach(q => {
    const given = answers[q.id];
    const wasMarked = status[q.id] === 'marked' || status[q.id] === 'answered-marked';
    let tag;
    if(!given){ skipped++; tag = 'skipped'; }
    else if(given === q.answer){ correct++; score += 4; tag = 'correct'; }
    else { incorrect++; score -= 1; tag = 'incorrect'; }
    reviewData.push({ q, given, tag, wasMarked });
  });

  document.getElementById('screen-quiz').classList.remove('active');
  document.getElementById('screen-result').classList.add('active');
  document.title = testTitle + ' — Result';

  document.getElementById('reportTestName').textContent = testTitle;
  const now = new Date();
  const dateStr = now.toLocaleDateString(undefined, { day:'2-digit', month:'short', year:'numeric' });
  const timeStr = now.toLocaleTimeString(undefined, { hour:'2-digit', minute:'2-digit' });
  document.getElementById('reportMeta').innerHTML =
    (candidateName ? `<b>${escapeHtml(candidateName)}</b><br>` : '') +
    `${dateStr}, ${timeStr}`;

  document.getElementById('resScore').innerHTML = score + '<span id="resMax">/' + (questions.length*4) + '</span>';
  document.getElementById('resCorrect').textContent = correct;
  document.getElementById('resIncorrect').textContent = incorrect;
  document.getElementById('resSkipped').textContent = skipped;

  const listEl = document.getElementById('reviewList');
  listEl.innerHTML = '';
  reviewData.forEach((item, i) => {
    const q = item.q;
    const div = document.createElement('div');
    div.className = 'review-item';
    const tagLabel = item.tag === 'correct' ? 'Correct (+4)' : item.tag === 'incorrect' ? 'Incorrect (\u22121)' : 'Unattempted (0)';
    let optsHtml = '';
    Object.keys(q.options).sort().forEach(letter => {
      let cls = '';
      if(letter === q.answer) cls = 'is-correct';
      else if(letter === item.given) cls = 'is-wrong';
      optsHtml += `<div class="review-opt ${cls}">${letter}. ${escapeHtml(q.options[letter])}</div>`;
    });
    const markedBadge = item.wasMarked ? '<span class="rtag marked-badge">Marked for review</span>' : '';
    div.innerHTML = `
      <div class="rh">
        <span class="rn">Question ${i+1}</span>
        <span style="display:flex;gap:6px;">${markedBadge}<span class="rtag ${item.tag}">${tagLabel}</span></span>
      </div>
      <p class="rq">${escapeHtml(q.text)}</p>
      <div class="review-opts">${optsHtml}</div>
    `;
    listEl.appendChild(div);
  });
}

/* ============================================================
   UTIL
============================================================ */
function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
