// 세계 육지 데이터(TopoJSON)를 격자 바다 지도로 바꾼다.

const LAT_TOP_BASE = 80;
const LAT_SPAN = 150;
const MASK_RES = 8; // 칸 하나를 8x8 픽셀로 칠해 육지 비율을 잰다
const LAND_RATIO = 0.5;

/** 날짜변경선(±180°)을 건너는 고리는 경도를 이어 붙여 화면을 가로지르는 선이 생기지 않게 한다 */
export function unwrapRing(ring) {
  let shift = 0;
  const out = ring.map(([lon, lat], k) => {
    if (k > 0) {
      const prev = ring[k - 1][0];
      if (lon - prev > 180) shift -= 360;
      else if (prev - lon > 180) shift += 360;
    }
    return [lon + shift, lat];
  });
  if (shift === 0) return out;
  // 지구를 한 바퀴 감싸는 고리(남극 대륙)는 극점을 거쳐 닫는다
  const pole = out.reduce((s, p) => s + p[1], 0) < 0 ? -90 : 90;
  return [...out, [out[out.length - 1][0], pole], [out[0][0], pole]];
}

/** TopoJSON(양자화) 를 [lon,lat] 고리 배열의 다각형 목록으로 푼다 */
export function decodeLand(topo) {
  const [sx, sy] = topo.transform.scale;
  const [tx, ty] = topo.transform.translate;
  const arcs = topo.arcs.map((arc) => {
    let x = 0;
    let y = 0;
    return arc.map(([dx, dy]) => {
      x += dx;
      y += dy;
      return [x * sx + tx, y * sy + ty];
    });
  });
  const ringOf = (indexes) => unwrapRing(indexes.flatMap((a, k) => {
    const pts = a >= 0 ? arcs[a] : [...arcs[~a]].reverse();
    return k === 0 ? pts : pts.slice(1);
  }));
  const polygons = [];
  for (const geom of Object.values(topo.objects)[0].geometries) {
    const list = geom.type === 'Polygon' ? [geom.arcs] : geom.type === 'MultiPolygon' ? geom.arcs : [];
    list.forEach((poly) => polygons.push(poly.map(ringOf)));
  }
  return polygons;
}

/** 매판 다른 지도: 경도 회전과 위도 어긋남을 무작위로 정한다 */
export function makeLayout(cols, rng = Math.random) {
  const cellDeg = 360 / cols;
  const rows = Math.round(LAT_SPAN / cellDeg);
  return {
    cols,
    rows,
    cellDeg,
    rot: rng() * 360,
    latTop: LAT_TOP_BASE + rng() * cellDeg,
  };
}

/** 경위도 → 격자 칸 단위 좌표 (x 는 0~2*cols 범위, 한 바퀴를 넘을 수 있음) */
export function project(layout, lon, lat) {
  return [((lon + 180 + layout.rot) / 360) * layout.cols, (layout.latTop - lat) / layout.cellDeg];
}

function tracePolygons(ctx, polygons, layout, scale, offsetX) {
  ctx.beginPath();
  for (const poly of polygons) {
    for (const ring of poly) {
      ring.forEach(([lon, lat], k) => {
        const [x, y] = project(layout, lon, lat);
        const px = x * scale + offsetX;
        const py = y * scale;
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.closePath();
    }
  }
}

/** 칸마다 바다(1)/육지(0) 를 담은 배열 */
export function buildOceanMask(polygons, layout) {
  const { cols, rows } = layout;
  const w = cols * MASK_RES;
  const h = rows * MASK_RES;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#000';
  for (const off of [-w, 0, w]) {
    tracePolygons(ctx, polygons, layout, MASK_RES, off);
    ctx.fill('evenodd');
  }
  const { data } = ctx.getImageData(0, 0, w, h);
  const ocean = new Uint8Array(cols * rows);
  const limit = MASK_RES * MASK_RES * LAND_RATIO;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      let land = 0;
      for (let y = 0; y < MASK_RES; y += 1) {
        const rowStart = ((r * MASK_RES + y) * w + c * MASK_RES) * 4 + 3;
        for (let x = 0; x < MASK_RES; x += 1) if (data[rowStart + x * 4] > 127) land += 1;
      }
      ocean[r * cols + c] = land < limit ? 1 : 0;
    }
  }
  return ocean;
}

/** 해안선 Path2D (칸 단위 좌표). 그릴 때 한 바퀴씩 옮겨 가며 반복해서 그린다 */
export function buildCoastPath(polygons, layout) {
  const path = new Path2D();
  for (const poly of polygons) {
    for (const ring of poly) {
      ring.forEach(([lon, lat], k) => {
        const [x, y] = project(layout, lon, lat);
        if (k === 0) path.moveTo(x, y);
        else path.lineTo(x, y);
      });
      path.closePath();
    }
  }
  return path;
}
