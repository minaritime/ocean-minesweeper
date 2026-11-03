import { LEVELS, createBoard, keepLargestOcean, reveal, chord, toggleFlag, progress } from './game.js';
import { decodeLand, makeLayout, buildOceanMask, buildCoastPath, carveStraits } from './geo.js';
import { draw, createLayer, paintLayer } from './render.js';
import {
  normalizeHistory, addPlay, addClear, summarize, rankOf, formatDuration, formatClock, formatDate, formatPercent,
} from './records.js';
import { snapshot, restore } from './save.js';

const LONG_PRESS_MS = 380;
const DRAG_THRESHOLD = 7;
const MAX_CELL_PX = 90;
const FILL_CELL_PX_MAX = 40;
const MIN_PLAY_PX = 8; // 칸이 이보다 작으면 누른 곳을 먼저 확대한다
const TAP_ZOOM_PX = 26;
const WHEEL_SPEED = 0.0025;
const BUTTON_ZOOM = 1.5;
const RESULT_DELAY = { won: 450, lost: 900 };
const STORE_KEY = 'world-minesweeper-v3';
const RECORD_LIST_LIMIT = 50;
const SAVE_KEY = 'world-minesweeper-save';
const SAVE_DELAY_MS = 800;
const TOAST_MS = 3200;
const CONFIRM_RESTART_AFTER_SEC = 60;

const $ = (id) => document.getElementById(id);
const canvas = $('board');
const ctx = canvas.getContext('2d');
const mod = (a, n) => ((a % n) + n) % n;

const store = {
  read() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; }
  },
  write(data) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch { /* 저장 불가 환경은 기록 없이 진행 */ }
  },
};

const saved = store.read();
const state = {
  polygons: null,
  level: LEVELS[saved.level] ? saved.level : 'easy',
  history: normalizeHistory(saved.history),
  recordsLevel: null,
  recordsSort: 'time',
  lastClear: null,
  game: null,
  view: { w: 0, h: 0, dpr: 1, z: 20, panX: 0, panY: 0, fitZ: 20 },
  hover: -1,
  flagMode: false,
  startTime: 0,
  endTime: 0,
  timer: 0,
  resultTimer: 0,
  saveTimer: 0,
  pendingResume: null,
  frame: 0,
};

/* ---------- 화면 ---------- */

function requestRender() {
  if (state.frame) return;
  state.frame = requestAnimationFrame(() => {
    state.frame = 0;
    draw(ctx, state.view, state.game, state.hover);
  });
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const v = state.view;
  const cx = v.w / 2;
  const cy = v.h / 2;
  v.dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * v.dpr);
  canvas.height = Math.round(rect.height * v.dpr);
  v.panX += rect.width / 2 - cx;
  v.panY += rect.height / 2 - cy;
  v.w = rect.width;
  v.h = rect.height;
  if (state.game) {
    v.fitZ = Math.min(v.w / state.game.layout.cols, v.h / state.game.layout.rows);
    clampView();
  }
  requestRender();
}

function clampView() {
  const v = state.view;
  const { cols, rows } = state.game.layout;
  v.z = Math.min(MAX_CELL_PX, Math.max(v.fitZ * 0.8, v.z));
  v.panX = -mod(-v.panX, cols * v.z);
  const height = rows * v.z;
  if (height <= v.h) v.panY = (v.h - height) / 2;
  else v.panY = Math.min(40, Math.max(v.h - height - 40, v.panY));
}

function fitView() {
  const v = state.view;
  const { cols, rows } = state.game.layout;
  v.fitZ = Math.min(v.w / cols, v.h / rows);
  v.z = Math.max(v.fitZ, Math.min(FILL_CELL_PX_MAX, v.h / rows));
  v.panX = (v.w - cols * v.z) / 2;
  v.panY = (v.h - rows * v.z) / 2;
  clampView();
  requestRender();
}

function zoomAt(sx, sy, factor) {
  if (!state.game) return;
  const v = state.view;
  const wx = (sx - v.panX) / v.z;
  const wy = (sy - v.panY) / v.z;
  v.z = Math.min(MAX_CELL_PX, Math.max(v.fitZ * 0.8, v.z * factor));
  v.panX = sx - wx * v.z;
  v.panY = sy - wy * v.z;
  clampView();
  requestRender();
}

