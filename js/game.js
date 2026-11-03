// 바다 지뢰찾기: 화면과 무관한 순수 게임 규칙.
// 격자는 동서로 이어져 있고(지구 한 바퀴), 남북은 끊겨 있다. 육지 칸은 벽이다.

export const LEVELS = {
  easy: { label: '쉬움', cols: 80, density: 0.12 },
  normal: { label: '보통', cols: 120, density: 0.14 },
  hard: { label: '어려움', cols: 160, density: 0.16 },
  extreme: { label: '최고', cols: 200, density: 0.17 },
};

const MIN_OCEAN_REGION = 6;

/** 동서 순환, 남북 단절인 8방향 이웃 */
export function gridNeighbors(cols, rows, i) {
  const r = Math.floor(i / cols);
  const c = i % cols;
  const out = [];
  for (let dr = -1; dr <= 1; dr += 1) {
    const nr = r + dr;
    if (nr < 0 || nr >= rows) continue;
    for (let dc = -1; dc <= 1; dc += 1) {
      if (dr === 0 && dc === 0) continue;
      out.push(nr * cols + ((c + dc + cols) % cols));
    }
  }
  return out;
}

/** 너무 작은 바다 조각(호수·만 끝자락)은 육지로 돌린 새 배열을 돌려준다 */
export function removeSmallOceans(ocean, cols, rows, minSize = MIN_OCEAN_REGION) {
  const result = Uint8Array.from(ocean);
  const seen = new Uint8Array(ocean.length);
  for (let start = 0; start < ocean.length; start += 1) {
    if (!ocean[start] || seen[start]) continue;
    const region = [start];
    seen[start] = 1;
    for (let k = 0; k < region.length; k += 1) {
      for (const n of gridNeighbors(cols, rows, region[k])) {
        if (ocean[n] && !seen[n]) {
          seen[n] = 1;
          region.push(n);
        }
      }
    }
    if (region.length < minSize) region.forEach((i) => { result[i] = 0; });
  }
  return result;
}

export function createBoard(ocean, cols, rows, density) {
  const size = cols * rows;
  const nb = new Array(size);
  let oceanCount = 0;
  for (let i = 0; i < size; i += 1) {
    if (ocean[i]) oceanCount += 1;
    nb[i] = ocean[i] ? gridNeighbors(cols, rows, i).filter((n) => ocean[n]) : [];
  }
  return {
    cols,
    rows,
    ocean,
    nb,
    oceanCount,
    mineCount: Math.max(1, Math.round(oceanCount * density)),
    mine: new Uint8Array(size),
    adj: new Uint8Array(size),
    open: new Uint8Array(size),
    flag: new Uint8Array(size),
    state: 'ready', // ready | playing | won | lost
    opened: 0,
    flags: 0,
    exploded: -1,
  };
}

function shuffleInPlace(arr, rng) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** 첫 칸과 그 주변에는 지뢰를 두지 않는다 */
export function placeMines(board, first, rng = Math.random) {
  const safe = new Set([first, ...board.nb[first]]);
  const candidates = [];
  for (let i = 0; i < board.ocean.length; i += 1) {
    if (board.ocean[i] && !safe.has(i)) candidates.push(i);
  }
  shuffleInPlace(candidates, rng);
  board.mineCount = Math.min(board.mineCount, candidates.length);
  for (let k = 0; k < board.mineCount; k += 1) board.mine[candidates[k]] = 1;
  for (let i = 0; i < board.ocean.length; i += 1) {
    if (!board.ocean[i]) continue;
    board.adj[i] = board.nb[i].reduce((s, n) => s + board.mine[n], 0);
  }
  board.state = 'playing';
}

function safeTotal(board) {
  return board.oceanCount - board.mineCount;
}

function floodOpen(board, start) {
  const stack = [start];
  while (stack.length) {
    const i = stack.pop();
    if (board.open[i] || board.flag[i] || board.mine[i]) continue;
    board.open[i] = 1;
    board.opened += 1;
    if (board.adj[i] === 0) stack.push(...board.nb[i].filter((n) => !board.open[n]));
  }
}

function finishIfWon(board) {
  if (board.opened !== safeTotal(board)) return 'opened';
  board.state = 'won';
  for (let i = 0; i < board.mine.length; i += 1) {
    if (board.mine[i] && !board.flag[i]) {
      board.flag[i] = 1;
      board.flags += 1;
    }
  }
  return 'won';
}

/** 결과: 'none' | 'opened' | 'boom' | 'won' */
export function reveal(board, i, rng = Math.random) {
  if (board.state === 'won' || board.state === 'lost') return 'none';
  if (!board.ocean[i] || board.open[i] || board.flag[i]) return 'none';
  if (board.state === 'ready') placeMines(board, i, rng);
  if (board.mine[i]) {
    board.state = 'lost';
    board.exploded = i;
    return 'boom';
  }
  floodOpen(board, i);
  return finishIfWon(board);
}

/** 열린 숫자 칸 주변 깃발 수가 숫자와 같으면 나머지 이웃을 한꺼번에 연다 */
export function chord(board, i) {
  if (board.state !== 'playing' || !board.open[i] || board.adj[i] === 0) return 'none';
  const around = board.nb[i];
  const flagged = around.reduce((s, n) => s + board.flag[n], 0);
  if (flagged !== board.adj[i]) return 'none';
  let outcome = 'none';
  for (const n of around) {
    if (board.open[n] || board.flag[n]) continue;
    const r = reveal(board, n);
    if (r === 'boom' || r === 'won') return r;
    if (r === 'opened') outcome = 'opened';
  }
  return outcome;
}

export function toggleFlag(board, i) {
  if (board.state === 'won' || board.state === 'lost') return false;
  if (!board.ocean[i] || board.open[i]) return false;
  board.flag[i] = board.flag[i] ? 0 : 1;
  board.flags += board.flag[i] ? 1 : -1;
  return true;
}

export function progress(board) {
  const total = safeTotal(board);
  return total > 0 ? board.opened / total : 0;
}
