import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBoard, forEachGridNeighbor, reveal, chord, toggleFlag } from '../js/game.js';
import {
  ABILITIES, ABILITY_KEYS, MILESTONES, OFFER_SIZE, offerChoices, milestonesReached,
  addAbility, spendAbility, usesOf, normalizeInventory, probe, scan, scanCells, beaconTarget,
} from '../js/abilities.js';

const seeded = (seed) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

/** 지뢰 위치를 직접 정한 진행 중인 판 */
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

test('능력표: 이름·횟수·발동 방식이 다 있다', () => {
  assert.ok(ABILITY_KEYS.length >= OFFER_SIZE);
  for (const key of ABILITY_KEYS) {
    const a = ABILITIES[key];
    assert.ok(a.name && a.icon && a.desc, key);
    assert.ok(Number.isInteger(a.uses) && a.uses > 0, key);
    assert.ok(['cell', 'area', 'instant', 'passive'].includes(a.target), key);
  }
});

test('고르기 후보는 3개이고 서로 다르다', () => {
  for (let s = 1; s < 50; s += 1) {
    const c = offerChoices(seeded(s));
    assert.equal(c.length, OFFER_SIZE);
    assert.equal(new Set(c).size, OFFER_SIZE);
    c.forEach((k) => assert.ok(ABILITIES[k]));
  }
});

test('후보가 모자라면 있는 만큼만 준다', () => {
  assert.deepEqual(offerChoices(seeded(1), ['probe']), ['probe']);
});

test('받는 단계: 시작 전 0, 첫 칸 뒤 1, 33% 2, 66% 3', () => {
  assert.deepEqual(MILESTONES, [0, 1 / 3, 2 / 3]);
  const ocean = new Uint8Array(30).fill(1);
  const b = createBoard(ocean, 10, 3, 0);
  b.mineCount = 0;
  assert.equal(milestonesReached(b), 0);
  b.state = 'playing';
  const total = 30;
  const at = (n) => { b.opened = n; return milestonesReached(b); };
  assert.equal(at(1), 1);
  assert.equal(at(9), 1);
  assert.equal(at(10), 2); // 정확히 1/3
  assert.equal(at(19), 2);
  assert.equal(at(20), 3); // 정확히 2/3
  assert.equal(at(total - 1), 3);
});

test('끝난 판에서는 더 받지 않는다', () => {
  const b = boardWith(5, 5, [0]);
  b.opened = 24;
  b.state = 'lost';
  assert.equal(milestonesReached(b), 0);
});

test('능력 보관: 같은 능력은 횟수가 더해지고 원본은 그대로다', () => {
  const inv0 = [];
  const inv1 = addAbility(inv0, 'probe');
  const inv2 = addAbility(inv1, 'shield');
  const inv3 = addAbility(inv2, 'probe');
  assert.deepEqual(inv0, []);
  assert.equal(inv3.length, 2);
  assert.equal(usesOf(inv3, 'probe'), ABILITIES.probe.uses * 2);
  assert.equal(usesOf(inv2, 'probe'), ABILITIES.probe.uses);
  assert.deepEqual(inv3.map((a) => a.key), ['probe', 'shield']);
});

test('다 쓴 능력은 칸에서 빠진다', () => {
  let inv = addAbility([], 'shield');
  assert.equal(usesOf(inv, 'shield'), 1);
  inv = spendAbility(inv, 'shield');
  assert.deepEqual(inv, []);
  assert.deepEqual(spendAbility([], 'probe'), []);
});

test('망가진 보관 값은 걸러 읽는다', () => {
  assert.deepEqual(normalizeInventory(null), []);
  assert.deepEqual(normalizeInventory([{ key: 'probe', uses: 2 }, { key: 'nope', uses: 1 }, { key: 'scan', uses: 0 }, null]),
    [{ key: 'probe', uses: 2 }]);
});

test('탐지: 지뢰면 깃발, 안전하면 열린다', () => {
  const b = boardWith(6, 6, [14]);
  assert.equal(probe(b, 14), 'flagged');
  assert.equal(b.flag[14], 1);
  assert.equal(b.flags, 1);
  assert.equal(b.state, 'playing');
  assert.equal(probe(b, 7), 'opened');
  assert.equal(b.open[7], 1);
});

test('탐지: 잘못 꽂은 깃발은 뽑고 열고, 맞게 꽂은 깃발은 확인만 한다', () => {
  const b = boardWith(6, 6, [14]);
  toggleFlag(b, 7);
  toggleFlag(b, 14);
  assert.equal(probe(b, 7), 'opened');
  assert.equal(b.flag[7], 0);
  assert.equal(b.flags, 1);
  assert.equal(probe(b, 14), 'confirmed');
  assert.equal(b.flag[14], 1);
});