function cellAt(sx, sy) {
  const v = state.view;
  const { cols, rows } = state.game.layout;
  const r = Math.floor((sy - v.panY) / v.z);
  if (r < 0 || r >= rows) return -1;
  return r * cols + mod(Math.floor((sx - v.panX) / v.z), cols);
}

/* ---------- 상단 정보 ---------- */

function elapsedSeconds() {
  if (!state.startTime) return 0;
  return ((state.endTime || performance.now()) - state.startTime) / 1000;
}

function updateHud() {
  const b = state.game?.board;
  $('flags').textContent = b ? b.mineCount - b.flags : 0;
  $('time').textContent = formatClock(elapsedSeconds());
  document.querySelectorAll('header .levels button').forEach((btn) => {
    btn.setAttribute('aria-pressed', String(btn.dataset.level === state.level));
  });
  $('flagMode').setAttribute('aria-pressed', String(state.flagMode));
  $('flagMode').textContent = state.flagMode ? '🚩' : '⛏';
}

function stopTimer() {
  clearInterval(state.timer);
  state.timer = 0;
}

/* ---------- 게임 흐름 ---------- */

function save() {
  store.write({ level: state.level, history: state.history });
}

function installGame(level, layout, board) {
  state.level = level;
  save();
  const layer = createLayer(board);
  paintLayer(layer, board);
  state.game = { layout, board, layer, coast: buildCoastPath(state.polygons, layout) };
  stopTimer();
  clearTimeout(state.resultTimer);
  state.startTime = 0;
  state.endTime = 0;
  state.hover = -1;
  hideResult();
  hideRecords();
  hideResume();
}

function newGame(level = state.level) {
  if (!state.polygons) return;
  clearSavedGame();
  const { cols, density } = LEVELS[level];
  const layout = makeLayout(cols);
  const carved = carveStraits(buildOceanMask(state.polygons, layout), layout);
  const ocean = keepLargestOcean(carved, layout.cols, layout.rows);
  installGame(level, layout, createBoard(ocean, layout.cols, layout.rows, density));
  fitView();
  updateHud();
}

/* ---------- 이어하기 저장 ---------- */

function showToast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(el.hideTimer);
  el.hideTimer = setTimeout(() => el.classList.remove('show'), TOAST_MS);
}

function writeSavedGame() {
  clearTimeout(state.saveTimer);
  state.saveTimer = 0;
  const g = state.game;
  if (!g || g.board.state !== 'playing' || !state.startTime) return;
  const data = snapshot({
    level: state.level, layout: g.layout, board: g.board, elapsed: elapsedSeconds(), view: state.view, savedAt: Date.now(),
  });
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch (err) {
    showToast('저장 공간이 부족해 이어하기 저장에 실패했습니다');
    console.error('save failed', err);
  }
}

function scheduleSave() {
  if (state.saveTimer) return;
  state.saveTimer = setTimeout(writeSavedGame, SAVE_DELAY_MS);
}

function clearSavedGame() {
  clearTimeout(state.saveTimer);
  state.saveTimer = 0;
  try { localStorage.removeItem(SAVE_KEY); } catch { /* 저장소를 못 쓰는 환경이면 지울 것도 없다 */ }
}

function readSavedGame() {
  try {
    return restore(JSON.parse(localStorage.getItem(SAVE_KEY)));
  } catch {
    return null;
  }
}

/** 저장된 판을 멈춘 채로 깔아 두고 고르는 창을 띄운다 */
function offerResume(saved) {
  installGame(saved.level, saved.layout, saved.board);
  state.pendingResume = saved;
  fitView();
  if (saved.view) {
    Object.assign(state.view, saved.view);
    clampView();
  }
  updateHud();
  $('time').textContent = formatClock(saved.elapsed);
  requestRender();
  $('resumeLevel').textContent = LEVELS[saved.level].label;
  $('resumeTime').textContent = formatDuration(saved.elapsed);
  $('resumeProgress').textContent = formatPercent(progress(saved.board));
  $('resumeSaved').textContent = Number.isFinite(saved.savedAt) ? formatDate(saved.savedAt) : '';
  $('resume').classList.add('show');
  $('resumeGo').focus();
}

