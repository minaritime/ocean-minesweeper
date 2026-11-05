// 능력 효과 연출. 지도 칸 좌표로 기억해 두고 매 프레임 화면 좌표로 바꿔 그린다.
// add() 로 넣고, draw() 가 true 를 돌려주는 동안 다음 프레임을 계속 그린다.

import { project } from './geo.js';

const mod = (a, n) => ((a % n) + n) % n;
const ease = (t) => 1 - (1 - t) ** 3;
const clamp01 = (t) => Math.min(1, Math.max(0, t));

/** 핵전쟁: 서로 쏘는 나라 수도 (경도, 위도) */
const CITIES = {
  washington: [-77.0, 38.9],
  moscow: [37.6, 55.75],
  beijing: [116.4, 39.9],
  london: [-0.13, 51.5],
  paris: [2.35, 48.85],
  delhi: [77.2, 28.6],
  islamabad: [73.0, 33.7],
  pyongyang: [125.7, 39.0],
};
const STRIKES = [
  ['washington', 'moscow'], ['moscow', 'washington'], ['beijing', 'washington'], ['washington', 'beijing'],
  ['moscow', 'london'], ['paris', 'moscow'], ['delhi', 'islamabad'], ['islamabad', 'delhi'], ['pyongyang', 'washington'],
  ['london', 'moscow'],
];
export const NUKE_MS = { flight: 1500, stagger: 110, flash: 2500, total: 3600 };

/** 칸 좌표 (x, y: 칸 단위, 가운데 기준) → 화면 좌표. 동서 바퀴 중 화면 가운데에 가까운 쪽 */
function toScreen(view, cols, x, y) {
  const span = cols * view.z;
  let sx = view.panX + x * view.z;
  sx -= Math.round((sx - view.w / 2) / span) * span;
  return [sx, view.panY + y * view.z];
}

const cellXY = (cols, i) => [(i % cols) + 0.5, Math.floor(i / cols) + 0.5];

function drawRing(ctx, view, fx, t) {
  const [sx, sy] = toScreen(view, fx.cols, ...cellXY(fx.cols, fx.i));
  const r = view.z * (0.6 + ease(t) * (fx.reach ?? 2.5));
  ctx.strokeStyle = fx.color;
  ctx.globalAlpha = 1 - t;
  ctx.lineWidth = Math.max(2, view.z * 0.18) * (1 - t * 0.6);
  ctx.beginPath();
  ctx.arc(sx, sy, r, 0, Math.PI * 2);
  ctx.stroke();
}

function drawSquare(ctx, view, fx, t) {
  const [sx, sy] = toScreen(view, fx.cols, ...cellXY(fx.cols, fx.i));
  const half = view.z * (fx.r + 0.5) * (1 + ease(t) * 0.35);
  ctx.globalAlpha = (1 - t) * 0.9;
  ctx.strokeStyle = fx.color;
  ctx.lineWidth = Math.max(2, view.z * 0.15);
  ctx.strokeRect(sx - half, sy - half, half * 2, half * 2);
  ctx.globalAlpha = (1 - t) * 0.25;
  ctx.fillStyle = fx.color;
  ctx.fillRect(sx - half, sy - half, half * 2, half * 2);
}

function drawBubble(ctx, view, fx, t) {
  const [sx, sy] = toScreen(view, fx.cols, ...cellXY(fx.cols, fx.i));
  const r = view.z * (0.8 + ease(t) * 1.6);
  const g = ctx.createRadialGradient(sx, sy, r * 0.2, sx, sy, r);
  g.addColorStop(0, 'rgba(120,200,255,0)');
  g.addColorStop(0.75, 'rgba(120,200,255,0.35)');
  g.addColorStop(1, 'rgba(200,240,255,0.95)');
  ctx.globalAlpha = 1 - t * t;
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(sx, sy, r, 0, Math.PI * 2);
  ctx.fill();
}

