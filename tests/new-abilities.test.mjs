import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBoard, forEachGridNeighbor, reveal } from '../js/game.js';
import {
  ABILITIES, offerChoices, eligibleKeys, MAX_EVENTS_PER_OFFER, sonarLine, sonar, sonarDir, hideCells, isDark,
} from '../js/abilities.js';
import { removeMines } from '../js/events.js';
import { photoOf, boardFromPhoto } from '../js/save.js';
import { hormuzCells } from '../js/hormuz.js';
import { spawnSharks, stepSharks, sharkHit, sharkCount } from '../js/sharks.js';

const seeded = (seed) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

function boardWith(cols, rows, mines, land = []) {
  const ocean = new Uint8Array(cols * rows).fill(1);
  for (const l of land) ocean[l] = 0;
  const b = createBoard(ocean, cols, rows, 0);
  for (const m of mines) {
    b.mine[m] = 1;
    forEachGridNeighbor(cols, rows, m, (n) => { b.adj[n] += 1; });
  }
  b.mineCount = mines.length;
  b.state = 'playing';
  return b;
}

function adjOk(b) {
  for (let i = 0; i < b.mine.length; i += 1) {
    let n = 0;
    forEachGridNeighbor(b.cols, b.rows, i, (k) => { n += b.mine[k]; });
    if (n !== b.adj[i]) return false;
  }
  return true;
}

/* ---------- 고르기 ---------- */

test('한 번 고를 때 사건은 많아야 2개', () => {
  const events = Object.keys(ABILITIES).filter((k) => ABILITIES[k].kind === 'event');
  const pool = [...events, 'probe', 'scan'];
  assert.equal(MAX_EVENTS_PER_OFFER, 2);
  for (let s = 1; s < 200; s += 1) {
    const c = offerChoices(seeded(s), pool);
    assert.equal(c.length, 3);
    assert.ok(c.filter((k) => ABILITIES[k].kind === 'event').length <= 2);
  }
});

test('사건밖에 없으면 모자란 만큼 사건으로 채운다', () => {
  assert.equal(offerChoices(seeded(3), ['nuke', 'continent', 'unfair']).length, 3);
});

test('새 사건 셋은 첫 고르기에만 나온다', () => {
  const first = eligibleKeys({ picks: [], hasLost: false, look: 'sea' });
  const later = eligibleKeys({ picks: ['probe'], hasLost: false, look: 'sea' });
  for (const k of ['hormuz', 'sharknado', 'thunder']) {
    assert.ok(first.includes(k), k);
    assert.ok(!later.includes(k), k);
  }
  for (const k of ['sonar', 'photo', 'radar']) assert.ok(later.includes(k), k);
});

/* ---------- 소나 ---------- */

test('소나 방향: 가로·세로 중 더 많이 움직인 쪽, 동서는 가까운 쪽으로 돈다', () => {
  const cols = 10;
  assert.equal(sonarDir(cols, 0, 3), 'right');
  assert.equal(sonarDir(cols, 0, 9), 'left'); // 지구를 돌면 한 칸 왼쪽
  assert.equal(sonarDir(cols, 0, 21), 'down');
  assert.equal(sonarDir(cols, 25, 5), 'up');
  assert.equal(sonarDir(cols, 4, 4), null);
});

test('소나 줄은 육지나 지도 끝에서 멈추고 동서로는 이어진다', () => {
  const b = boardWith(5, 3, [], [8]);
  assert.deepEqual(sonarLine(b, 5, 'right'), [5, 6, 7]);
  assert.deepEqual(sonarLine(b, 6, 'left'), [6, 5, 9]);
  assert.deepEqual(sonarLine(b, 2, 'down'), [2, 7, 12]);
});

test('소나: 첫 지뢰까지 열고 그 지뢰에 깃발을 꽂고 멈춘다', () => {
  const b = boardWith(8, 3, [12, 14]);
  const r = sonar(b, 8, 'right');
  assert.equal(r.outcome, 'done');
  assert.equal(r.hit, 12);
  assert.equal(b.flag[12], 1);
  for (const i of [8, 9, 10, 11]) assert.equal(b.open[i], 1, String(i));
  assert.equal(b.flag[14], 0);
});

test('소나: 잘못 꽂은 깃발은 뽑고 연다, 바뀐 게 없으면 none', () => {
  const b = boardWith(8, 3, [20]);
  b.flag[1] = 1;
  b.flags = 1;
  sonar(b, 0, 'right');
  assert.equal(b.flag[1], 0);
  assert.equal(b.open[1], 1);
  const c = boardWith(4, 1, [2]);
  c.flag[2] = 1;
  c.flags = 1;
  c.open[0] = 1;
  c.open[1] = 1;
  assert.equal(sonar(c, 0, 'right').outcome, 'none');
});

/* ---------- 사진 ---------- */

test('사진: 찍은 판으로 돌아가고 터진 지뢰에만 깃발을 꽂는다', () => {
  const b = boardWith(6, 3, [4, 13]);
  b.open[0] = 1;
  b.opened = 1;
  const photo = photoOf(b);
  b.open[17] = 1;
  b.opened = 2;
  b.state = 'lost';
  b.exploded = 13;
  const back = boardFromPhoto(photo, 6, 3, 13);
  assert.equal(back.state, 'playing');
  assert.equal(back.open[17], 0);
  assert.equal(back.open[0], 1);
  assert.equal(back.flag[13], 1);
  assert.equal(back.flag[4], 0);
  assert.equal(back.mineCount, 2);
});