function resumeGame() {
  const saved = state.pendingResume;
  if (!saved) return;
  state.pendingResume = null;
  hideResume();
  state.startTime = performance.now() - saved.elapsed * 1000;
  state.timer = setInterval(updateHud, 250);
  updateHud();
}

function hideResume() {
  $('resume').classList.remove('show');
}

const isResumeOpen = () => $('resume').classList.contains('show');

/** 오래 진행한 판을 실수로 버리지 않도록 한 번 묻는다 */
function requestNewGame(level = state.level) {
  const playing = state.game?.board.state === 'playing';
  if (playing && elapsedSeconds() > CONFIRM_RESTART_AFTER_SEC
    && !window.confirm(`${formatClock(elapsedSeconds())} 동안 진행한 판입니다. 버리고 새로 시작할까요?`)) return;
  newGame(level);
}

function finish(won) {
  state.endTime = performance.now();
  stopTimer();
  clearSavedGame();
  const time = elapsedSeconds();
  let rank = 0;
  if (won) {
    const { board } = state.game;
    const entry = { level: state.level, time, at: Date.now(), mines: board.mineCount, cells: board.oceanCount };
    state.history = addClear(state.history, entry);
    state.lastClear = entry;
    rank = rankOf(state.history, entry);
    save();
  }
  if (!won && navigator.vibrate) navigator.vibrate(120);
  updateHud();
  state.resultTimer = setTimeout(() => showResult(won, time, rank), won ? RESULT_DELAY.won : RESULT_DELAY.lost);
}

function act(i, wantFlag) {
  const b = state.game?.board;
  if (!b || i < 0 || !b.ocean[i]) return;
  let outcome = 'none';
  if (b.open[i]) outcome = chord(b, i);
  else if (wantFlag) toggleFlag(b, i);
  else outcome = reveal(b, i);
  if (b.state !== 'ready' && !state.startTime) {
    state.startTime = performance.now();
    state.history = addPlay(state.history, state.level);
    save();
    state.timer = setInterval(updateHud, 250);
  }
  if (outcome === 'boom') finish(false);
  if (outcome === 'won') finish(true);
  if (b.state === 'playing') scheduleSave();
  paintLayer(state.game.layer, b);
  updateHud();
  requestRender();
}

/* ---------- 결과창 ---------- */

function showResult(won, time, rank) {
  const { best, clears } = summarize(state.history, state.level);
  $('resultIcon').textContent = won ? '🏆' : '💥';
  $('resultTitle').textContent = won ? '바다를 모두 지켰습니다!' : '지뢰를 밟았습니다';
  let note = '';
  if (won) note = rank === 1 ? '새 최고 기록!' : `${LEVELS[state.level].label} ${clears}번 클리어 중 ${rank}위`;
  $('resultRecord').textContent = note;
  $('resultTime').textContent = formatDuration(time);
  $('resultSubLabel').textContent = won ? `최고 기록 (${LEVELS[state.level].label})` : '찾아낸 바다';
  $('resultSub').textContent = won ? formatDuration(best) : formatPercent(progress(state.game.board));
  $('result').classList.add('show');
  $('again').focus();
}

function hideResult() {
  $('result').classList.remove('show');
}

const isResultOpen = () => $('result').classList.contains('show');

/* ---------- 기록창 ---------- */

function recordRow(entry, rankNo) {
  const li = document.createElement('li');
  if (entry === state.lastClear) li.classList.add('fresh');
  const parts = [['rank', String(rankNo)], ['t', formatDuration(entry.time)], ['d', formatDate(entry.at)]];
  for (const [cls, text] of parts) {
    const span = document.createElement('span');
    span.className = cls;
    span.textContent = text;
    li.append(span);
  }
  return li;
}

