import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBoard, reveal, toggleFlag, packCells, unpackBoard, LEVELS } from '../js/game.js';
import { snapshot, restore, bytesToBase64, base64ToBytes } from '../js/save.js';

const seeded = (seed) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

function playedBoard(cols, rows) {
  const ocean = new Uint8Array(cols * rows).fill(1);
  for (let i = 0; i < cols; i += 1) ocean[i] = 0;
  const b = createBoard(ocean, cols, rows, 0.15);
  reveal(b, cols * 5 + 5, seeded(42));
  const closed = b.mine.findIndex((m, i) => m && !b.open[i]);
  toggleFlag(b, closed);
  return b;
}

test('칸을 묶었다 풀면 지뢰·열림·깃발·숫자가 그대로다', () => {
  const b = playedBoard(20, 12);
  const back = unpackBoard(packCells(b), 20, 12);
  assert.deepEqual([...back.mine], [...b.mine]);
  assert.deepEqual([...back.open], [...b.open]);
  assert.deepEqual([...back.flag], [...b.flag]);
  assert.deepEqual([...back.ocean], [...b.ocean]);
  for (let i = 0; i < b.ocean.length; i += 1) if (b.ocean[i]) assert.equal(back.adj[i], b.adj[i]);
  assert.equal(back.opened, b.opened);
  assert.equal(back.flags, b.flags);
  assert.equal(back.mineCount, b.mineCount);
  assert.equal(back.state, 'playing');
});

test('되살린 판도 이어서 열 수 있다', () => {
  const b = playedBoard(20, 12);
  const back = unpackBoard(packCells(b), 20, 12);
  const safe = back.ocean.findIndex((o, i) => o && !back.mine[i] && !back.open[i] && !back.flag[i]);
  const r = reveal(back, safe);
  assert.ok(r === 'opened' || r === 'won');
});

test('base64 왕복은 큰 배열도 그대로다', () => {
  const bytes = Uint8Array.from({ length: 300000 }, (_, i) => (i * 7) & 15);
  assert.deepEqual(base64ToBytes(bytesToBase64(bytes)), bytes);
});

test('저장값을 JSON 으로 바꿨다 되살리면 같은 판이다', () => {
  const cols = LEVELS.easy.cols;
  const rows = 12;
  const b = playedBoard(cols, rows);
  const layout = { cols, rows, cellDeg: 1.2, rot: 33, latTop: 80.5 };
  const data = JSON.parse(JSON.stringify(snapshot({
    level: 'easy', layout, board: b, elapsed: 754.2, view: { z: 20, panX: -10, panY: 5 }, savedAt: 123,
  })));
  const back = restore(data);
  assert.equal(back.level, 'easy');
  assert.equal(back.elapsed, 754.2);
  assert.deepEqual(back.layout, layout);
  assert.deepEqual(back.view, { z: 20, panX: -10, panY: 5 });
  assert.deepEqual([...back.board.open], [...b.open]);
});

test('망가지거나 판 크기가 바뀐 저장은 버린다', () => {
  assert.equal(restore(null), null);
  assert.equal(restore({ v: 1, level: 'nope' }), null);
  const b = playedBoard(10, 4);
  const good = snapshot({
    level: 'easy', layout: { cols: 10, rows: 4, cellDeg: 1, rot: 0, latTop: 80 }, board: b, elapsed: 1, view: { z: 1, panX: 0, panY: 0 }, savedAt: 1,
  });
  assert.equal(restore(good), null); // 쉬움은 300열이라 10열 저장은 옛 판
  assert.equal(restore({ ...good, layout: { ...good.layout, cols: LEVELS.easy.cols }, cells: 'AAAA' }), null);
});
