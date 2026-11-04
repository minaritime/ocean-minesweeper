// 판 자체를 바꾸는 사건(국국가가, 핵전쟁)의 새 판 만들기. 화면과 무관한 순수 함수.

import { createBoard, placeMinesAvoiding, reveal, forEachGridNeighbor } from './game.js';

/** 이어진 칸끼리 묶은 덩어리들 (8방향, 동서 순환) */
export function components(mask, cols, rows) {
  const seen = new Uint8Array(mask.length);
  const out = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || seen[start]) continue;
    const cells = [start];
    seen[start] = 1;
    for (let k = 0; k < cells.length; k += 1) {
      forEachGridNeighbor(cols, rows, cells[k], (n) => {
        if (mask[n] && !seen[n]) {
          seen[n] = 1;
          cells.push(n);
        }
      });
    }
    out.push(cells);
  }
  return out;
}

function withNeighbors(board, cells) {
  const out = new Set();
  for (const i of cells) {
    out.add(i);
    forEachGridNeighbor(board.cols, board.rows, i, (n) => { if (board.ocean[n]) out.add(n); });
  }
  return out;
}

/** 덩어리 안에서 시작할 칸: 주변이 모두 같은 땅인 칸 중 무작위, 없으면 아무 칸 */
function pickStart(board, cells, rng) {
  const inner = cells.filter((i) => {
    let ok = true;
    forEachGridNeighbor(board.cols, board.rows, i, (n) => { if (!board.ocean[n]) ok = false; });
    return ok;
  });
  const pool = inner.length ? inner : cells;
  return pool[Math.floor(rng() * pool.length)];
}

/**
 * 국국가가: 대륙(landMask=1)을 놀이판으로 하는 새 판.
 * 대륙끼리 떨어져 있어 덩어리마다 안전한 시작 칸을 하나씩 열어 준다.
 */
export function landBoard(landMask, cols, rows, density, rng = Math.random) {
  const board = createBoard(Uint8Array.from(landMask), cols, rows, density);
  const starts = components(board.ocean, cols, rows).map((cells) => pickStart(board, cells, rng));
  placeMinesAvoiding(board, withNeighbors(board, starts), rng);
  for (const s of starts) reveal(board, s);
  return board;
}

/**
 * 핵전쟁: 육지가 없는 새 판. 지금까지 연 칸은 새 판에서도 안전하게 열어 둔다.
 */
export function allSeaBoard(oldBoard, density, rng = Math.random) {
  const { cols, rows } = oldBoard;
  const board = createBoard(new Uint8Array(cols * rows).fill(1), cols, rows, density);
  const opened = [];
  for (let i = 0; i < oldBoard.open.length; i += 1) if (oldBoard.open[i]) opened.push(i);
  placeMinesAvoiding(board, withNeighbors(board, opened), rng);
  for (const i of opened) reveal(board, i);
  return board;
}
