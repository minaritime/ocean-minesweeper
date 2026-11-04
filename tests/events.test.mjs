import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBoard, reveal, forEachGridNeighbor } from '../js/game.js';
import { components, landBoard, allSeaBoard } from '../js/events.js';

const seeded = (seed) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

/** 대륙 두 덩어리(왼쪽 6×6, 오른쪽 6×6)와 작은 섬 하나 */
function landMask() {
  const cols = 30;
  const rows = 12;
  const m = new Uint8Array(cols * rows);
  for (let r = 2; r < 8; r += 1) for (let c = 2; c < 8; c += 1) m[r * cols + c] = 1;
  for (let r = 3; r < 9; r += 1) for (let c = 15; c < 21; c += 1) m[r * cols + c] = 1;
  m[10 * cols + 26] = 1;
  return { m, cols, rows };
}

test('덩어리 나누기: 떨어진 땅은 따로 센다', () => {
  const { m, cols, rows } = landMask();
  const parts = components(m, cols, rows);
  assert.equal(parts.length, 3);
  assert.deepEqual(parts.map((p) => p.length).sort((a, b) => a - b), [1, 36, 36]);
});

test('국국가가: 대륙만 놀이판이고, 덩어리마다 시작 칸이 열려 있다', () => {
  const { m, cols, rows } = landMask();
  const b = landBoard(m, cols, rows, 0.15, seeded(3));
  assert.equal(b.state, 'playing');
  for (let i = 0; i < m.length; i += 1) {
    if (!m[i]) assert.equal(b.ocean[i] + b.mine[i] + b.open[i], 0, `sea ${i}`);
  }
  for (const part of components(m, cols, rows)) {
    assert.ok(part.some((i) => b.open[i]), 'each part has an opened start');
  }
  assert.ok(b.mineCount > 0);
  for (let i = 0; i < m.length; i += 1) {
    if (!b.ocean[i]) continue;
    let n = 0;
    forEachGridNeighbor(cols, rows, i, (k) => { n += b.mine[k]; });
    assert.equal(b.adj[i], n);
  }
});

test('핵전쟁: 육지가 사라지고, 열었던 칸은 새 판에서도 열려 있다', () => {
  const cols = 40;
  const rows = 20;
  const ocean = new Uint8Array(cols * rows).fill(1);
  for (let r = 5; r < 15; r += 1) for (let c = 10; c < 20; c += 1) ocean[r * cols + c] = 0;
  const old = createBoard(ocean, cols, rows, 0.12);
  reveal(old, 2 * cols + 30, seeded(9));
  const b = allSeaBoard(old, 0.12, seeded(5));
  assert.equal(b.oceanCount, cols * rows);
  assert.equal(b.state, 'playing');
  for (let i = 0; i < old.open.length; i += 1) if (old.open[i]) assert.equal(b.open[i], 1, `kept ${i}`);
  assert.ok(b.mineCount > 0 && b.mine.every((v, i) => !v || !b.open[i]));
});
