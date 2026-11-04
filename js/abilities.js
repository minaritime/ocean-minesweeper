// 능력 모드: 찍어야 하는 상황(운)을 소모형 능력으로 푼다.
// 능력을 더하거나 횟수를 바꿀 때는 ABILITIES 표만 고치면 된다.
// target: cell(칸 하나 고르기) | area(3×3 고르기) | instant(누르면 바로) | passive(가지고 있으면 자동)

import { reveal, toggleFlag, forEachGridNeighbor, progress } from './game.js';

export const ABILITIES = {
  probe: { name: '탐지', icon: '🔍', uses: 3, target: 'cell', desc: '고른 칸이 지뢰면 깃발, 아니면 열기' },
  scan: { name: '투시', icon: '👁️', uses: 1, target: 'area', desc: '고른 칸 주변 3×3을 한 번에 풀기' },
  beacon: { name: '등대', icon: '🔦', uses: 2, target: 'instant', desc: '보이는 화면에서 숫자 0인 칸 하나 열기' },
  shield: { name: '방패', icon: '🛡️', uses: 1, target: 'passive', desc: '지뢰를 한 번 밟아도 버팀' },
};

export const ABILITY_KEYS = Object.keys(ABILITIES);

/** 첫 칸을 연 뒤, 33%, 66% 에 하나씩 */
export const MILESTONES = [0, 1 / 3, 2 / 3];
export const OFFER_SIZE = 3;

/** 후보 중 서로 다른 size 개를 무작위로 */
export function offerChoices(rng = Math.random, keys = ABILITY_KEYS, size = OFFER_SIZE) {
  const pool = [...keys];
  const n = Math.min(size, pool.length);
  for (let k = 0; k < n; k += 1) {
    const j = k + Math.floor(rng() * (pool.length - k));
    [pool[k], pool[j]] = [pool[j], pool[k]];
  }
  return pool.slice(0, n);
}

/** 지금 진행으로 몇 단계까지 받을 수 있는지 (진행 중인 판만) */
export function milestonesReached(board) {
  if (board.state !== 'playing') return 0;
  const p = progress(board);
  return MILESTONES.filter((m) => p >= m).length;
}

/* ---------- 보관함: [{ key, uses }] 받은 순서대로. 항상 새 배열을 돌려준다 ---------- */

export function usesOf(inv, key) {
  return inv.find((a) => a.key === key)?.uses ?? 0;
}

export function addAbility(inv, key) {
  const gain = ABILITIES[key].uses;
  if (inv.some((a) => a.key === key)) return inv.map((a) => (a.key === key ? { ...a, uses: a.uses + gain } : a));
  return [...inv, { key, uses: gain }];
}

export function spendAbility(inv, key) {
  return inv
    .map((a) => (a.key === key ? { ...a, uses: a.uses - 1 } : a))
    .filter((a) => a.uses > 0);
}

export function normalizeInventory(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((a) => a && ABILITIES[a.key] && Number.isInteger(a.uses) && a.uses > 0)
    .map((a) => ({ key: a.key, uses: a.uses }));
}

/* ---------- 효과: board 를 바꾸고 결과를 돌려준다 ---------- */

const isLive = (board) => board.state === 'playing';

/** 안전한 칸을 연다. 잘못 꽂은 깃발은 뽑는다 */
function openSafe(board, i) {
  if (board.flag[i]) toggleFlag(board, i);
  return reveal(board, i);
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

/** 투시가 닿는 바다 칸 (가운데 포함) */
export function scanCells(board, i) {
  const out = board.ocean[i] ? [i] : [];
  forEachGridNeighbor(board.cols, board.rows, i, (n) => { if (board.ocean[n]) out.push(n); });
  return out;
}

/** 결과: 'none'(풀 칸이 없음) | 'done' | 'won' */
export function scan(board, i) {
  if (!isLive(board)) return 'none';
  const targets = scanCells(board, i).filter((n) => !board.open[n] && !(board.mine[n] && board.flag[n]));
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

/**
 * 등대가 열 칸: cells 중 안 열리고 깃발도 없는 안전칸에서 숫자가 가장 작은 칸 (같으면 앞선 칸).
 * 0인 칸을 만나면 바로 고른다. 없으면 -1.
 */
export function beaconTarget(board, cells) {
  let best = -1;
  for (const i of cells) {
    if (!board.ocean[i] || board.open[i] || board.mine[i] || board.flag[i]) continue;
    if (best === -1 || board.adj[i] < board.adj[best]) best = i;
    if (board.adj[best] === 0) break;
  }
  return best;
}
