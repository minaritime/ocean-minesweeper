import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  gridNeighbors, keepLargestOcean, oceanNeighbors, createBoard, placeMines, reveal, chord, toggleFlag, progress,
} from '../js/game.js';

const seeded = (seed) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const allOcean = (cols, rows) => new Uint8Array(cols * rows).fill(1);

test('동서 끝 칸은 반대편 끝과 이웃이고 남북은 끊긴다', () => {
  const n = gridNeighbors(5, 3, 0).sort((a, b) => a - b);
  assert.deepEqual(n, [1, 4, 5, 6, 9]);
  assert.equal(gridNeighbors(5, 3, 7).length, 8);
});

test('가장 큰 바다만 남고 떨어진 조각은 육지가 되며 원본은 그대로다', () => {
  const ocean = new Uint8Array([
    1, 1, 1, 0, 0, 0, 0, 0,
    1, 1, 1, 0, 0, 1, 1, 0,
    0, 0, 0, 0, 0, 0, 0, 0,
  ]);
  const out = keepLargestOcean(ocean, 8, 3);
  assert.deepEqual([...out.slice(0, 3), out[13], out[14]], [1, 1, 1, 0, 0]);
  assert.equal(ocean[13], 1);
});

test('동서 끝을 넘어 이어진 바다는 한 덩어리로 본다', () => {
  const ocean = new Uint8Array([
    1, 1, 0, 0, 0, 1, 1, 1,
  ]);
  const out = keepLargestOcean(ocean, 8, 1);
  assert.deepEqual([...out], [...ocean]);
});

test('첫 칸과 그 주변에는 지뢰가 없고 지뢰 수가 맞다', () => {
  for (let s = 1; s <= 30; s += 1) {
    const b = createBoard(allOcean(10, 8), 10, 8, 0.2);
    placeMines(b, 33, seeded(s));
    assert.equal(b.mine[33], 0);
    oceanNeighbors(b, 33).forEach((n) => assert.equal(b.mine[n], 0));
    assert.equal(b.mine.reduce((a, x) => a + x, 0), b.mineCount);
  }
});

test('육지에는 지뢰가 놓이지 않고 육지 칸은 열 수 없다', () => {
  const ocean = allOcean(10, 8);
  for (let i = 0; i < 10; i += 1) ocean[i] = 0;
  const b = createBoard(ocean, 10, 8, 0.3);
  assert.equal(reveal(b, 3), 'none');
  assert.equal(b.state, 'ready');
  reveal(b, 45, seeded(7));
  for (let i = 0; i < 10; i += 1) assert.equal(b.mine[i], 0);
});

test('숫자는 바다 이웃의 지뢰 수와 같다', () => {
  const b = createBoard(allOcean(12, 9), 12, 9, 0.18);
  placeMines(b, 0, seeded(3));
  for (let i = 0; i < 12 * 9; i += 1) {
    const expected = oceanNeighbors(b, i).filter((n) => b.mine[n]).length;
    assert.equal(b.adj[i], expected);
  }
});

test('빈 칸을 누르면 이어진 영역이 한 번에 열린다', () => {
  const b = createBoard(allOcean(10, 10), 10, 10, 0.01);
  const result = reveal(b, 55, seeded(1));
  assert.ok(b.opened > 9);
  assert.ok(result === 'opened' || result === 'won');
});

test('깃발 칸은 열리지 않고 깃발 수가 따라간다', () => {
  const b = createBoard(allOcean(6, 6), 6, 6, 0.2);
  assert.equal(toggleFlag(b, 4), true);
  assert.equal(b.flags, 1);
  assert.equal(reveal(b, 4), 'none');
  toggleFlag(b, 4);
  assert.equal(b.flags, 0);
});

test('지뢰를 누르면 진다', () => {
  const b = createBoard(allOcean(8, 8), 8, 8, 0.2);
  reveal(b, 0, seeded(5));
  const mineIdx = b.mine.findIndex((m) => m === 1);
  assert.equal(reveal(b, mineIdx), 'boom');
  assert.equal(b.state, 'lost');
  assert.equal(b.exploded, mineIdx);
  assert.equal(reveal(b, 1), 'none');
});

test('지뢰 아닌 바다를 모두 열면 이기고 지뢰에 깃발이 꽂힌다', () => {
  const b = createBoard(allOcean(8, 8), 8, 8, 0.15);
  reveal(b, 0, seeded(9));
  let last = 'opened';
  for (let i = 0; i < 64 && b.state === 'playing'; i += 1) {
    if (!b.mine[i] && !b.open[i]) last = reveal(b, i);
  }
  assert.equal(last, 'won');
  assert.equal(b.flags, b.mineCount);
  assert.equal(progress(b), 1);
});

test('숫자 칸 주변 깃발이 맞으면 한꺼번에 열고, 틀리면 터진다', () => {
  const make = () => {
    const b = createBoard(allOcean(9, 9), 9, 9, 0.2);
    reveal(b, 0, seeded(11));
    const i = b.adj.findIndex((v, k) => b.open[k] && v > 0);
    return { b, i };
  };
  const { b, i } = make();
  assert.equal(chord(b, i) === 'none' || oceanNeighbors(b, i).every((n) => b.open[n] || b.mine[n]), true);
  oceanNeighbors(b, i).filter((n) => b.mine[n]).forEach((n) => toggleFlag(b, n));
  const before = b.opened;
  const r = chord(b, i);
  assert.ok(r === 'opened' || r === 'won' || b.opened === before);
  oceanNeighbors(b, i).forEach((n) => { if (!b.mine[n]) assert.equal(b.open[n], 1); });

  const w = make();
  const wrongFlag = oceanNeighbors(w.b, w.i).filter((n) => !w.b.mine[n] && !w.b.open[n]);
  const mines = oceanNeighbors(w.b, w.i).filter((n) => w.b.mine[n]);
  if (wrongFlag.length >= mines.length) {
    wrongFlag.slice(0, mines.length).forEach((n) => toggleFlag(w.b, n));
    assert.equal(chord(w.b, w.i), 'boom');
  }
});
