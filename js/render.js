// 캔버스 그리기. 좌표: 화면 px = 칸 좌표 * z + pan
// 칸 바탕색은 칸 1개 = 1픽셀인 그림(layer)에 담아 두고 확대해서 한 번에 그린다.
// 숫자·깃발·지뢰는 칸이 충분히 클 때 보이는 칸에만 그린다.

const COLORS = {
  deep: '#082233',
  land: ['#7f9d5e', '#789659'],
  closed: ['#4aa6da', '#429dd0'],
  hover: 'rgba(255, 255, 255, 0.35)',
  aim: 'rgba(255, 179, 71, 0.55)',
  aimEdge: '#ffb347',
  opened: ['#eaf4f8', '#dfedf3'],
  exploded: '#e53935',
  coast: 'rgba(28, 52, 22, 0.55)',
  flagCell: '#e8574f',
  flag: '#e53935',
  pole: '#37474f',
  mine: '#1c2830',
  wrong: '#b71c1c',
};

const NUMBER_COLORS = ['', '#1976d2', '#388e3c', '#d32f2f', '#7b1fa2', '#ff8f00', '#0097a7', '#424242', '#9e9e9e'];
const MIN_DETAIL_PX = 7;
const COAST_MIN_PX = 1.2;

const mod = (a, n) => ((a % n) + n) % n;

/** '#rrggbb' → ImageData 용 32비트 값 (리틀 엔디언 ABGR) */
function packColor(hex) {
  const v = parseInt(hex.slice(1), 16);
  return (0xff << 24 | (v & 0xff) << 16 | (v & 0xff00) | (v >> 16)) >>> 0;
}

const PACKED = {
  land: COLORS.land.map(packColor),
  closed: COLORS.closed.map(packColor),
  opened: COLORS.opened.map(packColor),
  exploded: packColor(COLORS.exploded),
  flagCell: packColor(COLORS.flagCell),
  mine: packColor(COLORS.mine),
};

export function createLayer(board) {
  const canvas = document.createElement('canvas');
  canvas.width = board.cols;
  canvas.height = board.rows;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(board.cols, board.rows);
  return { canvas, ctx, image, pixels: new Uint32Array(image.data.buffer) };
}

function cellPixel(board, i, parity, lost) {
  if (!board.ocean[i]) return PACKED.land[parity];
  if (board.open[i]) return PACKED.opened[parity];
  if (lost && i === board.exploded) return PACKED.exploded;
  if (lost && board.mine[i] && !board.flag[i]) return PACKED.mine;
  if (board.flag[i]) return PACKED.flagCell;
  return PACKED.closed[parity];
}

/** 판 상태가 바뀐 뒤 한 번 호출해 바탕 그림을 새로 칠한다 */
export function paintLayer(layer, board) {
  const { cols, rows } = board;
  const lost = board.state === 'lost';
  const px = layer.pixels;
  for (let r = 0; r < rows; r += 1) {
    const base = r * cols;
    for (let c = 0; c < cols; c += 1) px[base + c] = cellPixel(board, base + c, (r + c) & 1, lost);
  }
  layer.ctx.putImageData(layer.image, 0, 0);
}

function copyRange(view, span) {
  return { k0: Math.floor(-view.panX / span) - 1, k1: Math.floor((view.w - view.panX) / span) + 1 };
}

function drawLayer(ctx, view, game) {
  const { cols, rows } = game.board;
  const z = view.z;
  const span = cols * z;
  const r0 = Math.max(0, Math.floor(-view.panY / z));
  const r1 = Math.min(rows, Math.ceil((view.h - view.panY) / z));
  if (r1 <= r0) return;
  ctx.imageSmoothingEnabled = false;
  const { k0, k1 } = copyRange(view, span);
  for (let k = k0; k <= k1; k += 1) {
    const left = view.panX + k * span;
    const c0 = Math.max(0, Math.floor(-left / z));
    const c1 = Math.min(cols, Math.ceil((view.w - left) / z));
    if (c1 <= c0) continue;
    ctx.drawImage(game.layer.canvas, c0, r0, c1 - c0, r1 - r0, left + c0 * z, view.panY + r0 * z, (c1 - c0) * z, (r1 - r0) * z);
  }
}

function drawCoast(ctx, view, game) {
  if (view.z < COAST_MIN_PX) return;
  const { cols, rows } = game.board;
  const span = cols * view.z;
  const { dpr } = view;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, view.panY, view.w, rows * view.z);
  ctx.clip();
  ctx.strokeStyle = COLORS.coast;
  ctx.lineJoin = 'round';
  const { k0, k1 } = copyRange(view, span);
  for (let k = k0; k <= k1; k += 1) {
    ctx.setTransform(dpr * view.z, 0, 0, dpr * view.z, dpr * (view.panX + k * span), dpr * view.panY);
    ctx.lineWidth = 1.3 / view.z;
    ctx.stroke(game.coast);
  }
  ctx.restore();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawFlag(ctx, x, y, s) {
  ctx.fillStyle = COLORS.closed[0];
  ctx.fillRect(x, y, s, s);
  ctx.fillStyle = COLORS.pole;
  ctx.fillRect(x + s * 0.3, y + s * 0.2, s * 0.08, s * 0.62);
  ctx.fillRect(x + s * 0.2, y + s * 0.78, s * 0.42, s * 0.08);
  ctx.fillStyle = COLORS.flag;
  ctx.beginPath();
  ctx.moveTo(x + s * 0.38, y + s * 0.18);
  ctx.lineTo(x + s * 0.8, y + s * 0.36);
  ctx.lineTo(x + s * 0.38, y + s * 0.54);
  ctx.closePath();
  ctx.fill();
}

