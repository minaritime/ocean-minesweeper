// 이어하기: 진행 중인 판 하나를 브라우저에 저장하고 되살린다.

import { LEVELS, MODES, packCells, unpackBoard } from './game.js';
import { ABILITIES, MILESTONES, LOOKS, normalizeInventory } from './abilities.js';

export const SAVE_VERSION = 2;
const READABLE_VERSIONS = [1, 2];
const CHUNK = 0x8000;

export function bytesToBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

export function base64ToBytes(text) {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/** 저장할 값(JSON 으로 바꿀 수 있는 평범한 객체)을 만든다 */
export function snapshot({ mode = 'basic', abilities = emptyAbilities(), level, layout, board, elapsed, view, savedAt }) {
  return {
    v: SAVE_VERSION,
    mode,
    abilities: {
      inv: abilities.inv, granted: abilities.granted, offer: abilities.offer, picks: abilities.picks,
      look: abilities.look, counts: abilities.counts, photo: abilities.photo ?? null, steps: MILESTONES.length,
    },
    level,
    layout: { cols: layout.cols, rows: layout.rows, cellDeg: layout.cellDeg, rot: layout.rot, latTop: layout.latTop },
    cells: bytesToBase64(packCells(board)),
    elapsed,
    view: { z: view.z, panX: view.panX, panY: view.panY },
    savedAt,
  };
}

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

/**
 * 능력 모드 진행: 보관함, 받은 단계 수, 고르던 후보(없으면 null), 고른 능력 순서,
 * 지도 모양(sea | land | nuke), 세기로 알아낸 칸 [{ i, n }], 사진으로 찍어 둔 판(없으면 null)
 */
export function emptyAbilities() {
  return { inv: [], granted: 0, offer: null, picks: [], look: 'sea', counts: [], photo: null };
}

const isCount = (c) => c && Number.isInteger(c.i) && c.i >= 0 && Number.isInteger(c.n) && c.n >= 0;

const isAbilityList = (x) => Array.isArray(x) && x.length > 0 && x.every((k) => typeof k === 'string' && ABILITIES[k]);

/** 능력을 3번 받던 때(steps 없음)의 받은 단계 → 지금 단계 (첫 칸 1, 33% 3, 66% 5) */
const OLD_THREE_STEPS = [0, 1, 3, 5];

function grantedOf(raw) {
  if (!Number.isInteger(raw.granted)) return 0;
  const g = Math.max(0, raw.granted);
  const now = raw.steps === undefined ? (OLD_THREE_STEPS[g] ?? MILESTONES.length) : g;
  return Math.min(MILESTONES.length, now);
}

function restoreAbilities(raw) {
  if (!raw || typeof raw !== 'object') return emptyAbilities();
  const granted = grantedOf(raw);
  return {
    inv: normalizeInventory(raw.inv),
    granted,
    offer: isAbilityList(raw.offer) ? [...raw.offer] : null,
    picks: Array.isArray(raw.picks) ? raw.picks.filter((k) => ABILITIES[k]) : [],
    look: LOOKS.includes(raw.look) ? raw.look : 'sea',
    counts: Array.isArray(raw.counts) ? raw.counts.filter(isCount).map((c) => ({ i: c.i, n: c.n })) : [],
    photo: typeof raw.photo === 'string' && raw.photo.length > 0 ? raw.photo : null,
  };
}

/** 저장값을 검사해 되살린다. 망가졌거나 판 크기가 바뀐 저장은 null */
export function restore(raw) {
  if (!raw || !READABLE_VERSIONS.includes(raw.v) || !LEVELS[raw.level]) return null;
  const mode = raw.v === 1 ? 'basic' : raw.mode;
  if (!MODES[mode]) return null;
  const l = raw.layout;
  if (!l || ![l.cols, l.rows, l.cellDeg, l.rot, l.latTop].every(isNum)) return null;
  if (l.cols !== LEVELS[raw.level].cols || !isNum(raw.elapsed) || typeof raw.cells !== 'string') return null;
  try {
    const board = unpackBoard(base64ToBytes(raw.cells), l.cols, l.rows);
    const view = raw.view && [raw.view.z, raw.view.panX, raw.view.panY].every(isNum) ? raw.view : null;
    const restored = mode === 'basic' ? emptyAbilities() : restoreAbilities(raw.abilities);
    const abilities = { ...restored, counts: restored.counts.filter((c) => c.i < board.ocean.length) };
    return { mode, abilities, level: raw.level, layout: { ...l }, board, elapsed: raw.elapsed, view, savedAt: raw.savedAt };
  } catch {
    return null;
  }
}

/** 진 판: 이어하기 저장과 같은 모양에 밟은 지뢰 칸을 더한다 (였던것) */
export function lostSnapshot(args, exploded) {
  return { ...snapshot(args), exploded };
}

/** 진 판을 되살리고 밟은 지뢰에 깃발을 꽂는다. 망가졌으면 null */
export function restoreLost(raw) {
  const saved = restore(raw);
  if (!saved) return null;
  const e = raw.exploded;
  if (!Number.isInteger(e) || e < 0 || e >= saved.board.ocean.length || !saved.board.mine[e]) return null;
  if (!saved.board.flag[e]) {
    saved.board.flag[e] = 1;
    saved.board.flags += 1;
  }
  return saved;
}

/* ---------- 사진 (능력) ---------- */

/** 지금 판을 찍어 둔다 (이어하기 저장과 같은 1바이트 묶음) */
export function photoOf(board) {
  return bytesToBase64(packCells(board));
}

/** 찍은 판으로 되살리고 터진 지뢰(exploded)에 깃발을 꽂는다. 망가졌으면 null */
export function boardFromPhoto(photo, cols, rows, exploded) {
  try {
    const board = unpackBoard(base64ToBytes(photo), cols, rows);
    if (exploded >= 0 && board.mine[exploded] && !board.flag[exploded]) {
      board.flag[exploded] = 1;
      board.flags += 1;
    }
    return board;
  } catch {
    return null;
  }
}
