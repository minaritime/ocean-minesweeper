// 계속 움직이는 능력·사건: 상어토네이도, 레이더, 천둥번개(어둠과 번개).
// 매 프레임 draw() 가 시간을 흘리고 그린다. 시계가 멈춘 동안은 함께 멈춘다.

import { isDark } from './abilities.js';
import { spawnSharks, stepSharks, sharkHit, sharkCount } from './sharks.js';

export const RADAR_MS = 5000;
export const RADAR_RADIUS = 5; // 칸
const SHARK_HIT_RADIUS = 1.2; // 칸
const SHARK_DRAW_CELLS = 2.6;
const SHARK_MIN_PX = 14;
const BITE_GRACE_S = 2;
const DARK_ALPHA = 0.96;
const STRIKE_GAP_S = [3, 8]; // 번개 사이 간격 (초, 최소·최대)
const MAX_DT = 0.1;

const mod = (a, n) => ((a % n) + n) % n;

/** 번개 한 번의 밝기: [어둠 덮개 진하기, 흰 번쩍임 진하기]. 끝났으면 null */
function strikeLight(ms, reduced) {
  if (reduced) {
    if (ms < 300) return [DARK_ALPHA * (1 - ms / 300), 0];
    if (ms < 1200) return [0, 0];
    if (ms < 2000) return [DARK_ALPHA * ((ms - 1200) / 800), 0];
    return null;
  }
  if (ms < 80) return [0, 0.8];
  if (ms < 160) return [0.7, 0];
  if (ms < 230) return [0, 0.6];
  if (ms < 1100) return [0, 0];
  if (ms < 1800) return [DARK_ALPHA * ((ms - 1100) / 700), 0];
  return null;
}

/**
 * @param {object} host
 *   state, minPlayPx, pointToGrid(sx, sy), onBite(gx, gy), showToast(text, kind), handle(📡 끌기 아이콘 요소)
 */