function drawMine(ctx, x, y, s, exploded) {
  ctx.fillStyle = exploded ? COLORS.exploded : COLORS.closed[0];
  ctx.fillRect(x, y, s, s);
  const cx = x + s / 2;
  const cy = y + s / 2;
  ctx.strokeStyle = COLORS.mine;
  ctx.lineWidth = Math.max(1, s * 0.07);
  ctx.beginPath();
  for (let a = 0; a < 4; a += 1) {
    const ang = (a * Math.PI) / 4;
    ctx.moveTo(cx - Math.cos(ang) * s * 0.34, cy - Math.sin(ang) * s * 0.34);
    ctx.lineTo(cx + Math.cos(ang) * s * 0.34, cy + Math.sin(ang) * s * 0.34);
  }
  ctx.stroke();
  ctx.fillStyle = COLORS.mine;
  ctx.beginPath();
  ctx.arc(cx, cy, s * 0.23, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.beginPath();
  ctx.arc(cx - s * 0.07, cy - s * 0.07, s * 0.06, 0, Math.PI * 2);
  ctx.fill();
}

function drawCross(ctx, x, y, s) {
  ctx.strokeStyle = COLORS.wrong;
  ctx.lineWidth = Math.max(1.5, s * 0.09);
  ctx.beginPath();
  ctx.moveTo(x + s * 0.18, y + s * 0.18);
  ctx.lineTo(x + s * 0.82, y + s * 0.82);
  ctx.moveTo(x + s * 0.82, y + s * 0.18);
  ctx.lineTo(x + s * 0.18, y + s * 0.82);
  ctx.stroke();
}

function drawMarks(ctx, view, board) {
  const s = view.z;
  if (s < MIN_DETAIL_PX) return;
  const { cols, rows } = board;
  const lost = board.state === 'lost';
  const c0 = Math.floor(-view.panX / s);
  const c1 = Math.ceil((view.w - view.panX) / s);
  const r0 = Math.max(0, Math.floor(-view.panY / s));
  const r1 = Math.min(rows, Math.ceil((view.h - view.panY) / s));
  ctx.font = `800 ${Math.round(s * 0.62)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let sc = c0; sc < c1; sc += 1) {
    const c = mod(sc, cols);
    const x = view.panX + sc * s;
    for (let r = r0; r < r1; r += 1) {
      const i = r * cols + c;
      if (!board.ocean[i]) continue;
      const y = view.panY + r * s;
      if (board.open[i]) {
        if (board.adj[i] === 0) continue;
        ctx.fillStyle = NUMBER_COLORS[board.adj[i]];
        ctx.fillText(String(board.adj[i]), x + s / 2, y + s * 0.54);
      } else if (board.flag[i]) {
        drawFlag(ctx, x, y, s);
        if (lost && !board.mine[i]) drawCross(ctx, x, y, s);
      } else if (lost && board.mine[i]) {
        drawMine(ctx, x, y, s, i === board.exploded);
      }
    }
  }
}

/** 칸 하나를 화면에 보이는 모든 바퀴 위치에 칠한다 (동서로 이어진 지도) */
function fillCell(ctx, view, board, i, fill, edge) {
  const { cols } = board;
  const span = cols * view.z;
  const r = Math.floor(i / cols);
  const c = i % cols;
  let x = view.panX + c * view.z;
  x -= Math.floor(x / span) * span; // 화면 왼쪽 첫 바퀴 위치로
  const y = view.panY + r * view.z;
  for (; x < view.w; x += span) {
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, view.z, view.z);
    if (edge && view.z >= 4) {
      ctx.strokeStyle = edge;
      ctx.lineWidth = Math.max(1, view.z * 0.08);
      ctx.strokeRect(x + 0.5, y + 0.5, view.z - 1, view.z - 1);
    }
  }
}

function drawHover(ctx, view, board, hover) {
  if (hover < 0 || !board.ocean[hover] || board.open[hover]) return;
  if (board.state !== 'ready' && board.state !== 'playing') return;
  fillCell(ctx, view, board, hover, COLORS.hover);
}

/** 능력 대상 고르기 중: 효과가 닿을 칸들 */
function drawAim(ctx, view, board, aim) {
  if (board.state !== 'playing') return;
  for (const i of aim) fillCell(ctx, view, board, i, COLORS.aim, COLORS.aimEdge);
}

/** aim: 능력 대상 고르기 중이면 효과가 닿을 칸 목록, 아니면 null */
export function draw(ctx, view, game, hover, aim = null) {
  const { dpr } = view;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = COLORS.deep;
  ctx.fillRect(0, 0, view.w, view.h);
  if (!game) return;
  drawLayer(ctx, view, game);
  drawCoast(ctx, view, game);
  drawMarks(ctx, view, game.board);
  if (aim) drawAim(ctx, view, game.board, aim);
  else drawHover(ctx, view, game.board, hover);
}
