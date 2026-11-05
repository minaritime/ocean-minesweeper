// 능력 모드: 찍어야 하는 상황(운)을 능력으로 푼다.
// 능력을 더하거나 횟수를 바꿀 때는 ABILITIES 표만 고치면 된다.
// kind: slot(능력 칸에 들어가 횟수만큼 쓰기) | event(고르는 순간 한 번 일어나고 끝)
// target: cell(칸 하나) | area(3×3) | pair(칸 두 개) | count(5×5 세기) | circle(반지름 10 원)
//         | instant(누르면 바로) | passive(가지고 있으면 자동)
// firstOnly: 첫 고르기에만 나온다

import { reveal, toggleFlag, forEachGridNeighbor, oceanNeighbors, progress, settle } from './game.js';

export const ABILITIES = {
  probe: { name: '탐지', icon: '🔍', uses: 5, kind: 'slot', target: 'cell', desc: '고른 칸이 지뢰면 깃발, 아니면 열기' },
  scan: { name: '투시', icon: '👁️', uses: 3, kind: 'slot', target: 'area', desc: '고른 칸 주변 3×3을 한 번에 풀기' },
  shield: { name: '방패', icon: '🛡️', uses: 10, kind: 'slot', target: 'passive', desc: '지뢰를 밟아도 버팀' },
  quantum: {
    name: '양자역학', icon: '⚛️', uses: 5, kind: 'slot', target: 'pair',
    desc: '두 칸 중 안전한 쪽을 열고 지뢰엔 깃발. 둘이 같으면 능력이 사라짐',
  },
  count: { name: '세기', icon: '🔢', uses: 4, kind: 'slot', target: 'count', desc: '고른 칸 주변 5×5의 지뢰 수 알기' },
  thorns: { name: '가시갑옷', icon: '🌵', uses: 5, kind: 'slot', target: 'passive', desc: '지뢰를 밟아도 버티고 상하좌우 2칸을 풀기' },
  coast: { name: '영해', icon: '🏝️', uses: 1, kind: 'slot', target: 'instant', desc: '대륙에 닿은 칸을 모두 풀기' },
  atlantis: { name: '아틀란티스', icon: '🔱', uses: 2, kind: 'slot', target: 'circle', desc: '고른 곳 반지름 10칸을 대륙으로 메우기' },
  remnant: {
    name: '였던것', icon: '👻', kind: 'event',
    desc: '마지막으로 진 판을 밟은 지뢰에 깃발을 꽂고 이어 하기 (지금 판은 사라짐)',
  },
  continent: {
    name: '국국가가', icon: '🌏', kind: 'event', firstOnly: true,
    desc: '바다 대신 대륙에서 지뢰찾기. 남은 능력은 자동으로 고름',
  },
  nuke: {
    name: '핵전쟁', icon: '☢️', kind: 'event', firstOnly: true,
    desc: '대륙을 모두 없애기. 앞으로 받는 능력 횟수 2배, 한 번 더 고르기',
  },
  unfair: { name: '억까 ㄴ', icon: '🙅', kind: 'event', desc: '주변 바다가 2칸 이하인 막다른 칸을 모두 풀기' },
  sonar: {
    name: '소나', icon: '🔊', uses: 30, kind: 'slot', target: 'line',
    desc: '칸을 고르고 방향을 고르면 그쪽으로 음파를 쏴 첫 지뢰까지 열고 깃발',
  },
  photo: {
    name: '사진', icon: '📸', uses: 3, kind: 'slot', target: 'instant',
    desc: '지금 판을 찍어 두기. 지뢰가 터지면 찍은 때로 돌아가고 터진 지뢰에 깃발',
  },
  radar: {
    name: '레이더', icon: '📡', uses: 15, kind: 'slot', target: 'instant',
    desc: '5초 동안 주변 지뢰가 보임. 그동안 칸을 열거나 깃발을 꽂지 못함',
  },
  hormuz: {
    name: '호르무즈 해협 봉쇄', icon: '🛢️', kind: 'event', firstOnly: true, needsSea: true,
    desc: '페르시아만과 오만만을 모두 풀기',
  },
  sharknado: {
    name: '상어토네이도', icon: '🦈', kind: 'event', firstOnly: true,
    desc: '바다 곳곳에 상어가 돌아다님. 마우스나 누른 곳이 상어에 닿으면 엉뚱한 곳으로 날아가고 연 칸 일부가 다시 덮임',
  },
  thunder: {
    name: '천둥번개', icon: '⛈️', kind: 'event', firstOnly: true,
    desc: '지뢰 30% 감소. 대신 66% 능력을 받을 때까지 화면이 어둡고 번개 칠 때만 밝아짐. ⚠️ 광과민성 주의: 화면이 번쩍임',
  },
};

