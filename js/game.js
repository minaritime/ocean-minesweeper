// 세계지도 지뢰찾기: 화면과 무관한 순수 게임 규칙.
// 격자는 동서로 이어져 있고(지구 한 바퀴), 남북은 끊겨 있다. 육지 칸은 벽이다.
// 판이 수십만 칸이라 이웃 목록을 미리 만들지 않고 그때그때 계산한다.

export const LEVELS = {
  easy: { label: '쉬움', cols: 300, density: 0.12 },
  normal: { label: '보통', cols: 450, density: 0.13 },
  hard: { label: '어려움', cols: 600, density: 0.14 },
  extreme: { label: '최고', cols: 800, density: 0.15 },
};

export const MODES = {
  basic: { label: '기본' },
  ability: { label: '능력' },
};

/** 동서 순환, 남북 단절인 8방향 이웃마다 fn 호출 */
export function forEachGridNeighbor(cols, rows, i, fn) {
  const r = Math.floor(i / cols);
  const c = i % cols;
  for (let dr = -1; dr <= 1; dr += 1) {
    const nr = r + dr;
    if (nr < 0 || nr >= rows) continue;
    const base = nr * cols;
    for (let dc = -1; dc <= 1; dc += 1) {
      if (dr === 0 && dc === 0) continue;
      fn(base + ((c + dc + cols) % cols));
    }
  }
}

export function gridNeighbors(cols, rows, i) {
  const out = [];
  forEachGridNeighbor(cols, rows, i, (n) => out.push(n));
  return out;
}

export function oceanNeighbors(board, i) {
  const out = [];
  forEachGridNeighbor(board.cols, board.rows, i, (n) => { if (board.ocean[n]) out.push(n); });
  return out;
}

/** 가장 큰 바다 하나만 남기고 떨어진 조각은 모두 육지로 돌린 새 배열 */
export function keepLargestOcean(ocean, cols, rows) {
  const label = new Int32Array(ocean.length).fill(-1);
  const queue = new Int32Array(ocean.length);
  let bestId = -1;
  let bestSize = 0;
  let id = 0;
  for (let start = 0; start < ocean.length; start += 1) {
    if (!ocean[start] || label[start] !== -1) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    label[start] = id;
    while (head < tail) {
      forEachGridNeighbor(cols, rows, queue[head++], (n) => {
        if (ocean[n] && label[n] === -1) {
          label[n] = id;
          queue[tail++] = n;
        }
      });
    }
    if (tail > bestSize) {
      bestSize = tail;
      bestId = id;
    }
    id += 1;
  }
  return Uint8Array.from(label, (l) => (l === bestId && bestId !== -1 ? 1 : 0));
}

export function createBoard(ocean, cols, rows, density) {
  const size = cols * rows;
  let oceanCount = 0;
  for (let i = 0; i < size; i += 1) oceanCount += ocean[i];
  return {
    cols,
    rows,
    ocean,
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
    guarded: -1, // 방패·가시갑옷이 막은 마지막 지뢰 칸
  };
}

/** 첫 칸과 그 주변에는 지뢰를 두지 않는다 */
export function placeMines(board, first, rng = Math.random) {
  placeMinesAvoiding(board, new Set([first, ...oceanNeighbors(board, first)]), rng);
}

