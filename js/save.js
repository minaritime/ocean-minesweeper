// 이어하기: 진행 중인 판 하나를 브라우저에 저장하고 되살린다.

import { LEVELS, MODES, packCells, unpackBoard } from './game.js';
import { ABILITIES, MILESTONES, normalizeInventory } from './abilities.js';

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
    abilities: { inv: abilities.inv, granted: abilities.granted, offer: abilities.offer, picks: abilities.picks },
    level,
    layout: { cols: layout.cols, rows: layout.rows, cellDeg: layout.cellDeg, rot: layout.rot, latTop: layout.latTop },
    cells: bytesToBase64(packCells(board)),
    elapsed,
    view: { z: view.z, panX: view.panX, panY: view.panY },
    savedAt,
  };
}

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

/** 능력 모드 진행: 보관함, 받은 단계 수, 고르던 후보(없으면 null), 고른 능력 순서 */
export function emptyAbilities() {
  return { inv: [], granted: 0, offer: null, picks: [] };
}

const isAbilityList = (x) => Array.isArray(x) && x.length > 0 && x.every((k) => typeof k === 'string' && ABILITIES[k]);

function restoreAbilities(raw) {
  if (!raw || typeof raw !== 'object') return emptyAbilities();
  const granted = Number.isInteger(raw.granted) ? Math.min(MILESTONES.length, Math.max(0, raw.granted)) : 0;
  return {
    inv: normalizeInventory(raw.inv),
    granted,
    offer: isAbilityList(raw.offer) ? [...raw.offer] : null,
    picks: Array.isArray(raw.picks) ? raw.picks.filter((k) => ABILITIES[k]) : [],
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
    const abilities = mode === 'basic' ? emptyAbilities() : restoreAbilities(raw.abilities);
    return { mode, abilities, level: raw.level, layout: { ...l }, board, elapsed: raw.elapsed, view, savedAt: raw.savedAt };
  } catch {
    return null;
  }
}