export const ABILITY_KEYS = Object.keys(ABILITIES);
export const SLOT_KEYS = ABILITY_KEYS.filter((k) => ABILITIES[k].kind === 'slot');

/** 지도 모양: sea(바다에서) | land(국국가가, 대륙에서) | nuke(핵전쟁, 대륙 없음) */
export const LOOKS = ['sea', 'land', 'nuke'];

/** 첫 칸을 연 뒤, 33%, 66% 에 하나씩 */
export const MILESTONES = [0, 1 / 3, 2 / 3];
export const OFFER_SIZE = 3;
export const COUNT_RADIUS = 2; // 세기: 5×5
export const ATLANTIS_RADIUS = 10;
export const THORNS_REACH = 2;
export const DEAD_END_MAX = 2; // 억까 ㄴ: 주변 바다가 이 수 이하인 칸

/**
 * 지금 고르기에 나올 수 있는 능력
 * @param {{ picks: string[], hasLost: boolean, look: string }} ctx
 */
export function eligibleKeys({ picks, hasLost, look }) {
  return ABILITY_KEYS.filter((key) => {
    const def = ABILITIES[key];
    if (def.firstOnly && picks.length > 0) return false;
    if (key === 'remnant' && !hasLost) return false;
    if ((key === 'coast' || key === 'unfair') && look === 'nuke') return false;
    if (key === 'atlantis' && look === 'land') return false; // 대륙판에서는 메울 바다가 곧 벽이라 뜻이 뒤집힌다
    if (ABILITIES[key].needsSea && look !== 'sea') return false;
    return true;
  });
}

/** 한 번 고를 때 사건은 이 수까지만 (능력을 하나도 못 고르는 일을 막는다) */
export const MAX_EVENTS_PER_OFFER = 2;

const isEvent = (key) => ABILITIES[key]?.kind === 'event';

/** 후보 중 서로 다른 size 개를 무작위로. 사건은 MAX_EVENTS_PER_OFFER 개까지 (모자라면 사건으로 채움) */
export function offerChoices(rng = Math.random, keys = ABILITY_KEYS, size = OFFER_SIZE) {
  const pool = [...keys];
  for (let k = pool.length - 1; k > 0; k -= 1) {
    const j = Math.floor(rng() * (k + 1));
    [pool[k], pool[j]] = [pool[j], pool[k]];
  }
  const picked = [];
  const extra = [];
  for (const key of pool) {
    if (isEvent(key) && picked.filter(isEvent).length >= MAX_EVENTS_PER_OFFER) extra.push(key);
    else picked.push(key);
  }
  return [...picked, ...extra].slice(0, Math.min(size, pool.length));
}

/** 지금 진행으로 몇 단계까지 받을 수 있는지 (진행 중인 판만) */
export function milestonesReached(board) {
  if (board.state !== 'playing') return 0;
  const p = progress(board);
  return MILESTONES.filter((m) => p >= m).length;
}

/** 천둥번개: 고른 뒤 66% 단계(마지막 능력)에 닿기 전까지 어둡다 */
export function isDark(abilities, board) {
  if (!abilities?.picks?.includes('thunder') || !board) return false;
  if ((abilities.granted ?? 0) >= MILESTONES.length) return false; // 66% 능력을 받았으면 끝
  return board.state === 'playing' && progress(board) < MILESTONES[MILESTONES.length - 1];
}

/** 이 판에서 key 를 받으면 늘어나는 횟수 (핵전쟁 뒤에는 2배) */
export function gainOf(key, picks) {
  return ABILITIES[key].uses * (picks.includes('nuke') ? 2 : 1);
}

/* ---------- 보관함: [{ key, uses }] 받은 순서대로. 항상 새 배열을 돌려준다 ---------- */

export function usesOf(inv, key) {
  return inv.find((a) => a.key === key)?.uses ?? 0;
}

export function addAbility(inv, key, gain = ABILITIES[key].uses) {
  if (inv.some((a) => a.key === key)) return inv.map((a) => (a.key === key ? { ...a, uses: a.uses + gain } : a));
  return [...inv, { key, uses: gain }];
}

export function spendAbility(inv, key) {
  return inv
    .map((a) => (a.key === key ? { ...a, uses: a.uses - 1 } : a))
    .filter((a) => a.uses > 0);
}

export function removeAbility(inv, key) {
  return inv.filter((a) => a.key !== key);
}

export function normalizeInventory(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((a) => a && ABILITIES[a.key]?.kind === 'slot' && Number.isInteger(a.uses) && a.uses > 0)
    .map((a) => ({ key: a.key, uses: a.uses }));
}

/* ---------- 칸 고르기 ---------- */

const isLive = (board) => board.state === 'playing';