/** safe 에 든 칸을 빼고 지뢰를 무작위로 둔다 */
export function placeMinesAvoiding(board, safe, rng = Math.random) {
  const candidates = [];
  for (let i = 0; i < board.ocean.length; i += 1) {
    if (board.ocean[i] && !safe.has(i)) candidates.push(i);
  }
  board.mineCount = Math.min(board.mineCount, candidates.length);
  for (let k = 0; k < board.mineCount; k += 1) {
    const j = k + Math.floor(rng() * (candidates.length - k));
    [candidates[k], candidates[j]] = [candidates[j], candidates[k]];
    const m = candidates[k];
    board.mine[m] = 1;
    forEachGridNeighbor(board.cols, board.rows, m, (n) => { board.adj[n] += 1; });
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
    if (board.open[i] || board.flag[i] || board.mine[i] || !board.ocean[i]) continue;
    board.open[i] = 1;
    board.opened += 1;
    if (board.adj[i] === 0) {
      forEachGridNeighbor(board.cols, board.rows, i, (n) => {
        if (board.ocean[n] && !board.open[n]) stack.push(n);
      });
    }
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

/**
 * 결과: 'none' | 'opened' | 'boom' | 'won' | 'shielded'
 * shield 가 켜져 있으면 지뢰를 밟아도 끝나지 않고 그 칸에 깃발이 꽂힌다.
 */
export function reveal(board, i, rng = Math.random, { shield = false } = {}) {
  if (board.state === 'won' || board.state === 'lost') return 'none';
  if (!board.ocean[i] || board.open[i] || board.flag[i]) return 'none';
  if (board.state === 'ready') placeMines(board, i, rng);
  if (board.mine[i] && shield) {
    board.flag[i] = 1;
    board.flags += 1;
    board.guarded = i;
    return 'shielded';
  }
  if (board.mine[i]) {
    board.state = 'lost';
    board.exploded = i;
    return 'boom';
  }
  floodOpen(board, i);
  return finishIfWon(board);
}

/** 능력으로 판이 바뀐 뒤: 다 풀렸으면 'won', 아니면 'done' */
export function settle(board) {
  if (board.state !== 'playing') return 'none';
  return finishIfWon(board) === 'won' ? 'won' : 'done';
}

/** 열린 숫자 칸 주변 깃발 수가 숫자와 같으면 나머지 이웃을 한꺼번에 연다 */
export function chord(board, i, options = {}) {
  if (board.state !== 'playing' || !board.open[i] || board.adj[i] === 0) return 'none';
  const around = oceanNeighbors(board, i);
  const flagged = around.reduce((s, n) => s + board.flag[n], 0);
  if (flagged !== board.adj[i]) return 'none';
  let outcome = 'none';
  for (const n of around) {
    if (board.open[n] || board.flag[n]) continue;
    const r = reveal(board, n, Math.random, options);
    if (r === 'boom' || r === 'won' || r === 'shielded') return r;
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

const CELL_OCEAN = 1;
const CELL_MINE = 2;
const CELL_OPEN = 4;
const CELL_FLAG = 8;

/** 칸마다 상태를 1바이트로 묶는다 (이어하기 저장용) */
export function packCells(board) {
  const out = new Uint8Array(board.ocean.length);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = (board.ocean[i] ? CELL_OCEAN : 0) | (board.mine[i] ? CELL_MINE : 0)
      | (board.open[i] ? CELL_OPEN : 0) | (board.flag[i] ? CELL_FLAG : 0);
  }
  return out;
}

/** packCells 로 묶은 칸에서 진행 중인 판을 되살린다 */
export function unpackBoard(cells, cols, rows) {
  const size = cols * rows;
  if (cells.length !== size) throw new Error(`칸 수가 맞지 않습니다: ${cells.length} != ${size}`);
  const ocean = Uint8Array.from(cells, (v) => (v & CELL_OCEAN ? 1 : 0));
  const board = createBoard(ocean, cols, rows, 0);
  let mines = 0;
  for (let i = 0; i < size; i += 1) {
    const v = cells[i];
    if (!(v & CELL_OCEAN)) continue;
    if (v & CELL_MINE) {
      board.mine[i] = 1;
      mines += 1;
      forEachGridNeighbor(cols, rows, i, (n) => { board.adj[n] += 1; });
    }
    if (v & CELL_OPEN) {
      board.open[i] = 1;
      board.opened += 1;
    }
    if (v & CELL_FLAG) {
      board.flag[i] = 1;
      board.flags += 1;
    }
  }
  if (mines === 0) throw new Error('지뢰가 없는 저장 판입니다');
  board.mineCount = mines;
  board.state = 'playing';
  return board;
}

export function progress(board) {
  const total = safeTotal(board);
  return total > 0 ? board.opened / total : 0;
}