test('탐지: 열린 칸·육지는 쓰지 않는다', () => {
  const b = boardWith(6, 6, [14], [0]);
  reveal(b, 35);
  const opened = b.open.findIndex((o) => o);
  assert.equal(probe(b, opened), 'none');
  assert.equal(probe(b, 0), 'none');
});

test('투시: 3×3 안 지뢰는 깃발, 나머지는 열린다', () => {
  // 7열 판, 가운데 (3,3)=24 주변에 지뢰 2개
  const b = boardWith(7, 7, [16, 32, 0]);
  assert.ok(['done', 'won'].includes(scan(b, 24)));
  for (const i of scanCells(b, 24)) {
    if (b.mine[i]) assert.equal(b.flag[i], 1, `mine ${i}`);
    else assert.equal(b.open[i], 1, `safe ${i}`);
  }
  assert.equal(b.flag[0], b.state === 'won' ? 1 : 0); // 3×3 밖 지뢰는 클리어 때만 깃발
});

test('투시: 동서 끝을 넘어 이어지고 육지는 건너뛴다', () => {
  const b = boardWith(7, 5, [13], [8]);
  const cells = scanCells(b, 7); // (1,0): 왼쪽 이웃은 (r,6)
  assert.ok(cells.includes(13));
  assert.ok(!cells.includes(8));
  assert.ok(['done', 'won'].includes(scan(b, 7)));
  assert.equal(b.flag[13], 1);
  assert.equal(b.open[6], 1);
});

test('투시: 다 열린 곳이면 쓰지 않고, 판이 다 풀리면 클리어', () => {
  const b = boardWith(3, 3, [0]);
  assert.equal(scan(b, 4), 'won');
  assert.equal(b.state, 'won');
  assert.equal(scan(b, 4), 'none');
});

test('등대: 숫자 0인 칸을 먼저, 없으면 숫자가 가장 작은 안전칸', () => {
  const b = boardWith(10, 3, [0, 20, 9]);
  const all = [...Array(30).keys()];
  const t = beaconTarget(b, all);
  assert.equal(b.adj[t], 0);
  assert.equal(b.mine[t], 0);
  const onlyNumbered = [10, 11, 1]; // 숫자 3, 2, 1
  const pick = beaconTarget(b, onlyNumbered);
  assert.equal(pick, 1);
});

test('등대: 후보 순서가 앞선 칸을 고르고, 안전칸이 없으면 -1', () => {
  const b = boardWith(10, 3, [0]);
  assert.equal(beaconTarget(b, [25, 15, 5]), 25);
  assert.equal(beaconTarget(b, [0]), -1);
  reveal(b, 25);
  assert.equal(beaconTarget(b, [25]), -1); // 이미 열린 칸
});

test('방패: 지뢰를 밟아도 끝나지 않고 깃발이 꽂힌다', () => {
  const b = boardWith(6, 6, [14]);
  assert.equal(reveal(b, 14, Math.random, { shield: true }), 'shielded');
  assert.equal(b.state, 'playing');
  assert.equal(b.flag[14], 1);
  assert.equal(b.flags, 1);
});

test('방패 없이는 그대로 터진다 (기본 모드 동작 유지)', () => {
  const b = boardWith(6, 6, [14]);
  assert.equal(reveal(b, 14), 'boom');
  assert.equal(b.state, 'lost');
});

test('방패: 숫자 칸 한꺼번에 열기에서 밟아도 한 번만 막고 멈춘다', () => {
  // 15 주변 지뢰 2개(8, 22), 깃발은 엉뚱한 곳 2개
  const b = boardWith(7, 7, [8, 22]);
  reveal(b, 15);
  assert.equal(b.adj[15], 2);
  toggleFlag(b, 14);
  toggleFlag(b, 16);
  const r = chord(b, 15, { shield: true });
  assert.equal(r, 'shielded');
  assert.equal(b.state, 'playing');
  assert.equal(b.flag[8] + b.flag[22], 1);
});

test('등대: 깃발 꽂힌 칸은 고르지 않는다 (잘못 꽂은 깃발에 써 버리지 않게)', () => {
  const b = boardWith(10, 3, [0]);
  toggleFlag(b, 25);
  assert.equal(beaconTarget(b, [25, 15]), 15);
  assert.equal(beaconTarget(b, [25]), -1);
});

test('투시: 3×3 안이 이미 깃발 꽂힌 지뢰뿐이면 쓰지 않는다', () => {
  const b = boardWith(3, 3, [0, 1, 2, 3, 5, 6, 7, 8]);
  b.open[4] = 1;
  b.opened = 1;
  for (const m of [0, 1, 2, 3, 5, 6, 7, 8]) toggleFlag(b, m);
  assert.equal(scan(b, 4), 'none');
});