/** i 를 가운데로 한 (2r+1)×(2r+1) 안의 바다 칸 (동서로 이어짐) */
export function squareCells(board, i, r) {
  const { cols, rows } = board;
  const r0 = Math.floor(i / cols);
  const c0 = i % cols;
  const out = [];
  for (let dr = -r; dr <= r; dr += 1) {
    const rr = r0 + dr;
    if (rr < 0 || rr >= rows) continue;
    for (let dc = -r; dc <= r; dc += 1) {
      const n = rr * cols + ((c0 + dc + cols * 2) % cols);
      if (board.ocean[n]) out.push(n);
    }
  }
  return out;
}

/** 투시가 닿는 바다 칸 (가운데 포함) */
export function scanCells(board, i) {
  return squareCells(board, i, 1);
}

/** 반지름 radius 원 안의 칸 (바다·육지 모두) */
export function circleCells(board, i, radius = ATLANTIS_RADIUS) {
  const { cols, rows } = board;
  const r0 = Math.floor(i / cols);
  const c0 = i % cols;
  const out = [];
  for (let dr = -radius; dr <= radius; dr += 1) {
    const rr = r0 + dr;
    if (rr < 0 || rr >= rows) continue;
    for (let dc = -radius; dc <= radius; dc += 1) {
      if (dr * dr + dc * dc <= radius * radius) out.push(rr * cols + ((c0 + dc + cols * 2) % cols));
    }
  }
  return [...new Set(out)];
}

/** 가시갑옷: 상하좌우 reach 칸 */
export function thornsCells(board, i, reach = THORNS_REACH) {
  const { cols, rows } = board;
  const r0 = Math.floor(i / cols);
  const c0 = i % cols;
  const out = [];
  for (let d = 1; d <= reach; d += 1) {
    for (const [dr, dc] of [[-d, 0], [d, 0], [0, -d], [0, d]]) {
      const rr = r0 + dr;
      if (rr < 0 || rr >= rows) continue;
      const n = rr * cols + ((c0 + dc + cols * 2) % cols);
      if (board.ocean[n]) out.push(n);
    }
  }
  return out;
}

/** 영해: 육지(벽)와 맞닿은 바다 칸 */
export function coastCells(board) {
  const out = [];
  for (let i = 0; i < board.ocean.length; i += 1) {
    if (!board.ocean[i] || board.open[i]) continue;
    let touches = false;
    forEachGridNeighbor(board.cols, board.rows, i, (n) => { if (!board.ocean[n]) touches = true; });
    if (touches) out.push(i);
  }
  return out;
}

/** 억까 ㄴ: 주변 바다가 DEAD_END_MAX 칸 이하인 막다른 칸 */
export function deadEndCells(board, max = DEAD_END_MAX) {
  const out = [];
  for (let i = 0; i < board.ocean.length; i += 1) {
    if (board.ocean[i] && !board.open[i] && oceanNeighbors(board, i).length <= max) out.push(i);
  }
  return out;
}

/* ---------- 효과: board 를 바꾸고 결과를 돌려준다 ---------- */

/** 안전한 칸을 연다. 잘못 꽂은 깃발은 뽑는다 */
function openSafe(board, i) {
  if (board.flag[i]) toggleFlag(board, i);
  return reveal(board, i);
}

/**
 * 칸들을 푼다: 지뢰엔 깃발, 나머지는 열기.
 * 결과: 'none'(풀 칸이 없음) | 'done' | 'won'
 */
export function resolveCells(board, cells) {
  if (!isLive(board)) return 'none';
  const targets = cells.filter((n) => board.ocean[n] && !board.open[n] && !(board.mine[n] && board.flag[n]));
  if (!targets.length) return 'none';
  for (const n of targets) {
    if (board.mine[n]) {
      if (!board.flag[n]) toggleFlag(board, n);
    } else if (!board.open[n] && openSafe(board, n) === 'won') {
      return 'won';
    }
  }
  return 'done';
}

/** 결과: 'none' | 'flagged' | 'confirmed' | 'opened' | 'won' */
export function probe(board, i) {
  if (!isLive(board) || !board.ocean[i] || board.open[i]) return 'none';
  if (board.mine[i]) {
    if (board.flag[i]) return 'confirmed';
    toggleFlag(board, i);
    return 'flagged';
  }
  return openSafe(board, i);
}

export function scan(board, i) {
  return resolveCells(board, scanCells(board, i));
}

/** 양자역학 대상이 될 수 있는 칸 */
export const isQuantumTarget = (board, i) => i >= 0 && board.ocean[i] === 1 && !board.open[i];

/** 결과: 'none' | 'collapse'(둘 다 지뢰이거나 둘 다 안전) | 'done' | 'won' */
export function quantum(board, a, b) {
  if (!isLive(board) || a === b || !isQuantumTarget(board, a) || !isQuantumTarget(board, b)) return 'none';
  if (board.mine[a] + board.mine[b] !== 1) return 'collapse';
  const out = resolveCells(board, [a, b]);
  return out === 'none' ? 'done' : out;
}