export function createHazards(host) {
  const { state } = host;
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  let sharks = null;
  let grace = 0;
  let radar = null; // { left: ms, hx, hy: 끌기 아이콘 화면 위치 }
  let strike = { wait: 1, ms: -1 };
  let wasDark = false;
  let last = 0;
  const pointer = { x: 0, y: 0, inside: false, pressed: false, type: 'mouse' };

  const board = () => state.game?.board;
  const usesHandle = () => (state.lastPointerType ? state.lastPointerType !== 'mouse'
    : window.matchMedia?.('(pointer: coarse)').matches ?? false);

  function paused() {
    const b = board();
    return !b || b.state !== 'playing' || !state.startTime || Boolean(state.pauseAt) || state.busy || document.hidden;
  }

  function dark() {
    return state.mode === 'ability' && isDark(state.abilities, board());
  }

  function reset() {
    sharks = null;
    grace = 0;
    stopRadar();
    strike = { wait: 1, ms: -1 };
    wasDark = false;
  }

  /** 상어토네이도를 고른 판이면 상어를 풀어 놓는다 (새 판·이어하기·판 바뀜 뒤) */
  function sync() {
    const b = board();
    const on = state.mode === 'ability' && state.abilities.picks.includes('sharknado') && b;
    if (!on) sharks = null;
    else if (!sharks) sharks = spawnSharks(b, sharkCount(b.oceanCount));
  }

  /* ---------- 레이더 ---------- */

  function startRadar() {
    radar = { left: RADAR_MS, hx: state.view.w / 2, hy: state.view.h / 2 };
    if (usesHandle()) {
      host.handle.hidden = false;
      placeHandle();
    }
  }

  function stopRadar() {
    radar = null;
    host.handle.hidden = true;
  }

  function placeHandle() {
    host.handle.style.transform = `translate(${radar.hx}px, ${radar.hy}px) translate(-50%, -50%)`;
  }

  function moveHandle(sx, sy) {
    if (!radar) return;
    radar.hx = Math.min(state.view.w, Math.max(0, sx));
    radar.hy = Math.min(state.view.h, Math.max(0, sy));
    placeHandle();
  }

  function radarCenter() {
    if (!host.handle.hidden) return host.pointToGrid(radar.hx, radar.hy);
    return pointer.inside ? host.pointToGrid(pointer.x, pointer.y) : null;
  }

  /* ---------- 상어 ---------- */

  const canBite = () => sharks && grace <= 0 && !paused() && state.view.z >= host.minPlayPx;

  function tryBite(sx, sy) {
    if (!canBite()) return false;
    const [gx, gy] = host.pointToGrid(sx, sy);
    if (sharkHit(sharks, gx, gy, SHARK_HIT_RADIUS, board().cols) < 0) return false;
    grace = BITE_GRACE_S;
    host.onBite(gx, gy);
    return true;
  }

  /** 마우스 위치 (끄는 중이면 pressed) */
  function setPointer(p) {
    Object.assign(pointer, p);
    if (pointer.inside && pointer.type === 'mouse' && !pointer.pressed) tryBite(pointer.x, pointer.y);
  }

  /* ---------- 매 프레임 ---------- */

  function tick(dt) {
    if (sharks) {
      sharks = stepSharks(sharks, board(), dt);
      grace = Math.max(0, grace - dt);
      if (pointer.inside && pointer.type === 'mouse' && !pointer.pressed) tryBite(pointer.x, pointer.y);
    }
    if (radar) {
      radar.left -= dt * 1000;
      if (radar.left <= 0) stopRadar();
    }
    const isDarkNow = dark();
    if (wasDark && !isDarkNow && board()?.state === 'playing') host.showToast('☀️ 하늘이 개었습니다', 'info');
    wasDark = isDarkNow;
    if (!isDarkNow) return;
    if (strike.ms >= 0) strike.ms += dt * 1000;
    else if ((strike.wait -= dt) <= 0) strike.ms = 0;
  }

  function toScreenX(view, x) {
    const span = board().cols * view.z;
    let sx = view.panX + x * view.z;
    sx -= Math.round((sx - view.w / 2) / span) * span;
    return sx;
  }

  function drawSharks(ctx, view) {
    const size = Math.max(SHARK_MIN_PX, view.z * SHARK_DRAW_CELLS);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${Math.round(size)}px system-ui, sans-serif`;
    for (const s of sharks) {
      const sx = toScreenX(view, s.x);
      const sy = view.panY + s.y * view.z;
      if (sx < -size || sx > view.w + size || sy < -size || sy > view.h + size) continue;
      ctx.strokeStyle = 'rgba(210, 225, 235, 0.55)';
      ctx.lineWidth = Math.max(1.5, size * 0.06);
      for (let k = 0; k < 3; k += 1) {
        ctx.beginPath();
        ctx.arc(sx, sy, size * (0.35 + k * 0.12), s.spin + k * 2, s.spin + k * 2 + Math.PI * 1.1);
        ctx.stroke();
      }
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(Math.sin(s.spin) * 0.35);
      ctx.fillText('🦈', 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }

  function drawRadar(ctx, view) {
    const c = radarCenter();
    if (!c) return;
    const b = board();
    const [gx, gy] = c;
    const sx = toScreenX(view, gx);
    const sy = view.panY + gy * view.z;
    const R = RADAR_RADIUS;
    ctx.save();
    ctx.fillStyle = 'rgba(0, 230, 118, 0.12)';
    ctx.strokeStyle = 'rgba(0, 230, 118, 0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(sx, sy, R * view.z, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(sx, sy, R * view.z + 6, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * radar.left) / RADAR_MS);
    ctx.stroke();
    ctx.fillStyle = '#ff1744';
    const dot = Math.max(2.5, view.z * 0.28);
    const r0 = Math.floor(gy);
    const c0 = Math.floor(gx);
    for (let dr = -R; dr <= R; dr += 1) {
      const r = r0 + dr;
      if (r < 0 || r >= b.rows) continue;
      for (let dc = -R; dc <= R; dc += 1) {
        const i = r * b.cols + mod(c0 + dc, b.cols);
        const cx = c0 + dc + 0.5;
        const cy = r + 0.5;
        if (!b.mine[i] || (cx - gx) ** 2 + (cy - gy) ** 2 > R * R) continue;
        ctx.beginPath();
        ctx.arc(toScreenX(view, cx), view.panY + cy * view.z, dot, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawDark(ctx, view) {
    let light = [DARK_ALPHA, 0];
    if (strike.ms >= 0) {
      const l = strikeLight(strike.ms, reduced);
      if (l) light = l;
      else strike = { wait: STRIKE_GAP_S[0] + Math.random() * (STRIKE_GAP_S[1] - STRIKE_GAP_S[0]), ms: -1 };
    }
    ctx.save();
    if (light[0] > 0) {
      ctx.fillStyle = `rgba(4, 7, 14, ${light[0]})`;
      ctx.fillRect(0, 0, view.w, view.h);
    }
    if (light[1] > 0) {
      ctx.fillStyle = `rgba(235, 240, 255, ${light[1]})`;
      ctx.fillRect(0, 0, view.w, view.h);
    }
    ctx.restore();
  }

  /** 그리고, 다음 프레임이 필요하면 true */
  function draw(ctx, view, now = performance.now()) {
    const dt = last ? Math.min(MAX_DT, (now - last) / 1000) : 0;
    last = now;
    if (!board()) return false;
    const still = paused();
    if (!still) tick(dt);
    if (sharks) drawSharks(ctx, view);
    if (radar) drawRadar(ctx, view);
    if (dark()) drawDark(ctx, view);
    const moving = Boolean(sharks || radar || dark());
    if (still || !moving) last = 0;
    return moving && !still;
  }

  /** 번개를 곧 치게 한다 (천둥번개를 고른 순간) */
  function strikeSoon() {
    strike = { wait: 0.4, ms: -1 };
  }

  return {
    reset, sync, draw, startRadar, moveHandle, setPointer, tryBite, strikeSoon,
    radarOn: () => Boolean(radar),
    sharkList: () => sharks ?? [],
  };
}
