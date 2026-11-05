// 판 자체를 바꾸는 사건(국국가가, 핵전쟁, 천둥번개)의 판 바꾸기. 화면과 무관한 순수 함수.

import { createBoard, placeMinesAvoiding, reveal, forEachGridNeighbor, settle } from './game.js';

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

/**
 * 천둥번개: 지뢰를 ratio 만큼 무작위로 없애고 주변 숫자를 다시 센다.
 * 숫자가 0이 된 열린 칸 둘레는 마저 연다. 결과: 'done' | 'won'
 */
export function removeMines(board, ratio, rng = Math.random) {
  const mines = [];
  for (let i = 0; i < board.mine.length; i += 1) if (board.mine[i]) mines.push(i);
  const remove = Math.min(mines.length - 1, Math.round(mines.length * ratio));
  for (let k = 0; k < remove; k += 1) {
    const j = k + Math.floor(rng() * (mines.length - k));
    [mines[k], mines[j]] = [mines[j], mines[k]];
    const m = mines[k];
    board.mine[m] = 0;
    forEachGridNeighbor(board.cols, board.rows, m, (n) => { board.adj[n] -= 1; });
  }
  board.mineCount -= Math.max(0, remove);
  const edge = [];
  for (let i = 0; i < board.open.length; i += 1) if (board.open[i] && board.adj[i] === 0) edge.push(i);
  for (const e of edge) {
    let won = false;
    forEachGridNeighbor(board.cols, board.rows, e, (n) => {
      if (!won && board.ocean[n] && !board.open[n] && !board.flag[n] && reveal(board, n) === 'won') won = true;
    });
    if (won) return 'won';
  }
  return settle(board);
}
