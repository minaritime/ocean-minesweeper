import { LEVELS, MODES, createBoard, keepLargestOcean, reveal, chord, toggleFlag, progress } from './game.js';
import { decodeLand, makeLayout, buildOceanMask, buildCoastPath, carveStraits } from './geo.js';
import { draw, createLayer, paintLayer } from './render.js';
import {
  normalizeHistory, addPlay, addClear, summarize, rankOf, formatDuration, formatClock, formatPercent,
} from './records.js';
import { snapshot, restore, emptyAbilities, lostSnapshot, restoreLost } from './save.js';
import { renderAbilityBar } from './ability-ui.js';
import { createAbilityFlow } from './ability-flow.js';
import { createEffects } from './effects.js';
import { renderRecords as renderRecordsView } from './records-ui.js';
import { buildStart, renderStart } from './start-ui.js';

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
const SAVE_KEY = 'world-minesweeper-save';
const LOST_KEY = 'world-minesweeper-lost'; // 마지막으로 진 판 (였던것)
const SAVE_DELAY_MS = 800;
const TOAST_MS = 3200;
const CONFIRM_RESTART_AFTER_SEC = 60;

const $ = (id) => document.getElementById(id);
const canvas = $('board');
const ctx = canvas.getContext('2d');
const mod = (a, n) => ((a % n) + n) % n;
const effects = createEffects();

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
  mode: MODES[saved.mode] ? saved.mode : 'basic',
  pick: null, // 시작 화면에서 고른 모드·난이도
  abilities: emptyAbilities(),
  aiming: null, // 대상을 고르는 중인 능력
  aimFirst: -1, // 양자역학: 먼저 고른 칸
  busy: false, // 핵전쟁 연출 중에는 입력을 막는다
  pauseAt: 0, // 능력 고르기 창이 떠 있는 동안 시계를 멈춘 때
  history: normalizeHistory(saved.history),
  recordsLevel: null,
  recordsMode: 'basic',
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
    draw(ctx, state.view, state.game, state.hover, flow.aimCells(), state.abilities.counts);
    const [dx, dy] = effects.shake();
    canvas.style.transform = dx || dy ? `translate(${dx}px, ${dy}px)` : '';
    if (effects.draw(ctx, state.view)) requestRender();
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
  return ((state.endTime || state.pauseAt || performance.now()) - state.startTime) / 1000;
}

function updateHud() {
  const b = state.game?.board;
  $('flags').textContent = b ? b.mineCount - b.flags : 0;
  $('time').textContent = formatClock(state.pendingResume ? state.pendingResume.elapsed : elapsedSeconds());
  $('gameLabel').textContent = fullLabel(state.level, state.mode);
  renderAbilityBar($('abilityBar'), state.mode === 'ability' ? state.abilities.inv : [], state.aiming, flow.useAbility);
  canvas.classList.toggle('aiming', Boolean(state.aiming));
  $('flagMode').setAttribute('aria-pressed', String(state.flagMode));
  $('flagMode').textContent = state.flagMode ? '🚩' : '⛏';
}

function stopTimer() {
  clearInterval(state.timer);
  state.timer = 0;
}

/* ---------- 게임 흐름 ---------- */

function save() {
  store.write({ level: state.level, mode: state.mode, history: state.history });
}

function installGame(level, layout, board, mode = state.mode, abilities = emptyAbilities()) {
  state.level = level;
  state.mode = mode;
  state.abilities = abilities;
  state.aiming = null;
  state.aimFirst = -1;
  state.pauseAt = 0;
  state.pendingResume = null;
  flow.hideOffer();
  save();
  state.game = { layout, board, ...boardLayers(board, layout, abilities.look) };
  stopTimer();
  clearTimeout(state.resultTimer);
  state.startTime = 0;
  state.endTime = 0;
  state.hover = -1;
  hideResult();
  hideRecords();
}

/** 바탕 그림과 해안선. 핵전쟁 뒤에는 대륙이 없어 해안선도 없다 */
function boardLayers(board, layout, look) {
  const layer = createLayer(board, look);
  paintLayer(layer, board);
  return { layer, coast: look === 'nuke' ? null : buildCoastPath(state.polygons, layout) };
}