/** 세기: 5×5 안의 지뢰 수. 바다가 아니면 -1 */
export function countMines(board, i) {
  if (!board.ocean[i]) return -1;
  return squareCells(board, i, COUNT_RADIUS).reduce((s, n) => s + board.mine[n], 0);
}

/**
 * 아틀란티스: 칸들을 육지로 메운다. 그 안의 지뢰·열린 칸·깃발은 사라지고 주변 숫자는 다시 센다.
 * 숫자가 0이 된 열린 칸 둘레는 마저 연다. 결과: 'none' | 'done' | 'won'
 */
export function sink(board, cells) {
  if (!isLive(board)) return 'none';
  const sunk = cells.filter((i) => board.ocean[i]);
  if (!sunk.length) return 'none';
  for (const i of sunk) {
    if (board.mine[i]) {
      board.mine[i] = 0;
      board.mineCount -= 1;
      forEachGridNeighbor(board.cols, board.rows, i, (n) => { board.adj[n] -= 1; });
    }
    if (board.open[i]) board.opened -= 1;
    if (board.flag[i]) board.flags -= 1;
    board.ocean[i] = 0;
    board.open[i] = 0;
    board.flag[i] = 0;
    board.oceanCount -= 1;
  }
  if (board.mineCount === 0) {
    // 지뢰가 하나도 남지 않으면 남은 칸을 모두 열어 끝낸다
    const rest = [];
    for (let i = 0; i < board.ocean.length; i += 1) if (board.ocean[i] && !board.open[i]) rest.push(i);
    return resolveCells(board, rest) === 'won' ? 'won' : settle(board);
  }
  const edge = new Set();
  for (const i of sunk) forEachGridNeighbor(board.cols, board.rows, i, (n) => { if (board.open[n] && board.adj[n] === 0) edge.add(n); });
  for (const e of edge) {
    for (const n of oceanNeighbors(board, e)) {
      if (!board.open[n] && !board.flag[n] && reveal(board, n) === 'won') return 'won';
    }
  }
  return settle(board);
}

/* ---------- 소나 ---------- */

const STEPS = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };

/** 칸 a 에서 b 쪽 방향 (가로·세로 중 더 많이 움직인 쪽, 동서는 가까운 쪽으로 돈다). 같은 칸이면 null */
export function sonarDir(cols, a, b) {
  const dy = Math.floor(b / cols) - Math.floor(a / cols);
  let dx = (b % cols) - (a % cols);
  dx = ((dx % cols) + cols + Math.floor(cols / 2)) % cols - Math.floor(cols / 2);
  if (dx === 0 && dy === 0) return null;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}

/** i 부터 dir 쪽으로 이어지는 바다 칸 (육지·지도 끝에서 멈춤, 한 바퀴를 넘지 않음) */
export function sonarLine(board, i, dir, max = board.cols) {
  const [dr, dc] = STEPS[dir];
  const { cols, rows } = board;
  let r = Math.floor(i / cols);
  let c = i % cols;
  const out = [];
  while (out.length < max && r >= 0 && r < rows) {
    const n = r * cols + c;
    if (!board.ocean[n]) break;
    out.push(n);
    r += dr;
    c = (c + dc + cols) % cols;
  }
  return out;
}

/**
 * 소나: 줄을 따라 안전한 칸은 열고 첫 지뢰에 깃발을 꽂고 멈춘다.
 * 결과: { outcome: 'none'|'done'|'won', hit: 지뢰 칸 또는 -1, end: 마지막으로 닿은 칸 }
 */
export function sonar(board, i, dir) {
  if (!isLive(board) || !board.ocean[i]) return { outcome: 'none', hit: -1, end: i };
  let changed = false;
  let end = i;
  for (const n of sonarLine(board, i, dir)) {
    end = n;
    if (board.mine[n]) {
      if (!board.flag[n]) {
        toggleFlag(board, n);
        changed = true;
      }
      return { outcome: changed ? 'done' : 'none', hit: n, end };
    }
    if (board.open[n]) continue;
    changed = true;
    if (openSafe(board, n) === 'won') return { outcome: 'won', hit: -1, end };
  }
  return { outcome: changed ? 'done' : 'none', hit: -1, end };
}

/* ---------- 상어토네이도 ---------- */

/** 열린 칸을 다시 덮는다. 덮은 칸 수를 돌려준다 */
export function hideCells(board, cells) {
  if (!isLive(board)) return 0;
  let n = 0;
  for (const i of cells) {
    if (!board.open[i]) continue;
    board.open[i] = 0;
    board.opened -= 1;
    n += 1;
  }
  return n;
}
