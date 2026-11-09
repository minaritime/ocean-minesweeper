import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBoard, forEachGridNeighbor, reveal, chord, toggleFlag } from '../js/game.js';
import {
  ABILITIES, ABILITY_KEYS, MILESTONES, OFFER_SIZE, offerChoices, milestonesReached,
  addAbility, spendAbility, usesOf, normalizeInventory, probe, scan, scanCells,
  SLOT_KEYS, eligibleKeys, gainOf, removeAbility, quantum, countMines, thornsCells, coastCells, deadEndCells,
  circleCells, sink, resolveCells,
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
    assert.ok(['slot', 'event'].includes(a.kind), key);
    if (a.kind === 'event') continue;
    assert.ok(Number.isInteger(a.uses) && a.uses > 0, key);
    assert.ok(['cell', 'area', 'pair', 'count', 'circle', 'line', 'instant', 'passive'].includes(a.target), key);
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

test('받는 단계: 첫 칸 뒤, 그리고 찾아낸 바다 1/6마다 (모두 6번)', () => {
  assert.deepEqual(MILESTONES, [0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6]);
  const ocean = new Uint8Array(60).fill(1);
  const b = createBoard(ocean, 10, 6, 0);
  b.mineCount = 0;
  assert.equal(milestonesReached(b), 0);
  b.state = 'playing';
  const at = (n) => { b.opened = n; return milestonesReached(b); };
  assert.equal(at(1), 1);
  assert.equal(at(9), 1);
  assert.equal(at(10), 2); // 정확히 1/6
  assert.equal(at(30), 4); // 정확히 1/2
  assert.equal(at(40), 5); // 정확히 2/3
  assert.equal(at(49), 5);
  assert.equal(at(50), 6); // 정확히 5/6
  assert.equal(at(59), 6);
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
  let inv = addAbility([], 'coast');
  assert.equal(usesOf(inv, 'coast'), 1);
  inv = spendAbility(inv, 'coast');
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

test('투시: 3×3 안이 이미 깃발 꽂힌 지뢰뿐이면 쓰지 않는다', () => {
  const b = boardWith(3, 3, [0, 1, 2, 3, 5, 6, 7, 8]);
  b.open[4] = 1;
  b.opened = 1;
  for (const m of [0, 1, 2, 3, 5, 6, 7, 8]) toggleFlag(b, m);
  assert.equal(scan(b, 4), 'none');
});

test('조정한 횟수: 탐지 5, 투시 3, 방패 10', () => {
  assert.equal(ABILITIES.probe.uses, 5);
  assert.equal(ABILITIES.scan.uses, 3);
  assert.equal(ABILITIES.shield.uses, 10);
  assert.equal(ABILITIES.beacon, undefined);
});

test('후보: 국국가가·핵전쟁은 첫 고르기에만, 였던것은 진 판이 있을 때만', () => {
  const first = eligibleKeys({ picks: [], hasLost: false, look: 'sea' });
  assert.ok(first.includes('continent') && first.includes('nuke'));
  assert.ok(!first.includes('remnant'));
  const later = eligibleKeys({ picks: ['probe'], hasLost: true, look: 'sea' });
  assert.ok(!later.includes('continent') && !later.includes('nuke'));
  assert.ok(later.includes('remnant'));
  const nuked = eligibleKeys({ picks: ['nuke'], hasLost: false, look: 'nuke' });
  assert.ok(!nuked.includes('coast') && !nuked.includes('unfair'));
});

test('핵전쟁 뒤에 받는 능력은 횟수가 2배', () => {
  assert.equal(gainOf('probe', [], 'extreme'), 5);
  assert.equal(gainOf('probe', ['nuke', 'probe'], 'extreme'), 10);
  assert.ok(SLOT_KEYS.every((k) => ABILITIES[k].kind === 'slot'));
  assert.deepEqual(normalizeInventory([{ key: 'nuke', uses: 1 }]), []);
});

test('양자역학: 하나만 지뢰면 안전한 칸을 열고 지뢰엔 깃발', () => {
  const b = boardWith(6, 6, [14]);
  assert.ok(['done', 'won'].includes(quantum(b, 14, 30)));
  assert.equal(b.flag[14], 1);
  assert.equal(b.open[30], 1);
});

test('양자역학: 둘 다 안전하거나 둘 다 지뢰면 collapse, 판은 그대로', () => {
  const b = boardWith(6, 6, [14, 15]);
  assert.equal(quantum(b, 14, 15), 'collapse');
  assert.equal(quantum(b, 30, 35), 'collapse');
  assert.equal(b.opened, 0);
  assert.equal(b.flags, 0);
  assert.equal(quantum(b, 30, 30), 'none');
  assert.deepEqual(removeAbility([{ key: 'quantum', uses: 4 }, { key: 'probe', uses: 1 }], 'quantum'), [{ key: 'probe', uses: 1 }]);
});

test('세기: 5×5 안 지뢰 수 (동서로 이어짐, 육지는 -1)', () => {
  const b = boardWith(10, 10, [44, 46, 0, 9, 99], [55]);
  assert.equal(countMines(b, 45), 2); // (4,5) 주변: 44, 46
  assert.equal(countMines(b, 10), 2); // (1,0) 주변: 0, 9(서쪽으로 넘어감)
  assert.equal(countMines(b, 55), -1);
});

test('가시갑옷: 막은 지뢰 기준 상하좌우 2칸을 푼다', () => {
  const b = boardWith(9, 9, [40, 22, 76]);
  assert.equal(reveal(b, 40, Math.random, { shield: true }), 'shielded');
  assert.equal(b.guarded, 40);
  const cells = thornsCells(b, 40);
  assert.equal(cells.length, 8);
  assert.deepEqual([...cells].sort((x, y) => x - y), [22, 31, 38, 39, 41, 42, 49, 58]);
  resolveCells(b, cells);
  assert.equal(b.flag[22], 1);
  assert.equal(b.open[31], 1);
  assert.ok(!cells.includes(76)); // 범위 밖
});

test('영해: 육지에 닿은 칸만 푼다', () => {
  const b = boardWith(8, 8, [10], [27, 28]);
  const cells = coastCells(b);
  assert.ok(cells.includes(18) && cells.includes(36) && cells.includes(29));
  assert.ok(!cells.includes(0) && !cells.includes(10));
});

test('억까 ㄴ: 주변 바다가 2칸 이하인 막다른 칸', () => {
  // 5×5, 가운데 12 하나만 바다로 이어진 막다른 길: 12 주변에 바다는 7 하나
  const land = [6, 8, 11, 13, 16, 17, 18];
  const b = boardWith(5, 5, [24], land);
  const cells = deadEndCells(b);
  assert.ok(cells.includes(12));
  assert.ok(!cells.includes(2));
});

test('아틀란티스: 원 안은 육지가 되고 지뢰 수·숫자가 다시 맞춰진다', () => {
  const b = boardWith(40, 30, [0, 615, 640]);
  const before = b.mineCount;
  const out = sink(b, circleCells(b, 615, 3));
  assert.ok(['done', 'won'].includes(out));
  assert.equal(b.ocean[615], 0);
  assert.equal(b.mine[615], 0);
  assert.ok(b.mineCount < before);
  assert.equal(b.oceanCount, 1200 - circleCells(b, 615, 3).length);
  for (let i = 0; i < 1200; i += 1) {
    if (!b.ocean[i]) continue;
    let n = 0;
    forEachGridNeighbor(40, 30, i, (k) => { n += b.mine[k]; });
    assert.equal(b.adj[i], n, `adj ${i}`);
  }
});

test('아틀란티스: 원이 동서 끝을 넘어 이어진다', () => {
  const b = boardWith(30, 30, [0]);
  const cells = circleCells(b, 15 * 30, 2);
  assert.ok(cells.includes(15 * 30 + 29) && cells.includes(15 * 30 + 28));
  assert.equal(cells.length, 13);
});

test('아틀란티스: 대륙판(국국가가)에서는 후보에 나오지 않는다', () => {
  assert.ok(!eligibleKeys({ picks: ['continent'], hasLost: false, look: 'land' }).includes('atlantis'));
  assert.ok(eligibleKeys({ picks: ['probe'], hasLost: false, look: 'sea' }).includes('atlantis'));
});

test('아틀란티스: 마지막 지뢰까지 메우면 남은 칸이 열리고 클리어', () => {
  const b = boardWith(30, 30, [465]);
  assert.equal(sink(b, circleCells(b, 465, 2)), 'won');
  assert.equal(b.state, 'won');
  assert.equal(b.mineCount, 0);
});