function renderRecords() {
  const level = state.recordsLevel;
  const sum = summarize(state.history, level);
  $('recordTabs').querySelectorAll('button').forEach((btn) => {
    btn.setAttribute('aria-pressed', String(btn.dataset.level === level));
  });
  document.querySelectorAll('.sort button').forEach((btn) => {
    btn.setAttribute('aria-pressed', String(btn.dataset.sort === state.recordsSort));
  });
  $('recBest').textContent = sum.best === null ? '없음' : formatDuration(sum.best);
  $('recClears').textContent = `${sum.clears}번`;
  $('recPlays').textContent = `${sum.plays}번`;
  const list = (state.recordsSort === 'time' ? sum.byTime : sum.recent).slice(0, RECORD_LIST_LIMIT);
  const ol = $('recList');
  ol.replaceChildren();
  if (!list.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = '아직 클리어 기록이 없습니다';
    ol.append(li);
    return;
  }
  list.forEach((entry) => ol.append(recordRow(entry, sum.byTime.indexOf(entry) + 1)));
}

function openRecords(level = state.level) {
  state.recordsLevel = level;
  hideResult();
  renderRecords();
  $('records').classList.add('show');
  $('closeRecords').focus();
}

function hideRecords() {
  $('records').classList.remove('show');
}

const isRecordsOpen = () => $('records').classList.contains('show');

/* ---------- 입력 ---------- */

const pointers = new Map();
let gesture = null;

function pinchInfo() {
  const [a, b] = [...pointers.values()];
  return { dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
}

function localPoint(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function onPointerDown(e) {
  if (!state.game) return;
  canvas.setPointerCapture(e.pointerId);
  const p = localPoint(e);
  pointers.set(e.pointerId, p);
  if (pointers.size === 1) {
    gesture = { kind: 'tap', button: e.button, start: p, last: p, longPressed: false, timer: 0 };
    if (e.pointerType !== 'mouse') {
      gesture.timer = setTimeout(() => {
        if (gesture?.kind !== 'tap') return;
        if (state.view.z < MIN_PLAY_PX) return;
        gesture.longPressed = true;
        if (navigator.vibrate) navigator.vibrate(25);
        act(cellAt(p.x, p.y), !state.flagMode);
      }, LONG_PRESS_MS);
    }
  } else if (pointers.size === 2) {
    if (gesture) clearTimeout(gesture.timer);
    gesture = { kind: 'pinch', ...pinchInfo() };
  }
}

function onPointerMove(e) {
  if (!state.game) return;
  const p = localPoint(e);
  if (!pointers.has(e.pointerId)) {
    const cell = cellAt(p.x, p.y);
    if (cell !== state.hover) {
      state.hover = cell;
      requestRender();
    }
    return;
  }
  pointers.set(e.pointerId, p);
  const v = state.view;
  if (gesture?.kind === 'pinch' && pointers.size === 2) {
    const now = pinchInfo();
    v.panX += now.mx - gesture.mx;
    v.panY += now.my - gesture.my;
    zoomAt(now.mx, now.my, now.dist / gesture.dist);
    gesture = { kind: 'pinch', ...now };
    return;
  }
  if (!gesture || pointers.size !== 1) return;
  if (gesture.kind === 'tap' && Math.hypot(p.x - gesture.start.x, p.y - gesture.start.y) > DRAG_THRESHOLD) {
    clearTimeout(gesture.timer);
    gesture.kind = 'drag';
    canvas.classList.add('grabbing');
  }
  if (gesture.kind === 'drag') {
    v.panX += p.x - gesture.last.x;
    v.panY += p.y - gesture.last.y;
    clampView();
    requestRender();
  }
  gesture.last = p;
}

function onPointerUp(e) {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  canvas.classList.remove('grabbing');
  if (gesture?.kind === 'tap' && !gesture.longPressed && pointers.size === 0) {
    clearTimeout(gesture.timer);
    const { x, y } = gesture.start;
    if (state.view.z < MIN_PLAY_PX) zoomAt(x, y, TAP_ZOOM_PX / state.view.z);
    else if (gesture.button === 2) act(cellAt(x, y), true);
    else if (gesture.button === 1) act(cellAt(x, y), false);
    else act(cellAt(x, y), state.flagMode);
  }
  if (pointers.size === 0) gesture = null;
  else if (gesture?.kind === 'pinch') {
    const [rest] = pointers.values();
    gesture = { kind: 'drag', last: rest };
  }
}

function onPointerCancel(e) {
  pointers.delete(e.pointerId);
  if (gesture) clearTimeout(gesture.timer);
  gesture = null;
  canvas.classList.remove('grabbing');
}

function onWheel(e) {
  e.preventDefault();
  const p = localPoint(e);
  zoomAt(p.x, p.y, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : WHEEL_SPEED)));
}

