// 캔버스 그리기. 좌표: 화면 px = 칸 좌표 * z + pan

const COLORS = {
  deep: '#082233',
  land: ['#7f9d5e', '#789659'],
  closed: ['#4aa6da', '#429dd0'],
  hover: '#7fc6ec',
  opened: ['#eaf4f8', '#dfedf3'],
  exploded: '#e53935',
  coast: 'rgba(28, 52, 22, 0.55)',
  flag: '#e53935',
  pole: '#37474f',
  mine: '#1c2830',
  wrong: '#b71c1c',
};

const NUMBER_COLORS = ['', '#1976d2', '#388e3c', '#d32f2f', '#7b1fa2', '#ff8f00', '#0097a7', '#424242', '#9e9e9e'];
const MIN_DETAIL_PX = 7;

const mod = (a, n) => ((a % n) + n) % n;

function visibleRange(view, cols, rows) {
  return {
    c0: Math.floor(-view.panX / view.z),
    c1: Math.ceil((view.w - view.panX) / view.z),
    r0: Math.max(0, Math.floor(-view.panY / view.z)),
    r1: Math.min(rows, Math.ceil((view.h - view.panY) / view.z)),
    cols,
  };
}

function forEachVisible(range, rows, fn) {
  for (let sc = range.c0; sc < range.c1; sc += 1) {
    const c = mod(sc, range.cols);
    for (let r = range.r0; r < range.r1; r += 1) fn(r * range.cols + c, sc, r, (r + c) & 1);
  }
}

function tileColor(board, i, parity, hover) {
  if (!board.ocean[i]) return COLORS.land[parity];
  if (board.open[i]) return COLORS.opened[parity];
  if (board.state === 'lost' && i === board.exploded) return COLORS.exploded;
  if (i === hover && (board.state === 'ready' || board.state === 'playing')) return COLORS.hover;
  return COLORS.closed[parity];
}

function drawCoast(ctx, view, game) {
  const { cols, rows } = game.layout;
  const span = cols * view.z;
  const { dpr } = view;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, view.panY, view.w, rows * view.z);
  ctx.clip();
  ctx.strokeStyle = COLORS.coast;
  ctx.lineJoin = 'round';
  const k0 = Math.floor(-view.panX / span) - 1;
  const k1 = Math.floor((view.w - view.panX) / span) + 1;
  for (let k = k0; k <= k1; k += 1) {
    ctx.setTransform(dpr * view.z, 0, 0, dpr * view.z, dpr * (view.panX + k * span), dpr * view.panY);
    ctx.lineWidth = 1.3 / view.z;
    ctx.stroke(game.coast);
  }
  ctx.restore();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawFlag(ctx, x, y, s) {
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

function drawMine(ctx, x, y, s) {
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

function drawMarks(ctx, view, board, range) {
  const s = view.z;
  if (s < MIN_DETAIL_PX) return;
  const lost = board.state === 'lost';
  ctx.font = `800 ${Math.round(s * 0.62)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  forEachVisible(range, board.rows, (i, sc, r) => {
    if (!board.ocean[i]) return;
    const x = view.panX + sc * s;
    const y = view.panY + r * s;
    if (board.open[i] && board.adj[i] > 0) {
      ctx.fillStyle = NUMBER_COLORS[board.adj[i]];
      ctx.fillText(String(board.adj[i]), x + s / 2, y + s * 0.54);
    } else if (board.flag[i]) {
      drawFlag(ctx, x, y, s);
      if (lost && !board.mine[i]) drawCross(ctx, x, y, s);
    } else if (lost && board.mine[i]) {
      drawMine(ctx, x, y, s);
    }
  });
}

export function draw(ctx, view, game, hover) {
  const { dpr } = view;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = COLORS.deep;
  ctx.fillRect(0, 0, view.w, view.h);
  if (!game) return;
  const { board } = game;
  const range = visibleRange(view, board.cols, board.rows);
  const s = view.z;
  const pad = s > 3 ? 0.5 : 0; // 칸 사이 틈이 생기지 않도록 살짝 겹쳐 칠한다
  forEachVisible(range, board.rows, (i, sc, r, parity) => {
    ctx.fillStyle = tileColor(board, i, parity, hover);
    ctx.fillRect(view.panX + sc * s, view.panY + r * s, s + pad, s + pad);
  });
  drawCoast(ctx, view, game);
  drawMarks(ctx, view, board, range);
}