function drawSpikes(ctx, view, fx, t) {
  const [sx, sy] = toScreen(view, fx.cols, ...cellXY(fx.cols, fx.i));
  const len = view.z * (0.5 + ease(t) * 2.2);
  const w = view.z * 0.35;
  ctx.globalAlpha = 1 - t * t;
  ctx.fillStyle = '#7bc043';
  ctx.strokeStyle = '#2f5d14';
  ctx.lineWidth = 1.5;
  for (let k = 0; k < 4; k += 1) {
    const a = (k * Math.PI) / 2;
    ctx.beginPath();
    ctx.moveTo(sx + Math.cos(a) * len, sy + Math.sin(a) * len);
    ctx.lineTo(sx + Math.cos(a + Math.PI / 2) * w, sy + Math.sin(a + Math.PI / 2) * w);
    ctx.lineTo(sx + Math.cos(a - Math.PI / 2) * w, sy + Math.sin(a - Math.PI / 2) * w);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

function drawWave(ctx, view, fx, t) {
  const [ax, ay] = toScreen(view, fx.cols, ...cellXY(fx.cols, fx.a));
  const [bx0, by] = toScreen(view, fx.cols, ...cellXY(fx.cols, fx.b));
  const span = fx.cols * view.z;
  const bx = bx0 - Math.round((bx0 - ax) / span) * span;
  const len = Math.hypot(bx - ax, by - ay) || 1;
  const nx = -(by - ay) / len;
  const ny = (bx - ax) / len;
  ctx.globalAlpha = 1 - t;
  ctx.strokeStyle = fx.ok ? '#b388ff' : '#ff5252';
  ctx.lineWidth = Math.max(2, view.z * 0.12);
  ctx.beginPath();
  for (let k = 0; k <= 40; k += 1) {
    const u = k / 40;
    const amp = view.z * 0.6 * Math.sin(u * Math.PI) * (1 - t);
    const off = Math.sin(u * 18 - t * 30) * amp;
    const px = ax + (bx - ax) * u + nx * off;
    const py = ay + (by - ay) * u + ny * off;
    if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.stroke();
}

/** 여러 칸이 한꺼번에 빛나다 사라진다 (영해, 억까 ㄴ). 보이는 칸만 그린다 */
function drawGlow(ctx, view, fx, t) {
  const z = view.z;
  const span = fx.cols * z;
  ctx.globalAlpha = (1 - t) * 0.75;
  ctx.fillStyle = fx.color;
  const pad = Math.max(1, z * 0.15 * (1 - t));
  for (const i of fx.cells) {
    const y = view.panY + Math.floor(i / fx.cols) * z;
    if (y < -z || y > view.h) continue;
    let x = view.panX + (i % fx.cols) * z;
    x -= Math.floor(x / span) * span;
    for (; x < view.w; x += span) ctx.fillRect(x - pad, y - pad, z + pad * 2, z + pad * 2);
  }
}

function drawRise(ctx, view, fx, t) {
  const [sx, sy] = toScreen(view, fx.cols, ...cellXY(fx.cols, fx.i));
  for (let k = 0; k < 3; k += 1) {
    const u = clamp01(t * 1.4 - k * 0.2);
    if (u <= 0 || u >= 1) continue;
    ctx.globalAlpha = (1 - u) * 0.8;
    ctx.strokeStyle = '#4dd0e1';
    ctx.lineWidth = Math.max(2, view.z * 0.2);
    ctx.beginPath();
    ctx.arc(sx, sy, view.z * fx.r * (0.3 + u * 0.9), 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = (1 - t) * 0.5;
  ctx.fillStyle = '#c8a96a';
  ctx.beginPath();
  ctx.arc(sx, sy, view.z * fx.r * ease(clamp01(t * 2)), 0, Math.PI * 2);
  ctx.fill();
}

/** 화면 전체 연출 (였던것, 국국가가): 가운데 큰 아이콘과 색 */
function drawScreen(ctx, view, fx, t) {
  ctx.globalAlpha = Math.sin(t * Math.PI) * 0.55;
  ctx.fillStyle = fx.color;
  ctx.fillRect(0, 0, view.w, view.h);
  ctx.globalAlpha = Math.sin(t * Math.PI);
  const size = Math.min(view.w, view.h) * (0.18 + t * 0.08);
  ctx.font = `${Math.round(size)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(fx.icon, view.w / 2, view.h / 2 - t * 30);
  if (fx.text) {
    ctx.font = `900 ${Math.round(size * 0.32)}px system-ui, sans-serif`;
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = 'rgba(0,0,0,.6)';
    ctx.lineWidth = 6;
    ctx.strokeText(fx.text, view.w / 2, view.h / 2 + size * 0.7);
    ctx.fillText(fx.text, view.w / 2, view.h / 2 + size * 0.7);
  }
}

function drawMissile(ctx, view, fx, m, ms) {
  const u = clamp01((ms - m.delay) / NUKE_MS.flight);
  if (u <= 0) return;
  const [ax, ay] = toScreen(view, fx.cols, m.from[0], m.from[1]);
  const span = fx.cols * view.z;
  const [bx0, by] = toScreen(view, fx.cols, m.to[0], m.to[1]);
  const bx = bx0 - Math.round((bx0 - ax) / span) * span;
  const top = Math.max(view.panY, 0) + 16; // 호가 지도 위로 잘려 나가지 않게
  const lift = Math.max(12, Math.min(Math.hypot(bx - ax, by - ay) * 0.4, Math.min(ay, by) - top));
  const at = (v) => [ax + (bx - ax) * v, ay + (by - ay) * v - Math.sin(v * Math.PI) * lift];
  if (u < 1) {
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = '#ffe0b2';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let k = 0; k <= 30; k += 1) {
      const [px, py] = at((u * k) / 30);
      if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
    const [hx, hy] = at(u);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#fff3e0';
    ctx.beginPath();
    ctx.arc(hx, hy, 4, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  const b = clamp01((ms - m.delay - NUKE_MS.flight) / 900);
  if (b >= 1) return;
  const r = 10 + ease(b) * Math.min(view.w, view.h) * 0.12;
  const g = ctx.createRadialGradient(bx, by, 0, bx, by, r);
  g.addColorStop(0, 'rgba(255,255,230,1)');
  g.addColorStop(0.35, 'rgba(255,200,80,0.95)');
  g.addColorStop(0.7, 'rgba(230,80,20,0.7)');
  g.addColorStop(1, 'rgba(120,30,10,0)');
  ctx.globalAlpha = 1 - b * b;
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(bx, by, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(bx, by, r * 1.6, 0, Math.PI * 2);
  ctx.stroke();
}

function drawNuke(ctx, view, fx, ms) {
  for (const m of fx.missiles) drawMissile(ctx, view, fx, m, ms);
  const f = (ms - NUKE_MS.flash) / (NUKE_MS.total - NUKE_MS.flash);
  if (f > -0.25 && f < 1) {
    ctx.globalAlpha = f < 0 ? (f + 0.25) * 4 : 1 - f;
    ctx.fillStyle = '#fffdf5';
    ctx.fillRect(0, 0, view.w, view.h);
  }
}

/** 두 칸 좌표를 화면 좌표로 (b 는 a 와 같은 바퀴 쪽으로) */
function screenPair(view, cols, a, b) {
  const [ax, ay] = toScreen(view, cols, a[0], a[1]);
  const [bx0, by] = toScreen(view, cols, b[0], b[1]);
  const span = cols * view.z;
  return [ax, ay, bx0 - Math.round((bx0 - ax) / span) * span, by];
}

/** 소나: 고른 칸에서 끝 칸까지 음파 고리가 퍼져 나간다 */
function drawBeam(ctx, view, fx, t) {
  const [ax, ay, bx, by] = screenPair(view, fx.cols, cellXY(fx.cols, fx.a), cellXY(fx.cols, fx.b));
  ctx.globalAlpha = 1 - t * 0.7;
  ctx.strokeStyle = '#80deea';
  ctx.lineWidth = Math.max(2, view.z * 0.25);
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(ax + (bx - ax) * ease(Math.min(1, t * 2)), ay + (by - ay) * ease(Math.min(1, t * 2)));
  ctx.stroke();
  for (let k = 0; k < 3; k += 1) {
    const u = clamp01(t * 1.6 - k * 0.25);
    if (u <= 0 || u >= 1) continue;
    ctx.globalAlpha = 1 - u;
    ctx.beginPath();
    ctx.arc(ax + (bx - ax) * u, ay + (by - ay) * u, view.z * (0.6 + u * 0.8), 0, Math.PI * 2);
    ctx.stroke();
  }
}

/** 호르무즈 봉쇄선: 빨강·흰 줄무늬 띠가 해협을 가로질러 그어진다 */
function drawBarrier(ctx, view, fx, t) {
  const [ax, ay, bx, by] = screenPair(view, fx.cols, fx.from, fx.to);
  const grow = ease(clamp01(t * 3));
  const ex = ax + (bx - ax) * grow;
  const ey = ay + (by - ay) * grow;
  const w = Math.max(6, Math.min(16, view.z * 0.45));
  ctx.globalAlpha = t > 0.85 ? (1 - t) / 0.15 : 1;
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#b71c1c';
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  ctx.setLineDash([w * 0.9, w * 0.9]);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = w * 0.55;
  ctx.stroke();
  ctx.setLineDash([]);
  if (grow < 1) return;
  const size = Math.max(26, w * 3);
  ctx.font = `${Math.round(size)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('⛔', (ax + bx) / 2 + size * 0.9, (ay + by) / 2);
}

const DRAWERS = {
  ring: drawRing, square: drawSquare, bubble: drawBubble, spikes: drawSpikes, wave: drawWave,
  glow: drawGlow, rise: drawRise, screen: drawScreen, beam: drawBeam, barrier: drawBarrier,
};

export function createEffects() {
  let list = [];
  return {
    /** fx: { kind, ms, ...칸 정보 }. cols 는 지도 열 수 */
    add(fx) {
      list = [...list, { ...fx, start: performance.now() }];
    },
    /** 핵전쟁: 수도끼리 미사일 */
    nuke(layout) {
      const pos = (name) => {
        const [x, y] = project(layout, ...CITIES[name]);
        return [mod(x, layout.cols), y];
      };
      const missiles = STRIKES.map(([a, b], k) => ({ from: pos(a), to: pos(b), delay: k * NUKE_MS.stagger }));
      list = [...list, { kind: 'nuke', ms: NUKE_MS.total, cols: layout.cols, missiles, start: performance.now() }];
    },
    get active() {
      return list.length > 0;
    },
    /** 화면 흔들림 (핵전쟁 폭발 동안) */
    shake(now = performance.now()) {
      const fx = list.find((f) => f.kind === 'nuke');
      if (!fx) return [0, 0];
      const ms = now - fx.start;
      const s = ms > NUKE_MS.flight && ms < NUKE_MS.flash + 300 ? 6 : 0;
      return [(Math.random() - 0.5) * s, (Math.random() - 0.5) * s];
    },
    /** 그릴 효과가 남아 있으면 true */
    draw(ctx, view, now = performance.now()) {
      list = list.filter((fx) => now - fx.start < fx.ms);
      for (const fx of list) {
        const ms = now - fx.start;
        ctx.save();
        if (fx.kind === 'nuke') drawNuke(ctx, view, fx, ms);
        else DRAWERS[fx.kind](ctx, view, fx, clamp01(ms / fx.ms));
        ctx.restore();
      }
      return list.length > 0;
    },
  };
}
