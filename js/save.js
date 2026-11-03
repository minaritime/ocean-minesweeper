// 이어하기: 진행 중인 판 하나를 브라우저에 저장하고 되살린다.

import { LEVELS, packCells, unpackBoard } from './game.js';

export const SAVE_VERSION = 1;
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
export function snapshot({ level, layout, board, elapsed, view, savedAt }) {
  return {
    v: SAVE_VERSION,
    level,
    layout: { cols: layout.cols, rows: layout.rows, cellDeg: layout.cellDeg, rot: layout.rot, latTop: layout.latTop },
    cells: bytesToBase64(packCells(board)),
    elapsed,
    view: { z: view.z, panX: view.panX, panY: view.panY },
    savedAt,
  };
}

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

/** 저장값을 검사해 되살린다. 망가졌거나 판 크기가 바뀐 저장은 null */
export function restore(raw) {
  if (!raw || raw.v !== SAVE_VERSION || !LEVELS[raw.level]) return null;
  const l = raw.layout;
  if (!l || ![l.cols, l.rows, l.cellDeg, l.rot, l.latTop].every(isNum)) return null;
  if (l.cols !== LEVELS[raw.level].cols || !isNum(raw.elapsed) || typeof raw.cells !== 'string') return null;
  try {
    const board = unpackBoard(base64ToBytes(raw.cells), l.cols, l.rows);
    const view = raw.view && [raw.view.z, raw.view.panX, raw.view.panY].every(isNum) ? raw.view : null;
    return { level: raw.level, layout: { ...l }, board, elapsed: raw.elapsed, view, savedAt: raw.savedAt };
  } catch {
    return null;
  }
}
