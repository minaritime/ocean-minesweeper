// 상어토네이도: 바다를 돌아다니는 상어. 위치는 칸 단위 좌표(x: 열, y: 행, 칸 가운데가 .5).
// 화면과 무관한 순수 함수. 상어 배열은 매번 새로 만들어 돌려준다.

export const SHARK_PER_CELLS = 1500; // 바다 이 칸 수마다 상어 한 마리
export const SHARK_SPEED = 1.6; // 초당 칸
const TURN_CHANCE = 0.4; // 초당 방향을 트는 확률
const TRIES = 8;

const cellOf = (board, x, y) => {
  const r = Math.floor(y);
  if (r < 0 || r >= board.rows) return -1;
  return r * board.cols + ((Math.floor(x) % board.cols) + board.cols) % board.cols;
};

const isSea = (board, x, y) => {
  const i = cellOf(board, x, y);
  return i >= 0 && board.ocean[i] === 1;
};

export function sharkCount(oceanCount) {
  return Math.max(1, Math.round(oceanCount / SHARK_PER_CELLS));
}

/** 바다 칸 중 무작위로 count 마리 */
export function spawnSharks(board, count, rng = Math.random) {
  const sea = [];
  for (let i = 0; i < board.ocean.length; i += 1) if (board.ocean[i]) sea.push(i);
  if (!sea.length) return [];
  return Array.from({ length: count }, () => {
    const i = sea[Math.floor(rng() * sea.length)];
    return {
      x: (i % board.cols) + 0.5,
      y: Math.floor(i / board.cols) + 0.5,
      a: rng() * Math.PI * 2,
      spin: rng() * Math.PI * 2,
    };
  });
}

/** dt 초만큼 헤엄친다. 앞이 육지면 다른 방향을 찾고, 못 찾으면 제자리에서 돈다 */
export function stepSharks(sharks, board, dt, rng = Math.random) {
  const step = SHARK_SPEED * dt;
  return sharks.map((s) => {
    let a = rng() < TURN_CHANCE * dt ? s.a + (rng() - 0.5) * Math.PI : s.a;
    for (let k = 0; k < TRIES; k += 1) {
      const x = s.x + Math.cos(a) * step;
      const y = s.y + Math.sin(a) * step;
      if (isSea(board, x, y)) {
        return { ...s, x: ((x % board.cols) + board.cols) % board.cols, y, a, spin: s.spin + dt * 6 };
      }
      a = rng() * Math.PI * 2;
    }
    return { ...s, a, spin: s.spin + dt * 6 };
  });
}

/** 점 (x, y) 에서 radius 칸 안에 있는 첫 상어의 번호, 없으면 -1 (동서로 이어진 거리) */
export function sharkHit(sharks, x, y, radius, cols) {
  return sharks.findIndex((s) => {
    let dx = Math.abs(s.x - x) % cols;
    if (dx > cols / 2) dx = cols - dx;
    return dx * dx + (s.y - y) ** 2 <= radius * radius;
  });
}
