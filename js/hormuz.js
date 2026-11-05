// 호르무즈 해협 봉쇄: 페르시아만 + 오만만 범위. 화면과 무관한 순수 함수.

/**
 * 페르시아만과 오만만을 감싸는 경위도 다각형 [경도, 위도].
 * 오만만 입구는 라스알하드(오만)에서 지와니(파키스탄 국경)까지 잇는 선, 남쪽 변은 아라비아 반도 안쪽을 지난다.
 */
export const GULF_POLYGON = [
  [47.5, 31.2], [51.0, 31.2], [57.5, 27.8], [61.7, 25.1], [59.8, 22.4], [51.0, 22.4], [47.5, 27.0],
];

/** 해협을 가로막는 봉쇄선 (이란 쪽 → 무산담 반도 끝) */
export const STRAIT_LINE = [[56.2, 27.5], [56.45, 25.9]];

/** 확대할 때 화면 가운데로 올 곳 */
export const GULF_CENTER = [54.5, 26.2];

/** 칸 가운데의 경위도 */
export function cellLonLat(layout, i) {
  const c = i % layout.cols;
  const r = Math.floor(i / layout.cols);
  const lon = (((c + 0.5) * layout.cellDeg - 180 - layout.rot) % 360 + 540) % 360 - 180;
  return [lon, layout.latTop - (r + 0.5) * layout.cellDeg];
}

function inside([x, y], poly) {
  let hit = false;
  for (let a = 0, b = poly.length - 1; a < poly.length; b = a, a += 1) {
    const [xa, ya] = poly[a];
    const [xb, yb] = poly[b];
    if ((ya > y) !== (yb > y) && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) hit = !hit;
  }
  return hit;
}

/** 범위 안의 바다 칸 */
export function hormuzCells(board, layout, poly = GULF_POLYGON) {
  const out = [];
  for (let i = 0; i < board.ocean.length; i += 1) {
    if (board.ocean[i] && inside(cellLonLat(layout, i), poly)) out.push(i);
  }
  return out;
}