/** 사건으로 판만 바꾼다 (시계·능력은 그대로) */
function swapBoard(board, look) {
  state.abilities = { ...state.abilities, look, counts: [] };
  state.game = { ...state.game, board, ...boardLayers(board, state.game.layout, look) };
  updateHud();
  requestRender();
}

function newGame(level = state.level, mode = state.mode) {
  if (!state.polygons) return;
  clearSavedGame();
  const { cols, density } = LEVELS[level];
  const layout = makeLayout(cols);
  const carved = carveStraits(buildOceanMask(state.polygons, layout), layout);
  const ocean = keepLargestOcean(carved, layout.cols, layout.rows);
  installGame(level, layout, createBoard(ocean, layout.cols, layout.rows, density), mode);
  fitView();
  updateHud();
}

/* ---------- 이어하기 저장 ---------- */

function showToast(text, kind = 'error') {
  const el = $('toast');
  el.textContent = text;
  el.classList.toggle('info', kind === 'info');
  el.classList.add('show');
  clearTimeout(el.hideTimer);
  el.hideTimer = setTimeout(() => el.classList.remove('show'), TOAST_MS);
}

function writeSavedGame() {
  clearTimeout(state.saveTimer);
  state.saveTimer = 0;
  const g = state.game;
  if (!g || g.board.state !== 'playing' || !state.startTime || state.busy) return; // 핵전쟁 연출 중에는 판이 바뀌는 중이라 저장하지 않는다
  const data = snapshot({
    mode: state.mode,
    abilities: state.abilities,
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

/** 저장된 판을 멈춘 채로 깔아 둔다 (시작 화면의 이어하기 팻말로 이어 간다) */
function installSaved(saved) {
  installGame(saved.level, saved.layout, saved.board, saved.mode, saved.abilities);
  state.pendingResume = saved;
  fitView();
  if (saved.view) {
    Object.assign(state.view, saved.view);
    clampView();
  }
  updateHud();
  requestRender();
}

function resumeGame() {
  const saved = state.pendingResume;
  if (!saved) return;
  state.pendingResume = null;
  state.startTime = performance.now() - saved.elapsed * 1000;
  state.timer = setInterval(updateHud, 250);
  updateHud();
  flow.checkMilestones();
}

/* ---------- 시작 화면 ---------- */

const isStartOpen = () => $('start').classList.contains('show');

/** 이어 갈 판: 저장해 둔 판이나, 시작 화면을 열기 전까지 하던 판 */
function continuable() {
  const saved = state.pendingResume;
  if (saved) return { level: saved.level, mode: saved.mode, elapsed: saved.elapsed, board: saved.board };
  const b = state.game?.board;
  if (!b || b.state !== 'playing' || !state.startTime) return null;
  return { level: state.level, mode: state.mode, elapsed: elapsedSeconds(), board: b };
}

function showStartView() {
  const c = continuable();
  const continueText = c && `${fullLabel(c.level, c.mode)} · ${formatClock(c.elapsed)} · 바다 ${formatPercent(progress(c.board))}`;
  renderStart({ pick: state.pick, continueText });
}

/** 시작 화면을 연다. 하던 판은 멈추고 저장해 두었다가 팻말로 이어 간다 */
function openStart() {
  if (isStartOpen() || state.busy) return;
  state.aiming = null;
  state.aimFirst = -1;
  hideResult();
  hideRecords();
  writeSavedGame();
  pauseClock();
  if (!state.pick) state.pick = { level: state.level, mode: state.mode };
  showStartView();
  $('start').classList.add('show');
  $('startGo').focus();
  updateHud();
  requestRender();
}

function hideStart() {
  $('start').classList.remove('show');
}

function continueGame() {
  if (!continuable()) return;
  hideStart();
  if (state.pendingResume) resumeGame();
  else {
    resumeClock();
    flow.checkMilestones();
  }
}

/** 고른 모드·난이도로 새 판. 오래 진행한 판을 실수로 버리지 않도록 한 번 묻는다 */
function startNew() {
  const c = continuable();
  if (c && c.elapsed > CONFIRM_RESTART_AFTER_SEC
    && !window.confirm(`${formatClock(c.elapsed)} 동안 진행한 판입니다. 버리고 새로 시작할까요?`)) return;
  hideStart();
  state.pendingResume = null;
  newGame(state.pick.level, state.pick.mode);
}

function setPick(change) {
  state.pick = { ...state.pick, ...change };
  showStartView();
}

function finish(won) {
  if (!won) writeLostGame();
  state.endTime = performance.now();
  state.aiming = null;
  flow.hideOffer();
  stopTimer();
  clearSavedGame();
  const time = elapsedSeconds();
  let rank = 0;
  if (won) {
    const { board } = state.game;
    const entry = { level: state.level, mode: state.mode, time, at: Date.now(), mines: board.mineCount, cells: board.oceanCount };
    if (state.mode === 'ability') entry.picks = [...state.abilities.picks];
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
  if (!b || i < 0) return;
  if (state.busy) return;
  if (state.aiming) {
    flow.aimAt(i);
    return;
  }
  if (!b.ocean[i]) return;
  const guard = flow.guardKey();
  const options = { shield: Boolean(guard) };
  let outcome = 'none';
  if (b.open[i]) outcome = chord(b, i, options);
  else if (wantFlag) toggleFlag(b, i);
  else outcome = reveal(b, i, Math.random, options);
  if (b.state !== 'ready' && !state.startTime) {
    state.startTime = performance.now();
    state.history = addPlay(state.history, state.level, state.mode);
    save();
    state.timer = setInterval(updateHud, 250);
  }
  if (outcome === 'shielded') outcome = flow.onGuarded(guard);
  afterMove(outcome);
}

/** 판이 바뀐 뒤 공통 처리: 끝났는지, 저장, 다시 그리기, 능력 받을 단계 */
function afterMove(outcome) {
  const b = state.game.board;
  if (outcome === 'boom') finish(false);
  if (outcome === 'won') finish(true);
  if (b.state === 'playing') scheduleSave();
  paintLayer(state.game.layer, b);
  updateHud();
  requestRender();
  flow.checkMilestones();
}

/* ---------- 능력 모드 ---------- */

function pauseClock() {
  if (!state.startTime || state.pauseAt || state.endTime) return;
  state.pauseAt = performance.now();
  stopTimer();
}

function resumeClock() {
  if (!state.pauseAt) return;
  state.startTime += performance.now() - state.pauseAt;
  state.pauseAt = 0;
  state.timer = setInterval(updateHud, 250);
  updateHud();
}

/** 진 판을 남겨 둔다 (였던것으로 이어 하기) */
function writeLostGame() {
  const g = state.game;
  if (!g || !state.startTime) return;
  try {
    const data = lostSnapshot({
      mode: state.mode, abilities: state.abilities, level: state.level, layout: g.layout, board: g.board,
      elapsed: elapsedSeconds(), view: state.view, savedAt: Date.now(),
    }, g.board.exploded);
    localStorage.setItem(LOST_KEY, JSON.stringify(data));
  } catch (err) {
    console.error('lost game save failed', err);
  }
}

function readLostGame() {
  try {
    return restoreLost(JSON.parse(localStorage.getItem(LOST_KEY)));
  } catch {
    return null;
  }
}

function clearLostGame() {
  try { localStorage.removeItem(LOST_KEY); } catch { /* 지울 것이 없다 */ }
}

/** 진 판을 능력 모드로 깔고 그 판의 시간부터 다시 센다 */
function installLost(lost, abilities) {
  installGame(lost.level, lost.layout, lost.board, 'ability', abilities);
  fitView();
  if (lost.view) {
    Object.assign(state.view, lost.view);
    clampView();
  }
  state.startTime = performance.now() - lost.elapsed * 1000;
  state.timer = setInterval(updateHud, 250);
  scheduleSave();
  updateHud();
}

const flow = createAbilityFlow({
  state,
  $,
  effects,
  afterMove: (outcome) => afterMove(outcome),
  refresh: () => { updateHud(); requestRender(); },
  pauseClock,
  resumeClock,
  scheduleSave: () => scheduleSave(),
  showToast: (text, kind) => showToast(text, kind),
  isBlocked: () => isStartOpen(),
  swapBoard,
  showWorld: () => fitView(),
  landMask: () => buildOceanMask(state.polygons, state.game.layout).map((v) => (v ? 0 : 1)),
  density: () => LEVELS[state.level].density,
  readLost: readLostGame,
  clearLost: clearLostGame,
  installLost,
});

const levelLabel = (level, mode) => (mode === 'basic' ? LEVELS[level].label : `${MODES[mode].label} · ${LEVELS[level].label}`);
const fullLabel = (level, mode) => `${MODES[mode].label} · ${LEVELS[level].label}`;

/* ---------- 결과창 ---------- */

function showResult(won, time, rank) {
  const { best, clears } = summarize(state.history, state.level, state.mode);
  const label = levelLabel(state.level, state.mode);
  $('resultIcon').textContent = won ? '🏆' : '💥';
  $('resultTitle').textContent = won ? '바다를 모두 지켰습니다!' : '지뢰를 밟았습니다';
  let note = '';
  if (won) note = rank === 1 ? '새 최고 기록!' : `${label} ${clears}번 클리어 중 ${rank}위`;
  $('resultRecord').textContent = note;
  $('resultTime').textContent = formatDuration(time);
  $('resultSubLabel').textContent = won ? `최고 기록 (${label})` : '찾아낸 바다';
  $('resultSub').textContent = won ? formatDuration(best) : formatPercent(progress(state.game.board));
  $('result').classList.add('show');
  $('again').focus();
}

function hideResult() {
  $('result').classList.remove('show');
}

const isResultOpen = () => $('result').classList.contains('show');

/* ---------- 기록창 ---------- */

function renderRecords() {
  renderRecordsView({
    history: state.history, level: state.recordsLevel, mode: state.recordsMode, sort: state.recordsSort, lastClear: state.lastClear,
  });
}

function openRecords(level = state.level) {
  state.recordsLevel = level;
  state.recordsMode = state.mode;
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
    else if (gesture.button === 2 && state.aiming) flow.cancelAim();
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
  if (state.busy) return;
  if (flow.isOfferOpen()) {
    const pick = state.abilities.offer?.[Number(e.key) - 1];
    if (pick) { e.preventDefault(); flow.pickAbility(pick); }
    return;
  }
  if (isStartOpen()) {
    if (e.key === 'Escape') continueGame();
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
  const slot = state.mode === 'ability' && /^[1-9]$/.test(e.key) ? state.abilities.inv[Number(e.key) - 1] : null;
  if (slot) { e.preventDefault(); flow.useAbility(slot.key); return; }
  if (e.key === 'Escape' && state.aiming) { flow.cancelAim(); return; }
  if (k === 'r' || e.key === 'F2') { e.preventDefault(); openStart(); }
  else if (k === 'h') openRecords();
  else if (k === 'f') { state.flagMode = !state.flagMode; updateHud(); }
  else if (e.key === '+' || e.key === '=') zoomAt(state.view.w / 2, state.view.h / 2, 1.25);
  else if (e.key === '-') zoomAt(state.view.w / 2, state.view.h / 2, 0.8);
  else if (e.key === '0') fitView();
}

function bindStart() {
  buildStart({ modes: MODES, levels: LEVELS, onPick: setPick });
  $('startGo').addEventListener('click', startNew);
  $('continueGo').addEventListener('click', continueGame);
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
  bindStart();
  Object.entries(MODES).forEach(([key, m]) => {
    const tab = document.createElement('button');
    tab.dataset.mode = key;
    tab.textContent = `${m.label} 모드`;
    tab.addEventListener('click', () => { state.recordsMode = key; renderRecords(); });
    $('recordModes').append(tab);
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
  $('restart').addEventListener('click', (e) => { e.currentTarget.blur(); openStart(); });
  $('flagMode').addEventListener('click', (e) => { state.flagMode = !state.flagMode; updateHud(); e.currentTarget.blur(); });
  $('zoomIn').addEventListener('click', () => zoomAt(state.view.w / 2, state.view.h / 2, BUTTON_ZOOM));
  $('zoomOut').addEventListener('click', () => zoomAt(state.view.w / 2, state.view.h / 2, 1 / BUTTON_ZOOM));
  $('zoomFit').addEventListener('click', fitView);
  $('again').addEventListener('click', () => newGame());
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
    if (saved) installSaved(saved);
    else newGame();
    openStart();
  } catch (err) {
    $('status').textContent = '지도를 불러오지 못했습니다. 새로고침 해 주세요.';
    console.error('land data load failed', err);
  }
}

start();