test('사진이 망가졌으면 null', () => {
  assert.equal(boardFromPhoto('???', 6, 3, 0), null);
  assert.equal(boardFromPhoto(photoOf(boardWith(2, 2, [0])), 6, 3, 0), null);
});

/* ---------- 천둥번개·상어 ---------- */

test('천둥번개: 지뢰를 30% 없애고 숫자를 다시 센다', () => {
  const mines = [];
  for (let i = 0; i < 400; i += 7) mines.push(i);
  const b = boardWith(20, 20, mines);
  const before = b.mineCount;
  removeMines(b, 0.3, seeded(5));
  assert.equal(b.mineCount, before - Math.round(before * 0.3));
  assert.equal(b.mine.reduce((s, v) => s + v, 0), b.mineCount);
  assert.ok(adjOk(b));
});

test('천둥번개는 66% 단계에 닿기 전까지 어둡다', () => {
  const b = boardWith(10, 1, [9]);
  const ab = { picks: ['thunder'] };
  assert.equal(isDark(ab, b), true);
  for (let i = 0; i < 6; i += 1) b.open[i] = 1;
  b.opened = 6; // 6/9 = 66.7%
  assert.equal(isDark(ab, b), false);
  b.opened = 0;
  assert.equal(isDark({ picks: ['probe'] }, b), false);
  // 66% 능력을 이미 받았으면 상어 등으로 진행이 줄어도 다시 어두워지지 않는다
  assert.equal(isDark({ picks: ['thunder'], granted: 5 }, b), false);
  assert.equal(isDark({ picks: ['thunder'], granted: 4 }, b), true);
});

test('다시 덮기: 열린 칸만 덮고 연 칸 수를 줄인다', () => {
  const b = boardWith(5, 1, [4]);
  b.open[0] = 1;
  b.open[1] = 1;
  b.opened = 2;
  const opened = b.opened;
  const n = hideCells(b, [0, 1, 4]);
  assert.equal(n, 2);
  assert.equal(b.opened, opened - 2);
  assert.equal(b.open[0], 0);
});

test('상어는 바다에서 태어나 바다에서만 움직인다', () => {
  const land = [];
  for (let i = 0; i < 40 * 20; i += 3) land.push(i);
  const b = boardWith(40, 20, [], land);
  let sharks = spawnSharks(b, 12, seeded(9));
  assert.equal(sharks.length, 12);
  const onSea = (s) => b.ocean[Math.floor(s.y) * b.cols + ((Math.floor(s.x) % b.cols) + b.cols) % b.cols] === 1;
  assert.ok(sharks.every(onSea));
  for (let k = 0; k < 200; k += 1) sharks = stepSharks(sharks, b, 0.05, seeded(k + 1));
  assert.ok(sharks.every(onSea));
});

test('상어 수는 바다 넓이에 비례한다', () => {
  assert.ok(sharkCount(190000) > sharkCount(26000));
  assert.ok(sharkCount(100) >= 1);
});

test('상어에 닿았는지: 동서로 이어진 거리로 잰다', () => {
  const sharks = [{ x: 0.5, y: 5 }, { x: 20, y: 2 }];
  assert.equal(sharkHit(sharks, 39.8, 5, 1, 40), 0);
  assert.equal(sharkHit(sharks, 10, 10, 1, 40), -1);
});

/* ---------- 호르무즈 ---------- */

test('호르무즈: 페르시아만·오만만 바다만, 아라비아해는 빼고', () => {
  const layout = { cols: 360, rows: 150, cellDeg: 1, rot: 0, latTop: 80 };
  const b = createBoard(new Uint8Array(360 * 150).fill(1), 360, 150, 0);
  const at = (lon, lat) => Math.floor(layout.latTop - lat) * 360 + Math.floor(lon + 180);
  const cells = new Set(hormuzCells(b, layout));
  assert.ok(cells.has(at(51.5, 26.5)), '페르시아만');
  assert.ok(cells.has(at(58.5, 24.5)), '오만만');
  assert.ok(!cells.has(at(64.5, 20.5)), '아라비아해');
  assert.ok(!cells.has(at(40.5, 20.5)), '홍해');
});

/* ---------- 난이도별 횟수 ---------- */

test('능력 횟수는 판 폭에 비례하고, 쉬움이 표의 값이다 (1회짜리는 고정)', async () => {
  const { gainOf } = await import('../js/abilities.js');
  const table = {
    probe: [5, 8, 10, 13], scan: [3, 5, 6, 8], shield: [10, 15, 20, 27], quantum: [5, 8, 10, 13], count: [4, 6, 8, 11],
    thorns: [5, 8, 10, 13], coast: [1, 1, 1, 1], atlantis: [2, 3, 4, 5], sonar: [15, 23, 30, 40], photo: [3, 5, 6, 8],
    radar: [15, 23, 30, 40],
  };
  const levels = ['easy', 'normal', 'hard', 'extreme'];
  for (const [key, want] of Object.entries(table)) {
    assert.deepEqual(levels.map((lv) => gainOf(key, [], lv)), want, key);
  }
  assert.equal(gainOf('sonar', ['nuke'], 'normal'), 46, '핵전쟁 뒤에는 난이도 값의 2배');
});
