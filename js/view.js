// 지도 보기: 확대·이동·화면 맞춤, 화면 좌표 ↔ 칸. 좌표: 화면 px = 칸 좌표 * z + pan

export const MAX_CELL_PX = 90;
export const MIN_PLAY_PX = 8; // 칸이 이보다 작으면 누른 곳을 먼저 확대한다
const FILL_CELL_PX_MAX = 40;

const mod = (a, n) => ((a % n) + n) % n;
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * @param {{ state: object, canvas: HTMLCanvasElement, requestRender: () => void }} host
 */
export function createView({ state, canvas, requestRender }) {
  let flight = 0;

  function clampView() {
    const v = state.view;
    const { cols, rows } = state.game.layout;
    v.z = Math.min(MAX_CELL_PX, Math.max(v.fitZ * 0.8, v.z));
    v.panX = -mod(-v.panX, cols * v.z);
    const height = rows * v.z;
    if (height <= v.h) v.panY = (v.h - height) / 2;
    else v.panY = Math.min(40, Math.max(v.h - height - 40, v.panY));
  }

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const v = state.view;
    const cx = v.w / 2;
    const cy = v.h / 2;
    v.dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * v.dpr);
    canvas.height = Math.round(rect.height * v.dpr);
    v.panX += rect.width / 2 - cx;
    v.panY += rect.height / 2 - cy;
    v.w = rect.width;
    v.h = rect.height;
    if (state.game) {
      v.fitZ = Math.min(v.w / state.game.layout.cols, v.h / state.game.layout.rows);
      clampView();
    }
    requestRender();
  }

  function fitView() {
    const v = state.view;
    const { cols, rows } = state.game.layout;
    v.fitZ = Math.min(v.w / cols, v.h / rows);
    v.z = Math.max(v.fitZ, Math.min(FILL_CELL_PX_MAX, v.h / rows));
    v.panX = (v.w - cols * v.z) / 2;
    v.panY = (v.h - rows * v.z) / 2;
    clampView();
    requestRender();
  }

  function zoomAt(sx, sy, factor) {
    if (!state.game) return;
    const v = state.view;
    const wx = (sx - v.panX) / v.z;
    const wy = (sy - v.panY) / v.z;
    v.z = Math.min(MAX_CELL_PX, Math.max(v.fitZ * 0.8, v.z * factor));
    v.panX = sx - wx * v.z;
    v.panY = sy - wy * v.z;
    clampView();
    requestRender();
  }

  function cellAt(sx, sy) {
    const v = state.view;
    const { cols, rows } = state.game.layout;
    const r = Math.floor((sy - v.panY) / v.z);
    if (r < 0 || r >= rows) return -1;
    return r * cols + mod(Math.floor((sx - v.panX) / v.z), cols);
  }

  /** 화면 좌표 → 칸 단위 좌표 (소수) */
  function pointToGrid(sx, sy) {
    const v = state.view;
    return [mod((sx - v.panX) / v.z, state.game.layout.cols), (sy - v.panY) / v.z];
  }

  /** 칸 좌표 (x, y) 가 화면 가운데 오도록 */
  function centerOn(x, y, z = state.view.z) {
    const v = state.view;
    v.z = z;
    v.panX = v.w / 2 - x * z;
    v.panY = v.h / 2 - y * z;
    clampView();
    requestRender();
  }

  /** ms 동안 부드럽게 (x, y) 로 날아가며 z 로 확대한다. 동서는 가까운 쪽으로 돈다 */
  function flyTo(x, y, z, ms) {
    const v = state.view;
    const cols = state.game.layout.cols;
    const z0 = v.z;
    let x0 = (v.w / 2 - v.panX) / z0;
    const y0 = (v.h / 2 - v.panY) / z0;
    x0 += Math.round((x - x0) / cols) * cols;
    const start = performance.now();
    cancelAnimationFrame(flight);
    const stepFly = (now) => {
      const t = Math.min(1, (now - start) / ms);
      const e = ease(t);
      const zz = z0 * (z / z0) ** e;
      v.z = zz;
      v.panX = v.w / 2 - (x0 + (x - x0) * e) * zz;
      v.panY = v.h / 2 - (y0 + (y - y0) * e) * zz;
      clampView();
      requestRender();
      if (t < 1) flight = requestAnimationFrame(stepFly);
    };
    flight = requestAnimationFrame(stepFly);
  }

  return { clampView, resizeCanvas, fitView, zoomAt, cellAt, pointToGrid, centerOn, flyTo };
}