function onKey(e) {
  if (isResumeOpen()) {
    if (e.key === 'Enter') { e.preventDefault(); resumeGame(); }
    return;
  }
  if (isRecordsOpen()) {
    if (e.key === 'Escape' || e.key === 'h' || e.key === 'H') hideRecords();
    return;
  }
  if (isResultOpen()) {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      newGame();
    } else if (e.key === 'Escape') hideResult();
    return;
  }
  const k = e.key.toLowerCase();
  if (k === 'r' || e.key === 'F2') { e.preventDefault(); requestNewGame(); }
  else if (k === 'h') openRecords();
  else if (k === 'f') { state.flagMode = !state.flagMode; updateHud(); }
  else if (e.key === '+' || e.key === '=') zoomAt(state.view.w / 2, state.view.h / 2, 1.25);
  else if (e.key === '-') zoomAt(state.view.w / 2, state.view.h / 2, 0.8);
  else if (e.key === '0') fitView();
}

function bindUi() {
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);
  canvas.addEventListener('pointerleave', () => { if (!pointers.size) { state.hover = -1; requestRender(); } });
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  // 휴대폰 브라우저가 지도 위 터치를 근처 버튼 클릭으로 보정하지 않도록 막는다
  canvas.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  canvas.addEventListener('click', () => {}); // 지도도 눌리는 대상임을 알려 터치 보정이 버튼으로 새지 않게 한다
  window.addEventListener('resize', resizeCanvas);
  window.addEventListener('keydown', onKey);
  document.querySelectorAll('header .levels button').forEach((btn) => {
    btn.addEventListener('click', () => { requestNewGame(btn.dataset.level); btn.blur(); });
  });
  Object.entries(LEVELS).forEach(([key, lv]) => {
    const tab = document.createElement('button');
    tab.dataset.level = key;
    tab.textContent = lv.label;
    tab.addEventListener('click', () => { state.recordsLevel = key; renderRecords(); });
    $('recordTabs').append(tab);
  });
  document.querySelectorAll('.sort button').forEach((btn) => {
    btn.addEventListener('click', () => { state.recordsSort = btn.dataset.sort; renderRecords(); });
  });
  $('openRecords').addEventListener('click', (e) => { openRecords(); e.currentTarget.blur(); });
  $('resultRecords').addEventListener('click', () => openRecords());
  $('closeRecords').addEventListener('click', hideRecords);
  $('records').addEventListener('click', (e) => { if (e.target === e.currentTarget) hideRecords(); });
  $('restart').addEventListener('click', (e) => { requestNewGame(); e.currentTarget.blur(); });
  $('flagMode').addEventListener('click', (e) => { state.flagMode = !state.flagMode; updateHud(); e.currentTarget.blur(); });
  $('zoomIn').addEventListener('click', () => zoomAt(state.view.w / 2, state.view.h / 2, BUTTON_ZOOM));
  $('zoomOut').addEventListener('click', () => zoomAt(state.view.w / 2, state.view.h / 2, 1 / BUTTON_ZOOM));
  $('zoomFit').addEventListener('click', fitView);
  $('again').addEventListener('click', () => newGame());
  $('resumeGo').addEventListener('click', resumeGame);
  $('resumeNew').addEventListener('click', () => { state.pendingResume = null; newGame(); });
  // 창을 닫거나 다른 앱으로 넘어갈 때 바로 저장한다
  window.addEventListener('pagehide', writeSavedGame);
  document.addEventListener('visibilitychange', () => { if (document.hidden) writeSavedGame(); });
  $('viewMap').addEventListener('click', hideResult);
}

async function start() {
  bindUi();
  resizeCanvas();
  updateHud();
  try {
    const res = await fetch('data/land-110m.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.polygons = decodeLand(await res.json());
    $('status').remove();
    const saved = readSavedGame();
    if (saved) offerResume(saved);
    else newGame();
  } catch (err) {
    $('status').textContent = '지도를 불러오지 못했습니다. 새로고침 해 주세요.';
    console.error('land data load failed', err);
  }
}

start();
